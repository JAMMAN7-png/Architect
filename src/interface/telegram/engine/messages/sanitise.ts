/**
 * HTML sanitisation for Telegram messages.
 *
 * HTML is the canonical parse mode (design-system §04). User-authored
 * strings MUST flow through `escapeHtml` before composition into a
 * message body to prevent tag injection.
 */

const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

export const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => MAP[c] ?? c);
