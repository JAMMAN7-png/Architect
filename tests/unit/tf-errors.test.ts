import { describe, expect, test } from "bun:test";
import { errorBoundary } from "../../src/interface/telegram/engine/errors/boundary.ts";
import { renderTemplate } from "../../src/interface/telegram/engine/errors/render.ts";
import { templates } from "../../src/interface/telegram/engine/errors/templates.ts";
import { DopellerError } from "../../src/interface/telegram/engine/types.ts";
import { makeCtx } from "../fixtures/make-ctx.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";

/**
 * Tests for the error templating + boundary middleware.
 *
 * The boundary catches any throw from `next` and turns it into a
 * user-facing toast — typed `DopellerError`s get a tailored template,
 * everything else gets a generic message with no stack-trace leakage.
 */

describe("templates dictionary", () => {
  test("contains at least 13 entries including the architect codes", () => {
    const codes = Object.keys(templates);
    expect(codes.length).toBeGreaterThanOrEqual(13);
    for (const code of [
      "insufficient_stars",
      "invalid_input",
      "unknown_page",
      "tool_timeout",
      "token_revoked",
      "provider_all_down",
      "bot_suspended",
      "content_blocked",
      "internal_db_unavailable",
      "internal_redis_unavailable",
      "architect_no_project",
      "architect_pending_approval",
      "architect_phase_failed",
    ]) {
      expect(codes).toContain(code);
    }
  });
});

describe("renderTemplate", () => {
  test("substitutes {placeholder}s from vars", () => {
    const out = renderTemplate(
      { title: "Hello {name}", body: "value={x}" },
      { name: "world", x: "42" },
    );
    expect(out.title).toBe("Hello world");
    expect(out.body).toBe("value=42");
  });

  test("missing placeholders render as empty string", () => {
    const out = renderTemplate({ title: "{a}-{b}", body: "{c}!" }, { a: "x" });
    expect(out.title).toBe("x-");
    expect(out.body).toBe("!");
  });

  test("preserves cta when provided", () => {
    const out = renderTemplate(
      { title: "t", body: "b", cta: { label: "go", callback: "nav:/" } },
      {},
    );
    expect(out.cta).toEqual({ label: "go", callback: "nav:/" });
  });
});

describe("errorBoundary", () => {
  test("renders insufficient_stars template as DANGER ephemeral", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);

    await errorBoundary(ctx, async () => {
      throw new DopellerError("insufficient_stars", "user", "msg", {
        need: "50",
        have: "20",
      });
    });

    const sent = api.last("sendMessage");
    expect(sent).toBeDefined();
    const text = sent?.[1] as string;
    // Body contains the rendered placeholders.
    expect(text).toContain("You need 50 Stars; you have 20.");
    // EPHEMERAL DANGER icon prefix is applied by the send layer.
    expect(text.startsWith("❌ ")).toBe(true);

    // Tracked as EPHEMERAL DANGER under the current page scope.
    const list = ctx.session.messages["/"] ?? [];
    expect(list.length).toBe(1);
    expect(list[0]?.type).toBe("EPHEMERAL");
    expect(list[0]?.subtype).toBe("DANGER");
  });

  test("generic Error is swallowed without leaking the message", async () => {
    const api = new StubBotApi();
    const ctx = await makeCtx(api);
    const secret = "TOPSECRET_STACK_LEAK";

    await errorBoundary(ctx, async () => {
      throw new Error(secret);
    });

    expect(api.calls("sendMessage").length).toBe(1);
    const sent = api.last("sendMessage");
    const text = sent?.[1] as string;
    expect(text).not.toContain(secret);
    expect(text).toContain("Something went wrong");

    // No other api method (deleteMessage, editMessageText, etc.)
    // received the leak either.
    for (const call of api.history) {
      for (const arg of call.args) {
        if (typeof arg === "string") {
          expect(arg.includes(secret)).toBe(false);
        }
      }
    }
  });
});
