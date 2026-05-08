import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { settleDecisions } from "../../agents/decision-settlement.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

/**
 * P9 — Decision Settlement. Strategic agent consolidates Q1 + Q2 + research
 * into `docs/04-approved-decisions.md`. Gate G8.
 */
export const p9Decisions: PhaseDefinition = {
  stage: "P9_DECISION_SETTLEMENT",
  label: "Decision settlement",
  run: async (ctx) => runP9(ctx),
};

async function runP9(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router } = ctx;
  if (!state.approvedEssencePath) throw new Error("P9 entered without essence");

  const last = lastApprovalFor(state, "G8");
  if (last?.status === "approved" && state.decisionsPath) return state;
  if (last?.status === "rejected") throw new Error("decisions rejected (G8)");

  const essence = await readDoc(state.approvedEssencePath);
  const prefsPath = resolve(state.projectRoot, "docs", "research", "_user_prefs.json");
  const approachPath = resolve(state.projectRoot, "docs", "research", "_approach_decisions.json");
  const preferencesJson = await readFile(prefsPath, "utf8");
  const approachJson = await readFile(approachPath, "utf8");

  const researchSummary = await summariseResearch(state);
  const text = await settleDecisions({
    router,
    bus,
    essence,
    preferencesJson,
    approachJson,
    researchSummary,
  });

  const target = projectDoc(state.projectRoot, "04-approved-decisions.md");
  await writeDoc(target, text);

  return presentApproval({ ...state, decisionsPath: target }, bus, {
    gate: "G8",
    artifact: "docs/04-approved-decisions.md",
    label: "Approve final decisions",
  });
}

async function summariseResearch(state: ArchitectState): Promise<string> {
  const lines: string[] = [];
  for (const t of state.researchTargets) {
    if (!t.approved) continue;
    const path = projectDoc(state.projectRoot, "research", `${t.id}.md`);
    try {
      const doc = await readDoc(path);
      const m = doc.match(/##\s+Decision Summary\s*\n([\s\S]*?)(?:\n##\s|$)/);
      lines.push(`### ${t.name}\n${(m?.[1] ?? "").trim()}\n_(${`docs/research/${t.id}.md`})_`);
    } catch {
      lines.push(`### ${t.name}\n_(no doc — investigate)_`);
    }
  }
  return lines.join("\n\n");
}
