import type { Api, Bot, Context as GrammyContext } from "grammy";

/**
 * Tiny in-memory grammY stand-in for E2E tests.
 *
 * `FakeBot` replicates the subset of the `Bot` surface our adapter
 * consumes (`command`, `callbackQuery`, `on`, `use`) plus an `inject`
 * helper that simulates an incoming update by dispatching against
 * registered handlers in grammY's natural priority order:
 *
 *   1. `command(<name>, ...)` — exact match against `/<name>` text.
 *   2. `callbackQuery(<string|RegExp>, ...)` against `cb.data`.
 *   3. catch-all `use(...)` middlewares.
 *
 * The first matching handler that completes without throwing wins;
 * subsequent handlers are NOT invoked. Each handler receives a no-op
 * `next` continuation: our middleware happens to call it once and
 * returns; the dispatcher does not chain.
 *
 * The fake is deliberately strict — it builds only the structural slice
 * of `GrammyContext` that the production adapter / action handlers read:
 *
 *   - `api` (the {@link StubBotApi} cast to grammY's `Api`)
 *   - `from`
 *   - `chat`
 *   - `message?.{ text, message_id }`
 *   - `callbackQuery?.{ id, data }`
 *   - `match`
 *   - `answerCallbackQuery()` shortcut
 *
 * Anything else throws a TypeError if accessed, which keeps test bugs
 * loud rather than silently no-op.
 */

export type FakeMessageUpdate = { message: { text: string } };
export type FakeCallbackUpdate = { callbackQuery: { data: string } };
export type FakeUpdate = FakeMessageUpdate | FakeCallbackUpdate;

export interface FakeOrigin {
  from: { id: number };
  chat: { id: number };
}

type Handler = (ctx: GrammyContext, next: () => Promise<void>) => unknown | Promise<unknown>;

interface CallbackEntry {
  pattern: string | RegExp;
  handler: Handler;
}

/**
 * Stub grammY `Api`. Implements the subset our `buildBotApi` consumes
 * (`sendMessage`, `editMessageText`, `editMessageReplyMarkup`,
 * `deleteMessage`, `answerCallbackQuery`, `sendChatAction`). All methods
 * are no-ops aside from `sendMessage`, which mints a unique
 * `message_id` so the renderer can track menu messages.
 */
export class StubBotApi {
  #nextId = 1000;
  readonly sentMessages: Array<{ chatId: number; text: string }> = [];
  readonly editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  readonly deletedMessages: Array<{ chatId: number; messageId: number }> = [];

  /** Mint and return a fresh, monotonically increasing message id. */
  nextMessageId(): number {
    return this.#nextId++;
  }

  async sendMessage(chatId: number, text: string): Promise<{ message_id: number }> {
    const message_id = this.nextMessageId();
    this.sentMessages.push({ chatId, text });
    return { message_id };
  }

  async editMessageText(chatId: number, messageId: number, text: string): Promise<true> {
    this.editedMessages.push({ chatId, messageId, text });
    return true;
  }

  async editMessageReplyMarkup(): Promise<true> {
    return true;
  }

  async deleteMessage(chatId: number, messageId: number): Promise<true> {
    this.deletedMessages.push({ chatId, messageId });
    return true;
  }

  async answerCallbackQuery(): Promise<true> {
    return true;
  }

  async sendChatAction(): Promise<true> {
    return true;
  }
}

/**
 * In-memory grammY-shaped bot for E2E tests. Cast to `Bot` via
 * {@link FakeBot.asBot} (or `as unknown as Bot`) wherever the production
 * code expects a real grammY bot.
 */
export class FakeBot {
  readonly api: Api;
  readonly stubApi: StubBotApi;
  readonly #commands = new Map<string, Handler>();
  readonly #callbackHandlers: CallbackEntry[] = [];
  readonly #middlewares: Handler[] = [];
  #cbqCounter = 0;

  constructor() {
    this.stubApi = new StubBotApi();
    this.api = this.stubApi as unknown as Api;
  }

  /** Cast helper — keeps the `as unknown as Bot` ceremony in one place. */
  asBot(): Bot {
    return this as unknown as Bot;
  }

  command(name: string, handler: Handler): void {
    this.#commands.set(name, handler);
  }

  callbackQuery(pattern: string | RegExp, handler: Handler): void {
    this.#callbackHandlers.push({ pattern, handler });
  }

  on(_event: string, handler: Handler): void {
    this.#middlewares.push(handler);
  }

  use(handler: Handler): void {
    this.#middlewares.push(handler);
  }

  /**
   * Simulate an incoming update. Builds a fake grammY context and
   * dispatches against the first matching `command` / `callbackQuery`
   * handler, falling through to catch-all `use` middlewares when none
   * match.
   *
   * Tests should `await` injects sequentially — the dispatcher does not
   * serialise concurrent calls.
   */
  async inject(update: FakeUpdate, origin: FakeOrigin): Promise<void> {
    const baseCtx = this.#buildBaseContext(origin);

    if ("message" in update) {
      const text = update.message.text;
      (baseCtx as { message?: unknown }).message = {
        text,
        message_id: this.stubApi.nextMessageId(),
        from: origin.from,
        chat: { ...origin.chat, type: "private" as const },
        date: 0,
      };

      const cmd = text.match(/^\/([A-Za-z0-9_]+)(?:\s+(.*))?$/);
      if (cmd) {
        const name = cmd[1] ?? "";
        const handler = this.#commands.get(name);
        if (handler) {
          (baseCtx as { match: string }).match = cmd[2] ?? "";
          await handler(baseCtx as unknown as GrammyContext, noopNext);
          return;
        }
      }
    } else {
      const data = update.callbackQuery.data;
      this.#cbqCounter += 1;
      (baseCtx as { callbackQuery?: unknown }).callbackQuery = {
        id: `cbq:${this.#cbqCounter}`,
        from: origin.from,
        chat_instance: "fake-chat-instance",
        data,
      };

      for (const entry of this.#callbackHandlers) {
        if (typeof entry.pattern === "string") {
          if (data === entry.pattern) {
            (baseCtx as { match: string }).match = data;
            await entry.handler(baseCtx as unknown as GrammyContext, noopNext);
            return;
          }
        } else {
          const m = entry.pattern.exec(data);
          if (m !== null) {
            (baseCtx as { match: RegExpExecArray }).match = m;
            await entry.handler(baseCtx as unknown as GrammyContext, noopNext);
            return;
          }
        }
      }
    }

    // Catch-all: invoke registered middlewares with a no-op `next`.
    // Stop after the first middleware returns — our pipeline is a single
    // self-contained chain that does not delegate to siblings.
    for (const mw of this.#middlewares) {
      await mw(baseCtx as unknown as GrammyContext, noopNext);
      return;
    }
  }

  #buildBaseContext(origin: FakeOrigin): Record<string, unknown> {
    const stubApi = this.stubApi;
    const ctx: Record<string, unknown> = {
      api: this.api,
      from: origin.from,
      chat: { ...origin.chat, type: "private" as const },
      // grammY exposes `ctx.answerCallbackQuery()` as a thin shortcut over
      // `ctx.api.answerCallbackQuery(ctx.callbackQuery.id, ...)`. Replicate
      // it so action handlers' `silenceSpinner` helpers work unchanged.
      async answerCallbackQuery(opts?: unknown): Promise<true> {
        const self = ctx as { callbackQuery?: { id: string } };
        if (self.callbackQuery !== undefined) {
          await stubApi.answerCallbackQuery();
        }
        return true;
      },
    };
    return ctx;
  }
}

const noopNext = (): Promise<void> => Promise.resolve();
