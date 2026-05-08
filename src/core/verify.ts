import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { joinUnix, pathExists } from "../util/fs.ts";
import { ROOT_DOCS_WHITELIST, SERVICE_DOCS_WHITELIST } from "./registry.ts";

export interface Violation {
  path: string;
  reason: string;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  violations: Violation[];
}

/**
 * Verify the docs structure against the strict whitelist.
 * Rules:
 *   1. Every .md under {out}/docs/* must match the root whitelist.
 *   2. Every .md under <svc>/docs/* must match the service whitelist.
 *   3. No .md under <svc>/src/.
 *   4. doc-registry.md must exist and list every file we just walked
 *      (we accept the file's existence; a separate check could compare hashes).
 */
export async function verify(outDir: string): Promise<VerifyResult> {
  const violations: Violation[] = [];
  let checked = 0;

  // Walk root docs
  const rootDocs = join(outDir, "docs");
  if (await pathExists(rootDocs)) {
    for await (const file of walkMd(rootDocs)) {
      checked++;
      const rel = joinUnix(relative(rootDocs, file));
      if (!(ROOT_DOCS_WHITELIST as readonly string[]).includes(rel)) {
        violations.push({
          path: joinUnix(relative(outDir, file)),
          reason: "not in root docs whitelist",
        });
      }
    }
  }

  // Walk per-service docs
  const services = await listServiceDirs(outDir);
  for (const svc of services) {
    const docsDir = join(svc, "docs");
    for await (const file of walkMd(docsDir)) {
      checked++;
      const rel = joinUnix(relative(docsDir, file));
      if (!(SERVICE_DOCS_WHITELIST as readonly string[]).includes(rel)) {
        violations.push({
          path: joinUnix(relative(outDir, file)),
          reason: "not in service docs whitelist",
        });
      }
    }
    // Forbid .md anywhere in <svc>/src/
    const srcDir = join(svc, "src");
    if (await pathExists(srcDir)) {
      for await (const f of walkMd(srcDir)) {
        violations.push({
          path: joinUnix(relative(outDir, f)),
          reason: ".md inside <service>/src/ is forbidden",
        });
      }
    }
  }

  // Registry presence
  const regPath = join(outDir, "docs", "doc-registry.md");
  if (!(await pathExists(regPath))) {
    violations.push({
      path: joinUnix(relative(outDir, regPath)),
      reason: "doc-registry.md missing — run `architect generate` or `architect new`",
    });
  }
  // Registry hash check is intentionally deferred to a future phase.
  // buildRegistry produces deterministic hashes; verify only enforces presence today.

  return { ok: violations.length === 0, checked, violations };
}

async function* walkMd(dir: string): AsyncGenerator<string, void, void> {
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) break;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith(".md")) yield p;
    }
  }
}

async function listServiceDirs(outDir: string): Promise<string[]> {
  const found = new Set<string>();
  async function* walk(d: string, depth: number): AsyncGenerator<string, void, void> {
    if (depth > 3) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "docs" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const next = join(d, e.name);
      if (next === join(outDir, "docs")) continue;
      const docsDir = join(next, "docs");
      try {
        const ds = await readdir(docsDir);
        if (ds.length > 0) {
          found.add(next);
          continue;
        }
      } catch {
        // not a service; recurse
      }
      for await (const x of walk(next, depth + 1)) yield x;
    }
  }
  for await (const x of walk(outDir, 0)) found.add(x);
  return Array.from(found);
}
