import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

/**
 * QA Reviewer Ensemble. Runs an adversarial review of the Blueprint via
 * the ensemble tier (Kimi + DeepSeek-Pro vote, Opus tiebreaker). Output is
 * a single review document at `docs/qa/blueprint-review.md` with severities.
 *
 * For v1 we issue ONE ensemble call against the whole Blueprint and post-
 * process the response into a structured review. The router's
 * `ensembleChat` would also work, but the simpler single call keeps token
 * cost predictable; future revisions can fan out per section.
 */

const SYSTEM = `You are an adversarial Blueprint reviewer. Find concrete failure modes,
not theoretical concerns. For each finding, output:

  - severity: blocker | major | minor | info
  - scope: <file or step id>
  - problem: 1–2 sentences
  - recommendation: 1–2 sentences

Output a single Markdown document. Begin with a one-paragraph verdict, then
a "## Findings" section listing each finding as a numbered block.`;

export async function reviewBlueprint(args: {
  router: LLMRouter;
  bus: ProgressBus;
  blueprintText: string;
}): Promise<string> {
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "ensemble",
    agent: "qa-ensemble",
    system: SYSTEM,
    user: `<<<BLUEPRINT\n${args.blueprintText}\nBLUEPRINT>>>`,
    maxTokens: 5000,
    temperature: 0.4,
  });
  return text.trim();
}
