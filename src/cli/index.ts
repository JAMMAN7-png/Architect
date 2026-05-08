#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import kleur from "kleur";
import { loadConfig } from "../config/loader.ts";
import { configFile } from "../config/paths.ts";
import { LLM_PROVIDERS, SEARCH_PROVIDERS, makeSettingsService } from "../config/service.ts";
import { makeCliPrompts } from "../interface/cli/prompts.ts";
import { CliRenderer } from "../interface/cli/renderer.ts";
import { confirmReset, printConfig, promptValue } from "../interface/cli/settings-prompt.ts";
import { Liaison } from "../interface/liaison.ts";
import { registerArchitectActions } from "../interface/telegram/architect/actions.ts";
import {
  architectPages,
  registerModePageActions,
  registerSettingsActions,
  registerSparkPageActions,
} from "../interface/telegram/architect/pages/index.ts";
import { makeArchitectRunner } from "../interface/telegram/architect/runner.ts";
import { FileSessionStore } from "../interface/telegram/engine/session/store.ts";
import { startTelefocusBot } from "../interface/telegram/server.ts";
import { serveBot } from "../interface/telegram/webhook.ts";
import { LLMRouter } from "../llm/router.ts";
import { resolveApproval } from "../orchestrator/approvals.ts";
import { ProjectExistsError, bootstrapProject } from "../orchestrator/bootstrap.ts";
import { advance } from "../orchestrator/engine.ts";
import { ProgressBus } from "../orchestrator/events.ts";
import { buildDefaultRegistry } from "../orchestrator/phases/index.ts";
import type { ArchitectState } from "../orchestrator/state.ts";
import { loadState, saveState, stateExists, statePath } from "../orchestrator/store.ts";
import { logger } from "../util/logger.ts";

declare const ARCHITECT_VERSION: string;

