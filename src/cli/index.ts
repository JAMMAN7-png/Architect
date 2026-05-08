#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import kleur from "kleur";
import { loadConfig } from "../config/loader.ts";
import { makeCliPrompts } from "../interface/cli/prompts.ts";
import { CliRenderer } from "../interface/cli/renderer.ts";
import { Liaison } from "../interface/liaison.ts";
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
    const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
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

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, "architect: fatal");
  process.stderr.write(`${kleur.red("✗")} ${(err as Error).message}\n`);
  process.exit(1);
});

// Touched to ensure the unused import doesn't get tree-shaken in dev:
void [saveState, statePath, existsSync];
