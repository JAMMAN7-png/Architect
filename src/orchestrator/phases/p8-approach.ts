import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ApproachQuestion, buildApproachQuestions } from "../../agents/approach-clarifier.ts";
import { researchSingleTopic } from "../../agents/topic-research.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

const CUSTOM_PREFIX = "Custom";

interface ApproachAnswer {
  selected: string;
  custom?: string;
  researched?: boolean;
}

/**
 * P8 — Approach Questionnaire (HITL Q2). Same custom-answer-loop as P6.
 * Outputs `_approach_decisions.json` and a human-readable
 * `02-approach-decisions.md` under `docs/research/`.
 */
export const p8Approach: PhaseDefinition = {
  stage: "P8_APPROACH_QUESTIONNAIRE",
  label: "Approach questionnaire",
  run: async (ctx) => runP8(ctx),
};

async function runP8(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router, prompts } = ctx;
  if (!state.approvedEssencePath) throw new Error("P8 entered without essence");

  const last = lastApprovalFor(state, "G7");
  if (last?.status === "approved") return state;
  if (last?.status === "rejected") throw new Error("approach questionnaire rejected (G7)");

  // Pre-staged path: when `_approach_decisions.json` is already on disk (the
  // Telegram input flow writes it before re-entering the phase), skip the
  // LLM question generation + the loop and present G7 from the staged JSON.
  const jsonPath = resolve(state.projectRoot, "docs", "research", "_approach_decisions.json");
  const prestaged = await readPrestagedDecisions(jsonPath);
  if (prestaged) {
    const docPath = projectDoc(state.projectRoot, "research", "02-approach-decisions.md");
    await writeDoc(docPath, renderApproachDoc(prestaged.questions, prestaged.answers));
    return presentApproval(state, bus, {
      gate: "G7",
      artifact: "docs/research/02-approach-decisions.md",
      label: `Approve approach decisions — ${prestaged.questions.length} answered`,
    });
  }

  const essence = await readDoc(state.approvedEssencePath);
  const researchSummary = await summariseResearch(state);

  const questions = await buildApproachQuestions({ router, bus, essence, researchSummary });
  const answers: Record<string, ApproachAnswer> = {};
  for (const q of questions) {
    answers[q.id] = await askWithCustomLoop(q, ctx);
  }

  const docPath = projectDoc(state.projectRoot, "research", "02-approach-decisions.md");
  await writeDoc(docPath, renderApproachDoc(questions, answers));
  await writeFile(jsonPath, `${JSON.stringify({ questions, answers }, null, 2)}\n`, "utf8");

  return presentApproval(state, bus, {
    gate: "G7",
    artifact: "docs/research/02-approach-decisions.md",
    label: `Approve approach decisions — ${questions.length} answered`,
  });
}

async function summariseResearch(state: ArchitectState): Promise<string> {
  const lines: string[] = [];
  for (const t of state.researchTargets) {
    if (!t.approved) continue;
    const path = projectDoc(state.projectRoot, "research", `${t.id}.md`);
    try {
      const doc = await readDoc(path);
      // Pull the Decision Summary section if present.
      const m = doc.match(/##\s+Decision Summary\s*\n([\s\S]*?)(?:\n##\s|$)/);
      lines.push(`### ${t.name} (${t.id})`);
      lines.push((m?.[1] ?? doc.slice(0, 500)).trim());
      lines.push("");
    } catch {
      lines.push(`### ${t.name} (${t.id})\n_(no doc)_\n`);
    }
  }
  return lines.join("\n");
}

async function askWithCustomLoop(q: ApproachQuestion, ctx: PhaseContext): Promise<ApproachAnswer> {
  const { prompts, bus, router } = ctx;
  const choices = q.options.map((o) => ({ value: o, label: o }));
  let researchedHint: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const promptText = researchedHint
      ? `${q.prompt}\n  research note: ${researchedHint}`
      : q.prompt;
    const picked = await prompts.select<string>(promptText, choices);
    if (!picked.startsWith(CUSTOM_PREFIX)) return { selected: picked };
    const custom = (await prompts.text("Describe your custom approach")).trim();
    if (!custom) {
      bus.emit({ type: "warning", message: "empty custom — re-asking question" });
      continue;
    }
    bus.emit({ type: "info", message: `running approach research for "${custom}"` });
    try {
      researchedHint = await researchSingleTopic({ router, bus, topic: custom, context: q.prompt });
    } catch (err) {
      bus.emit({
        type: "warning",
        message: `approach research failed (${(err as Error).message}); accepting custom as-is`,
      });
      return { selected: picked, custom, researched: false };
    }
    if (await prompts.confirm(`Stick with custom "${custom}"?`, true)) {
      return { selected: picked, custom, researched: true };
    }
  }
  return { selected: q.options[q.options.length - 1] ?? "" };
}

function renderApproachDoc(
  questions: ApproachQuestion[],
  answers: Record<string, ApproachAnswer>,
): string {
  const lines: string[] = ["# Approach Decisions", ""];
  for (const q of questions) {
    const ans = answers[q.id];
    lines.push(`## ${q.prompt}`);
    if (q.topic) lines.push(`- topic: \`${q.topic}\``);
    lines.push(`- chosen: **${ans?.selected ?? "(unanswered)"}**`);
    if (ans?.custom) lines.push(`  - custom note: ${ans.custom}`);
    if (ans?.researched) lines.push("  - _custom option triggered a research detour_");
    lines.push("");
  }
  return lines.join("\n").trim();
}

interface PrestagedDecisions {
  questions: ApproachQuestion[];
  answers: Record<string, ApproachAnswer>;
}

async function readPrestagedDecisions(path: string): Promise<PrestagedDecisions | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = parsed as { questions?: unknown; answers?: unknown };
  if (!Array.isArray(candidate.questions)) return null;
  if (candidate.answers === null || typeof candidate.answers !== "object") return null;
  return {
    questions: candidate.questions as ApproachQuestion[],
    answers: candidate.answers as Record<string, ApproachAnswer>,
  };
}
