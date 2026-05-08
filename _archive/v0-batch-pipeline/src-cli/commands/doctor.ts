import kleur from "kleur";
import { loadConfig } from "../../config/loader.ts";
import { configFile } from "../../config/paths.ts";
import { LLMRouter } from "../../llm/router.ts";
import { resolveSearchProvider } from "../../search/index.ts";
import type { CommandCtx } from "../index.ts";

export async function run(_ctx: CommandCtx): Promise<void> {
  const cfg = await loadConfig();
  console.log(kleur.bold("architect doctor"));
  console.log(`config file: ${kleur.dim(configFile())}`);

  // Provider availability
  const router = new LLMRouter(cfg);
  const avail = router.availability();
  console.log("");
  console.log(kleur.bold("LLM providers:"));
  for (const [name, ok] of Object.entries(avail)) {
    console.log(
      `  ${ok ? kleur.green("✓") : kleur.dim("·")} ${name.padEnd(12)} ${ok ? "" : kleur.dim(envHint(name))}`,
    );
  }

  // Tier resolution
  console.log("");
  console.log(kleur.bold("Tier resolution:"));
  for (const tier of ["strategic", "execution", "ui"] as const) {
    const id = router.modelFor(tier);
    console.log(`  ${tier.padEnd(10)} → ${kleur.cyan(id)}`);
  }
  console.log(`  ensemble   → ${cfg.models.ensemble.map((s) => kleur.cyan(s)).join(", ")}`);

  // Search provider
  console.log("");
  console.log(kleur.bold("Search provider:"));
  try {
    const sp = resolveSearchProvider(cfg);
    console.log(
      `  ${kleur.green("✓")} ${sp.id}${sp.id === cfg.search.provider ? "" : kleur.dim(` (fell back from ${cfg.search.provider})`)}`,
    );
  } catch (err) {
    console.log(`  ${kleur.red("✗")} ${(err as Error).message}`);
  }

  // Brainstorm reachability
  console.log("");
  console.log(kleur.bold("Brainstorm source:"));
  const url = `https://raw.githubusercontent.com/${cfg.brainstorm.source.replace(
    /^github\.com\//,
    "",
  )}/${cfg.brainstorm.ref}/skills/brainstorming/SKILL.md`;
  try {
    const r = await fetch(url, { method: "HEAD" });
    if (r.ok) {
      console.log(`  ${kleur.green("✓")} ${url}`);
    } else {
      console.log(`  ${kleur.yellow("!")} ${url} → HTTP ${r.status}`);
    }
  } catch (err) {
    console.log(`  ${kleur.red("✗")} ${url} → ${(err as Error).message}`);
  }

  // Summary
  console.log("");
  const anyLlm = Object.values(avail).some(Boolean);
  if (!anyLlm) {
    console.log(kleur.red("No LLM provider available."));
    console.log(
      kleur.dim(
        "Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY",
      ),
    );
    process.exit(1);
  }
  console.log(kleur.green("doctor: ready"));
}

function envHint(name: string): string {
  switch (name) {
    case "anthropic":
      return "(set ANTHROPIC_API_KEY)";
    case "openai":
      return "(set OPENAI_API_KEY)";
    case "xai":
      return "(set XAI_API_KEY)";
    case "deepseek":
      return "(set DEEPSEEK_API_KEY)";
    case "openrouter":
      return "(set OPENROUTER_API_KEY for fallback routing)";
    default:
      return "";
  }
}
