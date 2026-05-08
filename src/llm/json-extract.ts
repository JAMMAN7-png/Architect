/**
 * Extracts a JSON value from LLM response text. Handles fenced code blocks,
 * leading prose, and string-aware bracket balancing. Never throws.
 */

const FENCE_RE = /^```\s*(json)?\s*\n([\s\S]*?)\n\s*```$/m;

/** Locate the last balanced closing bracket in text, respecting quoted strings. */
function findClosing(text: string, startChar: "{" | "["): number | undefined {
  const closeChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") isEscaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === startChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

function balancedSlice(text: string): string {
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  if (firstBrace < 0 && firstBracket < 0) return text;

  const start =
    firstBrace < 0
      ? firstBracket
      : firstBracket < 0
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  const startChar = text[start] as "{" | "[";
  const end = findClosing(text.slice(start), startChar);
  if (end === undefined) return text;
  return text.slice(start, start + end + 1);
}

export function extractJson(text: string): unknown | undefined {
  const trimmed = text.trim();

  // Strip fenced code block if present.
  const fenceMatch = trimmed.match(FENCE_RE);
  const content = fenceMatch ? (fenceMatch[2] ?? trimmed) : trimmed;

  const unfenced = content.trim();
  if (unfenced.length === 0) return undefined;

  // If text starts with prose, slice from the first JSON delimiter.
  const firstChar = unfenced[0];
  if (firstChar !== "{" && firstChar !== "[") {
    const candidate = balancedSlice(unfenced);
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }

  // Already starts with a delimiter — try balanced scan, then fall back to plain parse.
  const startChar = firstChar as "{" | "[";
  const end = findClosing(unfenced, startChar);
  if (end !== undefined) {
    try {
      return JSON.parse(unfenced.slice(0, end + 1));
    } catch {
      // fall through
    }
  }

  try {
    return JSON.parse(unfenced);
  } catch {
    return undefined;
  }
}
