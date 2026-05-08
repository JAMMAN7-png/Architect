import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class OpenCodeGoProvider extends OpenAICompatibleProvider {
  readonly id = "opencode-go";
  // TODO(verify): canonical base URL per https://opencode.ai
  protected override baseURL = "https://opencode.ai/go/v1";
  protected envKey(): string {
    return "OPENCODE_GO_API_KEY";
  }
}
