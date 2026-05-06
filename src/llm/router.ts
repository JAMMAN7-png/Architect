import type { ArchitectConfig } from "../config/schema.ts";
import type { ModelTier } from "../core/types.ts";
import { mapWithCap } from "../util/promise.ts";
import {
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  MissingProviderError,
  TIER_DEFAULTS,
} from "./adapter.ts";
import { resolveModel } from "./models.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { DeepSeekProvider } from "./providers/deepseek.ts";
import { OpenAIProvider } from "./providers/openai.ts";
import { OpenRouterProvider } from "./providers/openrouter.ts";
import { XaiProvider } from "./providers/xai.ts";

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

    if (!provider || !provider.available()) {
      // Fallback path: route through OpenRouter using the original model id as the OR slug.
      const orProvider = this.providers.openrouter;
      if (orProvider?.available()) {
        const orModelId = `openrouter/${requestedModel.replace(/^[^/]+\//, "")}`;
        return orProvider.chat(
          {
            ...req,
            messages,
            temperature: req.temperature ?? defaults.temperature,
            maxTokens: req.maxTokens ?? defaults.maxTokens,
          },
          orModelId,
        );
      }
      throw new MissingProviderError(
        req.tier,
        requestedModel,
        `Set ${envKeyFor(requested.provider)} or OPENROUTER_API_KEY.`,
      );
    }

    return provider.chat(
      {
        ...req,
        messages,
        temperature: req.temperature ?? defaults.temperature,
        maxTokens: req.maxTokens ?? defaults.maxTokens,
      },
      requestedModel,
    );
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
    return mapWithCap(ids, ids.length, (id) =>
      this.chat({ ...base, tier: "ensemble", modelOverride: id }),
    );
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
    default:
      return `${provider.toUpperCase()}_API_KEY`;
  }
}
