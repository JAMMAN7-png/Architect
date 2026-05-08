/**
 * Dynamic model discovery. Lists models live from each provider's
 * `/v1/models` endpoint with a 5-minute in-memory cache.
 *
 * On any auth/transport failure the call is best-effort: cached value
 * is returned if present, else an empty list. Callers SHOULD union the
 * returned list with the static REGISTRY in `models.ts` so the UI
 * stays useful even when the provider is unreachable.
 */

import type { ProviderKey } from "./models.ts";

export interface DynamicModel {
  /** Provider-prefixed slug compatible with resolveModel(). */
  slug: string;
  /** Provider key. */
  provider: ProviderKey;
  /** Raw model id at the provider. */
  apiId: string;
}

interface CacheEntry {
  list: DynamicModel[];
  fetchedAt: number;
}

const TTL_MS = 5 * 60_000; // 5 minutes
const cache = new Map<ProviderKey, CacheEntry>();

export function clearDynamicModelCache(): void {
  cache.clear();
}

export function __setDynamicModelCacheForTests(
  provider: ProviderKey,
  list: DynamicModel[] | null,
  fetchedAt: number = Date.now(),
): void {
  if (list === null) cache.delete(provider);
  else cache.set(provider, { list, fetchedAt });
}

/** Fetch the live model list for a provider. Returns [] on auth/transport failure. */
export async function listProviderModels(
  provider: ProviderKey,
  signal?: AbortSignal,
): Promise<DynamicModel[]> {
  const cached = cache.get(provider);
  if (cached !== undefined && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.list;
  }
  try {
    const list = await fetchProvider(provider, signal);
    cache.set(provider, { list, fetchedAt: Date.now() });
    return list;
  } catch {
    // Transport / auth error — return cached if any, else empty.
    return cached?.list ?? [];
  }
}

/** Sorted by provider then by slug. Filtered to providers with a key set. */
export async function listAllDynamicModels(signal?: AbortSignal): Promise<DynamicModel[]> {
  const providers: ProviderKey[] = [
    "anthropic",
    "openai",
    "xai",
    "deepseek",
    "openrouter",
    "vercel-gateway",
    "cerebras",
    "groq",
    "nvidia",
    "opencode-zen",
    "opencode-go",
  ];
  const lists = await Promise.all(
    providers
      .filter((p) => Boolean(process.env[envKey(p)]))
      .map((p) => listProviderModels(p, signal)),
  );
  return lists
    .flat()
    .sort((a, b) =>
      a.provider === b.provider
        ? a.slug.localeCompare(b.slug)
        : a.provider.localeCompare(b.provider),
    );
}

function envKey(provider: ProviderKey): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "vercel-gateway":
      return "VERCEL_AI_GATEWAY_API_KEY";
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "nvidia":
      return "NVIDIA_API_KEY";
    case "opencode-zen":
      return "OPENCODE_ZEN_API_KEY";
    case "opencode-go":
      return "OPENCODE_GO_API_KEY";
  }
}

async function fetchProvider(provider: ProviderKey, signal?: AbortSignal): Promise<DynamicModel[]> {
  const key = process.env[envKey(provider)];
  if (key === undefined || key === "") return [];
  switch (provider) {
    case "anthropic":
      return fetchAnthropic(key, signal);
    case "openai":
      return fetchOpenAICompatible("openai", "https://api.openai.com/v1/models", key, signal);
    case "xai":
      return fetchOpenAICompatible("xai", "https://api.x.ai/v1/models", key, signal);
    case "deepseek":
      return fetchOpenAICompatible("deepseek", "https://api.deepseek.com/v1/models", key, signal);
    case "openrouter":
      return fetchOpenAICompatible(
        "openrouter",
        "https://openrouter.ai/api/v1/models",
        key,
        signal,
      );
    case "vercel-gateway":
      return fetchOpenAICompatible(
        "vercel-gateway",
        "https://ai-gateway.vercel.sh/v1/models",
        key,
        signal,
      );
    case "cerebras":
      return fetchOpenAICompatible("cerebras", "https://api.cerebras.ai/v1/models", key, signal);
    case "groq":
      return fetchOpenAICompatible("groq", "https://api.groq.com/openai/v1/models", key, signal);
    case "nvidia":
      return fetchOpenAICompatible(
        "nvidia",
        "https://integrate.api.nvidia.com/v1/models",
        key,
        signal,
      );
    case "opencode-zen":
      return fetchOpenAICompatible(
        "opencode-zen",
        "https://api.opencodezen.dev/v1/models",
        key,
        signal,
      );
    case "opencode-go":
      return fetchOpenAICompatible(
        "opencode-go",
        "https://api.opencode-go.dev/v1/models",
        key,
        signal,
      );
  }
}

async function fetchAnthropic(key: string, signal?: AbortSignal): Promise<DynamicModel[]> {
  const r = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { id: string }[] };
  return (j.data ?? []).map((m) => ({
    slug: `anthropic/${m.id}`,
    provider: "anthropic" as const,
    apiId: m.id,
  }));
}

async function fetchOpenAICompatible(
  provider: ProviderKey,
  url: string,
  key: string,
  signal?: AbortSignal,
): Promise<DynamicModel[]> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { id: string }[] };
  return (j.data ?? []).map((m) => ({
    slug: `${provider}/${m.id}`,
    provider,
    apiId: m.id,
  }));
}
