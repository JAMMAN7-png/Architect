import { afterEach, describe, expect, test } from "bun:test";
import { __setEmojiRegistryForTests } from "../../src/interface/telegram/engine/messages/custom-emoji.ts";
import {
  dismissActiveModal,
  dismissModalsInScope,
  modal,
} from "../../src/interface/telegram/engine/messages/modal.ts";
import {
  __setTtlDeleterForTests,
  cancelTtlTimer,
  send,
} from "../../src/interface/telegram/engine/messages/send.ts";
import { toast } from "../../src/interface/telegram/engine/messages/toast.ts";
import {
  cleanupScope,
  dropExpiredMessages,
  trackMessage,
} from "../../src/interface/telegram/engine/messages/tracking.ts";
import type { TrackedMessage } from "../../src/interface/telegram/engine/types.ts";
import { makeCtx } from "../fixtures/make-ctx.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

/**
 * Tests for the engine's send/toast/modal/tracking layer. Each case
 * isolates one rule from `docs/design-system/04-messages.md` and
 * `07-toasts-modals.md`; the StubBotApi captures every outbound call so
 * we can assert side-effects without touching grammY.
 */

// Pin the registry to plain glyphs so assertions stay stable even when
// `TG_CUSTOM_EMOJI_*` vars are set in the surrounding environment.
afterEach(() => {
  __setEmojiRegistryForTests(null);
});

const FALLBACKS = {
  success: { id: "", fallback: "✅" },
  warning: { id: "", fallback: "⚠️" },
  error: { id: "", fallback: "❌" },
  "modal-lock": { id: "", fallback: "⏳" },
} as const;

describe("send", () => {
  test("plain INFO ephemeral builds a tracked message with icon prefix", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    const tracked = await send(ctx, "hello world", { type: "EPHEMERAL", subtype: "INFO" });

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    expect(sent?.[1]).toMatch(/^✅ hello world$/);
    expect(tracked.messageId).toBe(100);
    expect(tracked.type).toBe("EPHEMERAL");
    expect(tracked.subtype).toBe("INFO");
    expect(tracked.pagePath).toBe("/");
    // Tracked under the current page scope.
    const list = ctx.session.messages["/"];
    expect(list).toBeDefined();
    expect(list?.length).toBe(1);
    expect(list?.[0]?.messageId).toBe(100);
  });

  test("replacePrevious=true edits the prior matching message", async () => {
    const api = new StubBotApi();
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const ctx = await makeCtx(api);

    await send(ctx, "first", {
      type: "INPUT_PROGRESS",
      subtype: "INFO",
      replacePrevious: true,
    });
    await send(ctx, "second", {
      type: "INPUT_PROGRESS",
      subtype: "INFO",
      replacePrevious: true,
    });

    expect(api.calls("sendMessage").length).toBe(1);
    expect(api.calls("editMessageText").length).toBe(1);
    const edit = api.last("editMessageText");
    expect(edit?.[1]).toBe(100); // edits the original message_id
    expect(edit?.[2]).toBe("second");
    // Still exactly one tracked message in scope.
    expect(ctx.session.messages["/"]?.length).toBe(1);
  });
  test("reply threading: defaults to session.menu.messageId", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.menu.messageId = 42;

    await toast.info(ctx, "hi");

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    const opts = sent?.[2] as {
      reply_parameters?: { message_id: number; allow_sending_without_reply: boolean };
    };
    expect(opts.reply_parameters).toEqual({ message_id: 42, allow_sending_without_reply: true });
  });

  test("reply threading: replyTo:null opts out", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.menu.messageId = 42;

    await send(ctx, "hi", { type: "EPHEMERAL", subtype: "INFO", replyTo: null });

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    const opts = sent?.[2] as { reply_parameters?: unknown };
    expect(opts.reply_parameters).toBeUndefined();
  });

  test("reply threading: no menu yet → no reply_parameters, send still succeeds", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    expect(ctx.session.menu.messageId).toBeNull();

    const tracked = await toast.info(ctx, "hi");
    expect(tracked.messageId).toBe(100);

    const sent = api.last("sendMessage");
    const opts = sent?.[2] as { reply_parameters?: unknown };
    expect(opts.reply_parameters).toBeUndefined();
  });

  test("reply threading: replyTo:<id> overrides the default", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.menu.messageId = 42;

    await send(ctx, "hi", { type: "EPHEMERAL", subtype: "INFO", replyTo: 999 });

    const sent = api.last("sendMessage");
    const opts = sent?.[2] as { reply_parameters?: { message_id: number } };
    expect(opts.reply_parameters?.message_id).toBe(999);
  });

  test("edit-replace branch carries no reply_parameters", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    ctx.session.menu.messageId = 42;

    await toast.info(ctx, "first");
    await toast.info(ctx, "second");

    expect(api.calls("editMessageText").length).toBe(1);
    const edit = api.last("editMessageText");
    const opts = edit?.[3] as { reply_parameters?: unknown };
    expect(opts.reply_parameters).toBeUndefined();
  });

  test("staleness bumps on a fresh non-MENU send", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    expect(ctx.session.menu.staleness ?? 0).toBe(0);

    await toast.info(ctx, "first");
    expect(ctx.session.menu.staleness).toBe(1);
  });

  test("staleness does NOT bump on edit-replace", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await toast.info(ctx, "first");
    await toast.info(ctx, "second"); // edits in place

    expect(ctx.session.menu.staleness).toBe(1);
  });

  test("staleness does NOT bump on INPUT_PROGRESS sends", async () => {
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await send(ctx, "Step 1 of 2", { type: "INPUT_PROGRESS", replacePrevious: true });
    expect(ctx.session.menu.staleness ?? 0).toBe(0);
  });
});

