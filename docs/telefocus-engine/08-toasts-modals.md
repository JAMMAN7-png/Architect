# 08 — Toasts and Modals: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/08-toasts-modals.md](../blueprint/05-wave-2-core-engines/telefocus-engine/08-toasts-modals.md)

## Toast API

```ts
// packages/telefocus/src/toast/api.ts
export interface ToastOptions {
  subtype?: "INFO" | "SUCCESS" | "WARNING" | "DANGER";
  ttl?: number;
  pagePath?: string;
  dismissable?: boolean;  // default: true for DANGER, false otherwise
}

export class ToastApi {
  constructor(private lifecycle: MessageLifecycleManager) {}

  async show(ctx: DopellerCtx, text: string, opts: ToastOptions = {}): Promise<number> {
    const subtype = opts.subtype ?? "INFO";
    const icon = { INFO: "ℹ️", SUCCESS: "✓", WARNING: "⚠️", DANGER: "✗" }[subtype];
    const body = `${icon} ${text}`;
    const dismissable = opts.dismissable ?? (subtype === "DANGER");
    const keyboard = dismissable ? [[{ text: "ⓧ", callback_data: `msg::dismiss` }]] : undefined;

    return this.lifecycle.send(ctx, {
      type: "EPHEMERAL",
      subtype,
      text: body,
      parseMode: "HTML",
      keyboard,
      pagePath: opts.pagePath,
      ttl: opts.ttl ?? DEFAULT_TTL[subtype],
      replacePrevious: true,
    });
  }
}

const DEFAULT_TTL: Record<NonNullable<ToastOptions["subtype"]>, number> = {
  INFO: 5, SUCCESS: 3, WARNING: 6, DANGER: 8,
};
```

The `msg::dismiss` callback is handled by the msg-router with the tracked message's id available from the callback's `message.message_id`:

```ts
// packages/telefocus/src/middleware/msg-router.ts
export const msgRouter = (): Middleware => async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("msg:")) return next();
  const parts = data.split(":");
  const action = parts[parts.length - 1];
  if (action === "dismiss" && ctx.callbackQuery?.message?.message_id) {
    await ctx.messages.delete(ctx, ctx.callbackQuery.message.message_id);
    await ctx.answerCallbackQuery();
    return;
  }
  return next();
};
```

## Modal API — promise-returning

```ts
// packages/telefocus/src/modal/api.ts
export class ModalCancelled extends Error {}
export class ConcurrentModal extends Error {}
export class ModalTimedOut extends Error {}

export interface ModalConfirmOpts {
  title: string;
  body?: string;
  primary: { label: string; style?: "NEUTRAL" | "PRIMARY" | "DANGER" };
  secondary?: { label: string; style?: "NEUTRAL" | "PRIMARY" | "DANGER" };
  pagePath?: string;
  timeoutSec?: number;
}

export class ModalApi {
  // messageId → pending promise resolver
  private pending = new Map<number, { resolve: (c: "primary" | "secondary") => void; reject: (e: Error) => void }>();
  // (chatId, pagePath) → active modal id
  private activeOn = new Map<string, number>();

  constructor(private lifecycle: MessageLifecycleManager) {}

  async confirm(ctx: DopellerCtx, opts: ModalConfirmOpts): Promise<"primary" | "secondary"> {
    const pagePath = opts.pagePath ?? ctx.session.menu.currentPage;
    const chatKey = `${ctx.chat!.id}:${pagePath}`;
    if (this.activeOn.has(chatKey)) throw new ConcurrentModal();

    const text = opts.body
      ? `<b>${escape(opts.title)}</b>\n\n${escape(opts.body)}`
      : `<b>${escape(opts.title)}</b>`;

    const buttons: InlineKeyboardButton[] = [
      { text: styled(opts.primary.label, opts.primary.style),     callback_data: "modal:primary" },
      ...(opts.secondary
        ? [{ text: styled(opts.secondary.label, opts.secondary.style), callback_data: "modal:secondary" }]
        : []),
    ];

    const msgId = await this.lifecycle.send(ctx, {
      type: "INTERACTIVE",
      subtype: "CONFIRMATION",
      text,
      parseMode: "HTML",
      keyboard: [buttons],
      pagePath,
      replacePrevious: false,
    });

    this.activeOn.set(chatKey, msgId);
    return new Promise<"primary" | "secondary">((resolve, reject) => {
      this.pending.set(msgId, { resolve, reject });
      if (opts.timeoutSec) {
        setTimeout(() => {
          if (this.pending.has(msgId)) {
            this.pending.delete(msgId);
            this.activeOn.delete(chatKey);
            reject(new ModalTimedOut());
          }
        }, opts.timeoutSec * 1000).unref();
      }
    });
  }

  // Invoked by modal-callback handler when the user taps.
  resolve(messageId: number, choice: "primary" | "secondary"): boolean {
    const p = this.pending.get(messageId);
    if (!p) return false;
    this.pending.delete(messageId);
    for (const [k, v] of this.activeOn) if (v === messageId) this.activeOn.delete(k);
    p.resolve(choice);
    return true;
  }

  cancel(messageId: number): boolean {
    const p = this.pending.get(messageId);
    if (!p) return false;
    this.pending.delete(messageId);
    for (const [k, v] of this.activeOn) if (v === messageId) this.activeOn.delete(k);
    p.reject(new ModalCancelled());
    return true;
  }
}

function styled(label: string, style: ModalConfirmOpts["primary"]["style"]): string {
  // Telegram's Bot API 8.2+ coloured buttons would map here, but the text stays neutral;
  // style is applied via reply_markup's button color field when available.
  return label;
}
```

