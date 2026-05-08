import { extractJson } from "../llm/json-extract.ts";
import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

/**
 * The Blueprint Architect — strategic tier (Opus primary, GPT cross-check).
 * Produces all 16 Blueprint sections in one structured JSON call. Each
 * section is a single Markdown document; sections that contain steps use
 * the BP-MODULE-NNN format mandated by §6.
 */

export const BLUEPRINT_SECTIONS = [
  { file: "00-overview.md", title: "Overview" },
  { file: "01-product-scope.md", title: "Product Scope" },
  { file: "02-approved-stack.md", title: "Approved Stack" },
  { file: "03-system-architecture.md", title: "System Architecture" },
  { file: "04-state-machine.md", title: "State Machine" },
  { file: "05-cli-interface.md", title: "CLI Interface" },
  { file: "06-telegram-interface.md", title: "Telegram Interface" },
  { file: "07-model-routing.md", title: "Model Routing" },
  { file: "08-docs-generation.md", title: "Docs Generation" },
  { file: "09-human-approval-gates.md", title: "Human Approval Gates" },
  { file: "10-data-model.md", title: "Data Model" },
  { file: "11-module-map.md", title: "Module Map" },
  { file: "12-implementation-roadmap.md", title: "Implementation Roadmap" },
  { file: "13-test-plan.md", title: "Test Plan" },
  { file: "14-validation-plan.md", title: "Validation Plan" },
  { file: "15-acceptance-criteria.md", title: "Acceptance Criteria" },
] as const;

const SYSTEM = `You are the Blueprint Architect. From the Approved Decisions, the
Approved Product Essence, and the Research docs, produce ALL 16 Blueprint
sections. Step-bearing sections (12, 13, 14, 15) MUST contain at least one
step using the BP-<MODULE>-<NNN> format with these required subsections:

  ## BP-<MODULE>-<NNN> — <Title>
  ### Goal
  ### Inputs
  ### Files To Create
  ### Implementation Steps
  ### Acceptance Criteria
  ### Prohibited

Every step's "### Inputs" MUST cite at least one path under \`docs/\`
(research, blueprint, or top-level). Sections that are not step-bearing
(00–11) can be lean prose + tables + bullets; no padding, no tutorials.

Output STRICT JSON ONLY:
{
  "sections": [
    { "file": "00-overview.md", "content": "..." },
    ...
  ]
}`;

export interface BlueprintSection {
  file: string;
  content: string;
}

export async function generateBlueprint(args: {
  router: LLMRouter;
  bus: ProgressBus;
  decisions: string;
  essence: string;
  researchSummaries: { id: string; doc: string }[];
}): Promise<BlueprintSection[]> {
  const summary = args.researchSummaries
    .map((r) => `--- docs/research/${r.id}.md ---\n${r.doc}`)
    .join("\n\n");
  const userBlock =
    `<<<APPROVED_DECISIONS\n${args.decisions}\nAPPROVED_DECISIONS>>>\n\n` +
    `<<<APPROVED_ESSENCE\n${args.essence}\nAPPROVED_ESSENCE>>>\n\n` +
    `<<<RESEARCH\n${summary}\nRESEARCH>>>`;
  const { text, json } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "blueprint-architect",
    system: SYSTEM,
    user: userBlock,
    jsonSchema: {},
    maxTokens: 12000,
    temperature: 0.2,
  });
  const data =
    (json as { sections?: unknown } | null) ??
    (extractJson(text) as { sections?: unknown } | undefined);
  const list = Array.isArray((data as { sections?: unknown })?.sections)
    ? (data as { sections: unknown[] }).sections
    : [];
  const out: BlueprintSection[] = [];
  for (const item of list) {
    const s = item as Partial<BlueprintSection> | null;
    if (!s || typeof s.file !== "string" || typeof s.content !== "string") continue;
    out.push({ file: s.file, content: s.content });
  }
  return out;
}
