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
  // ARCHITECT_MODEL_ENSEMBLE: comma-separated list of model slugs for the ensemble tier.
  if (env.ARCHITECT_MODEL_ENSEMBLE) {
    next.models.ensemble = env.ARCHITECT_MODEL_ENSEMBLE.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (env.ARCHITECT_SEARCH_PROVIDER) {
    const v = env.ARCHITECT_SEARCH_PROVIDER;
    if (v === "firecrawl" || v === "parallel" || v === "exa") next.search.provider = v;
  }
  if (env.ARCHITECT_SEARCH_BASE_URL) next.search.base_url = env.ARCHITECT_SEARCH_BASE_URL;

  const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
  if (env.ARCHITECT_LOG_LEVEL) {
    const v = env.ARCHITECT_LOG_LEVEL;
    if ((LOG_LEVELS as readonly string[]).includes(v)) {
      next.runtime.log_level = v as (typeof LOG_LEVELS)[number];
    }
  }
  if (env.ARCHITECT_RETRY_ATTEMPTS) {
    const n = Number.parseInt(env.ARCHITECT_RETRY_ATTEMPTS, 10);
    if (Number.isInteger(n)) {
      next.runtime.retry_attempts = Math.max(0, Math.min(10, n));
    }
  }
  if (env.ARCHITECT_MAX_TOKENS_DEFAULT) {
    const n = Number.parseInt(env.ARCHITECT_MAX_TOKENS_DEFAULT, 10);
    if (Number.isInteger(n) && n > 0) {
      next.runtime.max_tokens_default = n;
    }
  }
  const SEARCH_PROVIDERS = ["firecrawl", "parallel", "exa"] as const;
  if (env.ARCHITECT_SEARCH_ENABLED) {
    const arr = env.ARCHITECT_SEARCH_ENABLED.split(",")
      .map((s) => s.trim())
      .filter((s): s is (typeof SEARCH_PROVIDERS)[number] =>
        (SEARCH_PROVIDERS as readonly string[]).includes(s),
      );
    if (arr.length > 0) next.search.enabled_providers = arr;
  }
  const LLM_PROVIDERS = [
    "anthropic",
    "openai",
    "xai",
    "deepseek",
    "openrouter",
    "vercel-gateway",
    "cerebras",
    "groq",
    "nvidia",
    "opencode-zen",
    "opencode-go",
  ] as const;
  if (env.ARCHITECT_LLM_ENABLED) {
    const arr = env.ARCHITECT_LLM_ENABLED.split(",")
      .map((s) => s.trim())
      .filter((s): s is (typeof LLM_PROVIDERS)[number] =>
        (LLM_PROVIDERS as readonly string[]).includes(s),
      );
    if (arr.length > 0) next.llm.enabled_providers = arr;
  }
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
