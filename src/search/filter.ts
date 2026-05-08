import type { LLMRouter } from "../llm/router.ts";
import { estimateTokens } from "../llm/tokenizer.ts";
import type { SearchExcerpt } from "./adapter.ts";
import type { ResearchFinding } from "./types.ts";

/**
 * The 85%-noise filter: takes raw search excerpts and a research objective,
 * uses the EXECUTION tier to extract only implementation-relevant findings.
 *
 * Hard caps:
 *   - At most `perQueryCap` tokens per finding (default 500).
 *   - At most `1 - noiseRatio` fraction of input excerpts survive
 *     (default 0.85 → ≤ 15% of excerpts pass through).
 *
 * The filter runs as a single LLM call; the model is prompted to discard
 * anything that doesn't directly affect what to build.
 */

export interface FilterOptions {
  noiseRatio?: number; // 0..1; default 0.85
  perQueryCap?: number; // tokens per finding; default 500
  signal?: AbortSignal;
}

const SYSTEM = `You are a research filtering agent. Your job is to discard generic, theoretical, or
tangential information and keep ONLY findings that directly affect implementation choices.

For each surviving finding, output:
- A 2-5 sentence excerpt that captures the implementation-relevant fact
- One sentence on why it matters for the project

You MUST:
- Discard at least the requested noise ratio of inputs.
- Never invent facts not present in the input.
- Cap each excerpt at the requested token budget.

Output strictly as JSON: { "findings": [{ "url": string, "title": string, "excerpt": string, "relevance": string }] }`;

export async function filterFindings(
  router: LLMRouter,
  objective: string,
  excerpts: SearchExcerpt[],
  opts: FilterOptions = {},
): Promise<ResearchFinding[]> {
  if (excerpts.length === 0) return [];
  const noiseRatio = opts.noiseRatio ?? 0.85;
  const perQueryCap = opts.perQueryCap ?? 500;
  const maxKeep = Math.max(1, Math.floor(excerpts.length * (1 - noiseRatio)));

  // Inputs are URL+title+text. Cap each input excerpt to ~600 tokens to keep prompt size sane.
  const inputs = excerpts.slice(0, 60).map((e) => ({
    url: e.url,
    title: e.title,
    text: capTokens(e.text, 600),
  }));

  const userPrompt = JSON.stringify(
    {
      objective,
      noise_ratio: noiseRatio,
      max_keep: maxKeep,
      per_finding_token_cap: perQueryCap,
      excerpts: inputs,
    },
    null,
    2,
  );

  const res = await router.chat({
    tier: "execution",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    jsonSchema: {},
    maxTokens: 4000,
    signal: opts.signal,
  });

  const json = res.json as { findings?: ResearchFinding[] } | undefined;
  if (!json?.findings) return [];

  // Belt-and-braces: enforce caps client-side too.
  const queryFor = (url: string): string => excerpts.find((e) => e.url === url)?.title ?? objective;
  return json.findings.slice(0, maxKeep).map((f) => ({
    query: queryFor(f.url),
    url: f.url,
    title: f.title,
    excerpt: capTokens(f.excerpt ?? "", perQueryCap),
    relevance: f.relevance ?? "",
  }));
}

function capTokens(text: string, cap: number): string {
  if (estimateTokens(text) <= cap) return text;
  // Approximate truncation: 3.5 chars/token average.
  const chars = Math.floor(cap * 3.5);
  return `${text.slice(0, chars).trim()}…`;
}
