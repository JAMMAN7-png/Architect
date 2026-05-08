import { describe, expect, test } from "bun:test";
import { ArchitectState, STAGE_GATE, freshState } from "../../src/orchestrator/state.ts";
import { STAGE_ORDER, isLegalTransition, nextStage } from "../../src/orchestrator/transitions.ts";

describe("state schema", () => {
  test("freshState parses against schema", () => {
    const s = freshState({
      projectId: "p1",
      projectName: "x",
      projectRoot: "/tmp/x",
      now: "2026-05-08T00:00:00.000Z",
    });
    expect(() => ArchitectState.parse(s)).not.toThrow();
    expect(s.currentStage).toBe("P0_BOOTSTRAP");
    expect(s.approvals).toEqual([]);
    expect(s.pendingApproval).toBeNull();
    expect(s.blueprintLocked).toBe(false);
  });

  test("rejects unknown extra fields (strict)", () => {
    const s = freshState({
      projectId: "p",
      projectName: "x",
      projectRoot: "/",
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(() => ArchitectState.parse({ ...s, foo: "bar" })).toThrow();
  });

  test("STAGE_GATE maps each gated phase", () => {
    expect(STAGE_GATE.P1_SPARK_CAPTURE).toBe("G1");
    expect(STAGE_GATE.P12_BLUEPRINT_ASSEMBLY).toBe("G10");
    // P0 and P7/P11 are non-gated.
    expect(STAGE_GATE.P0_BOOTSTRAP).toBeUndefined();
    expect(STAGE_GATE.P7_DEEP_RESEARCH).toBeUndefined();
    expect(STAGE_GATE.P11_DOCS_GENERATION).toBeUndefined();
  });
});

describe("transitions", () => {
  test("nextStage walks the linear order", () => {
    expect(nextStage("P0_BOOTSTRAP")).toBe("P1_SPARK_CAPTURE");
    expect(nextStage("P12_BLUEPRINT_ASSEMBLY")).toBe("DONE");
    expect(nextStage("DONE")).toBe("DONE");
  });
  test("STAGE_ORDER is strictly forward", () => {
    for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
      const from = STAGE_ORDER[i] as (typeof STAGE_ORDER)[number];
      const to = STAGE_ORDER[i + 1] as (typeof STAGE_ORDER)[number];
      expect(isLegalTransition(from, to)).toBe(true);
    }
  });
  test("rejects skips", () => {
    expect(isLegalTransition("P0_BOOTSTRAP", "P3_SPARK_MATURATION")).toBe(false);
  });
});
