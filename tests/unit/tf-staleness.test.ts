import { describe, expect, test } from "bun:test";
import { toast } from "../../src/interface/telegram/engine/messages/toast.ts";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MenuRenderer } from "../../src/interface/telegram/engine/renderer/menu-renderer.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import type { PageDefinition } from "../../src/interface/telegram/engine/types.ts";
import { makeCtx } from "../fixtures/make-ctx.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

/**
 * End-to-end coverage for bug 3 (stale-menu auto-refresh): sending three
 * fresh non-MENU messages must push staleness over the threshold; the
 * next render must drop the stale menu and re-emit at the chat bottom.
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
  return reg;
};

describe("tf-staleness end-to-end", () => {
  test("3 fresh toasts → next render is forced fresh at chat bottom", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const renderer = new MenuRenderer(new MemorySessionStore(), buildRegistry());

    // 1. Render page A so the menu is tracked.
    await renderer.renderMenu(ctx, mkPage("/a", "A"));
    const originalMenuId = ctx.session.menu.messageId;
    expect(originalMenuId).toBe(100);
    expect(ctx.session.menu.staleness).toBe(0);

    // 2. Send 3 fresh toasts. Each is a fresh non-MENU send → staleness++.
    //    Use distinct subtypes so the second/third don't edit-replace the first.
    await toast.info(ctx, "i1");
    await toast.warning(ctx, "w1");
    await toast.danger(ctx, "d1");
    expect(ctx.session.menu.staleness).toBe(3);

    // Each toast should have threaded under the original menu id.
    const sendsAfterMenu = api.calls("sendMessage").slice(1);
    expect(sendsAfterMenu.length).toBe(3);
    for (const c of sendsAfterMenu) {
      const opts = c.args[2] as {
        reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
      };
      expect(opts.reply_parameters?.message_id).toBe(originalMenuId ?? -1);
      expect(opts.reply_parameters?.allow_sending_without_reply).toBe(true);
    }

    // 3. Re-render page A. The renderer must delete the old menu and
    //    send a fresh one at the chat bottom.
    await renderer.renderMenu(ctx, mkPage("/a", "A"));

    const deletedIds = api.calls("deleteMessage").map((c) => c.args[1]);
    expect(deletedIds).toContain(originalMenuId);

    // Fresh send: the original menu plus one for the auto-refresh = 2.
    // (Toasts contributed 3 sends; total fresh sendMessage calls = 5.)
    expect(api.calls("sendMessage").length).toBe(5);

    // Staleness reset; new messageId tracked.
    expect(ctx.session.menu.staleness).toBe(0);
    expect(ctx.session.menu.messageId).not.toBe(originalMenuId);
  });
});
