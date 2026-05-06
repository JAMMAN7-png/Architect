import {
  type ExtractRequest,
  type ExtractResult,
  type SearchExcerpt,
  type SearchProvider,
  type SearchRequest,
  type SearchResult,
  SearchUnavailableError,
} from "../adapter.ts";

/**
 * Parallel.ai-compatible adapter. Speaks the canonical Parallel Search API shape.
 * Works against parallel.ai itself, or against a self-hosted compatible service
 * via PARALLEL_BASE_URL.
 *
 * Reference: https://docs.parallel.ai (Search API beta).
 */
export class ParallelProvider implements SearchProvider {
  readonly id = "parallel";

  available(): boolean {
    return Boolean(process.env.PARALLEL_API_KEY);
  }

  private baseUrl(): string {
    return process.env.PARALLEL_BASE_URL?.replace(/\/$/, "") || "https://api.parallel.ai";
  }

  private apiKey(): string {
    const key = process.env.PARALLEL_API_KEY;
    if (!key) {
      throw new SearchUnavailableError(
        "parallel",
        "Set PARALLEL_API_KEY (and optionally PARALLEL_BASE_URL) in your environment.",
      );
    }
    return key;
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const r = await fetch(`${this.baseUrl()}/v1beta/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey(),
      },
      body: JSON.stringify({
        objective: req.objective,
        search_queries: req.queries,
        processor: req.processor ?? "base",
        max_results: req.maxResults ?? 10,
      }),
      signal: req.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`parallel: search failed (${r.status}): ${body.slice(0, 200)}`);
    }
    const json = (await r.json()) as ParallelSearchResponse;

    const excerpts: SearchExcerpt[] = (json.results ?? []).map((res) => ({
      text: (res.excerpts ?? []).join("\n\n"),
      url: res.url,
      title: res.title ?? res.url,
    }));

    return {
      excerpts,
      estimatedUsd: estimateSearchUsd(req),
      latencyMs: Date.now() - started,
      provider: this.id,
    };
  }

  async extract(req: ExtractRequest): Promise<ExtractResult> {
    const started = Date.now();
    const r = await fetch(`${this.baseUrl()}/v1beta/extract`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey(),
      },
      body: JSON.stringify({
        url: req.url,
        format: req.format ?? "markdown",
      }),
      signal: req.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`parallel: extract failed (${r.status}): ${body.slice(0, 200)}`);
    }
    const json = (await r.json()) as ParallelExtractResponse;
    return {
      url: req.url,
      title: json.title ?? req.url,
      content: json.content ?? "",
      format: req.format ?? "markdown",
      estimatedUsd: 0.005,
      latencyMs: Date.now() - started,
      provider: this.id,
    };
  }
}

function estimateSearchUsd(req: SearchRequest): number {
  // Parallel base ≈ $0.004 per query, pro ≈ $0.018 per query (rough).
  const per = req.processor === "pro" ? 0.018 : 0.004;
  return req.queries.length * per;
}

interface ParallelSearchResponse {
  results?: Array<{
    url: string;
    title?: string;
    excerpts?: string[];
  }>;
}

interface ParallelExtractResponse {
  title?: string;
  content?: string;
}
