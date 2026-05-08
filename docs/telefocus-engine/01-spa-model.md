# 01 — SPA-in-Chat: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/01-spa-model.md](../blueprint/05-wave-2-core-engines/telefocus-engine/01-spa-model.md)

This document specifies the runtime invariants that implement the one-menu-message model.

## Engine entrypoint

```ts
// packages/telefocus/src/engine/index.ts
import { Bot, session } from "grammy";
import type { RedisClientType } from "ioredis";

export interface TeleFocusConfig {
  redis: RedisClientType;
  botId: string;
  pageRegistry: PageRegistry;
  i18n: I18nProvider;
  gateway: LlmGatewayClient;
  personaStore: PersonaStore;
  memoryClient: MemoryClient;
}

export function createTeleFocusBot<T extends DopellerCtx>(
  token: string,
  cfg: TeleFocusConfig,
): Bot<T> {
  const bot = new Bot<T>(token);
  installMiddleware(bot, cfg);           // stages 1–23 (see 05)
  installRouters(bot, cfg.pageRegistry); // callback prefix dispatch
  installCommands(bot);                  // /start, /help, /reset
  return bot;
}
```

## Invariants (runtime assertions)

The engine ships with dev-mode assertions that `throw` on invariant break. In production they are replaced by `telefocus.invariant.violated` metric emission and a fatal error.

| # | Invariant | Enforcement |
|---|---|---|
| I1 | `session.menu.messageId` is either null or refers to an owned Telegram message | Outbound stage checks on every edit |
| I2 | At most one message in `session.messages[*]` has `type="INPUT_PROMPT"` with `awaitingInput=true` | `MessageLifecycleManager.send` rejects the second |
| I3 | `session.menu.currentPage ∈ pageRegistry` after every navigation | Navigation router validates before `editMessageText` |
| I4 | `session.inputFlow.active ⇒ inputFlow.flowId ≠ null` | Session-writer validates pre-commit |
| I5 | Menu `messageId` is never registered in `session.messages[*]` | `send()` rejects if `opts.messageId === session.menu.messageId` |

Example enforcement:

```ts
// packages/telefocus/src/engine/invariants.ts
export function assertMenuOwnership(session: UserSession, messageId: number): void {
  if (session.menu.messageId === messageId) {
    throw new InvariantError("I5", `messageId=${messageId} is the menu; cannot register as tracked`);
  }
}
```

## `PageDefinition` registration

```ts
// packages/telefocus/src/pages/registry.ts
export class PageRegistry {
  private map = new Map<string, PageDefinition>();
  private dynamicMatchers: { regex: RegExp; pattern: string }[] = [];

  register(def: PageDefinition): void {
    if (this.map.has(def.path)) {
      throw new Error(`Page already registered: ${def.path}`);
    }
    this.map.set(def.path, def);
    if (def.path.includes(":")) {
      // /personas/:id → /^\/personas\/([^/]+)$/
      const regex = new RegExp("^" + def.path.replace(/:[^/]+/g, "([^/]+)") + "$");
      this.dynamicMatchers.push({ regex, pattern: def.path });
    }
    for (const child of def.children ?? []) this.register(child);
  }

  resolve(path: string): { def: PageDefinition; params: Record<string, string> } | null {
    const exact = this.map.get(path);
    if (exact) return { def: exact, params: {} };

    for (const { regex, pattern } of this.dynamicMatchers) {
      const m = path.match(regex);
      if (!m) continue;
      const def = this.map.get(pattern)!;
      const paramNames = [...pattern.matchAll(/:([^/]+)/g)].map(x => x[1]);
      const params = Object.fromEntries(paramNames.map((n, i) => [n, m[i + 1]]));
      return { def, params };
    }
    return null;
  }
}
```

## `MenuRenderResult` → outbound

```ts
// packages/telefocus/src/engine/render.ts
export async function renderMenu(
  ctx: DopellerCtx,
  def: PageDefinition,
): Promise<void> {
  const result = await def.render(ctx);
  const keyboard = wrapBackButton(def, await def.keyboard(ctx));
  const text = withBreadcrumb(ctx.session.menu.navigationStack, result.text);

  if (ctx.session.menu.messageId == null) {
    const sent = await ctx.api.sendMessage(ctx.chat.id, text, {
      parse_mode: result.parseMode,
      reply_markup: { inline_keyboard: keyboard },
    });
    ctx.session.menu.messageId = sent.message_id;
    ctx.sessionDirty = true;
  } else {
    try {
      await ctx.api.editMessageText(ctx.chat.id, ctx.session.menu.messageId, text, {
        parse_mode: result.parseMode,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (err) {
      if (isStaleMenuError(err)) {
        await recoverStaleMenu(ctx, text, result.parseMode, keyboard);
      } else {
        throw err;
      }
    }
  }
}
```

Edit-rate protection is handled in the outbound stage (see [05](05-middleware-pipeline.md)).

## Worked example — `/start` to `/settings/preferences/theme/dark`

```ts
// Incoming: message "/start"
// Pipeline stages 1–16 resolve; stage 17 runs homePage.render(ctx):
const homePage: PageDefinition = {
  path: "/",
  render: (ctx) => ({
    text: `<b>👋 Welcome</b>\n\nPick a section below.`,
    parseMode: "HTML",
  }),
  keyboard: () => kb
    .row(kb.nav("⚙ Settings", "/settings"))
    .row(kb.nav("🎭 Personas", "/personas"))
    .row(kb.nav("❓ Help", "/help"))
    .done(),
};
// → sendMessage, messageId=42 stored in session.menu.messageId.

// Incoming: callback_query "nav:/settings"
// Navigation router at stage 11 runs:
//   A.onExit(ctx) → ()
//   cleanupScope("/")
//   session.menu.currentPage = "/settings"
//   session.menu.navigationStack.push("/settings")
//   B.onEnter(ctx) → ()
//   renderMenu(ctx, settingsDef) → editMessageText m=42

// Continues for each tap. The chat retains: [user /start, menu m=42].
```

## Runtime consequences of the metaphor

- **No declarative re-render.** There is no `subscribe()` or effect system. Every state change that needs UI must explicitly call `renderMenu()` or `ctx.messages.send(...)`.
- **Edit rate cap.** Telegram limits `editMessageText` to ~1/s per chat. The outbound stage (see [05](05-middleware-pipeline.md)) coalesces sub-second edits into a single trailing write.
- **Callback payload cap (64 B).** `kb.nav(label, path)` throws at construction if the encoded data exceeds 64 bytes; runtime truncation is never allowed.

## Cross-links

- Blueprint: [01-spa-model](../blueprint/05-wave-2-core-engines/telefocus-engine/01-spa-model.md)
- Sibling: [02-session-state.md](02-session-state.md) · [07-navigation.md](07-navigation.md) · [10-developer-api.md](10-developer-api.md)
