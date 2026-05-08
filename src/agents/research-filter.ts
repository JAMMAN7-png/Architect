import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import type { ResearchTarget } from "../orchestrator/state.ts";
import type { SearchProvider } from "../search/adapter.ts";
import { filterFindings } from "../search/filter.ts";
import type { ResearchFinding } from "../search/types.ts";
import { mapWithCap } from "../util/promise.ts";
import { callLlm } from "./llm-helpers.ts";

const RESEARCH_DOC_SYSTEM = `You are the Research Doc Writer. Given a target, the user's preference,
and a small set of filtered, relevance-ranked findings, write a Research
Doc that follows the Architect Research Doc Template EXACTLY.

Required sections (in this order, headings as shown, no extras):
  # <Target>
  ## Decision Summary
  ## Why This Matters (for THIS project)
  ## Approved Choice
  ## Alternatives Considered
  ## Implementation-Relevant Findings
  ## Required Patterns
  ## Risks / Warnings
  ## Testing Notes
  ## Blueprint References
  ## Sources

Rules:
  - Decision Summary: 1–3 sentences, no fluff.
  - Approved Choice: state the option the user accepted (from input).
  - Implementation-Relevant Findings: ≤500 tokens, each ≤120 tokens.
  - Risks / Warnings: bullets, concrete, anchored to a finding when possible.
  - Blueprint References: list the Blueprint section ids that will cite this
    doc (e.g. "BP-STACK-001", "BP-DB-002"). It's OK to be approximate.
  - Sources: numbered list with title + url from the findings (no extras).`;

export interface ResearchInputs {
  target: ResearchTarget;
  approvedChoice: string;
  customNote?: string;
}

export interface ResearchOutput {
  target: ResearchTarget;
  doc: string;
  findings: ResearchFinding[];
}

export async function researchTarget(args: {
  router: LLMRouter;
  bus: ProgressBus;
  search: SearchProvider;
  input: ResearchInputs;
  signal?: AbortSignal;
}): Promise<ResearchOutput> {
  const { target, approvedChoice, customNote } = args.input;
  const objective = `Research ${target.name} for use as ${approvedChoice}${customNote ? ` (${customNote})` : ""} in a software project.`;
  const queries = buildQueries(target, approvedChoice);

  args.bus.emit({
    type: "tool_started",
    tool: `search:${target.id}`,
    inputSummary: queries.join(" | "),
  });
  const baseReq: {
    objective: string;
    queries: string[];
    processor: "base";
    maxResults: number;
    signal?: AbortSignal;
  } = {
    objective,
    queries,
    processor: "base",
    maxResults: 8,
  };
  if (args.signal) baseReq.signal = args.signal;
  const search = await args.search.search(baseReq);
  args.bus.emit({
    type: "tool_finished",
    tool: `search:${target.id}`,
    resultSummary: `${search.excerpts.length} excerpts`,
  });

  const filterOpts: { signal?: AbortSignal } = {};
  if (args.signal) filterOpts.signal = args.signal;
  const findings = await filterFindings(args.router, objective, search.excerpts, filterOpts);

  const userBlock = JSON.stringify({ target, approvedChoice, customNote, findings }, null, 2);
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "execution",
    agent: `research-doc:${target.id}`,
    system: RESEARCH_DOC_SYSTEM,
    user: userBlock,
    maxTokens: 3000,
    temperature: 0.2,
  });
  return { target, doc: text.trim(), findings };
}

export async function researchAllTargets(args: {
  router: LLMRouter;
  bus: ProgressBus;
  search: SearchProvider;
  inputs: ResearchInputs[];
  concurrency?: number;
}): Promise<ResearchOutput[]> {
  const concurrency = args.concurrency ?? 3;
  return mapWithCap(args.inputs, concurrency, async (input) => {
    return researchTarget({ router: args.router, bus: args.bus, search: args.search, input });
  });
}

function buildQueries(target: ResearchTarget, choice: string): string[] {
  const base = `${target.name} ${choice}`.trim();
  return [`${base} official docs`, `${base} best practices`, `${base} common pitfalls`];
}
