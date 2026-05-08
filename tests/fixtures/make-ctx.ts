import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import type { BotApi, Ctx } from "../../src/interface/telegram/engine/types.ts";

/**
 * Build a `Ctx` for engine unit tests. The session is loaded through a
 * fresh `MemorySessionStore` so it carries the same shape (and version
 * bookkeeping) the engine sees in production.
 */
export async function makeCtx(
  api: BotApi,
  opts: { chatId?: number; userId?: number } = {},
): Promise<Ctx> {
  const chatId = opts.chatId ?? 4242;
  const userId = opts.userId ?? 7;
  const store = new MemorySessionStore();
  const session = await store.load(userId, chatId);
  return {
    api,
    chatId,
    userId,
    session,
    services: {},
  };
}
