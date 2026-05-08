import { makeGatePage } from "../gate-page.ts";

/**
 * `/research-targets` — G5 Research Targets review.
 *
 * The orchestrator (P5) proposes a list of research subjects derived
 * from the sketch. Approval at G5 unlocks the per-target research loop
 * before the stack questionnaire fires.
 */
export const targetsPage = makeGatePage({
  path: "/research-targets",
  parent: "/",
  gate: "G5",
  title: "Research Targets",
  nextPath: "/stack-questionnaire",
  artifactPath: (s) =>
    s.researchTargets.length > 0 ? "docs/research/00-research-subjects.md" : null,
  summarise: (s) => `${s.researchTargets.length} targets`,
});
