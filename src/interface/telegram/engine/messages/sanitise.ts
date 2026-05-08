/**
 * HTML sanitisation for Telegram messages.
 *
 * HTML is the canonical parse mode (design-system §04). User-authored
 * strings MUST flow through `escapeHtml` before composition into a
 * message body to prevent tag injection.
 *
 * `safeBodyHtml` is a defensive guard for trusted HTML composed by the
 * engine: it asserts the string only uses tags supported by Telegram's
 * HTML parse mode plus our `<tg-emoji>` entity. Throwing here surfaces
 * accidental tag injection at the send boundary (used by tests and
 * debug-mode assertions; not a blocking validator on the hot path).
 */

const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

export const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => MAP[c] ?? c);

const ALLOWED_TAGS = new Set(["b", "i", "u", "s", "code", "pre", "a", "br", "tg-emoji"]);

/** Throw if `s` contains tags outside the Telegram-supported allowlist. Returns `s`. */
export function safeBodyHtml(s: string): string {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  for (const m of s.matchAll(tagRe)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      throw new Error(`safeBodyHtml: tag <${name}> is not allowed`);
    }
  }
  return s;
}
