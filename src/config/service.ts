import { listKnownModels } from "../llm/models.ts";
import { getKey, loadConfig, saveConfig, setKey } from "./loader.ts";
import type { ArchitectConfig } from "./schema.ts";
import { ArchitectConfig as ArchitectConfigSchema } from "./schema.ts";

export type SettingType =
  | { kind: "string" }
  | { kind: "int"; min?: number; max?: number }
  | { kind: "float"; min?: number; max?: number }
  | { kind: "bool" }
  | { kind: "enum"; options: readonly string[] }
  | { kind: "model" }
  | { kind: "model-list"; min?: number }
  | { kind: "enum-list"; options: readonly string[]; min?: number };

export interface SettingDescriptor {
  /** Dotted path, e.g. "models.strategic". */
  key: string;
  /** Section name for grouping (e.g. "models", "search"). */
  section: string;
  /** Short label for UI. */
  label: string;
  /** One-sentence help text. */
  help: string;
  type: SettingType;
  /** Default value (matches schema default). */
  defaultValue: unknown;
}

export const SEARCH_PROVIDERS = ["firecrawl", "parallel", "exa"] as const;
export const LLM_PROVIDERS = [
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
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export function settingsCatalog(): SettingDescriptor[] {
  return [
    {
      key: "models.strategic",
      section: "models",
      label: "Strategic model",
      help: "Used for high-level architecture decisions.",
      type: { kind: "model" },
      defaultValue: "anthropic/claude-opus-4-5",
    },
    {
      key: "models.execution",
      section: "models",
      label: "Execution model",
      help: "Used for transcribing approved plans into artifacts.",
      type: { kind: "model" },
      defaultValue: "deepseek/deepseek-chat",
    },
    {
      key: "models.ui",
      section: "models",
      label: "UI model",
      help: "Used for the UX layer.",
      type: { kind: "model" },
      defaultValue: "anthropic/claude-opus-4-5",
    },
    {
      key: "models.fallback",
      section: "models",
      label: "Fallback model",
      help: "Used when the resolved provider has no key.",
      type: { kind: "model" },
      defaultValue: "openrouter/auto",
    },
    {
      key: "models.ensemble",
      section: "models",
      label: "Ensemble models",
      help: "Adversarial reviewers ran in parallel.",
      type: { kind: "model-list", min: 1 },
      defaultValue: ["xai/grok-4", "deepseek/deepseek-r1"],
    },
    {
      key: "search.provider",
      section: "search",
      label: "Primary search provider",
      help: "Provider tried first.",
      type: { kind: "enum", options: SEARCH_PROVIDERS },
      defaultValue: "firecrawl",
    },
    {
      key: "search.enabled_providers",
      section: "search",
      label: "Enabled search providers",
      help: "Toggle which adapters the resolver may use.",
      type: { kind: "enum-list", options: SEARCH_PROVIDERS, min: 1 },
      defaultValue: ["firecrawl"],
    },
    {
      key: "search.base_url",
      section: "search",
      label: "Search base URL override",
      help: "Optional override; empty = vendor default.",
      type: { kind: "string" },
      defaultValue: "",
    },
    {
      key: "search.noise_filter",
      section: "search",
      label: "Noise filter (0..1)",
      help: "Higher = stricter relevance threshold.",
      type: { kind: "float", min: 0, max: 1 },
      defaultValue: 0.85,
    },
    {
      key: "search.per_query_cap",
      section: "search",
      label: "Per-query cap",
      help: "Hard upper bound on results per query.",
      type: { kind: "int", min: 1 },
      defaultValue: 500,
    },
    {
      key: "llm.enabled_providers",
      section: "llm",
      label: "Enabled LLM providers",
      help: "Restrict which provider classes the router constructs.",
      type: { kind: "enum-list", options: LLM_PROVIDERS, min: 1 },
      defaultValue: [...LLM_PROVIDERS],
    },
    {
      key: "runtime.log_level",
      section: "runtime",
      label: "Log level",
      help: "pino logger verbosity.",
      type: { kind: "enum", options: LOG_LEVELS },
      defaultValue: "info",
    },
    {
      key: "runtime.retry_attempts",
      section: "runtime",
      label: "Retry attempts",
      help: "Per LLM call.",
      type: { kind: "int", min: 0, max: 10 },
      defaultValue: 4,
    },
    {
      key: "runtime.max_tokens_default",
      section: "runtime",
      label: "Default max tokens",
      help: "Fallback when a tier has no explicit cap.",
      type: { kind: "int", min: 1 },
      defaultValue: 4000,
    },
    {
      key: "brainstorm.source",
      section: "brainstorm",
      label: "Brainstorm source",
      help: "Skill repo URL or local path.",
      type: { kind: "string" },
      defaultValue: "github.com/obra/superpowers",
    },
    {
      key: "brainstorm.ref",
      section: "brainstorm",
      label: "Brainstorm ref",
      help: "Branch / tag / commit.",
      type: { kind: "string" },
      defaultValue: "main",
    },
    {
      key: "brainstorm.cache_ttl",
      section: "brainstorm",
      label: "Brainstorm cache TTL",
      help: "e.g. 24h.",
      type: { kind: "string" },
      defaultValue: "24h",
    },
    {
      key: "output.ui_enabled",
      section: "output",
      label: "UI enabled",
      help: "Render UI affordances inside generated docs.",
      type: { kind: "bool" },
      defaultValue: false,
    },
    {
      key: "output.git_init",
      section: "output",
      label: "Git init",
      help: "Initialize a git repo on project bootstrap.",
      type: { kind: "bool" },
      defaultValue: true,
    },
  ];
}

export interface SettingsService {
  load(): Promise<ArchitectConfig>;
  save(cfg: ArchitectConfig): Promise<string>;
  catalog(): SettingDescriptor[];
  describe(key: string): SettingDescriptor;
  get(cfg: ArchitectConfig, key: string): unknown;
  set(cfg: ArchitectConfig, key: string, raw: unknown): ArchitectConfig;
  toggle(cfg: ArchitectConfig, key: string, member: string): ArchitectConfig;
  reset(): ArchitectConfig;
  knownModels(): string[];
}

export function makeSettingsService(): SettingsService {
  const cat = settingsCatalog();
  const map = new Map(cat.map((d) => [d.key, d]));
  return {
    load: () => loadConfig(),
    save: (cfg) => saveConfig(cfg),
    catalog: () => cat.slice(),
    describe(key) {
      const d = map.get(key);
      if (!d) throw new Error(`settings: unknown key '${key}'`);
      return d;
    },
    get: (cfg, key) => getKey(cfg, key),
    set(cfg, key, raw) {
      const d = this.describe(key);
      const coerced = coerce(d.type, raw);
      return setKey(cfg, key, coerced);
    },
    toggle(cfg, key, member) {
      const d = this.describe(key);
      if (d.type.kind !== "enum-list" && d.type.kind !== "model-list") {
        throw new Error(`settings: '${key}' is not a list`);
      }
      const current = (getKey(cfg, key) as string[]) ?? [];
      const next = current.includes(member)
        ? current.filter((x) => x !== member)
        : [...current, member];
      if ("min" in d.type && d.type.min !== undefined && next.length < d.type.min) {
        throw new Error(`settings: '${key}' must contain at least ${d.type.min} entries`);
      }
      if (d.type.kind === "enum-list") {
        for (const v of next) {
          if (!d.type.options.includes(v)) {
            throw new Error(`settings: '${key}' rejects unknown member '${v}'`);
          }
        }
      }
      return setKey(cfg, key, next);
    },
    reset: () => ArchitectConfigSchema.parse({}),
    knownModels: () => listKnownModels(),
  };
}

function coerce(type: SettingType, raw: unknown): unknown {
  switch (type.kind) {
    case "string":
      return String(raw);
    case "bool":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "1" || raw === "on") return true;
      if (raw === "false" || raw === "0" || raw === "off") return false;
      throw new Error(`settings: cannot coerce '${String(raw)}' to bool`);
    case "int": {
      const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
      if (!Number.isInteger(n)) throw new Error(`settings: '${String(raw)}' is not an integer`);
      if (type.min !== undefined && n < type.min)
        throw new Error(`settings: must be >= ${type.min}`);
      if (type.max !== undefined && n > type.max)
        throw new Error(`settings: must be <= ${type.max}`);
      return n;
    }
    case "float": {
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
      if (Number.isNaN(n)) throw new Error(`settings: '${String(raw)}' is not a number`);
      if (type.min !== undefined && n < type.min)
        throw new Error(`settings: must be >= ${type.min}`);
      if (type.max !== undefined && n > type.max)
        throw new Error(`settings: must be <= ${type.max}`);
      return n;
    }
    case "enum": {
      const s = String(raw);
      if (!type.options.includes(s))
        throw new Error(`settings: '${s}' not in [${type.options.join(", ")}]`);
      return s;
    }
    case "model":
      return String(raw);
    case "model-list":
    case "enum-list": {
      const arr = Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      if (type.kind === "enum-list") {
        for (const v of arr) {
          if (!type.options.includes(v))
            throw new Error(`settings: '${v}' not in [${type.options.join(", ")}]`);
        }
      }
      if (type.min !== undefined && arr.length < type.min) {
        throw new Error(`settings: must contain at least ${type.min} entries`);
      }
      return arr;
    }
  }
}
