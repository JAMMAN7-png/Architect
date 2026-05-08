import type { Blueprint, Spark } from "../core/types.ts";
import type { LLMRouter } from "../llm/router.ts";

const SYSTEM = `You are the Blueprint Architect. Your job is to translate a frozen Spark into a complete,
dependency-ordered, machine-readable Blueprint that the rest of the pipeline can execute against.

You MUST:
- Preserve the Spark's identity exactly. Never invent features outside the Spark.
- Produce a microservice or modular-monolith decomposition justified by the Spark, not aesthetics.
- Order services by dependency (build sequence) so any service can be implemented without unbuilt deps.
- Mark security-critical services explicitly (auth, payments, anything touching secrets or PII).
- Output STRICT JSON, no commentary.

Output schema (matches the Blueprint type exactly):
{
  "schemaVersion": 1,
  "frozenAt": ISO-8601 string,
  "sparkSlug": string,
  "summary": string (one paragraph),
  "architectureStyle": "monolith" | "modular-monolith" | "microservices",
  "services": [{
    "id": kebab-case slug,
    "name": Title Case,
    "purpose": one line,
    "responsibilities": [string],
    "nonResponsibilities": [string],
    "priority": "p0" | "p1" | "p2",
    "domain": kebab-case folder name,
    "dependsOn": [service id],
    "emitsEvents": boolean,
    "publicApi": boolean,
    "securityCritical": boolean
  }],
  "crossCutting": {
    "auth": string,
    "observability": string,
    "deployment": string,
    "dataStore": string,
    "eventBus": string | null
  },
  "hasUi": boolean,
  "hasResearch": boolean,
  "acceptance": [string],
  "buildSequence": [service id]
}`;

export async function forgeBlueprint(
  router: LLMRouter,
  spark: Spark,
  research: { excerpt: string; relevance: string }[] = [],
): Promise<Blueprint> {
  const userPrompt = renderUser(spark, research);
  const res = await router.chat({
    tier: "strategic",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    jsonSchema: {},
    maxTokens: 8000,
  });
  const json = res.json as Blueprint | undefined;
  if (!json) {
    throw new Error("blueprint-architect: model did not return valid JSON");
  }
  json.schemaVersion = 1;
  json.frozenAt = new Date().toISOString();
  json.sparkSlug = spark.slug;
  return json;
}

function renderUser(spark: Spark, research: { excerpt: string; relevance: string }[]): string {
  const parts = ["## Spark", JSON.stringify(spark, null, 2)];
  if (research.length > 0) {
    parts.push("");
    parts.push("## Research findings (filtered, implementation-relevant only)");
    for (const r of research) {
      parts.push(`- ${r.excerpt} _(why: ${r.relevance})_`);
    }
  }
  parts.push("");
  parts.push("Produce the Blueprint as JSON matching the schema. No prose, no fences.");
  return parts.join("\n");
}
