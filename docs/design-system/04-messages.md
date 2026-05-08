# 04 — Message Lifecycle

> Every message the bot sends is one of five types. Each has rules for
> creation, scope, TTL, and cleanup. Handlers never call raw
> `ctx.api.sendMessage` — they go through the typed `send` API.
>
> **Contract:** [blueprint/07/design-system/04-messages.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/04-messages.md).
> **Up:** [01-overview](01-overview.md).

---

## The five types

| Type | Subtype | Persists? | Scope | Cleanup trigger |
|---|---|---|---|---|
| `MENU` | — | One per chat | Global | Never auto; re-rendered |
| `EPHEMERAL` | `INFO` / `WARNING` / `DANGER` | No | Page | TTL (default 3 / 5 / 10 s) |
| `INTERACTIVE` | `CONFIRMATION` / `MODAL` | Until dismissed | Page | Dismiss or nav |
| `INPUT_PROMPT` | — | Until answered or cancelled | Page | Answer or cancel |
| `INPUT_PROGRESS` | — | Short-lived | Page | Flow advance |

Any bot message outside these types is a bug (lint + runtime assertion).

## Typed send API

```typescript
// packages/telefocus/src/messages/send.ts
import type { InlineKeyboardMarkup } from 'grammy/types';

export interface SendOptions {
  type: 'EPHEMERAL' | 'INTERACTIVE' | 'INPUT_PROMPT' | 'INPUT_PROGRESS';
  subtype?: 'INFO' | 'WARNING' | 'DANGER' | 'CONFIRMATION' | 'MODAL';
  scope?: string;                  // page path; defaults to session.menu.currentPage
  ttlMs?: number;                  // override default
  parseMode?: 'HTML' | 'MarkdownV2';
  replyMarkup?: InlineKeyboardMarkup;
  replacePrevious?: boolean;       // edit existing same-type+subtype in scope
  metadata?: Record<string, unknown>;
}

export async function send(
  ctx: Ctx,
  text: string,
  opts: SendOptions,
): Promise<TrackedMessage> {
  // 1. If replacePrevious: find prior match in scope → editMessageText.
  // 2. Otherwise: ctx.api.sendMessage, capture message_id.
  // 3. Write TrackedMessage into session.messages[scope].
  // 4. If ttlMs: set expiresAt = now + ttlMs.
  // 5. Return the TrackedMessage.
}
```

## Default TTLs

| Subtype | Default TTL | Icon (auto-prepended) |
|---|---|---|
| `INFO` | 3 000 ms | ✅ |
| `WARNING` | 5 000 ms | ⚠️ |
| `DANGER` | 10 000 ms | ❌ |

Override per call:

```typescript
await send(ctx, 'Processing your refund…', {
  type: 'EPHEMERAL',
  subtype: 'WARNING',
  ttlMs: 15_000,
});
```

## Ephemerals — one per subtype per scope

Sending a new `INFO` while one exists **edits** the existing one instead
of stacking. Enforced through `replacePrevious` (default `true` for
`EPHEMERAL`):

```typescript
// Both calls produce exactly one visible INFO message:
await toast.info(ctx, 'Saved.');
await toast.info(ctx, 'Saved again.');  // edits the first in place
```

## Interactive — confirmation & modal

Used for decisions that must block navigation:

```typescript
await send(ctx, 'Are you sure you want to delete this agent?', {
  type: 'INTERACTIVE',
  subtype: 'CONFIRMATION',
  parseMode: 'HTML',
  replyMarkup: {
    inline_keyboard: [
      [{ text: '🗑 Delete', callback_data: 'action:bot:delete-confirm' }],
      [{ text: '← Cancel', callback_data: 'action:modal:cancel' }],
    ],
  },
});
```

If the user navigates away without acting, scope cleanup removes the
message and it's treated as cancelled.

## Input prompts & progress

The input-flow engine owns these. See [05-input-flows](05-input-flows.md).

- **`INPUT_PROMPT`** — the question ("Enter your agent's name"), usually
  with `force_reply: true` and `input_field_placeholder`.
- **`INPUT_PROGRESS`** — a running summary rendered *above* the prompt:
  `Step 2 of 4 · Name ✓ · Tone ✓`.

Both are re-used (edited) across steps rather than re-sent.

## `replacePrevious` helper

```typescript
// packages/telefocus/src/messages/send.ts
export async function replacePrevious(
  ctx: Ctx,
  text: string,
  opts: SendOptions,
): Promise<TrackedMessage> {
  const scope = opts.scope ?? ctx.session.menu.currentPage;
  const prior = (ctx.session.messages[scope] ?? []).find(
    (m) => m.type === opts.type && m.subtype === opts.subtype,
  );
  if (prior) {
    await ctx.api.editMessageText(ctx.chatId, prior.messageId, text, {
      parse_mode: opts.parseMode ?? 'HTML',
      reply_markup: opts.replyMarkup,
    });
    return prior;
  }
  return send(ctx, text, opts);
}
```

This is how toasts stay at one-per-subtype and how "Daily analytics"
cards stay at one-per-day.

## Scope cleanup

When navigation fires `onExit('/creator/pricing')`:

