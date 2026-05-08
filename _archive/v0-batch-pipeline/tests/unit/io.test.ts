import { describe, expect, it } from "bun:test";
import { fmtTokens, fmtUsd, slugify } from "../../src/util/io.ts";

describe("slugify", () => {
  it("produces kebab-case ascii", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("Café à Paris")).toBe("cafe-a-paris");
    expect(slugify("   spaces   ")).toBe("spaces");
    expect(slugify("$$$")).toBe("untitled");
  });
  it("clamps length", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("fmtUsd", () => {
  it("uses 4 decimals under 1 cent", () => {
    expect(fmtUsd(0.001)).toBe("$0.0010");
  });
  it("uses 3 decimals under one dollar", () => {
    expect(fmtUsd(0.5)).toBe("$0.500");
  });
  it("uses 2 decimals at and above one dollar", () => {
    expect(fmtUsd(2.345)).toBe("$2.35");
  });
});

describe("fmtTokens", () => {
  it("inserts thousands separators", () => {
    expect(fmtTokens(1234567)).toBe("1,234,567");
  });
});
