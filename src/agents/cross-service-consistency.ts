import type { Blueprint } from "../core/types.ts";
import type { LLMRouter } from "../llm/router.ts";

const SYSTEM = `You are reviewing a generated docs tree for cross-service consistency.
You are given the Blueprint plus a digest of every per-service docs/blueprint.md, api-contract.md,
and dependencies.md.

Find concrete inconsistencies:
- Service A claims to depend on service B, but B's docs do not declare A as a consumer.
- Service A's API contract calls service B with a payload that doesn't match B's contract.
- Two services claim ownership of the same entity.
- A dependency cycle exists.
- An event is published but nobody consumes it (or consumed but nobody publishes it).
- A service's acceptance criteria reference a feature that does not appear in any contract.

Output strict JSON:
{ "findings": [{ "severity": "blocker"|"major"|"minor"|"info",
                 "scope": string, "problem": string, "recommendation": string }] }`;

export async function runCrossServiceReview(
  router: LLMRouter,
  blueprint: Blueprint,
  digest: { service: string; blueprint: string; apiContract: string; dependencies: string }[],
): Promise<unknown[]> {
  const userPrompt = [
    "## Blueprint",
    "```json",
    JSON.stringify(blueprint, null, 2),
    "```",
    "",
    "## Per-service digest",
    JSON.stringify(digest, null, 2),
    "",
    "Find concrete inconsistencies. Output JSON.",
  ].join("\n");

  const res = await router.chat({
    tier: "strategic",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    jsonSchema: {},
    maxTokens: 4000,
  });
  const json = res.json as { findings?: unknown[] } | undefined;
  return json?.findings ?? [];
}
