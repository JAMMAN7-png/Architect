# 02 — Session State: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/02-session-state.md](../blueprint/05-wave-2-core-engines/telefocus-engine/02-session-state.md)

## Types (authoritative)

```ts
// packages/telefocus/src/engine/types.ts
export interface UserSession {
  userId: number;
  botId: string;
  chatId: number;

  menu: {
    messageId: number | null;
    currentPage: string;       // e.g. "/settings/preferences"
    previousPage: string | null;
    navigationStack: string[]; // ["/", "/settings", "/settings/preferences"]
  };

  messages: Record<string, TrackedMessage[]>; // keyed by pagePath

  inputFlow: {
    active: boolean;
    pagePath: string | null;
    flowId: string | null;
    ownerUserId: number | null;  // set on flow start (group-chat safety)
    currentStep: number;
    totalSteps: number;
    collectedData: Record<string, unknown>;
    promptMessageId: number | null;
    progressMessageId: number | null;
    awaitingInput: boolean;
    inputType: "text" | "selection" | null;
    validationRules: ValidationRule | null;
  };

  navigationGuard: {
    active: boolean;
    pendingDestination: string | null;
    pendingParams: Record<string, unknown> | null;
    confirmationMessageId: number | null;
  };

  pageData: Record<string, Record<string, unknown>>;

  createdAt: number;
  lastInteractionAt: number;
  schemaVersion: 1;  // bump + migrate on breaking change
}

export interface TrackedMessage {
  messageId: number;
  type: "EPHEMERAL" | "INTERACTIVE" | "INPUT_PROMPT" | "INPUT_PROGRESS";
  subtype?: "INFO" | "SUCCESS" | "WARNING" | "DANGER" | "CONFIRMATION" | "MODAL";
  pagePath: string;
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}
```

## Redis key layout

```
session:{botId}:{userId}          → JSON.stringify(UserSession)     TTL=86400s sliding
session:{botId}:{userId}:ui-lock  → "1"                              TTL=2s (replacePrevious lock)
session:{botId}:{userId}:rate     → token bucket state                TTL=60s
deeplink:{token}                  → JSON {pagePath, params}           TTL=86400s
```

Session key scoping is `(botId, userId)` — group chats do not get their own sessions because the menu is user-initiator-scoped (see [07](07-navigation.md)).

## Loader middleware

```ts
// packages/telefocus/src/middleware/session-loader.ts
export const sessionLoader = (redis: RedisClientType, botId: string): Middleware =>
  async (ctx, next) => {
    const key = `session:${botId}:${ctx.from!.id}`;
    const t0 = performance.now();
    const raw = await redis.get(key);
    if (raw) {
      ctx.session = JSON.parse(raw) as UserSession;
      ctx.session.lastInteractionAt = Date.now();
    } else {
      ctx.session = createDefaultSession(ctx.from!.id, botId, ctx.chat!.id);
      ctx.sessionDirty = true;
    }
    ctx.emit("telefocus.stage.session_loader.exited", {
      duration_ms: performance.now() - t0,
      cache_miss: !raw,
    });
    await next();
  };

export function createDefaultSession(userId: number, botId: string, chatId: number): UserSession {
  const now = Date.now();
  return {
    userId, botId, chatId,
    menu: { messageId: null, currentPage: "/", previousPage: null, navigationStack: ["/"] },
    messages: {},
    inputFlow: {
      active: false, pagePath: null, flowId: null, ownerUserId: null,
      currentStep: 0, totalSteps: 0, collectedData: {},
      promptMessageId: null, progressMessageId: null,
      awaitingInput: false, inputType: null, validationRules: null,
    },
    navigationGuard: { active: false, pendingDestination: null, pendingParams: null, confirmationMessageId: null },
    pageData: {},
    createdAt: now,
    lastInteractionAt: now,
    schemaVersion: 1,
  };
}
```

## Writer middleware

```ts
// packages/telefocus/src/middleware/session-writer.ts
export const sessionWriter = (redis: RedisClientType, botId: string): Middleware =>
  async (ctx, next) => {
    try {
      await next();
    } finally {
      if (ctx.sessionDirty) {
        const key = `session:${botId}:${ctx.from!.id}`;
        const value = JSON.stringify(ctx.session);
        // Pipeline SET + EXPIRE — avoids two round-trips.
        await redis.multi().set(key, value).expire(key, 86400).exec();
        ctx.emit("telefocus.session.written", { bytes: value.length });
      }
    }
  };
```