```typescript
// packages/telefocus/src/messages/tracking.ts
export async function cleanupScope(ctx: Ctx, scope: string): Promise<void> {
  const list = ctx.session.messages[scope] ?? [];
  for (const m of list) {
    if (m.type === 'MENU') continue;
    try {
      await ctx.api.deleteMessage(ctx.chatId, m.messageId);
    } catch {
      // forgiven: user may have deleted it manually
    }
  }
  delete ctx.session.messages[scope];
}
```

The menu is **edited** to the new page, never deleted.

## Failure modes

| Failure | Policy |
|---|---|
| `sendMessage` fails | Log, bubble to caller. Ephemerals are absorbed silently (a failed toast is not a crisis). |
| `editMessageText` — `message not found` | Send a fresh message, update tracked ID, retry. |
| `editMessageText` — other errors | Surface as a DANGER ephemeral via the error boundary. |
| `deleteMessage` fails | Forgiven. Session entry removed either way — no retry. |

## Parse mode

Default `HTML`. Rationale:

- Custom emojis (`<tg-emoji emoji_id="...">🟢</tg-emoji>`) require HTML.
- Escaping is clearer than MarkdownV2's backslash rules.
- Sanitisation is a single well-tested function:

```typescript
// packages/telefocus/src/messages/sanitise.ts
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => MAP[c]);
```

Always wrap user-authored strings:

```typescript
await toast.info(ctx, `Renamed to ${escapeHtml(newName)}.`);
```

MarkdownV2 is used only for verbatim user-quoted content where
preserving original formatting matters.

## Custom emoji entities

Telegram supports per-message custom emoji via the `<tg-emoji emoji-id="…">fallback</tg-emoji>` HTML span (parse_mode: "HTML"). The engine wraps this in a typed registry:

- `EmojiIntent` enumerates eleven UX intents (success, error, warning, info, primary, destructive, edit, continue, modal-lock, flow-lock, loading).
- `ce(intent)` returns trusted HTML. Compose with `escapeHtml(userInput)` for user-controlled fragments.
- `ceText(intent)` returns the bare fallback glyph. Use it in **inline-keyboard button labels** (Telegram does not parse HTML there).
- IDs are configured via `TG_CUSTOM_EMOJI_<INTENT>` env vars. Empty / missing → fallback-only render (non-Premium look).
- The bot must hold the Premium-emoji entitlement for the chosen emoji set; otherwise Telegram falls back to the literal glyph for non-Premium recipients.

### Allowlist

`safeBodyHtml(s)` enforces only Telegram-supported tags (`b, i, u, s, code, pre, a, br, tg-emoji`). Use it as a guard at the send boundary when composing trusted fragments.

### Buttons stay plain

Button labels MUST be plain text + static glyphs only. Custom emojis only render in message bodies.

## TTL discipline (auto-vanish)

Every `EPHEMERAL` subtype has a non-negotiable default TTL. Auto-eviction
is scheduled inside `messages/send.ts` at write time; the timer ID lives
in a module-level `Map<chatId:messageId, Timeout>` so a single tracked
message has at most one in-flight timer.

| Subtype | Default TTL | Why |
|---|---|---|
| `INFO` | 3 000 ms | Acknowledgement, low cognitive load |
| `WARNING` | 5 000 ms | Reader needs a beat to absorb |
| `DANGER` | 10 000 ms | Failure must register; user may need to act |

Rules:

- `INTERACTIVE`, `MODAL`, `MENU`, `INPUT_PROMPT`, `INPUT_PROGRESS` carry **no** TTL — they are dismissed by user action or scope cleanup.
- After deletion the tracked-message entry is removed and `sessionDirty = true` (so the eviction persists across crashes).
- Replacing an existing tracked message via `replacePrevious` reschedules the timer to the new TTL; the old timer is cancelled.
- Callers that need to cancel the timer explicitly (e.g. promote an INFO into a permanent banner) MUST call `cancelTtlTimer(chatId, messageId)`; never reach into the `Map` directly.
- Cardinal rule summary: [12-golden-rules.md](12-golden-rules.md) §2.

## 64-byte callback_data invariant

Telegram caps `callback_data` at **64 UTF-8 bytes**. Exceeding the limit
returns `BUTTON_DATA_INVALID`, which fails the entire `editMessageText`
call and breaks the menu render — a single bad button takes the whole
page down.

Slug-bearing actions (anything that interpolates user content, IDs, or
settings keys into the callback string) MUST be emitted via:

- `indexedSettingsCallback(verb, key, idx)` — replaces the slug with a stable index into the keyboard payload.
- `assertCallbackData(str)` — runtime guard for hand-built callback strings; throws if the encoded length exceeds 64 bytes.

Multi-byte characters (emojis, non-ASCII labels) cost more than one byte
each; budget accordingly. Cardinal rule summary:
[12-golden-rules.md](12-golden-rules.md) §4.

## Success criteria

- [ ] No handler calls `ctx.api.sendMessage` directly (ESLint rule `telefocus/no-raw-send`).
- [ ] All ephemerals auto-delete by TTL or on page exit.
- [ ] `replacePrevious` always edits rather than duplicates when a prior in-scope match exists.
- [ ] HTML escaping applied to every user-provided string rendered in messages.
