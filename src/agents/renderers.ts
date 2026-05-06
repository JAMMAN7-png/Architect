/**
 * Deterministic renderers for documents that do not need an LLM:
 *  - root spark.md is rendered from the Spark struct (already done in brainstorm/spec-writer).
 *  - root blueprint.md is a markdown view over the Blueprint JSON.
 *  - QA review markdown is a deterministic transformation of QaReview[].
 */

import type { Blueprint, QaFinding, QaReview } from "../core/types.ts";

export function renderBlueprintMd(blueprint: Blueprint): string {
  const lines: string[] = [];
  lines.push("# Blueprint");
  lines.push("");
  lines.push(
    "> Frozen. The execution contract for the entire project. Source-of-truth for every service.",
  );
  lines.push("");
  lines.push(`**Schema version:** ${blueprint.schemaVersion}`);
  lines.push(`**Frozen at:** ${blueprint.frozenAt}`);
  lines.push(`**Spark:** \`${blueprint.sparkSlug}\``);
  lines.push(`**Architecture:** ${blueprint.architectureStyle}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(blueprint.summary);
  lines.push("");
  lines.push("## Cross-cutting");
  lines.push("");
  lines.push(`- **Auth:** ${blueprint.crossCutting.auth}`);
  lines.push(`- **Observability:** ${blueprint.crossCutting.observability}`);
  lines.push(`- **Deployment:** ${blueprint.crossCutting.deployment}`);
  lines.push(`- **Data store:** ${blueprint.crossCutting.dataStore}`);
  lines.push(`- **Event bus:** ${blueprint.crossCutting.eventBus ?? "_none_"}`);
  lines.push("");
  lines.push("## Services");
  lines.push("");
  lines.push("| id | domain | purpose | priority | depends on | api | events | sec? |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of blueprint.services) {
    lines.push(
      `| \`${s.id}\` | ${s.domain} | ${s.purpose} | ${s.priority} | ${
        s.dependsOn.map((d) => `\`${d}\``).join(", ") || "_none_"
      } | ${s.publicApi ? "✓" : ""} | ${s.emitsEvents ? "✓" : ""} | ${s.securityCritical ? "✓" : ""} |`,
    );
  }
  lines.push("");
  lines.push("## Build sequence");
  lines.push("");
  blueprint.buildSequence.forEach((id, i) => lines.push(`${i + 1}. \`${id}\``));
  lines.push("");
  lines.push("## Acceptance");
  lines.push("");
  for (const a of blueprint.acceptance) lines.push(`- ${a}`);
  lines.push("");
  lines.push(`## UI: ${blueprint.hasUi ? "yes" : "no"}`);
  lines.push(`## Research surface: ${blueprint.hasResearch ? "yes" : "no"}`);
  lines.push("");
  return lines.join("\n");
}

export function renderQaReviewMd(reviews: QaReview[]): string {
  const lines: string[] = [];
  lines.push("# Blueprint Review");
  lines.push("");
  lines.push("> Multi-perspective adversarial review of the frozen Blueprint draft.");
  lines.push("");
  const totals = countSeverity(reviews.flatMap((r) => r.findings));
  lines.push(
    `**Findings:** ${totals.blocker} blocker · ${totals.major} major · ${totals.minor} minor · ${totals.info} info`,
  );
  lines.push("");
  for (const r of reviews) {
    lines.push(`## ${r.perspective}`);
    lines.push(`_reviewer: \`${r.reviewerModel}\`_`);
    lines.push("");
    if (r.findings.length === 0) {
      lines.push("_No findings from this perspective._");
      lines.push("");
      continue;
    }
    for (const f of sortFindings(r.findings)) {
      lines.push(`### \`${f.severity}\` · ${f.category} · ${f.scope}`);
      lines.push("");
      lines.push(`**Problem:** ${f.problem}`);
      lines.push("");
      lines.push(`**Recommendation:** ${f.recommendation}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function renderCrossServiceMd(findings: unknown[]): string {
  const lines: string[] = [];
  lines.push("# Cross-Service Consistency Review");
  lines.push("");
  lines.push(`**Findings:** ${findings.length}`);
  lines.push("");
  if (findings.length === 0) {
    lines.push("_No cross-service inconsistencies detected._");
    return lines.join("\n");
  }
  for (const f of findings as QaFinding[]) {
    lines.push(`### \`${f.severity ?? "info"}\` · ${f.scope ?? ""}`);
    lines.push("");
    lines.push(`**Problem:** ${f.problem ?? ""}`);
    lines.push("");
    lines.push(`**Recommendation:** ${f.recommendation ?? ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderResearchMd(
  findings: { url: string; title: string; excerpt: string; relevance: string }[],
): string {
  const lines: string[] = [];
  lines.push("# Research Findings");
  lines.push("");
  lines.push("> Filtered to implementation-relevant findings only.");
  lines.push(`**Findings:** ${findings.length}`);
  lines.push("");
  for (const f of findings) {
    lines.push(`### [${f.title}](${f.url})`);
    lines.push("");
    lines.push(f.excerpt);
    lines.push("");
    lines.push(`_Why it matters:_ ${f.relevance}`);
    lines.push("");
  }
  return lines.join("\n");
}

function countSeverity(findings: QaFinding[]) {
  return findings.reduce(
    (acc, f) => {
      acc[f.severity]++;
      return acc;
    },
    { blocker: 0, major: 0, minor: 0, info: 0 } as Record<QaFinding["severity"], number>,
  );
}

function sortFindings(findings: QaFinding[]): QaFinding[] {
  const order: Record<QaFinding["severity"], number> = {
    blocker: 0,
    major: 1,
    minor: 2,
    info: 3,
  };
  return [...findings].sort(
    (a, b) => order[a.severity] - order[b.severity] || a.scope.localeCompare(b.scope),
  );
}
