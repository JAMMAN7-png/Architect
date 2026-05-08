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

  it("falls back to openrouter with the original model slug", async () => {
    let capturedModelId: string | undefined;
    const orMock = {
      id: "openrouter",
      available: () => true,
      async chat(_req: Parameters<LLMRouter["chat"]>[0], modelId: string) {
        capturedModelId = modelId;
        return {
          provider: "openrouter",
          model: modelId,
          text: "fallback",
          usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
          stopReason: "stop" as const,
          latencyMs: 0,
        };
      },
    };
    const unavailable = {
      id: "anthropic",
      available: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      chat: () => Promise.reject(new Error("nope")) as any,
    };
    const cfg = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, strategic: "anthropic/claude-opus-4-5" },
    };
    const router = new LLMRouter(cfg, { anthropic: unavailable, openrouter: orMock });
    await router.chat({ tier: "strategic", messages: [{ role: "user", content: "hi" }] });
    expect(capturedModelId).toBe("anthropic/claude-opus-4-5");
  });

  it("ensembleChat returns only fulfilled results when one member fails", async () => {
    const okProvider = {
      id: "ok",
      available: () => true,
      async chat(_req: Parameters<LLMRouter["chat"]>[0], modelId: string) {
        return {
          provider: "ok",
          model: modelId,
          text: "ok-result",
          usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
          stopReason: "stop" as const,
          latencyMs: 0,
        };
      },
    };
    const failProvider = {
      id: "fail",
      available: () => true,
      async chat(_req: Parameters<LLMRouter["chat"]>[0], modelId: string) {
        throw new Error("boom");
      },
    };
    const cfg = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, ensemble: ["ok/a", "fail/b"] },
    };
    const router = new LLMRouter(cfg, { ok: okProvider, fail: failProvider });
    const results = await router.ensembleChat({
      messages: [{ role: "user", content: "ensemble test" }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("ok-result");
  });

  it("retries on transient 429 and succeeds on third attempt", async () => {
    let callCount = 0;
    const flakyProvider = {
      id: "mock",
      available: () => true,
      async chat(
        _req: Parameters<LLMRouter["chat"]>[0],
        modelId: string,
      ): Promise<Awaited<ReturnType<LLMRouter["chat"]>>> {
        callCount++;
        if (callCount < 3) {
          throw Object.assign(new Error("rate limited"), { status: 429 });
        }
        return {
          provider: "mock",
          model: modelId,
          text: "after-retry",
          usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
          stopReason: "stop" as const,
          latencyMs: 0,
        };
      },
    };
    const cfg = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, strategic: "mock/whatever" },
    };
    const router = new LLMRouter(cfg, { mock: flakyProvider });
    const res = await router.chat({
      tier: "strategic",
      messages: [{ role: "user", content: "retry test" }],
    });
    expect(res.text).toBe("after-retry");
    expect(callCount).toBe(3);
  });

  it("does not retry on non-transient 400 error", async () => {
    let callCount = 0;
    const badProvider = {
      id: "mock",
      available: () => true,
      async chat(
        _req: Parameters<LLMRouter["chat"]>[0],
        _modelId: string,
      ): Promise<Awaited<ReturnType<LLMRouter["chat"]>>> {
        callCount++;
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    };
    const cfg = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, strategic: "mock/whatever" },
    };
    const router = new LLMRouter(cfg, { mock: badProvider });
    await expect(
      router.chat({
        tier: "strategic",
        messages: [{ role: "user", content: "no retry test" }],
      }),
    ).rejects.toThrow("bad request");
    expect(callCount).toBe(1);
  });
});
