import kleur from "kleur";
import prompts from "prompts";
import type { ArchitectConfig } from "../../config/schema.ts";
import type { SettingDescriptor, SettingsService } from "../../config/service.ts";

/** Cancel-on-Ctrl-C wrapper (mirrors src/interface/cli/prompts.ts). */
async function ask<T>(q: prompts.PromptObject): Promise<T> {
  const result = await prompts(q, { onCancel: () => process.exit(130) });
  return (result as Record<string, unknown>)[q.name as string] as T;
}

export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ") || kleur.gray("<empty>");
  if (value === "") return kleur.gray('""');
  if (value === null || value === undefined) return kleur.gray("<unset>");
  return String(value);
}

export async function promptValue(
  d: SettingDescriptor,
  current: unknown,
  knownModels: string[],
): Promise<unknown> {
  switch (d.type.kind) {
    case "string":
      return ask<string>({
        type: "text",
        name: "v",
        message: `${d.label} (${d.help})`,
        initial: current === undefined ? "" : String(current),
      });
    case "bool":
      return ask<boolean>({
        type: "toggle",
        name: "v",
        message: `${d.label} (${d.help})`,
        active: "true",
        inactive: "false",
        initial: current === true,
      });
    case "int": {
      const n = await ask<number>({
        type: "number",
        name: "v",
        message: `${d.label} (${d.help})`,
        initial: typeof current === "number" ? current : (d.defaultValue as number),
        min: d.type.min,
        max: d.type.max,
        float: false,
      });
      return n;
    }
    case "float": {
      const n = await ask<number>({
        type: "number",
        name: "v",
        message: `${d.label} (${d.help})`,
        initial: typeof current === "number" ? current : (d.defaultValue as number),
        min: d.type.min,
        max: d.type.max,
        float: true,
      });
      return n;
    }
    case "enum": {
      const choice = await ask<string>({
        type: "select",
        name: "v",
        message: `${d.label}`,
        choices: d.type.options.map((o) => ({ title: o, value: o })),
        initial: Math.max(0, d.type.options.indexOf(String(current))),
      });
      return choice;
    }
    case "model": {
      const choices = [
        ...knownModels.map((m) => ({ title: m, value: m })),
        { title: kleur.cyan("<custom slug>"), value: "__custom__" },
      ];
      const initialIdx = Math.max(0, knownModels.indexOf(String(current)));
      const pick = await ask<string>({
        type: "select",
        name: "v",
        message: `${d.label}`,
        choices,
        initial: initialIdx,
      });
      if (pick === "__custom__") {
        return ask<string>({
          type: "text",
          name: "v",
          message: "Custom model slug",
          initial: String(current ?? ""),
        });
      }
      return pick;
    }
    case "model-list":
    case "enum-list": {
      const options = d.type.kind === "model-list" ? knownModels : d.type.options;
      const arr = (current as string[] | undefined) ?? (d.defaultValue as string[]);
      const set = new Set(arr);
      const choices = options.map((o) => ({ title: o, value: o, selected: set.has(o) }));
      const picked = await ask<string[]>({
        type: "multiselect",
        name: "v",
        message: `${d.label}`,
        choices,
        min: d.type.min ?? 0,
        hint: "space to toggle, enter to confirm",
      });
      return picked;
    }
  }
}

export async function confirmReset(): Promise<boolean> {
  return ask<boolean>({
    type: "confirm",
    name: "v",
    message: "Overwrite the on-disk config with built-in defaults?",
    initial: false,
  });
}

export function printConfig(cfg: ArchitectConfig, svc: SettingsService): string {
  const lines: string[] = [];
  const grouped = new Map<string, SettingDescriptor[]>();
  for (const d of svc.catalog()) {
    const list = grouped.get(d.section) ?? [];
    list.push(d);
    grouped.set(d.section, list);
  }
  for (const [section, list] of grouped) {
    lines.push(kleur.bold(section));
    for (const d of list) {
      const v = svc.get(cfg, d.key);
      lines.push(`  ${kleur.cyan(d.key)} = ${formatValue(v)}`);
    }
  }
  return lines.join("\n");
}
