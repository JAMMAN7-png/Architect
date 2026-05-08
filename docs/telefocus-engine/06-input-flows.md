# 06 — Input Flows: Implementation

> **Blueprint contract:** [../blueprint/05-wave-2-core-engines/telefocus-engine/06-input-flows.md](../blueprint/05-wave-2-core-engines/telefocus-engine/06-input-flows.md)

## Types

```ts
// packages/telefocus/src/flow/types.ts
export interface InputFlowDefinition {
  flowId: string;
  steps: InputFlowStep[];
  onComplete?: (ctx: DopellerCtx, data: Record<string, unknown>) => Promise<void>;
  onCancel?: (ctx: DopellerCtx, partial: Record<string, unknown>) => Promise<void>;
  renderProgress?: (data: Record<string, unknown>, step: number, total: number) => string;
}

export interface InputFlowStep {
  field: string;
  prompt: string;
  inputType: "text" | "selection";
  validation?: ValidationRule;
  choices?: { label: string; value: string }[];
  timeoutSec?: number;
  skippable?: boolean;
  transform?: (raw: unknown) => unknown;
  shouldSkip?: (collected: Record<string, unknown>) => boolean;
}

export interface ValidationRule {
  type: "text" | "number" | "choice" | "regex" | "custom";
  min?: number;
  max?: number;
  pattern?: string;
  choices?: string[];
  custom?: (value: unknown) => Promise<{ ok: boolean; error?: string }>;
  errorMessage: string;
}
```

## Flow engine

