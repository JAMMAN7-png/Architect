import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

const SYSTEM = `You are the Decision Settlement agent. You consolidate the user's stack
preferences (Q1), approach decisions (Q2), and research summaries into a
single Approved Decisions document. You MUST:

  - Surface every contradiction and resolve it (or mark it "needs user input").
  - Recommend a final stack that respects user-specified choices.
  - Anchor every decision in a research source (cite the doc path).
  - Refuse to invent decisions outside the approved scope.

Output a single Markdown document with these sections:
  # Approved Decisions
  ## Identity Recap
  ## Final Stack
  ## Final Approach
  ## Resolved Contradictions
  ## Unresolved (needs user input)
  ## Research References (paths)`;

export async function settleDecisions(args: {
  router: LLMRouter;
  bus: ProgressBus;
  essence: string;
  preferencesJson: string;
  approachJson: string;
  researchSummary: string;
}): Promise<string> {
  const userBlock =
    `<<<APPROVED_ESSENCE\n${args.essence}\nAPPROVED_ESSENCE>>>\n\n` +
    `<<<USER_PREFS\n${args.preferencesJson}\nUSER_PREFS>>>\n\n` +
    `<<<APPROACH\n${args.approachJson}\nAPPROACH>>>\n\n` +
    `<<<RESEARCH_SUMMARY\n${args.researchSummary}\nRESEARCH_SUMMARY>>>`;
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "decision-settlement",
    system: SYSTEM,
    user: userBlock,
    maxTokens: 6000,
    temperature: 0.2,
  });
  return text.trim();
}
