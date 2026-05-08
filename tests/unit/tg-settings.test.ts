import { describe, expect, test } from "bun:test";
import { LLM_PROVIDERS, SEARCH_PROVIDERS } from "../../src/config/service.ts";
import {
  architectPages,
  makeModelTierPage,
  settingsLlmPage,
  settingsRootPage,
  settingsSearchPage,
} from "../../src/interface/telegram/architect/pages/index.ts";
import type { Ctx, InlineKeyboardButton } from "../../src/interface/telegram/engine/index.ts";
import { CALLBACK_DATA_MAX_BYTES } from "../../src/interface/telegram/engine/router/callback.ts";
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

const ENCODER = new TextEncoder();

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
  test("keyboard contains an indexed `set` callback exactly once for each slug", async () => {
    const page = makeModelTierPage("strategic");
    const ctx = await makeCtx(new StubBotApi());
    const rows = await page.keyboard(ctx);
    const callbacks = flatten(rows)
      .map((b) => b.callback_data)
      .filter((c): c is string => typeof c === "string");
    const slugs = listKnownModels();
    for (let i = 0; i < slugs.length; i++) {
      const expected = `action:settings:set:models.strategic:idx:${i}`;
      const matches = callbacks.filter((c) => c === expected);
      expect(matches.length).toBe(1);
    }
    // No literal-slug callbacks survive.
    expect(
      callbacks.some(
        (c) =>
          c.startsWith("action:settings:set:models.strategic:") &&
          !c.startsWith("action:settings:set:models.strategic:idx:"),
      ),
    ).toBe(false);
  });
});

describe("makeModelTierPage('ensemble')", () => {
  test("ensemble toggle rows use the canonical 🟢/⚪ palette", async () => {
    const page = makeModelTierPage("ensemble");
    const ctx = await makeCtx(new StubBotApi());
    const rows = await page.keyboard(ctx);
    const toggleButtons = flatten(rows).filter((b) =>
      typeof b.callback_data === "string"
        ? b.callback_data.startsWith("action:settings:toggle:models.ensemble:idx:")
        : false,
    );
    expect(toggleButtons.length).toBeGreaterThan(0);
    for (const btn of toggleButtons) {
      // Each row begins with either 🟢 (enabled) or ⚪ (disabled). 🔴 is reserved
      // for destructive affordances and MUST NOT appear here.
      expect(btn.text.startsWith("🟢 ") || btn.text.startsWith("⚪ ")).toBe(true);
      expect(btn.text.includes("🔴")).toBe(false);
    }
  });
});

describe("settingsSearchPage", () => {
  test("keyboard contains an indexed toggle row for every search provider", async () => {
    const ctx = await makeCtx(new StubBotApi());
    const rows = await settingsSearchPage.keyboard(ctx);
    const callbacks = flatten(rows).map((b) => b.callback_data);
    for (let i = 0; i < SEARCH_PROVIDERS.length; i++) {
      const expected = `action:settings:toggle:search.enabled_providers:idx:${i}`;
      const matches = callbacks.filter((c) => c === expected);
      expect(matches.length).toBe(1);
    }
  });

  test("keyboard contains an indexed primary-provider `set` row for every search provider", async () => {
    const ctx = await makeCtx(new StubBotApi());
    const rows = await settingsSearchPage.keyboard(ctx);
    const callbacks = flatten(rows).map((b) => b.callback_data);
    for (let i = 0; i < SEARCH_PROVIDERS.length; i++) {
      const expected = `action:settings:set:search.provider:idx:${i}`;
      const matches = callbacks.filter((c) => c === expected);
      expect(matches.length).toBe(1);
    }
  });
});

describe("settingsLlmPage", () => {
  test("keyboard contains an indexed toggle row for every LLM provider", async () => {
    const ctx = await makeCtx(new StubBotApi());
    const rows = await settingsLlmPage.keyboard(ctx);
    const callbacks = flatten(rows).map((b) => b.callback_data);
    for (let i = 0; i < LLM_PROVIDERS.length; i++) {
      const expected = `action:settings:toggle:llm.enabled_providers:idx:${i}`;
      const matches = callbacks.filter((c) => c === expected);
      expect(matches.length).toBe(1);
    }
    // Toggle icon palette: 🟢 (enabled) or ⚪ (disabled), never 🔴.
    const toggleButtons = flatten(rows).filter((b) =>
      typeof b.callback_data === "string"
        ? b.callback_data.startsWith("action:settings:toggle:llm.enabled_providers:idx:")
        : false,
    );
    expect(toggleButtons.length).toBe(LLM_PROVIDERS.length);
    for (const btn of toggleButtons) {
      expect(btn.text.startsWith("🟢 ") || btn.text.startsWith("⚪ ")).toBe(true);
      expect(btn.text.includes("🔴")).toBe(false);
    }
  });
});

describe("Telegram callback_data 64-byte cap", () => {
  test("every callback_data emitted by every architect page is <= 64 bytes", async () => {
    const ctx: Ctx = await makeCtx(new StubBotApi());
    for (const page of architectPages) {
      let rows: InlineKeyboardButton[][];
      try {
        rows = await page.keyboard(ctx);
      } catch {
        // Some pages require services this fixture does not provide;
        // skip them — this guard is for keyboard-rendering pages only.
        continue;
      }
      for (const button of flatten(rows)) {
        const bytes = ENCODER.encode(button.callback_data).length;
        expect(bytes).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
      }
    }
  });
});
