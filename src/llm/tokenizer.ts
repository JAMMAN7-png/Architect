/**
 * Rough token estimator. We use tiktoken's cl100k_base for OpenAI-family and
 * a 3.5-chars-per-token heuristic for everything else. Good enough for budget
 * gating; not used for billing.
 */
import { get_encoding } from "tiktoken";

let cl100k: ReturnType<typeof get_encoding> | null = null;

function getCl100k() {
  if (!cl100k) {
    try {
      cl100k = get_encoding("cl100k_base");
    } catch {
      // Fall back below
    }
  }
  return cl100k;
}

/** Approximate token count. */
export function estimateTokens(text: string): number {
  const enc = getCl100k();
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch {
      // fall through
    }
  }
  return Math.ceil(text.length / 3.5);
}

/** Approximate token count for a chat message array. */
export function estimateChatTokens(messages: { role: string; content: string }[]): number {
  let sum = 0;
  for (const m of messages) sum += estimateTokens(m.content) + 4; // 4-token overhead per message
  return sum + 2;
}

/** Release the cached tiktoken encoder WASM allocation, if initialized. */
export function disposeTokenizer(): void {
  cl100k?.free?.();
  cl100k = null;
}
