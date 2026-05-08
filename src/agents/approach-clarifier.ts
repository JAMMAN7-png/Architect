import { extractJson } from "../llm/json-extract.ts";
import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

const SYSTEM = `You are the Approach Clarifier. With research findings in hand, produce
the questions the human MUST answer about HOW to apply each finding. Tight,
decision-shaped, no fluff. One question per cluster of related findings.

Each question is multiple choice with a "Custom (describe)" option.

Emit STRICT JSON ONLY:
{
  "questions": [
    {
      "id": "kebab-id",
      "topic": "<target id or area>",
      "prompt": "Question text",
      "options": ["Option A", "Option B", "Custom (describe)"]
    }
  ]
}`;

export interface ApproachQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
}

export async function buildApproachQuestions(args: {
  router: LLMRouter;
  bus: ProgressBus;
  essence: string;
  researchSummary: string;
}): Promise<ApproachQuestion[]> {
  const { text, json } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "execution",
    agent: "approach-clarifier",
    system: SYSTEM,
    user: `<<<APPROVED_ESSENCE\n${args.essence}\nAPPROVED_ESSENCE>>>\n\n<<<RESEARCH_SUMMARY\n${args.researchSummary}\nRESEARCH_SUMMARY>>>`,
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
  const out: ApproachQuestion[] = [];
  for (const item of list) {
    const q = item as Partial<ApproachQuestion> | null;
    if (!q || typeof q.id !== "string" || typeof q.prompt !== "string") continue;
    if (!Array.isArray(q.options)) continue;
    out.push({
      id: q.id,
      topic: typeof q.topic === "string" ? q.topic : "",
      prompt: q.prompt,
      options: q.options.filter((o): o is string => typeof o === "string"),
    });
  }
  return out;
}
