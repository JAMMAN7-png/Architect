import { makeSettingsService } from "../../../../../config/service.ts";
import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  btn,
  escapeHtml,
} from "../../../engine/index.ts";
import { makeScalarEditorFlow } from "../../settings-actions.ts";

const PAGE_PATH = "/settings/brainstorm";
const FLOW_ID = "settings_brainstorm_edit";

/**
 * `/settings/brainstorm` — three scalar editors (source, ref, cache_ttl)
 * routed through the page's input flow.
 */
export const settingsBrainstormPage: PageDefinition = {
  path: PAGE_PATH,
  parent: "/settings",
  async render(_ctx: Ctx): Promise<MenuBody> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    const lines = [
      "<b>💡 Brainstorm</b>",
      "",
      `Source: <code>${escapeHtml(cfg.brainstorm.source)}</code>`,
      `Ref: <code>${escapeHtml(cfg.brainstorm.ref)}</code>`,
      `Cache TTL: <code>${escapeHtml(cfg.brainstorm.cache_ttl)}</code>`,
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  },
  async keyboard(_ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const svc = makeSettingsService();
    const cfg = await svc.load();
    return [
      [
        btn(`✏ Source (${cfg.brainstorm.source})`, {
          intent: "edit",
          callback_data: "action:settings:edit:brainstorm.source",
        }),
      ],
      [
        btn(`✏ Ref (${cfg.brainstorm.ref})`, {
          intent: "edit",
          callback_data: "action:settings:edit:brainstorm.ref",
        }),
      ],
      [
        btn(`✏ Cache TTL (${cfg.brainstorm.cache_ttl})`, {
          intent: "edit",
          callback_data: "action:settings:edit:brainstorm.cache_ttl",
        }),
      ],
      [btn("⬅️ Back", { intent: "back", callback_data: "nav:/settings" })],
    ];
  },
  inputFlow: makeScalarEditorFlow(PAGE_PATH, FLOW_ID),
};
