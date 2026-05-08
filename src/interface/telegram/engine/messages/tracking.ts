import { logger } from "../../../../util/logger.ts";
import type { Ctx, TrackedMessage, UserSession } from "../types.ts";

/**
 * Page-scoped tracked-message bookkeeping.
 *
 * The session keeps a `Record<scope, TrackedMessage[]>` so the engine can:
 *   - find a prior matching ephemeral to edit (one-per-subtype rule),
 *   - delete every non-MENU message belonging to a page on exit,
 *   - garbage-collect TTL-expired entries lazily during middleware.
 *
 * These helpers are pure on the session object (no I/O) except
 * `cleanupScope`, which talks to Telegram via `ctx.api.deleteMessage`.
 *
 * Design ref: docs/design-system/04-messages.md.
 */

/**
 * Append `msg` to `session.messages[msg.pagePath]`, initialising the
 * scope array if needed. Bumps `lastInteractionAt` to mark the session
 * as dirty so the persistence layer will write it on the next flush.
 */
export function trackMessage(session: UserSession, msg: TrackedMessage): void {
  const list = session.messages[msg.pagePath];
  if (list) {
    list.push(msg);
  } else {
    session.messages[msg.pagePath] = [msg];
  }
  session.lastInteractionAt = Date.now();
}

/**
 * Return the first tracked message in `scope` for which `predicate`
 * returns true, or `undefined` if no entry matches (or the scope is
 * empty).
 */
export function findInScope(
  session: UserSession,
  scope: string,
  predicate: (m: TrackedMessage) => boolean,
): TrackedMessage | undefined {
  const list = session.messages[scope];
  if (!list) return undefined;
  return list.find(predicate);
}

/**
 * Remove the first entry in `scope` whose `messageId` matches. No-op
 * when the scope or matching entry is absent. Drops the scope key
 * entirely once the array is empty so iteration order over
 * `session.messages` stays meaningful.
 */
export function untrackMessage(session: UserSession, scope: string, messageId: number): void {
  const list = session.messages[scope];
  if (!list) return;
  const idx = list.findIndex((m) => m.messageId === messageId);
  if (idx < 0) return;
  list.splice(idx, 1);
  if (list.length === 0) delete session.messages[scope];
}

/**
 * Delete every non-MENU message currently tracked under `scope` from
 * the chat, then drop the scope key from the session.
 *
 * Telegram delete failures are forgiven — users can manually delete
 * messages, and the design system explicitly classifies a failed
 * `deleteMessage` as benign (see §04 "Failure modes" table).
 *
 * MENU messages are skipped (the navigation layer owns them and
 * edit-rerenders rather than re-creating them), but the scope key is
 * still removed afterwards: callers expecting MENU survival must track
 * it under a different scope (typically the next page's path).
 */
export async function cleanupScope(ctx: Ctx, scope: string): Promise<void> {
  const list = ctx.session.messages[scope];
  if (!list || list.length === 0) {
    delete ctx.session.messages[scope];
    return;
  }
  for (const m of list) {
    if (m.type === "MENU") continue;
    try {
      await ctx.api.deleteMessage(ctx.chatId, m.messageId);
    } catch (err) {
      logger.debug(
        { err, scope, messageId: m.messageId },
        "deleteMessage forgiven during cleanupScope",
      );
    }
  }
  delete ctx.session.messages[scope];
}

/**
 * Sweep every scope in `session.messages`, dropping entries whose
 * `expiresAt` is at or before `now`. Empty scopes are removed.
 *
 * Pure on the session — does not delete the underlying Telegram
 * messages. The design relies on Telegram's auto-fade for ephemerals
 * (the user sees them, the bot's session simply forgets them once
 * past TTL). The lazy-cleanup middleware calls this on every update.
 */
export function dropExpiredMessages(session: UserSession, now: number = Date.now()): void {
  for (const scope of Object.keys(session.messages)) {
    const list = session.messages[scope];
    if (!list) continue;
    const filtered = list.filter((m) => !(m.expiresAt !== undefined && m.expiresAt <= now));
    if (filtered.length === 0) {
      delete session.messages[scope];
    } else if (filtered.length !== list.length) {
      session.messages[scope] = filtered;
    }
  }
}
