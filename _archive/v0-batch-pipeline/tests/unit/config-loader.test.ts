import { describe, expect, it } from "bun:test";
import { applyEnvOverrides, getKey, setKey } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";

describe("config", () => {
  it("DEFAULT_CONFIG has the expected tier defaults", () => {
    expect(DEFAULT_CONFIG.models.strategic.startsWith("anthropic/")).toBe(true);
    expect(DEFAULT_CONFIG.models.execution.startsWith("deepseek/")).toBe(true);
    expect(DEFAULT_CONFIG.search.provider).toBe("firecrawl");
    expect(DEFAULT_CONFIG.search.noise_filter).toBeGreaterThanOrEqual(0.5);
  });

  it("applyEnvOverrides respects ARCHITECT_MODEL_STRATEGIC", () => {
    const prev = process.env.ARCHITECT_MODEL_STRATEGIC;
    process.env.ARCHITECT_MODEL_STRATEGIC = "anthropic/claude-test";
    try {
      const cfg = applyEnvOverrides(DEFAULT_CONFIG);
      expect(cfg.models.strategic).toBe("anthropic/claude-test");
      // Originals untouched
      expect(DEFAULT_CONFIG.models.strategic).not.toBe("anthropic/claude-test");
    } finally {
      // biome-ignore lint/performance/noDelete: env-var cleanup (assignment to undefined would set literal "undefined")
      if (prev === undefined) delete process.env.ARCHITECT_MODEL_STRATEGIC;
      else process.env.ARCHITECT_MODEL_STRATEGIC = prev;
    }
  });

  it("getKey returns nested values", () => {
    expect(getKey(DEFAULT_CONFIG, "search.provider")).toBe("firecrawl");
    expect(getKey(DEFAULT_CONFIG, "models.execution")).toBe(DEFAULT_CONFIG.models.execution);
    expect(getKey(DEFAULT_CONFIG, "nope.nonexistent")).toBeUndefined();
  });

  it("setKey deep-clones and validates", () => {
    const next = setKey(DEFAULT_CONFIG, "search.provider", "parallel");
    expect(next.search.provider).toBe("parallel");
    expect(DEFAULT_CONFIG.search.provider).toBe("firecrawl");
  });

  it("setKey throws on unknown leaf", () => {
    expect(() => setKey(DEFAULT_CONFIG, "models.unknown_tier", "x")).toThrow();
  });

  it("setKey rejects values that violate schema", () => {
    expect(() => setKey(DEFAULT_CONFIG, "search.noise_filter", 5)).toThrow();
  });

  it("applyEnvOverrides respects ARCHITECT_MODEL_ENSEMBLE", () => {
    const prev = process.env.ARCHITECT_MODEL_ENSEMBLE;
    process.env.ARCHITECT_MODEL_ENSEMBLE = "a/b, c/d ,e/f";
    try {
      const cfg = applyEnvOverrides(DEFAULT_CONFIG);
      expect(cfg.models.ensemble).toEqual(["a/b", "c/d", "e/f"]);
    } finally {
      // biome-ignore lint/performance/noDelete: env-var cleanup (assignment to undefined would set literal "undefined")
      if (prev === undefined) delete process.env.ARCHITECT_MODEL_ENSEMBLE;
      else process.env.ARCHITECT_MODEL_ENSEMBLE = prev;
    }
  });
});