The `finally` ensures we write even if a later stage threw. The fatal error handler does not clear `ctx.sessionDirty`, so error state is still persisted (e.g. last-interaction timestamp).

## Marking dirty

Any mutation to `ctx.session.*` must be followed by `ctx.sessionDirty = true`. To make this mechanical, helpers set it:

```ts
// packages/telefocus/src/engine/dirty-session.ts
export function dirtyProxy<T extends object>(
  target: T,
  onWrite: () => void,
): T {
  return new Proxy(target, {
    set(obj, key, value) {
      onWrite();
      return Reflect.set(obj, key, value);
    },
    deleteProperty(obj, key) {
      onWrite();
      return Reflect.deleteProperty(obj, key);
    },
  });
}
```

In production mode we skip the proxy (5-10 % perf cost); helpers like `ctx.navigate` and `ctx.messages.send` set `ctx.sessionDirty = true` explicitly.

## Stale-menu recovery

```ts
// packages/telefocus/src/engine/stale-menu.ts
export function isStaleMenuError(err: unknown): boolean {
  const e = err as { error_code?: number; description?: string };
  return e.error_code === 400 && /message to edit not found|message can't be edited/i.test(e.description ?? "");
}

export async function recoverStaleMenu(
  ctx: DopellerCtx,
  text: string,
  parseMode: "HTML" | "MarkdownV2",
  keyboard: InlineKeyboardButton[][],
): Promise<void> {
  ctx.emit("telefocus.session.stale_menu");
  const sent = await ctx.api.sendMessage(ctx.chat!.id, text, {
    parse_mode: parseMode,
    reply_markup: { inline_keyboard: keyboard },
  });
  ctx.session.menu.messageId = sent.message_id;
  ctx.sessionDirty = true;
}
```

## Page-miss recovery

If `pageRegistry.resolve(currentPage)` returns null (stale session after a deploy that removed a page), the engine resets:

```ts
// packages/telefocus/src/middleware/session-loader.ts (continued)
function validateSessionPage(ctx: DopellerCtx, registry: PageRegistry): void {
  if (!registry.resolve(ctx.session.menu.currentPage)) {
    ctx.emit("telefocus.session.recovered_to_root", { from: ctx.session.menu.currentPage });
    ctx.session.menu.currentPage = "/";
    ctx.session.menu.navigationStack = ["/"];
    ctx.session.menu.messageId = null;
    ctx.sessionDirty = true;
  }
}
```

## Testing

```ts
// packages/telefocus/src/testing/in-memory-session-store.ts
export class InMemorySessionStore implements SessionStore {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.map.get(key) ?? null; }
  async set(key: string, value: string, ttl: number): Promise<void> {
    this.map.set(key, value);
    setTimeout(() => this.map.delete(key), ttl * 1000).unref();
  }
}
```

Contract tests (`packages/telefocus/src/__tests__/session.contract.test.ts`):

```ts
test("round-trip write + read matches", async () => {
  const session = createDefaultSession(42, "testbot", 42);
  session.menu.currentPage = "/settings";
  await store.set("session:testbot:42", JSON.stringify(session), 86400);
  const raw = await store.get("session:testbot:42");
  expect(JSON.parse(raw!)).toEqual(session);
});

test("stale menu recovery", async () => {
  const h = createTestHarness({ botId: "testbot", userId: 42 });
  await h.send("/start");
  h.mockTelegramError("editMessageText", { error_code: 400, description: "message to edit not found" });
  await h.tap("nav:/settings");
  expect(h.lastMenuText()).toContain("Settings");
  expect(h.emitted("telefocus.session.stale_menu")).toHaveLength(1);
});
```

## Cross-links

- Blueprint: [02-session-state](../blueprint/05-wave-2-core-engines/telefocus-engine/02-session-state.md)
- Sibling: [03-message-lifecycle.md](03-message-lifecycle.md) · [05-middleware-pipeline.md](05-middleware-pipeline.md) · [09-error-handling.md](09-error-handling.md)
