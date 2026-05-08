import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schema.ts";
import type { ChatProvider, ChatRequest, ChatResponse } from "../../src/llm/adapter.ts";
import { LLMRouter } from "../../src/llm/router.ts";

class FakeProvider implements ChatProvider {
  readonly id = "openai";
  calls: Array<{ req: ChatRequest; modelId: string }> = [];
  shouldThrow = false;

  available(): boolean {
    return true;
  }

  async chat(req: ChatRequest, modelId: string): Promise<ChatResponse> {
    this.calls.push({ req, modelId });
    if (this.shouldThrow) {
      throw new Error("fake provider exploded");
    }
    return {
      provider: "openai",
      model: modelId,
      text: "pong",
      usage: { inputTokens: 1, outputTokens: 1, estimatedUsd: 0 },
      stopReason: "stop",
      latencyMs: 0,
    };
  }
}

const ENV_KEYS = ["OPENAI_API_KEY"] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED_ENV[k] = process.env[k];
  }
  process.env.OPENAI_API_KEY = "test";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

function makeRouter(fake: FakeProvider): LLMRouter {
  const cfg = {
    ...DEFAULT_CONFIG,
    models: { ...DEFAULT_CONFIG.models, execution: "openai/test" },
  };
  return new LLMRouter(cfg, { openai: fake });
}

describe("LLMRouter.ping()", () => {
  test("returns ok=true with latency on a successful chat", async () => {
    const fake = new FakeProvider();
    const router = makeRouter(fake);

    const result = await router.ping("openai/test");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(fake.calls.length).toBe(1);
    const call = fake.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call.modelId).toBe("openai/test");
    expect(call.req.maxTokens).toBe(4);
    expect(call.req.temperature).toBe(0);
    expect(call.req.messages.some((m) => m.role === "user" && m.content === "ping")).toBe(true);
  });

  test("returns ok=false with error message when chat throws", async () => {
    const fake = new FakeProvider();
    fake.shouldThrow = true;
    const router = makeRouter(fake);

    const result = await router.ping("openai/test");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.length ?? 0).toBeGreaterThan(0);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
