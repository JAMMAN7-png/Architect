/**
 * Global error boundary middleware.
 *
 * First link in the engine middleware chain. Wraps `await next()` in
 * try/catch so that no thrown error escapes to the Telegram transport.
 *
 *   - `DopellerError` with a known `code` → render the matching template
 *     as an EPHEMERAL toast with optional inline CTA.
 *   - Any other error (or unknown code) → log with `update_id` and show
 *     a generic DANGER toast. Stack traces are never sent to the user.
 *
 * See design-system §08-error-handling.
 */

import { logger } from "../../../../util/logger.ts";
import { escapeHtml } from "../messages/sanitise.ts";
import { send } from "../messages/send.ts";
import { toast } from "../messages/toast.ts";
import type { Ctx, Middleware, NextFn } from "../types.ts";
import { DopellerError } from "../types.ts";
import { renderTemplate } from "./render.ts";
import { templates } from "./templates.ts";

export const errorBoundary: Middleware = async (ctx: Ctx, next: NextFn): Promise<void> => {
  try {
    await next();
  } catch (err) {
    if (err instanceof DopellerError) {
      const tpl = templates[err.code];
      if (tpl) {
        await handleTyped(ctx, err, tpl);
        return;
      }
    }
    await handleInternal(ctx, err);
  }
};

async function handleTyped(
  ctx: Ctx,
  err: DopellerError,
  tpl: (typeof templates)[string],
): Promise<void> {
  const vars = (err.metadata ?? {}) as Record<string, string>;
  const { title, body, cta } = renderTemplate(tpl, vars);
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  await send(ctx, `<b>${safeTitle}</b>\n${safeBody}`, {
    type: "EPHEMERAL",
    subtype: tpl.subtype ?? "DANGER",
    parseMode: "HTML",
    ttlMs: err.severity === "platform" ? 20_000 : 10_000,
    replyMarkup: cta
      ? { inline_keyboard: [[{ text: cta.label, callback_data: cta.callback }]] }
      : undefined,
  });
  logger.info(
    { code: err.code, severity: err.severity, meta: err.metadata },
    "telefocus.error.handled",
  );
}

async function handleInternal(ctx: Ctx, err: unknown): Promise<void> {
  logger.error({ err, chat_id: ctx.chatId, user_id: ctx.userId }, "telefocus.error.internal");
  // Never leak err.stack or details — show a generic recovery toast and swallow.
  await toast.danger(ctx, "Something went wrong. Try again in a moment.");
}
