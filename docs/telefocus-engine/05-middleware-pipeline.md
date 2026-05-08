# 05 — Middleware Pipeline: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/05-middleware-pipeline.md](../blueprint/05-wave-2-core-engines/telefocus-engine/05-middleware-pipeline.md)

## Middleware signature

```ts
// packages/telefocus/src/middleware/types.ts
export type Middleware = (ctx: DopellerCtx, next: () => Promise<void>) => Promise<void>;

export enum MiddlewareStage {
  Auth = 1,
  RateLimit = 2,
  I18n = 3,
  SessionLoader = 4,
  TtlSweep = 4.5,           // post-loader lazy sweep
  MemoryRecall = 5,
  PersonaInject = 6,
  ToolPolicy = 7,
  BillingPrecheck = 8,
  ContextGuard = 9,
  InputCapture = 10,
  NavRouter = 11,
  ActionRouter = 12,
  FlowRouter = 13,
  GuardRouter = 14,
  MsgRouter = 15,
  CommandHandler = 16,
  Handler = 17,
  ResponseComposer = 18,
  Outbound = 19,
  BillingSettle = 20,
  MetricsSink = 21,
  SessionWriter = 22,
  Fallback = 23,
}
```

## Installation

```ts
// packages/telefocus/src/middleware/install.ts
export function installMiddleware<T extends DopellerCtx>(bot: Bot<T>, cfg: TeleFocusConfig): void {
  bot.use(correlationId());            // attach ctx.correlationId = uuid()
  bot.use(auth(cfg.userStore));
  bot.use(rateLimit(cfg.redis, cfg.botId));
  bot.use(i18n(cfg.i18n));
  bot.use(sessionLoader(cfg.redis, cfg.botId));
  bot.use(lazyTtlSweepMw());
  bot.use(memoryRecall(cfg.memoryClient));
  bot.use(personaInject(cfg.personaStore));
  bot.use(toolPolicy(cfg.toolPolicy));
  bot.use(billingPrecheck(cfg.gateway));
  bot.use(contextGuard(cfg.pageRegistry));
  bot.use(inputCapture(cfg.pageRegistry));
  // Routers
  bot.use(navRouter(cfg.pageRegistry));
  bot.use(actionRouter());
  bot.use(flowRouter(cfg.pageRegistry));
  bot.use(guardRouter());
  bot.use(msgRouter());
  bot.use(commandHandler());
  bot.use(handler());
  bot.use(responseComposer(cfg.personaStore, cfg.i18n));
  bot.use(outbound(cfg.redis, cfg.botId));
  bot.use(billingSettle(cfg.gateway));
  bot.use(metricsSink());
  bot.use(sessionWriter(cfg.redis, cfg.botId));
  bot.use(fallback());
}
```

## Stage implementations (key excerpts)

### Auth (stage 1)

```ts
// packages/telefocus/src/middleware/auth.ts
export const auth = (store: UserStore): Middleware => async (ctx, next) => {
  const user = await store.getOrCreate(ctx.from!.id);   // 60s in-memory cache
  ctx.user = user;
  ctx.isBanned = user.bannedAt != null;
  if (ctx.isBanned) {
    ctx.emit("telefocus.stage.auth.short_circuit", { reason: "banned" });
    return;  // silent drop — no toast for banned users
  }
  await next();
};
```

### Rate-limit (stage 2)

Redis token bucket, 30 tokens / 60 s default. The bucket is refilled lazily on each check.

```ts
// packages/telefocus/src/middleware/rate-limit.ts
const LUA_CONSUME = `
  local b = redis.call('HMGET', KEYS[1], 'tokens', 'last')
  local tokens = tonumber(b[1]) or tonumber(ARGV[1])  -- capacity
  local last = tonumber(b[2]) or tonumber(ARGV[3])
  local now = tonumber(ARGV[3])
  local rate = tonumber(ARGV[2])                      -- tokens/sec
  tokens = math.min(tonumber(ARGV[1]), tokens + (now - last) * rate)
  if tokens < 1 then return 0 end
  tokens = tokens - 1
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'last', now)
  redis.call('EXPIRE', KEYS[1], 120)
  return 1
`;

export const rateLimit = (redis: RedisClientType, botId: string): Middleware =>
  async (ctx, next) => {
    const key = `session:${botId}:${ctx.from!.id}:rate`;
    const ok = await redis.eval(LUA_CONSUME, 1, key, "30", "0.5", String(Date.now() / 1000));
    if (!ok) {
      await ctx.messages.toast("Slow down — try again in 30s.", { subtype: "DANGER", ttl: 10 });
      ctx.emit("telefocus.stage.rate_limit.short_circuit", { reason: "rate-limited" });
      return;
    }
    await next();
  };
```

### Context guard (stage 9)

Decision-tree implementation mirroring the table in the blueprint.

