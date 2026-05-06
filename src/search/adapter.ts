/**
 * Search/Scrape adapter — the interface is shaped after parallel.ai's API surface
 * (objective + queries + processor + max_results) so the future self-hosted
 * Parallel-compatible service is a drop-in replacement.
 */

export interface SearchRequest {
  /** Natural-language objective the model should answer. */
  objective: string;
  /** 1-3 short keyword queries. */
  queries: string[];
  /** "base" (cheap, ~5 results) or "pro" (deeper, ~10 results). */
  processor?: "base" | "pro";
  /** Hard cap on returned results across all queries. */
  maxResults?: number;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

export interface SearchExcerpt {
  /** Short relevance-ranked excerpt. ≤ ~200 tokens. */
  text: string;
  url: string;
  title: string;
}

export interface SearchResult {
  /** All excerpts across all queries, deduped by URL. */
  excerpts: SearchExcerpt[];
  /** Cost (approximate; for budget guards). */
  estimatedUsd: number;
  /** Latency in ms. */
  latencyMs: number;
  /** Provider id ("firecrawl", "parallel", …). */
  provider: string;
}

export interface ExtractRequest {
  url: string;
  /** "markdown" | "html" | "text". Markdown by default. */
  format?: "markdown" | "html" | "text";
  signal?: AbortSignal;
}

export interface ExtractResult {
  url: string;
  title: string;
  content: string;
  format: "markdown" | "html" | "text";
  estimatedUsd: number;
  latencyMs: number;
  provider: string;
}

export interface SearchProvider {
  readonly id: string;
  available(): boolean;
  search(req: SearchRequest): Promise<SearchResult>;
  extract(req: ExtractRequest): Promise<ExtractResult>;
}

export class SearchUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly hint: string,
  ) {
    super(`Search provider '${provider}' unavailable. ${hint}`);
    this.name = "SearchUnavailableError";
  }
}
