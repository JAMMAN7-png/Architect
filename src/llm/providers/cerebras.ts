import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class CerebrasProvider extends OpenAICompatibleProvider {
  readonly id = "cerebras";
  protected override baseURL = "https://api.cerebras.ai/v1";
  protected envKey(): string {
    return "CEREBRAS_API_KEY";
  }
}
