import { makeSettingsService } from "../../../../../config/service.ts";
import { listAllDynamicModels } from "../../../../../llm/dynamic-models.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  btn,
  escapeHtml,
} from "../../../engine/index.ts";
import { indexedSettingsCallback } from "../../../engine/router/callback.ts";

/**
 * `/settings/models/<tier>` — pick the model used for a single tier or
 * toggle ensemble membership. The list is pulled live from each
 * provider via {@link listAllDynamicModels} (5-minute cache), grouped
 * by provider with section header rows, and paginated at
 * {@link PAGE_SIZE} models per page. Each model row carries a Set/
 * Toggle button alongside a `🩺` health-check button that fires
 * `action:settings:ping:models.<tier>:idx:<n>`.
 *
 * Indexed callbacks resolve through the same dynamic snapshot the
 * keyboard renders so `idx` round-trips even when the cache rolls
 * over between renders.
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
const PAGE_SIZE = 8;

function pageOf(ctx: Ctx, pagePath: string): number {
  const bucket = ctx.session.pageData[pagePath];
  const raw = bucket?.page;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Build the page definition for a single tier. Used five times to
 * register one page per tier.
 */
export function makeModelTierPage(tier: ModelTier): PageDefinition {
  const path = `/settings/models/${tier}`;
  const pageCallback = (n: number): string => `action:settings:page:models.${tier}:${n}`;
  const pingCallback = (idx: number): string => `action:settings:ping:models.${tier}:idx:${idx}`;

  return {
    path,
    parent: "/settings/models",
    async render(ctx: Ctx): Promise<MenuBody> {
      const svc = makeSettingsService();
      const cfg = await svc.load();
      const all = await listAllDynamicModels();
      const page = pageOf(ctx, path);
      const total = all.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
      lines.push("");
      if (total === 0) {
        lines.push(
          "<i>No models reachable yet — set provider API keys to populate the live list.</i>",
        );
      } else {
        const shown = Math.min(PAGE_SIZE, Math.max(0, total - page * PAGE_SIZE));
        lines.push(`Showing ${shown} of ${total} (page ${page + 1}/${totalPages}).`);
      }
      return { text: lines.join("\n"), parseMode: "HTML" };
    },
    async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
      const svc = makeSettingsService();
      const cfg = await svc.load();
      const all = await listAllDynamicModels();
      const page = pageOf(ctx, path);
      const start = page * PAGE_SIZE;
      const slice = all.slice(start, start + PAGE_SIZE);
      const rows: InlineKeyboardButton[][] = [];

      let lastProvider: string | null = null;
      for (let i = 0; i < slice.length; i++) {
        const m = slice[i];
        if (m === undefined) continue;
        const idx = start + i;
        if (m.provider !== lastProvider) {
          rows.push([btn(`— ${m.provider} —`, { callback_data: `noop:provider:${m.provider}` })]);
          lastProvider = m.provider;
        }
        const isSelected =
          tier === "ensemble" ? cfg.models.ensemble.includes(m.slug) : cfg.models[tier] === m.slug;
        const verb = tier === "ensemble" ? "toggle" : "set";
        const intent =
          tier === "ensemble"
            ? isSelected
              ? "toggle-on"
              : "toggle-off"
            : isSelected
              ? "selected"
              : "unselected";
        const icon = tier === "ensemble" ? (isSelected ? "🟢" : "⚪") : isSelected ? "⭐" : "▫";
        rows.push([
          btn(`${icon} ${m.apiId}`, {
            intent,
            callback_data: indexedSettingsCallback(verb, `models.${tier}`, idx),
          }),
          btn("🩺", { intent: "ping", callback_data: pingCallback(idx) }),
        ]);
      }

      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      const pageRow: InlineKeyboardButton[] = [];
      if (page > 0) {
        pageRow.push(btn("◀", { intent: "page-prev", callback_data: pageCallback(page - 1) }));
      }
      pageRow.push(btn(`${page + 1}/${totalPages}`, { callback_data: "noop:page-indicator" }));
      if (page < totalPages - 1) {
        pageRow.push(btn("▶", { intent: "page-next", callback_data: pageCallback(page + 1) }));
      }
      rows.push(pageRow);

      rows.push([btn("⬅ Back", { intent: "back", callback_data: "nav:/settings/models" })]);
      return rows;
    },
  };
}

export const modelTierPages: PageDefinition[] = TIER_ORDER.map(makeModelTierPage);
