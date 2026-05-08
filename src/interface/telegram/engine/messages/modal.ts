import { logger } from "../../../../util/logger.ts";
import type { Ctx, InlineKeyboardButton, TrackedMessage, UserSession } from "../types.ts";
import { ce } from "./custom-emoji.ts";
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
 * Clear `session.activeModal`. Idempotent. Exposed so action handlers
 * (e.g. modal cancel/confirm) can release the renderer's lock state
 * without going through {@link dismissModalsInScope}.
 */
export function dismissActiveModal(session: UserSession): void {
  session.activeModal = null;
}

/**
 * Delete every `INTERACTIVE` message currently tracked under `scope`
 * (default: current page). Telegram failures are forgiven — modals can
 * race with manual user deletes, and the design treats a failed
 * `deleteMessage` as benign. If the dismissed scope hosted
 * `session.activeModal`, that field is cleared too.
 */
export async function dismissModalsInScope(ctx: Ctx, scope?: string): Promise<void> {
  const target = scope ?? ctx.session.menu.currentPage;
  const list = ctx.session.messages[target];
  if (!list || list.length === 0) {
    if (ctx.session.activeModal !== null && ctx.session.activeModal.scope === target) {
      dismissActiveModal(ctx.session);
    }
    return;
  }

  const dismissedIds: number[] = [];
  const remaining: TrackedMessage[] = [];
  for (const m of list) {
    if (m.type !== "INTERACTIVE") {
      remaining.push(m);
      continue;
    }
    dismissedIds.push(m.messageId);
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

  const active = ctx.session.activeModal;
  if (active !== null && (active.scope === target || dismissedIds.includes(active.messageId))) {
    dismissActiveModal(ctx.session);
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
 * On a successful send, `session.activeModal` is set so the menu
 * renderer's lock state can preempt the underlying page until the modal
 * resolves. Callers that resolve the modal via a non-dismiss path must
 * call {@link dismissActiveModal} (or route the dismissal through
 * {@link dismissModalsInScope}).
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

  const text = `${ce("modal-lock")} <b>${escapeHtml(opts.title)}</b>\n\n${escapeHtml(opts.body)}`;
  const keyboard: InlineKeyboardButton[][] = [
    [{ text: opts.confirmLabel, callback_data: opts.confirmCallback }],
    [{ text: cancelLabel, callback_data: cancelCallback }],
  ];

  const tracked = await send(ctx, text, {
    type: "INTERACTIVE",
    subtype: "CONFIRMATION",
    parseMode: "HTML",
    scope,
    replyMarkup: { inline_keyboard: keyboard },
    metadata: opts.confirmColor !== undefined ? { confirmColor: opts.confirmColor } : undefined,
  });

  ctx.session.activeModal = {
    scope,
    messageId: tracked.messageId,
    title: opts.title,
  };

  const nav = (ctx.services as { nav?: { renderer?: { rerender(ctx: Ctx): Promise<void> } } }).nav;
  if (nav?.renderer?.rerender !== undefined) {
    try {
      await nav.renderer.rerender(ctx);
    } catch {
      // Forgiveable: failure to rerender the lock body should not
      // block the modal from opening.
    }
  }

  return tracked;
};

export const modal: { confirm(ctx: Ctx, opts: ConfirmOptions): Promise<TrackedMessage> } = {
  confirm: confirmModal,
};
