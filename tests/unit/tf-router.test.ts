import { describe, expect, test } from "bun:test";
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
} from "../../src/interface/telegram/engine/types.ts";
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
