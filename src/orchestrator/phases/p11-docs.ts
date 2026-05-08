import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeManifestDoc } from "../../agents/docs-writer.ts";
import { docExists, readDoc, writeDoc } from "../../util/files.ts";
import { mapWithCap } from "../../util/promise.ts";
import { type ManifestEntry, validateDocs } from "../../validate/docs.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

/**
 * P11 — Docs Generation. No gate; bounded by the manifest.
 *
 * Strategy:
 *   1. Load manifest from `docs/_manifest.json`.
 *   2. For every literal entry that doesn't exist and is in scope for this
 *      phase, generate via the execution-tier LLM.
 *   3. Run the docs validator. Hard-fail on errors.
 *
 * Out-of-scope entries: anything under `docs/blueprint/**` (P12 owns) and
 * `docs/qa/**` (M6 owns).
 */
export const p11Docs: PhaseDefinition = {
  stage: "P11_DOCS_GENERATION",
  label: "Docs generation",
  run: async (ctx) => runP11(ctx),
};

async function runP11(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus, router } = ctx;
  const manifestPath = resolve(state.projectRoot, "docs", "_manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ManifestEntry[];

  const literal = manifest.filter((e) => !e.pattern);
  const inScope = literal.filter((e) => !isOutOfScope(e.path));

  // Build the shared context block from approved decisions.
  const decisionsText = state.decisionsPath ? await readDoc(state.decisionsPath) : "";
  const essenceText = state.approvedEssencePath ? await readDoc(state.approvedEssencePath) : "";
  const context = `${essenceText}\n\n---\n\n${decisionsText}`.trim();

  const missing: ManifestEntry[] = [];
  for (const entry of inScope) {
    const abs = join(state.projectRoot, entry.path);
    if (!(await docExists(abs))) missing.push(entry);
  }

  if (missing.length > 0) {
    bus.emit({ type: "info", message: `generating ${missing.length} missing docs` });
    await mapWithCap(missing, 4, async (entry) => {
      const result = await writeManifestDoc({ router, bus, request: { entry, context } });
      const target = join(state.projectRoot, entry.path);
      await writeDoc(target, result.content);
    });
  }

  const validation = await validateDocs(state.projectRoot, manifest);
  if (!validation.ok) {
    for (const e of validation.errors) bus.emit({ type: "error", message: e, recoverable: false });
    throw new Error(`docs validation failed: ${validation.errors.length} errors`);
  }
  for (const w of validation.warnings) bus.emit({ type: "warning", message: w });

  return state;
}

function isOutOfScope(path: string): boolean {
  return path.startsWith("docs/blueprint/") || path.startsWith("docs/qa/");
}
