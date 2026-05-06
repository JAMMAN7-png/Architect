import type { ModelTier } from "../core/types.ts";

/**
 * Unified LLM interface. Every provider implements ChatProvider; the router
 * exposes the same shape but resolves tier → provider per call.
 */

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  /** Tier the caller wants. Router resolves to a concrete model id. */
  tier: ModelTier;
  /** Conversation. System messages may appear anywhere; provider may flatten. */
  messages: ChatMessage[];
  /** Override the resolved model id. Rarely used. */
  modelOverride?: string;
  /** 0..1; default per-tier. */
  temperature?: number;
  /** Hard cap on output tokens. Default per-tier. */
  maxTokens?: number;
  /** Optional JSON schema the model is asked to emit. */
  jsonSchema?: object;
  /** Stop sequences. */
  stop?: string[];
  /** Optional abort signal. */
  signal?: AbortSignal;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD using a per-model price table; rough. */
  estimatedUsd: number;
}

export interface ChatResponse {
  /** Resolved provider id, e.g. "anthropic". */
  provider: string;
  /** Resolved model id, e.g. "claude-opus-4-5-20251015". */
  model: string;
  /** Concatenated assistant text. */
  text: string;
  /** Parsed JSON if jsonSchema was provided AND the model produced valid JSON. */
  json?: unknown;
  usage: ChatUsage;
  /** Provider stop reason: "stop", "length", "error", … */
  stopReason: "stop" | "length" | "error" | "filter" | "tool" | "other";
  /** Latency in ms. */
  latencyMs: number;
}

export interface ChatProvider {
  /** Provider id, e.g. "anthropic", "openai". */
  readonly id: string;
  /** Whether this provider is currently usable (key present). */
  available(): boolean;
  /** Single non-streaming completion. */
  chat(req: ChatRequest, modelId: string): Promise<ChatResponse>;
}

/** Thrown when no provider is available for a tier. */
export class MissingProviderError extends Error {
  constructor(
    public readonly tier: ModelTier,
    public readonly modelId: string,
    public readonly hint: string,
  ) {
    super(`No provider available for tier '${tier}' (model '${modelId}'). ${hint}`);
    this.name = "MissingProviderError";
  }
}

/** Per-tier defaults. */
export const TIER_DEFAULTS: Record<
  ModelTier,
  { temperature: number; maxTokens: number; systemPrefix: string }
> = {
  strategic: {
    temperature: 0.3,
    maxTokens: 8000,
    systemPrefix:
      "You are a senior product+software architect. Be precise, concrete, and dependency-ordered. " +
      "Never invent features outside the explicit Spark. Prefer clear structure over prose.",
  },
  ensemble: {
    temperature: 0.5,
    maxTokens: 4000,
    systemPrefix:
      "You are an adversarial reviewer. Find concrete failure modes, not theoretical concerns. " +
      "Output ranked findings with severity (blocker|major|minor|info), scope, problem, recommendation.",
  },
  execution: {
    temperature: 0.2,
    maxTokens: 4000,
    systemPrefix:
      "You are an execution agent. Produce only the requested artifact in the requested format. " +
      "No commentary, no prose explanation, no scope expansion.",
  },
  ui: {
    temperature: 0.4,
    maxTokens: 4000,
    systemPrefix:
      "You are a UI/UX architect. Map every screen to a Blueprint-approved user journey, " +
      "every action to an API contract. No invented features.",
  },
};
