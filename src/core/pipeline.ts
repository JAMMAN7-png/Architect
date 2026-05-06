import { join } from "node:path";
import {
  genDependencyGraph,
  genEventMap,
  genServiceMap,
  genSystemOverview,
} from "../agents/architecture.ts";
import { forgeBlueprint } from "../agents/blueprint-architect.ts";
import { reviseBlueprint } from "../agents/blueprint-reviser.ts";
import { runCrossServiceReview } from "../agents/cross-service-consistency.ts";
import {
  genAcceptance,
  genApiContract,
  genBuildTasks,
  genDataModel,
  genDependencies,
  genEvents,
  genServiceBlueprint,
  genServiceSpark,
} from "../agents/per-service.ts";
import { runQaReview } from "../agents/qa-reviewer.ts";
import {
  renderBlueprintMd,
  renderCrossServiceMd,
  renderQaReviewMd,
  renderResearchMd,
} from "../agents/renderers.ts";
import { runBrainstormSession } from "../brainstorm/session.ts";
import { type SparkInput, writeSpark } from "../brainstorm/spec-writer.ts";
import { loadConfig } from "../config/loader.ts";
import { LLMRouter } from "../llm/router.ts";
import { filterFindings, resolveSearchProvider } from "../search/index.ts";
import { joinUnix, readFileMaybe, writeFileSafe } from "../util/fs.ts";
import { fmtUsd } from "../util/io.ts";
import { slugify } from "../util/io.ts";
import { logger } from "../util/logger.ts";
import { Progress } from "../util/progress.ts";
import { mapWithCap } from "../util/promise.ts";
import { buildRegistry, renderRegistryMd } from "./registry.ts";
import type { Blueprint, BlueprintService, ResearchFinding, Spark } from "./types.ts";

const TOTAL_PHASES = 8; // 0-7

export interface PipelineOptions {
  out: string;
  initialIdea: string;
  brainstorm: boolean;
  research: boolean;
  yes: boolean;
  git: boolean;
  startPhase?: number;
  stopAfterPhase?: number;
}

/**
 * End-to-end pipeline. Each phase reads/writes the output dir on disk so phases
 * can be re-run independently via the dedicated CLI commands.
 */
