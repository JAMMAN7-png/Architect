/**
 * Substrate research finding shape — produced by `filterFindings`.
 *
 * This is the raw output of the noise-filter step. The orchestrator state
 * (`ResearchFindingState` in `src/orchestrator/state.ts`) is a richer
 * persisted/audited form derived from these.
 */
export interface ResearchFinding {
  query: string;
  url: string;
  title: string;
  excerpt: string;
  relevance: string;
}