async function readVersion(): Promise<string> {
  try {
    if (typeof ARCHITECT_VERSION === "string" && ARCHITECT_VERSION) return ARCHITECT_VERSION;
  } catch {
    /* not defined in dev */
  }
  try {
    const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const pkg = JSON.parse(await readFile(resolve(here, "../../package.json"), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function makeBus(): { bus: ProgressBus; liaison: Liaison } {
  const bus = new ProgressBus();
  const liaison = new Liaison(bus);
  liaison.attach(new CliRenderer());
  return { bus, liaison };
}

async function findProjectRoot(name?: string, cwd = process.cwd()): Promise<string> {
  if (name) {
    const direct = resolve(cwd, name);
    if (await stateExists(direct)) return direct;
    const inProjects = resolve(cwd, "projects", name);
    if (await stateExists(inProjects)) return inProjects;
    throw new Error(`No project named "${name}" found (looked at ${direct} and ${inProjects}).`);
  }
  if (await stateExists(cwd)) return cwd;
  throw new Error(
    `No architect.state.json in ${cwd}. Pass a project name or cd into a project root.`,
  );
}

function summariseState(state: ArchitectState): string {
  const parts = [
    `${kleur.bold(state.projectName)} ${kleur.gray(`(${state.projectId})`)}`,
    `  stage: ${kleur.cyan(state.currentStage)}`,
    `  approvals: ${state.approvals.length}`,
    `  pending: ${state.pendingApproval ? kleur.yellow(state.pendingApproval.gate) : kleur.gray("none")}`,
    `  blueprint locked: ${state.blueprintLocked ? kleur.green("yes") : kleur.gray("no")}`,
    `  root: ${kleur.gray(state.projectRoot)}`,
  ];
  return parts.join("\n");
}

async function runEngine(state: ArchitectState): Promise<ArchitectState> {
  const { bus } = makeBus();
  const cfg = await loadConfig();
  const router = new LLMRouter(cfg);
  const prompts = makeCliPrompts();
  const registry = buildDefaultRegistry();
  return advance(state, { bus, router, prompts, registry });
}

const program = new Command();
program
  .name("architect")
  .description("Idea-to-Blueprint compiler — human-in-the-loop")
  .version(await readVersion());

program
  .command("new <name>")
  .description("Create a new Architect project")
  .option(
    "--projects-root <path>",
    "Where to create the project",
    resolve(process.cwd(), "projects"),
  )
  .option("--spark <path>", "Read the spark from a file path")
  .action(async (name: string, opts: { projectsRoot: string; spark?: string }) => {
    try {
      let state = await bootstrapProject({ projectName: name, projectsRoot: opts.projectsRoot });
      const { bus } = makeBus();
      bus.emit({ type: "info", message: `created ${state.projectRoot}` });
      if (opts.spark) {
        const target = resolve(state.projectRoot, "docs", "00-human-spark.md");
        await (await import("node:fs/promises")).writeFile(
          target,
          await (await import("node:fs/promises")).readFile(opts.spark, "utf8"),
          "utf8",
        );
        bus.emit({ type: "info", message: `staged spark from ${opts.spark}` });
      }
      state = await runEngine(state);
      if (state.pendingApproval) {
        bus.emit({
          type: "info",
          message: `paused at ${state.pendingApproval.gate} — run \`architect review\` to resolve`,
        });
      }
    } catch (err) {
      if (err instanceof ProjectExistsError) {
        process.stderr.write(`${kleur.red("✗")} ${err.message}\n`);
        process.exit(2);
      }
      throw err;
    }
  });

program
  .command("status [name]")
  .description("Show the current state of a project")
  .action(async (name: string | undefined) => {
    const root = await findProjectRoot(name);
    const state = await loadState(root);
    process.stdout.write(`${summariseState(state)}\n`);
  });

program
  .command("resume [name]")
  .description("Resume a paused project (advances the state machine)")
  .action(async (name: string | undefined) => {
    const root = await findProjectRoot(name);
    const state = await loadState(root);
    if (state.pendingApproval) {
      process.stdout.write(
        `${kleur.yellow("!")} resume blocked: ${state.pendingApproval.gate} approval pending. Use \`architect review\`.\n`,
      );
      return;
    }
    await runEngine(state);
  });

program
  .command("review [name]")
  .description("Resolve the pending approval for a project")
  .action(async (name: string | undefined) => {
    const root = await findProjectRoot(name);
    let state = await loadState(root);
    if (!state.pendingApproval) {
      process.stdout.write(`${kleur.gray("no pending approval")}\n`);
      return;
    }
    const { bus } = makeBus();
    const prompts = makeCliPrompts();
    const decision = await prompts.approve(
      state.pendingApproval.label,
      state.pendingApproval.artifact,
    );
    state = await resolveApproval(state, bus, decision);
    process.stdout.write(`${kleur.green("✓")} approval recorded: ${decision.status}\n`);
  });

program
  .command("doctor")
  .description("Check Architect environment")
  .action(async () => {
    const cfg = await loadConfig();
    process.stdout.write(`${kleur.bold("architect doctor")}\n`);
    process.stdout.write(`  config: ${kleur.gray(JSON.stringify(cfg.models))}\n`);
    const keys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "XAI_API_KEY",
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
      "VERCEL_AI_GATEWAY_API_KEY",
      "CEREBRAS_API_KEY",
      "GROQ_API_KEY",
      "NVIDIA_API_KEY",
      "OPENCODE_ZEN_API_KEY",
      "OPENCODE_GO_API_KEY",
      "EXA_API_KEY",
      "PARALLEL_API_KEY",
      "FIRECRAWL_API_KEY",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_ADMIN_CHAT_ID",
    ];
    for (const k of keys) {
      const present = !!process.env[k];
      process.stdout.write(`  ${present ? kleur.green("✓") : kleur.gray("·")} ${k}\n`);
    }
  });

program
  .command("verify [name]")
  .description("Run docs + blueprint validators against a project")
  .action(async (name: string | undefined) => {
    const root = await findProjectRoot(name);
    const state = await loadState(root);
    process.stdout.write(`${kleur.gray("verify is a stub in M1 — will be wired in M5/M6")}\n`);
    process.stdout.write(`  project: ${state.projectName}\n  root: ${state.projectRoot}\n`);
  });

const configGroup = program.command("config").description("View or change Architect settings");

configGroup
  .command("list")
  .description("Show resolved config")
  .action(async () => {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    process.stdout.write(`${kleur.gray("file: ")}${configFile()}\n${printConfig(cfg, svc)}\n`);
  });

configGroup
  .command("get <key>")
  .description("Read one setting by dotted key (e.g. models.strategic)")
  .action(async (key: string) => {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const value = svc.get(cfg, key);
    if (value === undefined) {
      process.stderr.write(`${kleur.red("✗")} unknown key: ${key}\n`);
      process.exit(2);
    }
    process.stdout.write(`${JSON.stringify(value)}\n`);
  });

configGroup
  .command("set <key> <value>")
  .description("Write one setting (value parsed per type)")
  .action(async (key: string, value: string) => {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    try {
      const next = svc.set(cfg, key, value);
      const path = await svc.save(next);
      const v = svc.get(next, key);
      process.stdout.write(
        `${kleur.green("✓")} ${key} = ${JSON.stringify(v)}\n${kleur.gray(`  saved to ${path}`)}\n`,
      );
    } catch (err) {
      process.stderr.write(`${kleur.red("✗")} ${(err as Error).message}\n`);
      process.exit(2);
    }
  });

configGroup
  .command("toggle <key> <member>")
  .description("Toggle membership in a list setting (e.g. search.enabled_providers parallel)")
  .action(async (key: string, member: string) => {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    try {
      const next = svc.toggle(cfg, key, member);
      const path = await svc.save(next);
      const v = svc.get(next, key);
      process.stdout.write(
        `${kleur.green("✓")} ${key} = ${JSON.stringify(v)}\n${kleur.gray(`  saved to ${path}`)}\n`,
      );
    } catch (err) {
      process.stderr.write(`${kleur.red("✗")} ${(err as Error).message}\n`);
      process.exit(2);
    }
  });

configGroup
  .command("edit")
  .description("Interactive editor for every setting")
  .action(async () => {
    const svc = makeSettingsService();
    let cfg = await svc.load();
    for (const d of svc.catalog()) {
      const current = svc.get(cfg, d.key);
      const next = await promptValue(d, current, svc.knownModels());
      cfg = svc.set(cfg, d.key, next);
    }
    const path = await svc.save(cfg);
    process.stdout.write(`${kleur.green("✓")} saved ${path}\n`);
  });

configGroup
  .command("models")
  .description("Interactive picker for the five tier models")
  .action(async () => {
    const svc = makeSettingsService();
    let cfg = await svc.load();
    const tierKeys = [
      "models.strategic",
      "models.execution",
      "models.ui",
      "models.fallback",
      "models.ensemble",
    ];
    for (const key of tierKeys) {
      const d = svc.describe(key);
      const current = svc.get(cfg, key);
      const next = await promptValue(d, current, svc.knownModels());
      cfg = svc.set(cfg, key, next);
    }
    const path = await svc.save(cfg);
    process.stdout.write(`${kleur.green("✓")} saved ${path}\n`);
  });

configGroup
  .command("search")
  .description("Interactive picker for search providers")
  .action(async () => {
    const svc = makeSettingsService();
    let cfg = await svc.load();
    const enabledD = svc.describe("search.enabled_providers");
    const enabled = await promptValue(
      enabledD,
      svc.get(cfg, "search.enabled_providers"),
      svc.knownModels(),
    );
    cfg = svc.set(cfg, "search.enabled_providers", enabled);
    const primaryD = svc.describe("search.provider");
    const primary = await promptValue(primaryD, svc.get(cfg, "search.provider"), svc.knownModels());
    cfg = svc.set(cfg, "search.provider", primary);
    const path = await svc.save(cfg);
    process.stdout.write(
      `${kleur.green("✓")} saved ${path}\n  primary: ${primary}\n  enabled: ${(enabled as string[]).join(", ")}\n`,
    );
  });

configGroup
  .command("reset")
  .description("Restore the on-disk config to built-in defaults")
  .action(async () => {
    if (!(await confirmReset())) {
      process.stdout.write(`${kleur.gray("cancelled")}\n`);
      return;
    }
    const svc = makeSettingsService();
    const path = await svc.save(svc.reset());
    process.stdout.write(`${kleur.green("✓")} reset; wrote ${path}\n`);
  });

// Reference unused imports defensively so they survive tree-shake in dev.
void [LLM_PROVIDERS, SEARCH_PROVIDERS];

program
  .command("bot")
  .description("Run the Architect Telegram bot")
  .option("--projects-root <path>", "Where projects live", resolve(process.cwd(), "projects"))
  .option(
    "--session-store <path>",
    "Telefocus session JSON dir",
    resolve(process.cwd(), ".sessions"),
  )
  .action(async (opts: { projectsRoot: string; sessionStore: string }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      process.stderr.write(`${kleur.red("✗")} TELEGRAM_BOT_TOKEN is not set\n`);
      process.exit(2);
    }
    const cfg = await loadConfig();
    const router = new LLMRouter(cfg);
    const { bus } = makeBus();
    const phases = buildDefaultRegistry();
    const runner = makeArchitectRunner({ router, bus, phases });
    const store = new FileSessionStore(opts.sessionStore);
    const bot = await startTelefocusBot({
      token,
      store,
      pages: architectPages,
      services: { architect: runner, projectsRoot: opts.projectsRoot },
      actions: (b, deps) => {
        const actionDeps = { ...deps, runner };
        registerArchitectActions(b, actionDeps);
        registerSparkPageActions(b, actionDeps);
        registerModePageActions(b, actionDeps);
        registerSettingsActions(b, actionDeps);
      },
    });
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const port = Number(process.env.BOT_PORT ?? 3000);
    const publicUrl = process.env.BOT_PUBLIC_URL;
    const secret = process.env.BOT_WEBHOOK_SECRET;
    const banner = [
      `${kleur.green("✓")} architect bot ${publicUrl ? `webhook=${publicUrl}` : "polling"} port=${port}`,
      `  projects-root: ${opts.projectsRoot}`,
      `  session-store: ${opts.sessionStore}`,
      ...(adminChatId ? [`  admin: ${adminChatId}`] : []),
    ].join("\n");
    process.stdout.write(`${banner}\n`);
    await serveBot({ bot, publicUrl, port, secret });
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, "architect: fatal");
  process.stderr.write(`${kleur.red("✗")} ${(err as Error).message}\n`);
  process.exit(1);
});

// Touched to ensure the unused import doesn't get tree-shaken in dev:
void [saveState, statePath, existsSync];
