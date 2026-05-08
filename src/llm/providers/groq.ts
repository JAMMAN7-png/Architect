import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class GroqProvider extends OpenAICompatibleProvider {
  readonly id = "groq";
  protected override baseURL = "https://api.groq.com/openai/v1";
  protected envKey(): string {
    return "GROQ_API_KEY";
  }
}
