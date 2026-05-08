# 06 — Navigation

> Router, breadcrumb stack, and navigation guards. How users move
> between pages without losing context, and how the engine protects
> unsaved work.
>
> **Contract:** [blueprint/07/design-system/06-navigation.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/06-navigation.md).
> **Up:** [01-overview](01-overview.md).
> **Siblings:** [03-menu](03-menu.md), [05-input-flows](05-input-flows.md).

---

## Routes are a tree

Every page has a path like `/creator/pricing/custom`. The page registry
holds the tree:

```
/
├── /creator
│   ├── /creator/welcome
│   ├── /creator/forge
│   ├── /creator/pricing
│   │   └── /creator/pricing/custom
│   ├── /creator/free-tier
│   └── /creator/dashboard
└── /onboarding
    ├── /onboarding/language
    ├── /onboarding/gender
    └── /onboarding/quiz
```

`parent` on each page is the direct parent; it powers `← Back` by
default.

## Breadcrumb stack

| Field | Meaning |
|---|---|
| `session.menu.navigationStack` | Full history of visited paths in this session |
| `session.menu.previousPage` | Top-of-stack minus one |
| `session.menu.currentPage` | Top of stack |

- **Forward nav** pushes.
- **Back** pops.
- **Deep back** (e.g. "Home") truncates to a specific depth.

## Router

```typescript
// packages/telefocus/src/router/navigate.ts
export async function navigateTo(ctx: Ctx, target: string): Promise<void> {
  const session = ctx.session;
  const current = session.menu.currentPage;

  // 1. Nav-guard — does the current page have unsaved work?
  const currentPageDef = registry.get(current);
  if (currentPageDef?.hasUnsavedWork?.(session)) {
    return openNavigationGuard(ctx, target);
  }

  // 2. onExit of current page.
  await currentPageDef?.onExit?.(session);

  // 3. Cleanup messages scoped to current page.
  await cleanupScope(ctx, current);

  // 4. onEnter of target.
  const targetDef = registry.get(target);
  if (!targetDef) throw new DopellerError('unknown_page', 'user', `unknown_page:${target}`);
  await targetDef.onEnter?.(session);

  // 5. Update stack.
  session.menu.previousPage = current;
  session.menu.currentPage = target;
  session.menu.navigationStack.push(target);
  truncateStack(session.menu.navigationStack, 50);

  // 6. Render.
  await renderer.renderMenu(ctx, targetDef);

  // 7. Persist (version-guarded).
  await sessionStore.save(session);
}
```

## `← Back`

A Back button carries `callback_data: nav:back`:

```typescript
// packages/telefocus/src/router/back.ts
export async function goBack(ctx: Ctx): Promise<void> {
  const stack = ctx.session.menu.navigationStack;
  const previous = stack.at(-2);
  stack.pop();                      // remove current
  await navigateTo(ctx, previous ?? '/');
}
```

If the stack is empty, Back goes to `/`.

## Navigation guards

Two cases trigger a guard:

1. `PageDefinition.hasUnsavedWork?(session)` returns `true`.
2. An input flow is active with any `collectedData`.

On trigger:

```typescript
// packages/telefocus/src/router/guard.ts
export async function openNavigationGuard(ctx: Ctx, target: string): Promise<void> {
  ctx.session.navigationGuard = {
    active: true,
    pendingDestination: target,
    confirmationMessageId: null,
  };

  const msg = await send(
    ctx,
    '<b>You have unsaved changes.</b>\nLeave and lose them?',
    {
      type: 'INTERACTIVE',
      subtype: 'CONFIRMATION',
      parseMode: 'HTML',
      replyMarkup: {
        inline_keyboard: [
          [{ text: '← Stay',  callback_data: 'guard:stay'  }],
          [{ text: '🗑 Leave', callback_data: 'guard:leave' }],
        ],
      },
    },
  );
  ctx.session.navigationGuard.confirmationMessageId = msg.messageId;
}
```

Button resolution:

| callback_data | Action |
|---|---|
| `guard:stay`  | Reset guard state, delete confirmation, re-render current page. |
| `guard:leave` | Call input-flow `onCancel` if active, reset flow, then `navigateTo(pendingDestination)`. |

## Deep links

The first message in a session is typically `/start` with an optional
start parameter:

| Input | Effect |
|---|---|
| `/start` | `/` (or `/onboarding/language` if language unset) |
| `/start persona_<id>` | `/personas/:id` (deep link for sharing) |
| `/start ref_<code>` | `/` with referral code applied |

```typescript
// packages/telefocus/src/router/deep-link.ts
export function resolveStart(payload: string | undefined, session: UserSession): string {
  if (!session.language) return '/onboarding/language';
  if (!payload) return '/';
  if (payload.startsWith('persona_')) return `/personas/${payload.slice(8)}`;
  if (payload.startsWith('ref_'))     { /* apply ref; */ return '/'; }
  return '/';
}
```

## Middleware interaction

Nav is also triggered by:

- **Menu commands** (`/menu`, `/dashboard`, `/billing`) — each command is bound to a path in `commands/map.ts`.
- **Language / gender change** — resets the nav stack to the post-onboarding root.
- **Lifecycle events** (bot suspended) — forces nav to a read-only "Suspended" page until resolved.

## Edge cases

### Concurrent nav

Rapid `nav:/a` + `nav:/b` clicks: the version-guarded session write
ensures only one completes. The other retries against fresh state and
either no-ops (same target) or proceeds.

### Missing page

`registry.get('/unknown')` returns `undefined`. The router:

1. Sends DANGER ephemeral *"Something went wrong — going home"*.
2. Navigates to `/`.
3. Logs the attempted path with `update_id` for debugging.

### Stack explosion

After 50 entries, the stack is truncated from the front. Back still
works locally; we don't keep infinite history:

```typescript
function truncateStack(stack: string[], max: number): void {
  if (stack.length > max) stack.splice(0, stack.length - max);
}
```

## Example — guarded navigation from Forge

```typescript
// apps/manager-bot/src/pages/creator/forge.ts
export const forgePage: PageDefinition = {
  path: '/creator/forge',
  parent: '/creator/welcome',
  inputFlow: creatorForgeFlow,
  hasUnsavedWork: (session) => Object.keys(
    session.inputFlow.collectedData ?? {}
  ).length > 0,
  render: () => ({
    text: '🛠 <b>Forge your agent</b>\nAnswer a few questions.',
    parseMode: 'HTML',
  }),
  keyboard: () => [[{ text: '← Cancel', callback_data: 'nav:back' }]],
  onEnter: async (session) => {
    await inputFlowEngine.start('creator_forge', session);
  },
};
```

## Success criteria

- [ ] Back always returns to the previous page without losing menu state.
- [ ] Nav guards fire 100% of the time when `hasUnsavedWork` is true.
- [ ] No handler calls `renderer` directly — only through `navigateTo`.
- [ ] Deep-link `/start` parameters route correctly on first interaction.
