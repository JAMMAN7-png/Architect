# 05 — Input-Flow Engine

> A finite, linear state machine over a sequence of prompts. Every
> multi-step wizard in Dopeller — persona creation, pricing, roleplay
> teaching, the Soul Quiz — is an input flow.
>
> **Contract:** [blueprint/07/design-system/05-input-flows.md](../blueprint/07-wave-4-creator-and-user-experience/design-system/05-input-flows.md).
> **Up:** [01-overview](01-overview.md).
> **Depends on:** [02-session](02-session.md), [04-messages](04-messages.md).

---

## Mental model

Session holds four facts at any point in a flow:

| Field | Meaning |
|---|---|
| `flowId` | Which flow |
| `currentStep` | Which step index |
| `collectedData` | What's been captured |
| `awaitingInput` | Are we listening for the user? |

Navigating away mid-flow triggers a **navigation guard** (see
[06-navigation](06-navigation.md)). Completing fires the flow's
`onComplete`.

## Flow definition

```typescript
// packages/telefocus/src/input-flow/types.ts

export interface InputFlowDefinition {
  flowId: string;                                    // "creator_forge"
  steps: InputFlowStep[];
  onComplete(collected: Record<string, unknown>, ctx: Ctx): Promise<void>;
  onCancel?(collected: Record<string, unknown>, ctx: Ctx): Promise<void>;
  maxRetries?: number;                               // default 3
}

export interface InputFlowStep {
  field: string;                                     // key in collectedData
  prompt: string;                                    // question text
  inputType:
    | 'text' | 'number' | 'selection'
    | 'photo' | 'voice' | 'location' | 'contact';
  validation: ValidationRule;
  choices?: { label: string; value: string }[];     // for `selection`
  placeholder?: string;                              // forceReply placeholder
  skipIf?(collected: Record<string, unknown>): boolean;
  formatPrompt?(collected: Record<string, unknown>): string;
}

export interface ValidationRule {
  type: 'text' | 'number' | 'choice' | 'regex' | 'custom';
  min?: number;
  max?: number;
  pattern?: RegExp;
  choices?: string[];
  custom?(value: unknown): true | string;
  errorMessage: string;
}
```

## Engine API

```typescript
// packages/telefocus/src/input-flow/engine.ts
export class InputFlowEngine {
  async start(flowId: string, ctx: Ctx): Promise<void>;
  async capture(ctx: Ctx): Promise<'advanced' | 'rejected' | 'completed'>;
  async cancel(ctx: Ctx): Promise<void>;
  async resume(ctx: Ctx): Promise<void>;            // after restart
}
```

## Concrete example — `creator_forge`

```typescript
// apps/manager-bot/src/pages/creator/forge.ts
import type { InputFlowDefinition } from '@dopeller/telefocus';

export const creatorForgeFlow: InputFlowDefinition = {
  flowId: 'creator_forge',
  steps: [
    {
      field: 'name',
      prompt: "What's your agent's name?",
      inputType: 'text',
      placeholder: 'Crypto Sage',
      validation: {
        type: 'text',
        min: 2,
        max: 32,
        pattern: /^[\p{L}\p{N} _-]+$/u,
        errorMessage: 'Letters, numbers, spaces, dashes. 2–32 chars.',
      },
    },
    {
      field: 'tone',
      prompt: 'Pick a tone',
      inputType: 'selection',
      choices: [
        { label: '🎩 Formal',    value: 'formal' },
        { label: '😎 Casual',    value: 'casual' },
        { label: '🤓 Nerdy',     value: 'nerdy' },
        { label: '🔥 Spicy',     value: 'spicy' },
      ],
      validation: { type: 'choice', choices: ['formal', 'casual', 'nerdy', 'spicy'], errorMessage: 'Pick one.' },
    },
    {
      field: 'bio',
      prompt: (c) => `Great. Now a short bio for ${c.name}.`,
      inputType: 'text',
      validation: { type: 'text', min: 20, max: 280, errorMessage: '20–280 chars.' },
      formatPrompt: (c) => `Great. Now a short bio for <b>${c.name}</b>.`,
    },
    {
      field: 'cover',
      prompt: 'Upload a cover photo (optional)',
      inputType: 'photo',
      validation: { type: 'custom', custom: () => true, errorMessage: '' },
      skipIf: (c) => c.tone === 'formal', // formal personas don't need cover
    },
  ],
  onComplete: async (collected, ctx) => {
    const persona = await services.persona.create(ctx.session.userId, collected);
    await toast.info(ctx, '🎉 Agent created!');
    await navigateTo(ctx, `/personas/${persona.id}`);
  },
  onCancel: async (_collected, ctx) => {
    await toast.warning(ctx, 'Agent creation cancelled.');
  },
};
```

