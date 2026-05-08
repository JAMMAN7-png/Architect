import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ArchitectState } from "./state.ts";

/**
 * Atomic state I/O. State writes go to `<root>/architect.state.json` via
 * write-temp-rename. Any read validates with Zod; corruption surfaces as
 * a thrown error instead of a silently broken state object.
 */

export const STATE_FILENAME = "architect.state.json";

export function statePath(projectRoot: string): string {
  return join(projectRoot, STATE_FILENAME);
}

export async function loadState(projectRoot: string): Promise<ArchitectState> {
  const p = statePath(projectRoot);
  const raw = await readFile(p, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return ArchitectState.parse(parsed);
}

export async function saveState(state: ArchitectState): Promise<void> {
  const next: ArchitectState = { ...state, updatedAt: new Date().toISOString() };
  ArchitectState.parse(next); // validate on every write
  const target = statePath(state.projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

export async function stateExists(projectRoot: string): Promise<boolean> {
  try {
    await readFile(statePath(projectRoot), "utf8");
    return true;
  } catch {
    return false;
  }
}
