import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class XaiProvider extends OpenAICompatibleProvider {
  readonly id = "xai";
  protected override baseURL = "https://api.x.ai/v1";
  protected envKey(): string {
    return "XAI_API_KEY";
  }
}
