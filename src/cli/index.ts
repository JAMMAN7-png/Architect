#!/usr/bin/env bun
import kleur from "kleur";
import yargsParser from "yargs-parser";
import { logger } from "../util/logger.ts";

const HELP = `architect — Idea-to-Blueprint generator

Usage:
  architect <command> [options]

Commands:
  new [idea]                 End-to-end: spark → blueprint → per-service docs
  brainstorm [--from FILE]   Interactive brainstorm → produces docs/spark.md
  blueprint                  Forge a blueprint from an existing spark.md
  review                     Run the QA attack review on an existing blueprint
  service-map                (Re)generate the service map
  generate                   (Re)generate per-service docs for a frozen blueprint
  verify                     Validate every doc is in the registry; exit 0/1
  config get|set|path        Read/write ~/.config/architect/config.toml
  doctor                     Check provider keys, network, model availability

Common options:
  --out DIR        Output root (default: cwd)
  --brainstorm     Run brainstorm before blueprint (only for 'new')
  --research       Use the search provider for research (only for 'new')
  --json           Force JSON logs
  --quiet, -q      Errors only
  --debug          Verbose logs
  --version        Print version
  --help, -h       This help

Docs: https://github.com/JAMMAN7-png/Architect
`;

async function main(): Promise<void> {
  const argv = yargsParser(process.argv.slice(2), {
    alias: { help: ["h"], quiet: ["q"], version: ["V"] },
    boolean: ["help", "version", "json", "quiet", "debug", "brainstorm", "research", "yes", "git"],
  });

  if (argv.json) process.env.ARCHITECT_JSON = "1";
  if (argv.debug) process.env.ARCHITECT_LOG = "debug";
  if (argv.quiet) process.env.ARCHITECT_LOG = "error";

  if (argv.version) {
    console.log(await readPackageVersion());
    process.exit(0);
  }
  if (argv.help || argv._.length === 0) {
    console.log(HELP);
    process.exit(argv._.length === 0 ? 1 : 0);
  }

  const cmd = String(argv._[0] ?? "");
  const rest = argv._.slice(1).map(String);

  try {
    switch (cmd) {
      case "doctor": {
        const { run } = await import("./commands/doctor.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "config": {
        const { run } = await import("./commands/config.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "verify": {
        const { run } = await import("./commands/verify.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "new": {
        const { run } = await import("./commands/new.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "brainstorm": {
        const { run } = await import("./commands/brainstorm.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "blueprint": {
        const { run } = await import("./commands/blueprint.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "review": {
        const { run } = await import("./commands/review.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "service-map": {
        const { run } = await import("./commands/service-map.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      case "generate": {
        const { run } = await import("./commands/generate.ts");
        await run({ args: rest, flags: argv });
        break;
      }
      default:
        console.error(kleur.red(`unknown command: ${cmd}`));
        console.log(HELP);
        process.exit(2);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (argv.debug) {
      logger.error({ err }, message);
    } else {
      console.error(kleur.red(`architect: ${message}`));
    }
    process.exit(1);
  }
}

// ARCHITECT_VERSION is replaced at build time by `bun build --define`. The
// fallback is the package.json read for dev mode where the constant isn't injected.
declare const ARCHITECT_VERSION: string;
async function readPackageVersion(): Promise<string> {
  try {
    if (typeof ARCHITECT_VERSION === "string" && ARCHITECT_VERSION.length > 0) {
      return ARCHITECT_VERSION;
    }
  } catch {
    // ARCHITECT_VERSION not defined; fall through.
  }
  try {
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const text = await Bun.file(pkgUrl.pathname).text();
    return JSON.parse(text).version as string;
  } catch {
    return "0.0.0";
  }
}

export interface CommandCtx {
  args: string[];
  // biome-ignore lint/suspicious/noExplicitAny: yargs flags
  flags: any;
}

await main();
