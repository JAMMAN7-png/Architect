import { afterEach, describe, expect, test } from "bun:test";
import { btn } from "../../src/interface/telegram/engine/keyboard.ts";
import { __setEmojiRegistryForTests } from "../../src/interface/telegram/engine/messages/custom-emoji.ts";

afterEach(() => {
  __setEmojiRegistryForTests(null);
});

describe("btn()", () => {
  test("bare text → only the text field", () => {
    expect(btn("Hi")).toEqual({ text: "Hi" });
  });

  test("intent with empty registry id does NOT attach icon_custom_emoji_id", () => {
    __setEmojiRegistryForTests({ settings: { id: "", fallback: "⚙" } });
    const b = btn("Settings", { intent: "settings" });
    expect(b).toEqual({ text: "Settings" });
    expect("icon_custom_emoji_id" in b).toBe(false);
  });

  test("intent with non-empty registry id attaches icon_custom_emoji_id", () => {
    __setEmojiRegistryForTests({ settings: { id: "42", fallback: "⚙" } });
    const b = btn("Settings", { intent: "settings" });
    expect(b).toEqual({ text: "Settings", icon_custom_emoji_id: "42" });
  });

  test("style + callback_data flow through", () => {
    const b = btn("Approve", { style: "success", callback_data: "x" });
    expect(b).toEqual({ text: "Approve", style: "success", callback_data: "x" });
  });

  test("url flows through", () => {
    const b = btn("Open", { url: "https://x" });
    expect(b).toEqual({ text: "Open", url: "https://x" });
  });

  test("intent with non-empty id + style + callback_data composes all three", () => {
    __setEmojiRegistryForTests({ approve: { id: "9", fallback: "✅" } });
    const b = btn("OK", {
      intent: "approve",
      style: "success",
      callback_data: "go",
    });
    expect(b).toEqual({
      text: "OK",
      icon_custom_emoji_id: "9",
      style: "success",
      callback_data: "go",
    });
  });
});
