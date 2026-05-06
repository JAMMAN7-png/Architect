import OpenAI from "openai";
import type { ChatProvider, ChatRequest, ChatResponse } from "../adapter.ts";
import { estimateUsd, resolveModel } from "../models.ts";

/**
 * Shared base for any OpenAI-compatible provider (OpenAI, OpenRouter, DeepSeek, xAI).
 * Subclasses override id, env var name, and base URL.
 */
export abstract class OpenAICompatibleProvider implements ChatProvider {
  abstract readonly id: string;
  protected abstract envKey(): string;
  protected baseURL?: string;
  protected extraHeaders?: Record<string, string>;
  private client: OpenAI | null = null;

  available(): boolean {
    return Boolean(process.env[this.envKey()]);
  }

  protected getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env[this.envKey()];
      if (!apiKey) throw new Error(`${this.envKey()} not set`);
      this.client = new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        defaultHeaders: this.extraHeaders,
      });
    }
    return this.client;
  }

  async chat(req: ChatRequest, modelId: string): Promise<ChatResponse> {
    const info = resolveModel(modelId);
    const client = this.getClient();
    const started = Date.now();

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: info.apiId,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: req.maxTokens ?? 4000,
      temperature: req.temperature,
      stop: req.stop,
    };

    // If a JSON schema is requested, hint via response_format on providers that support it.
    if (req.jsonSchema) {
      params.response_format = { type: "json_object" };
    }

    const res = await client.chat.completions.create(params, { signal: req.signal });
    const choice = res.choices[0];
    if (!choice) throw new Error(`${this.id}: empty completion`);

    const text = choice.message.content ?? "";
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    const json = tryParseJson(text, req.jsonSchema);

    return {
      provider: this.id,
      model: info.apiId,
      text,
      json,
      usage: {
        inputTokens,
        outputTokens,
        estimatedUsd: estimateUsd(modelId, inputTokens, outputTokens),
      },
      stopReason: mapStop(choice.finish_reason),
      latencyMs: Date.now() - started,
    };
  }
}

function mapStop(s: string | null): ChatResponse["stopReason"] {
  switch (s) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "filter";
    case "tool_calls":
    case "function_call":
      return "tool";
    default:
      return "other";
  }
}

function tryParseJson(text: string, schema: object | undefined): unknown {
  if (!schema) return undefined;
  const trimmed = stripFences(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
  return m ? (m[1] ?? text) : text;
}