```ts
// packages/telefocus/src/flow/engine.ts
export class InputFlowEngine {
  constructor(
    private registry: Map<string, InputFlowDefinition>,
    private lifecycle: MessageLifecycleManager,
    private scheduler: TtlScheduler,
    private jobs: BullQueue,
  ) {}

  async start(ctx: DopellerCtx, flowId: string): Promise<void> {
    const def = this.registry.get(flowId);
    if (!def) throw new Error(`Flow not registered: ${flowId}`);

    ctx.session.inputFlow = {
      active: true,
      pagePath: ctx.session.menu.currentPage,
      flowId,
      ownerUserId: ctx.from!.id,
      currentStep: 0,
      totalSteps: def.steps.length,
      collectedData: {},
      promptMessageId: null,
      progressMessageId: null,
      awaitingInput: false,
      inputType: null,
      validationRules: null,
    };
    ctx.sessionDirty = true;
    await this.renderStep(ctx, def, 0);
  }

  async capture(ctx: DopellerCtx, rawValue: unknown): Promise<void> {
    const state = ctx.session.inputFlow;
    if (!state.active || state.ownerUserId !== ctx.from!.id) return;

    const def = this.registry.get(state.flowId!)!;
    const step = def.steps[state.currentStep];
    const validation = await this.validate(rawValue, step.validation);
    if (!validation.ok) {
      await this.lifecycle.toast(ctx, validation.error!, { subtype: "DANGER", ttl: 6 });
      return;  // stay on same step, awaitingInput remains true
    }

    // Delete the user's text message if possible (text flows only).
    if (step.inputType === "text" && ctx.message?.message_id) {
      try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message.message_id); } catch {}
    }

    const value = step.transform ? step.transform(rawValue) : rawValue;
    state.collectedData[step.field] = value;
    state.currentStep++;
    state.awaitingInput = false;
    ctx.sessionDirty = true;

    if (state.currentStep >= state.totalSteps) {
      await this.finish(ctx, def, "complete");
    } else {
      await this.renderStep(ctx, def, state.currentStep);
    }
  }

  private async renderStep(ctx: DopellerCtx, def: InputFlowDefinition, idx: number): Promise<void> {
    const step = def.steps[idx];
    if (step.shouldSkip?.(ctx.session.inputFlow.collectedData)) {
      ctx.session.inputFlow.currentStep++;
      ctx.sessionDirty = true;
      return this.renderStep(ctx, def, ctx.session.inputFlow.currentStep);
    }

    const keyboard = step.inputType === "selection"
      ? [step.choices!.map(c => ({ text: c.label, callback_data: `flow:${def.flowId}:select:${c.value}` }))]
      : undefined;
    const cancelRow = [{ text: "✗ Cancel", callback_data: `flow:${def.flowId}:cancel` }];
    if (step.skippable) cancelRow.unshift({ text: "⏭ Skip", callback_data: `flow:${def.flowId}:skip` });

    const promptId = await this.lifecycle.send(ctx, {
      type: "INPUT_PROMPT",
      text: step.prompt,
      keyboard: keyboard ? [...keyboard, cancelRow] : [cancelRow],
      pagePath: ctx.session.inputFlow.pagePath!,
      replacePrevious: true,  // re-uses the same prompt slot
    });

    const progressText = def.renderProgress
      ? def.renderProgress(ctx.session.inputFlow.collectedData, idx + 1, def.steps.length)
      : defaultProgressRender(ctx.session.inputFlow.collectedData, idx + 1, def.steps.length);

    const progressId = ctx.session.inputFlow.progressMessageId;
    if (progressId == null) {
      const newId = await this.lifecycle.send(ctx, {
        type: "INPUT_PROGRESS",
        text: progressText,
        pagePath: ctx.session.inputFlow.pagePath!,
      });
      ctx.session.inputFlow.progressMessageId = newId;
    } else {
      await this.lifecycle.edit(ctx, progressId, { text: progressText });
    }

    ctx.session.inputFlow.promptMessageId = promptId;
    ctx.session.inputFlow.awaitingInput = true;
    ctx.session.inputFlow.inputType = step.inputType;
    ctx.session.inputFlow.validationRules = step.validation ?? null;
    ctx.sessionDirty = true;

    if (step.timeoutSec) {
      await this.jobs.add("input-flow:timeout", {
        chatId: ctx.chat!.id,
        userId: ctx.user.id,
        botId: ctx.bot.id,
        flowId: def.flowId,
        step: idx,
      }, { delay: step.timeoutSec * 1000 });
    }
  }

  async cancel(ctx: DopellerCtx): Promise<void> {
    const state = ctx.session.inputFlow;
    if (!state.active) return;
    const def = this.registry.get(state.flowId!)!;
    await def.onCancel?.(ctx, { ...state.collectedData });
    await this.cleanup(ctx);
    await this.lifecycle.toast(ctx, "Cancelled. Nothing saved.", { subtype: "WARNING" });
  }

  private async finish(ctx: DopellerCtx, def: InputFlowDefinition, reason: "complete" | "cancel"): Promise<void> {
    const data = { ...ctx.session.inputFlow.collectedData };
    await this.cleanup(ctx);
    if (reason === "complete") await def.onComplete?.(ctx, data);
  }

  private async cleanup(ctx: DopellerCtx): Promise<void> {
    const state = ctx.session.inputFlow;
    if (state.promptMessageId)   await this.lifecycle.delete(ctx, state.promptMessageId);
    if (state.progressMessageId) await this.lifecycle.delete(ctx, state.progressMessageId);
    ctx.session.inputFlow = createDefaultSession(ctx.user.id, ctx.bot.id, ctx.chat!.id).inputFlow;
    ctx.sessionDirty = true;
  }

  private async validate(value: unknown, rule?: ValidationRule): Promise<{ ok: boolean; error?: string }> {
    if (!rule) return { ok: true };
    const trimmed = typeof value === "string" ? value.trim() : value;
    switch (rule.type) {
      case "text": {
        const s = String(trimmed);
        if (rule.min != null && s.length < rule.min) return { ok: false, error: rule.errorMessage };
        if (rule.max != null && s.length > rule.max) return { ok: false, error: rule.errorMessage };
        return { ok: true };
      }
      case "number": {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return { ok: false, error: rule.errorMessage };
        if (rule.min != null && n < rule.min) return { ok: false, error: rule.errorMessage };
        if (rule.max != null && n > rule.max) return { ok: false, error: rule.errorMessage };
        return { ok: true };
      }
      case "choice":
        return rule.choices!.includes(String(trimmed))
          ? { ok: true } : { ok: false, error: rule.errorMessage };
      case "regex":
        return new RegExp(rule.pattern!).test(String(trimmed))
          ? { ok: true } : { ok: false, error: rule.errorMessage };
      case "custom":
        return rule.custom!(value);
    }
  }
}
```

## Input-capture middleware (stage 10)

```ts
// packages/telefocus/src/middleware/input-capture.ts
export const inputCapture = (engine: InputFlowEngine): Middleware => async (ctx, next) => {
  const state = ctx.session.inputFlow;
  if (!state.active || !state.awaitingInput) return next();
  if (state.ownerUserId !== ctx.from!.id) return next();
  if (state.inputType === "text" && ctx.message?.text && !ctx.message.text.startsWith("/")) {
    await engine.capture(ctx, ctx.message.text);
    return;  // terminal
  }
  // Selection arrives through flow-router; text-only flow ignores non-text.
  return next();
};
```

