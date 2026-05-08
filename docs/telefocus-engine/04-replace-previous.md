# 04 — `replacePrevious`: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/04-replace-previous.md](../blueprint/05-wave-2-core-engines/telefocus-engine/04-replace-previous.md)

## Algorithm

```ts
// packages/telefocus/src/lifecycle/replace-previous.ts
export async function replacePrevious(
  ctx: DopellerCtx,
  pagePath: string,
  type: TrackedMessage["type"],
  subtype: TrackedMessage["subtype"] | undefined,
): Promise<ReplaceOutcome> {
  const lockKey = `session:${ctx.bot.id}:${ctx.user.id}:ui-lock`;
  const acquired = await ctx.redis.set(lockKey, "1", "NX", "PX", 2000);
  if (!acquired) {
    ctx.emit("telefocus.replace.lock_contended", { pagePath });
    return { outcome: "lost-race" };
  }
  try {
    const scope = ctx.session.messages[pagePath] ?? [];
    // Scan newest-to-oldest.
    for (let i = scope.length - 1; i >= 0; i--) {
      const m = scope[i];
      if (m.type !== type) continue;
      if ((m.subtype ?? null) !== (subtype ?? null)) continue;

      try {
        await ctx.api.deleteMessage(ctx.chat!.id, m.messageId);
        ctx.emit("telefocus.replace.hit", { pagePath, type, subtype });
      } catch (err) {
        if (isGhostDelete(err)) {
          ctx.emit("telefocus.replace.ghost", { pagePath, type, subtype });
        } else {
          throw err;
        }
      }
      scope.splice(i, 1);
      ctx.sessionDirty = true;
      ctx.scheduler.cancel(`${ctx.chat!.id}:${m.messageId}`);
      return { outcome: "replaced", replacedId: m.messageId };
    }
    ctx.emit("telefocus.replace.miss", { pagePath, type, subtype });
    return { outcome: "no-match" };
  } finally {
    await ctx.redis.del(lockKey);
  }
}

function isGhostDelete(err: unknown): boolean {
  const e = err as { error_code?: number; description?: string };
  return e.error_code === 400 && /message to delete not found/i.test(e.description ?? "");
}
```

## Edit-in-place optimization

When the replacement target and the new message share the same `(type, subtype, pagePath)` *and* share a compatible keyboard shape, we can edit in place instead of delete+send. This is a single Telegram API call and avoids the scroll jump.

```ts
// packages/telefocus/src/lifecycle/replace-previous.ts (continued)
export async function maybeEditInPlace(
  ctx: DopellerCtx,
  pagePath: string,
  type: TrackedMessage["type"],
  subtype: TrackedMessage["subtype"] | undefined,
  newText: string,
  newKeyboard?: InlineKeyboardButton[][],
): Promise<number | null> {
  const scope = ctx.session.messages[pagePath] ?? [];
  const match = [...scope].reverse().find(m =>
    m.type === type && (m.subtype ?? null) === (subtype ?? null),
  );
  if (!match) return null;

  // Must be younger than 48 h (Telegram edit window), else fall back to delete+send.
  if (Date.now() - match.createdAt > 48 * 3600 * 1000) return null;

  try {
    await ctx.api.editMessageText(ctx.chat!.id, match.messageId, newText, {
      reply_markup: newKeyboard ? { inline_keyboard: newKeyboard } : undefined,
    });
    ctx.emit("telefocus.replace.edit_in_place", { pagePath, type, subtype });
    return match.messageId;
  } catch (err) {
    if (isStaleMenuError(err)) return null;  // fall back to delete+send
    throw err;
  }
}
```

The `MessageLifecycleManager.send` calls `maybeEditInPlace` first when `replacePrevious: true`; on `null` it falls through to the delete+send path.

## Rate-limit coalescing (hot-loop protection)

A handler that fires toasts in a tight loop (e.g. validation during rapid typing) can trip Telegram rate limits. A 500 ms coalesce window merges consecutive `WARNING` / `DANGER` toasts on the same `(type, subtype, pagePath)`:

```ts
// packages/telefocus/src/lifecycle/coalesce.ts
const COALESCE_MS = 500;

export class ToastCoalescer {
  private pending = new Map<string, { timer: NodeJS.Timeout; text: string; resolve: (id: number) => void }>();

  async submit(key: string, text: string, send: (text: string) => Promise<number>): Promise<number> {
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.text = text;  // latest text wins
      return new Promise((resolve) => {
        existing.resolve = resolve;
        existing.timer = setTimeout(async () => {
          const id = await send(existing.text);
          existing.resolve(id);
          this.pending.delete(key);
        }, COALESCE_MS);
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        const id = await send(text);
        resolve(id);
        this.pending.delete(key);
      }, 0);
      this.pending.set(key, { timer, text, resolve });
    });
  }
}
```

Key is `${pagePath}:${type}:${subtype}`. Only `WARNING` and `DANGER` toasts are coalesced; `SUCCESS` and `INFO` fire immediately (they carry positive signal that should not be debounced).

## Menu-message guard

The menu is never a replacement target:

```ts
// Inside send() before replace:
if (opts.type !== "INPUT_PROMPT" && ctx.session.menu.messageId != null) {
  if ((ctx.session.messages[pagePath] ?? []).some(m => m.messageId === ctx.session.menu.messageId)) {
    throw new InvariantError("I5", "menu messageId leaked into tracked messages");
  }
}
```

## Observability dashboard

```
telefocus.replace.hit_rate = hit / (hit + miss)
```

- **Trending to 1.0:** UI over-toasting. Review handler code for redundant confirmations.
- **Trending to 0.0:** `replacePrevious` not being used; chat will clutter. Review page-level `ctx.messages.toast` calls.

Target: 0.3–0.7 across the bot fleet.

## Cross-links

- Blueprint: [04-replace-previous](../blueprint/05-wave-2-core-engines/telefocus-engine/04-replace-previous.md)
- Sibling: [03-message-lifecycle.md](03-message-lifecycle.md) · [08-toasts-modals.md](08-toasts-modals.md)
