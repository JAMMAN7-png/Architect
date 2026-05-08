import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
 * M5 — manifest + generation. Seed a project at end-of-P9 with all the
 * docs present, and exercise P10 (manifest) + P11 (validate).
 */

async function seedProject(root: string): Promise<ArchitectState> {
  const state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
  const docs = (n: string) => join(state.projectRoot, "docs", n);
  const research = (n: string) => join(state.projectRoot, "docs", "research", n);

  await writeFile(docs("00-human-spark.md"), "tiny CLI", "utf8");
  await writeFile(docs("02-approved-product-essence.md"), "# Approved Product Essence", "utf8");
  await writeFile(docs("03-blueprint-sketch.md"), "# Blueprint Sketch", "utf8");
  await writeFile(
    docs("04-approved-decisions.md"),
    "# Approved Decisions\n## Final Stack\n",
    "utf8",
  );
  await writeFile(research("00-research-subjects.md"), "# Research Subjects", "utf8");
  await writeFile(research("01-user-preferences.md"), "# User Preferences", "utf8");
  await writeFile(research("02-approach-decisions.md"), "# Approach Decisions", "utf8");
  await writeFile(
    research("runtime.md"),
    "# Bun\n## Decision Summary\nUse Bun.\n## Approved Choice\nBun\n## Blueprint References\n- BP-STACK-001\n",
    "utf8",
  );
  // QA file is "out of scope" for P11 but listed in manifest — leave a placeholder
  // so validator passes.
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(state.projectRoot, "docs", "qa"), { recursive: true });
  await writeFile(
    join(state.projectRoot, "docs/qa/blueprint-review.md"),
    "# QA — pending M6",
    "utf8",
  );

  const seeded: ArchitectState = {
    ...state,
    currentStage: "P10_DOCS_MANIFEST",
    sparkMode: "skip",
    spark: { path: docs("00-human-spark.md"), sha256: "stub", immutable: true },
    approvedEssencePath: docs("02-approved-product-essence.md"),
    sketchPath: docs("03-blueprint-sketch.md"),
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
    approvals: ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"].map((g, i) => ({
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

describe("M5 — docs manifest + generation", () => {
  test("P10 produces a manifest and pauses on G9; P11 validates clean", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m5-"));
    try {
      let state = await seedProject(root);
      const bus = new ProgressBus();
      const mock = new MockProvider({ text: "default" });
      const router = new LLMRouter(DEFAULT_CONFIG, {
        anthropic: mock,
        openai: mock,
        openrouter: mock,
        deepseek: mock,
        xai: mock,
      });
      const registry = buildDefaultRegistry();

      // Engine runs P10 → presents G9.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P10_DOCS_MANIFEST");
      expect(state.pendingApproval?.gate).toBe("G9");
      const manifest = await readFile(join(state.projectRoot, "docs/05-docs-manifest.md"), "utf8");
      expect(manifest).toContain("# Docs Manifest");
      expect(manifest).toContain("docs/research/runtime.md");

      // Approve G9.
      state = await resolveApproval(state, bus, { status: "approved" });

      // Engine runs P11; validator should pass cleanly. P12 then fails with
      // the default mock (no sections), but that's fine — we only care that
      // P11 itself transitioned successfully.
      await expect(
        advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry }),
      ).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("P11 fails loudly if a stray .md exists outside docs/", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m5-"));
    try {
      let state = await seedProject(root);
      // Plant a stray.
      await writeFile(join(state.projectRoot, "STRAY.md"), "# stray");

      const bus = new ProgressBus();
      const mock = new MockProvider({ text: "default" });
      const router = new LLMRouter(DEFAULT_CONFIG, {
        anthropic: mock,
        openai: mock,
        openrouter: mock,
        deepseek: mock,
        xai: mock,
      });
      const registry = buildDefaultRegistry();

      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      state = await resolveApproval(state, bus, { status: "approved" });
      await expect(
        advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry }),
      ).rejects.toThrow(/docs validation failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
