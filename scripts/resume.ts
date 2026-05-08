#!/usr/bin/env bun
/**
 * Resume an architect pipeline run from a specific phase.
 * Usage: bun scripts/resume.ts <out> <startPhase> [stopAfterPhase]
 */
import { runPipeline } from "../src/core/pipeline.ts";

const [, , outArg, startStr, stopStr] = process.argv;
if (!outArg || !startStr) {
  console.error("usage: bun scripts/resume.ts <out> <startPhase> [stopAfterPhase]");
  process.exit(2);
}

const startPhase = Number(startStr);
const stopAfterPhase = stopStr ? Number(stopStr) : 7;

await runPipeline({
  out: outArg,
  initialIdea: "",
  brainstorm: false,
  research: false,
  yes: true,
  git: false,
  startPhase,
  stopAfterPhase,
});
