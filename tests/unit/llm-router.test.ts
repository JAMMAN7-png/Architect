import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import { LLMRouter } from "../../src/llm/router.ts";
import { MockProvider } from "../fixtures/mock-llm.ts";

describe("LLMRouter", () => {
  it("modelFor resolves each tier from defaults", () => {
    const router = new LLMRouter(DEFAULT_CONFIG);
    expect(router.modelFor("strategic")).toBe(DEFAULT_CONFIG.models.strategic);
    expect(router.modelFor("execution")).toBe(DEFAULT_CONFIG.models.execution);
    expect(router.modelFor("ui")).toBe(DEFAULT_CONFIG.models.ui);
    const expected = DEFAULT_CONFIG.models.ensemble[0];
    if (!expected) throw new Error("test setup: ensemble[0] missing");
    expect(router.modelFor("ensemble")).toBe(expected);
  });

  it("availability reports all configured providers", () => {
    const router = new LLMRouter(DEFAULT_CONFIG);
    const avail = router.availability();
    expect(Object.keys(avail).sort()).toEqual([
      "anthropic",
      "deepseek",
      "openai",
      "openrouter",
      "xai",
    ]);
  });

  it("dispatches to a registered mock provider", async () => {
    const mock = new MockProvider({ text: "ok" });
    // Use a config where strategic resolves to a mock-prefixed id
    const cfg = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, strategic: "mock/whatever" },
    };
    const router = new LLMRouter(cfg, { mock });
    const res = await router.chat({
      tier: "strategic",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.text).toBe("ok");
    expect(res.provider).toBe("mock");
  });

  it("throws MissingProviderError when no provider available and openrouter missing", async () => {
    // Override the openai provider with one that's not available, and make sure openrouter mock is also unavailable
    const unavailable = {
      id: "anthropic",
      available: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      chat: () => Promise.reject(new Error("nope")) as any,
    };
    const noOpenRouter = {
      id: "openrouter",
      available: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      chat: () => Promise.reject(new Error("nope")) as any,
    };
    const router = new LLMRouter(DEFAULT_CONFIG, {
      anthropic: unavailable,
      openrouter: noOpenRouter,
    });
    await expect(
      router.chat({ tier: "strategic", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/No provider available/);
  });
});
