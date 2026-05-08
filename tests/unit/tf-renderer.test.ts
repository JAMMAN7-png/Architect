import { describe, expect, test } from "bun:test";
import { ce } from "../../src/interface/telegram/engine/messages/custom-emoji.ts";
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

describe("MenuRenderer lock state", () => {
  test("when session.inputFlow.active is true, renderer emits a locked body and one Cancel button", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.inputFlow.active = true;
    ctx.session.inputFlow.awaitingInput = true;
    ctx.session.inputFlow.pagePath = "/a";
    ctx.session.menu.currentPage = "/a";

    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    await renderer.renderMenu(ctx, mkPage("/a", "A-page-body"));

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    const text = sent?.[1] as string;
    expect(text).not.toContain("A-page-body");
    expect(text).toContain("Waiting for your input");
    expect(text.startsWith(`${ce("flow-lock")} `)).toBe(true);

    const opts = sent?.[2] as { reply_markup?: { inline_keyboard: unknown[][] } };
    const keyboard = opts?.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    const btn = keyboard[0]?.[0] as { text: string; callback_data: string };
    expect(btn.text).toBe("× Cancel");
    expect(btn.callback_data).toBe("action:engine:flow:cancel");
  });

  test("when session.activeModal is set, renderer emits a locked body containing the modal title and exactly one Cancel button", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.activeModal = { scope: "/a", messageId: 999, title: "Confirm thing" };
    ctx.session.menu.currentPage = "/a";

    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    await renderer.renderMenu(ctx, mkPage("/a", "A-page-body"));

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    const text = sent?.[1] as string;
    expect(text).not.toContain("A-page-body");
    expect(text).toContain("Confirm thing");
    expect(text).toContain("Resolve it");
    expect(text.startsWith(`${ce("modal-lock")} `)).toBe(true);

    const opts = sent?.[2] as { reply_markup?: { inline_keyboard: unknown[][] } };
    const keyboard = opts?.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    const btn = keyboard[0]?.[0] as { text: string; callback_data: string };
    expect(btn.text).toBe("× Cancel");
    expect(btn.callback_data).toBe("action:engine:modal:cancel");
  });

  test("modal lock strictly preempts input-flow lock when both are set", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.inputFlow.active = true;
    ctx.session.inputFlow.awaitingInput = true;
    ctx.session.activeModal = { scope: "/a", messageId: 999, title: "Modal Wins" };
    ctx.session.menu.currentPage = "/a";

    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());
    await renderer.renderMenu(ctx, mkPage("/a", "ignored"));

    const sent = api.last("sendMessage");
    const text = sent?.[1] as string;
    expect(text).toContain("Modal Wins");
    const opts = sent?.[2] as { reply_markup?: { inline_keyboard: unknown[][] } };
    const btn = opts?.reply_markup?.inline_keyboard?.[0]?.[0] as { callback_data: string };
    expect(btn.callback_data).toBe("action:engine:modal:cancel");
  });
});

describe("MenuRenderer staleness", () => {
  test("crossing the threshold triggers forceFresh + fresh send", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());

    // Seed a tracked menu from a first render.
    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    expect(ctx.session.menu.messageId).toBe(100);
    ctx.session.menu.staleness = 3;

    await renderer.renderMenu(ctx, mkPage("/a", "A"));

    // forceFresh deleted the old menu, then a fresh send issued.
    const deletes = api.calls("deleteMessage").map((c) => c.args[1]);
    expect(deletes).toContain(100);
    expect(api.calls("sendMessage").length).toBe(2);
    expect(ctx.session.menu.staleness).toBe(0);
    expect(ctx.session.menu.messageId).toBe(101);
  });

  test("below threshold edits in place, no auto-fresh", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());

    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    ctx.session.menu.staleness = 2;

    await renderer.renderMenu(ctx, mkPage("/b", "B"));

    expect(api.calls("deleteMessage").length).toBe(0);
    expect(api.calls("sendMessage").length).toBe(1);
    expect(api.calls("editMessageText").length).toBe(1);
  });

  test("successful render resets staleness to 0", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());

    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    ctx.session.menu.staleness = 2;

    await renderer.renderMenu(ctx, mkPage("/b", "B"));
    expect(ctx.session.menu.staleness).toBe(0);
  });
});
