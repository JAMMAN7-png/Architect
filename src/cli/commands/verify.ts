import { resolve } from "node:path";
import kleur from "kleur";
import { verify } from "../../core/verify.ts";
import type { CommandCtx } from "../index.ts";

export async function run(ctx: CommandCtx): Promise<void> {
  const out = resolve(String(ctx.flags.out ?? "."));
  const result = await verify(out);
  if (result.ok) {
    console.log(kleur.green(`verify: ok (${result.checked} files, 0 violations)`));
    process.exit(0);
  }
  console.log(kleur.red(`verify: FAIL (${result.violations.length} violations)`));
  for (const v of result.violations) {
    console.log(`  ${kleur.red("✗")} ${v.path} — ${v.reason}`);
  }
  process.exit(1);
}
