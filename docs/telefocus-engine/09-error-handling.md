# 09 — Error Handling: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/09-error-handling.md](../blueprint/05-wave-2-core-engines/telefocus-engine/09-error-handling.md)

## Error hierarchy

```ts
// packages/telefocus/src/errors/classes.ts
export abstract class TelefocusError extends Error {
  abstract readonly class: "user" | "transient" | "fatal";
  constructor(message: string, readonly meta?: Record<string, unknown>) { super(message); }
}

// user errors — surface as DANGER with the user's message
export class ValidationError extends TelefocusError { readonly class = "user" as const; }
export class PermissionDenied extends TelefocusError { readonly class = "user" as const; }
export class OutOfContext    extends TelefocusError { readonly class = "user" as const; }

// transient — retryable, may degrade
export class TransientError  extends TelefocusError { readonly class = "transient" as const; }
export class UpstreamTimeout extends TransientError {}
export class RateLimited     extends TransientError {}
export class UpstreamBusy    extends TransientError {}

// fatal — unhandled; gets an ERR code
export class InvariantError  extends TelefocusError { readonly class = "fatal" as const;
  constructor(public readonly id: string, msg: string) { super(msg); }
}
export class UserBlockedBot  extends TelefocusError { readonly class = "fatal" as const; }
```

## Error code generation

```ts
// packages/telefocus/src/errors/codes.ts
// Deterministic so duplicate correlation ids map to the same code.
export function errorCodeFor(correlationId: string): string {
  const hash = createHash("sha256").update(correlationId).digest();
  const base32 = toBase32(hash).slice(0, 4).toUpperCase();
  return `ERR-${base32}`;
}
```

## Handler boundary

```ts
// packages/telefocus/src/middleware/handler-boundary.ts
export const handlerBoundary = (): Middleware => async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    await handleError(ctx, err);
  }
};

export async function handleError(ctx: DopellerCtx, err: unknown): Promise<void> {
  if (err instanceof TelefocusError) {
    switch (err.class) {
      case "user": {
        await ctx.messages.toast(err.message, { subtype: "DANGER", ttl: 8 });
        ctx.emit("telefocus.error.user", { class: err.constructor.name, meta: err.meta });
        return;
      }
      case "transient": {
        await ctx.messages.toast("Taking longer than usual… retrying.", { subtype: "WARNING" });
        ctx.emit("telefocus.error.transient", { class: err.constructor.name, meta: err.meta });
        return;
      }
      case "fatal":
        break;  // fall through to fatal path
    }
  }
  const code = errorCodeFor(ctx.correlationId);
  logger.error({
    err: serializeError(err),
    correlationId: ctx.correlationId,
    code,
    user_id: ctx.user?.id,
    bot_id: ctx.bot?.id,
    current_page: ctx.session?.menu?.currentPage,
  }, "handler crash");
  await ctx.messages.toast(
    ctx.t("error.fatal", { code }),  // "Something went wrong (${code}). Try /start to reset."
    { subtype: "DANGER", ttl: 15 },
  );
  ctx.emit("telefocus.error.fatal", { code, correlationId: ctx.correlationId });
}
```

The boundary wraps *only* stage 17 (handler). Middleware errors are caught per-stage as described below.

## Per-middleware degrade rules

```ts
// packages/telefocus/src/middleware/degrade.ts
export function degrade<T>(
  fn: () => Promise<T>,
  fallback: T,
  emit: (tag: string) => void,
): Promise<T> {
  return fn().catch((err) => {
    emit(classify(err));
    return fallback;
  });
}

// Usage in middleware:
ctx.memories = await degrade(
  () => withTimeout(memoryClient.recall(...), 500),
  { mem0: [], graphiti: [] },
  (tag) => ctx.emit("telefocus.error.transient", { stage: "memory_recall", tag }),
);
```

Stages with degrade policies:

| Stage | Fallback | Emit |
|---|---|---|
| i18n | `locale = "en"` | `telefocus.error.transient` |
| session-loader | `createDefaultSession(...)` | `telefocus.session.recreated` |
| memory-recall | `{ mem0: [], graphiti: [] }` | `telefocus.error.transient` |
| persona-inject | `DEFAULT_PERSONA` constant | `telefocus.error.transient` |
| tool-policy | `[]` | `telefocus.error.transient` |
| billing-precheck | `{ allowed: true }` (log only) | `telefocus.error.transient` |

