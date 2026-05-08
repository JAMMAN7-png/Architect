# 03 — Message Lifecycle: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/03-message-lifecycle.md](../blueprint/05-wave-2-core-engines/telefocus-engine/03-message-lifecycle.md)

## MessageLifecycleManager

```ts
// packages/telefocus/src/lifecycle/manager.ts
export interface SendOpts {
  type: "EPHEMERAL" | "INTERACTIVE" | "INPUT_PROMPT" | "INPUT_PROGRESS";
  subtype?: MessageSubtype;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  keyboard?: InlineKeyboardButton[][];
  pagePath?: string;                // default: session.menu.currentPage
  ttl?: number;                     // seconds
  replacePrevious?: boolean;        // default: true for EPHEMERAL, false otherwise
}

export class MessageLifecycleManager {
  constructor(
    private readonly api: TelegramApi,
    private readonly scheduler: TtlScheduler,
    private readonly lock: UiLock,
  ) {}

  async send(ctx: DopellerCtx, opts: SendOpts): Promise<number> {
    const pagePath = opts.pagePath ?? ctx.session.menu.currentPage;
    const replace = opts.replacePrevious ?? (opts.type === "EPHEMERAL");

    if (replace) {
      await this.replacePrevious(ctx, pagePath, opts.type, opts.subtype);
    }

    const sent = await this.api.sendMessage(ctx.chat!.id, opts.text, {
      parse_mode: opts.parseMode,
      reply_markup: opts.keyboard ? { inline_keyboard: opts.keyboard } : undefined,
    });

    const tracked: TrackedMessage = {
      messageId: sent.message_id,
      type: opts.type,
      subtype: opts.subtype,
      pagePath,
      createdAt: Date.now(),
      expiresAt: opts.ttl ? Date.now() + opts.ttl * 1000 : undefined,
    };

    (ctx.session.messages[pagePath] ??= []).push(tracked);
    ctx.sessionDirty = true;

    if (opts.ttl) {
      this.scheduler.schedule(ctx.chat!.id, sent.message_id, opts.ttl);
    }

    ctx.emit("telefocus.message.sent", { type: opts.type, subtype: opts.subtype, pagePath });
    return sent.message_id;
  }

  async edit(ctx: DopellerCtx, messageId: number, patch: EditOpts): Promise<void> { /* ... */ }
  async delete(ctx: DopellerCtx, messageId: number): Promise<void> { /* ... */ }
  async cleanupScope(ctx: DopellerCtx, pagePath: string): Promise<void> { /* ... */ }
  async cleanupAll(ctx: DopellerCtx): Promise<void> { /* ... */ }

  async toast(ctx: DopellerCtx, text: string, opts?: { subtype?: MessageSubtype; ttl?: number }): Promise<number> {
    return this.send(ctx, {
      type: "EPHEMERAL",
      subtype: opts?.subtype ?? "INFO",
      text,
      ttl: opts?.ttl ?? DEFAULT_TOAST_TTL[opts?.subtype ?? "INFO"],
      replacePrevious: true,
    });
  }
}

const DEFAULT_TOAST_TTL = { INFO: 5, SUCCESS: 3, WARNING: 6, DANGER: 8 } as const;
```

## TTL scheduler

Both active and lazy strategies, as mandated by the blueprint.

```ts
// packages/telefocus/src/lifecycle/ttl-scheduler.ts
export class TtlScheduler {
  private timers = new Map<string, NodeJS.Timeout>();  // key: chatId:messageId

  schedule(chatId: number, messageId: number, ttlSec: number): void {
    const key = `${chatId}:${messageId}`;
    this.cancel(key);
    const t = setTimeout(async () => {
      try { await this.api.deleteMessage(chatId, messageId); } catch { /* ghost */ }
      this.timers.delete(key);
    }, ttlSec * 1000);
    t.unref();
    this.timers.set(key, t);
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (t) { clearTimeout(t); this.timers.delete(key); }
  }
}

// Lazy pass — runs as stage 4.5 (session-loader post-hook).
export async function lazyTtlSweep(ctx: DopellerCtx): Promise<void> {
  const now = Date.now();
  const pagePath = ctx.session.menu.currentPage;
  const list = ctx.session.messages[pagePath] ?? [];
  const surviving: TrackedMessage[] = [];
  for (const m of list) {
    if (m.expiresAt && m.expiresAt <= now) {
      try { await ctx.api.deleteMessage(ctx.chat!.id, m.messageId); } catch {}
    } else {
      surviving.push(m);
    }
  }
  if (surviving.length !== list.length) {
    ctx.session.messages[pagePath] = surviving;
    ctx.sessionDirty = true;
  }
}
```