export async function runPipeline(opts: PipelineOptions): Promise<void> {
  const cfg = await loadConfig();
  const router = new LLMRouter(cfg);
  const progress = new Progress();
  const start = opts.startPhase ?? 0;
  const stop = opts.stopAfterPhase ?? TOTAL_PHASES - 1;

  const totalUsd = 0;

  // Phase 0 — Spark
  let spark: Spark | null = null;
  if (start <= 0 && stop >= 0) {
    progress.start(
      { index: 0, total: TOTAL_PHASES, name: "Phase 0 — Spark" },
      "capturing identity",
    );
    spark = await capturePhase0(router, cfg, opts);
    await writeFileSafe(join(opts.out, "docs/spark.md"), writeSpark(toSparkInput(spark)));
    progress.succeed(`spark frozen: ${spark.slug}`);
  } else {
    spark = await loadSpark(opts.out);
  }
  if (!spark) throw new Error("pipeline: no spark available — run phase 0 first");

  // Optional research between Phase 1 and Phase 2
  let research: ResearchFinding[] = [];
  if (opts.research && start <= 1 && stop >= 1) {
    progress.start({ index: 1, total: TOTAL_PHASES, name: "Research" }, "filtering web findings");
    try {
      research = await runResearch(router, cfg, spark);
      await writeFileSafe(join(opts.out, "docs/research/findings.md"), renderResearchMd(research));
      progress.succeed(`research: ${research.length} findings retained`);
    } catch (err) {
      progress.warn(`research skipped: ${(err as Error).message}`);
    }
  }

  // Phase 1 — Blueprint draft
  let blueprintDraft: Blueprint | null = null;
  if (start <= 1 && stop >= 1) {
    progress.start({ index: 1, total: TOTAL_PHASES, name: "Phase 1 — Blueprint forge" }, "");
    blueprintDraft = await forgeBlueprint(router, spark, research);
    await writeFileSafe(
      join(opts.out, "docs/blueprint.draft.md"),
      renderBlueprintMd(blueprintDraft),
    );
    progress.succeed(`blueprint draft: ${blueprintDraft.services.length} services`);
  } else {
    blueprintDraft = await loadBlueprint(opts.out, "draft");
  }

  // Phase 2 — QA attack review
  if (start <= 2 && stop >= 2 && blueprintDraft) {
    progress.start({ index: 2, total: TOTAL_PHASES, name: "Phase 2 — QA attack review" }, "");
    const reviews = await runQaReview(router, blueprintDraft);
    await writeFileSafe(join(opts.out, "docs/qa/blueprint-review.md"), renderQaReviewMd(reviews));
    const totals = reviews.reduce((n, r) => n + r.findings.length, 0);
    progress.succeed(`qa: ${totals} findings across ${reviews.length} perspectives`);

    // Phase 3 — revise + freeze
    if (stop >= 3) {
      progress.start({ index: 3, total: TOTAL_PHASES, name: "Phase 3 — Revise + freeze" }, "");
      const revised = await reviseBlueprint(router, blueprintDraft, reviews);
      await writeFileSafe(join(opts.out, "docs/blueprint.md"), renderBlueprintMd(revised));
      blueprintDraft = revised;
      progress.succeed(`blueprint frozen: ${revised.services.length} services`);
    }
  }

  const blueprint = blueprintDraft ?? (await loadBlueprint(opts.out, "frozen"));
  if (!blueprint) throw new Error("pipeline: no blueprint available — run phases 1-3 first");

  // Phase 4 — service map (architecture docs)
  if (start <= 4 && stop >= 4) {
    progress.start({ index: 4, total: TOTAL_PHASES, name: "Phase 4 — Architecture docs" }, "");
    const [overview, map, graph, eventMap] = await Promise.all([
      genSystemOverview(router, blueprint),
      genServiceMap(router, blueprint),
      genDependencyGraph(router, blueprint),
      genEventMap(router, blueprint),
    ]);
    await Promise.all([
      writeFileSafe(join(opts.out, "docs/architecture/system-overview.md"), overview),
      writeFileSafe(join(opts.out, "docs/architecture/service-map.md"), map),
      writeFileSafe(join(opts.out, "docs/architecture/dependency-graph.md"), graph),
      writeFileSafe(join(opts.out, "docs/architecture/event-map.md"), eventMap),
    ]);
    progress.succeed("architecture docs written");
  }

  // Phase 5 — per-service fanout
  if (start <= 5 && stop >= 5) {
    progress.start(
      { index: 5, total: TOTAL_PHASES, name: "Phase 5 — Per-service fanout" },
      `${blueprint.services.length} services × 8 docs`,
    );
    await mapWithCap(blueprint.services, 6, async (service) => {
      const dir = join(opts.out, service.domain || "services", service.id, "docs");
      const args = { router, spark: spark as Spark, blueprint, service };
      const [sparkMd, bpMd, apiMd, dataMd, eventsMd, tasksMd, accMd, depsMd] = await Promise.all([
        genServiceSpark(args),
        genServiceBlueprint(args),
        genApiContract(args),
        genDataModel(args),
        genEvents(args),
        genBuildTasks(args),
        genAcceptance(args),
        genDependencies(args),
      ]);
      await Promise.all([
        writeFileSafe(join(dir, "spark.md"), sparkMd),
        writeFileSafe(join(dir, "blueprint.md"), bpMd),
        writeFileSafe(join(dir, "api-contract.md"), apiMd),
        writeFileSafe(join(dir, "data-model.md"), dataMd),
        writeFileSafe(join(dir, "events.md"), eventsMd),
        writeFileSafe(join(dir, "build-tasks.md"), tasksMd),
        writeFileSafe(join(dir, "acceptance.md"), accMd),
        writeFileSafe(join(dir, "dependencies.md"), depsMd),
      ]);
      progress.update(`generated ${service.id}`);
    });
    progress.succeed("per-service docs written");
  }

  // Phase 6 — cross-service consistency
  if (start <= 6 && stop >= 6) {
    progress.start({ index: 6, total: TOTAL_PHASES, name: "Phase 6 — Cross-service review" }, "");
    const digest = await readPerServiceDigest(opts.out, blueprint.services);
    const findings = await runCrossServiceReview(router, blueprint, digest);
    await writeFileSafe(
      join(opts.out, "docs/qa/cross-service-review.md"),
      renderCrossServiceMd(findings),
    );
    progress.succeed(`cross-service review: ${findings.length} findings`);
  }

  // Phase 7 — registry
  if (start <= 7 && stop >= 7) {
    progress.start({ index: 7, total: TOTAL_PHASES, name: "Phase 7 — Registry" }, "");
    const entries = await buildRegistry(opts.out, { phase: 7 });
    await writeFileSafe(join(opts.out, "docs/doc-registry.md"), renderRegistryMd(entries));
    progress.succeed(`registry: ${entries.length} entries`);
  }

  logger.info({ totalUsd: fmtUsd(totalUsd) }, "pipeline complete");
}

