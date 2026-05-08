import type { ChatProvider, ChatRequest, ChatResponse } from "../../src/llm/adapter.ts";

/**
 * Deterministic mock LLM. Rules are evaluated in registration order; the
 * first match wins. Falls back to a default response when nothing matches.
 */
export class MockProvider implements ChatProvider {
  readonly id = "mock";
  private rules: Array<{ match: (req: ChatRequest) => boolean; response: Partial<ChatResponse> }> =
    [];
  private defaultResponse: Partial<ChatResponse>;

  constructor(defaultResponse: Partial<ChatResponse> = { text: "" }) {
    this.defaultResponse = defaultResponse;
  }

  on(match: (req: ChatRequest) => boolean, response: Partial<ChatResponse>): this {
    this.rules.push({ match, response });
    return this;
  }

  onSystemContains(needle: string, response: Partial<ChatResponse>): this {
    return this.on(
      (req) => req.messages.some((m) => m.role === "system" && m.content.includes(needle)),
      response,
    );
  }

  available(): boolean {
    return true;
  }

  async chat(req: ChatRequest, modelId: string): Promise<ChatResponse> {
    for (const rule of this.rules) {
      if (rule.match(req)) return this.respond(modelId, rule.response);
    }
    return this.respond(modelId, this.defaultResponse);
  }

  private respond(modelId: string, partial: Partial<ChatResponse>): ChatResponse {
    const text = partial.text ?? "";
    const json = partial.json !== undefined ? partial.json : tryJson(text);
    const base: ChatResponse = {
      provider: "mock",
      model: modelId,
      text,
      usage: partial.usage ?? { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      stopReason: partial.stopReason ?? "stop",
      latencyMs: 0,
    };
    if (json !== undefined) base.json = json;
    return base;
  }
}

function tryJson(text: string): unknown {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
