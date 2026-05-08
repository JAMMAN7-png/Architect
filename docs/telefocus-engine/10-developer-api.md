# 10 — Developer API: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/10-developer-api.md](../blueprint/05-wave-2-core-engines/telefocus-engine/10-developer-api.md)

## Public package surface

```ts
// packages/telefocus/src/index.ts
export { createTeleFocusBot } from "./engine";
export type { TeleFocusConfig, DopellerCtx } from "./engine/types";
export type { PageDefinition, MenuRenderResult } from "./pages/types";
export type { InputFlowDefinition, InputFlowStep, ValidationRule } from "./flow/types";
export { kb } from "./engine/keyboard";
export { ModalCancelled, ConcurrentModal, ModalTimedOut } from "./modal/api";
export {
  TelefocusError, ValidationError, PermissionDenied, OutOfContext,
  TransientError, UpstreamTimeout, RateLimited, UpstreamBusy,
} from "./errors/classes";

// Platform-only exports (not re-exported from the creator SDK):
export { PageRegistry } from "./pages/registry";
```

## `DopellerCtx` (authoritative)

```ts
// packages/telefocus/src/engine/types.ts
export interface DopellerCtx extends Context {
  // Identity
  user: DopellerUser;
  bot: BotRecord;
  isBanned: boolean;

  // Localization
  locale: string;
  t: (key: string, vars?: Record<string, unknown>) => string;

  // Correlation
  correlationId: string;

  // Session (platform internal — creator SDK wraps this)
  session: UserSession;
  sessionDirty: boolean;

  // Persona + memory (injected stages 5 & 6)
  memories: { mem0: Mem0Result[]; graphiti: GraphEdge[] };
  persona: { dna: DNA; axes: Axes; signals: Signals };

  // Helpers (public surface)
  messages: MessageLifecycleApi;
  modals:   ModalApi;
  navigate: (path: string, params?: Record<string, unknown>) => Promise<void>;
  gateway:  LlmGatewayApi;
  tools:    ToolInvocationApi;    // Wave 4
  emit:     (event: string, data: unknown) => void;

  // Platform-internal (lint-blocked from user-land)
  flowEngine: InputFlowEngine;
  redis: RedisClientType;
  scheduler: TtlScheduler;
}
```

Creator SDK (Wave 4) wraps `DopellerCtx` in a `SandboxCtx` that strips the platform-internal fields and exposes only the helpers.

## `ctx.messages`

```ts
export interface MessageLifecycleApi {
  send(opts: SendOpts): Promise<number>;
  edit(messageId: number, opts: EditOpts): Promise<void>;
  delete(messageId: number): Promise<void>;
  cleanupScope(pagePath: string): Promise<void>;
  cleanupAll(): Promise<void>;
  toast(text: string, opts?: { subtype?: MessageSubtype; ttl?: number; pagePath?: string }): Promise<number>;
}
```

Implementation is `MessageLifecycleManager`; see [03](03-message-lifecycle.md).

## `ctx.modals`

```ts
export interface ModalApi {
  confirm(opts: ModalConfirmOpts): Promise<"primary" | "secondary">;
}
```

Throws `ModalCancelled` when the user navigates away; `ConcurrentModal` if another modal is live on the same `(chatId, pagePath)`.

## `ctx.navigate`

```ts
ctx.navigate(path: string, params?: Record<string, unknown>): Promise<void>;
```

Implementation:

```ts
// packages/telefocus/src/engine/navigate-helper.ts
export function makeNavigate(ctx: DopellerCtx, registry: PageRegistry) {
  return async (path: string, params?: Record<string, unknown>) => {
    if (params) {
      ctx.session.pageData[path] = { ...(ctx.session.pageData[path] ?? {}), ...params };
      ctx.sessionDirty = true;
    }
    const resolved = registry.resolve(path);
    if (!resolved) throw new Error(`Unknown page: ${path}`);
    await executeNavigate(ctx, registry, ctx.session.menu.currentPage, path, resolved.def);
  };
}
```

Honors `hasUnsavedWork` guards; an active guard rejects with a synchronous error for programmatic navigation (creator handlers see `NavigationGuarded`).

## `ctx.gateway`

```ts
// packages/telefocus/src/engine/gateway.ts
export interface LlmGatewayApi {
  chat(opts: ChatOpts): Promise<ChatResult>;
  chatStream(opts: ChatOpts): AsyncIterable<ChatChunk>;
  vision(opts: VisionOpts): Promise<VisionResult>;
  estimate(opts: ChatOpts): Promise<{ estimated_cost_dc: number }>;
}
```

Detailed spec in `docs/llm-gateway/`. The gateway handles routing, fallback, and billing event emission. Handlers treat it as a black box.

## `ctx.emit`

```ts
ctx.emit("bot.goal_set", { goal: "fitness", target: "5k_run" });
```

Event names follow namespacing rules:

| Prefix | Owner | Example |
|---|---|---|
| `telefocus.*` | Platform internal | `telefocus.navigate` |
| `persona.*` | Persona engine | `persona.mood.changed` |
| `gam.*` | Growth/Activation/Monetization | `gam.billing.precheck` |
| `bot.*` | Creator-defined | `bot.goal_set` |
| `platform.*` | Reserved (future) | — |

Events flow through the metrics-sink (stage 21) to Rybbit and OpenTelemetry.

## `PageDefinition`

