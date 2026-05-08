import type { ArchitectConfig } from "../config/schema.ts";
import { type SearchProvider, SearchUnavailableError } from "./adapter.ts";
import { ExaProvider } from "./providers/exa.ts";
import { FirecrawlProvider } from "./providers/firecrawl.ts";
import { ParallelProvider } from "./providers/parallel.ts";

/**
 * Resolve a SearchProvider given the loaded config. Falls back to Firecrawl
 * if the configured provider has no key set, since Firecrawl is the
 * v1 working backend.
 */
export function resolveSearchProvider(cfg: ArchitectConfig): SearchProvider {
  const configured = cfg.search.provider as string;
  const primary = makeProvider(configured);
  if (primary?.available()) return primary;

  // Fall back to any other provider that has a key set.
  const order: ReadonlyArray<string> = ["firecrawl", "parallel", "exa"];
  for (const id of order) {
    if (id === configured) continue;
    const candidate = makeProvider(id);
    if (candidate?.available()) return candidate;
  }

  const envVar =
    configured === "exa"
      ? "EXA_API_KEY"
      : configured === "parallel"
        ? "PARALLEL_API_KEY"
        : "FIRECRAWL_API_KEY";
  throw new SearchUnavailableError(
    primary?.id ?? configured,
    `Set ${envVar} (or another provider's key) in your environment.`,
  );
}

function makeProvider(id: string): SearchProvider | null {
  switch (id) {
    case "exa":
      return new ExaProvider();
    case "parallel":
      return new ParallelProvider();
    case "firecrawl":
      return new FirecrawlProvider();
    default:
      return null;
  }
}

export { ExaProvider, FirecrawlProvider, ParallelProvider };
export * from "./adapter.ts";
export { filterFindings } from "./filter.ts";
