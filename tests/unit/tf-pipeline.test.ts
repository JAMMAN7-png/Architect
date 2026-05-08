import { describe, expect, test } from "bun:test";
import { errorBoundary } from "../../src/interface/telegram/engine/errors/boundary.ts";
import {
  buildPipeline,
  runPipeline,
} from "../../src/interface/telegram/engine/middleware/pipeline.ts";
import type {
  InputFlowEngine,
  MenuRenderer,
  Middleware,
} from "../../src/interface/telegram/engine/middleware/types.ts";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import { type Ctx, DopellerError } from "../../src/interface/telegram/engine/types.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

/**
 * Pipeline integration tests (design-system §10): canonical chain shape,
 * `runPipeline` ordering, session-loader → save round-trip through the
 * store, and the error boundary swallowing a typed `DopellerError`.
 */

const renderer = {
  async renderMenu() {},
  async rerender() {},
  async editKeyboardOnly() {},
} as unknown as MenuRenderer;

const flow = {
  async capture() {
    return "rejected" as const;
  },
} as unknown as InputFlowEngine;

async function ctxWith(api: StubBotApi, store: MemorySessionStore): Promise<Ctx> {
  const session = await store.load(7, 4242);
  return { api, chatId: 4242, userId: 7, session, services: {} };
}

describe("buildPipeline", () => {
  test("returns the 5-stage canonical chain", () => {
    const chain = buildPipeline({
      store: new MemorySessionStore(),
      registry: new PageRegistry(),
      renderer,
      flow,
    });
    expect(chain).toHaveLength(5);
    for (const mw of chain) expect(typeof mw).toBe("function");
  });
});

describe("runPipeline", () => {
  test("middlewares run in order; skipping next short-circuits the chain", async () => {
    const seen: string[] = [];
    const m1: Middleware = async (_c, _next) => {
      seen.push("m1");
    };
    const m2: Middleware = async () => {
      seen.push("m2");
    };
    await runPipeline({} as Ctx, [m1, m2]);
    expect(seen).toEqual(["m1"]);
  });
});

describe("session loader → save round-trip", () => {
  test("a mid-chain mutation persists to the backing store", async () => {
    const store = new MemorySessionStore();
    const api = new StubBotApi();
    const ctx = await ctxWith(api, store);

    const mark: Middleware = async (c, next) => {
      c.session.menu.lastAction = "x";
      await next();
    };
    const chain = buildPipeline({ store, registry: new PageRegistry(), renderer, flow });
    chain.splice(chain.length - 1, 0, mark); // before the trailing session-save
    await runPipeline(ctx, chain);

    const reloaded = await store.load(7, 4242);
    expect(reloaded.menu.lastAction).toBe("x");
  });
});

describe("errorBoundary inside runPipeline", () => {
  test("catches a DopellerError, renders the template, does not re-throw", async () => {
    const api = new StubBotApi();
    const store = new MemorySessionStore();
    const ctx = await ctxWith(api, store);

    const thrower: Middleware = async () => {
      throw new DopellerError("insufficient_stars", "user", "oops", {
        need: "50",
        have: "20",
      });
    };

    await expect(runPipeline(ctx, [errorBoundary, thrower])).resolves.toBeUndefined();

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    expect(String(sent?.[1])).toContain("You need 50 Stars; you have 20.");
  });
});
