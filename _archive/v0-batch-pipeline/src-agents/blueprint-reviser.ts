import type { Blueprint, QaReview } from "../core/types.ts";
import type { LLMRouter } from "../llm/router.ts";

const SYSTEM = `You are the Blueprint Architect, applying QA findings to your draft.
Take the previous Blueprint JSON and the QA findings. Produce a revised Blueprint.

You MUST:
- Apply every blocker and major finding.
- Apply minor findings only when low-risk.
- Reject findings that contradict the Spark; explain the rejection in a "rejectedFindings" field at the top level.
- Output the same Blueprint JSON shape, plus an optional rejectedFindings array.
- Update frozenAt to the current time.
- Output strict JSON, no prose.`;

export async function reviseBlueprint(
  router: LLMRouter,
  previous: Blueprint,
  reviews: QaReview[],
): Promise<Blueprint> {
  const userPrompt = [
    "## Previous Blueprint",
    "```json",
    JSON.stringify(previous, null, 2),
    "```",
    "",
    "## QA Findings",
    "```json",
    JSON.stringify(reviews, null, 2),
    "```",
    "",
    "Apply blockers and majors. Reject findings that contradict the Spark. Output the revised Blueprint JSON.",
  ].join("\n");

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
  if (!json) throw new Error("blueprint-reviser: model did not return valid JSON");
  json.schemaVersion = 1;
  json.frozenAt = new Date().toISOString();
  return json;
}
