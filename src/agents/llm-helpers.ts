import type { LLMRouter } from "../llm/router.ts";
import type { ModelTier } from "../llm/tiers.ts";
import type { ProgressBus } from "../orchestrator/events.ts";

/**
 * Thin shim around `LLMRouter.chat` that emits progress events so every
 * model call shows up in the unified UI (CLI + Telegram). All agents go
 * through this — never call the router directly.
 */
export async function callLlm(args: {
  router: LLMRouter;
  bus: ProgressBus;
  tier: ModelTier;
  agent: string;
  system: string;
  user: string;
  jsonSchema?: object;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; json: unknown | null }> {
  const { router, bus, tier, agent, system, user } = args;
  bus.emit({
    type: "tool_started",
    tool: `llm:${tier}:${agent}`,
    inputSummary: summarise(user),
  });
  const opts: {
    tier: ModelTier;
    messages: Array<{ role: "system" | "user"; content: string }>;
    jsonSchema?: object;
    maxTokens?: number;
    temperature?: number;
  } = {
    tier,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (args.jsonSchema !== undefined) opts.jsonSchema = args.jsonSchema;
  if (args.maxTokens !== undefined) opts.maxTokens = args.maxTokens;
  if (args.temperature !== undefined) opts.temperature = args.temperature;
  const res = await router.chat(opts);
  bus.emit({
    type: "tool_finished",
    tool: `llm:${tier}:${agent}`,
    resultSummary: `${res.usage?.outputTokens ?? "?"} tokens`,
  });
  return { text: res.text, json: res.json ?? null };
}

function summarise(s: string, max = 80): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
