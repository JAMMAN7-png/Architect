# 07 — Navigation: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/07-navigation.md](../blueprint/05-wave-2-core-engines/telefocus-engine/07-navigation.md)

## Callback-data conventions

| Prefix | Shape | Handled by |
|---|---|---|
| `nav:{path}` | `nav:/settings/preferences` | Navigation router (stage 11) |
| `nav::back` | literal | Navigation router |
| `nav::home` | literal | Navigation router |
| `action:{handlerKey}[:...]` | `action:regenerate` | Action router (stage 12) |
| `flow:{flowId}:{action}[:...]` | `flow:persona_creation:select:mentor` | Flow router (stage 13) |
| `guard:{confirm|stay}` | literal | Guard router (stage 14) |
| `msg:{messageId}:{action}` | `msg:12345:dismiss` | Msg router (stage 15) |

All prefixes must encode within 64 bytes total. The helper `kb.nav(label, path)` enforces this at build time:

```ts
// packages/telefocus/src/engine/keyboard.ts
export const kb = {
  nav(label: string, path: string): InlineKeyboardButton {
    const data = `nav:${path}`;
    if (Buffer.byteLength(data, "utf8") > 64) {
      throw new Error(`callback_data too long: ${data} (${data.length} B)`);
    }
    return { text: label, callback_data: data };
  },
  action(label: string, key: string): InlineKeyboardButton {
    const data = `action:${key}`;
    if (Buffer.byteLength(data, "utf8") > 64) throw new Error(`callback_data too long: ${data}`);
    return { text: label, callback_data: data };
  },
  row(...buttons: InlineKeyboardButton[]) { return new KeyboardBuilder([buttons]); },
  done() { return [] as InlineKeyboardButton[][]; },
};
```

## Navigation router

```ts
// packages/telefocus/src/nav/router.ts
export const navRouter = (registry: PageRegistry): Middleware => async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("nav:")) return next();

  const target = data.slice(4);
  let destPath: string;
  if (target === ":back") {
    const stack = ctx.session.menu.navigationStack;
    if (stack.length <= 1) destPath = "/";
    else { stack.pop(); destPath = stack[stack.length - 1]; }
  } else if (target === ":home") {
    destPath = "/";
  } else {
    destPath = target;
  }

  const resolved = registry.resolve(destPath);
  if (!resolved) {
    await ctx.answerCallbackQuery("Page not found.");
    ctx.emit("telefocus.navigate.unknown", { path: destPath });
    return;
  }

  const { def: destDef } = resolved;
  const currentPath = ctx.session.menu.currentPage;
  if (destPath === currentPath) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Group-chat initiator check.
  if (ctx.chat?.type !== "private") {
    const initiatorId = ctx.session.menu.initiatorUserId;
    if (initiatorId && initiatorId !== ctx.from!.id) {
      await ctx.answerCallbackQuery(`Only @${ctx.bot.initiatorUsername} can navigate this menu.`, { show_alert: false });
      return;
    }
  }

  // Navigation guard for unsaved work.
  const currentDef = registry.resolve(currentPath)?.def;
  if (currentDef?.hasUnsavedWork?.(ctx.session)) {
    ctx.session.navigationGuard = {
      active: true, pendingDestination: destPath, pendingParams: null, confirmationMessageId: null,
    };
    const confirmId = await ctx.messages.send(ctx, {
      type: "INTERACTIVE",
      subtype: "CONFIRMATION",
      text: "⚠️ You have unsaved changes. Leave anyway?",
      keyboard: [[
        { text: "Leave", callback_data: "guard:confirm" },
        { text: "Stay", callback_data: "guard:stay" },
      ]],
      replacePrevious: false,
    });
    ctx.session.navigationGuard.confirmationMessageId = confirmId;
    ctx.sessionDirty = true;
    await ctx.answerCallbackQuery();
    return;
  }

  await executeNavigate(ctx, registry, currentPath, destPath, destDef);
  await ctx.answerCallbackQuery();
};

async function executeNavigate(
  ctx: DopellerCtx,
  registry: PageRegistry,
  from: string,
  to: string,
  destDef: PageDefinition,
): Promise<void> {
  const t0 = performance.now();
  const fromDef = registry.resolve(from)?.def;
  await fromDef?.onExit?.(ctx);
  await ctx.messages.cleanupScope(ctx, from);

  if (ctx.session.inputFlow.active && ctx.session.inputFlow.pagePath === from) {
    await ctx.flowEngine.cancel(ctx);
  }

  ctx.session.menu.previousPage = from;
  ctx.session.menu.currentPage = to;
  if (ctx.session.menu.navigationStack[ctx.session.menu.navigationStack.length - 1] !== to) {
    ctx.session.menu.navigationStack.push(to);
  }
  ctx.sessionDirty = true;

  await destDef.onEnter?.(ctx);
  await renderMenu(ctx, destDef);
  if (destDef.inputFlow) await ctx.flowEngine.start(ctx, destDef.inputFlow.flowId);

  ctx.emit("telefocus.navigate", { from, to, duration_ms: performance.now() - t0 });
}
```

## Guard router