describe("toast", () => {
  test("two consecutive toast.info calls edit a single tracked message", async () => {
    const api = new StubBotApi();
    __setEmojiRegistryForTests({ success: FALLBACKS.success });
    const ctx = await makeCtx(api);

    await toast.info(ctx, "saved");
    await toast.info(ctx, "saved again");

    const list = ctx.session.messages["/"] ?? [];
    expect(list.length).toBe(1);
    expect(api.calls("sendMessage").length).toBe(1);
    expect(api.calls("editMessageText").length).toBe(1);
    expect(api.last("editMessageText")?.[2]).toMatch(/^✅ saved again$/);
  });
});

describe("tracking.cleanupScope", () => {
  test("deletes every non-MENU message in scope; MENU survives", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const now = Date.now();

    const menu: TrackedMessage = {
      messageId: 1,
      type: "MENU",
      pagePath: "/",
      createdAt: now,
    };
    const ephemeral: TrackedMessage = {
      messageId: 2,
      type: "EPHEMERAL",
      subtype: "INFO",
      pagePath: "/",
      createdAt: now,
    };
    const interactive: TrackedMessage = {
      messageId: 3,
      type: "INTERACTIVE",
      subtype: "CONFIRMATION",
      pagePath: "/",
      createdAt: now,
    };
    trackMessage(ctx.session, menu);
    trackMessage(ctx.session, ephemeral);
    trackMessage(ctx.session, interactive);

    await cleanupScope(ctx, "/");

    const deletes = api.calls("deleteMessage");
    const deletedIds = deletes.map((c) => c.args[1]);
    expect(deletedIds).toEqual([2, 3]);
    expect(deletedIds).not.toContain(1);
    // Scope key dropped entirely after cleanup.
    expect(ctx.session.messages["/"]).toBeUndefined();
  });
});

describe("tracking.dropExpiredMessages", () => {
  test("prunes expired entries and leaves live ones intact", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const now = 10_000;

    const stale: TrackedMessage = {
      messageId: 50,
      type: "EPHEMERAL",
      subtype: "INFO",
      pagePath: "/",
      createdAt: now - 5000,
      expiresAt: now - 1, // already expired
    };
    const fresh: TrackedMessage = {
      messageId: 51,
      type: "EPHEMERAL",
      subtype: "WARNING",
      pagePath: "/",
      createdAt: now,
      expiresAt: now + 5000,
    };
    const eternal: TrackedMessage = {
      messageId: 52,
      type: "INTERACTIVE",
      subtype: "CONFIRMATION",
      pagePath: "/",
      createdAt: now,
      // no expiresAt
    };
    trackMessage(ctx.session, stale);
    trackMessage(ctx.session, fresh);
    trackMessage(ctx.session, eternal);

    dropExpiredMessages(ctx.session, now);

    const ids = (ctx.session.messages["/"] ?? []).map((m) => m.messageId).sort((a, b) => a - b);
    expect(ids).toEqual([51, 52]);
  });
});

describe("modal.confirm", () => {
  test("tracks an INTERACTIVE/CONFIRMATION with the requested callback_data", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    const tracked = await modal.confirm(ctx, {
      title: "Leave?",
      body: "Unsaved work will be discarded.",
      confirmLabel: "Yes, leave",
      confirmCallback: "guard:leave",
    });

    expect(tracked.type).toBe("INTERACTIVE");
    expect(tracked.subtype).toBe("CONFIRMATION");

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    const opts = sent?.[2] as {
      reply_markup?: { inline_keyboard: { callback_data?: string }[][] };
    };
    const keyboard = opts?.reply_markup?.inline_keyboard ?? [];
    expect(keyboard[0]?.[0]?.callback_data).toBe("guard:leave");
    // Default cancel callback wired in too.
    expect(keyboard[1]?.[0]?.callback_data).toBe("action:modal:cancel");

    const list = ctx.session.messages["/"] ?? [];
    expect(list.length).toBe(1);
    expect(list[0]?.type).toBe("INTERACTIVE");
    expect(list[0]?.subtype).toBe("CONFIRMATION");
  });

  test("body starts with the bare modal-lock glyph when no override id is set", async () => {
    __setEmojiRegistryForTests({ "modal-lock": FALLBACKS["modal-lock"] });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await modal.confirm(ctx, {
      title: "Leave?",
      body: "Unsaved work will be discarded.",
      confirmLabel: "Yes, leave",
      confirmCallback: "guard:leave",
    });

    const sent = api.last("sendMessage");
    const text = sent?.[1] as string;
    expect(text.startsWith("⏳ <b>")).toBe(true);
    expect(text).toContain("<b>Leave?</b>");
  });

  test("body starts with a tg-emoji span when an override id is configured", async () => {
    __setEmojiRegistryForTests({ "modal-lock": { id: "5368324170671202286", fallback: "⏳" } });
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await modal.confirm(ctx, {
      title: "Leave?",
      body: "Unsaved work will be discarded.",
      confirmLabel: "Yes, leave",
      confirmCallback: "guard:leave",
    });

    const sent = api.last("sendMessage");
    const text = sent?.[1] as string;
    expect(text.startsWith('<tg-emoji emoji-id="5368324170671202286">⏳</tg-emoji> <b>')).toBe(
      true,
    );
    expect(text).toContain("<b>Leave?</b>");
  });
});

