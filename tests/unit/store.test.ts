import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectExistsError, bootstrapProject } from "../../src/orchestrator/bootstrap.ts";
import { loadState, stateExists } from "../../src/orchestrator/store.ts";

describe("bootstrap + store", () => {
  test("bootstrap creates a valid project", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-"));
    try {
      const state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
      expect(state.projectName).toBe("demo");
      expect(await stateExists(state.projectRoot)).toBe(true);
      const reloaded = await loadState(state.projectRoot);
      expect(reloaded.projectId).toBe(state.projectId);
      expect(reloaded.currentStage).toBe("P0_BOOTSTRAP");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses to overwrite an existing project", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-"));
    try {
      await bootstrapProject({ projectName: "demo", projectsRoot: root });
      await expect(
        bootstrapProject({ projectName: "demo", projectsRoot: root }),
      ).rejects.toBeInstanceOf(ProjectExistsError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
