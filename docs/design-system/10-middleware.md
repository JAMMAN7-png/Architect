# 10 — Middleware Pipeline

> The ordered chain every update passes through. Each middleware has
> one responsibility. Together they implement the framework invariants.
>
> **Contract:** [blueprint/07/design-system/10-middleware.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/10-middleware.md).
> **Up:** [01-overview](01-overview.md).

---

## The chain

```
Incoming update
   │
   ▼
 1. Error boundary
 2. Bot status gate
 3. Session loader
 4. Rate limit
 5. Language enforcement
 6. Memory prefetch (Mem0)        ← text updates only
 7. Persona signal load
 8. Input capture                  ← short-circuits if flow active
 9. Navigation router / action dispatcher
10. Handler                        ← user code
11. Analytics fanout (Rybbit)
12. Session save                   ← version-guarded
   │
   ▼
Response
```

## Signature

```typescript
// packages/telefocus/src/middleware/types.ts
export type NextFn = () => Promise<void>;
export type Middleware = (ctx: Ctx, next: NextFn) => Promise<void>;
```

## Pipeline registration

```typescript
// packages/telefocus/src/bootstrap.ts
export const pipeline: Middleware[] = [
  errorBoundary,
  botStatusGate,
  sessionLoader,
  rateLimit,
  languageEnforcement,
  memoryPrefetch,
  personaSignalLoad,
  inputCapture,
  router,
  // handlers run implicitly when router falls through
  analyticsFanout,
  sessionSave,
];
```

## 1. Error boundary

Wraps the chain. Typed errors route to templated UX; internal errors
produce a generic DANGER toast + SRE alert. See
[08-error-handling](08-error-handling.md).

## 2. Bot status gate

Reads `bot:{id}:config.status` (cached 5 s):

| Status | Behaviour |
|---|---|
| `Running` | Pass through. |
| `Paused` | Silent 200 OK, no reply. |
| `Suspended` | Emit `bot_suspended` templated error, stop. |
| `Deleted` | 410 Gone (should not be reached — webhook would be unbound). |

## 3. Session loader

```typescript
// packages/telefocus/src/middleware/session-loader.ts
export const sessionLoader: Middleware = async (ctx, next) => {
  const userId = extractUserId(ctx.update);
  const chatId = extractChatId(ctx.update);
  const session = await store.load(userId, chatId);
  dropExpiredMessages(session);                  // lazy cleanup
  ctx.session = session;
  await next();
};
```

Rehydrates from Redis or creates a new session. Attaches `ctx.session`
for downstream. Opportunistically drops expired ephemeral entries.

## 4. Rate limit

Per-user + per-bot sliding window in Redis.

| Tier | Limit |
|---|---|
| Free | 30 updates / 60 s |
| Basic | 60 / 60 s |
| Pro | 120 / 60 s |

Exceeded → WARNING ephemeral *"You're sending messages too fast — try
again in {seconds}s."*; pipeline stops.

## 5. Language enforcement

i18n invariant from master blueprint §4.18:

```typescript
if (!ctx.session.language) {
  await navigateTo(ctx, '/onboarding/language');
  return;                                         // short-circuit
}
ctx.locale = ctx.session.language;
await next();

// After handler returns: LLM language-detect on first 2 lines of outgoing
// response. If mismatched: run recovery chain (retry w/ stricter prompt
// → translate post-hoc → template fallback).
```

## 6. Memory prefetch (Mem0)

Runs only for non-command text updates where the bot's persona config
enables prefetch:

```typescript
const { results } = await mem0.search(ctx.message?.text ?? '', {
  filters: { AND: [{ user_id: ctx.session.userId }, { agent_id: botId }] },
  topK: 5,
  threshold: 0.4,
});
ctx.session.memories = results;
```

## 7. Persona signal load

Loads the unified-trait personality vector from the Persona Engine.
Attaches to `ctx.session.personality`. The response composer reads it
to shape tone, length, formality.

## 8. Input capture

```typescript
// packages/telefocus/src/middleware/input-capture.ts
export const inputCapture: Middleware = async (ctx, next) => {
  const flow = ctx.session.inputFlow;
  if (!flow.active || !flow.awaitingInput) return next();

  const result = await flowEngine.capture(ctx);
  switch (result) {
    case 'advanced':
    case 'completed':
      return;                                     // short-circuit
    case 'rejected':
      return;                                     // toast already surfaced
  }
};
```

Short-circuits when a flow is active so the content is never
double-processed as a command.

## 9. Navigation router / action dispatcher

Routes by `callback_data` prefix:

| Prefix | Target |
|---|---|
| `nav:*` | `navigateTo` |
| `action:*` | Registered action handler |
| `flow:*` | Flow engine (step advance) |
| `guard:*` | Guard resolution |

For `message` updates with text matching a registered command, route to
the command handler. Otherwise fall through to the next middleware
(user code).

## 10. Handler

Where consumer logic lives — responding to a message, calling the LLM,
rendering something. See [09-developer-api](09-developer-api.md).

## 11. Analytics fanout (Rybbit)

Emits:

- `message.received` — on every inbound.
- `message.replied` — after handler completes.
- `nav.changed` — on successful navigation.
- `error.raised` — on any handled error.

Events go to both a platform-wide Rybbit property and the bot's
per-bot property.

## 12. Session save

Persists through the version-guard Lua. On concurrent-write rejection,
re-reads from step 3 (session loader) and retries from step 9 onward,
up to 3 times.

## Insertion points for future waves

| Wave | Where | What |
|---|---|---|
| **Wave 5** (gamification) | After handler, before analytics fanout | Award XP, update mood pin |
| **Wave 5** (heartbeat) | Scheduled-task middleware, Phase 3 | Periodic heartbeat billing |
| **Wave 6** (safety) | Before handler | Prompt classification, abuse throttle, toxicity filter |

Each wave adds at a defined insertion point. The chain order is
contract — **order determines behaviour**.

## Cross-cutting concerns

### Logging

Every middleware logs at debug level. The logger enriches with
`{bot_id, user_id, update_id, middleware}` so every line is traceable.
Bot tokens and `initData` strings are regex-redacted at the sink.

### Tracing

OpenTelemetry spans: one root per update, one child per middleware.
Exported to the same backend as the webhook gateway.

### Metrics

Each middleware records `middleware_latency_ms{name, bot_id}`. Alert on
p95 > 50 ms for any single middleware (excluding LLM-bound ones, which
have their own SLOs).

## Example — adding a safety middleware (Wave 6)

```typescript
// src/modules/safety/prompt-classifier.ts
export const promptClassifier: Middleware = async (ctx, next) => {
  const text = ctx.message?.text;
  if (!text) return next();
  const verdict = await classifier.score(text);
  if (verdict.blocked) {
    throw new DopellerError('content_blocked', 'platform', 'blocked', {
      refusal_reason: verdict.reason,
    });
  }
  ctx.classification = verdict;
  await next();
};

// Registered at insertion point:
pipeline.splice(
  pipeline.indexOf(handler),                      // "before handler"
  0,
  promptClassifier,
);
```

## Success criteria

- [ ] Every middleware has a single responsibility, documented in its file.
- [ ] Insertion points for future waves are explicit and stable.
- [ ] Full chain p95 latency < 300 ms on the hot path (excluding LLM).
- [ ] Session save is atomic; concurrent writes never corrupt state.
