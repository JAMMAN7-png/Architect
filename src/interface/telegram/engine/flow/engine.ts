import { replacePrevious, send } from "../messages/send.ts";
import { cleanupScope } from "../messages/tracking.ts";
import type { PageRegistry } from "../registry.ts";
import type { SessionStore } from "../session/store.ts";
import {
  type Ctx,
  DopellerError,
  type InlineKeyboardButton,
  type InlineKeyboardMarkup,
  type InputFlowDefinition,
  type InputFlowState,
  type InputFlowStep,
  type SendOptions,
} from "../types.ts";
import { renderProgressLine } from "./progress.ts";
import { validate } from "./validators.ts";

/**
 * Input-flow engine.
 *
 * Drives the linear state machine described in
 * `docs/design-system/05-input-flows.md`. Owns the lifecycle of the
 * `INPUT_PROGRESS` and `INPUT_PROMPT` messages, calls page-defined
 * `onComplete` / `onCancel`, and delegates re-rendering of the menu on
 * cancel back to the {@link MenuRenderer}.
 *
 * The engine is storage-agnostic: it persists the session through the
 * injected {@link SessionStore} interface. It NEVER calls
 * `ctx.api.sendMessage` directly — every outbound chat message flows
 * through {@link send}.
 */

/**
 * Minimal renderer surface consumed by {@link InputFlowEngine.cancel}.
 * The concrete `MenuRenderer` class (see design-system §03) is
 * structurally compatible.
 */
export interface MenuRenderer {
  rerender(ctx: Ctx): Promise<void>;
  /**
   * Optional: drop the tracked menu so the next render lands at the
   * chat bottom. The flow engine calls this on completion so the page
   * the `onComplete` hook navigates to becomes the latest message
   * even after a long input flow has scrolled the menu out of view.
   */
  forceFresh?(ctx: Ctx): Promise<void>;
}

export interface InputFlowDeps {
  registry: PageRegistry;
  renderer: MenuRenderer;
  store: SessionStore;
}

export type CaptureOutcome = "advanced" | "rejected" | "completed";

export class InputFlowEngine {
  readonly #deps: InputFlowDeps;

  constructor(deps: InputFlowDeps) {
    this.#deps = deps;
  }

  /**
   * Begin `flowId` on the page the user currently occupies. Initialises
   * `session.inputFlow`, sends the progress + prompt messages for the
   * first effective step, and persists the session.
   */
  async start(flowId: string, ctx: Ctx): Promise<void> {
    const pagePath = ctx.session.menu.currentPage;
    const pageDef = this.#deps.registry.getOrThrow(pagePath);
    const flowDef = pageDef.inputFlow;
    if (flowDef === undefined || flowDef.flowId !== flowId) {
      throw new DopellerError(
        "invalid_flow",
        "internal",
        `flow_mismatch:expected=${flowId} actual=${String(flowDef?.flowId)} page=${pagePath}`,
        { pagePath, expected: flowId, actual: flowDef?.flowId ?? null },
      );
    }

    const collectedData: Record<string, unknown> = {};
    const effective = computeEffective(flowDef.steps, collectedData);

    if (effective.length === 0) {
      ctx.session.inputFlow = freshInactiveFlow();
      await flowDef.onComplete(collectedData, ctx);
      await this.#deps.store.save(ctx.session);
      return;
    }

    const firstStep = effective[0];
    if (firstStep === undefined) {
      // Defensive: length-checked above, but keeps the type narrow.
      ctx.session.inputFlow = freshInactiveFlow();
      await this.#deps.store.save(ctx.session);
      return;
    }

    ctx.session.inputFlow = {
      active: true,
      pagePath,
      flowId,
      currentStep: 0,
      totalSteps: effective.length,
      collectedData,
      promptMessageId: null,
      progressMessageId: null,
      awaitingInput: true,
      inputType: firstStep.inputType,
      validationRules: firstStep.validation,
      retries: 0,
    };

    const progress = await send(ctx, renderProgressLine(ctx.session.inputFlow, effective), {
      type: "INPUT_PROGRESS",
      scope: pagePath,
      replacePrevious: true,
    });
    ctx.session.inputFlow.progressMessageId = progress.messageId;

    const prompt = await send(
      ctx,
      formatPromptText(firstStep, collectedData),
      buildPromptOptions(pagePath, flowId, firstStep),
    );
    ctx.session.inputFlow.promptMessageId = prompt.messageId;

    await this.#deps.renderer.rerender(ctx);
    await this.#deps.store.save(ctx.session);
  }

