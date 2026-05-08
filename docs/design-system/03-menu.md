# 03 — Menu Renderer

> The Menu Message is the single canvas every user interacts with. A
> page definition maps to a rendered Telegram message; navigation edits
> that message in place.
>
> **Contract:** [blueprint/07/design-system/03-menu.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/03-menu.md).
> **Up:** [01-overview](01-overview.md).
> **Siblings:** [04-messages](04-messages.md), [06-navigation](06-navigation.md).

---

## Menu reflects state (golden rule)

Every outbound message — toast, modal, input prompt — MUST be reflected
in the main menu. The menu renderer paints a **locked body** with a
single `× Cancel` button whenever `session.inputFlow.active === true` or
`session.activeModal !== null`. The page's normal keyboard is NOT shown
while a flow or modal is in flight; the page is non-interactable until
the flow completes or the modal resolves.

- Locked-body branch lives in `src/interface/telegram/engine/renderer/menu-renderer.ts`.
- Modal lock state: see [07-toasts-modals.md](07-toasts-modals.md) §Modals lock the menu.
- Cardinal rule summary: [12-golden-rules.md](12-golden-rules.md) §1.

## /start protocol

Every `/start` MUST tear down ambient UI before navigating:

1. Cancel any active input flow (`engine.cancel(ctx)`).
2. Dismiss any active modal (clear `session.activeModal`, delete the modal message).
3. `MenuRenderer.forceFresh(ctx)` — deletes the tracked menu and clears the renderer's idempotency cache.
4. Delete the user's `/start` message (best-effort).
5. Call `navigateTo(ctx, start_target)` to render a fresh menu at chat bottom.

The result: a clean, freshly-rendered menu at the bottom of the chat,
regardless of where the user was before.

## Button palette

Every interactive button has a leading emoji from the canonical palette.
Colour discipline is enforced by the lint rule on button configs.

| Intent | Leading emoji | Example label |
|---|---|---|
| Enabled / on / selected (multi-pick) | 🟢 | `🟢 Notifications` |
| Approve / save / success | 🟢 ✅ | `✅ Save`, `🟢 Confirm` |
| Disabled / off | ⚪ | `⚪ Notifications` |
| Current selection (single-pick) | ⭐ | `⭐ Casual` |
| Non-selected single-pick row | ▫ | `▫ Formal` |
| Continue / resume / forward | 🟡 ▶ | `🟡 ▶ Continue` |
| Revise | 🟡 🔁 | `🟡 🔁 Revise` |
| Destructive (reset / delete / reject) | 🛑 | `🛑 Reset` |
| Delete | 🗑 | `🗑 Delete agent` |
| Edit | ✏ | `✏ Edit name` |
| Back / cancel | ⬅️ | `⬅️ Back` |
| Dismiss | ✕ | `✕ Cancel` |

🔴 is reserved for destructive **state** indicators (e.g. "🔴 Bot suspended"); it MUST NOT be used as an "enabled" prefix — use 🟢 for that.

## Invariant

Exactly **one** Menu Message per (bot, user) chat. Its `messageId` lives
in `session.menu.messageId`. Every navigation is an `editMessageText` on
that ID. A new message is only sent when:

1. Session is brand-new (no prior ID).
2. Prior ID is stale (user deleted, or Telegram returns
   `message to edit not found`).
3. Telegram can no longer edit it (rare; > 48 h since send).

## Staleness and freshness

The Menu Message can scroll out of view if the user (or the bot) sends
enough chat noise after the last render. To keep the menu reachable
without forcing the user to scroll up, the renderer tracks a
**staleness counter** on `session.menu.staleness`:

- Incremented on every fresh non-MENU send through the typed `send`
  layer (toasts, modals, prompts) and on every successful capture of
  user-supplied input inside an active flow.
- Edit-replace branches do **not** count — editing in place doesn't
  push the menu off-screen.
- `INPUT_PROGRESS` sends are excluded; they always replace-previous
  after the first step and would otherwise double-count progress
  churn.
- When the counter reaches **3**, the next `renderMenu` call deletes
  the tracked menu (`forceFresh`) before rendering, so the new menu
  lands as the latest message at the chat bottom.
- The counter is reset to `0` on every successful render
  (fresh send, edit success, or cache-hit short-circuit) and on
  explicit `forceFresh` calls.

Older sessions persisted before this counter existed read it as
`undefined`; the renderer treats that as `0` (`?? 0`). The first
successful render after the upgrade writes `0` to the session.

## Page definition

```typescript
// packages/telefocus/src/registry/types.ts
import type { InlineKeyboardButton } from 'grammy/types';

export interface PageDefinition {
  path: string;                                            // "/creator/pricing"
  parent: string | null;                                   // for Back
  render(session: UserSession): MenuBody | Promise<MenuBody>;
  keyboard(session: UserSession): InlineKeyboardButton[][] | Promise<InlineKeyboardButton[][]>;
  inputFlow?: InputFlowDefinition;
  hasUnsavedWork?(session: UserSession): boolean;          // nav-guard hook
  onEnter?(session: UserSession): Promise<void>;
  onExit?(session: UserSession): Promise<void>;
}

export interface MenuBody {
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
}
```

