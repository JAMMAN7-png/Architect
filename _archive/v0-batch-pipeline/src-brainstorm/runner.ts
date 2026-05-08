import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "../config/paths.ts";
import type { ArchitectConfig } from "../config/schema.ts";

const SKILL_PATH_IN_REPO = "skills/brainstorming/SKILL.md";

/**
 * Fetch (or load from cache) the brainstorming SKILL.md from obra/superpowers.
 *
 * Cache: {cache_dir}/brainstorm/{owner}-{repo}-{ref}-SKILL.md
 * TTL:   {brainstorm.cache_ttl} (e.g. "24h", "7d", "30m")
 */
export async function fetchBrainstormSkill(cfg: ArchitectConfig): Promise<string> {
  const { owner, repo } = parseGitHubSource(cfg.brainstorm.source);
  const ref = cfg.brainstorm.ref;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${SKILL_PATH_IN_REPO}`;
  const ttlMs = parseDuration(cfg.brainstorm.cache_ttl);

  const cachePath = join(cacheDir(), "brainstorm", `${owner}-${repo}-${ref}-SKILL.md`);

  // Try cache
  try {
    const s = await stat(cachePath);
    const age = Date.now() - s.mtimeMs;
    if (age < ttlMs) {
      return await readFile(cachePath, "utf8");
    }
  } catch {
    // not cached
  }

  // Fetch and cache
  let body: string | null = null;
  try {
    const r = await fetch(url);
    if (r.ok) body = await r.text();
  } catch {
    body = null;
  }

  if (body) {
    await mkdir(cachePath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
    await writeFile(cachePath, body, "utf8");
    return body;
  }

  // Network failure: try stale cache as last resort.
  try {
    return await readFile(cachePath, "utf8");
  } catch {
    throw new Error(`brainstorm: failed to fetch ${url} and no cached copy at ${cachePath}`);
  }
}

function parseGitHubSource(source: string): { owner: string; repo: string } {
  const trimmed = source.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  const [owner, repo] = trimmed.split("/");
  if (!owner || !repo) {
    throw new Error(`brainstorm: invalid source '${source}', expected owner/repo`);
  }
  return { owner, repo };
}

function parseDuration(d: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(d.trim());
  if (!m) return 24 * 3600 * 1000;
  const n = Number.parseInt(m[1] as string, 10);
  switch ((m[2] ?? "h").toLowerCase()) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return n * 3_600_000;
  }
}
