import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type StackQuestion,
  buildStackQuestions,
  renderPreferencesDoc,
} from "../../agents/questionnaire-builder.ts";
import { researchSingleTopic } from "../../agents/topic-research.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

const CUSTOM_PREFIX = "Custom";

interface PreferenceAnswer {
  selected: string;
  custom?: string;
  researched?: boolean;
}

/**
 * P6 — Stack & Capability Questionnaire (HITL Q1).
 *
 * The phase generates questions, walks the user through them, and for any
 * "Custom (describe)" answer it triggers a quick targeted research detour
 * before re-asking that question with the new option highlighted. Loop
 * terminates on settlement (a non-custom answer, or a confirmed custom
 * answer after research).
 *
 * G6 records overall approval of the recorded preferences.
 */
export const p6StackQ: PhaseDefinition = {
  stage: "P6_STACK_QUESTIONNAIRE",
  label: "Stack questionnaire",
  run: async (ctx) => runP6(ctx),
};

async function runP6(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router, prompts } = ctx;
  if (!state.approvedEssencePath) throw new Error("P6 entered without essence");
  if (state.researchTargets.length === 0) throw new Error("P6 entered without research targets");

  const last = lastApprovalFor(state, "G6");
  if (last?.status === "approved") return state;
  if (last?.status === "rejected") throw new Error("stack questionnaire rejected (G6)");

  // Pre-staged path: when `_user_prefs.json` already exists on disk (Telegram
  // input flow writes it before re-entering the phase), skip question
  // generation + the Q&A loop and present G6 from the staged JSON.
  const jsonPath = resolve(state.projectRoot, "docs", "research", "_user_prefs.json");
  const prestaged = await readPrestagedPrefs(jsonPath);
  if (prestaged) {
    const docPath = projectDoc(state.projectRoot, "research", "01-user-preferences.md");
    await writeDoc(docPath, renderPreferencesDoc(prestaged.questions, prestaged.answers));
    return presentApproval(state, bus, {
      gate: "G6",
      artifact: "docs/research/01-user-preferences.md",
      label: `Approve preferences — ${prestaged.questions.length} answered`,
    });
  }

  const essence = await readDoc(state.approvedEssencePath);
  const questions = await buildStackQuestions({
    router,
    bus,
    essence,
    targets: state.researchTargets,
  });

  const answers: Record<string, PreferenceAnswer> = {};
  for (const q of questions) {
    answers[q.id] = await askWithCustomLoop(q, ctx);
  }

  const docPath = projectDoc(state.projectRoot, "research", "01-user-preferences.md");
  await writeDoc(docPath, renderPreferencesDoc(questions, answers));
  await writeFile(jsonPath, `${JSON.stringify({ questions, answers }, null, 2)}\n`, "utf8");

  return presentApproval(state, bus, {
    gate: "G6",
    artifact: "docs/research/01-user-preferences.md",
    label: `Approve preferences — ${questions.length} answered`,
  });
}

async function askWithCustomLoop(q: StackQuestion, ctx: PhaseContext): Promise<PreferenceAnswer> {
  const { prompts, bus, router } = ctx;
  const choices = q.options.map((o) => ({ value: o, label: o }));
  // Outer loop: keep asking until we have a non-custom answer, OR a custom
  // answer that the user confirms after one research detour.
  let researchedHint: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const promptText = researchedHint
      ? `${q.prompt}\n  research note: ${researchedHint}`
      : q.prompt;
    const picked = await prompts.select<string>(promptText, choices);
    if (!picked.startsWith(CUSTOM_PREFIX)) {
      return { selected: picked };
    }
    const custom = (await prompts.text("Describe your custom choice")).trim();
    if (!custom) {
      bus.emit({ type: "warning", message: "empty custom — re-asking question" });
      continue;
    }
    bus.emit({
      type: "info",
      message: `running custom-answer research for "${custom}"`,
    });
    try {
      const finding = await researchSingleTopic({ router, bus, topic: custom, context: q.prompt });
      researchedHint = finding;
    } catch (err) {
      bus.emit({
        type: "warning",
        message: `custom research failed (${(err as Error).message}); will accept custom answer as-is`,
      });
      return { selected: picked, custom, researched: false };
    }
    const ok = await prompts.confirm(`Stick with custom "${custom}"?`, true);
    if (ok) return { selected: picked, custom, researched: true };
  }
  bus.emit({ type: "warning", message: `no settlement on ${q.id} — recording last attempt` });
  return { selected: q.options[q.options.length - 1] ?? "" };
}

interface PrestagedPrefs {
  questions: StackQuestion[];
  answers: Record<string, PreferenceAnswer>;
}

async function readPrestagedPrefs(path: string): Promise<PrestagedPrefs | null> {
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
    questions: candidate.questions as StackQuestion[],
    answers: candidate.answers as Record<string, PreferenceAnswer>,
  };
}
