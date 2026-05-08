import { SEARCH_PROVIDERS, makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";
import { makeScalarEditorFlow } from "../../settings-actions.ts";

const PAGE_PATH = "/settings/search";
const FLOW_ID = "settings_search_edit";

/**
 * `/settings/search` — toggle enabled providers, pick the primary, and
 * edit scalar values (noise filter, per-query cap, base URL) through the
 * page's input flow.
 */
export const settingsSearchPage: PageDefinition = {
  path: PAGE_PATH,
  parent: "/settings",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>🔍 Search</b>",
      "",
      `Primary: <code>${escapeHtml(cfg.search.provider)}</code>`,
      `Enabled: <code>${escapeHtml(cfg.search.enabled_providers.join(", ") || "(none)")}</code>`,
      `Noise filter: <code>${escapeHtml(String(cfg.search.noise_filter))}</code>`,
      `Per-query cap: <code>${escapeHtml(String(cfg.search.per_query_cap))}</code>`,
      `Base URL: <code>${escapeHtml(cfg.search.base_url || "(default)")}</code>`,
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const enabled = new Set(cfg.search.enabled_providers);
    const rows: InlineKeyboardButton[][] = [];
    for (const id of SEARCH_PROVIDERS) {
      const icon = enabled.has(id) ? "🔴" : "⚪";
      rows.push([
        {
          text: `${icon} ${id}`,
          callback_data: `action:settings:toggle:search.enabled_providers:${id}`,
        },
      ]);
    }
    const primaryRow: InlineKeyboardButton[] = SEARCH_PROVIDERS.map((id) => ({
      text: `${id === cfg.search.provider ? "⭐" : "·"} ${id}`,
      callback_data: `action:settings:set:search.provider:${id}`,
    }));
    rows.push(primaryRow);
    rows.push([
      {
        text: `✏ Noise filter (${cfg.search.noise_filter})`,
        callback_data: "action:settings:edit:search.noise_filter",
      },
    ]);
    rows.push([
      {
        text: `✏ Per-query cap (${cfg.search.per_query_cap})`,
        callback_data: "action:settings:edit:search.per_query_cap",
      },
    ]);
    rows.push([
      {
        text: `✏ Base URL (${cfg.search.base_url || "default"})`,
        callback_data: "action:settings:edit:search.base_url",
      },
    ]);
    rows.push([{ text: "⬅ Back", callback_data: "nav:/settings" }]);
    return rows;
  },
  inputFlow: makeScalarEditorFlow(PAGE_PATH, FLOW_ID),
};
