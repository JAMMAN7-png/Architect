import { makeGatePage } from "../gate-page.ts";

/**
 * `/docs-manifest` — G9 Docs Manifest review.
 *
 * The orchestrator (P10) produces the per-service documentation
 * manifest enumerating which docs each service will receive at
 * blueprint assembly time.
 */
export const manifestPage = makeGatePage({
  path: "/docs-manifest",
  parent: "/",
  gate: "G9",
  title: "Docs Manifest",
  nextPath: "/blueprint",
  artifactPath: (s) => s.docsManifestPath,
  summarise: (s) => (s.docsManifestPath !== null ? "Manifest ready." : "Manifest pending."),
});
