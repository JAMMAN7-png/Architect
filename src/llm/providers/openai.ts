import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly id = "openai";
  protected envKey(): string {
    return "OPENAI_API_KEY";
  }
}