describe("send TTL eviction", () => {
  test("auto-deletes ephemeral and untracks once ttl elapses", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    const tracked = await send(ctx, "fading", {
      type: "EPHEMERAL",
      subtype: "INFO",
      ttlMs: 50,
    });
    expect(ctx.session.messages["/"]?.length).toBe(1);

    await new Promise((r) => setTimeout(r, 90));

    const deletes = api.calls("deleteMessage");
    expect(deletes.length).toBe(1);
    expect(deletes[0]?.args[1]).toBe(tracked.messageId);
    expect(ctx.session.messages["/"]).toBeUndefined();
  });

  test("replacing edit reschedules the timer to the shorter ttl", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await send(ctx, "long", {
      type: "EPHEMERAL",
      subtype: "INFO",
      ttlMs: 200,
    });
    await send(ctx, "short", {
      type: "EPHEMERAL",
      subtype: "INFO",
      ttlMs: 50,
    });

    // The second send must edit the first in place, not create a new
    // message; a single deleteMessage at the 50 ms cut-off proves the
    // timer was rescheduled rather than left at 200 ms.
    expect(api.calls("editMessageText").length).toBe(1);
    expect(api.calls("sendMessage").length).toBe(1);

    await new Promise((r) => setTimeout(r, 90));

    const deletes = api.calls("deleteMessage");
    expect(deletes.length).toBe(1);
    expect(deletes[0]?.args[1]).toBe(100);
    expect(ctx.session.messages["/"]).toBeUndefined();
  });

  test("no timer is scheduled when expiresAt is absent", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    const tracked = await send(ctx, "stays put", {
      type: "INTERACTIVE",
      subtype: "CONFIRMATION",
    });
    expect(tracked.expiresAt).toBeUndefined();

    await new Promise((r) => setTimeout(r, 100));

    expect(api.calls("deleteMessage").length).toBe(0);
    expect(ctx.session.messages["/"]?.length).toBe(1);

    // Belt-and-braces: the timer map should not hold a stale entry.
    cancelTtlTimer(ctx.chatId, tracked.messageId);
    // Restoring the default deleter is a no-op here but documents the
    // test seam exists for future tests that swap it in.
    __setTtlDeleterForTests(null);
  });
});

describe("modal.confirm + activeModal", () => {
  test("modal.confirm sets session.activeModal; dismissModalsInScope clears it when it dismisses that scope", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    expect(ctx.session.activeModal).toBeNull();

    const tracked = await modal.confirm(ctx, {
      title: "Leave?",
      body: "Unsaved work will be discarded.",
      confirmLabel: "Yes, leave",
      confirmCallback: "guard:leave",
    });

    expect(ctx.session.activeModal).not.toBeNull();
    expect(ctx.session.activeModal?.scope).toBe("/");
    expect(ctx.session.activeModal?.messageId).toBe(tracked.messageId);
    expect(ctx.session.activeModal?.title).toBe("Leave?");

    await dismissModalsInScope(ctx, "/");

    expect(ctx.session.activeModal).toBeNull();
    // Modal was deleted from chat.
    expect(api.calls("deleteMessage").map((c) => c.args[1])).toContain(tracked.messageId);
  });

  test("dismissActiveModal is idempotent", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    dismissActiveModal(ctx.session);
    expect(ctx.session.activeModal).toBeNull();

    await modal.confirm(ctx, {
      title: "T",
      body: "B",
      confirmLabel: "ok",
      confirmCallback: "x:y",
    });
    expect(ctx.session.activeModal).not.toBeNull();

    dismissActiveModal(ctx.session);
    expect(ctx.session.activeModal).toBeNull();
  });

  test("dismissModalsInScope on an unrelated scope leaves session.activeModal alone", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await modal.confirm(ctx, {
      title: "T",
      body: "B",
      confirmLabel: "ok",
      confirmCallback: "x:y",
      scope: "/a",
    });
    const before = ctx.session.activeModal;
    expect(before).not.toBeNull();

    await dismissModalsInScope(ctx, "/b");
    expect(ctx.session.activeModal).toEqual(before);
  });
});
