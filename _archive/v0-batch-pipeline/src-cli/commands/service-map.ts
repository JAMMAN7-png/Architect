import { resolve } from "node:path";
import { runPipeline } from "../../core/pipeline.ts";
import type { CommandCtx } from "../index.ts";

export async function run(ctx: CommandCtx): Promise<void> {
  const out = resolve(String(ctx.flags.out ?? "."));
  await runPipeline({
    out,
    initialIdea: "",
    brainstorm: false,
    research: false,
    yes: Boolean(ctx.flags.yes),
    git: false,
    startPhase: 4,
    stopAfterPhase: 4,
  });
}
