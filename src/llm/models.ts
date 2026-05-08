/**
 * Model registry. Maps configured ids (provider/model) to:
 *   - canonical provider key (anthropic | openai | xai | deepseek | openrouter |
 *     vercel-gateway | cerebras | groq | nvidia | opencode-zen | opencode-go)
 *   - actual model id sent to that provider
 *   - rough USD-per-token rates (input/output) for cost estimates
 *
 * The registry is intentionally permissive — unknown models pass through, and
 * cost estimates fall back to a neutral default when a model isn't recognized.
 */

export type ProviderKey =
  | "anthropic"
  | "openai"
  | "xai"
  | "deepseek"
  | "openrouter"
  | "vercel-gateway"
  | "cerebras"
  | "groq"
  | "nvidia"
  | "opencode-zen"
  | "opencode-go";

export interface ModelInfo {
  /** Provider that the request goes to. */
  provider: ProviderKey;
  /** Model id sent on the wire to that provider. */
  apiId: string;
  /** USD per 1M input tokens. */
  inUsdPerM: number;
  /** USD per 1M output tokens. */
  outUsdPerM: number;
}

/** Default cost when a model is unknown. Conservative; rate-card on the higher side. */
const DEFAULT_COST: Pick<ModelInfo, "inUsdPerM" | "outUsdPerM"> = {
  inUsdPerM: 5,
  outUsdPerM: 15,
};

const REGISTRY: Record<string, ModelInfo> = {
  // Anthropic
  "anthropic/claude-opus-4-5": {
    provider: "anthropic",
    apiId: "claude-opus-4-5",
    inUsdPerM: 15,
    outUsdPerM: 75,
  },
  "anthropic/claude-sonnet-4-5": {
    provider: "anthropic",
    apiId: "claude-sonnet-4-5",
    inUsdPerM: 3,
    outUsdPerM: 15,
  },
  "anthropic/claude-haiku-4-5": {
    provider: "anthropic",
    apiId: "claude-haiku-4-5",
    inUsdPerM: 1,
    outUsdPerM: 5,
  },
  // OpenAI
  "openai/gpt-5": { provider: "openai", apiId: "gpt-5", inUsdPerM: 5, outUsdPerM: 20 },
  "openai/gpt-5-mini": { provider: "openai", apiId: "gpt-5-mini", inUsdPerM: 0.5, outUsdPerM: 2 },
  "openai/o4-mini": { provider: "openai", apiId: "o4-mini", inUsdPerM: 1.1, outUsdPerM: 4.4 },
  // xAI
  "xai/grok-4": { provider: "xai", apiId: "grok-4", inUsdPerM: 5, outUsdPerM: 15 },
  // DeepSeek
  "deepseek/deepseek-chat": {
    provider: "deepseek",
    apiId: "deepseek-chat",
    inUsdPerM: 0.27,
    outUsdPerM: 1.1,
  },
  "deepseek/deepseek-r1": {
    provider: "deepseek",
    apiId: "deepseek-reasoner",
    inUsdPerM: 0.55,
    outUsdPerM: 2.19,
  },
  // OpenRouter (used as fallback only)
  "openrouter/auto": {
    provider: "openrouter",
    apiId: "openrouter/auto",
    inUsdPerM: 5,
    outUsdPerM: 15,
  },
  // Vercel AI Gateway (proxies upstream providers; cost approx mirrors upstream rate-card)
  "vercel-gateway/anthropic/claude-sonnet-4-5": {
    provider: "vercel-gateway",
    apiId: "anthropic/claude-sonnet-4-5",
    inUsdPerM: 3,
    outUsdPerM: 15,
  },
  "vercel-gateway/openai/gpt-5-mini": {
    provider: "vercel-gateway",
    apiId: "openai/gpt-5-mini",
    inUsdPerM: 0.5,
    outUsdPerM: 2,
  },
  // Cerebras (approx pricing)
  "cerebras/llama-3.3-70b": {
    provider: "cerebras",
    apiId: "llama-3.3-70b",
    inUsdPerM: 0.85,
    outUsdPerM: 1.2,
  },
  // Groq (approx pricing)
  "groq/llama-3.3-70b-versatile": {
    provider: "groq",
    apiId: "llama-3.3-70b-versatile",
    inUsdPerM: 0.59,
    outUsdPerM: 0.79,
  },
  "groq/llama-3.1-8b-instant": {
    provider: "groq",
    apiId: "llama-3.1-8b-instant",
    inUsdPerM: 0.05,
    outUsdPerM: 0.08,
  },
  // NVIDIA NIM (approx pricing)
  "nvidia/meta/llama-3.3-70b-instruct": {
    provider: "nvidia",
    apiId: "meta/llama-3.3-70b-instruct",
    inUsdPerM: 0.2,
    outUsdPerM: 0.2,
  },
  // OpenCode Zen / Go (approx; actual rates depend on upstream model)
  "opencode-zen/claude-sonnet-4-5": {
    provider: "opencode-zen",
    apiId: "claude-sonnet-4-5",
    inUsdPerM: 3,
    outUsdPerM: 15,
  },
  "opencode-go/gpt-5": {
    provider: "opencode-go",
    apiId: "gpt-5",
    inUsdPerM: 5,
    outUsdPerM: 20,
  },
};

/** Resolve an id like "anthropic/claude-opus-4-5" to a ModelInfo. */
export function resolveModel(id: string): ModelInfo {
  const entry = REGISTRY[id];
  if (entry) return entry;

  // Unknown id with a slash: trust the prefix as the provider key. The router
  // will decide whether a provider with that key is registered (e.g. for tests
  // we register "mock"). Without a slash, fall back to OpenRouter passthrough.
  const slashIdx = id.indexOf("/");
  if (slashIdx > 0) {
    const prefix = id.slice(0, slashIdx) as ProviderKey;
    const rest = id.slice(slashIdx + 1);
    return { provider: prefix, apiId: rest, ...DEFAULT_COST };
  }

  // Last resort: treat as OpenRouter passthrough.
  return { provider: "openrouter", apiId: id, ...DEFAULT_COST };
}

/** Estimate USD for input/output token counts on a given model id. */
export function estimateUsd(modelId: string, inTokens: number, outTokens: number): number {
  const info = resolveModel(modelId);
  return (inTokens / 1_000_000) * info.inUsdPerM + (outTokens / 1_000_000) * info.outUsdPerM;
}
