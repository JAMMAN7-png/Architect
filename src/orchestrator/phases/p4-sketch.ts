import { draftSketch } from "../../agents/sketch-architect.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

export const p4Sketch: PhaseDefinition = {
  stage: "P4_BLUEPRINT_SKETCH",
  label: "Blueprint sketch",
  run: async (ctx) => runP4(ctx),
};

async function runP4(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router } = ctx;
  if (!state.spark || !state.approvedEssencePath) {
    throw new Error("P4 entered without spark + approved essence");
  }
  const last = lastApprovalFor(state, "G4");
  if (last?.status === "approved" && state.sketchPath) return state;
  if (last?.status === "rejected") throw new Error("sketch rejected (G4)");

  const spark = await readDoc(state.spark.path);
  const essence = await readDoc(state.approvedEssencePath);
  const maturation = state.grownSparkPath
    ? await readDoc(state.grownSparkPath)
    : state.checkupPath
      ? await readDoc(state.checkupPath)
      : null;

  const text = await draftSketch({ router, bus, spark, essence, maturation });
  const target = projectDoc(state.projectRoot, "03-blueprint-sketch.md");
  await writeDoc(target, text);

  return presentApproval({ ...state, sketchPath: target }, bus, {
    gate: "G4",
    artifact: "docs/03-blueprint-sketch.md",
    label: "Approve the blueprint sketch",
  });
}
