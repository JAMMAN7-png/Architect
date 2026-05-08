import type { ChatProvider, ChatRequest, ChatResponse } from "../../src/llm/adapter.ts";

/**
 * Deterministic mock LLM. Looks up a response by a classifier function
 * (default: matches against the last user message). Falls through to a
 * default response if no rule matches.
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

  onContains(needle: string, response: Partial<ChatResponse>): this {
    return this.on((req) => {
      const last = req.messages[req.messages.length - 1];
      return Boolean(last?.content.includes(needle));
    }, response);
  }

  available(): boolean {
    return true;
  }

  async chat(req: ChatRequest, modelId: string): Promise<ChatResponse> {
    for (const rule of this.rules) {
      if (rule.match(req)) {
        return this.respond(req, modelId, rule.response);
      }
    }
    return this.respond(req, modelId, this.defaultResponse);
  }

  private respond(
    _req: ChatRequest,
    modelId: string,
    partial: Partial<ChatResponse>,
  ): ChatResponse {
    const text = partial.text ?? "";
    const json = partial.json !== undefined ? partial.json : tryJson(text);
    return {
      provider: "mock",
      model: modelId,
      text,
      json,
      usage: partial.usage ?? { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      stopReason: partial.stopReason ?? "stop",
      latencyMs: 0,
    };
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
