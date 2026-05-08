import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { freshState } from "./state.ts";
import type { ArchitectState } from "./state.ts";
import { saveState, stateExists } from "./store.ts";

/**
 * Project bootstrap (P0). Creates the workspace skeleton, writes a fresh
 * state file, and returns the live state object positioned at P0.
 *
 * Refuses to overwrite an existing project. Resume that one with `loadState`.
 */

export class ProjectExistsError extends Error {
  constructor(projectRoot: string) {
    super(`Project already exists at ${projectRoot} — refuse to overwrite.`);
  }
}

export async function bootstrapProject(args: {
  projectName: string;
  projectsRoot: string;
}): Promise<ArchitectState> {
  const projectRoot = resolve(args.projectsRoot, args.projectName);
  if (await stateExists(projectRoot)) throw new ProjectExistsError(projectRoot);
  await mkdir(projectRoot, { recursive: true });
  for (const sub of [
    "docs",
    "docs/research",
    "docs/blueprint",
    "docs/qa",
    "docs/validation",
    "src",
  ]) {
    await mkdir(join(projectRoot, sub), { recursive: true });
  }
  const state = freshState({
    projectId: globalThis.crypto.randomUUID(),
    projectName: args.projectName,
    projectRoot,
    now: new Date().toISOString(),
  });
  await saveState(state);
  return state;
}