  /**
   * Process a single user reply (text/number) or selection callback for
   * the active flow. Returns:
   *   - `advanced`  if validation succeeded and the next step is now armed,
   *   - `completed` if the final step was just collected and `onComplete` ran,
   *   - `rejected`  if there is no active flow, the validator failed, or
   *                 the retry budget was exhausted (in which case the
   *                 engine has already cancelled the flow).
   */
  async capture(ctx: Ctx): Promise<CaptureOutcome> {
    const flow = ctx.session.inputFlow;
    if (!flow.active || !flow.awaitingInput) return "rejected";

    const pagePath = flow.pagePath;
    const flowId = flow.flowId;
    if (pagePath === null || flowId === null) return "rejected";

    const pageDef = this.#deps.registry.get(pagePath);
    const flowDef = pageDef?.inputFlow;
    if (flowDef === undefined || flowDef.flowId !== flowId) return "rejected";

    const effectiveBefore = computeEffective(flowDef.steps, flow.collectedData);
    const step = effectiveBefore[flow.currentStep];
    if (step === undefined) return "rejected";

    const raw = extractRaw(ctx, step, flowId);

    const rule = flow.validationRules ?? step.validation;
    let result: ReturnType<typeof validate>;
    try {
      result = validate(rule, raw);
    } catch {
      result = { ok: false, reason: rule.errorMessage };
    }

    if (!result.ok) {
      // Validation failure: surface the validator's `errorMessage` by
      // editing the prompt message in place. The flow remains active and
      // keeps awaiting input — `maxRetries` is advisory only and no
      // longer auto-cancels (see ConfigDoc on InputFlowDefinition).
      flow.retries = 0;
      const promptText = `${result.reason}\n\n${formatPromptText(step, flow.collectedData)}`;
      await replacePrevious(ctx, promptText, buildPromptOptions(pagePath, flowId, step));
      if (step.inputType !== "selection" && ctx.message !== undefined) {
        try {
          await ctx.api.deleteMessage(ctx.chatId, ctx.message.message_id);
        } catch {
          // Best-effort: design-system §04 forgives delete failures.
        }
      }
      await this.#deps.store.save(ctx.session);
      return "rejected";
    }

    flow.collectedData[step.field] = result.value;
    ctx.session.menu.staleness = (ctx.session.menu.staleness ?? 0) + 1;

    if (step.inputType !== "selection" && ctx.message !== undefined) {
      try {
        await ctx.api.deleteMessage(ctx.chatId, ctx.message.message_id);
      } catch {
        // Best-effort: design-system §04 forgives delete failures.
      }
    }

    const effectiveAfter = computeEffective(flowDef.steps, flow.collectedData);
    flow.currentStep += 1;
    flow.totalSteps = effectiveAfter.length;
    flow.retries = 0;

    if (flow.currentStep < effectiveAfter.length) {
      const nextStep = effectiveAfter[flow.currentStep];
      if (nextStep === undefined) {
        await this.cancel(ctx);
        return "rejected";
      }
      flow.inputType = nextStep.inputType;
      flow.validationRules = nextStep.validation;
      flow.awaitingInput = true;

      const progress = await send(ctx, renderProgressLine(flow, effectiveAfter), {
        type: "INPUT_PROGRESS",
        scope: pagePath,
        replacePrevious: true,
      });
      flow.progressMessageId = progress.messageId;

      const prompt = await send(
        ctx,
        formatPromptText(nextStep, flow.collectedData),
        buildPromptOptions(pagePath, flowId, nextStep),
      );
      flow.promptMessageId = prompt.messageId;

      await this.#deps.store.save(ctx.session);
      return "advanced";
    }

    const collected = flow.collectedData;
    ctx.session.inputFlow = freshInactiveFlow();
    ctx.session.menu.staleness = 0;
    if (this.#deps.renderer.forceFresh !== undefined) {
      await this.#deps.renderer.forceFresh(ctx);
    }
    await this.#deps.store.save(ctx.session);
    await flowDef.onComplete(collected, ctx);
    return "completed";
  }

