import { describe, expect, test } from "bun:test";
import { registerArchitectActions } from "../../src/interface/telegram/architect/actions.ts";
import type { ArchitectRunner } from "../../src/interface/telegram/architect/runner.ts";
import { InputFlowEngine } from "../../src/interface/telegram/engine/flow/engine.ts";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MenuRenderer } from "../../src/interface/telegram/engine/renderer/menu-renderer.ts";
import { goBack } from "../../src/interface/telegram/engine/router/back.ts";
import { resolveStart } from "../../src/interface/telegram/engine/router/deep-link.ts";
import { navigateTo } from "../../src/interface/telegram/engine/router/navigate.ts";
import { freshSession } from "../../src/interface/telegram/engine/session/schema.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import {
  type Ctx,
  DopellerError,
  type PageDefinition,
  type ServicesShape,
} from "../../src/interface/telegram/engine/types.ts";
import { FakeBot } from "../fixtures/fake-grammy.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

/**
 * Router contract tests. Exercise navigateTo / goBack / resolveStart with
 * a fresh PageRegistry per case so the engine's default singleton is not
 * mutated across tests.
 */

const page = (
  path: string,
  parent: string | null,
  extras: Partial<PageDefinition> = {},
): PageDefinition => ({
  path,
  parent,
  render: () => ({ text: `body:${path}` }),
  keyboard: () => [],
  ...extras,
});

async function setup(extras: PageDefinition[] = [], rootExtras: Partial<PageDefinition> = {}) {
  const api = new StubBotApi();
  const store = new MemorySessionStore();
  const registry = new PageRegistry();
  registry.register(page("/", null, rootExtras));
  for (const p of extras) registry.register(p);
  const renderer = new MenuRenderer(store, registry);
  const session = await store.load(7, 4242);
  const ctx: Ctx = { api, chatId: 4242, userId: 7, session, services: {} };
  return { api, registry, renderer, store, ctx };
}

describe("navigateTo", () => {
  test("registered target updates menu state and renders", async () => {
    const { api, registry, renderer, store, ctx } = await setup([page("/a", "/")]);
    await navigateTo(ctx, "/a", { registry, renderer, store });
    expect(ctx.session.menu.currentPage).toBe("/a");
    expect(ctx.session.menu.previousPage).toBe("/");
    expect(ctx.session.menu.navigationStack).toEqual(["/", "/a"]);
    const rendered = api.calls("sendMessage").length + api.calls("editMessageText").length;
    expect(rendered).toBeGreaterThan(0);
  });

  test("unknown path throws DopellerError(unknown_page)", async () => {
    const { registry, renderer, store, ctx } = await setup();
    let caught: unknown;
    try {
      await navigateTo(ctx, "/missing", { registry, renderer, store });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DopellerError);
    expect((caught as DopellerError).code).toBe("unknown_page");
  });

  test("hasUnsavedWork defers to the navigation guard", async () => {
    const { api, registry, renderer, store, ctx } = await setup([page("/a", "/")], {
      hasUnsavedWork: () => true,
    });
    await navigateTo(ctx, "/a", { registry, renderer, store });
    expect(ctx.session.menu.currentPage).toBe("/");
    expect(ctx.session.navigationGuard.active).toBe(true);
    expect(ctx.session.navigationGuard.pendingDestination).toBe("/a");
    const tracked = ctx.session.messages["/"] ?? [];
    const conf = tracked.find((m) => m.type === "INTERACTIVE" && m.subtype === "CONFIRMATION");
    expect(conf).toBeDefined();
    expect(api.calls("sendMessage").length).toBe(1);
  });
});

describe("goBack", () => {
  test("pops the stack; from a single-element stack stays at /", async () => {
    const { registry, renderer, store, ctx } = await setup([page("/a", "/")]);
    await navigateTo(ctx, "/a", { registry, renderer, store });
    await goBack(ctx, { registry, renderer, store });
    expect(ctx.session.menu.currentPage).toBe("/");

    ctx.session.menu.navigationStack = ["/"];
    await goBack(ctx, { registry, renderer, store });
    expect(ctx.session.menu.currentPage).toBe("/");
  });
});

describe("resolveStart", () => {
  test("routes by payload and projectRoot", () => {
    const session = freshSession({ userId: 7, chatId: 4242, now: 0 });
    expect(resolveStart(undefined, session)).toBe("/");
    session.projectRoot = "/repo";
    expect(resolveStart("project_demo", session)).toBe("/project/demo");
    expect(resolveStart(undefined, session)).toBe("/");
  });
});

describe("nav-cancels-flow middleware", () => {
  test("navigateTo cancels an active input flow", async () => {
    // Build the engine pieces directly (no TeleFocus.attach) so the
    // test owns its own registry/store/flow and can drive a known
    // session shape into the architect-level middleware.
    const store = new MemorySessionStore();
    const registry = new PageRegistry();
    registry.register({
      path: "/",
      parent: null,
      render: () => ({ text: "body:/" }),
      keyboard: () => [],
    });
    const renderer = new MenuRenderer(store, registry);
    const flow = new InputFlowEngine({ registry, renderer, store });
    const services: ServicesShape = {};
    // The runner is unused on the nav-cancel path; a typed shell keeps
    // the deps shape honest without dragging in the real architect
    // orchestrator.
    const runner: ArchitectRunner = {
      loadCurrent: async () => null,
      newProject: async () => {
        throw new Error("unused in nav-cancel test");
      },
      advance: async () => {
        throw new Error("unused in nav-cancel test");
      },
      resolveApproval: async () => {
        throw new Error("unused in nav-cancel test");
      },
      pendingGate: () => null,
    };

    const bot = new FakeBot();
    registerArchitectActions(bot.asBot(), {
      runner,
      renderer,
      registry,
      store,
      flow,
      services,
    });

    // Pre-stage a session whose input flow is active. The nav middleware
    // MUST observe `inputFlow.active === true` and clear it before the
    // navigation chain runs.
    const origin = { from: { id: 7 }, chat: { id: 4242 } };
    const session = await store.load(origin.from.id, origin.chat.id);
    session.inputFlow = {
      active: true,
      pagePath: "/",
      flowId: "test_flow",
      currentStep: 0,
      totalSteps: 1,
      collectedData: {},
      promptMessageId: null,
      progressMessageId: null,
      awaitingInput: true,
      inputType: "text",
      validationRules: { type: "text", min: 0, max: 1, errorMessage: "" },
      retries: 0,
    };
    await store.save(session);

    // Inject a manual nav callback. The FakeBot dispatches the first
    // matching `bot.callbackQuery(...)` registration, which is our
    // nav-cancel middleware.
    await bot.inject({ callbackQuery: { data: "nav:/somewhere" } }, origin);

    const after = await store.load(origin.from.id, origin.chat.id);
    expect(after.inputFlow.active).toBe(false);
  });
});
