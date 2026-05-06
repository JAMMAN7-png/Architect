import TOML from "@iarna/toml";
import { ensureDir, readFileMaybe, writeFileSafe } from "../util/fs.ts";
import { configFile } from "./paths.ts";
import { ArchitectConfig, DEFAULT_CONFIG } from "./schema.ts";

/**
 * Load config from disk, applying env overrides on top.
 * Missing config file → return defaults (with env overrides applied).
 * Invalid TOML or invalid shape → throw with a clear message.
 */
export async function loadConfig(): Promise<ArchitectConfig> {
  const path = configFile();
  const raw = await readFileMaybe(path);

  let parsed: unknown = {};
  if (raw !== null) {
    try {
      parsed = TOML.parse(raw);
    } catch (err) {
      throw new Error(`config: failed to parse ${path}: ${(err as Error).message}`);
    }
  }

  let cfg: ArchitectConfig;
  try {
    cfg = ArchitectConfig.parse(parsed);
  } catch (err) {
    throw new Error(`config: invalid shape in ${path}: ${(err as Error).message}`);
  }

  return applyEnvOverrides(cfg);
}

/** Apply env-var overrides to a parsed config. */
export function applyEnvOverrides(cfg: ArchitectConfig): ArchitectConfig {
  const next = structuredClone(cfg);
  const env = process.env;
  if (env.ARCHITECT_MODEL_STRATEGIC) next.models.strategic = env.ARCHITECT_MODEL_STRATEGIC;
  if (env.ARCHITECT_MODEL_EXECUTION) next.models.execution = env.ARCHITECT_MODEL_EXECUTION;
  if (env.ARCHITECT_MODEL_UI) next.models.ui = env.ARCHITECT_MODEL_UI;
  if (env.ARCHITECT_MODEL_FALLBACK) next.models.fallback = env.ARCHITECT_MODEL_FALLBACK;
  if (env.ARCHITECT_SEARCH_PROVIDER) {
    const v = env.ARCHITECT_SEARCH_PROVIDER;
    if (v === "firecrawl" || v === "parallel") next.search.provider = v;
  }
  if (env.ARCHITECT_SEARCH_BASE_URL) next.search.base_url = env.ARCHITECT_SEARCH_BASE_URL;
  return next;
}

/** Save config to disk. Creates the parent directory. */
export async function saveConfig(cfg: ArchitectConfig): Promise<string> {
  const path = configFile();
  await ensureDir(path.replace(/[\\/][^\\/]+$/, ""));
  // @iarna/toml expects JsonMap shape; ArchitectConfig maps cleanly.
  const body = TOML.stringify(cfg as unknown as TOML.JsonMap);
  await writeFileSafe(path, body);
  return path;
}

/** Get a dotted-key value from the config, e.g. "models.strategic". */
export function getKey(cfg: ArchitectConfig, dotted: string): unknown {
  const parts = dotted.split(".");
  // biome-ignore lint/suspicious/noExplicitAny: dynamic dotted path
  let cur: any = cfg;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Set a dotted-key value on a cloned config; returns the new config. Throws on invalid path. */
export function setKey(cfg: ArchitectConfig, dotted: string, value: unknown): ArchitectConfig {
  const next = structuredClone(cfg);
  const parts = dotted.split(".");
  // biome-ignore lint/suspicious/noExplicitAny: dynamic dotted path
  let cur: any = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i] as string;
    if (cur[p] == null || typeof cur[p] !== "object") {
      throw new Error(`config: unknown path '${dotted}' at segment '${p}'`);
    }
    cur = cur[p];
  }
  const last = parts[parts.length - 1] as string;
  if (!(last in cur)) {
    throw new Error(`config: unknown leaf '${last}' in path '${dotted}'`);
  }
  cur[last] = value;
  return ArchitectConfig.parse(next);
}

export { DEFAULT_CONFIG };
