import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type PingRouter,
  __setRouterFactoryForTests,
  registerSettingsActions,
} from "../../src/interface/telegram/architect/settings-actions.ts";
import { TeleFocus } from "../../src/interface/telegram/engine/bootstrap.ts";
import { __setEmojiRegistryForTests } from "../../src/interface/telegram/engine/messages/custom-emoji.ts";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { MemorySessionStore } from "../../src/interface/telegram/engine/session/store.ts";
import type { PageDefinition, ServicesShape } from "../../src/interface/telegram/engine/types.ts";
import { adaptUpdate } from "../../src/interface/telegram/grammy-adapter.ts";
import {
  type DynamicModel,
  __setDynamicModelCacheForTests,
  clearDynamicModelCache,
} from "../../src/llm/dynamic-models.ts";
import { FakeBot } from "../fixtures/fake-grammy.ts";

/**
 * Pagination + health-check unit tests for the `/settings/models/<tier>`
 * action surface.
 *
 * The dynamic-models cache is seeded with a deterministic 12-model
 * snapshot (forces page 2). The `OPENAI_API_KEY` env var is stamped so
 * `listAllDynamicModels` does not skip the cached provider on its
 * env-key filter.
 */

const SEEDED: DynamicModel[] = Array.from({ length: 12 }).map((_, i) => ({
  slug: `openai/m${i.toString().padStart(2, "0")}`,
  provider: "openai" as const,
  apiId: `m${i.toString().padStart(2, "0")}`,
}));

const MODEL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "VERCEL_AI_GATEWAY_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "NVIDIA_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_GO_API_KEY",
] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

const ORIGIN = { from: { id: 9 }, chat: { id: 9 } };
const TIER_PAGE = "/settings/models/strategic";

interface Harness {
  bot: FakeBot;
  store: MemorySessionStore;
  rerenderCount: number;
  pingRouter: StubPingRouter;
}

class StubPingRouter implements PingRouter {
  public calls: string[] = [];
  public fail = false;
  public errorMessage = "boom";

  async ping(modelId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    this.calls.push(modelId);
    if (this.fail) return { ok: false, latencyMs: 7, error: this.errorMessage };
    return { ok: true, latencyMs: 42 };
  }
}

function seedEnv(): void {
  for (const k of MODEL_ENV_KEYS) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OPENAI_API_KEY = "test-key";
  clearDynamicModelCache();
  __setDynamicModelCacheForTests("openai", SEEDED);
}

