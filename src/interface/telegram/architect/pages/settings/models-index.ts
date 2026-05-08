import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";

/**
 * `/settings/models` — index of the five model tier sub-pages. Each row
 * shows the live value so the menu doubles as a status panel.
 */
export const settingsModelsIndexPage: PageDefinition = {
  path: "/settings/models",
  parent: "/settings",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>🧠 Models</b>",
      "",
      `Strategic: <code>${escapeHtml(cfg.models.strategic)}</code>`,
      `Execution: <code>${escapeHtml(cfg.models.execution)}</code>`,
      `UI: <code>${escapeHtml(cfg.models.ui)}</code>`,
      `Fallback: <code>${escapeHtml(cfg.models.fallback)}</code>`,
      `Ensemble: <code>${escapeHtml(String(cfg.models.ensemble.length))}</code> models`,
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    return [
      [
        {
          text: `Strategic: ${cfg.models.strategic}`,
          callback_data: "nav:/settings/models/strategic",
        },
      ],
      [
        {
          text: `Execution: ${cfg.models.execution}`,
          callback_data: "nav:/settings/models/execution",
        },
      ],
      [{ text: `UI: ${cfg.models.ui}`, callback_data: "nav:/settings/models/ui" }],
      [
        {
          text: `Fallback: ${cfg.models.fallback}`,
          callback_data: "nav:/settings/models/fallback",
        },
      ],
      [
        {
          text: `Ensemble: ${cfg.models.ensemble.length} models`,
          callback_data: "nav:/settings/models/ensemble",
        },
      ],
      [{ text: "⬅️ Back", callback_data: "nav:/settings" }],
    ];
  },
};
