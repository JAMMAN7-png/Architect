import type { ArchitectConfig } from "../config/schema.ts";
import { logger } from "../util/logger.ts";
import { retry } from "../util/promise.ts";
import {
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  MissingProviderError,
  TIER_DEFAULTS,
} from "./adapter.ts";
import { resolveModel } from "./models.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { CerebrasProvider } from "./providers/cerebras.ts";
import { DeepSeekProvider } from "./providers/deepseek.ts";
import { GroqProvider } from "./providers/groq.ts";
import { NvidiaProvider } from "./providers/nvidia.ts";
import { OpenAIProvider } from "./providers/openai.ts";
import { OpenCodeGoProvider } from "./providers/opencode-go.ts";
import { OpenCodeZenProvider } from "./providers/opencode-zen.ts";
import { OpenRouterProvider } from "./providers/openrouter.ts";
import { VercelGatewayProvider } from "./providers/vercel-gateway.ts";
import { XaiProvider } from "./providers/xai.ts";
import type { ModelTier } from "./tiers.ts";

/** Detect transient errors that are safe to retry. */
function isTransient(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === "AbortError") return false;
  const status = (err as { status?: number }).status;
  if (status != null) {
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500) return true;
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|unknown certificate verification error|UNKNOWN_CERTIFICATE_VERIFICATION_ERROR|socket connection was closed|EPIPE|ECONNREFUSED|Connection error|APIConnectionError/i.test(
    msg,
  );
}
/**
 * Resolves a tiered request to a concrete provider+model and dispatches.
 * Auto-fallback to OpenRouter when the resolved provider has no key.
 */
export class LLMRouter {
  private readonly providers: Record<string, ChatProvider>;

  constructor(
    private readonly cfg: ArchitectConfig,
    overrides?: Partial<Record<string, ChatProvider>>,
  ) {
    this.providers = {
      anthropic: new AnthropicProvider(),
      openai: new OpenAIProvider(),
      xai: new XaiProvider(),
      deepseek: new DeepSeekProvider(),
      openrouter: new OpenRouterProvider(),
      "vercel-gateway": new VercelGatewayProvider(),
      cerebras: new CerebrasProvider(),
      groq: new GroqProvider(),
      nvidia: new NvidiaProvider(),
      "opencode-zen": new OpenCodeZenProvider(),
      "opencode-go": new OpenCodeGoProvider(),
      ...overrides,
    };
  }

  /** Which providers are usable right now. */
  availability(): Record<string, boolean> {
    return Object.fromEntries(Object.entries(this.providers).map(([k, v]) => [k, v.available()]));
  }

  /** The model id for a tier, after env overrides are applied. */
  modelFor(tier: ModelTier): string {
    if (tier === "ensemble") {
      // For a single-shot call against the ensemble tier, we use the first member.
      // Use ensembleChat() to fan out across all members.
      return this.cfg.models.ensemble[0] ?? this.cfg.models.execution;
    }
    return this.cfg.models[tier];
  }

  /** Single completion. Applies tier defaults and fallback routing. */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const defaults = TIER_DEFAULTS[req.tier];
    const messages = prefixSystem(req.messages, defaults.systemPrefix);
    const requestedModel = req.modelOverride ?? this.modelFor(req.tier);
    const requested = resolveModel(requestedModel);
    const provider = this.providers[requested.provider];

    const chatReq = {
      ...req,
      messages,
      temperature: req.temperature ?? defaults.temperature,
      maxTokens: req.maxTokens ?? defaults.maxTokens,
    };

    if (!provider || !provider.available()) {
      // Fallback path: route through OpenRouter; pass the original model slug.
      const orProvider = this.providers.openrouter;
      if (orProvider?.available()) {
        const orModelId = requestedModel;
        return retry(() => orProvider.chat(chatReq, orModelId), {
          attempts: 4,
          baseMs: 500,
          maxMs: 8_000,
          signal: req.signal,
          shouldRetry: isTransient,
        });
      }
      throw new MissingProviderError(
        req.tier,
        requestedModel,
        `Set ${envKeyFor(requested.provider)} or OPENROUTER_API_KEY.`,
      );
    }

    return retry(() => provider.chat(chatReq, requestedModel), {
      attempts: 4,
      baseMs: 500,
      maxMs: 8_000,
      signal: req.signal,
      shouldRetry: isTransient,
    });
  }

  /**
   * Run the same prompt across every member of `models.ensemble` in parallel.
   * Returns an array in the configured order; missing providers fall back to OpenRouter.
   */
  async ensembleChat(base: Omit<ChatRequest, "tier" | "modelOverride">): Promise<ChatResponse[]> {
    const ids = this.cfg.models.ensemble;
    if (ids.length === 0) {
      throw new Error("ensembleChat: models.ensemble is empty");
    }
    const results = await Promise.allSettled(
      ids.map((id) => this.chat({ ...base, tier: "ensemble", modelOverride: id })),
    );
    const fulfilled: ChatResponse[] = [];
    const failures: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      if (r.status === "fulfilled") {
        fulfilled.push(r.value);
      } else {
        const id = ids[i];
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        logger.warn(`ensembleChat: provider ${id} failed: ${msg}`);
        failures.push(`${id}: ${msg}`);
      }
    }
    if (failures.length === ids.length) {
      throw new Error(`ensembleChat: all providers failed: ${failures.join("; ")}`);
    }
    return fulfilled;
  }
}

function prefixSystem(messages: ChatRequest["messages"], prefix: string): ChatRequest["messages"] {
  const hasSystem = messages.some((m) => m.role === "system");
  if (hasSystem) return messages;
  return [{ role: "system", content: prefix }, ...messages];
}

function envKeyFor(provider: string): string {
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
    default:
      return `${provider.toUpperCase()}_API_KEY`;
  }
}
