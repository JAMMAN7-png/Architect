import { trackMessage } from "../messages/tracking.ts";
import { type PageRegistry, defaultRegistry } from "../registry.ts";
import type { SessionStore } from "../session/store.ts";
import {
  type Ctx,
  DopellerError,
  type InlineKeyboardMarkup,
  type PageDefinition,
} from "../types.ts";

/**
 * Menu Message renderer.
 *
 * Owns the single MENU message per (bot, user) chat. All other messaging
 * goes through `messages/send.ts`; the renderer is the only other call
 * site permitted to touch `ctx.api.sendMessage` / `editMessageText` /
 * `editMessageReplyMarkup` directly. See design-system §03.
 *
 * Responsibilities:
 *   - first-render: send a fresh message and stash its id in
 *     `session.menu.messageId`,
 *   - subsequent renders: edit-in-place; on stale-id errors transparently
 *     send a fresh message and retry once,
 *   - swallow Telegram's `message is not modified` 400 as success,
 *   - per-instance idempotency cache keyed by `chatId:menuMessageId` so
 *     byte-equal re-renders short-circuit before hitting the network.
 */

/** Telegram's stale-id error: `message to edit not found`. */
const NOT_FOUND_NEEDLE = "message to edit not found";

/** Telegram's no-op edit error: `message is not modified`. */
const NOT_MODIFIED_NEEDLE = "message is not modified";

/** Defensive substring match against `description` and `message` fields. */
const errorMatches = (err: unknown, needle: string): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const desc = (err as { description?: unknown }).description;
  if (typeof desc === "string" && desc.toLowerCase().includes(needle)) return true;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && msg.toLowerCase().includes(needle);
};

interface RenderCacheEntry {
  text: string;
  markup: string;
}

export class MenuRenderer {
  /** chatId:menuMessageId -> last successfully rendered text + markup JSON. */
  readonly #cache = new Map<string, RenderCacheEntry>();

  constructor(
    public readonly store: SessionStore,
    private readonly registry: PageRegistry = defaultRegistry,
  ) {}

  /**
   * Render `page` onto the menu message. Sends fresh when no id is
   * stored or the prior id has gone stale; otherwise edits in place.
   * Subsequent identical renders short-circuit via the idempotency cache.
   */
  async renderMenu(ctx: Ctx, page: PageDefinition): Promise<void> {
    await this.#render(ctx, page, false);
  }

  /**
   * Re-render the page indicated by `session.menu.currentPage`. Throws
   * `DopellerError('unknown_page', 'user', ...)` if the path is not in
   * the registry.
   */
  async rerender(ctx: Ctx): Promise<void> {
    const path = ctx.session.menu.currentPage;
    const page = this.registry.get(path);
    if (!page) {
      throw new DopellerError("unknown_page", "user", `unknown_page:${path}`, { path });
    }
    await this.renderMenu(ctx, page);
  }

  /**
   * Edit only the inline keyboard on the current menu message. Telegram
   * rate-limits text edits more aggressively than markup-only edits, so
   * callers that change just the keyboard (toggles, selections) should
   * prefer this over a full re-render.
   */
  async editKeyboardOnly(ctx: Ctx, markup: InlineKeyboardMarkup): Promise<void> {
    const messageId = ctx.session.menu.messageId;
    if (messageId == null) {
      throw new DopellerError("unknown_page", "internal", "no_menu_message_id");
    }
    const key = this.#cacheKey(ctx.chatId, messageId);
    const markupJson = JSON.stringify(markup);
    const cached = this.#cache.get(key);
    if (cached && cached.markup === markupJson) return;
    try {
      await ctx.api.editMessageReplyMarkup(ctx.chatId, messageId, { reply_markup: markup });
    } catch (err) {
      if (!errorMatches(err, NOT_MODIFIED_NEEDLE)) throw err;
    }
    this.#cache.set(key, { text: cached?.text ?? "", markup: markupJson });
  }

  async #render(ctx: Ctx, page: PageDefinition, retried: boolean): Promise<void> {
    const body = await page.render(ctx);
    const keyboard = await page.keyboard(ctx);
    const replyMarkup: InlineKeyboardMarkup = { inline_keyboard: keyboard };
    const parseMode = body.parseMode ?? "HTML";
    const markupJson = JSON.stringify(replyMarkup);

    const existingId = ctx.session.menu.messageId;

    if (existingId == null) {
      const sent = await ctx.api.sendMessage(ctx.chatId, body.text, {
        parse_mode: parseMode,
        reply_markup: replyMarkup,
      });
      ctx.session.menu.messageId = sent.message_id;
      trackMessage(ctx.session, {
        messageId: sent.message_id,
        type: "MENU",
        pagePath: page.path,
        createdAt: Date.now(),
      });
      this.#cache.set(this.#cacheKey(ctx.chatId, sent.message_id), {
        text: body.text,
        markup: markupJson,
      });
      if (ctx.session.menu.currentPage !== page.path) {
        ctx.session.menu.currentPage = page.path;
      }
      return;
    }

    const key = this.#cacheKey(ctx.chatId, existingId);
    const cached = this.#cache.get(key);
    if (cached && cached.text === body.text && cached.markup === markupJson) {
      if (ctx.session.menu.currentPage !== page.path) {
        ctx.session.menu.currentPage = page.path;
      }
      return;
    }

    try {
      await ctx.api.editMessageText(ctx.chatId, existingId, body.text, {
        parse_mode: parseMode,
        reply_markup: replyMarkup,
      });
    } catch (err) {
      if (errorMatches(err, NOT_MODIFIED_NEEDLE)) {
        // Telegram returns 400 when text + markup are byte-equal to the
        // current message. Treat as success and refresh the cache below.
      } else if (errorMatches(err, NOT_FOUND_NEEDLE) && !retried) {
        ctx.session.menu.messageId = null;
        this.#cache.delete(key);
        await this.#render(ctx, page, true);
        return;
      } else {
        throw err;
      }
    }

    this.#cache.set(key, { text: body.text, markup: markupJson });
    if (ctx.session.menu.currentPage !== page.path) {
      ctx.session.menu.currentPage = page.path;
    }
  }

  #cacheKey(chatId: number, messageId: number): string {
    return `${chatId}:${messageId}`;
  }
}
