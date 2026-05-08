import { makeSettingsService } from "../../../../../config/service.ts";
import { listKnownModels } from "../../../../../llm/models.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";

/**
 * `/settings/models/<tier>` — pick the model used for a single tier or
 * toggle ensemble membership. Single-value tiers render one row per
 * known slug as `action:settings:set:models.<tier>:<slug>`. The
 * ensemble tier renders one toggle row per slug
 * (`action:settings:toggle:models.ensemble:<slug>`).
 */

export type ModelTier = "strategic" | "execution" | "ui" | "fallback" | "ensemble";

const TIER_LABELS: Record<ModelTier, string> = {
  strategic: "Strategic",
  execution: "Execution",
  ui: "UI",
  fallback: "Fallback",
  ensemble: "Ensemble",
};

const TIER_ORDER: readonly ModelTier[] = ["strategic", "execution", "ui", "fallback", "ensemble"];

/**
 * Build the page definition for a single tier. Used five times to
 * register one page per tier.
 */
export function makeModelTierPage(tier: ModelTier): PageDefinition {
  const path = `/settings/models/${tier}`;
  const def: PageDefinition = {
    path,
    parent: "/settings/models",
    async render(_ctx: Ctx): Promise<MenuBody> {
      const svc = makeSettingsService();
      const cfg = await svc.load();
      const lines = [`<b>🧠 ${escapeHtml(TIER_LABELS[tier])} model</b>`, ""];
      if (tier === "ensemble") {
        if (cfg.models.ensemble.length === 0) {
          lines.push("Currently selected: <i>(none)</i>");
        } else {
          lines.push("Currently selected:");
          for (const slug of cfg.models.ensemble) {
            lines.push(`• <code>${escapeHtml(slug)}</code>`);
          }
        }
      } else {
        lines.push(`Currently selected: <code>${escapeHtml(cfg.models[tier])}</code>`);
      }
      lines.push("", "Tap a row to change.");
      return { text: lines.join("\n"), parseMode: "HTML" };
    },
    async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
      const svc = makeSettingsService();
      const cfg = await svc.load();
      const slugs = listKnownModels();
      const rows: InlineKeyboardButton[][] = [];
      if (tier === "ensemble") {
        const enabled = new Set(cfg.models.ensemble);
        for (const slug of slugs) {
          const icon = enabled.has(slug) ? "🔴" : "⚪";
          rows.push([
            {
              text: `${icon} ${slug}`,
              callback_data: `action:settings:toggle:models.ensemble:${slug}`,
            },
          ]);
        }
      } else {
        const current = cfg.models[tier];
        for (const slug of slugs) {
          const icon = slug === current ? "⭐" : "·";
          rows.push([
            {
              text: `${icon} ${slug}`,
              callback_data: `action:settings:set:models.${tier}:${slug}`,
            },
          ]);
        }
      }
      rows.push([{ text: "⬅ Back", callback_data: "nav:/settings/models" }]);
      return rows;
    },
  };
  return def;
}

export const modelTierPages: PageDefinition[] = TIER_ORDER.map(makeModelTierPage);