```ts
// packages/telefocus/src/pages/types.ts
export interface PageDefinition {
  path: string;
  parent?: string;
  render: (ctx: DopellerCtx) => MenuRenderResult | Promise<MenuRenderResult>;
  keyboard: (ctx: DopellerCtx) => InlineKeyboardButton[][] | Promise<InlineKeyboardButton[][]>;
  onEnter?: (ctx: DopellerCtx) => Promise<void>;
  onExit?: (ctx: DopellerCtx) => Promise<void>;
  inputFlow?: InputFlowDefinition;
  hasUnsavedWork?: (session: UserSession) => boolean;
  hideBackButton?: boolean;
  children?: PageDefinition[];
}

export interface MenuRenderResult {
  text: string;
  parseMode: "HTML" | "MarkdownV2";
}
```

Registered at boot:

```ts
// src/pages/personas/index.ts
export const personasIndex: PageDefinition = {
  path: "/personas",
  render: async (ctx) => {
    const list = await ctx.personas.listFor(ctx.user.id);
    const body = list.length
      ? list.map(p => `• ${p.name}`).join("\n")
      : "No personas yet. Create one to get started.";
    return { text: `<b>Your Personas</b>\n\n${body}`, parseMode: "HTML" };
  },
  keyboard: () => [
    [kb.nav("+ Create", "/personas/create")],
    [kb.nav("◀ Back", "::back")],
  ],
  children: [personaCreatePage, personaViewPage],
};

// During boot:
app.registerPage(personasIndex);
```

## Handler types

### Page render

Pure function of `ctx`. Do not mutate `ctx.session` inside render.

### Action handler

```ts
app.registerAction("regenerate", async (ctx) => {
  const ok = await ctx.modals.confirm({
    title: "Regenerate description?",
    primary: { label: "Yes" }, secondary: { label: "No" },
  });
  if (ok !== "primary") return;
  await regenerate(ctx);
});
```

### Command handler

```ts
app.registerCommand("start", async (ctx) => {
  if (ctx.match && await handleDeepLink(ctx, ctx.match)) return;
  await ctx.messages.cleanupAll();
  await ctx.navigate("/");
});
```

## Extension hooks (platform-only)

```ts
app.registerMiddleware(stage: MiddlewareStage, handler: Middleware): void;
app.registerResponseTransform(handler: (ctx: DopellerCtx, draft: Draft) => Promise<Draft>): void;
app.registerMetricsSink(handler: (event: MetricEvent) => Promise<void>): void;
```

Example — a response transform that applies owner-taught vocabulary substitutions:

```ts
app.registerResponseTransform(async (ctx, draft) => {
  const vocab = ctx.persona.signals.owner_taught_vocabulary ?? [];
  let text = draft.text;
  for (const { from, to } of vocab) {
    text = text.replaceAll(from, to);
  }
  return { ...draft, text };
});
```

## Keyboard helper

```ts
const keyboard = kb.row(
  kb.nav("◀ Back", "::back"),
  kb.nav("Settings", "/settings"),
).row(
  kb.action("Regenerate", "regenerate"),
).done();
```

Byte-length assertion runs at construction; in dev the error includes the offending `callback_data`.

## Test harness

```ts
// packages/telefocus/src/testing/harness.ts
export function createTestHarness(opts: { botId: string; userId: number }): TestHarness {
  const store = new InMemorySessionStore();
  const mockApi = new MockTelegramApi();
  const bot = createTeleFocusBot("test-token", {
    redis: new InMemoryRedis() as unknown as RedisClientType,
    botId: opts.botId,
    pageRegistry: testPageRegistry,
    i18n: testI18n,
    gateway: mockGateway,
    personaStore: mockPersonaStore,
    memoryClient: mockMemoryClient,
  });
  return {
    async send(text: string) { await bot.handleUpdate(mkMessageUpdate(opts.userId, text)); },
    async tap(callbackData: string) { await bot.handleUpdate(mkCallbackUpdate(opts.userId, callbackData)); },
    lastMenuText: () => mockApi.lastEdit?.text,
    currentPath: () => store.peek(`session:${opts.botId}:${opts.userId}`)?.menu.currentPage,
    emitted: (name: string) => mockApi.events.filter(e => e.event === name),
  };
}
```

Pages are tested against the harness:

```ts
test("/settings navigation edits menu", async () => {
  const h = createTestHarness({ botId: "test_bot", userId: 42 });
  await h.send("/start");
  expect(h.lastMenuText()).toContain("Welcome");
  await h.tap("nav:/settings");
  expect(h.currentPath()).toBe("/settings");
  expect(h.lastMenuText()).toContain("Settings");
});
```

## Stability guarantee

The *creator-facing* surface — `ctx.messages`, `ctx.modals`, `ctx.navigate`, `ctx.gateway`, `ctx.emit`, `PageDefinition`, `InputFlowDefinition`, `kb` — is v1-stable through Wave 4. Breaking changes require a blueprint PR and a deprecation window.

Platform-internal fields (`ctx.session`, `ctx.memories`, `ctx.persona`, `ctx.correlationId`, `ctx.flowEngine`, `ctx.redis`, `ctx.scheduler`) may evolve without notice. The creator SDK shields consumers from these.

## Cross-links

- Blueprint: [10-developer-api](../blueprint/05-wave-2-core-engines/telefocus-engine/10-developer-api.md)
- All sibling docs in this folder — each subsystem the API composes.
- Wave 4 creator SDK: [../blueprint/07-wave-4-creator-and-user-experience/](../blueprint/07-wave-4-creator-and-user-experience/)
