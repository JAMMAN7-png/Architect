# 09 — Developer API

> What a creator writes on top of TeleFocus. The developer surface is
> small and stable: **pages**, **actions**, **commands**, **services**.
> Everything else is the engine.
>
> **Contract:** [blueprint/07/design-system/09-developer-api.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/09-developer-api.md).
> **Up:** [01-overview](01-overview.md).

---

## Four extension points

| # | Point | Defines |
|---|---|---|
| 1 | **Pages** | Declarative screens — path, render, keyboard, optional input flow |
| 2 | **Actions** | Callback handlers for `action:<domain>:<verb>` |
| 3 | **Commands** | Bound to `/slash` commands |
| 4 | **Services** | Domain singletons injected into handlers |

Everything else — session, navigation, messages, toasts, errors — is
handled by the engine.

## Public exports

```typescript
// packages/telefocus/src/index.ts
export type {
  PageDefinition, MenuBody,
  InputFlowDefinition, InputFlowStep, ValidationRule,
  SendOptions, TrackedMessage,
  UserSession, InputFlowState,
  DopellerError, Severity,
  Ctx, NextFn, Services,
} from './types';

export { registry }                        from './registry/page-registry';
export { navigateTo, goBack }              from './router';
export { send, replacePrevious }           from './messages/send';
export { toast }                           from './messages/toast';
export { modal }                           from './messages/modal';
export { invoice }                         from './messages/invoice';
export { InputFlowEngine }                 from './input-flow/engine';
export { MenuRenderer }                    from './renderer/menu-renderer';
export { TeleFocus }                       from './bootstrap';
```

## 1. Defining a page

```typescript
// apps/manager-bot/src/pages/creator/pricing.ts
import type { PageDefinition } from '@dopeller/telefocus';

export const pricingPage: PageDefinition = {
  path: '/creator/pricing',
  parent: '/creator/dashboard',
  render: (session) => {
    const { tier = 'free' } = session.pageData['/creator/pricing'] ?? {};
    return {
      text: `💰 <b>Pricing</b>\nCurrent tier: <b>${tier}</b>`,
      parseMode: 'HTML',
    };
  },
  keyboard: (session) => {
    const current = (session.pageData['/creator/pricing']?.tier as string) ?? 'free';
    const mark = (t: string) => current === t ? '✅' : '○';
    return [
      [{ text: `${mark('free')}  Free`,  callback_data: 'action:pricing:set:free'  }],
      [{ text: `${mark('basic')} Basic`, callback_data: 'action:pricing:set:basic' }],
      [{ text: `${mark('pro')}   Pro`,   callback_data: 'action:pricing:set:pro'   }],
      [{ text: '← Back', callback_data: 'nav:back' }],
    ];
  },
};
```

Register into the page tree:

```typescript
// apps/manager-bot/src/main.ts
registry.registerTree({
  path: '/creator',
  parent: '/',
  render: welcomePage.render,
  keyboard: welcomePage.keyboard,
  children: [pricingPage, forgePage, dashboardPage, freeTierPage],
});
```

## 2. Defining actions

Actions handle `action:<domain>:<verb>[:<arg>]` callbacks.

```typescript
// apps/manager-bot/src/actions/pricing-actions.ts
import type { Bot } from 'grammy';
import { toast, renderer } from '@dopeller/telefocus';
import type { Services } from '../services';

export function registerPricingActions(bot: Bot, services: Services) {
  bot.callbackQuery(/^action:pricing:set:(free|basic|pro)$/, async (ctx) => {
    const tier = ctx.match![1];
    ctx.session.pageData['/creator/pricing'] = { tier };
    await services.billing.setTier(ctx.session.userId, tier);
    await toast.info(ctx, `Pricing set to ${tier}.`);
    await renderer.rerender(ctx);
  });
}
```

### Action rules

- Keep handlers **thin** — do the work in a service.
- Always finish with a toast or a `navigateTo` — no silent success.
- Never call `ctx.api.sendMessage` directly.
- Update `pageData` before re-render so the new view reflects the action.

## 3. Defining commands