async function capturePhase0(
  router: LLMRouter,
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  opts: PipelineOptions,
): Promise<Spark> {
  if (opts.brainstorm) {
    const md = await runBrainstormSession({ router, cfg, seed: opts.initialIdea });
    return parseSparkFromMd(md, opts.initialIdea);
  }
  if (!opts.initialIdea) {
    throw new Error(
      "phase 0: no idea provided. Pass an idea file, pipe stdin, or use --brainstorm.",
    );
  }
  // Cheap path: ask the strategic model to extract a structured Spark from the prose idea.
  const res = await router.chat({
    tier: "strategic",
    messages: [
      {
        role: "system",
        content:
          "You convert a free-form product idea into a structured Spark JSON. Output ONLY JSON: " +
          '{"slug": kebab, "pitch": str, "audience": [str], "identity": [str], "nonGoals": [str], "references": [str], "prose": str}',
      },
      { role: "user", content: opts.initialIdea },
    ],
    jsonSchema: {},
    maxTokens: 2000,
  });
  const json = res.json as
    | {
        slug: string;
        pitch: string;
        audience: string[];
        identity: string[];
        nonGoals: string[];
        references: string[];
        prose: string;
      }
    | undefined;
  if (!json) throw new Error("phase 0: failed to parse Spark from idea");
  return {
    slug: slugify(json.slug || "untitled"),
    pitch: json.pitch,
    audience: json.audience ?? [],
    identity: json.identity ?? [],
    nonGoals: json.nonGoals ?? [],
    references: json.references ?? [],
    prose: json.prose ?? opts.initialIdea,
    source: "file",
    frozenAt: new Date().toISOString(),
  };
}

function toSparkInput(s: Spark): SparkInput {
  return {
    slug: s.slug,
    pitch: s.pitch,
    audience: s.audience,
    identity: s.identity,
    nonGoals: s.nonGoals,
    references: s.references,
    prose: s.prose,
  };
}

function parseSparkFromMd(md: string, _seed: string): Spark {
  // Best-effort: brainstorm session.ts already returns the rendered spark.md;
  // we parse the slug from the H1 and treat the rest as opaque. (The Spark JSON
  // is also already encoded in the LLM dialogue; for now we pull a slug.)
  const slugMatch = md.match(/^#\s*Spark\s*[—-]\s*(.+)$/m);
  return {
    slug: slugify(slugMatch?.[1] ?? "untitled"),
    pitch: extractSection(md, "Pitch"),
    audience: extractList(md, "Audience"),
    identity: extractList(md, "Identity (non-negotiable)") || extractList(md, "Identity"),
    nonGoals: extractList(md, "Non-goals"),
    references: extractList(md, "References"),
    prose: extractSection(md, "Prose"),
    source: "interactive",
    frozenAt: new Date().toISOString(),
  };
}

function extractSection(md: string, heading: string): string {
  const re = new RegExp(`##\\s+${escapeRe(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  return md.match(re)?.[1]?.trim() ?? "";
}

function extractList(md: string, heading: string): string[] {
  const section = extractSection(md, heading);
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.match(/^-\s+(.*)$/)?.[1]?.trim())
    .filter((s): s is string => Boolean(s));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadSpark(out: string): Promise<Spark | null> {
  const md = await readFileMaybe(join(out, "docs/spark.md"));
  if (!md) return null;
  return parseSparkFromMd(md, "");
}

async function loadBlueprint(out: string, which: "draft" | "frozen"): Promise<Blueprint | null> {
  // Blueprint is rendered as markdown for humans, but the JSON stays in memory only.
  // For phase resume, we re-derive from the markdown — but for now, require pipeline
  // to keep the in-memory copy. If neither exists, throw.
  const path =
    which === "draft" ? join(out, "docs/blueprint.draft.md") : join(out, "docs/blueprint.md");
  const exists = await readFileMaybe(path);
  if (!exists) return null;
  // Blueprint markdown is a derived view; we can't reverse-parse it to JSON reliably.
  // For phase resume, the user should rerun from phase 1.
  throw new Error(
    "pipeline: cannot resume from disk-only blueprint. Re-run `architect new` from phase 1 (use --start-phase 1).",
  );
}

async function readPerServiceDigest(
  out: string,
  services: BlueprintService[],
): Promise<{ service: string; blueprint: string; apiContract: string; dependencies: string }[]> {
  const out2: { service: string; blueprint: string; apiContract: string; dependencies: string }[] =
    [];
  for (const s of services) {
    const dir = join(out, s.domain || "services", s.id, "docs");
    const [bp, api, dep] = await Promise.all([
      readFileMaybe(join(dir, "blueprint.md")),
      readFileMaybe(join(dir, "api-contract.md")),
      readFileMaybe(join(dir, "dependencies.md")),
    ]);
    out2.push({
      service: s.id,
      blueprint: bp ?? "",
      apiContract: api ?? "",
      dependencies: dep ?? "",
    });
  }
  return out2;
}

async function runResearch(
  router: LLMRouter,
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  spark: Spark,
): Promise<ResearchFinding[]> {
  const provider = resolveSearchProvider(cfg);
  const queries = [
    `${spark.slug} architecture`,
    `${spark.pitch.split(/[.!?]/)[0]?.trim() ?? spark.slug} reference design`,
    `${spark.slug} security best practices`,
  ];
  const objective = `Implementation references for: ${spark.pitch}`;
  const result = await provider.search({
    objective,
    queries,
    processor: "base",
    maxResults: 30,
  });
  // Voiding unused router/cfg path: we still want to filter
  void joinUnix; // keep import alive
  const filtered = await filterFindings(router, objective, result.excerpts, {
    noiseRatio: cfg.search.noise_filter,
    perQueryCap: cfg.search.per_query_cap,
  });
  return filtered;
}
