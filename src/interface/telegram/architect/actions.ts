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
  dismissModalsInScope,
  goBack,
  modal,
  navigateTo,
  toast,
} from "../engine/index.ts";
import { dismissActiveModal } from "../engine/messages/modal.ts";
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
  // Nav-cancels-flow handler. Matches every `nav:*` callback; if a flow
  // is active, cancels it before driving the navigation so the user is
  // freed from the locked-input holding body when they tap a Back/menu
  // button. We drive the navigation here (mirroring
  // `engine/middleware/router.ts`) instead of calling `next()` so the
  // chain is self-contained — the engine pipeline's nav matcher would
  // otherwise re-handle the same callback redundantly, and tightening
  // the contract to "this handler owns nav:*" removes the ordering
  // hazard between the architect actions and the engine `bot.use(...)`.
  bot.callbackQuery(/^nav:.+$/, async (gctx) => {
    const ctx = await loadCtx(gctx, deps);
    if (ctx === null) {
      await silenceSpinner(gctx);
      return;
    }
    try {
      if (ctx.session.inputFlow.active) {
        try {
          await deps.flow.cancel(ctx);
        } catch {
          // Cancelling an inert/inconsistent flow is forgivable — never
          // block the user-initiated navigation on cleanup failure.
        }
        await deps.store.save(ctx.session);
      }
      const data = gctx.callbackQuery?.data ?? "";
      const nd = navDeps(deps);
      if (data === "nav:back") {
        await goBack(ctx, nd);
      } else if (data.startsWith("nav:")) {
        await navigateTo(ctx, data.slice("nav:".length), nd);
      }
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(gctx);
    }
  });

  for (const [callback, status] of Object.entries(APPROVAL_CALLBACKS)) {
    bot.callbackQuery(callback, makeApprovalHandler(deps, status));
  }
  bot.callbackQuery("action:architect:new", makeNewProjectHandler(deps));
  bot.callbackQuery("action:architect:open", makeOpenProjectHandler(deps));
  bot.callbackQuery("action:architect:continue", makeContinueHandler(deps));
  bot.callbackQuery("action:architect:reset", makeResetHandler(deps));
  bot.callbackQuery(RESET_CONFIRM, makeResetConfirmHandler(deps));
  bot.callbackQuery(RESET_CANCEL, makeResetCancelHandler(deps));
  bot.callbackQuery("action:engine:flow:cancel", makeEngineFlowCancelHandler(deps));
  bot.callbackQuery("action:engine:modal:cancel", makeEngineModalCancelHandler(deps));
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
      // Tear down the reset confirmation modal hosted on the current page
      // BEFORE rerender, so the renderer no longer sees `activeModal`
      // and paints the live menu instead of the locked holding body.
      // Both calls are idempotent — failures are forgivable per
      // design-system §07.
      try {
        await dismissModalsInScope(ctx, ctx.session.menu.currentPage);
      } catch {
        // Telegram delete races are benign; activeModal still gets
        // cleared below regardless.
      }
      dismissActiveModal(ctx.session);
      await deps.renderer.rerender(ctx);
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

// ── Engine-level cancel handlers ─────────────────────────────────────
//
// `action:engine:flow:cancel` and `action:engine:modal:cancel` are
// emitted by the renderer's locked-body Cancel button (see
// `engine/renderer/menu-renderer.ts`). They are user-initiated and
// idempotent: tapping Cancel on an already-inert state is a no-op.

function makeEngineFlowCancelHandler(
  deps: ActionDeps,
): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      if (ctx.session.inputFlow.active) {
        try {
          await deps.flow.cancel(ctx);
        } catch {
          // Forgivable: the user's intent is to escape the lock; never
          // strand them in a half-cancelled state on cleanup failure.
        }
      }
      await toast.info(ctx, "Cancelled.");
      await deps.renderer.rerender(ctx);
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

function makeEngineModalCancelHandler(
  deps: ActionDeps,
): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx) => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      const scope = ctx.session.activeModal?.scope;
      try {
        await dismissModalsInScope(ctx, scope);
      } catch {
        // Telegram delete races are benign; the activeModal is still
        // cleared below so the lock is released regardless.
      }
      dismissActiveModal(ctx.session);
      await toast.info(ctx, "Dismissed.");
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
