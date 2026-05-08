import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "./fs.ts";

/**
 * Document I/O helpers that the orchestrator and agents share.
 *
 * `writeImmutableDoc` is used for write-once artifacts (the human spark, a
 * locked Blueprint file). On POSIX systems we drop write bits; the
 * orchestrator additionally refuses to re-write them in code.
 */

export async function writeDoc(
  absPath: string,
  content: string,
): Promise<{ path: string; sha256: string }> {
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf8");
  return { path: absPath, sha256: sha256(content) };
}

export async function writeImmutableDoc(
  absPath: string,
  content: string,
): Promise<{ path: string; sha256: string }> {
  const result = await writeDoc(absPath, content);
  try {
    await chmod(absPath, 0o444);
  } catch {
    // Windows / read-only FS — chmod is best-effort. The orchestrator-level
    // immutability check is what enforces correctness.
  }
  return result;
}

export async function readDoc(absPath: string): Promise<string> {
  return readFile(absPath, "utf8");
}

export async function docExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}

export function projectDoc(projectRoot: string, ...parts: string[]): string {
  return resolve(projectRoot, "docs", ...parts);
}
