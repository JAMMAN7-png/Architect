import type {
  ExtractRequest,
  ExtractResult,
  SearchProvider,
  SearchRequest,
  SearchResult,
} from "../../src/search/adapter.ts";

/**
 * Deterministic in-memory search provider for tests. Returns canned
 * excerpts per objective substring; falls back to a single placeholder.
 */
export class MockSearchProvider implements SearchProvider {
  readonly id = "mock-search";
  private rules: Array<{ match: (req: SearchRequest) => boolean; result: SearchResult }> = [];
  private fallback: SearchResult;

  constructor(fallback?: Partial<SearchResult>) {
    this.fallback = {
      excerpts: fallback?.excerpts ?? [
        { text: "Generic excerpt", url: "https://example.com/", title: "Example" },
      ],
      estimatedUsd: 0,
      latencyMs: 0,
      provider: "mock-search",
    };
  }

  on(match: (req: SearchRequest) => boolean, result: SearchResult): this {
    this.rules.push({ match, result });
    return this;
  }

  onObjectiveContains(needle: string, excerpts: SearchResult["excerpts"]): this {
    return this.on((req) => req.objective.toLowerCase().includes(needle.toLowerCase()), {
      excerpts,
      estimatedUsd: 0,
      latencyMs: 0,
      provider: "mock-search",
    });
  }

  available(): boolean {
    return true;
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    for (const r of this.rules) {
      if (r.match(req)) return r.result;
    }
    return this.fallback;
  }

  async extract(req: ExtractRequest): Promise<ExtractResult> {
    return {
      url: req.url,
      title: "stub",
      content: "stub",
      format: req.format ?? "markdown",
      estimatedUsd: 0,
      latencyMs: 0,
      provider: "mock-search",
    };
  }
}
