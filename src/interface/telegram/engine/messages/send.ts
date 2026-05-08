import type {
  BotApi,
  Ctx,
  MessageSubtype,
  SendOptions,
  TrackedMessage,
  UserSession,
} from "../types.ts";
import { ce, ceText } from "./custom-emoji.ts";
import { trackMessage, untrackMessage } from "./tracking.ts";

/**
 * Typed message send layer.
 *
 * Every outbound chat message in the engine flows through `send` (or its
 * `replacePrevious` sibling). This is the single chokepoint that:
 *   - applies default TTLs and icons for ephemeral subtypes,
 *   - implements the "one ephemeral per subtype per scope" rule by
 *     editing a prior matching message in place when present,
 *   - records the result as a `TrackedMessage` keyed by page scope so
 *     the cleanup, replacement, and TTL machinery has something to act
 *     on.
 *
 * Handlers must NOT call `ctx.api.sendMessage` directly; the menu
 * renderer owns MENU messages and is the only other allowed path.
 *
 * Design ref: docs/design-system/04-messages.md, §07-toasts-modals.md.
 */

type EphemeralSubtype = "INFO" | "WARNING" | "DANGER";

/** Auto-applied TTLs for `EPHEMERAL` subtypes when no `ttlMs` is given. */
export const DEFAULT_TTL: Record<EphemeralSubtype, number> = {
  INFO: 3000,
  WARNING: 5000,
  DANGER: 10000,
};

/**
 * Icons auto-prepended to ephemeral copy unless `metadata.noIcon` is set.
 *
 * Re-exported as plain glyphs (sourced from {@link ceText}) so existing
 * callers and tests that import this constant continue to see human
 * Unicode glyphs even when a Telegram custom-emoji id is configured.
 * The actual body prefix in `buildFinalText` uses {@link ce} so the
 * rendered message benefits from premium custom emoji when available.
 */
export const DEFAULT_ICON: Record<EphemeralSubtype, string> = {
  INFO: ceText("success"),
  WARNING: ceText("warning"),
  DANGER: ceText("error"),
};

const isEphemeralSubtype = (s: MessageSubtype | undefined): s is EphemeralSubtype =>
  s === "INFO" || s === "WARNING" || s === "DANGER";

/**
 * Telegram returns the literal string `message to edit not found`
 * (case-sensitive in practice, but we match defensively) inside the
 * `description` field of `TelegramError`. Some grammY wrappers surface
 * it through `.message` instead; check both.
 */
const isMessageNotFoundError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const needle = "message to edit not found";
  const desc = (err as { description?: unknown }).description;
  if (typeof desc === "string" && desc.toLowerCase().includes(needle)) return true;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && msg.toLowerCase().includes(needle);
};

const buildFinalText = (text: string, opts: SendOptions): string => {
  if (opts.type !== "EPHEMERAL") return text;
  if (!isEphemeralSubtype(opts.subtype)) return text;
  if (opts.metadata?.noIcon === true) return text;
  const intent =
    opts.subtype === "INFO" ? "success" : opts.subtype === "WARNING" ? "warning" : "error";
  return `${ce(intent)} ${text}`;
};

const resolveTtlMs = (opts: SendOptions): number | undefined => {
  if (opts.ttlMs !== undefined) return opts.ttlMs;
  if (opts.type === "EPHEMERAL" && isEphemeralSubtype(opts.subtype)) {
    return DEFAULT_TTL[opts.subtype];
  }
  return undefined;
};

/**
 * Whether the call should attempt an in-place edit of a prior matching
 * tracked message. Ephemerals default to true and can be opted out
 * with `replacePrevious: false`; other types must opt in explicitly
 * (used by input-flow re-renders and similar one-per-scope artefacts).
 */
const shouldReplace = (opts: SendOptions): boolean => {
  if (opts.replacePrevious === true) return true;
  if (opts.replacePrevious === false) return false;
  return opts.type === "EPHEMERAL";
};

/**
 * Module-level scheduler for ephemeral-message TTL eviction.
 *
 * When `send()` records a `TrackedMessage` with an `expiresAt`, this
 * layer schedules a `setTimeout` to:
 *   1. delete the chat message (best-effort),
 *   2. drop the entry from `session.messages[scope]`,
 *   3. flush the session via `ctx.services.nav.store` if available.
 *
 * Timers are keyed by `${chatId}:${messageId}` so an in-place edit of
 * a tracked message can refresh — or cancel — its eviction without
 * leaking the original timer. Captured state is intentionally narrow
 * (api, chatId, session, optional store) so a long TTL does not pin
 * the full `Ctx` graph in memory.
 */

type CapturedCtx = {
  api: BotApi;
  chatId: number;
  session: UserSession;
};

type TtlDeleter = (chatId: number, messageId: number, ctx: Ctx) => Promise<void>;

interface NavStoreLike {
  save(session: UserSession): Promise<boolean>;
}

const ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();

