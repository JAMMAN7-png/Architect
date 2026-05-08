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
import { settingsCandidates } from "../../settings-actions.ts";

/**
 * `/settings/llm` — toggle which LLM provider classes the router may
 * construct. The service enforces `min: 1`; attempts to disable the
 * last enabled provider surface a danger toast from the action handler.
 *
 * Toggle rows emit indexed callbacks (`…:idx:<n>`) so `callback_data`
 * stays under Telegram's 64-byte cap; the action handler resolves the
 * index back via {@link settingsCandidates}.
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
    const enabled = new Set<string>(cfg.llm.enabled_providers);
    const providers = settingsCandidates("llm.enabled_providers");
    const rows: InlineKeyboardButton[][] = [];
    for (let i = 0; i < providers.length; i++) {
      const id = providers[i] ?? "";
      const on = enabled.has(id);
      rows.push([
        btn(`${on ? "🟢" : "⚪"} ${id}`, {
          intent: on ? "toggle-on" : "toggle-off",
          callback_data: indexedSettingsCallback("toggle", "llm.enabled_providers", i),
        }),
      ]);
    }
    rows.push([btn("⬅️ Back", { intent: "back", callback_data: "nav:/settings" })]);
    return rows;
  },
};
