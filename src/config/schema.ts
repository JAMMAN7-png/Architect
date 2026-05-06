import { z } from "zod";

/**
 * Architect config schema. Resolution precedence:
 *   CLI flag  >  env var  >  TOML file  >  built-in default
 *
 * Secrets (API keys) are read from env ONLY — never from the TOML file.
 */

export const ModelsConfig = z
  .object({
    strategic: z.string().default("anthropic/claude-opus-4-5"),
    ensemble: z.array(z.string()).default(["xai/grok-4", "deepseek/deepseek-r1"]),
    execution: z.string().default("deepseek/deepseek-chat"),
    ui: z.string().default("anthropic/claude-opus-4-5"),
    fallback: z.string().default("openrouter/auto"),
  })
  .strict();
export type ModelsConfig = z.infer<typeof ModelsConfig>;

export const SearchConfig = z
  .object({
    provider: z.enum(["firecrawl", "parallel"]).default("firecrawl"),
    base_url: z.string().default(""),
    noise_filter: z.number().min(0).max(1).default(0.85),
    per_query_cap: z.number().int().positive().default(500),
  })
  .strict();
export type SearchConfig = z.infer<typeof SearchConfig>;

export const BrainstormConfig = z
  .object({
    source: z.string().default("github.com/obra/superpowers"),
    ref: z.string().default("main"),
    cache_ttl: z.string().default("24h"),
  })
  .strict();
export type BrainstormConfig = z.infer<typeof BrainstormConfig>;

export const OutputConfig = z
  .object({
    per_service_root: z.string().default(""),
    ui_enabled: z.boolean().default(false),
    git_init: z.boolean().default(true),
  })
  .strict();
export type OutputConfig = z.infer<typeof OutputConfig>;

export const ArchitectConfig = z
  .object({
    models: ModelsConfig.default({}),
    search: SearchConfig.default({}),
    brainstorm: BrainstormConfig.default({}),
    output: OutputConfig.default({}),
  })
  .strict();
export type ArchitectConfig = z.infer<typeof ArchitectConfig>;

/** Default config — the source of truth for all defaults. */
export const DEFAULT_CONFIG: ArchitectConfig = ArchitectConfig.parse({});
