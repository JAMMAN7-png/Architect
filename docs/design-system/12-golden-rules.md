# 12 — Golden Rules

> Four cardinal rules every TeleFocus-built bot MUST honour. Each rule
> has a single source of truth in the engine; violations are bugs, not
> design choices.
>
> **Up:** [README](README.md).
> **Siblings:** [03-menu](03-menu.md), [04-messages](04-messages.md), [05-input-flows](05-input-flows.md), [07-toasts-modals](07-toasts-modals.md), [08-error-handling](08-error-handling.md).

---

## 1. Menu reflects state

Every outbound message — toast, modal, input prompt — MUST be reflected
in the main menu. While `session.inputFlow.active === true` or
`session.activeModal !== null`, the menu renders a **locked body** with a
single `× Cancel` button. Page-level keyboards are NOT shown until the
flow completes or the modal resolves; orphan keyboards under a locked
menu are a bug.

### Why

A user looking at the menu must know what the bot is waiting for. If the
menu still shows the page's normal buttons while a flow waits for input,
the user can fire a navigation that races with their reply, breaking
both. The locked body forces a single resolution path.

### Enforcement

`src/interface/telegram/engine/renderer/menu-renderer.ts` — the
locked-body branch is selected whenever flow or modal state is active.
See also [03-menu.md](03-menu.md) §Menu reflects state.

## 2. Ephemerals vanish

Every `EPHEMERAL` subtype carries a default TTL: `INFO=3000ms`,
`WARNING=5000ms`, `DANGER=10000ms`. The engine schedules
`setTimeout(deleteMessage, expiresAt - now)` at send time and persists
the eviction (`sessionDirty = true`) after the message is gone.
`INTERACTIVE`, `MODAL`, `MENU`, `INPUT_PROMPT`, and `INPUT_PROGRESS`
carry no TTL; they are dismissed by user action or scope cleanup.

### Why

Persistent toasts pollute chat history and confuse the user about which
message is "live". Auto-eviction guarantees the chat returns to a clean
state without a manual sweep. Long-running ephemerals are almost always
a sign that an ephemeral was misused for state that belongs in the menu.

### Enforcement

`src/interface/telegram/engine/messages/send.ts` — schedules and
cancels TTL timers via a module-level
`Map<chatId:messageId, Timeout>`; `cancelTtlTimer` is the explicit
cancellation hatch. See [04-messages.md](04-messages.md) §TTL discipline.

## 3. Errors stay inline

Validation errors raised by an input-flow validator are inlined into the
existing prompt (`errorMessage + "\n\n" + step.prompt`) — never surfaced
as a toast that closes the flow. The user's invalid reply is deleted
best-effort; the flow stays active and waits for another reply. Toasts
are reserved for non-recoverable platform / internal errors.

### Why

If a validation failure cancelled the flow, every typo would force the
user to restart from step zero. Editing the prompt in place keeps the
user in context, names the offending field, and tells them what's
allowed — without burning their progress.

### Enforcement

`src/interface/telegram/engine/flow/engine.ts` — the `capture` path on
validation rejection edits the prompt, deletes the user's reply, and
returns `"rejected"` while keeping `session.inputFlow.active === true`.
See [05-input-flows.md](05-input-flows.md) §Validation never closes the
flow and [08-error-handling.md](08-error-handling.md) §Validation error
UX.

## 4. callback_data ≤ 64 bytes

Every `callback_data` string MUST be ≤ 64 UTF-8 bytes. Slug-bearing
actions (anything that interpolates user content, IDs, or settings keys)
MUST emit indexed callbacks via `indexedSettingsCallback(verb, key, idx)`
or call `assertCallbackData(str)` for hand-built strings. Multi-byte
characters cost more than one byte each; budget accordingly.

### Why

`BUTTON_DATA_INVALID` fails the entire `editMessageText` call. A single
oversized button takes the whole menu render down — the user sees a
broken page and the bot looks dead. Indexed callbacks decouple
callback length from content length.

### Enforcement

`src/interface/telegram/engine/keyboards/callback-data.ts` —
`indexedSettingsCallback` and `assertCallbackData` are the only
sanctioned ways to construct slug-bearing callbacks. See
[04-messages.md](04-messages.md) §64-byte callback_data invariant.

## 5. Custom emoji belongs in bodies, not buttons

Telegram only parses HTML in **message bodies**. Inline-keyboard `text` fields are plain text, so `<tg-emoji>` does NOT render there. Use `ce(intent)` in `render()` bodies and modal/toast titles; use `ceText(intent)` (or static glyphs) in `keyboard()` rows.

### Why

A `<tg-emoji>` tag inside a button label renders as raw text (`<tg-emoji emoji-id=…`), which both leaks implementation and breaks the 64-byte cap.

### Enforcement

`src/interface/telegram/engine/messages/custom-emoji.ts` exposes `ce()` and `ceText()` separately so the right shape is unambiguous at every call site. Pages that need a glyph in a button MUST use `ceText` (or a static literal).
