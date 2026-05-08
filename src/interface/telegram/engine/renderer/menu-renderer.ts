import { btn } from "../keyboard.ts";
import { ce } from "../messages/custom-emoji.ts";
import { escapeHtml } from "../messages/sanitise.ts";
import { cancelTtlTimer } from "../messages/send.ts";
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
 *     byte-equal re-renders short-circuit before hitting the network,
 *   - lock state: when the session has an active input flow or active
 *     modal, paint a locked body with a single Cancel button instead of
 *     asking the page for its body/keyboard. Modals strictly preempt
 *     input flows.
 */

/** Telegram's stale-id error: `message to edit not found`. */
const NOT_FOUND_NEEDLE = "message to edit not found";

/** Telegram's no-op edit error: `message is not modified`. */
const NOT_MODIFIED_NEEDLE = "message is not modified";

/**
 * Number of fresh non-MENU sends (or captured user-flow inputs) after
 * which the menu is considered scrolled out of view. The next render
 * forces a fresh send at the chat bottom.
 */
const STALENESS_THRESHOLD = 3;

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

interface CommitArgs {
  text: string;
  parseMode: string;
  replyMarkup: InlineKeyboardMarkup;
  /** Page path the rendered MENU message should be tracked under. */
  pagePath: string;
  /** Whether to update `session.menu.currentPage` on success. */
  updateCurrentPage: boolean;
}

