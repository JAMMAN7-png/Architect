# 07 — Toasts & Modals

> The two kinds of transient UI: **toasts** (ephemeral notices,
> auto-close) and **modals** (interactive confirmations, require a
> decision).
>
> **Contract:** [blueprint/07/design-system/07-toasts-modals.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/07-toasts-modals.md).
> **Uses:** [04-messages](04-messages.md).

---

## Toasts

### API

```typescript
// packages/telefocus/src/messages/toast.ts
export interface ToastOptions {
  ttlMs?: number;
  noIcon?: boolean;
  scope?: string;
  parseMode?: 'HTML' | 'MarkdownV2';
}

export const toast = {
  info:    (ctx: Ctx, text: string, opts?: ToastOptions) => Promise<TrackedMessage>,
  warning: (ctx: Ctx, text: string, opts?: ToastOptions) => Promise<TrackedMessage>,
  danger:  (ctx: Ctx, text: string, opts?: ToastOptions) => Promise<TrackedMessage>,
};
```

Under the hood each helper calls:

```typescript
return send(ctx, text, {
  type: 'EPHEMERAL',
  subtype: 'INFO' | 'WARNING' | 'DANGER',
  ttlMs: opts?.ttlMs ?? DEFAULT_TTL[subtype],
  replacePrevious: true,
  parseMode: opts?.parseMode ?? 'HTML',
});
```

### Defaults

| Subtype | Icon (auto-prepended) | TTL |
|---|---|---|
| `INFO` | ✅ | 3 000 ms |
| `WARNING` | ⚠️ | 5 000 ms |
| `DANGER` | ❌ | 10 000 ms |

### Usage

```typescript
await toast.info(ctx, 'Settings saved');
await toast.warning(ctx, 'This might take a minute');
await toast.danger(ctx, 'Payment failed');

// Override TTL
await toast.warning(ctx, 'Processing your refund…', { ttlMs: 15_000 });

// No icon (rare — prefer to let the system prepend)
await toast.info(ctx, '🎉 You levelled up!', { noIcon: true });
```

### Replacement behaviour

Only one toast **per subtype per scope**. A new `info` while one is
active edits the existing one rather than stacking. Keeps the chat
clean during rapid action sequences (e.g. multiple settings saved in a
row).

## Toast TTLs (table)

Defaults are baked into `toast.*` and applied at send time. Override
only when the message MUST live longer for legibility (e.g. a 30 s
"refund processing" warning) — never to make a transient message
persistent.

| Subtype | Default TTL | Icon | When to use |
|---|---|---|---|
| `INFO` | 3 000 ms | ✅ | Acknowledgement, low cognitive load |
| `WARNING` | 5 000 ms | ⚠️ | Reader needs a beat to absorb |
| `DANGER` | 10 000 ms | ❌ | Failure must register; user may need to act |

Auto-eviction is enforced in `messages/send.ts` (see
[04-messages.md](04-messages.md) §TTL discipline). An ephemeral that
persists past its TTL is a bug, not a UX choice.

## Modals lock the menu

Calling `modal.confirm(...)` sets `session.activeModal`, which causes the
menu renderer to paint a **locked body** with a single `× Cancel`
button. The user cannot interact with the underlying page's keyboard
until the modal resolves or is dismissed.

- The modal's own Cancel button MUST do something observable: clear `session.activeModal`, dismiss interactive messages in scope, and rerender the menu. An inert cancel button is a bug.
- Action handlers MUST register **both** confirm and cancel callbacks. Lint rule (TODO) flags any `modal.confirm` whose `cancelCallback` is unregistered.
- See [03-menu.md](03-menu.md) §Menu reflects state for the lock contract.
- See [08-error-handling.md](08-error-handling.md) §Cancel buttons MUST be implemented.

## Modals

### `modal.confirm`

```typescript
// packages/telefocus/src/messages/modal.ts
export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;                            // default "Cancel"
  confirmColor?: 'primary' | 'positive' | 'destructive';
  onConfirm(): Promise<void>;
  onCancel?(): Promise<void>;
  successToast?: string;                           // defaults to "Done"
}

export const modal = {
  confirm(ctx: Ctx, opts: ConfirmOptions): Promise<void>;
  typedConfirm(ctx: Ctx, opts: TypedConfirmOptions): Promise<void>;
};
```

Usage:

```typescript
await modal.confirm(ctx, {
  title: 'Delete agent?',
  body: 'This cannot be undone.',
  confirmLabel: '🗑 Delete',
  confirmColor: 'destructive',
  onConfirm: async () => { await services.instanceManager.delete(agentId); },
  successToast: 'Agent deleted.',
});
```

Button resolution routes through the action dispatcher:

| callback_data | Action |
|---|---|
| `action:modal:confirm` | Run `onConfirm`, delete modal, show `INFO` toast. |
| `action:modal:cancel`  | Run `onCancel?`, delete modal. |

If the user navigates away first, scope cleanup removes the modal and
the action is treated as cancelled.

### `modal.typedConfirm`

For destructive actions that shouldn't be one-tap:

```typescript
export interface TypedConfirmOptions extends Omit<ConfirmOptions, 'confirmLabel'> {
  expected: string;                                // user must type this exactly
  prompt: string;                                  // "Type the bot username to confirm."
}

await modal.typedConfirm(ctx, {
  title: 'Delete @marketpulse_dp_bot?',
  body: 'Type the bot username to confirm.',
  expected: '@marketpulse_dp_bot',
  prompt: 'Type the bot username:',
  confirmColor: 'destructive',
  onConfirm: async () => { /* … */ },
  successToast: 'Bot deleted.',
});
```

Spawns an `INPUT_PROMPT`; only if the user's text exactly matches
`expected` does `onConfirm` fire. Used in the Creator Dashboard for
`Delete` and `Rotate Token`.

### No stacking

We do **not** stack modals. Sending a new modal while one is active
cancels the old one first:

```typescript
const existing = findModalInScope(ctx);
if (existing) await dismissModal(ctx, existing);
await sendModal(ctx, opts);
```

Deliberate UX choice — modals are interruptive; users can only handle
one at a time.

## Stars invoices

Stars payments use Telegram's native invoice sheet (a modal over chat).
The design system wraps `sendInvoice` and tracks the message for
cleanup:

```typescript
// packages/telefocus/src/messages/invoice.ts
export interface InvoiceOptions {
  title: string;
  description: string;
  amountXtr: number;                               // Stars
  payload: string;                                 // correlation id
  onSuccess(ctx: Ctx): Promise<void>;
  onCancel?(ctx: Ctx): Promise<void>;
}

await invoice.send(ctx, {
  title: 'Recharge Crypto Sage',
  description: '100 messages',
  amountXtr: 50,
  payload: `recharge:${userId}:${Date.now()}`,
  onSuccess: async () => { await services.billing.credit(userId, 100); },
});
```

On `successful_payment`:

1. Delete the invoice message.
2. Fire `onSuccess`.
3. Toast `"✅ Energy restored"`.

## Accessibility

- Modal titles are the first line, bold (HTML `<b>`).
- Body in a regular paragraph.
- Buttons on separate rows (destructive on top, cancel below) for thumb-reach.
- Destructive buttons use both red emoji (🗑 / ❌) and `color: 'destructive'` for colour-blind accessibility.
- Toasts include the icon before the copy so screen readers get a role cue.

## Success criteria

- [ ] Only one toast per subtype in any page scope at a time.
- [ ] Modals survive until explicit decision or navigation.
- [ ] Typed-confirm modals enforce exact match before firing `onConfirm`.
- [ ] Navigating away while a modal is open cancels it safely (scope cleanup).