```ts
// packages/telefocus/src/middleware/context-guard.ts
export const contextGuard = (registry: PageRegistry): Middleware => async (ctx, next) => {
  if (ctx.callbackQuery) {
    const valid = isRecognizedCallback(ctx.callbackQuery.data ?? "");
    if (!valid) {
      await ctx.answerCallbackQuery("⚠️ This button has expired.");
      ctx.emit("telefocus.stage.context_guard.short_circuit", { reason: "stale-callback" });
      return;
    }
  } else if (ctx.message?.text) {
    const isCommand = ctx.message.text.startsWith("/");
    const flowActive = ctx.session.inputFlow.active && ctx.session.inputFlow.awaitingInput;
    const flowOwner = ctx.session.inputFlow.ownerUserId;
    if (!isCommand && flowActive && flowOwner !== ctx.from!.id) {
      return;  // silently drop non-owner text in group-chat flow
    }
  } else if (!ctx.callbackQuery && !ctx.message) {
    await ctx.messages.toast("🚫 Please use text or buttons.", { subtype: "WARNING" });
    ctx.emit("telefocus.stage.context_guard.short_circuit", { reason: "unsupported-update" });
    return;
  }
  await next();
};
```

### Memory-recall (stage 5)

```ts
// packages/telefocus/src/middleware/memory-recall.ts
const RECALL_BUDGET_MS = 500;

export const memoryRecall = (client: MemoryClient): Middleware => async (ctx, next) => {
  const query = ctx.message?.text ?? "";
  if (!query) { ctx.memories = { mem0: [], graphiti: [] }; return next(); }

  try {
    const [mem0, graphiti] = await Promise.all([
      withTimeout(client.mem0.search({
        query,
        filters: { AND: [{ user_id: String(ctx.user.id) }, { agent_id: ctx.bot.id }] },
        limit: 5,
        threshold: 0.4,
      }), RECALL_BUDGET_MS),
      withTimeout(client.graphiti.edges({
        center: String(ctx.user.id),
        windowDays: 90,
      }), RECALL_BUDGET_MS),
    ]);
    ctx.memories = { mem0, graphiti };
  } catch (err) {
    ctx.emit("telefocus.error.transient", { stage: "memory_recall", class: classify(err) });
    ctx.memories = { mem0: [], graphiti: [] };  // fail open
  }
  await next();
};
```

### Outbound (stage 19)

Wraps every Telegram API call with retries, edit-rate protection, and 429 handling.

```ts
// packages/telefocus/src/middleware/outbound.ts
export const outbound = (redis: RedisClientType, botId: string): Middleware => async (ctx, next) => {
  const origApi = ctx.api;
  ctx.api = wrapWithRetry(origApi, {
    on429: async (retryAfter) => { await sleep(retryAfter * 1000); },
    on403: async () => { await markBlocked(ctx.user.id); throw new UserBlockedBot(); },
    maxRetries: 3,
    backoff: [500, 2000, 8000],
  });
  await next();
};
```

Edit-rate guard:

```ts
// packages/telefocus/src/middleware/edit-rate-guard.ts
const EDIT_RATE_KEY = (chatId: number) => `telefocus:edit-rate:${chatId}`;

export async function acquireEditSlot(redis: RedisClientType, chatId: number): Promise<boolean> {
  // Simple 1-per-second bucket per chat.
  const key = EDIT_RATE_KEY(chatId);
  const ok = await redis.set(key, "1", "NX", "PX", 900);
  return ok === "OK";
}
```

Menu streaming edits that miss a slot are deferred onto a BullMQ `telefocus:delayed-ui` queue and reapplied when the slot opens.

### Metrics sink (stage 21)

```ts
// packages/telefocus/src/middleware/metrics-sink.ts
export const metricsSink = (): Middleware => async (ctx, next) => {
  const buffer: MetricEvent[] = [];
  const originalEmit = ctx.emit;
  ctx.emit = (event, data) => buffer.push({ event, data, ts: Date.now() });
  await next();
  // Flush once at end — batched Rybbit call.
  await rybbit.trackBatch(buffer.map(e => ({
    event: e.event,
    properties: { ...e.data, correlation_id: ctx.correlationId, bot_id: ctx.bot.id },
    timestamp: e.ts,
  })));
};
```

## Adding a new middleware

1. Pick a stage number between the two existing stages whose output/input you depend on. Use a `.5` suffix if you need to insert between integers (e.g. `TtlSweep = 4.5`).
2. Implement the `Middleware` signature.
3. Register in `installMiddleware` at the correct position.
4. Add a contract test asserting order via a mock recorder:

```ts
test("middleware runs in declared order", async () => {
  const recorder: string[] = [];
  const h = createTestHarness({ middleware: [
    mw("auth", recorder), mw("session-loader", recorder), mw("custom", recorder),
  ]});
  await h.send("/start");
  expect(recorder).toEqual(["auth", "session-loader", "custom"]);
});
```

## Short-circuit rules

1. **`throw`** → caught by error boundary → fatal DANGER toast + session write.
2. **`return` without `next()`** → chain ends; session-writer (via outer `try/finally`) still runs.
3. **Never mutate `ctx` post-`next()`** — post-`next()` is reserved for cleanup emit only.

The `sessionWriter` and `metricsSink` are both implemented with `try { await next(); } finally { ... }` so they always commit, even on throws.

## Cross-links

- Blueprint: [05-middleware-pipeline](../blueprint/05-wave-2-core-engines/telefocus-engine/05-middleware-pipeline.md)
- Sibling: [03-message-lifecycle.md](03-message-lifecycle.md) · [09-error-handling.md](09-error-handling.md)
