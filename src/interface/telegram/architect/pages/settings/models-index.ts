import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  btn,
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
        btn(`Strategic: ${cfg.models.strategic}`, {
          intent: "models",
          callback_data: "nav:/settings/models/strategic",
        }),
      ],
      [
        btn(`Execution: ${cfg.models.execution}`, {
          intent: "models",
          callback_data: "nav:/settings/models/execution",
        }),
      ],
      [btn(`UI: ${cfg.models.ui}`, { intent: "models", callback_data: "nav:/settings/models/ui" })],
      [
        btn(`Fallback: ${cfg.models.fallback}`, {
          intent: "models",
          callback_data: "nav:/settings/models/fallback",
        }),
      ],
      [
        btn(`Ensemble: ${cfg.models.ensemble.length} models`, {
          intent: "models",
          callback_data: "nav:/settings/models/ensemble",
        }),
      ],
      [btn("⬅ Back", { intent: "back", callback_data: "nav:/settings" })],
    ];
  },
};
