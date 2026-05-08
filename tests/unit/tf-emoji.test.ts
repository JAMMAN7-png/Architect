import { afterEach, describe, expect, test } from "bun:test";
import {
  type EmojiIntent,
  __setEmojiRegistryForTests,
  ce,
  ceText,
  getEmojiSpec,
} from "../../src/interface/telegram/engine/messages/custom-emoji.ts";
import { safeBodyHtml } from "../../src/interface/telegram/engine/messages/sanitise.ts";

/**
 * Custom emoji entities (`<tg-emoji emoji-id="…">fb</tg-emoji>`).
 *
 * `ce` returns trusted HTML for message bodies; `ceText` returns the
 * fallback glyph for places where Telegram does not parse HTML
 * (notably inline-keyboard button labels). `safeBodyHtml` enforces
 * Telegram's HTML allowlist plus our `<tg-emoji>` extension.
 */

afterEach(() => {
  __setEmojiRegistryForTests(null);
});

describe("ce()", () => {
  test("returns the bare fallback when no env id is configured", () => {
    // Defensive: in case the test runner has these env vars set, force the
    // registry into a known empty-id state.
    __setEmojiRegistryForTests({ success: { id: "", fallback: "✅" } });
    expect(ce("success")).toBe("✅");
  });

  test("returns a tg-emoji span when the override id is digits-only", () => {
    __setEmojiRegistryForTests({ success: { id: "123", fallback: "✅" } });
    expect(ce("success")).toBe('<tg-emoji emoji-id="123">✅</tg-emoji>');
  });

  test("falls back to glyph when override id is non-digits", () => {
    __setEmojiRegistryForTests({ success: { id: "abc", fallback: "✅" } });
    expect(ce("success")).toBe("✅");
  });
});

describe("ceText()", () => {
  test("returns the plain glyph regardless of override id", () => {
    __setEmojiRegistryForTests({ warning: { id: "987654321", fallback: "⚠️" } });
    expect(ceText("warning")).toBe("⚠️");
  });
});

describe("safeBodyHtml()", () => {
  test("passes through allow-listed tags including tg-emoji", () => {
    const input = '<b>x</b><tg-emoji emoji-id="1">y</tg-emoji>';
    expect(safeBodyHtml(input)).toBe(input);
  });

  test("throws on disallowed tags", () => {
    expect(() => safeBodyHtml("<script>x</script>")).toThrow(/<script>/);
  });
});

describe("Bot API 9.4 button-glyph intents", () => {
  const cases: ReadonlyArray<readonly [EmojiIntent, string]> = [
    ["settings", "⚙"],
    ["models", "🧠"],
    ["search", "🔍"],
    ["llm", "🔌"],
    ["runtime", "⏱"],
    ["brainstorm", "💡"],
    ["output", "📦"],
    ["restart", "🔄"],
    ["back", "⬅"],
  ];

  for (const [intent, glyph] of cases) {
    test(`getEmojiSpec(${intent}).fallback === ${glyph}`, () => {
      expect(getEmojiSpec(intent).fallback).toBe(glyph);
    });
  }

  test("ce('settings') with empty id → bare glyph", () => {
    __setEmojiRegistryForTests({ settings: { id: "", fallback: "⚙" } });
    expect(ce("settings")).toBe("⚙");
  });

  test("ce('settings') with override id → <tg-emoji> span", () => {
    __setEmojiRegistryForTests({ settings: { id: "5555", fallback: "⚙" } });
    expect(ce("settings")).toBe('<tg-emoji emoji-id="5555">⚙</tg-emoji>');
  });
});