function restoreEnv(): void {
  for (const k of MODEL_ENV_KEYS) {
    const v = SAVED_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  clearDynamicModelCache();
}

/**
 * Build a TeleFocus harness with a stub model-tier page that records
 * how often it gets re-rendered. The page asserts the existence of a
 * `pageData[currentPage]` bucket so we can read the cursor back after
 * the page-handler runs.
 */
async function makeHarness(): Promise<Harness> {
  const store = new MemorySessionStore();
  const registry = new PageRegistry();
  const services: ServicesShape = {};

  // Minimal page registration so `currentPage = TIER_PAGE` is resolvable
  // by the renderer for `rerender(ctx)`. The page itself does not need
  // to enumerate models; the page-handler only writes pageData and
  // delegates rendering.
  let rerenderCount = 0;
  const root: PageDefinition = {
    path: "/",
    parent: null,
    render: () => ({ text: "root" }),
    keyboard: () => [],
  };
  const tierStub: PageDefinition = {
    path: TIER_PAGE,
    parent: "/",
    render: () => {
      rerenderCount += 1;
      return { text: "tier" };
    },
    keyboard: () => [],
  };

  const tf = TeleFocus.attach({ store, registry, pages: [root, tierStub], services });
  services.nav = { registry: tf.registry, renderer: tf.renderer, store };

  const bot = new FakeBot();
  const pingRouter = new StubPingRouter();
  __setRouterFactoryForTests(() => pingRouter);

  registerSettingsActions(bot.asBot(), {
    runner: {} as never,
    renderer: tf.renderer,
    registry: tf.registry,
    store,
    flow: tf.flow,
    services,
  });

  // Seed the user's session to point at the model-tier page so the
  // page-handler writes pageData under the correct key.
  const session = await store.load(ORIGIN.from.id, ORIGIN.chat.id);
  session.menu.currentPage = TIER_PAGE;
  await store.save(session);

  // The fake bot's middleware path drives `adaptUpdate` so that
  // session-state mutations performed by handlers persist through the
  // store (the action handlers use `deps.store.save` directly).
  bot.use(async (grammyCtx) => {
    await adaptUpdate(grammyCtx, services);
  });

  // Capture rerenderCount via a holder mirror.
  const harness: Harness = {
    bot,
    store,
    get rerenderCount(): number {
      return rerenderCount;
    },
    set rerenderCount(_n: number) {
      // unused, only reads matter.
    },
    pingRouter,
  } as unknown as Harness;
  return harness;
}

beforeEach(() => {
  seedEnv();
  __setEmojiRegistryForTests({});
});

afterEach(() => {
  restoreEnv();
  __setEmojiRegistryForTests(null);
  __setRouterFactoryForTests(null);
});

describe("settings page-handler", () => {
  test("advances session.pageData[pagePath].page and rerenders", async () => {
    const h = await makeHarness();
    const before = h.rerenderCount;

    await h.bot.inject(
      { callbackQuery: { data: "action:settings:page:models.strategic:1" } },
      ORIGIN,
    );

    const session = await h.store.load(ORIGIN.from.id, ORIGIN.chat.id);
    const bucket = session.pageData[TIER_PAGE];
    expect(bucket).toBeDefined();
    expect(bucket?.page).toBe(1);
    expect(h.rerenderCount).toBeGreaterThan(before);
  });

  test("rejects negative page numbers without rerendering", async () => {
    const h = await makeHarness();
    const before = h.rerenderCount;

    await h.bot.inject(
      { callbackQuery: { data: "action:settings:page:models.strategic:-1" } },
      ORIGIN,
    );

    // The PAGE_RE only matches `\d+`, so a negative is treated as a no-match
    // by the registered handler — it falls through to the catch-all
    // middleware (no-op). pageData remains unset and no rerender fires.
    const session = await h.store.load(ORIGIN.from.id, ORIGIN.chat.id);
    expect(session.pageData[TIER_PAGE]?.page).toBeUndefined();
    expect(h.rerenderCount).toBe(before);
  });
});

describe("settings ping-handler", () => {
  test("dispatches LLMRouter.ping and toasts info on success", async () => {
    const h = await makeHarness();
    const sentBefore = h.bot.stubApi.sentMessages.length;
    const editedBefore = h.bot.stubApi.editedMessages.length;

    await h.bot.inject(
      { callbackQuery: { data: "action:settings:ping:models.strategic:idx:3" } },
      ORIGIN,
    );

    expect(h.pingRouter.calls).toEqual(["openai/m03"]);

    // First toast is a fresh send ("Pinging…"); the second toast.info
    // shares the INFO subtype + scope so `replacePrevious: true` edits
    // the prior message in place ("healthy in N ms"). The union of
    // sent + edited text MUST cover both phases.
    const sent = h.bot.stubApi.sentMessages.slice(sentBefore);
    const edited = h.bot.stubApi.editedMessages.slice(editedBefore);
    const allTexts = [...sent, ...edited].map((m) => m.text).join("\n");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(allTexts).toContain("Pinging");
    expect(allTexts).toContain("openai/m03");
    expect(allTexts).toContain("healthy in 42 ms");
    // No 💔 indicator on the success path.
    expect(allTexts.includes("💔")).toBe(false);
  });

  test("toasts danger on failure", async () => {
    const h = await makeHarness();
    h.pingRouter.fail = true;
    h.pingRouter.errorMessage = "auth failed";
    const sentBefore = h.bot.stubApi.sentMessages.length;
    const editedBefore = h.bot.stubApi.editedMessages.length;

    await h.bot.inject(
      { callbackQuery: { data: "action:settings:ping:models.strategic:idx:5" } },
      ORIGIN,
    );

    expect(h.pingRouter.calls).toEqual(["openai/m05"]);
    const sent = h.bot.stubApi.sentMessages.slice(sentBefore);
    const edited = h.bot.stubApi.editedMessages.slice(editedBefore);
    const allTexts = [...sent, ...edited].map((m) => m.text).join("\n");
    expect(allTexts).toContain("openai/m05");
    expect(allTexts).toContain("failed: auth failed");
    expect(allTexts.includes("💔")).toBe(true);
  });

  test("danger-toasts on out-of-range index", async () => {
    const h = await makeHarness();
    const sentBefore = h.bot.stubApi.sentMessages.length;

    await h.bot.inject(
      { callbackQuery: { data: "action:settings:ping:models.strategic:idx:99" } },
      ORIGIN,
    );

    expect(h.pingRouter.calls.length).toBe(0);
    const texts = h.bot.stubApi.sentMessages
      .slice(sentBefore)
      .map((s) => s.text)
      .join("\n");
    expect(texts).toContain("Unknown model.");
  });
});

describe("settings noop matcher", () => {
  test("answers without state mutation for noop:* callbacks", async () => {
    const h = await makeHarness();
    const before = h.rerenderCount;

    await h.bot.inject({ callbackQuery: { data: "noop:provider:openai" } }, ORIGIN);

    const session = await h.store.load(ORIGIN.from.id, ORIGIN.chat.id);
    expect(session.pageData[TIER_PAGE]?.page).toBeUndefined();
    expect(h.rerenderCount).toBe(before);
  });
});
