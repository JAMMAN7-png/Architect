import { extractJson } from "../llm/json-extract.ts";
import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

/**
 * Cheap-model dry-run. Asks an execution-tier model whether each Blueprint
 * step is ambiguous or executable. Ambiguity is a blocking defect: if the
 * cheap model says "I cannot do this without further clarification", the
 * step is not Blueprint-ready.
 */

const SYSTEM = `You are a cheap coder agent dry-running a Blueprint step. Read the step
verbatim. Decide whether you could implement it without further questions.

Output STRICT JSON ONLY:
{
  "ambiguous": boolean,
  "reasons": ["..."]
}

If "ambiguous" is true, "reasons" lists each unresolved question. If false,
"reasons" can be empty.`;

export interface DryRunResult {
  stepId: string;
  ambiguous: boolean;
  reasons: string[];
}

export async function dryRunStep(args: {
  router: LLMRouter;
  bus: ProgressBus;
  stepId: string;
  stepText: string;
}): Promise<DryRunResult> {
  const { text, json } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "execution",
    agent: `dry-run:${args.stepId}`,
    system: SYSTEM,
    user: args.stepText,
    jsonSchema: {},
    maxTokens: 1000,
    temperature: 0.1,
  });
  const data =
    (json as { ambiguous?: unknown; reasons?: unknown } | null) ??
    (extractJson(text) as { ambiguous?: unknown; reasons?: unknown } | undefined);
  const reasons = Array.isArray((data as { reasons?: unknown })?.reasons)
    ? (data as { reasons: unknown[] }).reasons.filter((r): r is string => typeof r === "string")
    : [];
  return {
    stepId: args.stepId,
    ambiguous: Boolean((data as { ambiguous?: unknown })?.ambiguous),
    reasons,
  };
}