interface LockedRenderOpts {
  body: string;
  cancelData: string;
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
   * Discard the tracked menu message (best-effort delete) so the next
   * `renderMenu` call sends a fresh one at the chat bottom. Used by the
   * `/start` handler so users always see a fresh menu after invoking
   * the command, regardless of where in the conversation they were.
   *
   * Idempotent: a no-op when no menu message is tracked. Telegram
   * delete failures (manual deletion by the user, expired bot rights,
   * 48h limit) are forgiven.
   */
  async forceFresh(ctx: Ctx): Promise<void> {
    const messageId = ctx.session.menu.messageId;
    if (messageId !== null) {
      cancelTtlTimer(ctx.chatId, messageId);
      try {
        await ctx.api.deleteMessage(ctx.chatId, messageId);
      } catch {
        // Forgive Telegram failures: user may have deleted manually.
      }
      ctx.session.menu.messageId = null;
    }
    // Drop any cached idempotency entries so the next render does not
    // short-circuit because the cached body matches the previous menu.
    this.#dropCacheForChat(ctx.chatId);
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
    // Staleness check: when the menu has been pushed out of view by
    // chat noise, force a fresh send so the next render lands at the
    // chat bottom. Skipped on the recursion (`retried`) so a stale-id
    // recovery doesn't re-trigger this branch.
    const staleness = ctx.session.menu.staleness ?? 0;
    if (!retried && staleness >= STALENESS_THRESHOLD && ctx.session.menu.messageId !== null) {
      await this.forceFresh(ctx);
      ctx.session.menu.staleness = 0;
      // Fall through — `forceFresh` cleared `messageId`, so the
      // commit path below will send a fresh message at the chat
      // bottom.
    }

    // Lock state: modals strictly preempt input flows. While either lock
    // is active, the menu does not consult the page — it shows a holding
    // body with a single Cancel button instead.
    if (ctx.session.activeModal !== null) {
      await this.#renderLocked(
        ctx,
        {
          body: `${ce("modal-lock")} <i>${escapeHtml(ctx.session.activeModal.title)} is open. Resolve it before continuing.</i>`,
          cancelData: "action:engine:modal:cancel",
        },
        retried,
      );
      return;
    }
    if (ctx.session.inputFlow.active) {
      await this.#renderLocked(
        ctx,
        {
          body: `${ce("flow-lock")} <i>Waiting for your input. Send the value as a message, or tap Cancel.</i>`,
          cancelData: "action:engine:flow:cancel",
        },
        retried,
      );
      return;
    }

    const body = await page.render(ctx);
    const keyboard = await page.keyboard(ctx);
    await this.#commit(
      ctx,
      {
        text: body.text,
        parseMode: body.parseMode ?? "HTML",
        replyMarkup: { inline_keyboard: keyboard },
        pagePath: page.path,
        updateCurrentPage: true,
      },
      retried,
    );
  }

  async #renderLocked(ctx: Ctx, opts: LockedRenderOpts, retried: boolean): Promise<void> {
    const replyMarkup: InlineKeyboardMarkup = {
      inline_keyboard: [[btn("× Cancel", { intent: "cancel", callback_data: opts.cancelData })]],
    };
    await this.#commit(
      ctx,
      {
        text: opts.body,
        parseMode: "HTML",
        replyMarkup,
        // Track under the current page so cleanup stays scoped correctly.
        pagePath: ctx.session.menu.currentPage,
        // Locked renders do NOT change the user's current page — they
        // overlay the existing menu while the lock is held.
        updateCurrentPage: false,
      },
      retried,
    );
  }

  async #commit(ctx: Ctx, args: CommitArgs, retried: boolean): Promise<void> {
    const markupJson = JSON.stringify(args.replyMarkup);
    const existingId = ctx.session.menu.messageId;

    if (existingId == null) {
      const sent = await ctx.api.sendMessage(ctx.chatId, args.text, {
        parse_mode: args.parseMode,
        reply_markup: args.replyMarkup,
      });
      ctx.session.menu.messageId = sent.message_id;
      trackMessage(ctx.session, {
        messageId: sent.message_id,
        type: "MENU",
        pagePath: args.pagePath,
        createdAt: Date.now(),
      });
      this.#cache.set(this.#cacheKey(ctx.chatId, sent.message_id), {
        text: args.text,
        markup: markupJson,
      });
      ctx.session.menu.staleness = 0;
      if (args.updateCurrentPage && ctx.session.menu.currentPage !== args.pagePath) {
        ctx.session.menu.currentPage = args.pagePath;
      }
      return;
    }

    const key = this.#cacheKey(ctx.chatId, existingId);
    const cached = this.#cache.get(key);
    if (cached && cached.text === args.text && cached.markup === markupJson) {
      ctx.session.menu.staleness = 0;
      if (args.updateCurrentPage && ctx.session.menu.currentPage !== args.pagePath) {
        ctx.session.menu.currentPage = args.pagePath;
      }
      return;
    }

    try {
      await ctx.api.editMessageText(ctx.chatId, existingId, args.text, {
        parse_mode: args.parseMode,
        reply_markup: args.replyMarkup,
      });
    } catch (err) {
      if (errorMatches(err, NOT_MODIFIED_NEEDLE)) {
        // Telegram returns 400 when text + markup are byte-equal to the
        // current message. Treat as success and refresh the cache below.
      } else if (errorMatches(err, NOT_FOUND_NEEDLE) && !retried) {
        ctx.session.menu.messageId = null;
        this.#cache.delete(key);
        await this.#commit(ctx, args, true);
        return;
      } else {
        throw err;
      }
    }

    this.#cache.set(key, { text: args.text, markup: markupJson });
    ctx.session.menu.staleness = 0;
    if (args.updateCurrentPage && ctx.session.menu.currentPage !== args.pagePath) {
      ctx.session.menu.currentPage = args.pagePath;
    }
  }

  #cacheKey(chatId: number, messageId: number): string {
    return `${chatId}:${messageId}`;
  }

  /**
   * Drop every idempotency cache entry tied to `chatId`. Called by
   * {@link forceFresh} so the next render is not short-circuited by a
   * byte-equal body still present in the cache.
   */
  #dropCacheForChat(chatId: number): void {
    const prefix = `${chatId}:`;
    for (const key of this.#cache.keys()) {
      if (key.startsWith(prefix)) this.#cache.delete(key);
    }
  }
}
