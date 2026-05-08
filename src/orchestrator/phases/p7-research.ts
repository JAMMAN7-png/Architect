import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ResearchInputs, researchAllTargets } from "../../agents/research-filter.ts";
import { loadConfig } from "../../config/loader.ts";
import { resolveSearchProvider } from "../../search/index.ts";
import { projectDoc, writeDoc } from "../../util/files.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState, ResearchFindingState } from "../state.ts";

/**
 * P7 — Deep Research. No gate; bounded by approved targets.
 *
 * For each approved target, fetch via the search provider, filter by
 * relevance, and write `docs/research/<target>.md` per the Research Doc
 * Template. Findings are recorded in state for audit.
 *
 * Idempotent: if a research doc already exists for a target it is reused.
 */
export const p7Research: PhaseDefinition = {
  stage: "P7_DEEP_RESEARCH",
  label: "Deep research",
  run: async (ctx) => runP7(ctx),
};

async function runP7(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router } = ctx;
  if (state.researchTargets.length === 0) throw new Error("P7 entered without research targets");
  const prefsPath = resolve(state.projectRoot, "docs", "research", "_user_prefs.json");
  const prefs = JSON.parse(await readFile(prefsPath, "utf8")) as {
    questions: { id: string; targetId: string; prompt: string; options: string[] }[];
    answers: Record<string, { selected: string; custom?: string }>;
  };

  // Build research inputs, joining preferences to targets.
  const inputs: ResearchInputs[] = state.researchTargets
    .filter((t) => t.approved)
    .map((target) => {
      const q = prefs.questions.find((q) => q.targetId === target.id);
      const a = q ? prefs.answers[q.id] : undefined;
      const choice = a?.selected ?? target.name;
      const out: ResearchInputs = { target, approvedChoice: choice };
      if (a?.custom) out.customNote = a.custom;
      return out;
    });

  const search = ctx.searchOverride ?? resolveSearchProvider(await loadConfig());

  const results = await researchAllTargets({ router, bus, search, inputs, concurrency: 3 });

  const newFindings: ResearchFindingState[] = [];
  for (const r of results) {
    const path = projectDoc(state.projectRoot, "research", `${r.target.id}.md`);
    await writeDoc(path, r.doc);
    for (const [i, f] of r.findings.entries()) {
      newFindings.push({
        id: `${r.target.id}-${String(i + 1).padStart(3, "0")}`,
        targetId: r.target.id,
        topic: f.title,
        source: f.url,
        title: f.title,
        excerpt: f.excerpt.slice(0, 1500),
        relevance: parseRelevance(f.relevance),
        critical: false,
        capturedAt: new Date().toISOString(),
      });
    }
  }

  // Persist a small sidecar index for downstream tools.
  const indexPath = resolve(state.projectRoot, "docs", "research", "_findings.json");
  await writeFile(indexPath, `${JSON.stringify(newFindings, null, 2)}\n`, "utf8");

  return {
    ...state,
    researchFindings: [...state.researchFindings, ...newFindings],
  };
}

function parseRelevance(r: string): number {
  if (!r) return 0.5;
  const numeric = Number(r);
  if (!Number.isNaN(numeric)) return clamp(numeric, 0, 1);
  switch (r.toLowerCase()) {
    case "high":
      return 0.9;
    case "medium":
      return 0.6;
    case "low":
      return 0.3;
    default:
      return 0.5;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
