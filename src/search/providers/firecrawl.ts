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
 * Firecrawl v2 adapter. Uses /v2/search for query fan-out and /v2/scrape
 * for single-URL extraction. Translates parallel-shaped requests into
 * Firecrawl's shape and back.
 *
 * https://docs.firecrawl.dev/api-reference
 */
export class FirecrawlProvider implements SearchProvider {
  readonly id = "firecrawl";

  available(): boolean {
    return Boolean(process.env.FIRECRAWL_API_KEY);
  }

  private baseUrl(): string {
    return process.env.FIRECRAWL_BASE_URL?.replace(/\/$/, "") || "https://api.firecrawl.dev";
  }

  private apiKey(): string {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) {
      throw new SearchUnavailableError(
        "firecrawl",
        "Set FIRECRAWL_API_KEY (and optionally FIRECRAWL_BASE_URL) in your environment.",
      );
    }
    return key;
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey()}`,
    };

    // Fire one /v2/search per query, in parallel.
    const responses = await Promise.all(
      req.queries.map(async (q) => {
        const r = await fetch(`${this.baseUrl()}/v2/search`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: q,
            limit: req.processor === "pro" ? 10 : 5,
            scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
          }),
          signal: req.signal,
        });
        if (!r.ok) {
          const body = await r.text();
          throw new Error(`firecrawl: search failed (${r.status}): ${body.slice(0, 200)}`);
        }
        return (await r.json()) as FirecrawlSearchResponse;
      }),
    );

    const seen = new Set<string>();
    const excerpts: SearchExcerpt[] = [];
    for (const resp of responses) {
      for (const item of resp.data ?? []) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        const text = item.markdown ?? item.description ?? "";
        if (!text) continue;
        excerpts.push({
          text,
          url: item.url,
          title: item.title ?? item.url,
        });
        if (req.maxResults && excerpts.length >= req.maxResults) break;
      }
      if (req.maxResults && excerpts.length >= req.maxResults) break;
    }

    return {
      excerpts,
      estimatedUsd: estimateSearchUsd(req, excerpts.length),
      latencyMs: Date.now() - started,
      provider: this.id,
    };
  }

  async extract(req: ExtractRequest): Promise<ExtractResult> {
    const started = Date.now();
    const r = await fetch(`${this.baseUrl()}/v2/scrape`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify({
        url: req.url,
        formats: [req.format === "html" ? "html" : "markdown"],
        onlyMainContent: true,
      }),
      signal: req.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`firecrawl: scrape failed (${r.status}): ${body.slice(0, 200)}`);
    }
    const json = (await r.json()) as FirecrawlScrapeResponse;
    const data = json.data ?? {};
    return {
      url: req.url,
      title: data.metadata?.title ?? req.url,
      content: req.format === "html" ? (data.html ?? "") : (data.markdown ?? ""),
      format: req.format ?? "markdown",
      estimatedUsd: 0.001,
      latencyMs: Date.now() - started,
      provider: this.id,
    };
  }
}

function estimateSearchUsd(req: SearchRequest, results: number): number {
  // Firecrawl prices roughly $0.001 / search request + $0.001 / scrape.
  return req.queries.length * 0.001 + results * 0.001;
}

interface FirecrawlSearchResponse {
  data?: Array<{
    url: string;
    title?: string;
    description?: string;
    markdown?: string;
  }>;
}

interface FirecrawlScrapeResponse {
  data?: {
    markdown?: string;
    html?: string;
    metadata?: { title?: string };
  };
}
