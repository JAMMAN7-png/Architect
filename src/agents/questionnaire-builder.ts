import { extractJson } from "../llm/json-extract.ts";
import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import type { ResearchTarget } from "../orchestrator/state.ts";
import { callLlm } from "./llm-helpers.ts";

const SYSTEM = `You are the Questionnaire Builder. Given a list of research targets and
the Approved Product Essence, produce stack-and-capability questions that
the human MUST answer before research begins. Keep them tight: max one
question per target unless a target legitimately needs multi-part input.

Each question is multiple choice with a "Custom" escape hatch. The custom
option triggers a research detour (handled by the orchestrator) — you only
need to surface the option, not implement the loop.

Emit STRICT JSON ONLY:
{
  "questions": [
    {
      "id": "kebab-id",
      "targetId": "id-from-targets",
      "prompt": "Question text",
      "options": ["Option A", "Option B", "Custom (describe)"]
    }
  ]
}`;

export interface StackQuestion {
  id: string;
  targetId: string;
  prompt: string;
  options: string[];
}

export async function buildStackQuestions(args: {
  router: LLMRouter;
  bus: ProgressBus;
  essence: string;
  targets: ResearchTarget[];
}): Promise<StackQuestion[]> {
  const { text, json } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "execution",
    agent: "questionnaire-builder",
    system: SYSTEM,
    user: `<<<APPROVED_ESSENCE\n${args.essence}\nAPPROVED_ESSENCE>>>\n\n<<<TARGETS\n${JSON.stringify(args.targets, null, 2)}\nTARGETS>>>`,
    jsonSchema: {},
    maxTokens: 4000,
    temperature: 0.2,
  });
  const data =
    (json as { questions?: unknown } | null) ??
    (extractJson(text) as { questions?: unknown } | undefined);
  const list = Array.isArray((data as { questions?: unknown })?.questions)
    ? (data as { questions: unknown[] }).questions
    : [];
  const out: StackQuestion[] = [];
  for (const item of list) {
    const q = item as Partial<StackQuestion> | null;
    if (!q || typeof q.id !== "string" || typeof q.prompt !== "string") continue;
    if (!Array.isArray(q.options)) continue;
    out.push({
      id: q.id,
      targetId: typeof q.targetId === "string" ? q.targetId : "",
      prompt: q.prompt,
      options: q.options.filter((o): o is string => typeof o === "string"),
    });
  }
  return out;
}

export function renderPreferencesDoc(
  questions: StackQuestion[],
  answers: Record<string, { selected: string; custom?: string; researched?: boolean }>,
): string {
  const lines: string[] = ["# User Preferences", ""];
  for (const q of questions) {
    const ans = answers[q.id];
    lines.push(`## ${q.prompt}`);
    lines.push(`- target: \`${q.targetId}\``);
    lines.push(`- chosen: **${ans?.selected ?? "(unanswered)"}**`);
    if (ans?.custom) lines.push(`  - custom note: ${ans.custom}`);
    if (ans?.researched) lines.push("  - _custom option triggered a research detour_");
    lines.push("");
  }
  return lines.join("\n").trim();
}
