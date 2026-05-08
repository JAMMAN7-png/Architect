import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import { LLMRouter } from "../../src/llm/router.ts";
import { filterFindings } from "../../src/search/filter.ts";
import { MockProvider } from "../fixtures/mock-llm.ts";

describe("filterFindings", () => {
  it("returns empty array for empty input without calling the model", async () => {
    const mock = new MockProvider({ text: "{ should not be called }" });
    const cfg = { ...DEFAULT_CONFIG, models: { ...DEFAULT_CONFIG.models, execution: "mock/x" } };
    const router = new LLMRouter(cfg, { mock });
    const out = await filterFindings(router, "anything", []);
    expect(out).toEqual([]);
  });

  it("caps results to (1 - noiseRatio) * input", async () => {
    const findings = Array.from({ length: 20 }, (_, i) => ({
      url: `https://x.test/${i}`,
      title: `t${i}`,
      excerpt: `text for finding ${i}`,
      relevance: `r${i}`,
    }));

    const mock = new MockProvider({
      text: JSON.stringify({ findings }),
    });
    const cfg = { ...DEFAULT_CONFIG, models: { ...DEFAULT_CONFIG.models, execution: "mock/x" } };
    const router = new LLMRouter(cfg, { mock });

    const out = await filterFindings(
      router,
      "objective",
      [
        { text: "a", url: "https://x.test/0", title: "a" },
        { text: "b", url: "https://x.test/1", title: "b" },
        { text: "c", url: "https://x.test/2", title: "c" },
        { text: "d", url: "https://x.test/3", title: "d" },
        { text: "e", url: "https://x.test/4", title: "e" },
        { text: "f", url: "https://x.test/5", title: "f" },
        { text: "g", url: "https://x.test/6", title: "g" },
        { text: "h", url: "https://x.test/7", title: "h" },
        { text: "i", url: "https://x.test/8", title: "i" },
        { text: "j", url: "https://x.test/9", title: "j" },
      ],
      { noiseRatio: 0.85 },
    );
    // 10 inputs * (1 - 0.85) = 1.5 → floor → 1
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.length).toBeGreaterThan(0);
  });
});
