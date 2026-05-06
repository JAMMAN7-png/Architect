import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class OpenRouterProvider extends OpenAICompatibleProvider {
  readonly id = "openrouter";
  protected override baseURL = "https://openrouter.ai/api/v1";
  protected override extraHeaders = {
    "HTTP-Referer": "https://github.com/JAMMAN7-png/Architect",
    "X-Title": "Architect CLI",
  };
  protected envKey(): string {
    return "OPENROUTER_API_KEY";
  }
}