Active scheduler timers don't survive process restart; lazy sweep picks up the stragglers on next interaction.

## Response production paths

### 1. Menu edit

Happens implicitly via navigation router (see [07](07-navigation.md)) calling `renderMenu(ctx, def)`. Handlers rarely touch menu text directly.

### 2. Tracked send

```ts
async function themeChangedHandler(ctx: DopellerCtx): Promise<void> {
  await preferences.setTheme(ctx.user.id, "dark");
  await ctx.messages.toast("✓ Theme set to Dark", { subtype: "SUCCESS" });
}
```

### 3. LLM streaming reply

```ts
async function chatHandler(ctx: DopellerCtx): Promise<void> {
  const targetId = await ctx.messages.send(ctx, {
    type: "EPHEMERAL",
    subtype: "INFO",
    text: "…",
    replacePrevious: false,
  });
  const stream = await ctx.gateway.chatStream({ messages: ctx.persona.buildMessages(ctx.memories) });
  let buf = "";
  let lastEdit = 0;
  for await (const chunk of stream) {
    buf += chunk.delta;
    const now = Date.now();
    if (now - lastEdit > 1000) {  // rate-safe: 1/s
      await ctx.messages.edit(targetId, { text: buf });
      lastEdit = now;
    }
  }
  await ctx.messages.edit(targetId, { text: buf });  // final
}
```

Streaming targets are *not* `replacePrevious` candidates (they are history, not state).

## Lint enforcement

Direct `ctx.reply`, `ctx.api.sendMessage`, `ctx.api.editMessageText`, `ctx.api.deleteMessage` in user-land handlers is a lint error. The rule lives in `eslint.config.js`:

```js
// eslint.config.js
rules: {
  "no-restricted-properties": ["error",
    { object: "ctx", property: "reply",    message: "Use ctx.messages.send() or ctx.messages.toast()." },
    { object: "ctx", property: "api",      message: "Use ctx.messages / ctx.navigate; ctx.api is platform-only." },
  ],
}
```

Platform code that legitimately needs raw API access lives in `packages/telefocus/src/lifecycle/**` and is exempt via eslint overrides.

## Emitted events (every update)

```
telefocus.stage.<name>.entered
telefocus.stage.<name>.exited          { duration_ms }
telefocus.stage.<name>.error           { error_class }
telefocus.stage.<name>.short_circuit   { reason }
telefocus.message.sent                 { type, subtype, pagePath }
telefocus.message.deleted              { messageId, reason }
telefocus.replace.hit | .miss | .ghost
telefocus.navigate                     { from, to, duration_ms }
telefocus.update.unhandled
telefocus.error.user | .transient | .fatal
```

All events are emitted via `ctx.emit(name, data)`; the metrics-sink middleware (stage 21) forwards to Rybbit and OTEL spans.

## Example trace

See the blueprint chapter for the user-message timing trace. At the implementation level, each stage boundary emits its entered/exited pair with a monotonic `performance.now()` timestamp; total request latency is `stage.fallback.exited - stage.auth.entered`.

## Cross-links

- Blueprint: [03-message-lifecycle](../blueprint/05-wave-2-core-engines/telefocus-engine/03-message-lifecycle.md)
- Sibling: [04-replace-previous.md](04-replace-previous.md) · [05-middleware-pipeline.md](05-middleware-pipeline.md)
