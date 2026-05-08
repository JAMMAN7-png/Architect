/**
 * Render a Spark object into the canonical docs/spark.md markdown.
 * Deterministic — no LLM involved.
 */

export interface SparkInput {
  slug: string;
  pitch: string;
  audience: string[];
  identity: string[];
  nonGoals: string[];
  references: string[];
  prose: string;
}

export function writeSpark(spark: SparkInput): string {
  const now = new Date().toISOString();

  const sections: string[] = [];
  sections.push(`# Spark — ${escapePipe(spark.slug)}`);
  sections.push("");
  sections.push("> Immutable. The product's identity. AI agents may not modify this file.");
  sections.push("");
  sections.push(`**Frozen at:** ${now}`);
  sections.push("");

  sections.push("## Pitch");
  sections.push("");
  sections.push(spark.pitch.trim());
  sections.push("");

  sections.push("## Audience");
  sections.push("");
  for (const a of spark.audience) sections.push(`- ${a.trim()}`);
  if (spark.audience.length === 0) sections.push("- _(none captured)_");
  sections.push("");

  sections.push("## Identity (non-negotiable)");
  sections.push("");
  for (const i of spark.identity) sections.push(`- ${i.trim()}`);
  if (spark.identity.length === 0) sections.push("- _(none captured)_");
  sections.push("");

  sections.push("## Non-goals");
  sections.push("");
  for (const n of spark.nonGoals) sections.push(`- ${n.trim()}`);
  if (spark.nonGoals.length === 0) sections.push("- _(none captured)_");
  sections.push("");

  if (spark.references.length > 0) {
    sections.push("## References");
    sections.push("");
    for (const r of spark.references) sections.push(`- ${r.trim()}`);
    sections.push("");
  }

  if (spark.prose.trim()) {
    sections.push("## Prose");
    sections.push("");
    sections.push(spark.prose.trim());
    sections.push("");
  }

  return sections.join("\n");
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}
