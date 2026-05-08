import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState, SparkMode } from "../state.ts";

const ARTIFACT = "<mode-selection>";

/**
 * P2 — Spark Mode Selection. The user picks how to mature the spark:
 * Brainstorm & Grow, Checkup Only, or Skip.
 *
 * G2 records the choice as the approval. State.sparkMode is set after
 * approval lands.
 */
export const p2Mode: PhaseDefinition = {
  stage: "P2_MODE_SELECTION",
  label: "Spark mode selection",
  run: async (ctx) => runP2(ctx),
};

async function runP2(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, prompts, bus } = ctx;
  const last = lastApprovalFor(state, "G2");
  if (last?.status === "approved" && state.sparkMode) return state;

  // Telegram drives mode selection via an inline-button page that pre-fills
  // `state.sparkMode` before re-entering the phase; CLI hits the prompt.
  const mode: SparkMode =
    state.sparkMode ??
    (await prompts.select<SparkMode>("How should we mature this spark?", [
      { value: "brainstorm", label: "Brainstorm & grow (best for rough ideas)" },
      { value: "checkup", label: "Gap checkup (best for fairly complete sparks)" },
      { value: "skip", label: "Skip — spark is final as-is" },
    ]));

  const next: ArchitectState = { ...state, sparkMode: mode };
  return presentApproval(next, bus, {
    gate: "G2",
    artifact: ARTIFACT,
    label: `Confirm mode: ${mode}`,
  });
}
