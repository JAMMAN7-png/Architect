import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifest, renderManifestDoc } from "../../agents/docs-governor.ts";
import { projectDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

export const p10Manifest: PhaseDefinition = {
  stage: "P10_DOCS_MANIFEST",
  label: "Docs manifest",
  run: async (ctx) => runP10(ctx),
};

async function runP10(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, bus } = ctx;
  const last = lastApprovalFor(state, "G9");
  if (last?.status === "approved" && state.docsManifestPath) return state;
  if (last?.status === "rejected") throw new Error("docs manifest rejected (G9)");

  const entries = buildManifest(state);
  const docPath = projectDoc(state.projectRoot, "05-docs-manifest.md");
  await writeDoc(docPath, renderManifestDoc(entries));
  const jsonPath = resolve(state.projectRoot, "docs", "_manifest.json");
  await writeFile(jsonPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");

  return presentApproval({ ...state, docsManifestPath: docPath }, bus, {
    gate: "G9",
    artifact: "docs/05-docs-manifest.md",
    label: `Approve docs manifest — ${entries.length} entries`,
  });
}
