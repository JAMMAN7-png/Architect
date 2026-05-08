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
        btn(`${cfg.output.ui_enabled ? "🟢" : "⚪"} UI enabled`, {
          intent: cfg.output.ui_enabled ? "toggle-on" : "toggle-off",
          callback_data: `action:settings:set:output.ui_enabled:${!cfg.output.ui_enabled}`,
        }),
      ],
      [
        btn(`${cfg.output.git_init ? "🟢" : "⚪"} Git init`, {
          intent: cfg.output.git_init ? "toggle-on" : "toggle-off",
          callback_data: `action:settings:set:output.git_init:${!cfg.output.git_init}`,
        }),
      ],
      [btn("⬅️ Back", { intent: "back", callback_data: "nav:/settings" })],
    ];
  },
};
