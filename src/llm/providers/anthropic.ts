import Anthropic from "@anthropic-ai/sdk";
import type { ChatProvider, ChatRequest, ChatResponse } from "../adapter.ts";
import { extractJson } from "../json-extract.ts";
import { estimateUsd, resolveModel } from "../models.ts";

/**
 * Anthropic Messages API adapter. Combines all `system` messages into the
 * top-level `system` parameter; user/assistant messages go into the array.
 */
export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic";
  private client: Anthropic | null = null;

  available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async chat(req: ChatRequest, modelId: string): Promise<ChatResponse> {
    const info = resolveModel(modelId);
    const client = this.getClient();

    const systemParts: string[] = [];
    const messages: Anthropic.MessageParam[] = [];
    for (const m of req.messages) {
      if (m.role === "system") systemParts.push(m.content);
      else messages.push({ role: m.role, content: m.content });
    }

    const started = Date.now();
    const res = await client.messages.create(
      {
        model: info.apiId,
        max_tokens: req.maxTokens ?? 4000,
        temperature: req.temperature,
        system: systemParts.join("\n\n") || undefined,
        messages,
        stop_sequences: req.stop,
      },
      { signal: req.signal },
    );

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    const json = req.jsonSchema ? extractJson(text) : undefined;

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
      stopReason: mapStop(res.stop_reason),
      latencyMs: Date.now() - started,
    };
  }
}

function mapStop(s: string | null): ChatResponse["stopReason"] {
  switch (s) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool";
    default:
      return "other";
  }
}