The modal router handles `modal:primary` / `modal:secondary`:

```ts
// packages/telefocus/src/middleware/modal-router.ts
export const modalRouter = (modals: ModalApi): Middleware => async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("modal:")) return next();
  const choice = data.slice(6) as "primary" | "secondary";
  const messageId = ctx.callbackQuery!.message!.message_id;
  await ctx.answerCallbackQuery();
  modals.resolve(messageId, choice);
  // Delete the modal message — it's done.
  await ctx.messages.delete(ctx, messageId);
};
```

On `navigate` while a modal is pending, the navigation router calls `modals.cancel(modalId)` for every pending modal in the scope; handler gets `ModalCancelled` and treats as decline.

## Destructive-action gate

```ts
// Inside a handler, before destructive action:
async function deletePersonaHandler(ctx: DopellerCtx): Promise<void> {
  try {
    const choice = await ctx.modals.confirm({
      title: "Delete persona?",
      body: "This cannot be undone. All memories and traits will be discarded.",
      primary: { label: "Delete", style: "DANGER" },
      secondary: { label: "Keep", style: "NEUTRAL" },
    });
    if (choice !== "primary") return;
    await ctx.personas.delete(ctx.pageData.id);
    await ctx.messages.toast("Persona deleted.", { subtype: "INFO" });
    await ctx.navigate("/personas");
  } catch (err) {
    if (err instanceof ModalCancelled) return;  // user navigated away
    throw err;  // framework handles
  }
}
```

## Coalescing rapid-fire toasts

Uses the `ToastCoalescer` from [04-replace-previous.md](04-replace-previous.md). Within a 500 ms window of the same `(pagePath, type, subtype)`, the second call edits the first's message rather than issuing a new Telegram call.

```ts
// packages/telefocus/src/toast/coalesce-wrapper.ts
const coalescer = new ToastCoalescer();

export function coalescedToast(ctx: DopellerCtx, text: string, opts: ToastOptions): Promise<number> {
  const key = `${opts.pagePath ?? ctx.session.menu.currentPage}:${opts.subtype ?? "INFO"}`;
  return coalescer.submit(key, text, (finalText) =>
    ctx.toastApi.show(ctx, finalText, opts),
  );
}
```

Only applied to `WARNING` and `DANGER`; `SUCCESS` and `INFO` bypass to fire immediately.

## Billing-precheck toast (Wave 3 hook)

Wave 2 emits `gam.billing.precheck` but does not enforce. When Wave 3 turns this on, the billing-precheck middleware short-circuits with:

```ts
// In billing-precheck middleware (Wave 3):
if (estimated_cost_dc > ctx.user.balance_dc) {
  await ctx.messages.send(ctx, {
    type: "EPHEMERAL",
    subtype: "WARNING",
    text: `This message would cost ${estimated_cost_dc} DC. You have ${ctx.user.balance_dc}.`,
    keyboard: [[{ text: "Top Up", callback_data: "action:topup" }]],
    ttl: 30,
    replacePrevious: true,
  });
  ctx.emit("gam.billing.precheck", { estimated_cost_dc, blocked: true });
  return;
}
```

## Cross-links

- Blueprint: [08-toasts-modals](../blueprint/05-wave-2-core-engines/telefocus-engine/08-toasts-modals.md)
- Sibling: [04-replace-previous.md](04-replace-previous.md) · [09-error-handling.md](09-error-handling.md)
