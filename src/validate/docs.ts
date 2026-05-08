import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Docs validation. Runs against a project root and reports violations of
 * the manifest contract:
 *   - no `.md` outside `docs/`
 *   - no `.md` inside `src/`
 *   - every `.md` in `docs/` is listed in the manifest
 *   - no forbidden filenames (notes.md, misc.md, thoughts.md, …)
 *   - every research doc has Decision Summary + Approved Choice + Blueprint References sections
 */

export const FORBIDDEN_DOC_NAMES = new Set([
  "notes.md",
  "misc.md",
  "thoughts.md",
  "todo.md",
  "todos.md",
  "scratch.md",
]);

export interface ManifestEntry {
  path: string;
  purpose: string;
  /** Glob pattern (e.g. `docs/research/*.md`); when set, `path` is the pattern. */
  pattern?: string;
}

export interface DocsValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateDocs(
  projectRoot: string,
  manifest: ManifestEntry[],
): Promise<DocsValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Walk the entire project for stray .md files.
  const allMd = await collectMarkdown(projectRoot);
  for (const md of allMd) {
    const rel = relative(projectRoot, md).split(sep).join("/");
    if (rel.startsWith("src/") || rel === "src") {
      errors.push(`forbidden markdown inside src/: ${rel}`);
      continue;
    }
    if (!rel.startsWith("docs/")) {
      // Only `docs/` is allowed below the project root; everything else is a
      // stray .md (excluding tooling files like the manifest itself).
      errors.push(`markdown outside docs/: ${rel}`);
      continue;
    }
    const filename = rel.split("/").pop() ?? "";
    if (FORBIDDEN_DOC_NAMES.has(filename)) errors.push(`forbidden filename: ${rel}`);
  }

  // 2. Every `.md` under `docs/` must be on the manifest (literal or pattern).
  const docsMd = allMd
    .map((p) => relative(projectRoot, p).split(sep).join("/"))
    .filter((p) => p.startsWith("docs/"));
  const literal = new Set(manifest.filter((m) => !m.pattern).map((m) => m.path));
  const patterns = manifest.filter((m) => m.pattern).map((m) => m.pattern as string);
  for (const p of docsMd) {
    if (literal.has(p)) continue;
    if (patterns.some((pat) => matchesGlob(p, pat))) continue;
    errors.push(`docs entry not on manifest: ${p}`);
  }

  // 3. Research docs MUST have the required sections.
  for (const p of docsMd) {
    if (!p.startsWith("docs/research/")) continue;
    if (!p.endsWith(".md")) continue;
    if (p.endsWith("/00-research-subjects.md")) continue;
    if (p.endsWith("/01-user-preferences.md")) continue;
    if (p.endsWith("/02-approach-decisions.md")) continue;
    const abs = join(projectRoot, p);
    const text = await readFile(abs, "utf8");
    for (const heading of [
      "## Decision Summary",
      "## Approved Choice",
      "## Blueprint References",
    ]) {
      if (!text.includes(heading)) {
        errors.push(`research doc missing required section "${heading}": ${p}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function collectMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, root, out);
  return out;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    })) as unknown as typeof entries;
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip vendored and runtime-managed dirs.
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "_archive") continue;
      await walk(root, p, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (p.toLowerCase().endsWith(".md")) {
      try {
        const s = await stat(p);
        if (s.isFile()) out.push(p);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Tiny glob matcher.
 *   `**` matches any chars (including `/`).
 *   `*` matches any chars except `/`.
 *   `slash-star-star-slash` (`/` + double-star + `/`) matches zero or more
 *   intermediate directories.
 */
export function matchesGlob(path: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^$|()\[\]{}\\]/g, (m) => `\\${m}`);
  const body = escaped
    .replace(/\/\*\*\//g, "(?:/|/.+/)")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${body}$`).test(path);
}
