import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import { callLlm } from "./llm-helpers.ts";

const SYSTEM = `You are a topic research assistant. Given a custom user-proposed option
and the question it answers, return a 3-bullet TL;DR of what the option is,
when it's a good fit, and the most concrete watch-out. Cite at most one
authoritative source by name (no URLs needed).

Output format (Markdown, no headings):
  - what: …
  - good fit: …
  - watch-out: …`;

/**
 * Lightweight research detour used by the questionnaire phases when a user
 * picks a "Custom" option. Strategic if the topic looks novel; execution
 * tier otherwise — the simple heuristic is "use execution unless the topic
 * is one word", but we keep it on execution by default for cost.
 */
export async function researchSingleTopic(args: {
  router: LLMRouter;
  bus: ProgressBus;
  topic: string;
  context: string;
}): Promise<string> {
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "execution",
    agent: "topic-research",
    system: SYSTEM,
    user: `<<<QUESTION\n${args.context}\nQUESTION>>>\n<<<CUSTOM\n${args.topic}\nCUSTOM>>>`,
    maxTokens: 600,
    temperature: 0.3,
  });
  return text.trim();
}
