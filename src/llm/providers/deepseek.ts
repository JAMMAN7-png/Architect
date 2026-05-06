import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly id = "deepseek";
  protected override baseURL = "https://api.deepseek.com/v1";
  protected envKey(): string {
    return "DEEPSEEK_API_KEY";
  }
}
