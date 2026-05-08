import type { Bot, Context as GrammyContext } from "grammy";
import type { ApprovalStatus, GateId } from "../../../orchestrator/state.ts";
import {
  type Ctx,
  DopellerError,
  type InputFlowEngine,
  type MenuRenderer,
  type PageRegistry,
  type ServicesShape,
  type SessionStore,
  modal,
  navigateTo,
  toast,
} from "../engine/index.ts";
import { adaptUpdate } from "../grammy-adapter.ts";
import type { ArchitectRunner } from "./runner.ts";

/**
 * grammY action handlers for `action:architect:*` callbacks.
 *
 * These handlers are registered BEFORE the catch-all pipeline middleware
 * in `server.ts`. Because they don't fall through to the engine pipeline,
 * each handler is responsible for its own session lifecycle: load,
 * mutate, save. Failures inside the runner are caught and rendered as a
 * danger toast so the user always gets feedback even when the underlying
 * LLM call breaks.
 *
 * Wiring point: `startTelefocusBot({ ..., actions: (bot, deps) => registerArchitectActions(bot, { ...deps, runner }) })`.
 */

/**
 * Static map: which page handles each gate's review surface. Pages 4b/4c
 * register the gate pages with these paths; this constant is the single
 * source of truth for "given a pending gate, which page do I jump to?".
 */
export const GATE_PATHS: Record<GateId, string> = {
  G1: "/spark",
  G2: "/mode",
  G3: "/maturation",
  G4: "/sketch",
  G5: "/research-targets",
  G6: "/stack-questionnaire",
  G7: "/approach-questionnaire",
  G8: "/decisions",
  G9: "/docs-manifest",
  G10: "/blueprint",
};

const APPROVAL_CALLBACKS: Record<string, ApprovalStatus> = {
  "action:architect:approve": "approved",
  "action:architect:edit": "edited",
  "action:architect:revise": "revised",
  "action:architect:reject": "rejected",
};

const APPROVAL_TOASTS: Record<
  ApprovalStatus,
  { kind: "info" | "warning" | "danger"; text: string }
> = {
  approved: { kind: "info", text: "Approved." },
  edited: { kind: "warning", text: "Edit accepted — re-running phase." },
  revised: { kind: "warning", text: "Revision requested — re-running phase." },
  rejected: { kind: "danger", text: "Rejected." },
};

const FLOW_NEW_PROJECT = "architect_new_project";

const RESET_CONFIRM = "action:architect:reset:confirm";
const RESET_CANCEL = "action:architect:reset:cancel";

export interface ActionDeps {
  runner: ArchitectRunner;
  renderer: MenuRenderer;
  registry: PageRegistry;
  store: SessionStore;
  flow: InputFlowEngine;
  services: ServicesShape;
}

/**
 * Register every `action:architect:*` callback handler on `bot`. MUST
 * run before the catch-all `bot.use(...)` so grammY's matcher sees the
 * filtered handlers first.
 */
export function registerArchitectActions(bot: Bot, deps: ActionDeps): void {
  for (const [callback, status] of Object.entries(APPROVAL_CALLBACKS)) {
    bot.callbackQuery(callback, makeApprovalHandler(deps, status));
  }
  bot.callbackQuery("action:architect:new", makeNewProjectHandler(deps));
  bot.callbackQuery("action:architect:open", makeOpenProjectHandler(deps));
  bot.callbackQuery("action:architect:continue", makeContinueHandler(deps));
  bot.callbackQuery("action:architect:reset", makeResetHandler(deps));
  bot.callbackQuery(RESET_CONFIRM, makeResetConfirmHandler(deps));
  bot.callbackQuery(RESET_CANCEL, makeResetCancelHandler(deps));
}

// ── Approval handlers ────────────────────────────────────────────────

function makeApprovalHandler(
  deps: ActionDeps,
  status: ApprovalStatus,
): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await runApproval(ctx, deps, status);
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

async function runApproval(ctx: Ctx, deps: ActionDeps, status: ApprovalStatus): Promise<void> {
  const projectRoot = ctx.session.projectRoot;
  if (projectRoot === null) {
    await toast.warning(ctx, "No active project — start one first.");
    await navigateTo(ctx, "/", navDeps(deps));
    return;
  }
  const state = await deps.runner.loadCurrent(projectRoot);
  if (state === null) {
    await toast.warning(ctx, "Project state is missing — returning to start.");
    ctx.session.projectRoot = null;
    await navigateTo(ctx, "/", navDeps(deps));
    return;
  }
  if (state.pendingApproval === null) {
    await toast.warning(ctx, "Nothing to approve right now — refreshed view.");
    await deps.renderer.rerender(ctx);
    return;
  }

  const resolved = await deps.runner.resolveApproval(state, { status });
  const t = APPROVAL_TOASTS[status];
  await toast[t.kind](ctx, t.text);

  // Drive the next phase. If the LLM call throws here it's caught by the
  // outer try/catch.
  const advanced = await deps.runner.advance(resolved, throwingPrompts());

  const nextGate = deps.runner.pendingGate(advanced);
  const target = nextGate !== null ? GATE_PATHS[nextGate] : "/status";
  await navigateTo(ctx, target, navDeps(deps));
}

