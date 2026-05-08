import { LLM_PROVIDERS, makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";

/**
 * `/settings/llm` — toggle which LLM provider classes the router may
 * construct. The service enforces `min: 1`; attempts to disable the
 * last enabled provider surface a danger toast from the action handler.
 */
export const settingsLlmPage: PageDefinition = {
  path: "/settings/llm",
  parent: "/settings",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>🔌 LLM Providers</b>",
      "",
      `Enabled: <code>${escapeHtml(cfg.llm.enabled_providers.join(", "))}</code>`,
      "",
      "Tap to toggle. The router needs at least one enabled provider.",
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const enabled = new Set(cfg.llm.enabled_providers);
    const rows: InlineKeyboardButton[][] = [];
    for (const id of LLM_PROVIDERS) {
      const icon = enabled.has(id) ? "🔴" : "⚪";
      rows.push([
        {
          text: `${icon} ${id}`,
          callback_data: `action:settings:toggle:llm.enabled_providers:${id}`,
        },
      ]);
    }
    rows.push([{ text: "⬅ Back", callback_data: "nav:/settings" }]);
    return rows;
  },
};
