import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class OpenCodeZenProvider extends OpenAICompatibleProvider {
  readonly id = "opencode-zen";
  // TODO(verify): canonical base URL per https://opencode.ai
  protected override baseURL = "https://opencode.ai/zen/v1";
  protected envKey(): string {
    return "OPENCODE_ZEN_API_KEY";
  }
}
