import type { Blueprint, QaFinding, QaReview } from "../core/types.ts";
import type { LLMRouter } from "../llm/router.ts";

const PERSPECTIVES = [
  { id: "security", label: "Security attacker mindset" },
  { id: "scale", label: "Scale-to-10M-users mindset" },
  { id: "cost", label: "Cost / unit economics mindset" },
  { id: "dx", label: "Developer experience mindset" },
  { id: "pmf", label: "Product-market-fit (against the Spark) mindset" },
];

const SYSTEM = `You are an adversarial QA reviewer. You are reviewing a frozen Blueprint candidate
BEFORE any code is written. Find concrete, fixable failure points.

You MUST:
- Output STRICT JSON, no commentary.
- Each finding has: severity (blocker|major|minor|info), category, scope, problem, recommendation.
- "scope" is the service id, or "blueprint", "architecture", "crosscutting".
- Reject vague hand-wavy findings. Each finding must be actionable.
- If you can't find anything from your perspective, output an empty findings array.

Output schema:
{ "findings": [{ "severity": ..., "category": ..., "scope": ..., "problem": ..., "recommendation": ... }] }`;

export async function runQaReview(router: LLMRouter, blueprint: Blueprint): Promise<QaReview[]> {
  const reviews: QaReview[] = [];

  // Each perspective is one strategic-tier call.
  for (const p of PERSPECTIVES) {
    const userPrompt = renderUser(blueprint, p.label);
    const res = await router.chat({
      tier: "strategic",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      jsonSchema: {},
      maxTokens: 4000,
    });
    const json = res.json as { findings?: QaFinding[] } | undefined;
    reviews.push({
      perspective: p.label,
      reviewerModel: res.model,
      findings: json?.findings ?? [],
    });
  }

  return reviews;
}

/** Run an ensemble pass — one prompt across every member of models.ensemble in parallel. */
export async function runEnsembleQa(
  router: LLMRouter,
  blueprint: Blueprint,
  perspective: string,
): Promise<QaReview[]> {
  const userPrompt = renderUser(blueprint, perspective);
  const responses = await router.ensembleChat({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    jsonSchema: {},
    maxTokens: 4000,
  });
  return responses.map((res) => {
    const json = res.json as { findings?: QaFinding[] } | undefined;
    return {
      perspective,
      reviewerModel: res.model,
      findings: json?.findings ?? [],
    };
  });
}

function renderUser(blueprint: Blueprint, perspective: string): string {
  return [
    "## Perspective",
    perspective,
    "",
    "## Blueprint",
    "```json",
    JSON.stringify(blueprint, null, 2),
    "```",
    "",
    "Find concrete failure points from this perspective. Output JSON.",
  ].join("\n");
}
