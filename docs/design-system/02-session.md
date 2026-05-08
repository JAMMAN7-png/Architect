# 02 — Session Model

> One Redis key per (bot, user). Carries menu state, tracked messages,
> input-flow state, navigation-guard state, and per-page scratch data.
>
> **Contract:** [blueprint/07/design-system/02-session.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/02-session.md).
> **Up:** [01-overview](01-overview.md).

---

## Key shape

Per-user, per-bot:

```
bot:{bot_user_id}:sessions:{user_id}
```

The `bot:` prefix enforces multi-bot isolation (no cross-bot leakage).

## Schema

```typescript
// packages/telefocus/src/session/schema.ts

export interface UserSession {
  userId: number;
  chatId: number;

  // ── Menu state ─────────────────────────────────────────
  menu: {
    messageId: number | null;        // THE menu message
    currentPage: string;             // e.g. "/personas/create"
    previousPage: string | null;     // immediate parent for Back
    navigationStack: string[];       // full breadcrumb
    lastAction?: string;             // for dedupe
    lastActionAt?: number;           // epoch ms
  };

  // ── Tracked messages, grouped by page scope ───────────
  messages: Record<string /* pagePath */, TrackedMessage[]>;

  // ── Input flow state ──────────────────────────────────
  inputFlow: InputFlowState;

  // ── Navigation guard ──────────────────────────────────
  navigationGuard: {
    active: boolean;
    pendingDestination: string | null;
    confirmationMessageId: number | null;
  };

  // ── Per-page scratch data ─────────────────────────────
  pageData: Record<string /* pagePath */, Record<string, unknown>>;

  // ── Locale / persona signals (populated by middleware) ─
  language?: string;                 // "en" | "ru" | …
  personality?: PersonalityVector;
  memories?: Mem0Result[];

  // ── Timestamps ────────────────────────────────────────
  createdAt: number;
  lastInteractionAt: number;
  version: number;                   // for version-guarded writes
}

export interface TrackedMessage {
  messageId: number;
  type: 'MENU' | 'EPHEMERAL' | 'INTERACTIVE' | 'INPUT_PROMPT' | 'INPUT_PROGRESS';
  subtype?: 'INFO' | 'WARNING' | 'DANGER' | 'CONFIRMATION' | 'MODAL';
  pagePath: string;                  // scope
  createdAt: number;                 // epoch ms
  expiresAt?: number;                // optional TTL
  metadata?: Record<string, unknown>;
}

export interface InputFlowState {
  active: boolean;
  pagePath: string | null;
  flowId: string | null;
  currentStep: number;
  totalSteps: number;
  collectedData: Record<string, unknown>;
  promptMessageId: number | null;
  progressMessageId: number | null;
  awaitingInput: boolean;
  inputType: 'text' | 'number' | 'selection' | 'photo' | 'voice' | 'location' | 'contact' | null;
  validationRules: ValidationRule | null;
  retries: number;
}

export interface ValidationRule {
  type: 'text' | 'number' | 'choice' | 'regex' | 'custom';
  min?: number;
  max?: number;
  pattern?: string;                  // serialised regex
  choices?: string[];
  errorMessage: string;
}
```

## Concrete example

A user mid-way through creating their first agent:

```json
{
  "userId": 10293847,
  "chatId": 10293847,
  "menu": {
    "messageId": 7421,
    "currentPage": "/creator/forge",
    "previousPage": "/creator/welcome",
    "navigationStack": ["/", "/creator/welcome", "/creator/forge"],
    "lastAction": "nav:/creator/forge",
    "lastActionAt": 1745498100000
  },
  "messages": {
    "/creator/forge": [
      { "messageId": 7422, "type": "INPUT_PROGRESS", "pagePath": "/creator/forge", "createdAt": 1745498101000 },
      { "messageId": 7423, "type": "INPUT_PROMPT",   "pagePath": "/creator/forge", "createdAt": 1745498102000 }
    ]
  },
  "inputFlow": {
    "active": true,
    "pagePath": "/creator/forge",
    "flowId": "creator_forge",
    "currentStep": 1,
    "totalSteps": 4,
    "collectedData": { "name": "Crypto Sage" },
    "promptMessageId": 7423,
    "progressMessageId": 7422,
    "awaitingInput": true,
    "inputType": "text",
    "validationRules": { "type": "text", "min": 4, "max": 80, "errorMessage": "Tone must be 4-80 chars." },
    "retries": 0
  },
  "navigationGuard": { "active": false, "pendingDestination": null, "confirmationMessageId": null },
  "pageData": { "/creator/forge": { "coverPhotoId": null } },
  "language": "en",
  "createdAt": 1745497800000,
  "lastInteractionAt": 1745498102000,
  "version": 14
}
```

