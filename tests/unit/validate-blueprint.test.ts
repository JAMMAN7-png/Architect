import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBlueprint } from "../../src/validate/blueprint.ts";

const VALID_STEP = `## BP-CORE-001 — Wire the orchestrator
### Goal
Stand up the state machine reducer.
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

describe("blueprint validator", () => {
  test("flags missing required sections", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-bp-"));
    try {
      await mkdir(join(root, "docs/blueprint"), { recursive: true });
      const broken = "## BP-CORE-001 — Missing sections\n### Goal\nDo a thing.\n";
      await writeFile(join(root, "docs/blueprint/12-implementation-roadmap.md"), broken);
      const res = await validateBlueprint(root);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes("Inputs"))).toBe(true);
      expect(res.errors.some((e) => e.includes("Acceptance Criteria"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags steps with no doc references in Inputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-bp-"));
    try {
      await mkdir(join(root, "docs/blueprint"), { recursive: true });
      const noref = VALID_STEP.replace(/- docs[^\n]+\n/g, "- something else\n");
      await writeFile(join(root, "docs/blueprint/12-implementation-roadmap.md"), noref);
      const res = await validateBlueprint(root);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes("no doc reference"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects duplicate step ids", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-bp-"));
    try {
      await mkdir(join(root, "docs/blueprint"), { recursive: true });
      await writeFile(
        join(root, "docs/blueprint/12-implementation-roadmap.md"),
        `${VALID_STEP}\n${VALID_STEP}`,
      );
      const res = await validateBlueprint(root);
      expect(res.errors.some((e) => e.includes("duplicate step id"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("passes a clean blueprint with steps", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-bp-"));
    try {
      await mkdir(join(root, "docs/blueprint"), { recursive: true });
      await writeFile(join(root, "docs/blueprint/00-overview.md"), "# overview");
      await writeFile(join(root, "docs/blueprint/12-implementation-roadmap.md"), VALID_STEP);
      const res = await validateBlueprint(root);
      expect(res.ok).toBe(true);
      expect(res.steps).toHaveLength(1);
      expect(res.steps[0]?.id).toBe("BP-CORE-001");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
