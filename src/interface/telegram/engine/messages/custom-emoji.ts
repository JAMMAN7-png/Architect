/**
 * Telegram custom emoji entities (`<tg-emoji emoji-id="…">fb</tg-emoji>`).
 *
 * Two outputs per intent:
 *   - {@link ce} returns trusted HTML for use in **message bodies**.
 *     When no Telegram custom-emoji id is configured (or the id fails
 *     a digits-only safety check), it returns the bare fallback glyph
 *     so the body shape stays stable in tests and non-Premium chats.
 *   - {@link ceText} returns just the fallback glyph. Use it where
 *     HTML is not parsed — most importantly inline-keyboard button
 *     labels (Telegram does not render entities in button text).
 *
 * Configuration is by env var: `TG_CUSTOM_EMOJI_<INTENT_UPPER_SNAKE>`
 * (e.g. `TG_CUSTOM_EMOJI_MODAL_LOCK=5368…`). Empty / missing → fallback
 * only. Tests can replace the entire registry through
 * {@link __setEmojiRegistryForTests} without touching the environment.
 *
 * Design ref: docs/design-system/04-messages.md (Custom emoji entities).
 */

import { escapeHtml } from "./sanitise.ts";

export type EmojiIntent =
  // Core (pre Bot API 9.4)
  | "success"
  | "error"
  | "warning"
  | "info"
  | "primary"
  | "destructive"
  | "edit"
  | "continue"
  | "modal-lock"
  | "flow-lock"
  | "loading"
  // Bot API 9.4 button glyphs
  | "settings"
  | "models"
  | "search"
  | "llm"
  | "runtime"
  | "brainstorm"
  | "output"
  | "new"
  | "open"
  | "restart"
  | "status"
  | "review"
  | "capture"
  | "revise"
  | "reject"
  | "approve"
  | "back"
  | "cancel"
  | "selected"
  | "unselected"
  | "toggle-on"
  | "toggle-off"
  | "page-prev"
  | "page-next"
  | "ping"
  | "healthy"
  | "unhealthy";

export interface CustomEmojiSpec {
  id: string;
  fallback: string;
}

const FALLBACK: Record<EmojiIntent, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  primary: "🟢",
  destructive: "🛑",
  edit: "✏",
  continue: "▶",
  "modal-lock": "⏳",
  "flow-lock": "⌨️",
  loading: "🔄",
  settings: "⚙",
  models: "🧠",
  search: "🔍",
  llm: "🔌",
  runtime: "⏱",
  brainstorm: "💡",
  output: "📦",
  new: "🆕",
  open: "📂",
  restart: "🔄",
  status: "🔍",
  review: "✍",
  capture: "📝",
  revise: "🔁",
  reject: "❌",
  approve: "✅",
  back: "⬅",
  cancel: "×",
  selected: "⭐",
  unselected: "▫",
  "toggle-on": "🟢",
  "toggle-off": "⚪",
  "page-prev": "◀",
  "page-next": "▶",
  ping: "🩺",
  healthy: "💚",
  unhealthy: "💔",
};

const envKey = (intent: EmojiIntent): string => {
  const upper = intent.replace(/-/g, "_").toUpperCase();
  return `TG_CUSTOM_EMOJI_${upper}`;
};

let override: Partial<Record<EmojiIntent, CustomEmojiSpec>> | null = null;

export function getEmojiSpec(intent: EmojiIntent): CustomEmojiSpec {
  const o = override?.[intent];
  if (o !== undefined) return o;
  const id = process.env[envKey(intent)] ?? "";
  return { id, fallback: FALLBACK[intent] };
}

/**
 * Trusted HTML span for message bodies. Returns the bare fallback
 * glyph when no id is configured or the id fails a digits-only
 * safety check (Telegram emoji ids are numeric, up to ~19 digits in
 * practice; we accept up to 32 defensively).
 */
export function ce(intent: EmojiIntent): string {
  const { id, fallback } = getEmojiSpec(intent);
  if (id === "") return fallback;
  if (!/^\d{1,32}$/.test(id)) return fallback;
  return `<tg-emoji emoji-id="${id}">${escapeHtml(fallback)}</tg-emoji>`;
}

/** Plain glyph only. Use in inline-keyboard button labels (no HTML there). */
export function ceText(intent: EmojiIntent): string {
  return getEmojiSpec(intent).fallback;
}

/** Test seam: replace the registry. Pass `null` to reset. */
export function __setEmojiRegistryForTests(
  map: Partial<Record<EmojiIntent, CustomEmojiSpec>> | null,
): void {
  override = map;
}
