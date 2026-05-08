import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApprovalLockError,
  NoPendingApprovalError,
  presentApproval,
  resolveApproval,
} from "../../src/orchestrator/approvals.ts";
import { bootstrapProject } from "../../src/orchestrator/bootstrap.ts";
import { ProgressBus } from "../../src/orchestrator/events.ts";

describe("approval lifecycle", () => {
  test("present + resolve roundtrip", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-"));
    try {
      let state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
      const bus = new ProgressBus();
      const events: string[] = [];
      bus.subscribe((e) => events.push(e.type));
      state = await presentApproval(state, bus, {
        gate: "G1",
        artifact: "docs/00-human-spark.md",
        label: "Confirm spark",
      });
      expect(state.pendingApproval?.gate).toBe("G1");
      expect(state.pendingApproval?.id).toBe("APPROVAL-001");
      expect(events).toContain("approval_required");

      // Cannot present a second approval while one is pending.
      await expect(
        presentApproval(state, bus, { gate: "G2", artifact: "x", label: "y" }),
      ).rejects.toBeInstanceOf(ApprovalLockError);

      state = await resolveApproval(state, bus, { status: "approved", notes: "ok" });
      expect(state.pendingApproval).toBeNull();
      expect(state.approvals).toHaveLength(1);
      expect(state.approvals[0]?.status).toBe("approved");
      expect(state.approvals[0]?.notes).toBe("ok");
      expect(events).toContain("approval_recorded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolve without a pending approval fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-"));
    try {
      const state = await bootstrapProject({ projectName: "demo", projectsRoot: root });
      await expect(
        resolveApproval(state, new ProgressBus(), { status: "approved" }),
      ).rejects.toBeInstanceOf(NoPendingApprovalError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