## Telegram API retry wrapper

```ts
// packages/telefocus/src/outbound/retry.ts
export function wrapWithRetry(api: TelegramApi, opts: RetryOpts): TelegramApi {
  return new Proxy(api, {
    get(target, prop) {
      const fn = (target as any)[prop];
      if (typeof fn !== "function") return fn;
      return async (...args: unknown[]) => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
          try {
            return await fn.apply(target, args);
          } catch (err) {
            lastErr = err;
            const e = err as { error_code?: number; parameters?: { retry_after?: number } };
            if (e.error_code === 429) {
              const wait = (e.parameters?.retry_after ?? 1) * 1000;
              await sleep(wait);
              continue;
            }
            if (e.error_code === 403) {
              await opts.on403?.();
              throw new UserBlockedBot("Bot blocked by user");
            }
            if (e.error_code === 400 && String(prop).startsWith("edit") && isStaleMenuError(err)) {
              throw err;  // let caller handle (recoverStaleMenu)
            }
            if (e.error_code === 400 && String(prop) === "deleteMessage" && isGhostDelete(err)) {
              return;  // treat as success
            }
            if (e.error_code && e.error_code >= 500) {
              await sleep(opts.backoff[attempt] ?? 8000);
              continue;
            }
            throw err;  // non-retryable
          }
        }
        throw lastErr;
      };
    },
  });
}
```

## Rate-limit escalation (abuse)

```ts
// packages/telefocus/src/middleware/rate-limit.ts (escalation excerpt)
export async function escalateRateLimit(
  redis: RedisClientType,
  key: string,
  hits: number,
): Promise<"toast" | "mute" | "abuse-stack"> {
  const hitsKey = `${key}:hits`;
  const n = await redis.incr(hitsKey);
  if (n === 1) await redis.expire(hitsKey, 3600);
  if (n >= 10) { await abuseStack.enqueue(key); return "abuse-stack"; }
  if (n >= 3) {
    await redis.set(`${key}:muted`, "1", "EX", 300);
    return "mute";
  }
  return "toast";
}
```

The rate-limit middleware checks `${key}:muted` before emitting any toast; while muted, the stage short-circuits silently.

## User-visible message palette

```ts
// packages/telefocus/src/errors/palette.ts
export const ERROR_PALETTE = {
  "error.fatal":         "Something went wrong on our end. Try /start to reset.",
  "error.slow":          "Taking longer than usual…",
  "error.mem0_down":     "Memory is offline — replying with less context.",
  "error.rate_limit":    "Slow down — try again in {seconds}s.",
  "error.llm_saturated": "This bot is busy. Please try again in a moment.",
  "error.unauthorized":  "You don't have permission to do that.",
} as const;
```

These strings are routed through i18n (`ctx.t(key)`); translations live in `packages/telefocus/src/i18n/locales/*.json`.

## Invariant violations in production

```ts
// packages/telefocus/src/errors/invariants.ts
if (process.env.NODE_ENV === "production") {
  // Emit metric + log; do not crash the worker.
  process.on("uncaughtException", (err) => {
    if (err instanceof InvariantError) {
      metrics.increment("telefocus.invariant.violated", { id: err.id });
      logger.error({ err }, "invariant violation");
      return;
    }
    throw err;
  });
}
```

Dev mode throws so the regression is caught in CI.

## SLO targets

| Metric | Wave 2 target | Wave 5 alarm |
|---|---|---|
| `telefocus.error.fatal_rate` | < 0.1 % of updates | paged on 5-min p95 > 0.2 % |
| `telefocus.error.transient_rate` | < 2 % of updates | paged on 5-min p95 > 5 % |
| p95 update latency | ≤ 5 s | paged on sustained > 7 s |

Dashboards and alerting are configured in Wave 5; Wave 2 only emits the events.

## Cross-links

- Blueprint: [09-error-handling](../blueprint/05-wave-2-core-engines/telefocus-engine/09-error-handling.md)
- Sibling: [04-replace-previous.md](04-replace-previous.md) · [05-middleware-pipeline.md](05-middleware-pipeline.md)
