import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

/**
 * Spark Maturation agents — Brainstorm and Checkup.
 *
 * Both run on the strategic tier. They MUST preserve the Essential Identity
 * of the original spark verbatim: brainstorming may add detail and structure
 * but never invents a different product; checkup never expands scope.
 */

const PRESERVATION_RULE = `MUST: Preserve the Essential Identity of the spark verbatim. If the spark
states "this is a CLI", do not propose a web app. If the spark says "human
in the loop", do not relax that. The output is an enriched spark, not a
new product. If a section is unknown, write "Unknown — to be decided in
research" rather than guessing.`;

const BRAINSTORM_SYSTEM = `You are a senior product+software architect helping a user mature a raw
product spark into a richer, structured spark. Use the obra/superpowers
brainstorming method: ask yourself the gap-filling questions an architect
would ask, then write the answers.

${PRESERVATION_RULE}

Output a single Markdown document with these sections (omit a section ONLY
if explicitly inapplicable):
  # Grown Spark
  ## Essential Identity (verbatim from input — DO NOT change)
  ## Product Summary
  ## Target User & Job
  ## Core Capabilities
  ## Out of Scope
  ## Constraints (technical, regulatory, budget, time)
  ## Risk Areas
  ## Open Questions (to resolve during research)
  ## Original Spark (verbatim)`;

const CHECKUP_SYSTEM = `You are a senior architect performing a structured GAP CHECKUP on a
product spark. You do not expand scope; you identify what is missing,
ambiguous, or contradictory. The user will resolve the gaps later.

${PRESERVATION_RULE}

Output Markdown with these sections:
  # Spark Checkup
  ## Essential Identity (verbatim)
  ## Strengths (what is already concrete)
  ## Gaps (missing concrete decisions, listed)
  ## Ambiguities (statements with multiple plausible readings)
  ## Contradictions (if any)
  ## Recommended Next Questions
  ## Original Spark (verbatim)`;

export async function brainstormSpark(args: {
  router: LLMRouter;
  bus: ProgressBus;
  spark: string;
}): Promise<string> {
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "brainstorm",
    system: BRAINSTORM_SYSTEM,
    user: `<<<SPARK\n${args.spark}\nSPARK>>>`,
    maxTokens: 6000,
    temperature: 0.4,
  });
  return text.trim();
}

export async function checkupSpark(args: {
  router: LLMRouter;
  bus: ProgressBus;
  spark: string;
}): Promise<string> {
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "checkup",
    system: CHECKUP_SYSTEM,
    user: `<<<SPARK\n${args.spark}\nSPARK>>>`,
    maxTokens: 4000,
    temperature: 0.3,
  });
  return text.trim();
}

export async function deriveProductEssence(args: {
  router: LLMRouter;
  bus: ProgressBus;
  spark: string;
  maturation: string | null;
}): Promise<string> {
  const sys = `You are an architect distilling a final, approved Product Essence from
a (possibly enriched) spark. The output is the contract every downstream
agent reads. Be concise, declarative, decision-shaped.

${PRESERVATION_RULE}

Output Markdown:
  # Approved Product Essence
  ## Identity (one paragraph)
  ## Capabilities (bulleted, atomic)
  ## Non-Capabilities (what we explicitly are NOT building)
  ## Hard Constraints
  ## Known Unknowns (carried into research)`;
  const userBlock = args.maturation
    ? `<<<SPARK\n${args.spark}\nSPARK>>>\n\n<<<MATURATION\n${args.maturation}\nMATURATION>>>`
    : `<<<SPARK\n${args.spark}\nSPARK>>>`;
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "essence",
    system: sys,
    user: userBlock,
    maxTokens: 4000,
    temperature: 0.2,
  });
  return text.trim();
}
