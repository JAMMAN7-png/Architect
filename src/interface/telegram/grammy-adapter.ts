/**
 * grammY ⇄ TeleFocus adapter.
 *
 * Translates a grammY {@link Context} (and its {@link Api} handle) into
 * the framework-agnostic {@link Ctx} shape consumed by the engine's
 * middleware pipeline. The session attached here is a placeholder — the
 * session-loader middleware swaps it for the persisted record on the
 * first dispatch step.
 *
 * grammY's strongly-typed `Other<…>` parameter unions clash with our
 * deliberately loose `Record<string, unknown>` `BotApi` surface, so the
 * forwarding methods cast the options bag through `unknown` to the
 * matching grammY parameter type. This is the only place in the codebase
 * where that bridge is permitted.
 */

import type { Api, Context as GrammyContext } from "grammy";

import { freshSession } from "./engine/session/schema.ts";
import type { BotApi, Ctx, ServicesShape } from "./engine/types.ts";

/** grammY's option-bag types are deeply-typed unions; we accept any record. */
type Optsish = Record<string, unknown> | undefined;

/**
 * Build a {@link BotApi} that forwards to grammY's {@link Api}. Exported
 * so `server.ts` (and tests, in principle) can wrap a free-standing
 * `Api` instance — e.g. when scheduling messages outside an update.
 */
export function buildBotApi(api: Api): BotApi {
  return {
    sendMessage: (chatId, text, opts) =>
      api.sendMessage(
        chatId,
        text,
        opts as unknown as Parameters<Api["sendMessage"]>[2],
      ) as unknown as Promise<{ message_id: number }>,
    editMessageText: (chatId, messageId, text, opts) =>
      api.editMessageText(
        chatId,
        messageId,
        text,
        opts as unknown as Parameters<Api["editMessageText"]>[3],
      ) as unknown as Promise<unknown>,
    editMessageReplyMarkup: (chatId, messageId, opts) =>
      api.editMessageReplyMarkup(
        chatId,
        messageId,
        opts as unknown as Parameters<Api["editMessageReplyMarkup"]>[2],
      ) as unknown as Promise<unknown>,
    deleteMessage: (chatId, messageId) =>
      api.deleteMessage(chatId, messageId) as unknown as Promise<unknown>,
    answerCallbackQuery: (callbackQueryId, opts) =>
      api.answerCallbackQuery(
        callbackQueryId,
        opts as unknown as Parameters<Api["answerCallbackQuery"]>[1],
      ) as unknown as Promise<unknown>,
    sendChatAction: (chatId, action) =>
      api.sendChatAction(
        chatId,
        action as unknown as Parameters<Api["sendChatAction"]>[1],
      ) as unknown as Promise<unknown>,
  };
}

/**
 * Lift a grammY update into an Architect {@link Ctx}, ready for the
 * engine pipeline. Returns `null` when the update lacks both `from` and
 * `chat` (channel posts, anonymous service updates, …) — those cannot be
 * routed to a user session and the caller should silently skip them.
 */
export async function adaptUpdate(
  grammyCtx: GrammyContext,
  services: ServicesShape,
): Promise<Ctx | null> {
  const userId = grammyCtx.from?.id;
  const chatId = grammyCtx.chat?.id;
  if (userId === undefined || chatId === undefined) {
    return null;
  }

  const cb = grammyCtx.callbackQuery;
  const callbackQuery: Ctx["callbackQuery"] = cb
    ? {
        data: cb.data ?? "",
        id: cb.id,
        message: cb.message ? { message_id: cb.message.message_id } : undefined,
      }
    : undefined;

  const m = grammyCtx.message;
  const message: Ctx["message"] = m
    ? {
        text: m.text,
        message_id: m.message_id,
      }
    : undefined;

  // Placeholder session. The session-loader middleware replaces this
  // with the persisted record on the first dispatch step.
  const session = freshSession({ userId, chatId, now: Date.now() });

  const ctx: Ctx = {
    api: buildBotApi(grammyCtx.api),
    chatId,
    userId,
    callbackQuery,
    message,
    session,
    services,
  };
  return ctx;
}
