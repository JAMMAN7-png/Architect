import { describe, expect, test } from "bun:test";
import { LLM_PROVIDERS, SEARCH_PROVIDERS } from "../../src/config/service.ts";
import {
  makeModelTierPage,
  settingsLlmPage,
  settingsRootPage,
  settingsSearchPage,
} from "../../src/interface/telegram/architect/pages/index.ts";
import type { InlineKeyboardButton } from "../../src/interface/telegram/engine/index.ts";
import { listKnownModels } from "../../src/llm/models.ts";
import { makeCtx } from "../fixtures/make-ctx.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

const SECTION_PATHS = [
  "/settings/models",
  "/settings/search",
  "/settings/llm",
  "/settings/runtime",
  "/settings/brainstorm",
  "/settings/output",
];

function flatten(rows: InlineKeyboardButton[][]): InlineKeyboardButton[] {
  return rows.reduce<InlineKeyboardButton[]>((acc, row) => acc.concat(row), []);
}

describe("settingsRootPage", () => {
  test("registered at /settings with parent /", () => {
    expect(settingsRootPage.path).toBe("/settings");
    expect(settingsRootPage.parent).toBe("/");
  });

  test("keyboard exposes a navigation button for each of the six sub-pages", async () => {
    const ctx = await makeCtx(new StubBotApi());
    const rows = await settingsRootPage.keyboard(ctx);
    const callbacks = flatten(rows).map((b) => b.callback_data);
    for (const path of SECTION_PATHS) {
      expect(callbacks).toContain(`nav:${path}`);
    }
    // Plus a back button to the welcome page.
    expect(callbacks).toContain("nav:/");
  });
});

describe("makeModelTierPage('strategic')", () => {
  test("keyboard contains a `set` callback for every known model slug", async () => {
    const page = makeModelTierPage("strategic");
    const ctx = await makeCtx(new StubBotApi());
    const rows = await page.keyboard(ctx);
    const callbacks = new Set(flatten(rows).map((b) => b.callback_data));
    for (const slug of listKnownModels()) {
      expect(callbacks.has(`action:settings:set:models.strategic:${slug}`)).toBe(true);
    }
  });
});

describe("settingsSearchPage", () => {
  test("keyboard contains a toggle row for every search provider", async () => {
    const ctx = await makeCtx(new StubBotApi());
    const rows = await settingsSearchPage.keyboard(ctx);
    const callbacks = new Set(flatten(rows).map((b) => b.callback_data));
    for (const id of SEARCH_PROVIDERS) {
      expect(callbacks.has(`action:settings:toggle:search.enabled_providers:${id}`)).toBe(true);
    }
  });
});

describe("settingsLlmPage", () => {
  test("keyboard contains a toggle row for every LLM provider", async () => {
    const ctx = await makeCtx(new StubBotApi());
    const rows = await settingsLlmPage.keyboard(ctx);
    const callbacks = new Set(flatten(rows).map((b) => b.callback_data));
    for (const id of LLM_PROVIDERS) {
      expect(callbacks.has(`action:settings:toggle:llm.enabled_providers:${id}`)).toBe(true);
    }
  });
});
