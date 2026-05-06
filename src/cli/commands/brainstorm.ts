import { resolve } from "node:path";
import { runBrainstormSession } from "../../brainstorm/session.ts";
import { loadConfig } from "../../config/loader.ts";
import { LLMRouter } from "../../llm/router.ts";
import { readFileMaybe, writeFileSafe } from "../../util/fs.ts";
import { readStdin } from "../../util/io.ts";
import type { CommandCtx } from "../index.ts";

export async function run(ctx: CommandCtx): Promise<void> {
  const cfg = await loadConfig();
  const router = new LLMRouter(cfg);

  const fromPath = ctx.flags.from ? String(ctx.flags.from) : undefined;
  const outPath = resolve(String(ctx.flags.out ?? "docs/spark.md"));

  let seed = "";
  if (fromPath) {
    const text = await readFileMaybe(fromPath);
    if (text == null) throw new Error(`brainstorm: --from file not found: ${fromPath}`);
    seed = text;
  } else if (!process.stdin.isTTY) {
    seed = (await readStdin()).trim();
  }

  const spark = await runBrainstormSession({
    router,
    cfg,
    seed,
  });

  await writeFileSafe(outPath, spark);
  console.log(`spark written: ${outPath}`);
}
