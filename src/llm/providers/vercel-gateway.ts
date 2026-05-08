import { OpenAICompatibleProvider } from "./openai-compatible.ts";

export class VercelGatewayProvider extends OpenAICompatibleProvider {
  readonly id = "vercel-gateway";
  protected override baseURL = "https://ai-gateway.vercel.sh/v1";
  protected envKey(): string {
    return "VERCEL_AI_GATEWAY_API_KEY";
  }
}
