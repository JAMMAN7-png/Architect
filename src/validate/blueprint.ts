import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Blueprint validation. Enforces the step format (§6 of the build plan) and
 * the reference rule: every step MUST cite at least one
 * `docs/research/*.md` or `docs/*.md` in its Inputs section.
 */

const STEP_HEADER = /^##\s+(BP-[A-Z][A-Z0-9]*-\d{3})\s+—\s+(.+)$/m;
const REQUIRED_SECTIONS = [
  "### Goal",
  "### Inputs",
  "### Files To Create",
  "### Implementation Steps",
  "### Acceptance Criteria",
];
const INPUT_REF = /docs\/(research|qa|validation|blueprint)?\/?[\w./-]+\.md/g;

export interface BlueprintStep {
  id: string;
  title: string;
  file: string;
  body: string;
}

export interface BlueprintValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  steps: BlueprintStep[];
}

export async function validateBlueprint(projectRoot: string): Promise<BlueprintValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dir = join(projectRoot, "docs", "blueprint");
  const files = await readMarkdown(dir, projectRoot);
  if (files.length === 0) errors.push("docs/blueprint/ has no markdown files");

  const steps: BlueprintStep[] = [];
  for (const f of files) {
    const text = await readFile(join(projectRoot, f), "utf8");
    const blocks = splitSteps(text);
    if (blocks.length === 0) {
      // It's allowed for a top-level overview/scope section to have no steps.
      // Only flag if the filename looks like a steps file.
      if (/12-implementation-roadmap/i.test(f)) {
        errors.push(`${f}: no step blocks (BP-MODULE-NNN headers) found`);
      }
      continue;
    }
    for (const block of blocks) {
      const headerMatch = STEP_HEADER.exec(block);
      if (!headerMatch) continue;
      const [, idCap, titleCap] = headerMatch;
      const id = idCap as string;
      const title = (titleCap as string).trim();
      const step: BlueprintStep = { id, title, file: f, body: block };
      steps.push(step);
      for (const sec of REQUIRED_SECTIONS) {
        if (!block.includes(sec)) {
          errors.push(`${f}: step ${id} missing section "${sec}"`);
        }
      }
      const inputs = extractSection(block, "### Inputs");
      const refs = inputs ? Array.from(inputs.matchAll(INPUT_REF)) : [];
      if (refs.length === 0) {
        errors.push(`${f}: step ${id} Inputs has no doc reference (docs/...)`);
      }
    }
  }

  // Step ID uniqueness.
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.id)) errors.push(`duplicate step id: ${s.id}`);
    seen.add(s.id);
  }

  return { ok: errors.length === 0, errors, warnings, steps };
}

async function readMarkdown(dir: string, root: string): Promise<string[]> {
  let entries: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    })) as unknown as typeof entries;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await readMarkdown(p, root)));
      continue;
    }
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
      out.push(relative(root, p).split(sep).join("/"));
    }
  }
  return out.sort();
}

function splitSteps(text: string): string[] {
  // A "step" begins at a `## BP-...` header and ends at the next `## ` or EOF.
  const result: string[] = [];
  const lines = text.split("\n");
  let buffer: string[] | null = null;
  for (const line of lines) {
    if (/^##\s+BP-/.test(line)) {
      if (buffer) result.push(buffer.join("\n"));
      buffer = [line];
    } else if (/^##\s/.test(line) && buffer) {
      result.push(buffer.join("\n"));
      buffer = null;
    } else if (buffer) {
      buffer.push(line);
    }
  }
  if (buffer) result.push(buffer.join("\n"));
  return result;
}

function extractSection(block: string, heading: string): string | null {
  const idx = block.indexOf(heading);
  if (idx < 0) return null;
  const after = block.slice(idx + heading.length);
  const next = after.search(/\n###\s+/);
  return next >= 0 ? after.slice(0, next) : after;
}
