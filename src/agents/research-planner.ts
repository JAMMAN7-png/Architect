import { extractJson } from "../llm/json-extract.ts";
import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import type { ResearchTarget } from "../orchestrator/state.ts";
import { callLlm } from "./llm-helpers.ts";

const SYSTEM = `You are the Research Planner. From the Approved Product Essence and the
Blueprint Sketch, enumerate EVERY target that needs primary-source research
before the Blueprint can be written. Targets include APIs, libraries,
frameworks, runtimes, databases, queues, auth providers, payments, AI
models, MCP servers, deploy platforms, OSS reuse candidates, design
systems, and security/compliance requirements explicitly invoked by the
spark.

Rules:
  - Honor user-specified choices (mark userSpecified=true).
  - Each target needs a one-line rationale anchored in a Sketch/Essence quote.
  - Do NOT include topics that are not driven by the essence/sketch.
  - Emit STRICT JSON ONLY, matching this schema:

{
  "targets": [
    {
      "id": "kebab-id",
      "name": "Display name",
      "category": "runtime|framework|library|db|queue|auth|payment|ai|mcp|deploy|oss|design|security|other",
      "rationale": "one-line, references essence/sketch",
      "userSpecified": false
    }
  ]
}`;

export interface ResearchPlan {
  targets: ResearchTarget[];
  raw: string;
}

export async function planResearchTargets(args: {
  router: LLMRouter;
  bus: ProgressBus;
  essence: string;
  sketch: string;
}): Promise<ResearchPlan> {
  const { text, json } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "strategic",
    agent: "research-planner",
    system: SYSTEM,
    user: `<<<APPROVED_ESSENCE\n${args.essence}\nAPPROVED_ESSENCE>>>\n\n<<<SKETCH\n${args.sketch}\nSKETCH>>>`,
    jsonSchema: {},
    maxTokens: 4000,
    temperature: 0.2,
  });
  const data =
    (json as { targets?: unknown } | null) ??
    (extractJson(text) as { targets?: unknown } | undefined);
  const list = Array.isArray((data as { targets?: unknown })?.targets)
    ? (data as { targets: unknown[] }).targets
    : [];
  const targets: ResearchTarget[] = [];
  for (const item of list) {
    const t = item as Partial<ResearchTarget> | null;
    if (!t || typeof t.id !== "string" || typeof t.name !== "string") continue;
    targets.push({
      id: t.id,
      name: t.name,
      category: typeof t.category === "string" ? t.category : "other",
      rationale: typeof t.rationale === "string" ? t.rationale : "",
      userSpecified: Boolean(t.userSpecified),
      approved: false,
    });
  }
  return { targets, raw: text };
}

export function renderTargetsDoc(targets: ResearchTarget[]): string {
  const groups = new Map<string, ResearchTarget[]>();
  for (const t of targets) {
    const arr = groups.get(t.category) ?? [];
    arr.push(t);
    groups.set(t.category, arr);
  }
  const sections: string[] = ["# Research Subjects", ""];
  for (const [cat, ts] of [...groups.entries()].sort()) {
    sections.push(`## ${cat}`);
    for (const t of ts) {
      sections.push(`- **${t.name}** \`(${t.id})\`${t.userSpecified ? " — _user-specified_" : ""}`);
      if (t.rationale) sections.push(`  - ${t.rationale}`);
    }
    sections.push("");
  }
  return sections.join("\n").trim();
}
