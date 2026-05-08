# 08 — Error Handling

> Every error has a name, a severity, and a user-visible template.
> Errors never leak stack traces, provider names, or another user's IDs.
>
> **Contract:** [blueprint/07/design-system/08-error-handling.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/08-error-handling.md).
> **Up:** [01-overview](01-overview.md).

---

## Three severity levels

| Level | Example | User-visible? | Action |
|---|---|---|---|
| `internal` | Uncaught exception in middleware | No (generic message) | DANGER toast *"Something went wrong, try again"*; log + alert SRE. |
| `user` | Invalid input, insufficient Stars | Yes (templated) | Inline DANGER ephemeral; keep user on current page. |
| `platform` | Bot suspended, LLM all providers down | Yes (templated + CTA) | Friendly explanation with recovery CTA. |

The error handler reads `err.severity`; if missing, defaults to
`internal`.

## Named errors

```typescript
// packages/telefocus/src/errors.ts
export type Severity = 'internal' | 'user' | 'platform';

export class DopellerError extends Error {
  constructor(
    public readonly code: string,                 // "insufficient_stars"
    public readonly severity: Severity,
    message: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DopellerError';
  }
}
```

Every subsystem throws typed errors. Canonical catalogue:

| Code | Severity | Source |
|---|---|---|
| `insufficient_stars` | `user` | Billing |
| `invalid_input` | `user` | Input-flow validator |
| `unknown_page` | `user` | Router |
| `tool_timeout` | `platform` | LLM Gateway / tool runtime |
| `token_revoked` | `platform` | Webhook gateway |
| `provider_all_down` | `platform` | LLM Gateway circuit breakers |
| `bot_suspended` | `platform` | Bot-status gate |
| `content_blocked` | `platform` | Safety (Wave 6) |
| `internal_db_unavailable` | `internal` | Persistence layer |
| `internal_redis_unavailable` | `internal` | Session store |

## User-visible templates

Templates are keyed by code, translated through the i18n middleware
(see [10-middleware](10-middleware.md) — language enforcement).

```typescript
// packages/telefocus/src/errors/templates.ts
export interface ErrorTemplate {
  title: string;                                  // HTML, bold-ready
  body: string;                                   // {placeholders}
  cta?: { label: string; callback: string };
  subtype?: 'WARNING' | 'DANGER';                 // default DANGER
}

export const templates: Record<string, ErrorTemplate> = {
  insufficient_stars: {
    title: 'Not enough Stars',
    body:  'You need {need} Stars; you have {have}.',
    cta:   { label: '⭐ Buy Stars', callback: 'nav:/billing/top-up' },
  },
  invalid_input: {
    title: 'Check that again',
    body:  '{rule_error}',
    cta:   { label: '← Back', callback: 'nav:back' },
  },
  provider_all_down: {
    title: "We're catching our breath",
    body:  "All AI providers are slow right now. Please try again in a minute.",
    cta:   { label: '🔄 Retry', callback: 'action:retry:last' },
    subtype: 'WARNING',
  },
  bot_suspended: {
    title: 'This bot is paused',
    body:  'Reason: {reason}.\nContact support if you think this is wrong.',
    cta:   { label: '📨 Contact Support', callback: 'nav:/support' },
  },
  tool_timeout: {
    title: 'That took too long',
    body:  'The {tool} tool timed out. Retry, or cancel.',
    cta:   { label: '🔄 Retry', callback: 'action:retry:last' },
    subtype: 'WARNING',
  },
  content_blocked: {
    title: "I can't go there",
    body:  '{refusal_reason}',
  },
};
```

Placeholder substitution:

```typescript
// packages/telefocus/src/errors/render.ts
export function renderTemplate(tpl: ErrorTemplate, vars: Record<string, string>) {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return { title: fill(tpl.title), body: fill(tpl.body), cta: tpl.cta };
}
```

## Global error boundary

The first middleware wraps the chain:

```typescript
// packages/telefocus/src/middleware/error-boundary.ts
export const errorBoundary = async (ctx: Ctx, next: NextFn) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof DopellerError) return handleTyped(ctx, err);
    await handleInternal(ctx, err as Error);
  }
};

async function handleTyped(ctx: Ctx, err: DopellerError) {
  const tpl = templates[err.code];
  if (!tpl) return handleInternal(ctx, err);
  const { title, body, cta } = renderTemplate(tpl, err.metadata as Record<string, string> ?? {});
  await send(ctx, `<b>${title}</b>\n${body}`, {
    type: 'EPHEMERAL',
    subtype: tpl.subtype ?? 'DANGER',
    parseMode: 'HTML',
    ttlMs: err.severity === 'platform' ? 20_000 : 10_000,
    replyMarkup: cta ? { inline_keyboard: [[{ text: cta.label, callback_data: cta.callback }]] } : undefined,
  });
  logger.info('error.handled', { code: err.code, severity: err.severity, meta: err.metadata });
}

async function handleInternal(ctx: Ctx, err: Error) {
  logger.error('error.internal', { message: err.message, stack: err.stack, update_id: ctx.update?.update_id });
  analytics.emit('error.raised', { severity: 'internal', code: 'unknown' });
  await toast.danger(ctx, 'Something went wrong. Try again in a moment.');
  // never leak err.stack to the user
}
```

## Telegram-layer errors

Caught in a dedicated Telegram adapter so handlers never see them
directly:

| Telegram error | Class | Policy |
|---|---|---|
| `400: message to edit not found` | recoverable | Send fresh menu, update ID, retry. |
| `400: query is too old` | recoverable | Answer callback silently; re-render. |
| `403: bot was blocked by the user` | terminal | Mark user blocked, stop trying; retain in DB for compliance. |
| `429: Too Many Requests` | retryable | Back off per `retry_after` header, then retry. |
| `5xx` | transient | Retry with exponential backoff; WARNING toast if persistent. |

## LLM + tool errors

The LLM Gateway's circuit breakers + fallback chain mean most
provider-specific errors never reach TeleFocus. What can reach us:

- `provider_all_down` → `provider_all_down` template.
- `tool_timeout` → WARNING toast with retry.
- `content_blocked` → refusal template (see roleplay refusal styles).

## Navigation errors

| Scenario | Policy |
|---|---|
| Unknown page | Nav to `/`, DANGER toast *"Couldn't find that — going home"*. |
| Broken `callback_data` | Log, DANGER toast *"Old button. Refreshing menu…"*, re-render current page. |
| Stale callback query (> 60 s) | Answer callback silently; no re-render. |

## Redaction rules

User-visible error text **never** contains:

- Stack traces.
- Internal user IDs other than the current user's.
- Provider names (`OpenAI`, `Anthropic`, `Google`) — use generic "AI provider".
- Bot tokens, `initData`, or Redis keys.
- Postgres error messages (wrap as `internal_db_unavailable`).

The logger sink regex-redacts anything matching bot-token / initData
patterns before shipping logs.

## Success criteria

- [ ] No uncaught exception ever reaches the Telegram client.
- [ ] User-visible errors never leak stack traces, other users' IDs, or provider names.
- [ ] Internal errors always produce an SRE alert with full context.
- [ ] Recoverable errors never require user action to recover.
