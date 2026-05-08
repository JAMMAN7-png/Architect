import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";

/**
 * `/settings` — settings root.
 *
 * Renders a snapshot of the on-disk config (loaded fresh on every render
 * so subsequent mutations through `action:settings:*` are visible
 * immediately) and a six-button section index plus a back button to the
 * welcome page.
 */
export const settingsRootPage: PageDefinition = {
  path: "/settings",
  parent: "/",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>⚙ Settings</b>",
      "",
      `Strategic model: <code>${escapeHtml(cfg.models.strategic)}</code>`,
      `Execution model: <code>${escapeHtml(cfg.models.execution)}</code>`,
      `Search provider: <code>${escapeHtml(cfg.search.provider)}</code>`,
      `LLM providers enabled: <code>${escapeHtml(String(cfg.llm.enabled_providers.length))}</code>`,
      `Log level: <code>${escapeHtml(cfg.runtime.log_level)}</code>`,
      `UI enabled: <code>${escapeHtml(String(cfg.output.ui_enabled))}</code>`,
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  keyboard(_ctx: Ctx): InlineKeyboardButton[][] {
    return [
      [
        { text: "🧠 Models", callback_data: "nav:/settings/models" },
        { text: "🔍 Search", callback_data: "nav:/settings/search" },
      ],
      [
        { text: "🔌 LLM Providers", callback_data: "nav:/settings/llm" },
        { text: "⏱ Runtime", callback_data: "nav:/settings/runtime" },
      ],
      [
        { text: "💡 Brainstorm", callback_data: "nav:/settings/brainstorm" },
        { text: "📦 Output", callback_data: "nav:/settings/output" },
      ],
      [{ text: "⬅ Back", callback_data: "nav:/" }],
    ];
  },
};