// ── New / open / continue / reset ────────────────────────────────────

function makeNewProjectHandler(deps: ActionDeps): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await deps.flow.start(FLOW_NEW_PROJECT, ctx);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

function makeOpenProjectHandler(deps: ActionDeps): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await toast.info(ctx, "Opening an existing project is not wired in this build yet.");
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

function makeContinueHandler(deps: ActionDeps): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      const projectRoot = ctx.session.projectRoot;
      if (projectRoot === null) {
        await toast.warning(ctx, "No active project — start one first.");
        await navigateTo(ctx, "/", navDeps(deps));
        return;
      }
      const state = await deps.runner.loadCurrent(projectRoot);
      if (state === null) {
        ctx.session.projectRoot = null;
        await navigateTo(ctx, "/", navDeps(deps));
        return;
      }
      const pending = deps.runner.pendingGate(state);
      const target = pending !== null ? GATE_PATHS[pending] : "/status";
      await navigateTo(ctx, target, navDeps(deps));
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

function makeResetHandler(deps: ActionDeps): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await modal.confirm(ctx, {
        title: "Reset project?",
        body: "This unbinds the current project from your session. The on-disk artifacts are kept; you can re-open the project later.",
        confirmLabel: "🔄 Yes, reset",
        cancelLabel: "← Cancel",
        confirmCallback: RESET_CONFIRM,
        cancelCallback: RESET_CANCEL,
        confirmColor: "destructive",
      });
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

function makeResetConfirmHandler(deps: ActionDeps): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      ctx.session.projectRoot = null;
      await navigateTo(ctx, "/", navDeps(deps));
      await toast.info(ctx, "Project reset.");
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

function makeResetCancelHandler(deps: ActionDeps): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await deps.renderer.rerender(ctx);
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function loadCtx(grammyCtx: GrammyContext, deps: ActionDeps): Promise<Ctx | null> {
  const ctx = await adaptUpdate(grammyCtx, deps.services);
  if (ctx === null) return null;
  const session = await deps.store.load(ctx.userId, ctx.chatId);
  ctx.session = session;
  session.lastInteractionAt = Date.now();
  return ctx;
}

async function silenceSpinner(grammyCtx: GrammyContext): Promise<void> {
  const cb = grammyCtx.callbackQuery;
  if (cb === undefined) return;
  try {
    await grammyCtx.answerCallbackQuery();
  } catch {
    // Telegram rejects acks for queries already answered or expired.
  }
}

async function reportFailure(ctx: Ctx, err: unknown): Promise<void> {
  if (err instanceof DopellerError) {
    // Re-throw typed engine errors so the error-boundary can render them
    // when the catch-all pipeline runs them. In standalone action mode
    // we still want to surface a toast, so emit one and swallow.
    try {
      await toast.danger(ctx, err.message);
    } catch {
      // Swallow rendering failures; the original error is already lost.
    }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  try {
    await toast.danger(ctx, `Something went wrong: ${message}`);
  } catch {
    // Swallow rendering failures.
  }
}

function navDeps(deps: ActionDeps): {
  registry: PageRegistry;
  renderer: MenuRenderer;
  store: SessionStore;
} {
  return { registry: deps.registry, renderer: deps.renderer, store: deps.store };
}

/**
 * Throwing prompts adapter. Used when an action handler drives
 * `runner.advance(...)` directly — phases that need user input must
 * capture via input flows or other actions, never `prompts.text()` etc.
 */
function throwingPrompts(): import("../../../orchestrator/phase.ts").PhasePrompts {
  const fail = (op: string): never => {
    throw new DopellerError("architect_phase_failed", "platform", `unexpected_prompt_call:${op}`);
  };
  return {
    async text(): Promise<string> {
      return fail("text");
    },
    async select(): Promise<never> {
      return fail("select");
    },
    async confirm(): Promise<boolean> {
      return fail("confirm");
    },
    async approve(): Promise<never> {
      return fail("approve");
    },
  };
}
