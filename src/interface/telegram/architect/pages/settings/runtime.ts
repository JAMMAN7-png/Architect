import { LOG_LEVELS, makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../../engine/index.ts";
import { makeScalarEditorFlow } from "../../settings-actions.ts";

const PAGE_PATH = "/settings/runtime";
const FLOW_ID = "settings_runtime_edit";

/**
 * `/settings/runtime` — log level (enum picker) plus retry-attempts and
 * default-max-tokens scalar editors.
 */
export const settingsRuntimePage: PageDefinition = {
  path: PAGE_PATH,
  parent: "/settings",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>⏱ Runtime</b>",
      "",
      `Log level: <code>${escapeHtml(cfg.runtime.log_level)}</code>`,
      `Retry attempts: <code>${escapeHtml(String(cfg.runtime.retry_attempts))}</code>`,
      `Default max tokens: <code>${escapeHtml(String(cfg.runtime.max_tokens_default))}</code>`,
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const logRow: InlineKeyboardButton[] = LOG_LEVELS.map((lvl) => ({
      text: `${lvl === cfg.runtime.log_level ? "⭐" : "·"} ${lvl}`,
      callback_data: `action:settings:set:runtime.log_level:${lvl}`,
    }));
    return [
      logRow,
      [
        {
          text: `✏ Retry attempts (${cfg.runtime.retry_attempts})`,
          callback_data: "action:settings:edit:runtime.retry_attempts",
        },
      ],
      [
        {
          text: `✏ Default max tokens (${cfg.runtime.max_tokens_default})`,
          callback_data: "action:settings:edit:runtime.max_tokens_default",
        },
      ],
      [{ text: "⬅ Back", callback_data: "nav:/settings" }],
    ];
  },
  inputFlow: makeScalarEditorFlow(PAGE_PATH, FLOW_ID),
};
