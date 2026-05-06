import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** Resolve an absolute path. */
export function abs(p: string): string {
  return resolve(p);
}

/** Ensure a directory exists. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Write a file, creating parent directories. */
export async function writeFileSafe(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

/** Read a file as utf8, returning null if it does not exist. */
export async function readFileMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Whether a path exists. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** SHA-256 hex digest of a string. */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Path relative to a root (forward-slashes). */
export function relPath(from: string, to: string): string {
  return relative(from, to).split("\\").join("/");
}

/** Join with forward slashes. */
export function joinUnix(...parts: string[]): string {
  return join(...parts)
    .split("\\")
    .join("/");
}
