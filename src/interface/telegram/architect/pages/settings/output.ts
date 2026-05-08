import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";

/**
 * `/settings/output` — two boolean toggles. Each row sets the next
 * value explicitly so the persisted config never depends on read-back.
 */
export const settingsOutputPage: PageDefinition = {
  path: "/settings/output",
  parent: "/settings",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>📦 Output</b>",
      "",
      `UI enabled: <code>${escapeHtml(String(cfg.output.ui_enabled))}</code>`,
      `Git init: <code>${escapeHtml(String(cfg.output.git_init))}</code>`,
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    return [
      [
        {
          text: `${cfg.output.ui_enabled ? "🔴" : "⚪"} UI enabled`,
          callback_data: `action:settings:set:output.ui_enabled:${!cfg.output.ui_enabled}`,
        },
      ],
      [
        {
          text: `${cfg.output.git_init ? "🔴" : "⚪"} Git init`,
          callback_data: `action:settings:set:output.git_init:${!cfg.output.git_init}`,
        },
      ],
      [{ text: "⬅ Back", callback_data: "nav:/settings" }],
    ];
  },
};
