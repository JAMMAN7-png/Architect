import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planResearchTargets, renderTargetsDoc } from "../../agents/research-planner.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState, ResearchTarget } from "../state.ts";

export const p5Targets: PhaseDefinition = {
  stage: "P5_RESEARCH_TARGETS",
  label: "Research target extraction",
  run: async (ctx) => runP5(ctx),
};

async function runP5(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router } = ctx;
  if (!state.approvedEssencePath || !state.sketchPath) {
    throw new Error("P5 entered without essence + sketch");
  }
  const last = lastApprovalFor(state, "G5");
  if (last?.status === "approved" && state.researchTargets.length > 0) {
    // Mark approved on each target.
    const approved = state.researchTargets.map((t) => ({ ...t, approved: true }));
    return { ...state, researchTargets: approved };
  }
  if (last?.status === "rejected") throw new Error("research targets rejected (G5)");

  const essence = await readDoc(state.approvedEssencePath);
  const sketch = await readDoc(state.sketchPath);
  const plan = await planResearchTargets({ router, bus, essence, sketch });

  const docPath = projectDoc(state.projectRoot, "research", "00-research-subjects.md");
  await writeDoc(docPath, renderTargetsDoc(plan.targets));
  const targetsJson = resolve(state.projectRoot, "docs", "research", "_targets.json");
  await writeFile(targetsJson, `${JSON.stringify(plan.targets, null, 2)}\n`, "utf8");

  const labelSummary = `${plan.targets.length} targets across ${countCategories(plan.targets)} categories`;
  return presentApproval({ ...state, researchTargets: plan.targets }, bus, {
    gate: "G5",
    artifact: "docs/research/00-research-subjects.md",
    label: `Approve research targets — ${labelSummary}`,
  });
}

function countCategories(ts: ResearchTarget[]): number {
  return new Set(ts.map((t) => t.category)).size;
}
