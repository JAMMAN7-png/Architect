import { resolve } from "node:path";
import { runPipeline } from "../../core/pipeline.ts";
import type { CommandCtx } from "../index.ts";

export async function run(ctx: CommandCtx): Promise<void> {
  const out = resolve(String(ctx.flags.out ?? "."));
  await runPipeline({
    out,
    initialIdea: "",
    brainstorm: false,
    research: Boolean(ctx.flags.research),
    yes: Boolean(ctx.flags.yes),
    git: ctx.flags.git !== false,
    startPhase: 1,
    stopAfterPhase: 4,
  });
}
