import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  btn,
  escapeHtml,
} from "../../../engine/index.ts";
import { indexedSettingsCallback } from "../../../engine/router/callback.ts";
import { makeScalarEditorFlow, settingsCandidates } from "../../settings-actions.ts";

const PAGE_PATH = "/settings/search";
const FLOW_ID = "settings_search_edit";

/**
 * `/settings/search` — toggle enabled providers, pick the primary, and
 * edit scalar values (noise filter, per-query cap, base URL) through the
 * page's input flow.
 *
 * Toggle and primary rows emit indexed callbacks (`…:idx:<n>`) so
 * `callback_data` stays under Telegram's 64-byte cap; the action handler
 * resolves the index back via {@link settingsCandidates}. The scalar
 * editors stay on the literal `action:settings:edit:<key>` form
 * (already <64 bytes).
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
    const enabled = new Set<string>(cfg.search.enabled_providers);
    const toggleProviders = settingsCandidates("search.enabled_providers");
    const primaryProviders = settingsCandidates("search.provider");
    const rows: InlineKeyboardButton[][] = [];
    for (let i = 0; i < toggleProviders.length; i++) {
      const id = toggleProviders[i] ?? "";
      const on = enabled.has(id);
      rows.push([
        btn(`${on ? "🟢" : "⚪"} ${id}`, {
          intent: on ? "toggle-on" : "toggle-off",
          callback_data: indexedSettingsCallback("toggle", "search.enabled_providers", i),
        }),
      ]);
    }
    const primaryRow: InlineKeyboardButton[] = [];
    for (let i = 0; i < primaryProviders.length; i++) {
      const id = primaryProviders[i] ?? "";
      const isPrimary = id === cfg.search.provider;
      primaryRow.push(
        btn(`${isPrimary ? "⭐" : "▫"} ${id}`, {
          intent: isPrimary ? "selected" : "unselected",
          callback_data: indexedSettingsCallback("set", "search.provider", i),
        }),
      );
    }
    rows.push(primaryRow);
    rows.push([
      btn(`✏ Noise filter (${cfg.search.noise_filter})`, {
        intent: "edit",
        callback_data: "action:settings:edit:search.noise_filter",
      }),
    ]);
    rows.push([
      btn(`✏ Per-query cap (${cfg.search.per_query_cap})`, {
        intent: "edit",
        callback_data: "action:settings:edit:search.per_query_cap",
      }),
    ]);
    rows.push([
      btn(`✏ Base URL (${cfg.search.base_url || "default"})`, {
        intent: "edit",
        callback_data: "action:settings:edit:search.base_url",
      }),
    ]);
    rows.push([btn("⬅ Back", { intent: "back", callback_data: "nav:/settings" })]);
    return rows;
  },
  inputFlow: makeScalarEditorFlow(PAGE_PATH, FLOW_ID),
};