## Minimal page — welcome screen

```typescript
// apps/manager-bot/src/pages/creator/welcome.ts
import type { PageDefinition } from '@dopeller/telefocus';

export const creatorWelcomePage: PageDefinition = {
  path: '/creator/welcome',
  parent: '/',
  render: () => ({
    text:
      `🎭 <b>Welcome to Dopeller Creator Studio</b>\n\n` +
      `Create your own AI agent in minutes.`,
    parseMode: 'HTML',
  }),
  keyboard: () => [
    [{ text: '🚀 Create Your First Agent', callback_data: 'nav:/creator/forge' }],
    [{ text: '📚 How It Works',            callback_data: 'nav:/creator/how-it-works' }],
  ],
};
```

## Render pipeline

The sequence when a user clicks `callback_data: nav:/creator/forge`:

```
1. Navigation router receives callback, extracts "/creator/forge"
2. registry.get('/creator/forge')            → PageDefinition
3. prev.onExit?.(session)
4. target.onEnter?.(session)
5. cleanupScope(ctx, prevPath)                → deletes non-MENU in-scope
6. {text, parseMode}   = await target.render(session)
7. reply_markup        = await target.keyboard(session)
8. ctx.api.editMessageText(chatId, menu.messageId, text, {
     parse_mode, reply_markup
   })
9. session.menu.{currentPage,previousPage,navigationStack} ← updated
10. On failure (message not found): send fresh, update messageId, retry.
```

## Renderer API

```typescript
// packages/telefocus/src/renderer/menu-renderer.ts
export class MenuRenderer {
  constructor(private api: Api, private store: SessionStore) {}

  /** Renders a page on the menu message. Sends fresh if no ID or stale. */
  async renderMenu(ctx: Ctx, page: PageDefinition): Promise<void> { /* … */ }

  /** Re-renders the current page (useful after an action). */
  async rerender(ctx: Ctx): Promise<void> { /* … */ }

  /** Edits only the keyboard when text is unchanged. */
  async editKeyboardOnly(ctx: Ctx, markup: InlineKeyboardMarkup): Promise<void> { /* … */ }
}
```

## Button taxonomy

Inline keyboards use four colour roles. Colour is advisory (Telegram
has no native button colours except Stars/Login); our lint rule validates
that destructive actions carry a red emoji prefix + `color: 'red'` in
keyboard metadata.

| Role | Use | Example |
|---|---|---|
| `primary` | Main CTA | `🚀 Create Agent` |
| `positive` | Confirm | `✅ Save` |
| `destructive` | Irreversible | `🗑 Delete` |
| `default` | Navigation / secondary | `← Back` |

## `callback_data` grammar

| Prefix | Meaning | Handler |
|---|---|---|
| `nav:<path>` | Navigate to `<path>` | Router |
| `nav:back` | Pop stack | Router |
| `action:<domain>:<verb>[:<arg>]` | Domain action | Action dispatcher |
| `flow:<flowId>:<step>` | Advance an input flow | Flow engine |
| `guard:<decision>` | Nav-guard decision (`stay` / `leave`) | Guard handler |

Telegram caps `callback_data` at 64 bytes. Long `<arg>`s (e.g. agent
IDs) go through a callback-shortener table keyed by hash; the dispatcher
resolves the hash back to the full payload.

## Idempotency

Rapid identical clicks are deduped using `lastAction` + `lastActionAt`:

```typescript
const incoming = ctx.callbackQuery.data;
if (
  incoming === session.menu.lastAction &&
  Date.now() - (session.menu.lastActionAt ?? 0) < 500
) {
  await ctx.answerCallbackQuery({ cache_time: 0 });
  return; // skip re-render
}
session.menu.lastAction = incoming;
session.menu.lastActionAt = Date.now();
```

## Keyboard-only edits

When only the keyboard changes (e.g. toggling a setting), the renderer
calls `editMessageReplyMarkup` to avoid the full-text edit that Telegram
rate-limits:

```typescript
if (shouldEditMarkupOnly(prev, next)) {
  await api.editMessageReplyMarkup(chatId, menu.messageId, { reply_markup });
}
```

## Rate limits

Telegram caps edits to the same message at ~1 per 2 s. The renderer
debounces rapid successive edits:

```typescript
const MIN_EDIT_INTERVAL_MS = 2000;
if (Date.now() - lastEditAt < MIN_EDIT_INTERVAL_MS) {
  await scheduleAt(lastEditAt + MIN_EDIT_INTERVAL_MS, () => edit());
  return;
}
```

## Breadcrumbs

Every page carries a `parent` for one-step Back. The full
`navigationStack` in session lets `← Back` traverse multiple levels.
See [06-navigation](06-navigation.md).

## Success criteria

- [ ] One menu message per user at any moment (verifiable in session).
- [ ] Stale-ID recovery is transparent — user never sees an error.
- [ ] Colour taxonomy enforced by a lint rule on button configs.
- [ ] No double-render on rapid identical clicks.
