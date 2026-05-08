import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import { registerArchitectActions } from "../../src/interface/telegram/architect/actions.ts";
import {
  architectPages,
  registerModePageActions,
  registerSparkPageActions,
} from "../../src/interface/telegram/architect/pages/index.ts";
import { makeArchitectRunner } from "../../src/interface/telegram/architect/runner.ts";
import { TeleFocus } from "../../src/interface/telegram/engine/bootstrap.ts";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import type { ServicesShape } from "../../src/interface/telegram/engine/types.ts";
import { adaptUpdate } from "../../src/interface/telegram/grammy-adapter.ts";
import { LLMRouter } from "../../src/llm/router.ts";
import { ProgressBus } from "../../src/orchestrator/events.ts";
import { buildDefaultRegistry } from "../../src/orchestrator/phases/index.ts";

import { FakeBot } from "../fixtures/fake-grammy.ts";
import { MockProvider } from "../fixtures/mock-llm.ts";

/**
 * E2E smoke for the architect Telegram bridge over the engine pipeline.
 *
 * Drives a fresh project from welcome → G1 (spark) → G2 (mode=skip) → G3
 * (maturation) by injecting fake grammY updates against the production
 * action handlers and the engine's `runPipeline` middleware chain. No
 * real bot is started; the LLM router is wired to {@link MockProvider}
 * with canned responses for every tier.
 *
 * The skip-mode path keeps the test deterministic and exercises:
 *   - `welcomePage` → `sparkPage` navigation (callbackQuery dispatch)
 *   - `architect_spark` input flow capture (text update)
 *   - G1 approval action → P1 freeze + P2 transition
 *   - `/mode` selection action → G2 pending
 *   - G2 approval → P3 maturation pending at G3
 *   - G3 approval → essence written + P4 sketch pending at G4
 */

const SPARK_TEXT = "Build a tiny CLI that turns ideas into blueprints. Human in the loop.";
const ESSENCE =
  "# Approved Product Essence\n## Identity\nA human-in-the-loop CLI blueprint compiler.";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function buildRouter(): LLMRouter {
  const mock = new MockProvider({ text: "default" });
  // P3 brainstorm path — unused for skip mode but registered for safety.
  mock.onSystemContains("brainstorming method", { text: "# Grown Spark\n…" });
  mock.onSystemContains("GAP CHECKUP", { text: "# Spark Checkup\n…" });
  mock.onSystemContains("Approved Product Essence", { text: ESSENCE });
  return new LLMRouter(DEFAULT_CONFIG, {
    anthropic: mock,
    openai: mock,
    openrouter: mock,
    deepseek: mock,
    xai: mock,
  });
}

