import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

const SKETCH_SYSTEM = `You are the Sketch Architect. Your job is to draw a LOW-RESOLUTION
skeleton of the product — modules, capabilities, doc placeholders, risks,
and candidate architectures. NOT a Blueprint. NOT deep design.

Rules:
  - Honor the Approved Product Essence verbatim. No scope expansion.
  - Mark every unknown explicitly. "Unknown — to be decided in research."
  - Identify candidate architectures (≥2 when reasonable) WITHOUT picking.
  - Identify risk areas by name; do not solve them yet.
  - List the docs the project will need (placeholders only, no contents).

Output a single Markdown document with these sections (and only these):
  # Blueprint Sketch
  ## Product Summary
  ## Capabilities
  ## Modules (and what each owns)
  ## Doc Placeholders (filenames + 1-line purpose)
  ## Known Unknowns
  ## Risk Areas
  ## Candidate Architectures (with one-paragraph trade-offs each)`;

export async function draftSketch(args: {
  router: LLMRouter;
  bus: ProgressBus;
  spark: string;
  essence: string;
  maturation: string | null;
}): Promise<string> {
  const matBlock = args.maturation ? `\n\n<<<MATURATION\n${args.maturation}\nMATURATION>>>` : "";
  const userBlock = `<<<SPARK\n${args.spark}\nSPARK>>>\n\n<<<APPROVED_ESSENCE\n${args.essence}\nAPPROVED_ESSENCE>>>${matBlock}`;
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "sketch",
    system: SKETCH_SYSTEM,
    user: userBlock,
    maxTokens: 6000,
    temperature: 0.3,
  });
  return text.trim();
}
