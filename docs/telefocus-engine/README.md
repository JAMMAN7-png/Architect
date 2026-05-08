# TeleFocus Engine

Implementation-level docs for the TeleFocus runtime — the "SPA in a Telegram chat" engine that powers every Dopeller bot.

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/](../blueprint/05-wave-2-core-engines/telefocus-engine/) — each file below is the implementation-detail counterpart of the identically-numbered blueprint chapter.

## Files

| # | Topic | Blueprint chapter |
|---|---|---|
| [01-spa-model.md](01-spa-model.md) | SPA-in-chat model & invariants | [01](../blueprint/05-wave-2-core-engines/telefocus-engine/01-spa-model.md) |
| [02-session-state.md](02-session-state.md) | Redis session schema, loader/writer code | [02](../blueprint/05-wave-2-core-engines/telefocus-engine/02-session-state.md) |
| [03-message-lifecycle.md](03-message-lifecycle.md) | Tracked-message send/edit/delete pipeline | [03](../blueprint/05-wave-2-core-engines/telefocus-engine/03-message-lifecycle.md) |
| [04-replace-previous.md](04-replace-previous.md) | `replacePrevious` algorithm, locks, edge cases | [04](../blueprint/05-wave-2-core-engines/telefocus-engine/04-replace-previous.md) |
| [05-middleware-pipeline.md](05-middleware-pipeline.md) | Middleware signatures, order, short-circuit rules | [05](../blueprint/05-wave-2-core-engines/telefocus-engine/05-middleware-pipeline.md) |
| [06-input-flows.md](06-input-flows.md) | Input-flow engine, validation, recovery | [06](../blueprint/05-wave-2-core-engines/telefocus-engine/06-input-flows.md) |
| [07-navigation.md](07-navigation.md) | Page registry, router, deep links, pinned mood | [07](../blueprint/05-wave-2-core-engines/telefocus-engine/07-navigation.md) |
| [08-toasts-modals.md](08-toasts-modals.md) | Toast API, modal promise resolution | [08](../blueprint/05-wave-2-core-engines/telefocus-engine/08-toasts-modals.md) |
| [09-error-handling.md](09-error-handling.md) | Error classes, retry, recovery code | [09](../blueprint/05-wave-2-core-engines/telefocus-engine/09-error-handling.md) |
| [10-developer-api.md](10-developer-api.md) | `DopellerCtx`, helpers, test harness | [10](../blueprint/05-wave-2-core-engines/telefocus-engine/10-developer-api.md) |

## Scope

These docs describe the **runtime** — what the engine code does at request time. The blueprint chapters explain *why* each choice exists; these docs specify *how* to implement them (TypeScript signatures, Redis keys, event shapes, Lua scripts, exact error codes).

If a detail is load-bearing at the commit level (e.g. a function signature, a middleware name, a Redis key shape), it lives here. If it is load-bearing at the design level (e.g. why memory-recall runs before persona-inject), it lives in the blueprint chapter.

## Stack

- **Language:** TypeScript (strict)
- **Runtime:** Bun 1.2+
- **Bot framework:** grammY 1.x
- **State:** Redis 7 (ioredis client)
- **Queues:** BullMQ 5 (for delayed UI, input-flow timeouts)
- **Observability:** OpenTelemetry + Rybbit events

## Package layout

```
packages/telefocus/
├── src/
│   ├── engine/              # Core runtime
│   ├── middleware/          # Stage 1–23 middleware
│   ├── pages/               # Page registry primitives
│   ├── lifecycle/           # Message lifecycle manager
│   ├── flow/                # Input-flow engine
│   ├── nav/                 # Navigation router
│   ├── toast/ + modal/      # UX primitives
│   ├── errors/              # Error classes, codes
│   └── testing/             # Test harness
└── package.json             # @dopeller/telefocus
```

Creator-facing bot SDK (Wave 4) wraps this package; see [../../blueprint/07-wave-4-creator-and-user-experience/](../blueprint/07-wave-4-creator-and-user-experience/).
