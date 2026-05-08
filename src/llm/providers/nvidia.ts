import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class NvidiaProvider extends OpenAICompatibleProvider {
  readonly id = "nvidia";
  protected override baseURL = "https://integrate.api.nvidia.com/v1";
  protected envKey(): string {
    return "NVIDIA_API_KEY";
  }
}
