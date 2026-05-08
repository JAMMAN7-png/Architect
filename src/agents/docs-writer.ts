import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "../orchestrator/events.ts";
import type { ManifestEntry } from "../validate/docs.ts";
import { callLlm } from "./llm-helpers.ts";

const SYSTEM = `You are a Docs Writer. Produce a lean, implementation-focused Markdown
document for the requested manifest entry. NO tutorials, NO filler, NO
preface. The doc must be complete, scannable, and useful to a coder.

Constraints:
  - Use the exact filename intent in the title.
  - Section headings only when they earn their keep.
  - Bullet lists over paragraphs when the content is enumerable.
  - Quote the relevant decisions verbatim from the input.`;

export interface DocWriteRequest {
  entry: ManifestEntry;
  context: string;
}

export interface DocWriteResult {
  path: string;
  content: string;
}

export async function writeManifestDoc(args: {
  router: LLMRouter;
  bus: ProgressBus;
  request: DocWriteRequest;
}): Promise<DocWriteResult> {
  const userBlock =
    `<<<MANIFEST_ENTRY\n${JSON.stringify(args.request.entry, null, 2)}\nMANIFEST_ENTRY>>>\n\n` +
    `<<<CONTEXT\n${args.request.context}\nCONTEXT>>>`;
  const { text } = await callLlm({
    router: args.router,
    bus: args.bus,
    tier: "execution",
    agent: `docs-writer:${args.request.entry.path}`,
    system: SYSTEM,
    user: userBlock,
    maxTokens: 3000,
    temperature: 0.2,
  });
  return { path: args.request.entry.path, content: text.trim() };
}
