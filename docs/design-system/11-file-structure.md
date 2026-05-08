# 11 — File Structure

> Canonical project layout for the TeleFocus engine and its consumers.
> This is the shape every Dopeller bot, Mini App, and framework module
> ships in.
>
> **Contract:** [blueprint/07/design-system/11-file-structure.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/11-file-structure.md).
> **Up:** [01-overview](01-overview.md).

---

## Monorepo root

```
dopeller/
├── apps/
│   ├── manager-bot/              ← @dopeller_manager_bot
│   ├── dashboard-mini-app/       ← Creator Dashboard Mini App
│   └── uncensored-mini-app/      ← MSISDN-gated tier surface
├── packages/
│   ├── telefocus/                ← the engine (this spec)
│   ├── miniapp-starter/          ← scaffold for new Mini Apps
│   ├── types/                    ← shared TS types
│   ├── ui-kit/                   ← Telegram-native React components
│   └── telegram-sdk/             ← grammY wrapper with our types
├── src/
│   └── modules/
│       ├── bot-factory/
│       ├── persona-engine/
│       ├── llm-gateway/
│       ├── monetization/
│       ├── analytics/
│       ├── miniapp/
│       ├── webhook-gateway/
│       ├── heartbeat/
│       └── i18n/
├── docs/                          ← blueprint + design-system
├── infra/
│   ├── docker/
│   ├── grafana/
│   └── terraform/
├── scripts/
│   └── redis-lua/                ← atomic scripts (version-guard, sweep)
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

## `packages/telefocus/`

```
packages/telefocus/
├── src/
│   ├── index.ts                   ← public API re-exports
│   ├── bootstrap.ts               ← TeleFocus.attach(bot, opts)
│   ├── registry/
│   │   ├── page-registry.ts
│   │   └── types.ts               ← PageDefinition, MenuBody
│   ├── router/
│   │   ├── navigate.ts
│   │   ├── back.ts
│   │   ├── guard.ts
│   │   └── deep-link.ts
│   ├── renderer/
│   │   ├── menu-renderer.ts
│   │   └── dedupe.ts
│   ├── messages/
│   │   ├── send.ts                ← typed send + replacePrevious
│   │   ├── toast.ts
│   │   ├── modal.ts
│   │   ├── invoice.ts
│   │   ├── tracking.ts            ← TrackedMessage CRUD
│   │   └── sanitise.ts            ← escapeHtml
│   ├── input-flow/
│   │   ├── engine.ts
│   │   ├── validators.ts
│   │   ├── progress-indicator.ts
│   │   └── types.ts
│   ├── middleware/
│   │   ├── error-boundary.ts
│   │   ├── status-gate.ts
│   │   ├── session-loader.ts
│   │   ├── rate-limit.ts
│   │   ├── language-enforcement.ts
│   │   ├── memory-prefetch.ts
│   │   ├── persona-signal.ts
│   │   ├── input-capture.ts
│   │   ├── router.ts
│   │   ├── analytics-fanout.ts
│   │   ├── session-save.ts
│   │   └── types.ts
│   ├── errors/
│   │   ├── errors.ts              ← DopellerError class
│   │   ├── templates.ts
│   │   └── render.ts
│   ├── session/
│   │   ├── store.ts               ← SessionStore (Redis)
│   │   ├── schema.ts              ← UserSession, TrackedMessage, …
│   │   └── version-guard.lua
│   └── testing/
│       ├── test-ctx.ts
│       └── mocks.ts
├── tests/
│   ├── session.test.ts
│   ├── renderer.test.ts
│   ├── input-flow.test.ts
│   └── router.test.ts
├── package.json
└── tsconfig.json
```

## `apps/manager-bot/`

```
apps/manager-bot/
├── src/
│   ├── main.ts                    ← composition root
│   ├── pages/
│   │   ├── creator/
│   │   │   ├── welcome.ts
│   │   │   ├── forge.ts
│   │   │   ├── pricing.ts
│   │   │   ├── free-tier.ts
│   │   │   └── dashboard.ts
│   │   ├── onboarding/
│   │   │   ├── language.ts
│   │   │   ├── gender.ts
│   │   │   └── quiz.ts            ← Soul Quiz flow
│   │   └── billing/
│   │       └── top-up.ts
│   ├── actions/
│   │   ├── pricing-actions.ts
│   │   ├── bot-actions.ts         ← pause/resume/delete
│   │   └── billing-actions.ts
│   ├── commands/
│   │   └── map.ts
│   └── services/
│       ├── index.ts               ← buildServices()
│       ├── billing.ts
│       ├── persona.ts
│       └── instance-manager.ts
├── config/
│   └── env.ts                     ← Zod-validated
├── package.json
└── tsconfig.json
```

## `apps/dashboard-mini-app/`

Shape specified in the telegram-mini-apps folder (consumer of
`packages/miniapp-starter`, uses `packages/ui-kit` for components).

## `src/modules/`

Each subsystem has its own folder; shape example:

```
src/modules/bot-factory/
├── lifecycle-state-machine.ts
├── instance-manager.ts
├── health-monitor/
│   ├── probe-workers.ts
│   └── state-transition.ts
├── webhook-gateway/
│   ├── server.ts
│   └── routing-table.ts
└── rybbit-provisioner.ts
```

## Conventions

### Folder layout

- **Feature folders, not layer folders.** `pages/creator/pricing.ts` is
  better than `pages/pricing.ts` + `handlers/pricing.ts` +
  `services/pricing.ts` in flat layer directories.
- **Colocate tests** at `feature/__tests__/` **or** under
  `tests/unit/feature/`. Pick one per repo and stick with it.
- **Barrel `index.ts`** files only at package boundaries
  (`packages/*/src/index.ts`), not in every folder.

### File size

- **Typical:** 200 – 400 lines.
- **Max:** 800 lines (lint rule `file-max-lines`).
- At the max, split by responsibility.

### Naming

| Artifact | Convention | Example |
|---|---|---|
| Files (TS) | `kebab-case.ts` | `menu-renderer.ts` |
| Files (React) | `PascalCase.tsx` | `SurfaceCard.tsx` |
| Classes / types / interfaces | `PascalCase` | `InputFlowEngine` |
| Functions / variables | `camelCase` | `navigateTo` |
| Constants | `UPPER_SNAKE_CASE` | `DEFAULT_TTL` |
| React hooks | `useCamelCase.ts` | `useReducedMotion.ts` |

### Imports

- **Absolute from package root**: `@dopeller/telefocus` (public),
  `@/…` (app-internal alias).
- No deep-reach into other packages (`@dopeller/telefocus/src/internal/*`
  is banned by a lint rule — use the public re-exports).

### Config

- Per app: `config/env.ts`, validated with Zod at startup.
- Fail fast on missing required env vars — log the missing names and
  exit non-zero before the bot binds its webhook.

## Success criteria

- [ ] A new consumer app can register its pages and spin up a TeleFocus bot in < 200 lines of glue.
- [ ] The engine package (`packages/telefocus`) has no dependencies on specific bot apps.
- [ ] No file exceeds 800 lines (lint rule).
- [ ] Feature folders group all concerns for a given screen.
