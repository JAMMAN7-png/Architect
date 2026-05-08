import type { Blueprint } from "../core/types.ts";
import type { LLMRouter } from "../llm/router.ts";

const SYSTEM = `You produce concise architecture documents from a frozen Blueprint.
Output ONLY markdown, no preamble. Use mermaid for diagrams when helpful.`;

export async function genSystemOverview(router: LLMRouter, blueprint: Blueprint): Promise<string> {
  const userPrompt = [
    "Produce docs/architecture/system-overview.md from this Blueprint.",
    "",
    "Sections:",
    "- # System Overview",
    "- ## Purpose (one paragraph)",
    "- ## Architectural style (one line: monolith / modular monolith / microservices, with the rationale)",
    "- ## Service map (a markdown table: id | domain | purpose | priority | depends on)",
    "- ## Cross-cutting (auth, observability, deployment, data store, event bus)",
    "- ## Build sequence (numbered list of service ids)",
    "",
    "## Blueprint",
    "```json",
    JSON.stringify(blueprint, null, 2),
    "```",
  ].join("\n");
  const res = await router.chat({
    tier: "execution",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 4000,
  });
  return res.text.trim();
}

export async function genServiceMap(router: LLMRouter, blueprint: Blueprint): Promise<string> {
  const userPrompt = [
    "Produce docs/architecture/service-map.md.",
    "",
    "Sections:",
    "- # Service Map",
    "- One markdown table with columns: id | name | domain | priority | dependsOn | publicApi | emitsEvents | securityCritical",
    "- ## Domains — list the domain folders and the services in each",
    "- ## Build sequence — numbered list",
    "- No prose explanation.",
    "",
    "## Blueprint",
    "```json",
    JSON.stringify(blueprint, null, 2),
    "```",
  ].join("\n");
  const res = await router.chat({
    tier: "execution",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 3000,
  });
  return res.text.trim();
}

export async function genDependencyGraph(router: LLMRouter, blueprint: Blueprint): Promise<string> {
  // Deterministic mermaid output — no LLM needed.
  const lines: string[] = [];
  lines.push("# Dependency Graph");
  lines.push("");
  lines.push("```mermaid");
  lines.push("graph LR");
  for (const svc of blueprint.services) {
    const label = svc.name.replace(/"/g, "'");
    lines.push(`  ${svc.id}["${label}"]`);
  }
  for (const svc of blueprint.services) {
    for (const dep of svc.dependsOn) {
      lines.push(`  ${svc.id} --> ${dep}`);
    }
  }
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export async function genEventMap(router: LLMRouter, blueprint: Blueprint): Promise<string> {
  if (!blueprint.crossCutting.eventBus) {
    return "# Event Map\n\n_This project does not use an event bus._\n";
  }
  const userPrompt = [
    `Produce docs/architecture/event-map.md for an event-driven system using ${blueprint.crossCutting.eventBus}.`,
    "",
    "Sections:",
    "- # Event Map",
    "- ## Bus (the event bus tech)",
    "- ## Topic naming convention (one line)",
    "- ## Topics — markdown table: topic | publisher | consumer(s) | payload summary | idempotency key",
    "- No prose.",
    "",
    "Only include services with emitsEvents=true.",
    "",
    "## Blueprint",
    "```json",
    JSON.stringify(blueprint, null, 2),
    "```",
  ].join("\n");
  const res = await router.chat({
    tier: "execution",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 3000,
  });
  return res.text.trim();
}
