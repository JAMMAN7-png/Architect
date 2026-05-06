import { resolve } from "node:path";
import { runPipeline } from "../../core/pipeline.ts";
import { readFileMaybe } from "../../util/fs.ts";
import { readStdin } from "../../util/io.ts";
import type { CommandCtx } from "../index.ts";

export async function run(ctx: CommandCtx): Promise<void> {
  const out = resolve(String(ctx.flags.out ?? "."));
  const ideaPath = ctx.args[0];

  let initialIdea = "";
  if (ideaPath) {
    const text = await readFileMaybe(ideaPath);
    if (text == null) throw new Error(`idea file not found: ${ideaPath}`);
    initialIdea = text;
  } else {
    initialIdea = (await readStdin()).trim();
  }

  await runPipeline({
    out,
    initialIdea,
    brainstorm: Boolean(ctx.flags.brainstorm),
    research: Boolean(ctx.flags.research),
    yes: Boolean(ctx.flags.yes),
    git: ctx.flags.git !== false,
  });
}