## Lifecycle

```
onEnter(page) detects inputFlow → engine.start(flowId)
       │
       ▼
 set session.inputFlow.active = true, step = 0
 send INPUT_PROGRESS  ( "Step 1 of 4" )
 send INPUT_PROMPT    ( step.prompt, force_reply )
       │
       ▼
user reply arrives ─── captured by input-capture middleware
       │
       ▼
 validate(raw)  ── fail → edit prompt with errorMessage,
                         delete user reply, STAY active
 validate(parsed) ─ fail → same: edit prompt + delete reply, STAY
       │
       ▼
 collectedData[step.field] = parsed
 ctx.api.deleteMessage(userReplyId)          // keep chat clean
 step++
 if step < steps.length:
    edit INPUT_PROGRESS in place             // "Step 2 of 4 · Name ✓"
    edit INPUT_PROMPT to next step           // or send new if type changes
 else:
    await onComplete(collectedData, ctx)
    reset session.inputFlow
```

## Input types

### `text`

`force_reply: true` with `input_field_placeholder`. Validation covers
length and pattern.

### `number`

Same UX; validator parses with `Number()` and enforces `min`/`max`.
Rejects `NaN` with a DANGER toast.

### `selection`

Renders an inline keyboard from `choices`. User taps — no typed reply
needed. For long lists (> 8), paginate; for multi-select, use a
Telegram poll.

### `photo` / `voice` / `location` / `contact`

Captured via Telegram's native media / location / contact requests.
Validation runs on metadata (size, mime) and coordinates (bounding
box).

## Progress indicator

A single `INPUT_PROGRESS` message, edited in place:

```
Step 2 of 4 · Name ✓ · Tone ✓
                    [❌ Cancel]
```

Rendered above the current prompt. The implicit `[❌ Cancel]` button
calls `engine.cancel()`.

## Cancel path

Tapping Cancel (or the nav-guard `Leave`):

1. `onCancel(collectedData)` if defined.
2. Reset `session.inputFlow`.
3. Navigate back to the page's parent.
4. Scope-cleanup removes prompt + progress messages.

## Out-of-context text

If `inputFlow.active` is false and a free-text message arrives, the
router decides:

- Is it a known command? → route to command handler.
- Otherwise → WARNING ephemeral *"I'm not expecting input here."*, no
  effect on session.

## Validation never closes the flow

Validation errors do **not** cancel the flow. The engine edits the
existing prompt in place to prepend the validator's `errorMessage`,
then keeps `session.inputFlow.active === true` and waits for another
reply.

- The user's invalid reply is deleted best-effort by the input-flow engine after each capture (success or failure).
- The prompt edit looks like: `errorMessage + "\n\n" + step.prompt`.
- The only paths that clear `session.inputFlow.active`:
  - explicit user cancel via `action:engine:flow:cancel`
  - any `nav:*` callback (mid-flow navigation cancels first, navigates second)
  - `/start` tear-down
  - successful `onComplete`
- `maxRetries` is now **advisory metadata** only; the engine does NOT auto-cancel on retry exhaustion. Pages that want a hard ceiling MUST implement it inside their validator.

| Scenario | Policy |
|---|---|
| Validator rejects input | Edit prompt with `errorMessage`, delete user reply, stay active. |
| User replies too late (wrong step) | WARNING toast, re-render current prompt. |
| Engine restart mid-flow | Session survives; `engine.resume(ctx)` on next update re-renders the current step. |
| TTL on prompt expires (> 24 h) | Session itself expires; user restarts fresh on return. |

## Prompt lives in the menu

The renderer's locked-body branch surfaces the active prompt **inside the
menu message itself**. Pages MUST NOT send a separate ephemeral as the
prompt — they declare an `inputFlow` and let the engine render the
prompt inline by editing the menu.

- New prompts: edit the existing menu, do not send a new message.
- Cancel button on the locked menu calls `action:engine:flow:cancel`.
- See [03-menu.md](03-menu.md) §Menu reflects state for the lock contract.

## Soul Quiz integration

The Soul Quiz is the most complex flow on the platform. It uses all of:

- `selection` with pre-generated answers per question.
- `skipIf` for adaptive branches.
- `formatPrompt` to style each question to prior answers.
- `onComplete` writes the trait vector to the Persona Engine.

Source: `apps/manager-bot/src/pages/onboarding/quiz.ts`.

## Success criteria

- [ ] A 4-step flow can be defined in < 80 lines.
- [ ] Invalid input never kills the flow; always gives a retry path.
- [ ] Nav-guarded flows never lose data to a stray Back click.
- [ ] Progress indicator stays at one message, updated in place.
