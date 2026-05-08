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
 * Exa adapter. Uses /search for query fan-out and /contents for single-URL
 * extraction. Translates parallel-shaped requests into Exa's shape and back.
 *
 * https://docs.exa.ai/reference/search
 */
export class ExaProvider implements SearchProvider {
  readonly id = "exa";

  available(): boolean {
    return Boolean(process.env.EXA_API_KEY);
  }

  private baseUrl(): string {
    return process.env.EXA_BASE_URL?.replace(/\/$/, "") ?? "https://api.exa.ai";
  }

  private apiKey(): string {
    const key = process.env.EXA_API_KEY;
    if (!key) {
      throw new SearchUnavailableError(
        "exa",
        "Set EXA_API_KEY (and optionally EXA_BASE_URL) in your environment.",
      );
    }
    return key;
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey(),
    };
    const numResults = Math.min(req.maxResults ?? 20, 20);

    // Fire one /search per query, in parallel.
    const responses = await Promise.all(
      req.queries.map(async (q) => {
        const r = await fetch(`${this.baseUrl()}/search`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: q,
            type: "keyword",
            numResults,
            useAutoprompt: false,
          }),
          signal: req.signal,
        });
        if (!r.ok) {
          const body = await r.text();
          throw new SearchUnavailableError("exa", `${r.status} ${body.slice(0, 200)}`);
        }
        return (await r.json()) as ExaSearchResponse;
      }),
    );

    const seen = new Set<string>();
    const excerpts: SearchExcerpt[] = [];
    for (const resp of responses) {
      for (const item of resp.results ?? []) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        const highlightText = item.highlights?.length ? item.highlights.join("\n\n") : "";
        const text = highlightText || item.text || item.snippet || "";
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
      estimatedUsd: estimateSearchUsd(req),
      latencyMs: Date.now() - started,
      provider: this.id,
    };
  }

  async extract(req: ExtractRequest): Promise<ExtractResult> {
    const started = Date.now();
    const r = await fetch(`${this.baseUrl()}/contents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey(),
      },
      body: JSON.stringify({
        ids: [req.url],
        text: true,
      }),
      signal: req.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new SearchUnavailableError("exa", `${r.status} ${body.slice(0, 200)}`);
    }
    const json = (await r.json()) as ExaContentsResponse;
    const first = json.results?.[0];
    const title = first?.title ?? hostFromUrl(req.url);
    const content = first?.text ?? "";
    return {
      url: req.url,
      title,
      content,
      format: req.format ?? "markdown",
      estimatedUsd: 0.005,
      latencyMs: Date.now() - started,
      provider: this.id,
    };
  }
}

function estimateSearchUsd(req: SearchRequest): number {
  // Exa keyword search ≈ $0.005 per query.
  return req.queries.length * 0.005;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface ExaSearchResult {
  url: string;
  title?: string;
  text?: string;
  snippet?: string;
  highlights?: string[];
}

interface ExaSearchResponse {
  results?: ExaSearchResult[];
}

interface ExaContentsResponse {
  results?: Array<{
    url?: string;
    title?: string;
    text?: string;
  }>;
}