describe("M7 — TeleFocus engine + architect bridge E2E", () => {
  test("welcome → spark capture → G1 → mode skip → G2 → G3 → pause at G4", async () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "arch-m7-"));
    try {
      // ── Engine + runner wiring (startTelefocusBot-equivalent) ──────
      const store = new MemorySessionStore();
      const router = buildRouter();
      const bus = new ProgressBus();
      const phases = buildDefaultRegistry();
      const runner = makeArchitectRunner({ router, bus, phases });

      // Use a private registry so the module-level `defaultRegistry` is
      // untouched by other tests.
      const registry = new PageRegistry();
      const services: ServicesShape = {};
      const tf = TeleFocus.attach({ store, registry, pages: architectPages, services });

      // Pages and runner need access to each other through `ctx.services`.
      services.architect = runner;
      services.nav = { registry: tf.registry, renderer: tf.renderer, store };
      services.projectsRoot = projectsRoot;

      const bot = new FakeBot();
      const grammyBot = bot.asBot();
      const actionDeps = {
        runner,
        renderer: tf.renderer,
        registry: tf.registry,
        store,
        flow: tf.flow,
        services,
      };
      registerArchitectActions(grammyBot, actionDeps);
      registerSparkPageActions(grammyBot, actionDeps);
      registerModePageActions(grammyBot, actionDeps);

      bot.use(async (grammyCtx) => {
        const ctx = await adaptUpdate(grammyCtx, services);
        if (ctx === null) return;
        await tf.handle(ctx);
      });

      // ── Drive the conversation ─────────────────────────────────────
      const origin = { from: { id: 1 }, chat: { id: 1 } };

      // 1. /start primes the session via the catch-all pipeline. With no
      //    `/start` command handler registered, the engine's router
      //    middleware falls through; session-loader + session-save run.
      await bot.inject({ message: { text: "/start" } }, origin);

      // 2. Bootstrap a project on disk and bind it to the session.
      const initial = await runner.newProject({ projectName: "demo", projectsRoot });
      const session = await store.load(origin.from.id, origin.chat.id);
      session.projectRoot = initial.projectRoot;
      const saved = await store.save(session);
      expect(saved).toBe(true);

      // 3. nav:/spark — engine pipeline navigates and renders the page.
      await bot.inject({ callbackQuery: { data: "nav:/spark" } }, origin);
      {
        const s = await store.load(origin.from.id, origin.chat.id);
        expect(s.menu.currentPage).toBe("/spark");
      }

      // 4. Start the spark capture flow (the page's `📝 Capture spark`
      //    button), then send the spark text. The engine's input-capture
      //    middleware feeds the message to the flow, whose `onComplete`
      //    writes `docs/00-human-spark.md`, drives the orchestrator, and
      //    re-navigates to `/spark` so the G1 keyboard renders.
      await bot.inject({ callbackQuery: { data: "action:architect:spark:begin" } }, origin);
      {
        const s = await store.load(origin.from.id, origin.chat.id);
        expect(s.inputFlow.active).toBe(true);
        expect(s.inputFlow.flowId).toBe("architect_spark");
      }

      await bot.inject({ message: { text: SPARK_TEXT } }, origin);

      const sparkDocPath = join(initial.projectRoot, "docs", "00-human-spark.md");
      expect(await pathExists(sparkDocPath)).toBe(true);
      {
        const stateAfterCapture = await runner.loadCurrent(initial.projectRoot);
        expect(stateAfterCapture).not.toBeNull();
        expect(stateAfterCapture?.currentStage).toBe("P1_SPARK_CAPTURE");
        expect(stateAfterCapture?.pendingApproval?.gate).toBe("G1");
      }

      // 5. Approve G1 — runner records approval and advances. P2 will
      //    throw on `prompts.select` because `sparkMode` is still null;
      //    the action handler catches that and emits a danger toast.
      //    The orchestrator state nevertheless transitions to P2 because
      //    the engine saves state across the P1→P2 boundary before P2
      //    runs.
      await bot.inject({ callbackQuery: { data: "action:architect:approve" } }, origin);
      {
        const s = await runner.loadCurrent(initial.projectRoot);
        expect(s).not.toBeNull();
        expect(s?.currentStage).toBe("P2_MODE_SELECTION");
        expect(s?.approvals).toHaveLength(1);
        expect(s?.approvals[0]?.gate).toBe("G1");
        expect(s?.spark?.immutable).toBe(true);
      }

      // 6. Pick `skip` mode — handler pre-stages `sparkMode` and re-runs
      //    P2, which now short-circuits and presents G2.
      await bot.inject({ callbackQuery: { data: "action:architect:mode:skip" } }, origin);
      {
        const s = await runner.loadCurrent(initial.projectRoot);
        expect(s?.sparkMode).toBe("skip");
        expect(s?.pendingApproval?.gate).toBe("G2");
      }
      {
        const sess = await store.load(origin.from.id, origin.chat.id);
        expect(sess.menu.currentPage).toBe("/mode");
      }

      // 7. Approve G2 — advances into P3, which (skip mode) presents G3
      //    over the existing spark with no maturation artifact.
      await bot.inject({ callbackQuery: { data: "action:architect:approve" } }, origin);
      {
        const s = await runner.loadCurrent(initial.projectRoot);
        expect(s?.currentStage).toBe("P3_SPARK_MATURATION");
        expect(s?.pendingApproval?.gate).toBe("G3");
        expect(s?.approvals).toHaveLength(2);
        expect(s?.grownSparkPath).toBeNull();
        expect(s?.checkupPath).toBeNull();
      }

      // 8. Approve G3 — derives the approved essence and advances into
      //    P4, which drafts the sketch (mock default response) and pauses
      //    at G4.
      await bot.inject({ callbackQuery: { data: "action:architect:approve" } }, origin);

      const finalState = await runner.loadCurrent(initial.projectRoot);
      expect(finalState).not.toBeNull();
      expect(finalState?.currentStage).toBe("P4_BLUEPRINT_SKETCH");
      expect(finalState?.pendingApproval?.gate).toBe("G4");
      expect(finalState?.approvals).toHaveLength(3);
      expect(finalState?.approvals.map((a) => a.gate)).toEqual(["G1", "G2", "G3"]);

      // Artifact files written by the bridge / orchestrator on disk.
      const essencePath = join(initial.projectRoot, "docs", "02-approved-product-essence.md");
      expect(await pathExists(sparkDocPath)).toBe(true);
      expect(await pathExists(essencePath)).toBe(true);
      const essenceContent = await readFile(essencePath, "utf8");
      expect(essenceContent).toContain("Approved Product Essence");
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  test("subsequent gates can be smoke-checked via runner.advance directly", async () => {
    // The engine pipeline already handles G1–G3 above; downstream gates
    // share the same approve/advance shape. This case verifies that
    // `runner.advance` after `runner.resolveApproval` continues to drive
    // P4 → G4 once a fresh project has been pre-seeded with an approved
    // spark + mode + maturation.
    const projectsRoot = mkdtempSync(join(tmpdir(), "arch-m7-direct-"));
    try {
      const router = buildRouter();
      const bus = new ProgressBus();
      const phases = buildDefaultRegistry();
      const runner = makeArchitectRunner({ router, bus, phases });

      let state = await runner.newProject({ projectName: "demo", projectsRoot });

      // Pre-stage the spark file so P1 short-circuits to G1.
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(join(state.projectRoot, "docs"), { recursive: true });
      await writeFile(join(state.projectRoot, "docs", "00-human-spark.md"), SPARK_TEXT, "utf8");

      // P0 → P1 (presents G1).
      const { makeGatePagePrompts } = await import(
        "../../src/interface/telegram/architect/gate-page.ts"
      );
      state = await runner.advance(state, makeGatePagePrompts());
      expect(state.pendingApproval?.gate).toBe("G1");

      state = await runner.resolveApproval(state, { status: "approved" });

      // P1 (frozen) → P2; pre-stage `sparkMode` so P2 short-circuits to G2.
      state = await runner.advance({ ...state, sparkMode: "skip" }, makeGatePagePrompts());
      expect(state.pendingApproval?.gate).toBe("G2");

      state = await runner.resolveApproval(state, { status: "approved" });

      // P3 (skip mode) presents G3.
      state = await runner.advance(state, makeGatePagePrompts());
      expect(state.pendingApproval?.gate).toBe("G3");

      state = await runner.resolveApproval(state, { status: "approved" });

      // P3 derives essence, transitions into P4 which drafts + presents G4.
      state = await runner.advance(state, makeGatePagePrompts());
      expect(state.currentStage).toBe("P4_BLUEPRINT_SKETCH");
      expect(state.pendingApproval?.gate).toBe("G4");
      expect(state.approvedEssencePath).not.toBeNull();
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });
});
