import { describe, expect, test } from "bun:test";
import { modal } from "../../src/interface/telegram/engine/messages/modal.ts";
import { send } from "../../src/interface/telegram/engine/messages/send.ts";
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

describe("send", () => {
  test("plain INFO ephemeral builds a tracked message with icon prefix", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    const tracked = await send(ctx, "hello world", { type: "EPHEMERAL", subtype: "INFO" });

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    expect(sent?.[1]).toBe("✅ hello world");
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
});

describe("toast", () => {
  test("two consecutive toast.info calls edit a single tracked message", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await toast.info(ctx, "saved");
    await toast.info(ctx, "saved again");

    const list = ctx.session.messages["/"] ?? [];
    expect(list.length).toBe(1);
    expect(api.calls("sendMessage").length).toBe(1);
    expect(api.calls("editMessageText").length).toBe(1);
    expect(api.last("editMessageText")?.[2]).toBe("✅ saved again");
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
});
