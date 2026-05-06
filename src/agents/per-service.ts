import type { Blueprint, BlueprintService, Spark } from "../core/types.ts";
import type { LLMRouter } from "../llm/router.ts";

/**
 * Per-service execution agents. Each one produces ONE markdown document for
 * ONE service. They share a common prompt skeleton: full Spark + full Blueprint
 * + the specific service id + the artifact kind.
 *
 * These agents run on the EXECUTION tier and are called many times in parallel.
 * They MUST output markdown directly (no JSON wrapper).
 */

const SHARED = `You are an execution agent producing ONE markdown documentation file for ONE service.
You MUST:
- Output ONLY the markdown body. No JSON wrapper, no fences around the whole document, no preamble.
- Stay strictly within the service's responsibilities. Never describe what other services do.
- Cross-reference by service id when needed: \`{service-id}\`.
- Be concrete: name actual entities, fields, endpoints. No "etc." filler.
- If a section is genuinely not applicable, write a single line: "_Not applicable for this service._"`;

interface CallArgs {
  router: LLMRouter;
  spark: Spark;
  blueprint: Blueprint;
  service: BlueprintService;
}

export async function genServiceSpark(args: CallArgs): Promise<string> {
  return run(
    args,
    "spark.md",
    `Write the per-service spark.md for service '${args.service.id}'.

Sections to include:
- # Spark — {service name}
- > Identity for this service. Inherits from the project Spark.
- ## Pitch (one sentence: what this service does, in product terms)
- ## Identity (non-negotiable; 2-5 bullets)
- ## Non-goals (2-5 bullets explicit about what this service is NOT)

Keep under 30 lines.`,
  );
}

export async function genServiceBlueprint(args: CallArgs): Promise<string> {
  return run(
    args,
    "blueprint.md",
    `Write the per-service blueprint.md slice for '${args.service.id}'.

Sections:
- # Blueprint — {service name}
- > Frozen plan slice. Source of truth: project /docs/blueprint.md.
- ## Purpose (one paragraph)
- ## Architecture (1-3 paragraphs: how this service is structured internally)
- ## External boundaries (what it consumes, what it exposes)
- ## Data ownership (1-3 sentences; what data this service owns vs. depends on)
- ## Acceptance (3-5 bullets, observable)
- ## Out of scope (3-5 bullets)

Cross-reference dependencies by id: ${args.service.dependsOn.map((d) => `\`${d}\``).join(", ") || "none"}.`,
  );
}

export async function genApiContract(args: CallArgs): Promise<string> {
  if (!args.service.publicApi) {
    return `# API Contract — ${args.service.name}\n\n_This service does not expose a public API. See \`events.md\` if it emits domain events._\n`;
  }
  return run(
    args,
    "api-contract.md",
    `Write api-contract.md for '${args.service.id}'.

Sections:
- # API Contract — {service name}
- ## Transport (HTTP / gRPC / both, with port hints)
- ## Authentication
- ## Endpoints — for each: method, path, request schema, response schema, errors. Use markdown tables or fenced JSON code blocks.
- ## Error model (uniform error envelope)
- ## Rate limits (if any)
- ## Versioning policy (one line)

If gRPC: include the proto package name. If HTTP: include the OpenAPI version target.`,
  );
}

export async function genDataModel(args: CallArgs): Promise<string> {
  return run(
    args,
    "data-model.md",
    `Write data-model.md for '${args.service.id}'.

Sections:
- # Data Model — {service name}
- ## Datastore (one line: postgres / redis / kafka / s3 / …)
- ## Entities — for each: table/collection name, fields with types, primary key, indexes, FK / cross-service references
- ## Ownership (which fields are source-of-truth in this service vs. mirrored from elsewhere)
- ## Retention (per entity, in days/months/years)
- ## Migrations (single line: "Forward-only via ${"{tool}"}".)

Use compact markdown tables. No prose explaining what a primary key is.`,
  );
}

export async function genEvents(args: CallArgs): Promise<string> {
  if (!args.service.emitsEvents) {
    return `# Events — ${args.service.name}\n\n_This service does not publish or consume domain events._\n`;
  }
  return run(
    args,
    "events.md",
    `Write events.md for '${args.service.id}'.

Sections:
- # Events — {service name}
- ## Bus (Redis Streams / NATS / Kafka, with topic prefix)
- ## Published — for each: topic, payload schema, when it fires, idempotency key
- ## Consumed — for each: topic, source service, what triggers handling, error policy

Use fenced JSON for payload schemas. No prose about why events are good.`,
  );
}

export async function genBuildTasks(args: CallArgs): Promise<string> {
  return run(
    args,
    "build-tasks.md",
    `Write build-tasks.md for '${args.service.id}'.

This file is consumed by a coding agent. It MUST contain a numbered, dependency-ordered task list.

Sections:
- # Build Tasks — {service name}
- > Each task is small (≤ 30 minutes). Each task ends in a verifiable test or check.
- ## Tasks
  1. Task title
     - File(s) to create / modify
     - What to do (3-7 bullets)
     - Done when (1-2 bullets, observable)
  2. ...

Aim for 8-15 tasks. Order them: structure → schema → core logic → API/event surface → tests → observability.`,
  );
}

export async function genAcceptance(args: CallArgs): Promise<string> {
  return run(
    args,
    "acceptance.md",
    `Write acceptance.md for '${args.service.id}'.

Sections:
- # Acceptance — {service name}
- ## Observable criteria (5-10 bullets, each verifiable in a test or via curl)
- ## Out of scope (3-5 bullets, things that are explicitly NOT required for "done")
- ## Verification commands (a list of bash one-liners or test commands a reviewer would run)

No prose about what acceptance means.`,
  );
}

export async function genDependencies(args: CallArgs): Promise<string> {
  return run(
    args,
    "dependencies.md",
    `Write dependencies.md for '${args.service.id}'.

Sections:
- # Dependencies — {service name}
- ## Inbound (which services or external clients call this one)
- ## Outbound (which services or external systems this one calls)
- ## Runtime libraries (TS/runtime deps; only the load-bearing ones)
- ## Dev dependencies (test framework, linter, codegen — only the load-bearing ones)
- ## External services (Postgres, Redis, third-party APIs)

Use markdown tables. Reference cross-service deps by id.

This service's declared dependsOn: ${args.service.dependsOn.map((d) => `\`${d}\``).join(", ") || "none"}.`,
  );
}

async function run(args: CallArgs, kind: string, instruction: string): Promise<string> {
  const userPrompt = [
    "## Project Spark",
    "```json",
    JSON.stringify(args.spark, null, 2),
    "```",
    "",
    "## Project Blueprint",
    "```json",
    JSON.stringify(args.blueprint, null, 2),
    "```",
    "",
    "## Service",
    "```json",
    JSON.stringify(args.service, null, 2),
    "```",
    "",
    "## Task",
    `Produce ${kind} for service '${args.service.id}'.`,
    "",
    instruction,
  ].join("\n");

  const res = await args.router.chat({
    tier: "execution",
    messages: [
      { role: "system", content: SHARED },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 4000,
  });
  return res.text.trim();
}
