import { makeGatePage } from "../gate-page.ts";

/**
 * `/sketch` — G4 Blueprint Sketch review.
 *
 * Surfaces the architect-drafted sketch document for human approval
 * before the orchestrator commits to research targets at P5.
 */
export const sketchPage = makeGatePage({
  path: "/sketch",
  parent: "/",
  gate: "G4",
  title: "Blueprint Sketch",
  nextPath: "/research-targets",
  artifactPath: (s) => s.sketchPath,
  summarise: (s) => (s.sketchPath !== null ? "Sketch ready." : "Sketch not yet drafted."),
});
