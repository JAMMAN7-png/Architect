import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import { LLMRouter } from "../../src/llm/router.ts";
import { resolveApproval } from "../../src/orchestrator/approvals.ts";
import { bootstrapProject } from "../../src/orchestrator/bootstrap.ts";
import { advance } from "../../src/orchestrator/engine.ts";
import { ProgressBus } from "../../src/orchestrator/events.ts";
import { buildDefaultRegistry } from "../../src/orchestrator/phases/index.ts";
import { loadState } from "../../src/orchestrator/store.ts";
import { MockProvider } from "../fixtures/mock-llm.ts";
import { ScriptedPrompts } from "../fixtures/scripted-prompts.ts";

/**
 * E2E exercise of P1→P3 with a mocked LLM router and scripted prompts.
 * Verifies spark capture + immutability, mode selection, brainstorm path,
 * and persistence across paused/resumed engine runs.
 */

const SPARK_TEXT = "Build a tiny CLI that turns ideas into blueprints. Human in the loop.";
const GROWN =
  "# Grown Spark\n## Essential Identity (verbatim from input — DO NOT change)\nBuild a tiny CLI…\n## Product Summary\n…";
const ESSENCE =
  "# Approved Product Essence\n## Identity\nA human-in-the-loop CLI blueprint compiler.";

function makeRouter(overrides?: Record<string, MockProvider>) {
  const mock = new MockProvider({ text: "default" });
  mock.onSystemContains("brainstorming method", { text: GROWN });
  mock.onSystemContains("GAP CHECKUP", { text: "# Spark Checkup\n## Strengths\n…" });
  mock.onSystemContains("Approved Product Essence", { text: ESSENCE });
  const final = overrides ?? {
    anthropic: mock,
    openai: mock,
    openrouter: mock,
    deepseek: mock,
    xai: mock,
  };
  return new LLMRouter(DEFAULT_CONFIG, final);
}

describe("M2 — spark capture + maturation (brainstorm)", () => {
  test("full P1→P3 round-trip across pauses", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m2-"));
    try {
      let state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
      const bus = new ProgressBus();
      const router = makeRouter();
      const registry = buildDefaultRegistry();

      // Leg 1: capture spark, present G1.
      const p1 = new ScriptedPrompts([
        { kind: "select", value: "type" },
        { kind: "text", value: SPARK_TEXT },
      ]);
      state = await advance(state, { bus, router, prompts: p1, registry });
      expect(state.currentStage).toBe("P1_SPARK_CAPTURE");
      expect(state.pendingApproval?.gate).toBe("G1");
      expect(p1.remaining()).toBe(0);

      // Approve G1.
      state = await resolveApproval(state, bus, { status: "approved" });

      // Leg 2: freeze spark, present G2.
      const p2 = new ScriptedPrompts([{ kind: "select", value: "brainstorm" }]);
      state = await advance(state, { bus, router, prompts: p2, registry });
      expect(state.spark?.immutable).toBe(true);
      expect(state.currentStage).toBe("P2_MODE_SELECTION");
      expect(state.pendingApproval?.gate).toBe("G2");

      state = await resolveApproval(state, bus, { status: "approved" });

      // Leg 3: P3 brainstorm + present G3.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P3_SPARK_MATURATION");
      expect(state.pendingApproval?.gate).toBe("G3");
      expect(state.grownSparkPath).not.toBeNull();
      const grown = await readFile(state.grownSparkPath as string, "utf8");
      expect(grown).toContain("Grown Spark");

      state = await resolveApproval(state, bus, { status: "approved" });

      // Leg 4: P3 derives approved-essence, engine continues into P4 sketch
      // (which uses the default mock response) and halts at G4.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.approvedEssencePath).not.toBeNull();
      const essence = await readFile(state.approvedEssencePath as string, "utf8");
      expect(essence).toContain("Approved Product Essence");
      expect(state.currentStage).toBe("P4_BLUEPRINT_SKETCH");
      expect(state.pendingApproval?.gate).toBe("G4");
      expect(state.approvals).toHaveLength(3);

      // State is durable across runs.
      const reloaded = await loadState(state.projectRoot);
      expect(reloaded.approvedEssencePath).toBe(state.approvedEssencePath);
      expect(reloaded.currentStage).toBe("P4_BLUEPRINT_SKETCH");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M2 — checkup mode", () => {
  test("checkup writes 01-spark-checkup.md, no grown-spark file", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m2-"));
    try {
      let state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
      const bus = new ProgressBus();
      const router = makeRouter();
      const registry = buildDefaultRegistry();

      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([
          { kind: "select", value: "type" },
          { kind: "text", value: SPARK_TEXT },
        ]),
        registry,
      });
      state = await resolveApproval(state, bus, { status: "approved" });

      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([{ kind: "select", value: "checkup" }]),
        registry,
      });
      state = await resolveApproval(state, bus, { status: "approved" });

      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.checkupPath).not.toBeNull();
      expect(state.grownSparkPath).toBeNull();
      const checkup = await readFile(state.checkupPath as string, "utf8");
      expect(checkup).toContain("Spark Checkup");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M2 — skip mode", () => {
  test("skip continues with spark unchanged, still derives essence on G3", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m2-"));
    try {
      let state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
      const bus = new ProgressBus();
      const router = makeRouter();
      const registry = buildDefaultRegistry();

      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([
          { kind: "select", value: "type" },
          { kind: "text", value: SPARK_TEXT },
        ]),
        registry,
      });
      state = await resolveApproval(state, bus, { status: "approved" });

      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([{ kind: "select", value: "skip" }]),
        registry,
      });
      state = await resolveApproval(state, bus, { status: "approved" });

      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P3_SPARK_MATURATION");
      expect(state.pendingApproval?.gate).toBe("G3");
      expect(state.grownSparkPath).toBeNull();
      expect(state.checkupPath).toBeNull();

      state = await resolveApproval(state, bus, { status: "approved" });
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P4_BLUEPRINT_SKETCH");
      expect(state.pendingApproval?.gate).toBe("G4");
      const reloaded = await loadState(state.projectRoot);
      expect(reloaded.approvedEssencePath).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
