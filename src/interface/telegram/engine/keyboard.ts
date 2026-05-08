/**
 * Inline-keyboard button helper.
 *
 * Composes `InlineKeyboardButton` objects with Bot API 9.4 ergonomics:
 *   - `intent` resolves to `icon_custom_emoji_id` from the env-driven
 *     custom-emoji registry. The fallback glyph is NOT auto-prepended
 *     to `text`; callers prefix glyphs themselves so plain-Telegram
 *     clients (no Premium) still see something in the button label.
 *   - `style` sets the button color: "danger" | "success" | "primary".
 */

import { type EmojiIntent, getEmojiSpec } from "./messages/custom-emoji.ts";
import type { InlineKeyboardButton, InlineKeyboardButtonStyle } from "./types.ts";

export interface ButtonOptions {
  intent?: EmojiIntent;
  style?: InlineKeyboardButtonStyle;
  callback_data?: string;
  url?: string;
}

/**
 * Compose an `InlineKeyboardButton`. When `intent` is given AND the
 * registry resolves a non-empty custom_emoji_id, attaches
 * `icon_custom_emoji_id`. The fallback glyph is NOT auto-prepended to
 * `text` — callers prefix glyphs themselves so plain-Telegram clients
 * (no Premium) still see something in the button label.
 */
export function btn(text: string, opts: ButtonOptions = {}): InlineKeyboardButton {
  const out: InlineKeyboardButton = { text };
  if (opts.intent !== undefined) {
    const id = getEmojiSpec(opts.intent).id;
    if (id !== "") out.icon_custom_emoji_id = id;
  }
  if (opts.style !== undefined) out.style = opts.style;
  if (opts.callback_data !== undefined) out.callback_data = opts.callback_data;
  if (opts.url !== undefined) out.url = opts.url;
  return out;
}
