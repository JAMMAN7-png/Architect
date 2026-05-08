import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import { LLMRouter } from "../../src/llm/router.ts";
import { resolveApproval } from "../../src/orchestrator/approvals.ts";
import { bootstrapProject } from "../../src/orchestrator/bootstrap.ts";
import { advance } from "../../src/orchestrator/engine.ts";
import { ProgressBus } from "../../src/orchestrator/events.ts";
import { buildDefaultRegistry } from "../../src/orchestrator/phases/index.ts";
import type { ArchitectState } from "../../src/orchestrator/state.ts";
import { saveState } from "../../src/orchestrator/store.ts";
import { MockProvider } from "../fixtures/mock-llm.ts";
import { ScriptedPrompts } from "../fixtures/scripted-prompts.ts";

/**
 * M6 — Blueprint assembly + QA + lock.
 * Seeds a project at end-of-P11 and exercises P12 with a mocked Architect
 * that returns 16 sections including a valid step in the roadmap section.
 */

const STEP = `## BP-CORE-001 — Wire orchestrator
### Goal
Stand up the state machine.
### Inputs
- docs/research/runtime.md
- docs/04-approved-decisions.md
### Files To Create
- src/orchestrator/state.ts
### Implementation Steps
1. Define stages
2. Add reducer
### Acceptance Criteria
- bun test passes
### Prohibited
- Adding XState
`;

function makeBlueprintSections() {
  const sections: { file: string; content: string }[] = [];
  for (const file of [
    "00-overview.md",
    "01-product-scope.md",
    "02-approved-stack.md",
    "03-system-architecture.md",
    "04-state-machine.md",
    "05-cli-interface.md",
    "06-telegram-interface.md",
    "07-model-routing.md",
    "08-docs-generation.md",
    "09-human-approval-gates.md",
    "10-data-model.md",
    "11-module-map.md",
    "13-test-plan.md",
    "14-validation-plan.md",
    "15-acceptance-criteria.md",
  ]) {
    sections.push({ file, content: `# ${file}\n\nLean section.` });
  }
  sections.push({
    file: "12-implementation-roadmap.md",
    content: `# Implementation Roadmap\n\n${STEP}`,
  });
  return sections;
}

async function seedProject(root: string): Promise<ArchitectState> {
  const state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
  const docs = (n: string) => join(state.projectRoot, "docs", n);
  await mkdir(join(state.projectRoot, "docs/research"), { recursive: true });
  await mkdir(join(state.projectRoot, "docs/qa"), { recursive: true });
  await writeFile(docs("00-human-spark.md"), "tiny CLI", "utf8");
  await writeFile(docs("02-approved-product-essence.md"), "# Approved Product Essence", "utf8");
  await writeFile(
    docs("04-approved-decisions.md"),
    "# Approved Decisions\n## Final Stack\nBun",
    "utf8",
  );
  await writeFile(
    docs("research/runtime.md"),
    "# Bun\n## Decision Summary\nUse Bun.\n## Approved Choice\nBun\n## Blueprint References\n- BP-CORE-001\n",
    "utf8",
  );

  const seeded: ArchitectState = {
    ...state,
    currentStage: "P12_BLUEPRINT_ASSEMBLY",
    sparkMode: "skip",
    spark: { path: docs("00-human-spark.md"), sha256: "stub", immutable: true },
    approvedEssencePath: docs("02-approved-product-essence.md"),
    decisionsPath: docs("04-approved-decisions.md"),
    researchTargets: [
      {
        id: "runtime",
        name: "Bun",
        category: "runtime",
        rationale: "x",
        userSpecified: true,
        approved: true,
      },
    ],
    approvals: ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"].map((g, i) => ({
      id: `APPROVAL-${String(i + 1).padStart(3, "0")}`,
      gate: g as ArchitectState["approvals"][number]["gate"],
      status: "approved" as const,
      artifact: `seed-${g}`,
      approvedBy: "user" as const,
      signedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
  await saveState(seeded);
  return seeded;
}

function makeRouter() {
  const sectionsPayload = { sections: makeBlueprintSections() };
  const mock = new MockProvider({ text: "default" });
  mock.onSystemContains("Blueprint Architect", {
    text: JSON.stringify(sectionsPayload),
    json: sectionsPayload,
  });
  mock.onSystemContains("adversarial Blueprint reviewer", {
    text: "Blueprint looks fine.\n\n## Findings\n_(none)_",
  });
  mock.onSystemContains("cheap coder agent dry-running", {
    text: JSON.stringify({ ambiguous: false, reasons: [] }),
    json: { ambiguous: false, reasons: [] },
  });
  return new LLMRouter(DEFAULT_CONFIG, {
    anthropic: mock,
    openai: mock,
    openrouter: mock,
    deepseek: mock,
    xai: mock,
  });
}

describe("M6 — blueprint assembly + lock", () => {
  test("P12 generates 16 sections, validates, reviews, presents G10, then locks", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m6-"));
    try {
      let state = await seedProject(root);
      const bus = new ProgressBus();
      const router = makeRouter();
      const registry = buildDefaultRegistry();

      // First leg: build + present G10.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P12_BLUEPRINT_ASSEMBLY");
      expect(state.pendingApproval?.gate).toBe("G10");

      // 16 files written.
      const files = await readDir(join(state.projectRoot, "docs/blueprint"));
      expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(16);
      const review = await readFile(join(state.projectRoot, "docs/qa/blueprint-review.md"), "utf8");
      expect(review).toContain("## Findings");

      // Approve G10.
      state = await resolveApproval(state, bus, { status: "approved" });

      // Second leg: lock.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.blueprintLocked).toBe(true);
      expect(state.currentStage).toBe("DONE");
      expect(state.blueprintLockedAt).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

async function readDir(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = (await readdir(dir, {
    withFileTypes: true,
    encoding: "utf8",
  })) as unknown as Array<{
    name: string;
    isFile(): boolean;
  }>;
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}