const defaultDeleter: TtlDeleter = async (chatId, messageId, ctx) => {
  await ctx.api.deleteMessage(chatId, messageId);
};

let activeDeleter: TtlDeleter = defaultDeleter;

const ttlKey = (chatId: number, messageId: number): string => `${chatId}:${messageId}`;

function readNavStore(ctx: Ctx): NavStoreLike | undefined {
  const services = ctx.services as { nav?: { store?: NavStoreLike } };
  return services.nav?.store;
}

/** Cancel any pending TTL eviction for `(chatId, messageId)`. */
export function cancelTtlTimer(chatId: number, messageId: number): void {
  const key = ttlKey(chatId, messageId);
  const timer = ttlTimers.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  ttlTimers.delete(key);
}

/**
 * Test seam: replace the deleter (defaults to
 * `(_, _, ctx) => ctx.api.deleteMessage(...)`). Pass `null` to restore
 * the default.
 */
export function __setTtlDeleterForTests(
  fn: ((chatId: number, messageId: number, ctx: Ctx) => Promise<void>) | null,
): void {
  activeDeleter = fn ?? defaultDeleter;
}

function scheduleTtl(ctx: Ctx, tracked: TrackedMessage): void {
  const { messageId, expiresAt, pagePath } = tracked;
  const chatId = ctx.chatId;
  cancelTtlTimer(chatId, messageId);
  if (expiresAt === undefined) return;
  const captured: CapturedCtx = {
    api: ctx.api,
    chatId,
    session: ctx.session,
  };
  const store = readNavStore(ctx);
  const key = ttlKey(chatId, messageId);
  const delay = Math.max(0, expiresAt - Date.now());
  const timer = setTimeout(async () => {
    ttlTimers.delete(key);
    try {
      // Pass the captured slice as `Ctx`; the default deleter only
      // touches `api`, and test deleters receive the same narrow shape.
      await activeDeleter(chatId, messageId, captured as unknown as Ctx);
    } catch {
      // best-effort — user may have deleted the message manually.
    }
    untrackMessage(captured.session, pagePath, messageId);
    if (store !== undefined) {
      try {
        await store.save(captured.session);
      } catch {
        // non-fatal: the regular pipeline session-flush will catch up
        // on the next update.
      }
    }
  }, delay);
  // Don't keep the bot process alive purely for a pending TTL: the
  // long-lived grammY listeners already do that, and unref'ing keeps
  // test processes from hanging on a 10 s DANGER timer.
  (timer as { unref?: () => void }).unref?.();
  ttlTimers.set(key, timer);
}

/**
 * Send (or edit-replace) a message and track it under a page scope.
 *
 * See file-level doc-comment for invariants.
 */
export async function send(ctx: Ctx, text: string, opts: SendOptions): Promise<TrackedMessage> {
  const scope = opts.scope ?? ctx.session.menu.currentPage;
  const finalText = buildFinalText(text, opts);
  const ttlMs = resolveTtlMs(opts);
  const parseMode = opts.parseMode ?? "HTML";

  if (shouldReplace(opts)) {
    const list = ctx.session.messages[scope];
    const prior = list?.find((m) => m.type === opts.type && m.subtype === opts.subtype);
    if (prior) {
      try {
        await ctx.api.editMessageText(ctx.chatId, prior.messageId, finalText, {
          parse_mode: parseMode,
          reply_markup: opts.replyMarkup,
        });
        prior.expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : undefined;
        if (opts.metadata !== undefined) prior.metadata = opts.metadata;
        ctx.session.lastInteractionAt = Date.now();
        scheduleTtl(ctx, prior);
        return prior;
      } catch (err) {
        if (!isMessageNotFoundError(err)) throw err;
        // The user (or another client) deleted the message. Drop the
        // stale entry and fall through to a fresh send.
        untrackMessage(ctx.session, scope, prior.messageId);
      }
    }
  }

  const sent = await ctx.api.sendMessage(ctx.chatId, finalText, {
    parse_mode: parseMode,
    reply_markup: opts.replyMarkup,
  });

  const now = Date.now();
  const tracked: TrackedMessage = {
    messageId: sent.message_id,
    type: opts.type,
    pagePath: scope,
    createdAt: now,
    ...(opts.subtype !== undefined ? { subtype: opts.subtype } : {}),
    ...(ttlMs !== undefined ? { expiresAt: now + ttlMs } : {}),
    ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
  };
  trackMessage(ctx.session, tracked);
  scheduleTtl(ctx, tracked);
  return tracked;
}

/**
 * Convenience wrapper that forces `replacePrevious: true`. Used by
 * input-flow renderers and other call sites where the caller's intent
 * is "there is at most one of these in scope, edit it if present".
 */
export async function replacePrevious(
  ctx: Ctx,
  text: string,
  opts: SendOptions,
): Promise<TrackedMessage> {
  return send(ctx, text, { ...opts, replacePrevious: true });
}
