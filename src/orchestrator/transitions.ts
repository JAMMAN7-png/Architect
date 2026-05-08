import type { Stage } from "./state.ts";

/** Phase order. Linear. No branching past P0. */
export const STAGE_ORDER: readonly Stage[] = [
  "P0_BOOTSTRAP",
  "P1_SPARK_CAPTURE",
  "P2_MODE_SELECTION",
  "P3_SPARK_MATURATION",
  "P4_BLUEPRINT_SKETCH",
  "P5_RESEARCH_TARGETS",
  "P6_STACK_QUESTIONNAIRE",
  "P7_DEEP_RESEARCH",
  "P8_APPROACH_QUESTIONNAIRE",
  "P9_DECISION_SETTLEMENT",
  "P10_DOCS_MANIFEST",
  "P11_DOCS_GENERATION",
  "P12_BLUEPRINT_ASSEMBLY",
  "DONE",
] as const;

export function nextStage(current: Stage): Stage {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx < 0) throw new Error(`Unknown stage: ${current}`);
  if (idx === STAGE_ORDER.length - 1) return "DONE";
  return STAGE_ORDER[idx + 1] as Stage;
}

/** Whether `to` is a legal successor of `from`. Forward-only; no skips. */
export function isLegalTransition(from: Stage, to: Stage): boolean {
  return nextStage(from) === to;
}
