import { dropExpiredMessages } from "../messages/tracking.ts";
import type { SessionStore } from "../session/store.ts";
import type { Middleware } from "./types.ts";

/**
 * Session-loader middleware factory (design-system §10.3).
 *
 * Rehydrates the user session from the supplied {@link SessionStore},
 * opportunistically sweeps expired ephemeral entries, attaches the
 * session to `ctx`, and bumps `lastInteractionAt` so the persistence
 * layer will write it on the next flush.
 *
 * The bootstrap is responsible for populating `ctx.userId` and
 * `ctx.chatId` before the pipeline runs; this middleware reads them
 * verbatim and does not re-derive identity from the raw update.
 */
export function makeSessionLoader(store: SessionStore): Middleware {
  return async (ctx, next) => {
    const session = await store.load(ctx.userId, ctx.chatId);
    dropExpiredMessages(session);
    ctx.session = session;
    session.lastInteractionAt = Date.now();
    await next();
  };
}