## TTL policy

| Scope | TTL | Refresh |
|---|---|---|
| Session (Redis key) | 24 h inactivity | Every interaction |
| `EPHEMERAL` messages | 5 s default (overridable per subtype — see [04-messages](04-messages.md)) | — |
| `MENU` | none (re-rendered in place) | — |
| `INTERACTIVE` | none (until dismissed or nav) | — |

Two cleanup paths:

- **Active.** A per-bot BullMQ repeatable job `session-sweep:{bot_id}`
  runs every 60 s, scans for `expiresAt <= now`, calls `deleteMessage`,
  removes the entry.
- **Lazy.** On every incoming update, the session-loader middleware
  drops expired entries before routing.

## Recovery paths

### Stale menu ID

User deleted the menu message manually. First `editMessageText` returns
`400: message to edit not found`. The engine:

1. Catches the error.
2. Sends a fresh menu.
3. Updates `session.menu.messageId`.
4. Retries the user's original action against the new ID.

### Session clobber (corrupt JSON)

```typescript
try {
  session = JSON.parse(raw);
} catch {
  logger.error('session_corrupt', { key });
  session = newSession(userId, chatId);
  await toast.warning(ctx, 'I had to reset the canvas — one moment.');
}
```

### Bot restart

Sessions survive — they live in Redis. On the next update for a user,
the session is rehydrated lazily.

## Concurrency — version-guarded writes

Every session write is conditional on the version seen at read. Writes
run through a Lua script:

```lua
-- packages/telefocus/src/session/version-guard.lua
-- KEYS[1] = session key
-- ARGV[1] = expected version (int, as string)
-- ARGV[2] = new JSON payload
-- ARGV[3] = new version (int, as string)
local current = redis.call("HGET", KEYS[1], "version")
if current == false or current == ARGV[1] then
  redis.call("HSET", KEYS[1], "payload", ARGV[2], "version", ARGV[3])
  redis.call("EXPIRE", KEYS[1], 86400)
  return 1
else
  return 0
end
```

If the write returns `0`, the handler re-reads, re-plays against the
fresh state, and retries (up to 3 times). No session field is ever
mutated across callbacks without this guard.

## Store API

```typescript
// packages/telefocus/src/session/store.ts
export class SessionStore {
  constructor(private redis: Redis, private botId: string) {}

  key(userId: number): string {
    return `bot:${this.botId}:sessions:${userId}`;
  }

  async load(userId: number, chatId: number): Promise<UserSession> { /* … */ }
  async save(session: UserSession): Promise<boolean> { /* returns false on version mismatch */ }
  async delete(userId: number): Promise<void> { /* … */ }
}
```

## `pageData` rules

- Ephemeral per-page scratch only.
- Keyed by page path to avoid collisions.
- Anything that must persist past 24 h **must** go in Postgres or the
  persona store — not here.

Good:
```typescript
ctx.session.pageData['/creator/pricing'] = { tier: 'basic' };
```

Bad (long-lived data):
```typescript
ctx.session.pageData['/creator/forge'] = { finalPersonaId: 'abc123' }; // ❌ persist to DB
```

## Success criteria

- [ ] Session rehydration p95 < 20 ms.
- [ ] Stale menu ID recovered within one interaction.
- [ ] Tracked-message sweeps never miss an expired TTL by > 60 s.
- [ ] Concurrent writes never corrupt state (version-guard enforced).
