import type { ArchitectConfig } from "../config/schema.ts";
import { type SearchProvider, SearchUnavailableError } from "./adapter.ts";
import { FirecrawlProvider } from "./providers/firecrawl.ts";
import { ParallelProvider } from "./providers/parallel.ts";

/**
 * Resolve a SearchProvider given the loaded config. Falls back to Firecrawl
 * if the configured `parallel` provider has no key set, since Firecrawl is the
 * v1 working backend.
 */
export function resolveSearchProvider(cfg: ArchitectConfig): SearchProvider {
  const primary =
    cfg.search.provider === "parallel" ? new ParallelProvider() : new FirecrawlProvider();
  if (primary.available()) return primary;

  // Fall back to whichever provider does have a key.
  const fallback =
    cfg.search.provider === "parallel" ? new FirecrawlProvider() : new ParallelProvider();
  if (fallback.available()) return fallback;

  throw new SearchUnavailableError(
    primary.id,
    `Set ${primary.id === "firecrawl" ? "FIRECRAWL_API_KEY" : "PARALLEL_API_KEY"} (or the other one) in your environment.`,
  );
}

export { FirecrawlProvider, ParallelProvider };
export * from "./adapter.ts";
export { filterFindings } from "./filter.ts";
