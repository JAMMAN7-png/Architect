import { describe, expect, test } from "bun:test";
import { InputFlowEngine } from "../../src/interface/telegram/engine/flow/engine.ts";
import { validate } from "../../src/interface/telegram/engine/flow/validators.ts";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import type { PageDefinition, ValidationRule } from "../../src/interface/telegram/engine/types.ts";
import { makeCtx } from "../fixtures/make-ctx.ts";
import { StubBotApi } from "../fixtures/stub-bot-api.ts";
describe("validate", () => {
  test("accepts text within length bounds", () => {
    const r = validate({ type: "text", min: 3, max: 5, errorMessage: "len" }, "abcd");
    expect(r).toEqual({ ok: true, value: "abcd" });
  });

  test("rejects out-of-bounds, non-strings, choice misses, regex misses", () => {
    const cases: { rule: ValidationRule; raw: unknown }[] = [
      { rule: { type: "text", min: 3, errorMessage: "e" }, raw: "ab" },
      { rule: { type: "text", max: 3, errorMessage: "e" }, raw: "abcd" },
      { rule: { type: "text", errorMessage: "e" }, raw: 42 },
      { rule: { type: "choice", choices: ["a"], errorMessage: "e" }, raw: "b" },
      { rule: { type: "regex", pattern: "^x+$", errorMessage: "e" }, raw: "yy" },
      { rule: { type: "text", pattern: "^[a-z]+$", errorMessage: "e" }, raw: "AB" },
    ];
    for (const { rule, raw } of cases) expect(validate(rule, raw).ok).toBe(false);
  });
});

const ROOT: PageDefinition = {
  path: "/",
  parent: null,
  render: () => ({ text: "root" }),
  keyboard: () => [],
};

async function makeHarness() {
  const api = new StubBotApi();
  const ctx = await makeCtx(api);
  ctx.session.menu.currentPage = "/p";

  const page: PageDefinition = {
    path: "/p",
    parent: "/",
    render: () => ({ text: "p" }),
    keyboard: () => [],
    inputFlow: {
      flowId: "demo",
      steps: [
        {
          field: "name",
          prompt: "Name?",
          inputType: "text",
          validation: { type: "text", min: 3, max: 5, errorMessage: "len" },
        },
        {
          field: "age",
          prompt: "Age?",
          inputType: "number",
          validation: { type: "number", min: 1, max: 99, errorMessage: "range" },
        },
      ],
      onComplete: async () => {},
    },
  };
  const registry = new PageRegistry();
  registry.registerMany([ROOT, page]);

  const renderer = { rerender: async (): Promise<void> => {} };
  const store = new MemorySessionStore();
  const engine = new InputFlowEngine({ registry, renderer, store });
  return { engine, api, ctx };
}

describe("InputFlowEngine.start", () => {
  test("activates flow and sends progress + prompt messages", async () => {
    const h = await makeHarness();
    await h.engine.start("demo", h.ctx);
    expect(h.ctx.session.inputFlow.active).toBe(true);
    expect(h.ctx.session.inputFlow.totalSteps).toBe(2);
    expect(h.ctx.session.inputFlow.currentStep).toBe(0);
    expect(h.ctx.session.inputFlow.progressMessageId).toBe(100);
    expect(h.ctx.session.inputFlow.promptMessageId).toBe(101);
    const texts = h.api.calls("sendMessage").map((c) => c.args[1]);
    expect(texts.length).toBe(2);
    expect(texts).toContain("Name?");
    expect(texts.some((t) => typeof t === "string" && t.startsWith("Step 1 of 2"))).toBe(true);
  });
});

describe("InputFlowEngine.capture", () => {
  test("valid input advances step, edits progress, deletes user reply", async () => {
    const h = await makeHarness();
    await h.engine.start("demo", h.ctx);
    h.ctx.message = { text: "abcd", message_id: 555 };
    const outcome = await h.engine.capture(h.ctx);
    expect(outcome).toBe("advanced");
    expect(h.ctx.session.inputFlow.currentStep).toBe(1);
    expect(h.ctx.session.inputFlow.collectedData).toEqual({ name: "abcd" });
    expect(h.api.calls("deleteMessage").map((c) => c.args[1])).toContain(555);
    expect(h.api.calls("editMessageText").length).toBeGreaterThanOrEqual(1);
  });

  test("four invalid captures keep the flow active and re-render the prompt with errorMessage prefixed", async () => {
    const h = await makeHarness();
    await h.engine.start("demo", h.ctx);
    const editsBefore = h.api.calls("editMessageText").length;
    for (let i = 0; i < 4; i += 1) {
      h.ctx.message = { text: "x", message_id: 600 + i };
      const outcome = await h.engine.capture(h.ctx);
      expect(outcome).toBe("rejected");
    }
    // Flow stays active and still on step 0.
    expect(h.ctx.session.inputFlow.active).toBe(true);
    expect(h.ctx.session.inputFlow.currentStep).toBe(0);
    expect(h.ctx.session.inputFlow.awaitingInput).toBe(true);
    expect(h.ctx.session.inputFlow.retries).toBe(0);

    // Each rejection edits the prompt message in place with the validator's
    // errorMessage prefixed before the prompt body.
    const promptEdits = h.api
      .calls("editMessageText")
      .filter((c) => typeof c.args[2] === "string" && (c.args[2] as string).includes("Name?"));
    expect(promptEdits.length).toBeGreaterThanOrEqual(4);
    const lastText = promptEdits.at(-1)?.args[2] as string;
    expect(lastText.startsWith("len")).toBe(true);
    expect(lastText).toContain("Name?");

    // The user's invalid replies are deleted forgivingly.
    const deleted = h.api.calls("deleteMessage").map((c) => c.args[1]);
    for (let i = 0; i < 4; i += 1) expect(deleted).toContain(600 + i);

    // No DANGER toast (icon "❌") is sent — feedback lives inline.
    const dangerSent = h.api.history.some(
      (c) =>
        c.method === "sendMessage" &&
        typeof c.args[1] === "string" &&
        (c.args[1] as string).startsWith("❌"),
    );
    expect(dangerSent).toBe(false);

    // We genuinely added more edits past the initial prompt send.
    expect(h.api.calls("editMessageText").length).toBeGreaterThan(editsBefore);
  });
});
