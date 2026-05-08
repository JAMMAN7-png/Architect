import { logger } from "../../../../util/logger.ts";
import { modal } from "../messages/modal.ts";
import { untrackMessage } from "../messages/tracking.ts";
import type { Ctx } from "../types.ts";
import { type NavigateDeps, navigateTo } from "./navigate.ts";

/**
 * Navigation guard.
 *
 * Triggered when the current page reports `hasUnsavedWork`. The router
 * defers to {@link openNavigationGuard}, which records the pending
 * destination on the session and presents an `INTERACTIVE/CONFIRMATION`
 * modal. The dispatcher routes the resulting `guard:stay` /
 * `guard:leave` callbacks back into {@link resolveNavigationGuard}.
 *
 * See design-system §06-navigation.
 */

/** Reset the guard slot to its inert/default state. */
function clearGuard(ctx: Ctx): void {
  ctx.session.navigationGuard = {
    active: false,
    pendingDestination: null,
    confirmationMessageId: null,
  };
}

/** Reset the input-flow slot to its inert/default state. */
function clearInputFlow(ctx: Ctx): void {
  ctx.session.inputFlow = {
    active: false,
    pagePath: null,
    flowId: null,
    currentStep: 0,
    totalSteps: 0,
    collectedData: {},
    promptMessageId: null,
    progressMessageId: null,
    awaitingInput: false,
    inputType: null,
    validationRules: null,
    retries: 0,
  };
}

/**
 * Best-effort dismissal of the confirmation message: untrack the entry
 * locally and ask Telegram to delete it. Failed deletes are forgiven —
 * users may have removed the message themselves, and the design treats
 * a stray deleteMessage error as benign (§04 "Failure modes").
 */
async function dismissConfirmation(ctx: Ctx, scope: string, messageId: number): Promise<void> {
  untrackMessage(ctx.session, scope, messageId);
  try {
    await ctx.api.deleteMessage(ctx.chatId, messageId);
  } catch (err) {
    logger.debug({ err, scope, messageId }, "deleteMessage forgiven during guard resolution");
  }
}

/**
 * Open the unsaved-work confirmation modal.
 *
 * Records the pending destination and the modal's message ID on
 * `session.navigationGuard` so the subsequent `guard:stay` /
 * `guard:leave` callback can resolve the deferred navigation. The
 * session is persisted so a crash between the modal send and the next
 * callback does not strand the user mid-decision.
 */
export async function openNavigationGuard(
  ctx: Ctx,
  target: string,
  deps: NavigateDeps,
): Promise<void> {
  ctx.session.navigationGuard = {
    active: true,
    pendingDestination: target,
    confirmationMessageId: null,
  };

  const tracked = await modal.confirm(ctx, {
    title: "Unsaved changes",
    body: "Leave and lose them?",
    confirmLabel: "🗑 Leave",
    confirmCallback: "guard:leave",
    cancelLabel: "← Stay",
    cancelCallback: "guard:stay",
    confirmColor: "destructive",
  });

  ctx.session.navigationGuard.confirmationMessageId = tracked.messageId;
  await deps.store.save(ctx.session);
}

/**
 * Resolve the open navigation guard.
 *
 * - `stay`  — clear the guard, dismiss the confirmation message, and
 *             re-render the current page.
 * - `leave` — fire the active input-flow's `onCancel` (if any), reset
 *             flow state, clear the guard, and `navigateTo` the captured
 *             pending destination (falling back to `/`).
 *
 * `navigateTo` performs its own version-guarded persistence on the
 * `leave` branch; the `stay` branch saves directly.
 */
export async function resolveNavigationGuard(
  ctx: Ctx,
  decision: "stay" | "leave",
  deps: NavigateDeps,
): Promise<void> {
  const { pendingDestination, confirmationMessageId } = ctx.session.navigationGuard;
  const scope = ctx.session.menu.currentPage;

  if (decision === "stay") {
    clearGuard(ctx);
    if (confirmationMessageId !== null) {
      await dismissConfirmation(ctx, scope, confirmationMessageId);
    }
    await deps.renderer.rerender(ctx);
    await deps.store.save(ctx.session);
    return;
  }

  // decision === "leave"
  const flowState = ctx.session.inputFlow;
  if (flowState.active) {
    const def = deps.registry.get(scope);
    const flow = def?.inputFlow;
    if (flow?.onCancel) {
      try {
        await flow.onCancel(flowState.collectedData, ctx);
      } catch (err) {
        logger.warn(
          { err, flowId: flowState.flowId, pagePath: scope },
          "input-flow onCancel threw during guard:leave",
        );
      }
    }
  }

  clearInputFlow(ctx);

  if (confirmationMessageId !== null) {
    await dismissConfirmation(ctx, scope, confirmationMessageId);
  }

  clearGuard(ctx);

  await navigateTo(ctx, pendingDestination ?? "/", deps);
}