  /**
   * Abort the active flow. Invokes the page's `onCancel` (if any),
   * scrubs the prompt + progress messages from the chat via
   * {@link cleanupScope}, re-renders the host page, and persists the
   * cleared session.
   */
  async cancel(ctx: Ctx): Promise<void> {
    const flow = ctx.session.inputFlow;
    if (!flow.active) return;

    const pagePath = flow.pagePath;
    const flowDef = resolveFlowDef(this.#deps.registry, pagePath, flow.flowId);
    const collected = flow.collectedData;

    if (flowDef?.onCancel !== undefined) {
      try {
        await flowDef.onCancel(collected, ctx);
      } catch {
        // The cancel hook is best-effort; never block the reset.
      }
    }

    ctx.session.inputFlow = freshInactiveFlow();

    if (pagePath !== null) {
      await cleanupScope(ctx, pagePath);
    }

    await this.#deps.renderer.rerender(ctx);
    await this.#deps.store.save(ctx.session);
  }

  /**
   * Re-emit the current step's progress + prompt. Used after a process
   * restart, where the session survived but the chat-side prompt may
   * have been lost. No-op when no flow is active.
   */
  async resume(ctx: Ctx): Promise<void> {
    const flow = ctx.session.inputFlow;
    if (!flow.active) return;

    const pagePath = flow.pagePath;
    const flowId = flow.flowId;
    if (pagePath === null || flowId === null) return;

    const pageDef = this.#deps.registry.get(pagePath);
    const flowDef = pageDef?.inputFlow;
    if (flowDef === undefined || flowDef.flowId !== flowId) return;

    const effective = computeEffective(flowDef.steps, flow.collectedData);
    const step = effective[flow.currentStep];
    if (step === undefined) return;

    const progress = await send(ctx, renderProgressLine(flow, effective), {
      type: "INPUT_PROGRESS",
      scope: pagePath,
      replacePrevious: true,
    });
    flow.progressMessageId = progress.messageId;

    const prompt = await send(
      ctx,
      formatPromptText(step, flow.collectedData),
      buildPromptOptions(pagePath, flowId, step),
    );
    flow.promptMessageId = prompt.messageId;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function computeEffective(
  steps: InputFlowStep[],
  collected: Record<string, unknown>,
): InputFlowStep[] {
  return steps.filter((s) => s.skipIf === undefined || !s.skipIf(collected));
}

function formatPromptText(step: InputFlowStep, collected: Record<string, unknown>): string {
  if (step.formatPrompt !== undefined) return step.formatPrompt(collected);
  return step.prompt;
}

function buildChoicesKeyboard(flowId: string, step: InputFlowStep): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[] = (step.choices ?? []).map((c) => ({
    text: c.label,
    callback_data: `flow:${flowId}:${c.value}`,
  }));
  return { inline_keyboard: [buttons] };
}

function buildPromptOptions(pagePath: string, flowId: string, step: InputFlowStep): SendOptions {
  const base: SendOptions = {
    type: "INPUT_PROMPT",
    scope: pagePath,
    replacePrevious: true,
  };
  if (step.inputType === "selection") {
    return { ...base, replyMarkup: buildChoicesKeyboard(flowId, step) };
  }
  return base;
}

function extractRaw(ctx: Ctx, step: InputFlowStep, flowId: string): unknown {
  if (step.inputType === "selection") {
    const data = ctx.callbackQuery?.data ?? "";
    const prefix = `flow:${flowId}:`;
    return data.startsWith(prefix) ? data.slice(prefix.length) : data;
  }
  return ctx.message?.text;
}

function resolveFlowDef(
  registry: PageRegistry,
  pagePath: string | null,
  flowId: string | null,
): InputFlowDefinition | undefined {
  if (pagePath === null || flowId === null) return undefined;
  const pageDef = registry.get(pagePath);
  const flowDef = pageDef?.inputFlow;
  if (flowDef === undefined || flowDef.flowId !== flowId) return undefined;
  return flowDef;
}

function freshInactiveFlow(): InputFlowState {
  return {
    active: false,
    pagePath: null,
    flowId: null,
    currentStep: 0,
    totalSteps: 0,
    collectedData: {},
    promptMessageId: null,
    progressMessageId: null,
    awaitingInput: false,
    inputType: null,
    validationRules: null,
    retries: 0,
  };
}
