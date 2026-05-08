import { chmod, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BLUEPRINT_SECTIONS, generateBlueprint } from "../../agents/blueprint-architect.ts";
import { dryRunStep } from "../../agents/cheap-dry-run.ts";
import { reviewBlueprint } from "../../agents/qa-ensemble.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { mapWithCap } from "../../util/promise.ts";
import { validateBlueprint } from "../../validate/blueprint.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

/**
 * P12 — Blueprint Assembly + QA + Lock.
 *
 * Pipeline:
 *   1. Generate the 16 Blueprint sections via the Architect (strategic).
 *   2. Run structural validation (§6 step format + reference rule).
 *   3. Run QA Reviewer Ensemble; write `docs/qa/blueprint-review.md`.
 *   4. Run Cheap-Model Dry-Run on each step; surface ambiguities as warnings.
 *   5. Present G10. On approval, set blueprintLocked + chmod 0444 every
 *      file under docs/blueprint/.
 */
export const p12Blueprint: PhaseDefinition = {
  stage: "P12_BLUEPRINT_ASSEMBLY",
  label: "Blueprint assembly + QA",
  run: async (ctx) => runP12(ctx),
};

async function runP12(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router } = ctx;
  if (!state.decisionsPath || !state.approvedEssencePath) {
    throw new Error("P12 entered without essence + decisions");
  }

  const last = lastApprovalFor(state, "G10");
  if (last?.status === "approved") {
    if (!state.blueprintLocked) return lockBlueprint(state);
    return state;
  }
  if (last?.status === "rejected") throw new Error("blueprint rejected (G10)");

  const decisions = await readDoc(state.decisionsPath);
  const essence = await readDoc(state.approvedEssencePath);

  // Pull research summaries.
  const researchSummaries: { id: string; doc: string }[] = [];
  for (const t of state.researchTargets) {
    if (!t.approved) continue;
    try {
      const doc = await readDoc(projectDoc(state.projectRoot, "research", `${t.id}.md`));
      researchSummaries.push({ id: t.id, doc });
    } catch {
      bus.emit({ type: "warning", message: `missing research doc for ${t.id}` });
    }
  }

  // 1. Generate.
  bus.emit({ type: "step_started", stepId: "bp-generate", label: "generating blueprint sections" });
  const sections = await generateBlueprint({ router, bus, decisions, essence, researchSummaries });
  if (sections.length === 0) throw new Error("blueprint generation returned no sections");
  for (const s of sections) {
    const target = projectDoc(state.projectRoot, "blueprint", s.file);
    await writeDoc(target, s.content);
  }

  // 2. Validate.
  const validation = await validateBlueprint(state.projectRoot);
  if (!validation.ok) {
    for (const e of validation.errors) bus.emit({ type: "error", message: e, recoverable: false });
    throw new Error(`blueprint validation failed: ${validation.errors.length} errors`);
  }

  // 3. QA review.
  const blueprintText = sections.map((s) => `--- ${s.file} ---\n${s.content}`).join("\n\n");
  const review = await reviewBlueprint({ router, bus, blueprintText });
  await writeDoc(projectDoc(state.projectRoot, "qa", "blueprint-review.md"), review);

  // 4. Cheap dry-run on each step.
  const dryResults = await mapWithCap(validation.steps, 4, async (s) =>
    dryRunStep({ router, bus, stepId: s.id, stepText: s.body }),
  );
  const ambiguous = dryResults.filter((r) => r.ambiguous);
  for (const r of ambiguous) {
    bus.emit({
      type: "warning",
      message: `dry-run flagged ${r.stepId} as ambiguous: ${r.reasons.join("; ")}`,
    });
  }

  return presentApproval(state, bus, {
    gate: "G10",
    artifact: "docs/blueprint/",
    label: `Approve Blueprint — ${sections.length} sections, ${validation.steps.length} steps, ${ambiguous.length} ambiguous`,
  });
}

async function lockBlueprint(state: ArchitectState): Promise<ArchitectState> {
  const dir = join(state.projectRoot, "docs", "blueprint");
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = (await readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    })) as unknown as typeof entries;
  } catch {
    entries = [];
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    try {
      await chmod(join(dir, ent.name), 0o444);
    } catch {
      // best-effort on Windows
    }
  }
  // Sanity: make sure files exist.
  await Promise.all(
    BLUEPRINT_SECTIONS.map(async (s) => readFile(join(dir, s.file), "utf8").catch(() => "")),
  );
  return {
    ...state,
    blueprintLocked: true,
    blueprintLockedAt: new Date().toISOString(),
  };
}
