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
import { MockProvider } from "../fixtures/mock-llm.ts";
import { ScriptedPrompts } from "../fixtures/scripted-prompts.ts";

const SPARK = "Build a chat app with Stripe payments and Postgres.";

const SKETCH = `# Blueprint Sketch
## Product Summary
A chat app with payments.
## Capabilities
- chat
- billing
## Modules
- gateway
## Doc Placeholders
## Known Unknowns
## Risk Areas
## Candidate Architectures`;

const ESSENCE = "# Approved Product Essence\n## Identity\nA chat+billing product.";

const TARGETS_JSON = {
  targets: [
    {
      id: "runtime",
      name: "Bun",
      category: "runtime",
      rationale: "fast TS exec",
      userSpecified: false,
    },
    {
      id: "db",
      name: "Postgres",
      category: "db",
      rationale: "spec calls for it",
      userSpecified: true,
    },
    {
      id: "pay",
      name: "Stripe",
      category: "payment",
      rationale: "spec calls for it",
      userSpecified: true,
    },
  ],
};

const QUESTIONS_JSON = {
  questions: [
    {
      id: "q-runtime",
      targetId: "runtime",
      prompt: "Which runtime?",
      options: ["Bun", "Node", "Custom (describe)"],
    },
    {
      id: "q-db",
      targetId: "db",
      prompt: "Postgres flavor?",
      options: ["Supabase", "Neon", "Self-hosted"],
    },
  ],
};

function makeRouter() {
  const mock = new MockProvider({ text: "default content" });
  mock.onSystemContains("distilling a final", { text: ESSENCE });
  mock.onSystemContains("Sketch Architect", { text: SKETCH });
  mock.onSystemContains("Research Planner", {
    text: JSON.stringify(TARGETS_JSON),
    json: TARGETS_JSON,
  });
  mock.onSystemContains("Questionnaire Builder", {
    text: JSON.stringify(QUESTIONS_JSON),
    json: QUESTIONS_JSON,
  });
  mock.onSystemContains("topic research assistant", {
    text: "- what: novel runtime\n- good fit: experiments\n- watch-out: tooling",
  });
  return new LLMRouter(DEFAULT_CONFIG, {
    anthropic: mock,
    openai: mock,
    openrouter: mock,
    deepseek: mock,
    xai: mock,
  });
}

async function fastForwardThroughP3(root: string) {
  let state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
  const bus = new ProgressBus();
  const router = makeRouter();
  const registry = buildDefaultRegistry();

  state = await advance(state, {
    bus,
    router,
    prompts: new ScriptedPrompts([
      { kind: "select", value: "type" },
      { kind: "text", value: SPARK },
    ]),
    registry,
  });
  state = await resolveApproval(state, bus, { status: "approved" }); // G1
  state = await advance(state, {
    bus,
    router,
    prompts: new ScriptedPrompts([{ kind: "select", value: "skip" }]),
    registry,
  });
  state = await resolveApproval(state, bus, { status: "approved" }); // G2
  state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
  state = await resolveApproval(state, bus, { status: "approved" }); // G3
  return { state, bus, router, registry };
}

describe("M3 — sketch + targets + stack questionnaire", () => {
  test("P4 sketch, P5 targets, P6 questionnaire end-to-end", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m3-"));
    try {
      let { state, bus, router, registry } = await fastForwardThroughP3(root);

      // Engine into P4 (sketch). Halts at G4.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P4_BLUEPRINT_SKETCH");
      expect(state.pendingApproval?.gate).toBe("G4");
      expect(state.sketchPath).not.toBeNull();
      const sketch = await readFile(state.sketchPath as string, "utf8");
      expect(sketch).toContain("Blueprint Sketch");
      state = await resolveApproval(state, bus, { status: "approved" });

      // Engine into P5 (targets). Halts at G5.
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      expect(state.currentStage).toBe("P5_RESEARCH_TARGETS");
      expect(state.pendingApproval?.gate).toBe("G5");
      expect(state.researchTargets).toHaveLength(3);
      expect(state.researchTargets.map((t) => t.id)).toContain("db");
      state = await resolveApproval(state, bus, { status: "approved" });

      // Engine into P6 (questionnaire). Two questions, both answered with
      // non-custom options. Halts at G6.
      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([
          { kind: "select", value: "Bun" },
          { kind: "select", value: "Neon" },
        ]),
        registry,
      });
      expect(state.currentStage).toBe("P6_STACK_QUESTIONNAIRE");
      expect(state.pendingApproval?.gate).toBe("G6");
      // Approval recorded research-target approval flag.
      expect(state.researchTargets.every((t) => t.approved)).toBe(true);
      const prefs = await readFile(
        join(state.projectRoot, "docs/research/01-user-preferences.md"),
        "utf8",
      );
      expect(prefs).toContain("Which runtime?");
      expect(prefs).toContain("**Bun**");
      expect(prefs).toContain("**Neon**");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("custom-answer triggers research detour and re-asks", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m3c-"));
    try {
      let { state, bus, router, registry } = await fastForwardThroughP3(root);

      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      state = await resolveApproval(state, bus, { status: "approved" }); // G4
      state = await advance(state, { bus, router, prompts: new ScriptedPrompts([]), registry });
      state = await resolveApproval(state, bus, { status: "approved" }); // G5

      // First question: pick Custom, type a value, confirm sticking with it.
      // Second question: standard answer.
      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([
          { kind: "select", value: "Custom (describe)" }, // q1 attempt 1
          { kind: "text", value: "tinyworker" },
          { kind: "confirm", value: true },
          { kind: "select", value: "Self-hosted" }, // q2
        ]),
        registry,
      });
      expect(state.pendingApproval?.gate).toBe("G6");
      const prefs = await readFile(
        join(state.projectRoot, "docs/research/01-user-preferences.md"),
        "utf8",
      );
      expect(prefs).toContain("custom note: tinyworker");
      expect(prefs).toContain("research detour");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
