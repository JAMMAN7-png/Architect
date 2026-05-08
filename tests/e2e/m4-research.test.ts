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
import { MockSearchProvider } from "../fixtures/mock-search.ts";
import { ScriptedPrompts } from "../fixtures/scripted-prompts.ts";

/**
 * M4 — research → approach → settlement. We seed a project that has
 * already cleared P0..P6 (skipping the LLM noise from earlier phases) and
 * exercise P7→P9 in isolation. This keeps the test focused and fast.
 */

const FILTER_JSON = {
  findings: [
    {
      url: "https://docs.example.com/bun",
      title: "Bun docs",
      excerpt: "Bun is a fast all-in-one runtime.",
      relevance: "high",
    },
  ],
};

const RESEARCH_DOC = `# Bun
## Decision Summary
Use Bun as the runtime.
## Why This Matters (for THIS project)
Faster TS startup.
## Approved Choice
Bun
## Alternatives Considered
Node, Deno
## Implementation-Relevant Findings
- start cold ≤ 30ms
## Required Patterns
- top-level await
## Risks / Warnings
- ecosystem gaps
## Testing Notes
- bun test runs as expected
## Blueprint References
- BP-STACK-001
## Sources
1. Bun docs — https://docs.example.com/bun
`;

const APPROACH_QUESTIONS = {
  questions: [
    {
      id: "a-runtime",
      topic: "runtime",
      prompt: "How will we install Bun in CI?",
      options: ["Action", "Script", "Custom (describe)"],
    },
  ],
};

const DECISIONS_DOC = `# Approved Decisions
## Identity Recap
Tiny CLI.
## Final Stack
- Bun runtime
## Final Approach
- CI install via official action
## Resolved Contradictions
- none
## Unresolved (needs user input)
- none
## Research References (paths)
- docs/research/runtime.md`;

function makeRouter() {
  const mock = new MockProvider({ text: "default" });
  // Order matters — most specific first.
  mock.onSystemContains("research filtering agent", {
    text: JSON.stringify(FILTER_JSON),
    json: FILTER_JSON,
  });
  mock.onSystemContains("Research Doc Writer", { text: RESEARCH_DOC });
  mock.onSystemContains("Approach Clarifier", {
    text: JSON.stringify(APPROACH_QUESTIONS),
    json: APPROACH_QUESTIONS,
  });
  mock.onSystemContains("Decision Settlement agent", { text: DECISIONS_DOC });
  return new LLMRouter(DEFAULT_CONFIG, {
    anthropic: mock,
    openai: mock,
    openrouter: mock,
    deepseek: mock,
    xai: mock,
  });
}

function makeSearch() {
  return new MockSearchProvider({
    excerpts: [
      { text: "Bun is a fast TS runtime", url: "https://docs.example.com/bun", title: "Bun docs" },
    ],
  });
}

async function seedProjectAtP7(root: string): Promise<ArchitectState> {
  const state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
  // Hand-craft the artifacts P7 expects.
  const docs = (n: string) => join(state.projectRoot, "docs", n);
  await writeFile(docs("00-human-spark.md"), "tiny CLI", "utf8");
  await writeFile(docs("02-approved-product-essence.md"), "# Approved Product Essence", "utf8");
  await writeFile(docs("03-blueprint-sketch.md"), "# Blueprint Sketch", "utf8");
  await writeFile(
    join(state.projectRoot, "docs", "research", "_user_prefs.json"),
    JSON.stringify({
      questions: [{ id: "q-runtime", targetId: "runtime", prompt: "Runtime?", options: ["Bun"] }],
      answers: { "q-runtime": { selected: "Bun" } },
    }),
    "utf8",
  );

  const seeded: ArchitectState = {
    ...state,
    currentStage: "P7_DEEP_RESEARCH",
    sparkMode: "skip",
    spark: {
      path: docs("00-human-spark.md"),
      sha256: "stub",
      immutable: true,
    },
    approvedEssencePath: docs("02-approved-product-essence.md"),
    sketchPath: docs("03-blueprint-sketch.md"),
    researchTargets: [
      {
        id: "runtime",
        name: "Bun",
        category: "runtime",
        rationale: "spec",
        userSpecified: true,
        approved: true,
      },
    ],
    approvals: [
      ...["G1", "G2", "G3", "G4", "G5", "G6"].map((g, i) => ({
        id: `APPROVAL-${String(i + 1).padStart(3, "0")}`,
        gate: g as "G1" | "G2" | "G3" | "G4" | "G5" | "G6",
        status: "approved" as const,
        artifact: `seed-${g}`,
        approvedBy: "user" as const,
        signedAt: "2026-01-01T00:00:00.000Z",
      })),
    ],
  };
  await saveState(seeded);
  return seeded;
}

describe("M4 — research → approach → decisions", () => {
  test("P7 writes per-target research doc, P8 + P9 produce decisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-m4-"));
    try {
      let state = await seedProjectAtP7(root);
      const bus = new ProgressBus();
      const router = makeRouter();
      const registry = buildDefaultRegistry();
      const searchOverride = makeSearch();

      // P7 has no gate — engine runs through to next gated phase (P8 G7).
      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([{ kind: "select", value: "Action" }]),
        registry,
        searchOverride,
      });
      expect(state.currentStage).toBe("P8_APPROACH_QUESTIONNAIRE");
      expect(state.pendingApproval?.gate).toBe("G7");
      const researchDoc = await readFile(
        join(state.projectRoot, "docs/research/runtime.md"),
        "utf8",
      );
      expect(researchDoc).toContain("# Bun");
      expect(researchDoc).toContain("## Decision Summary");
      expect(researchDoc).toContain("## Approved Choice");
      expect(researchDoc).toContain("## Blueprint References");
      // Findings recorded in state.
      expect(state.researchFindings.length).toBeGreaterThan(0);

      // Approve G7.
      state = await resolveApproval(state, bus, { status: "approved" });

      // P9 → G8.
      state = await advance(state, {
        bus,
        router,
        prompts: new ScriptedPrompts([]),
        registry,
        searchOverride,
      });
      expect(state.currentStage).toBe("P9_DECISION_SETTLEMENT");
      expect(state.pendingApproval?.gate).toBe("G8");
      expect(state.decisionsPath).not.toBeNull();
      const decisions = await readFile(state.decisionsPath as string, "utf8");
      expect(decisions).toContain("Approved Decisions");
      expect(decisions).toContain("Final Stack");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