## Flow router (stage 13)

Handles `flow:{flowId}:{action}` callbacks.

```ts
// packages/telefocus/src/middleware/flow-router.ts
export const flowRouter = (registry: PageRegistry): Middleware => async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("flow:")) return next();
  const [, flowId, action, ...rest] = data.split(":");
  const state = ctx.session.inputFlow;
  if (!state.active || state.flowId !== flowId) {
    await ctx.answerCallbackQuery("Flow no longer active.");
    return;
  }
  switch (action) {
    case "select": {
      const value = rest.join(":");
      await ctx.answerCallbackQuery();
      await ctx.flowEngine.capture(ctx, value);
      return;
    }
    case "cancel":
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.flowEngine.cancel(ctx);
      return;
    case "skip":
      await ctx.answerCallbackQuery();
      await ctx.flowEngine.capture(ctx, null);
      return;
  }
};
```

## Timeout worker

```ts
// packages/telefocus/src/flow/timeout-worker.ts
export const timeoutWorker = new Worker("input-flow:timeout", async (job) => {
  const { chatId, userId, botId, flowId, step } = job.data;
  const session = await loadSession(botId, userId);
  if (!session.inputFlow.active) return;
  if (session.inputFlow.flowId !== flowId) return;
  if (session.inputFlow.currentStep !== step) return;
  // Still stuck on the same step → cancel with a WARNING toast.
  const ctx = synthesizeCtx(chatId, userId, botId, session);
  await ctx.flowEngine.cancel(ctx);
  await ctx.messages.toast(ctx, "This took too long; cancelled.", { subtype: "WARNING" });
});
```

## Resume semantics

On session rehydration with `inputFlow.active = true`, the engine detects the promptMessageId may still be visible. On the next user update:

```ts
// packages/telefocus/src/flow/resume.ts
export async function maybeResume(ctx: DopellerCtx): Promise<boolean> {
  const state = ctx.session.inputFlow;
  if (!state.active) return false;
  if (state.promptMessageId) {
    // Check if message still exists by attempting a no-op edit (same text).
    // If it 400s, treat as gone and re-render the step.
  }
  const def = ctx.flowEngine.getDef(state.flowId!);
  await ctx.flowEngine.renderStep(ctx, def, state.currentStep);
  return true;
}
```

Resume is triggered from the `/start` command handler when `inputFlow.active` is true: instead of resetting to home, we offer the user `[Resume] [Discard]` via a CONFIRMATION modal.

## Worked example — persona creation

See blueprint chapter for the narrative. The concrete registration:

```ts
// packages/telefocus/src/pages/personas/create.ts
export const personaCreationFlow: InputFlowDefinition = {
  flowId: "persona_creation",
  steps: [
    {
      field: "name",
      prompt: "✏️ What should we call her? (1–40 chars)",
      inputType: "text",
      validation: { type: "text", min: 1, max: 40, errorMessage: "Name must be 1–40 chars." },
    },
    {
      field: "archetype",
      prompt: "🎭 Pick an archetype",
      inputType: "selection",
      choices: [
        { label: "Mentor", value: "mentor" },
        { label: "Friend", value: "friend" },
        { label: "Coach", value: "coach" },
      ],
    },
    {
      field: "tone",
      prompt: "🎨 Describe the tone in 1–2 sentences",
      inputType: "text",
      validation: { type: "text", min: 10, max: 240, errorMessage: "10–240 chars please." },
      skippable: true,
    },
    // ... avatar upload, voice
  ],
  renderProgress: (data, step, total) =>
    `🎭 <b>Creating Persona</b> — Step ${step}/${total}\n` +
    Object.entries(data).map(([k, v]) => `• ${k}: ${String(v)}`).join("\n"),
  onComplete: async (ctx, data) => {
    await ctx.personas.create(ctx.user.id, data);
    await ctx.messages.toast("✓ Persona created", { subtype: "SUCCESS" });
    await ctx.navigate("/personas");
  },
  onCancel: async (ctx) => {
    await ctx.messages.toast("Persona creation cancelled.", { subtype: "WARNING" });
  },
};
```

## Cross-links

- Blueprint: [06-input-flows](../blueprint/05-wave-2-core-engines/telefocus-engine/06-input-flows.md)
- Sibling: [07-navigation.md](07-navigation.md) (navigate-away guard) · [08-toasts-modals.md](08-toasts-modals.md) (resume modal)
