import type { ArchitectState } from "../orchestrator/state.ts";
import type { ManifestEntry } from "../validate/docs.ts";

/**
 * Documentation Governor. Generates the manifest whitelist deterministically
 * from current state — no LLM call. The manifest is the canonical list of
 * every `.md` Architect's pipeline is allowed to emit for this project.
 */

export function buildManifest(state: ArchitectState): ManifestEntry[] {
  const entries: ManifestEntry[] = [
    { path: "docs/00-human-spark.md", purpose: "Immutable human spark (write-once after G1)" },
    {
      path: "docs/02-approved-product-essence.md",
      purpose: "Approved Product Essence (G3 output)",
    },
    { path: "docs/03-blueprint-sketch.md", purpose: "Low-res skeleton (G4 output)" },
    { path: "docs/04-approved-decisions.md", purpose: "Settled decision sheet (G8 output)" },
    { path: "docs/05-docs-manifest.md", purpose: "This manifest (G9 output)" },
    {
      path: "docs/research/00-research-subjects.md",
      purpose: "Approved research targets (G5 output)",
    },
    {
      path: "docs/research/01-user-preferences.md",
      purpose: "Stack questionnaire answers (G6 output)",
    },
    {
      path: "docs/research/02-approach-decisions.md",
      purpose: "Approach questionnaire answers (G7 output)",
    },
    { path: "docs/qa/blueprint-review.md", purpose: "QA review of the Blueprint" },
  ];
  if (state.sparkMode === "brainstorm") {
    entries.push({ path: "docs/01-grown-spark.md", purpose: "Grown spark (Brainstorm path)" });
  }
  if (state.sparkMode === "checkup") {
    entries.push({ path: "docs/01-spark-checkup.md", purpose: "Spark checkup (Checkup path)" });
  }
  for (const t of state.researchTargets) {
    if (!t.approved) continue;
    entries.push({
      path: `docs/research/${t.id}.md`,
      purpose: `Research doc for ${t.name}`,
    });
  }
  // Glob entries — Blueprint sections are written by P12 in numbered files.
  entries.push({
    path: "docs/blueprint/**/*.md",
    pattern: "docs/blueprint/**/*.md",
    purpose: "Blueprint sections (G10 output, immutable after lock)",
  });
  return entries;
}

export function renderManifestDoc(entries: ManifestEntry[]): string {
  const lines: string[] = ["# Docs Manifest", "", "## Whitelist", ""];
  for (const e of entries) {
    lines.push(`- \`${e.path}\` — ${e.purpose}`);
  }
  lines.push("", "_Any `.md` in this project not on the whitelist is a violation._");
  return lines.join("\n");
}
