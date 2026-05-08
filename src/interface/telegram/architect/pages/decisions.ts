import { makeGatePage } from "../gate-page.ts";

/**
 * `/decisions` — G8 Decision Settlement review.
 *
 * The orchestrator (P9) merges stack + approach answers + research into
 * a single decisions document. G8 is the user's last chance to revise
 * before the per-service docs manifest is generated.
 */
export const decisionsPage = makeGatePage({
  path: "/decisions",
  parent: "/",
  gate: "G8",
  title: "Decisions",
  nextPath: "/docs-manifest",
  artifactPath: (s) => s.decisionsPath,
  summarise: (s) =>
    s.decisions.length === 0 ? "No decisions yet." : `${s.decisions.length} decisions recorded`,
});