```ts
// packages/telefocus/src/middleware/guard-router.ts
export const guardRouter = (registry: PageRegistry): Middleware => async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("guard:")) return next();
  const g = ctx.session.navigationGuard;
  if (!g.active) { await ctx.answerCallbackQuery(); return; }

  if (g.confirmationMessageId) {
    await ctx.messages.delete(ctx, g.confirmationMessageId);
  }

  if (data === "guard:confirm") {
    const dest = g.pendingDestination!;
    ctx.session.navigationGuard = { active: false, pendingDestination: null, pendingParams: null, confirmationMessageId: null };
    const resolved = registry.resolve(dest)!;
    await executeNavigate(ctx, registry, ctx.session.menu.currentPage, dest, resolved.def);
  } else {
    ctx.session.navigationGuard = { active: false, pendingDestination: null, pendingParams: null, confirmationMessageId: null };
    ctx.sessionDirty = true;
  }
  await ctx.answerCallbackQuery();
};
```

## Back-button auto-injection

```ts
// packages/telefocus/src/engine/back-button.ts
export function wrapBackButton(def: PageDefinition, kb: InlineKeyboardButton[][]): InlineKeyboardButton[][] {
  if (def.hideBackButton || def.path === "/") return kb;
  const backRow = [{ text: "◀ Back", callback_data: "nav::back" }];
  return [...kb, backRow];
}
```

## Breadcrumb rendering

```ts
// packages/telefocus/src/engine/breadcrumb.ts
export function withBreadcrumb(stack: string[], body: string): string {
  if (stack.length <= 1) return body;
  const segments = stack.map(pathToLabel);  // "/personas/42" → "Stoic Dad"
  const trail = segments.length > 3
    ? `${segments[0]} › … › ${segments[segments.length - 1]}`
    : segments.join(" › ");
  return `<i>${trail}</i>\n\n${body}`;
}
```

`pathToLabel` resolves dynamic segments against `session.pageData` or falls back to the segment string.

## Deep-link handling

```ts
// packages/telefocus/src/nav/deep-link.ts
export async function handleDeepLink(ctx: DopellerCtx, startParam: string): Promise<boolean> {
  const raw = await ctx.redis.get(`deeplink:${startParam}`);
  if (!raw) return false;
  await ctx.redis.del(`deeplink:${startParam}`);  // one-shot
  const payload = JSON.parse(raw) as { pagePath: string; params: Record<string, unknown> };
  ctx.session.pageData[payload.pagePath] = payload.params;
  ctx.sessionDirty = true;
  await ctx.navigate(payload.pagePath, payload.params);
  return true;
}
```

Invoked from the `/start` command handler:

```ts
bot.command("start", async (ctx) => {
  const param = ctx.match;
  if (param && await handleDeepLink(ctx, param)) return;
  await ctx.navigate("/");
});
```

## Pinned mood message

Separate platform-managed message, distinct from the menu.

```ts
// packages/telefocus/src/nav/pinned-mood.ts
export class PinnedMoodManager {
  private readonly rateMs = 2 * 60 * 1000;

  async update(ctx: DopellerCtx, mood: Mood, salientFact: string | null): Promise<void> {
    const key = `pinned:${ctx.bot.id}:${ctx.user.id}`;
    const state = await this.load(key);
    if (state && Date.now() - state.lastEditedAt < this.rateMs) {
      // Coalesce via BullMQ delayed job.
      await this.jobs.add("pinned-mood:update", { key, mood, fact: salientFact }, {
        delay: this.rateMs - (Date.now() - state.lastEditedAt),
        jobId: `pinned:${key}`,  // idempotent
      });
      return;
    }

    const text = formatMoodText(mood, salientFact);
    if (state?.messageId) {
      try {
        await ctx.api.editMessageText(ctx.chat!.id, state.messageId, text, { parse_mode: "HTML" });
      } catch (err) {
        if (isStaleMenuError(err)) await this.repin(ctx, key, text);
        else throw err;
      }
    } else {
      await this.repin(ctx, key, text);
    }
    await this.save(key, { messageId: state?.messageId ?? 0, lastEditedAt: Date.now() });
    ctx.emit("persona.mood.pinned.edited", { mood });
  }

  private async repin(ctx: DopellerCtx, key: string, text: string): Promise<void> {
    const sent = await ctx.api.sendMessage(ctx.chat!.id, text, { parse_mode: "HTML" });
    try {
      await ctx.api.pinChatMessage(ctx.chat!.id, sent.message_id, { disable_notification: true });
    } catch (err) {
      if (isUserUnpinnedError(err)) {
        // Respect user's choice; do not re-pin. Keep the message as plain text.
      } else {
        throw err;
      }
    }
    await this.save(key, { messageId: sent.message_id, lastEditedAt: Date.now() });
  }
}
```

The mood message source is `persona.mood.changed` events (see persona-engine docs) + a high-salience memory hook from Mem0.

## Cross-links

- Blueprint: [07-navigation](../blueprint/05-wave-2-core-engines/telefocus-engine/07-navigation.md)
- Sibling: [06-input-flows.md](06-input-flows.md) · [08-toasts-modals.md](08-toasts-modals.md)
