import kleur from "kleur";
import { getKey, loadConfig, saveConfig, setKey } from "../../config/loader.ts";
import { configFile } from "../../config/paths.ts";
import type { CommandCtx } from "../index.ts";

export async function run(ctx: CommandCtx): Promise<void> {
  const sub = ctx.args[0] ?? "path";
  switch (sub) {
    case "path":
      console.log(configFile());
      return;
    case "show": {
      const cfg = await loadConfig();
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }
    case "get": {
      const key = ctx.args[1];
      if (!key) throw new Error("usage: architect config get <key>");
      const cfg = await loadConfig();
      const v = getKey(cfg, key);
      if (v === undefined) {
        console.error(kleur.red(`unknown key: ${key}`));
        process.exit(2);
      }
      console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
      return;
    }
    case "set": {
      const key = ctx.args[1];
      const raw = ctx.args[2];
      if (!key || raw === undefined) {
        throw new Error("usage: architect config set <key> <value>");
      }
      const cfg = await loadConfig();
      const value = parseValue(raw);
      const next = setKey(cfg, key, value);
      const path = await saveConfig(next);
      console.log(kleur.green(`set ${key}=${JSON.stringify(value)}`));
      console.log(kleur.dim(`written to ${path}`));
      return;
    }
    default:
      throw new Error(`unknown subcommand: ${sub}. try: path | show | get | set`);
  }
}

function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d*\.\d+$/.test(raw)) return Number.parseFloat(raw);
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through
    }
  }
  return raw;
}
