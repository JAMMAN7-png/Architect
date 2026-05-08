# Design System — TeleFocus Engine

> **TeleFocus** is Dopeller's Single Page Application framework for Telegram.
> One menu. Zero clutter. Every message is tracked, scoped, and
> lifecycle-managed.

This folder specifies the engine's shape — mental model, session schema,
renderer, input flows, navigation, toasts, errors, developer API,
middleware pipeline, and file layout. Each file is a concrete, typed
contract that a framework implementor can build against.

**Upstream:** [blueprint contract](../blueprint/07-wave-4-creator-and-user-experience/design-system/).
**Downstream:** every Dopeller bot app (`apps/manager-bot`, Mini Apps,
Creator Studio) consumes this API.

## Files

| # | File | Topic |
|---|---|---|
| 01 | [overview](01-overview.md) | Identity, philosophy, mental model |
| 02 | [session](02-session.md) | Redis schema, TTL, concurrency |
| 03 | [menu](03-menu.md) | Page definition, render pipeline, idempotency |
| 04 | [messages](04-messages.md) | Five message types, typed send API |
| 05 | [input-flows](05-input-flows.md) | Sequential state machine for forms |
| 06 | [navigation](06-navigation.md) | Router, breadcrumbs, guards, deep links |
| 07 | [toasts-modals](07-toasts-modals.md) | Transient UI — `toast.*`, `modal.*` |
| 08 | [error-handling](08-error-handling.md) | Severities, named errors, templates |
| 09 | [developer-api](09-developer-api.md) | Pages, actions, commands, services |
| 10 | [middleware](10-middleware.md) | Ordered update pipeline |
| 11 | [file-structure](11-file-structure.md) | Monorepo layout, conventions |

## Reading order

Start with [01-overview](01-overview.md) for the mental model. Then read
[02-session](02-session.md) and [04-messages](04-messages.md) to ground
the state model. The rest can be read in any order — each file is
independent once those two are understood.

## Invariants

1. **One menu message** per (bot, user) at all times.
2. **No handler** calls `ctx.api.sendMessage` directly — use
   `send` / `toast.*` / `modal.*`.
3. **Every outgoing message** is tracked, typed, and scoped.
4. **Navigation cleans up** all non-MENU messages scoped to the leaving page.
5. **Session writes** are version-guarded — concurrent writes cannot
   corrupt state.

## Package

Engine ships as `@dopeller/telefocus` from `packages/telefocus/`. See
[11-file-structure](11-file-structure.md).
