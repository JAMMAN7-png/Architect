import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __setDynamicModelCacheForTests,
  clearDynamicModelCache,
  listAllDynamicModels,
  listProviderModels,
} from "../../src/llm/dynamic-models.ts";

const PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "VERCEL_AI_GATEWAY_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "NVIDIA_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_GO_API_KEY",
];

const ORIGINAL_FETCH = globalThis.fetch;
const SAVED_ENV: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

function installFetch(fn: () => Promise<Response>): void {
  globalThis.fetch = fn as unknown as typeof fetch;
}

beforeEach(() => {
  for (const k of PROVIDER_KEYS) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
  clearDynamicModelCache();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const k of PROVIDER_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
  clearDynamicModelCache();
});

describe("listProviderModels()", () => {
  test("maps OpenAI /v1/models response to slug-prefixed entries", async () => {
    process.env.OPENAI_API_KEY = "test";
    let calls = 0;
    installFetch(async () => {
      calls++;
      return jsonResponse({ data: [{ id: "foo" }, { id: "bar" }] });
    });

    const out = await listProviderModels("openai");
    expect(out).toEqual([
      { slug: "openai/foo", provider: "openai", apiId: "foo" },
      { slug: "openai/bar", provider: "openai", apiId: "bar" },
    ]);
    expect(calls).toBe(1);
  });

  test("second call within TTL does not trigger fetch (cache hit)", async () => {
    process.env.OPENAI_API_KEY = "test";
    let calls = 0;
    installFetch(async () => {
      calls++;
      return jsonResponse({ data: [{ id: "x" }] });
    });

    await listProviderModels("openai");
    await listProviderModels("openai");
    expect(calls).toBe(1);
  });

  test("stale cache + fetch failure → returns previously cached value", async () => {
    process.env.OPENAI_API_KEY = "test";
    // Seed cache with stale fetchedAt (older than TTL).
    const stale = Date.now() - 10 * 60_000;
    __setDynamicModelCacheForTests(
      "openai",
      [{ slug: "openai/cached", provider: "openai", apiId: "cached" }],
      stale,
    );
    installFetch(async () => {
      throw new Error("boom");
    });
    const out = await listProviderModels("openai");
    expect(out).toEqual([{ slug: "openai/cached", provider: "openai", apiId: "cached" }]);
  });

  test("fetch failure with NO cache → empty list", async () => {
    process.env.OPENAI_API_KEY = "test";
    installFetch(async () => {
      throw new Error("transport");
    });
    expect(await listProviderModels("openai")).toEqual([]);
  });

  test("non-{data:[]} shape → empty list", async () => {
    process.env.OPENAI_API_KEY = "test";
    installFetch(async () => jsonResponse({ unexpected: true }));
    expect(await listProviderModels("openai")).toEqual([]);
  });

  test("missing API key → empty list (no fetch)", async () => {
    let calls = 0;
    installFetch(async () => {
      calls++;
      return jsonResponse({ data: [{ id: "y" }] });
    });
    expect(await listProviderModels("openai")).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("listAllDynamicModels()", () => {
  test("filters by env-key presence and sorts by (provider, slug)", async () => {
    process.env.OPENAI_API_KEY = "ok";
    process.env.GROQ_API_KEY = "ok";
    // anthropic intentionally absent

    __setDynamicModelCacheForTests("openai", [
      { slug: "openai/zeta", provider: "openai", apiId: "zeta" },
      { slug: "openai/alpha", provider: "openai", apiId: "alpha" },
    ]);
    __setDynamicModelCacheForTests("groq", [{ slug: "groq/mid", provider: "groq", apiId: "mid" }]);
    __setDynamicModelCacheForTests("anthropic", [
      { slug: "anthropic/should-not-appear", provider: "anthropic", apiId: "x" },
    ]);

    const out = await listAllDynamicModels();
    expect(out.map((m) => m.slug)).toEqual(["groq/mid", "openai/alpha", "openai/zeta"]);
  });

  test("uses cached entries (no fetch) when seeded via test seam", async () => {
    process.env.OPENAI_API_KEY = "ok";
    let calls = 0;
    installFetch(async () => {
      calls++;
      return jsonResponse({ data: [] });
    });

    __setDynamicModelCacheForTests("openai", [
      { slug: "openai/cached", provider: "openai", apiId: "cached" },
    ]);

    const out = await listAllDynamicModels();
    expect(out).toEqual([{ slug: "openai/cached", provider: "openai", apiId: "cached" }]);
    expect(calls).toBe(0);
  });
});
