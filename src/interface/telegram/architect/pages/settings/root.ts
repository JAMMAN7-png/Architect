import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  btn,
  escapeHtml,
} from "../../../engine/index.ts";
import { ce } from "../../../engine/messages/custom-emoji.ts";

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
      `${ce("primary")} <b>⚙ Settings</b>`,
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
        btn("🧠 Models", { intent: "models", callback_data: "nav:/settings/models" }),
        btn("🔍 Search", { intent: "search", callback_data: "nav:/settings/search" }),
      ],
      [
        btn("🔌 LLM Providers", { intent: "llm", callback_data: "nav:/settings/llm" }),
        btn("⏱ Runtime", { intent: "runtime", callback_data: "nav:/settings/runtime" }),
      ],
      [
        btn("💡 Brainstorm", { intent: "brainstorm", callback_data: "nav:/settings/brainstorm" }),
        btn("📦 Output", { intent: "output", callback_data: "nav:/settings/output" }),
      ],
      [btn("⬅️ Back", { intent: "back", callback_data: "nav:/" })],
    ];
  },
};