```typescript
// apps/manager-bot/src/commands/map.ts
import type { Bot } from 'grammy';
import { navigateTo } from '@dopeller/telefocus';

export function registerCommands(bot: Bot) {
  bot.command('dashboard', (ctx) => navigateTo(ctx, '/creator/dashboard'));
  bot.command('billing',   (ctx) => navigateTo(ctx, '/billing/top-up'));
  bot.command('menu',      (ctx) => navigateTo(ctx, '/'));
}
```

The engine normalises `/command @botname` → `/command` in group
contexts.

## 4. Services

A service is a plain class injected at composition root. It **never**
touches Telegram directly — handlers do.

```typescript
// apps/manager-bot/src/services/billing.ts
import type { Database } from '@dopeller/persistence';

export class BillingService {
  constructor(private db: Database) {}

  async setTier(userId: number, tier: string): Promise<void> {
    await this.db.users.update(userId, { tier });
  }

  async chargeStars(userId: number, amountXtr: number): Promise<void> {
    // …
  }
}

export interface Services {
  billing: BillingService;
  persona: PersonaService;
  instanceManager: InstanceManagerService;
}
```

Handlers consume via the context:

```typescript
bot.callbackQuery(/^action:bot:pause$/, async (ctx) => {
  await services.instanceManager.pause(ctx.session.userId);
  await toast.info(ctx, 'Bot paused.');
});
```

## The developer contract

A consumer's code **must**:

- Register every page in the registry (lint-checked at build).
- Never call `ctx.api.sendMessage` directly (ESLint rule `telefocus/no-raw-send`).
- Never mutate `session.menu.*` directly (ESLint rule `telefocus/no-menu-mutation`).
- Always pass `scope` to `send` when outside the current page.
- Always fire a toast or nav after an action — no silent success.

## Bootstrap shape

```typescript
// apps/manager-bot/src/main.ts
import { Bot } from 'grammy';
import { TeleFocus } from '@dopeller/telefocus';
import { registerPricingActions } from './actions/pricing-actions';
import { registerCommands } from './commands/map';
import { buildServices } from './services';

const bot = new Bot(process.env.BOT_TOKEN!);

const telefocus = TeleFocus.attach(bot, {
  redis:    redisClient,
  botId:    'manager_bot',
  pages:    [welcomePage, pricingPage, forgePage, dashboardPage, /* … */],
  commands: [],        // registered below
});

const services = buildServices();
registerPricingActions(bot, services);
registerCommands(bot);

bot.start();
```

## Testing helpers

`@dopeller/telefocus/testing` fakes session, Telegram calls, and time.

```typescript
// apps/manager-bot/src/actions/__tests__/pricing-actions.test.ts
import { describe, test, expect } from 'bun:test';
import { TestCtx } from '@dopeller/telefocus/testing';
import { registerPricingActions } from '../pricing-actions';

describe('pricing actions', () => {
  test('setTier updates pageData and toasts', async () => {
    const ctx = TestCtx.newAt('/creator/pricing');
    await ctx.fireCallback('action:pricing:set:basic');
    expect(ctx.session.pageData['/creator/pricing']).toEqual({ tier: 'basic' });
    expect(ctx.lastToast).toEqual({ subtype: 'INFO', text: 'Pricing set to basic.' });
    expect(ctx.menu.lastEdit).toMatchObject({ text: expect.stringContaining('basic') });
  });
});
```

## Versioning

The developer API follows **semver**. Breaking changes (e.g. renaming
`PageDefinition.render` signature) bump major. The current version is
exported at runtime:

```typescript
import { TeleFocus } from '@dopeller/telefocus';
console.log(TeleFocus.version); // "1.4.2"
```

## Success criteria

- [ ] A new page + action + service can be added by a creator in < 100 lines with no engine changes.
- [ ] Lint rules prevent bypass (no raw `sendMessage`, no direct `session.menu` mutation).
- [ ] `TestCtx` supports 90% of handler tests without a running Telegram.
- [ ] API surface documented and exported from a single `@dopeller/telefocus` package.
