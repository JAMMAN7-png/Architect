import { logger } from "../../../../util/logger.ts";
import type { Ctx, InlineKeyboardButton, TrackedMessage } from "../types.ts";
import { escapeHtml } from "./sanitise.ts";
import { send } from "./send.ts";

/**
 * Modal helpers — interactive confirmations rendered as `INTERACTIVE`
 * messages with a two-row inline keyboard. Action resolution happens
 * later in the action-dispatcher middleware; this module is concerned
 * solely with rendering and dismissal.
 *
 * Design ref: docs/design-system/07-toasts-modals.md.
 */

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  /** Defaults to `"← Cancel"`. */
  cancelLabel?: string;
  /** e.g. `"guard:leave"` or `"action:foo:confirm"`. */
  confirmCallback: string;
  /** Defaults to `"action:modal:cancel"`. */
  cancelCallback?: string;
  confirmColor?: "primary" | "positive" | "destructive";
  scope?: string;
}

/**
 * Delete every `INTERACTIVE` message currently tracked under `scope`
 * (default: current page). Telegram failures are forgiven — modals can
 * race with manual user deletes, and the design treats a failed
 * `deleteMessage` as benign.
 */
export async function dismissModalsInScope(ctx: Ctx, scope?: string): Promise<void> {
  const target = scope ?? ctx.session.menu.currentPage;
  const list = ctx.session.messages[target];
  if (!list || list.length === 0) return;

  const remaining: TrackedMessage[] = [];
  for (const m of list) {
    if (m.type !== "INTERACTIVE") {
      remaining.push(m);
      continue;
    }
    try {
      await ctx.api.deleteMessage(ctx.chatId, m.messageId);
    } catch (err) {
      logger.debug(
        { err, scope: target, messageId: m.messageId },
        "deleteMessage forgiven during dismissModalsInScope",
      );
    }
  }

  if (remaining.length === 0) {
    delete ctx.session.messages[target];
  } else {
    ctx.session.messages[target] = remaining;
  }
}

/**
 * Render a confirmation modal. The title is rendered bold (HTML `<b>`),
 * followed by a blank line then the body. Both inputs flow through
 * `escapeHtml` so callers never need to sanitise.
 *
 * Pre-existing modals in the same scope are dismissed first — the
 * design system disallows stacked modals (§07-toasts-modals.md).
 *
 * The returned `TrackedMessage` is informational; callers do not need
 * to retain it. Resolution is wired by the action dispatcher matching
 * `confirmCallback` / `cancelCallback` payloads.
 */
const confirmModal = async (ctx: Ctx, opts: ConfirmOptions): Promise<TrackedMessage> => {
  const scope = opts.scope ?? ctx.session.menu.currentPage;
  await dismissModalsInScope(ctx, scope);

  const cancelLabel = opts.cancelLabel ?? "← Cancel";
  const cancelCallback = opts.cancelCallback ?? "action:modal:cancel";

  const text = `<b>${escapeHtml(opts.title)}</b>\n\n${escapeHtml(opts.body)}`;
  const keyboard: InlineKeyboardButton[][] = [
    [{ text: opts.confirmLabel, callback_data: opts.confirmCallback }],
    [{ text: cancelLabel, callback_data: cancelCallback }],
  ];

  return send(ctx, text, {
    type: "INTERACTIVE",
    subtype: "CONFIRMATION",
    parseMode: "HTML",
    scope,
    replyMarkup: { inline_keyboard: keyboard },
    metadata: opts.confirmColor !== undefined ? { confirmColor: opts.confirmColor } : undefined,
  });
};

export const modal: { confirm(ctx: Ctx, opts: ConfirmOptions): Promise<TrackedMessage> } = {
  confirm: confirmModal,
};
