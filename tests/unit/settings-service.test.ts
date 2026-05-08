import { describe, expect, it } from "bun:test";
import { ArchitectConfig as ArchitectConfigSchema } from "../../src/config/schema.ts";
import { makeSettingsService } from "../../src/config/service.ts";

function freshCfg() {
  return ArchitectConfigSchema.parse({});
}

describe("settingsCatalog", () => {
  const svc = makeSettingsService();

  it("returns at least 19 descriptors with unique keys", () => {
    const cat = svc.catalog();
    expect(cat.length).toBeGreaterThanOrEqual(19);
    const keys = cat.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("describes models.strategic as a model picker", () => {
    const d = svc.describe("models.strategic");
    expect(d.type.kind).toBe("model");
    expect(d.section).toBe("models");
  });

  it("throws on unknown key", () => {
    expect(() => svc.describe("nope.missing")).toThrow(/unknown key/);
  });
});

describe("settingsService.set — coercion", () => {
  const svc = makeSettingsService();

  it("parses int strings and rejects out-of-range", () => {
    const cfg = freshCfg();
    const next = svc.set(cfg, "runtime.retry_attempts", "7");
    expect(next.runtime.retry_attempts).toBe(7);
    expect(() => svc.set(cfg, "runtime.retry_attempts", "11")).toThrow();
  });

  it("coerces bool strings to false", () => {
    const cfg = freshCfg();
    const next = svc.set(cfg, "output.git_init", "false");
    expect(next.output.git_init).toBe(false);
  });

  it("coerces float strings within range; rejects outside range", () => {
    const cfg = freshCfg();
    const next = svc.set(cfg, "search.noise_filter", "0.5");
    expect(next.search.noise_filter).toBeCloseTo(0.5, 6);
    expect(() => svc.set(cfg, "search.noise_filter", "1.5")).toThrow();
  });

  it("accepts valid enum values; rejects unknown", () => {
    const cfg = freshCfg();
    const next = svc.set(cfg, "search.provider", "exa");
    expect(next.search.provider).toBe("exa");
    expect(() => svc.set(cfg, "search.provider", "unknown")).toThrow();
  });
});

describe("settingsService.toggle", () => {
  const svc = makeSettingsService();

  it("adds and removes members on enum-list", () => {
    const cfg = freshCfg();
    const added = svc.toggle(cfg, "search.enabled_providers", "parallel");
    expect(added.search.enabled_providers).toContain("parallel");
    expect(added.search.enabled_providers).toContain("firecrawl");

    const removed = svc.toggle(added, "search.enabled_providers", "parallel");
    expect(removed.search.enabled_providers).not.toContain("parallel");
    expect(removed.search.enabled_providers).toContain("firecrawl");
  });

  it("refuses to drop the last entry when min=1", () => {
    const cfg = freshCfg();
    // default is ["firecrawl"] — toggling firecrawl off would empty the list.
    expect(() => svc.toggle(cfg, "search.enabled_providers", "firecrawl")).toThrow(
      /at least 1 entries/,
    );
  });

  it("rejects unknown enum-list members", () => {
    const cfg = freshCfg();
    expect(() => svc.toggle(cfg, "llm.enabled_providers", "banana")).toThrow(
      /unknown member 'banana'/,
    );
  });
});

describe("settingsService.reset", () => {
  it("returns the schema default object", () => {
    const svc = makeSettingsService();
    const def = svc.reset();
    expect(def).toEqual(ArchitectConfigSchema.parse({}));
    expect(def.search.provider).toBe("firecrawl");
    expect(def.runtime.log_level).toBe("info");
    expect(def.llm.enabled_providers.length).toBe(11);
  });
});
