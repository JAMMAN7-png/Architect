import type { BotApi } from "../../src/interface/telegram/engine/types.ts";

/**
 * Minimal `BotApi` stub for unit tests. Records every call into `history`,
 * returns auto-incrementing `message_id`s starting at 100, and lets tests
 * inject one-shot failures via `failNext(method, error)`.
 *
 * `last(method)` returns the most recent call's args for the given method
 * (or `undefined` if it has never been invoked).
 */

export interface StubCall {
  method: string;
  args: unknown[];
}

type BotApiMethod = keyof BotApi;

export class StubBotApi implements BotApi {
  readonly history: StubCall[] = [];

  #nextMessageId = 100;
  readonly #failures = new Map<BotApiMethod, Error[]>();

  /** Force the next invocation of `method` to throw `error`. Stacked FIFO. */
  failNext(method: BotApiMethod, error: Error): void {
    const queue = this.#failures.get(method);
    if (queue) {
      queue.push(error);
    } else {
      this.#failures.set(method, [error]);
    }
  }

  /** Most recent recorded args for `method`, or `undefined`. */
  last(method: BotApiMethod): unknown[] | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i];
      if (entry !== undefined && entry.method === method) return entry.args;
    }
    return undefined;
  }

  /** All calls for `method`, in chronological order. */
  calls(method: BotApiMethod): StubCall[] {
    return this.history.filter((c) => c.method === method);
  }

  async sendMessage(
    chatId: number,
    text: string,
    opts?: Record<string, unknown>,
  ): Promise<{ message_id: number }> {
    this.#record("sendMessage", [chatId, text, opts]);
    this.#maybeFail("sendMessage");
    const message_id = this.#nextMessageId++;
    return { message_id };
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: Record<string, unknown>,
  ): Promise<unknown> {
    this.#record("editMessageText", [chatId, messageId, text, opts]);
    this.#maybeFail("editMessageText");
    return true;
  }

  async editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    opts?: Record<string, unknown>,
  ): Promise<unknown> {
    this.#record("editMessageReplyMarkup", [chatId, messageId, opts]);
    this.#maybeFail("editMessageReplyMarkup");
    return true;
  }

  async deleteMessage(chatId: number, messageId: number): Promise<unknown> {
    this.#record("deleteMessage", [chatId, messageId]);
    this.#maybeFail("deleteMessage");
    return true;
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    opts?: Record<string, unknown>,
  ): Promise<unknown> {
    this.#record("answerCallbackQuery", [callbackQueryId, opts]);
    this.#maybeFail("answerCallbackQuery");
    return true;
  }

  async sendChatAction(chatId: number, action: string): Promise<unknown> {
    this.#record("sendChatAction", [chatId, action]);
    this.#maybeFail("sendChatAction");
    return true;
  }

  #record(method: BotApiMethod, args: unknown[]): void {
    this.history.push({ method, args });
  }

  #maybeFail(method: BotApiMethod): void {
    const queue = this.#failures.get(method);
    if (!queue || queue.length === 0) return;
    const err = queue.shift();
    if (queue.length === 0) this.#failures.delete(method);
    if (err) throw err;
  }
}
