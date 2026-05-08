# 01 — Overview

> TeleFocus is Dopeller's SPA-for-Telegram framework. Every bot on the
> platform feels like a native mobile app inside chat: one menu message,
> in-place navigation, tracked lifecycle, auto-cleaned residue.
>
> **Contract:** [blueprint/07/design-system/01-overview.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/01-overview.md).
> **Siblings:** [02-session](02-session.md) … [11-file-structure](11-file-structure.md).

---

## Identity

| Field | Value |
|---|---|
| Name | **TeleFocus Engine** |
| Stack | TypeScript, grammY, Redis, Bun runtime |
| Package | `@dopeller/telefocus` |
| Scope | Reusable framework — **not** a bot |
| Philosophy | *One menu. Zero clutter. Every message tracked, scoped, lifecycle-managed.* |

## Mental model

A Telegram chat is a **canvas**, not a transcript. The bot maintains a
single active screen (**the Menu Message**) and edits it in place.
Everything else — toasts, modals, input prompts — is scoped to the
current page and cleaned up on navigation.

| Web SPA concept | TeleFocus equivalent |
|---|---|
| `<Router>` | Page tree with nested routes |
| Current URL | `session.menu.currentPage`, e.g. `/personas/create` |
| Rendered page | The single **Menu Message** (edited on nav) |
| Toasts / snackbars | **Ephemeral messages** (`INFO` / `WARNING` / `DANGER`), TTL'd |
| Modals / dialogs | **Interactive messages** scoped to current page |
| Form inputs | **Input flows** — sequential prompt + capture cycle |
| "Unsaved changes?" | **Navigation guards** — confirm before leaving |
| Page unmount | **Scope cleanup** — all non-MENU in-scope messages deleted |

After navigation, the chat contains exactly one thing: the Menu Message,
re-rendered for the new page.

## Architecture layers

```
┌──────────────────────────────────────────────────────────┐
│                    grammY Bot Instance                    │
├──────────────────────────────────────────────────────────┤
│                 Middleware Pipeline (ordered)             │
│   Session → Context Guard → Input Capture → Nav Router    │
├──────────────────────────────────────────────────────────┤
│                      Core Managers                        │
│   Menu · Message-Lifecycle · Input-Flow · Page-Registry   │
├──────────────────────────────────────────────────────────┤
│                   State Layer (Redis)                     │
│   Session: menu, messages, input-flow, nav, pageData      │
└──────────────────────────────────────────────────────────┘
```

Each box is specified in a sibling file:

| Concern | File |
|---|---|
| State schema | [02-session](02-session.md) |
| Menu render + navigation | [03-menu](03-menu.md) |
| Message lifecycle + typing | [04-messages](04-messages.md) |
| Input-flow engine | [05-input-flows](05-input-flows.md) |
| Navigation + breadcrumbs + guards | [06-navigation](06-navigation.md) |
| Toasts + modals | [07-toasts-modals](07-toasts-modals.md) |
| Error handling | [08-error-handling](08-error-handling.md) |
| Developer API | [09-developer-api](09-developer-api.md) |
| Middleware pipeline | [10-middleware](10-middleware.md) |
| File structure | [11-file-structure](11-file-structure.md) |

## Everything is tracked

The single most important invariant:

> Every message the bot sends is **registered** with a message ID,
> **scoped** to a page path, **typed** (`MENU` / `EPHEMERAL` /
> `INTERACTIVE` / `INPUT_PROMPT` / `INPUT_PROGRESS`), and
> **lifecycle-aware** (created at, optional TTL, deletion condition).

If it isn't tracked, it doesn't exist in this framework. Handlers that
call `ctx.api.sendMessage` directly break the invariant and are
rejected in code review (enforced by ESLint rule
`telefocus/no-raw-send`).

## Guarantees

- **One menu message** per (bot, user) chat.
- **All bot messages tracked** (type, scope, lifecycle).
- **Navigation cleans up** all non-MENU messages scoped to the leaving page.
- **Input flows are guarded** — stray text is warned, not crashed.
- **Navigation guards** prevent data loss on unsaved work.
- **Stale buttons** produce a friendly error, never a stack trace.
- **Toasts replace previous** — no stacking per subtype per scope.
- **TTL messages auto-delete** actively (BullMQ sweep) + lazily (on next update).
- **User replies captured and deleted** for forceReply input flows.
- **Errors recover gracefully** — failed edits re-send; failed deletes are forgiven.
- **Framework is reusable** — consumers register pages without touching engine core.

## What TeleFocus is not

- **Not a bot.** It's the chassis. Persona Builder, Creator Studio, Soul Quiz are all *consumers*.
- **Not a UI kit.** It ships primitives (pages, menus, toasts, input flows), not components. Components live in consumers and in `packages/ui-kit` (for Mini Apps).
- **Not opinionated about persona.** Persona engine, memory, LLM Gateway are separate subsystems.

## Relationship to other waves

| Wave | Role |
|---|---|
| **Wave 2** | Ships TeleFocus itself. |
| **Wave 4** (this wave) | Consumes TeleFocus to build creator + user surfaces. |
| **Wave 5** | Wires gamification, i18n, heartbeat into the middleware pipeline. |
| **Wave 6** | Layers safety (refusals, abuse notices) into toasts + modals. |

## Success criteria

- [ ] A new page can be defined in < 50 lines and registered without touching engine core.
- [ ] Navigating between any two pages leaves exactly one menu message in chat.
- [ ] 100% of bot messages tracked in session state (verified by lint + runtime assertion in dev).
- [ ] Input flows handle out-of-context text without crashing or losing flow state.
