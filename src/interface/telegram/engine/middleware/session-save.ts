import { logger } from "../../../../util/logger.ts";
import type { SessionStore } from "../session/store.ts";
import type { Middleware } from "./types.ts";

/**
 * Session-save middleware factory (design-system §10.12).
 *
 * Persists the session through the version-guarded
 * {@link SessionStore.save} after the downstream chain has run. On a
 * version-conflict (the store returns `false`) we log a single warning
 * and do **not** retry here — concurrent-write retries are owned by the
 * action site that mutated the session. The middleware deliberately
 * stays silent on success so the hot path stays log-light.
 */
export function makeSessionSave(store: SessionStore): Middleware {
  return async (ctx, next) => {
    await next();
    const saved = await store.save(ctx.session);
    if (!saved) {
      logger.warn(
        {
          chatId: ctx.session.chatId,
          userId: ctx.session.userId,
          version: ctx.session.version,
        },
        "session-save: version conflict; retry handled at action site",
      );
    }
  };
}
