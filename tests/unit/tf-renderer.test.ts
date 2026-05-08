import { describe, expect, test } from "bun:test";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MenuRenderer } from "../../src/interface/telegram/engine/renderer/menu-renderer.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import type { PageDefinition } from "../../src/interface/telegram/engine/types.ts";
import { makeCtx } from "../fixtures/make-ctx.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

/**
 * MenuRenderer covers design-system §03: one menu per chat, edit-in-place
 * on subsequent renders, byte-equal short-circuit, and stale-id recovery.
 */

const mkPage = (path: string, body: string): PageDefinition => ({
  path,
  parent: "/",
  render: () => ({ text: body, parseMode: "HTML" }),
  keyboard: () => [],
});

const buildRegistry = (): PageRegistry => {
  const reg = new PageRegistry();
  reg.register({ path: "/", parent: null, render: () => ({ text: "" }), keyboard: () => [] });
  reg.register(mkPage("/a", "A"));
  reg.register(mkPage("/b", "B"));
  return reg;
};

describe("MenuRenderer.renderMenu", () => {
  test("first render sends fresh message and tracks it on session", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    expect(api.calls("sendMessage")).toHaveLength(1);
    expect(api.history).toHaveLength(1);
    expect(ctx.session.menu.messageId).toBe(100);
    const tracked = ctx.session.messages["/a"];
    expect(tracked).toHaveLength(1);
    expect(tracked?.[0]?.type).toBe("MENU");
    expect(tracked?.[0]?.messageId).toBe(100);
  });

  test("identical re-render dedupes and issues no API calls", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    const page = mkPage("/a", "A");
    await renderer.renderMenu(ctx, page);
    await renderer.renderMenu(ctx, page);
    expect(api.calls("sendMessage")).toHaveLength(1);
    expect(api.calls("editMessageText")).toHaveLength(0);
  });

  test("rendering a different page edits in place", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    await renderer.renderMenu(ctx, mkPage("/b", "B"));
    expect(api.calls("sendMessage")).toHaveLength(1);
    expect(api.calls("editMessageText")).toHaveLength(1);
    expect(api.last("editMessageText")?.[1]).toBe(100);
    expect(api.last("editMessageText")?.[2]).toBe("B");
  });

  test("stale message id triggers a fresh send and updates session", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    api.failNext("editMessageText", new Error("Bad Request: message to edit not found"));
    await renderer.renderMenu(ctx, mkPage("/b", "B"));
    expect(api.calls("sendMessage")).toHaveLength(2);
    expect(api.calls("editMessageText")).toHaveLength(1);
    expect(ctx.session.menu.messageId).toBe(101);
  });
});
