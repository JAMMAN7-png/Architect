import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import { LLMRouter } from "../../src/llm/router.ts";
import { ProgressBus } from "../../src/orchestrator/events.ts";
import type { PhasePrompts } from "../../src/orchestrator/phase.ts";
import { p1Spark } from "../../src/orchestrator/phases/p1-spark.ts";
import { p2Mode } from "../../src/orchestrator/phases/p2-mode.ts";
import { ArchitectState } from "../../src/orchestrator/state.ts";
import { MockProvider } from "../fixtures/mock-llm.ts";

/**
 * Targeted self-test for the Telegram pre-stage paths added in Phase 4 final.
 * Both phases must short-circuit before touching `prompts.*` when the artifact
 * (file on disk for P1, `state.sparkMode` for P2) is already provided.
 */

function throwingPrompts(): PhasePrompts {
  const fail = (op: string) => {
    throw new Error(`prompts.${op} called — pre-stage gate failed`);
  };
  return {
    text: () => fail("text"),
    select: () => fail("select"),
    confirm: () => fail("confirm"),
  } as unknown as PhasePrompts;
}

function makeRouter() {
  const mock = new MockProvider({ text: "unused" });
  return new LLMRouter(DEFAULT_CONFIG, {
    anthropic: mock,
    openai: mock,
    openrouter: mock,
    deepseek: mock,
    xai: mock,
  });
}

function freshState(root: string): ArchitectState {
  const now = new Date().toISOString();
  return ArchitectState.parse({
    projectId: "test",
    projectName: "test",
    projectRoot: root,
    createdAt: now,
    updatedAt: now,
    currentStage: "P1_SPARK_CAPTURE",
  });
}

describe("phase pre-stage short-circuits", () => {
  test("P1 presents G1 from an existing spark file without prompting", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-p1-prestage-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "docs", "00-human-spark.md"), "Pre-staged spark text.\n", "utf8");

      const state = freshState(root);
      const bus = new ProgressBus();
      const router = makeRouter();
      const next = await p1Spark.run({
        state,
        bus,
        router,
        prompts: throwingPrompts(),
      });

      expect(next.pendingApproval?.gate).toBe("G1");
      expect(next.pendingApproval?.artifact).toBe("docs/00-human-spark.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("P2 presents G2 when sparkMode is already set, without prompting", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-p2-prestage-"));
    try {
      const base = freshState(root);
      const state: ArchitectState = {
        ...base,
        currentStage: "P2_MODE_SELECTION",
        sparkMode: "skip",
      };
      const bus = new ProgressBus();
      const router = makeRouter();
      const next = await p2Mode.run({
        state,
        bus,
        router,
        prompts: throwingPrompts(),
      });

      expect(next.pendingApproval?.gate).toBe("G2");
      expect(next.sparkMode).toBe("skip");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
