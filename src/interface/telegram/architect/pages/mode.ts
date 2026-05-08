import type { Bot, Context as GrammyContext } from "grammy";
import { lastApprovalFor } from "../../../../orchestrator/approvals.ts";
import type { ArchitectState, SparkMode } from "../../../../orchestrator/state.ts";
import {
  type Ctx,
  DopellerError,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  type PageRegistry,
  btn,
  escapeHtml,
  navigateTo,
  toast,
} from "../../engine/index.ts";
import type { MenuRenderer } from "../../engine/renderer/menu-renderer.ts";
import type { SessionStore } from "../../engine/session/store.ts";
import { adaptUpdate } from "../../grammy-adapter.ts";
import type { ActionDeps } from "../actions.ts";
import { makeGatePagePrompts } from "../gate-page.ts";
import { getArchitectRunner } from "../runner.ts";

/**
 * `/mode` — G2 Spark Mode Selection.
 *
 * Three display modes:
 *   - **No `sparkMode` set yet**: render three picker buttons
 *     (Brainstorm / Checkup / Skip) wired to
 *     `action:architect:mode:<value>`. The handler pre-stages
 *     `state.sparkMode` and re-runs the orchestrator; P2 (relaxed)
 *     short-circuits the prompt and presents G2.
 *   - **G2 pending**: standard Approve / Edit / Revise / Reject keyboard.
 *   - **G2 already approved**: `onEnter` forwards to `/maturation`.
 *
 * Callers MUST register {@link registerModePageActions} from inside the
 * `actions` hook of `startTelefocusBot`, alongside
 * `registerArchitectActions`:
 *
 *   actions: (bot, deps) => {
 *     registerArchitectActions(bot, { ...deps, runner });
 *     registerModePageActions(bot, { ...deps, runner });
 *   }
 */

const MODE_VALUES = ["brainstorm", "checkup", "skip"] as const satisfies readonly SparkMode[];

const MODE_LABELS: Record<SparkMode, string> = {
  brainstorm: "🧠 Brainstorm & Grow",
  checkup: "🔍 Checkup Only",
  skip: "⏭ Skip Maturation",
};

function modeCallback(mode: SparkMode): string {
  return `action:architect:mode:${mode}`;
}

export const modePage: PageDefinition = {
  path: "/mode",
  parent: "/",

  async onEnter(ctx: Ctx): Promise<void> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) {
      await navigateTo(ctx, "/", navDeps(ctx));
      return;
    }
    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) {
      await navigateTo(ctx, "/", navDeps(ctx));
      return;
    }
    if (lastApprovalFor(state, "G2")?.status === "approved") {
      await navigateTo(ctx, "/maturation", navDeps(ctx));
      return;
    }
    // Otherwise let render/keyboard surface the right UX based on
    // `state.sparkMode` and `state.pendingApproval`.
  },

  async render(ctx: Ctx): Promise<MenuBody> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return { text: missingProjectBody(), parseMode: "HTML" };

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return { text: missingProjectBody(), parseMode: "HTML" };

    const lines: string[] = ["<b>Spark Mode</b>", ""];
    if (state.sparkMode === null) {
      lines.push("How should we mature your spark?");
      lines.push("");
      lines.push("• <b>Brainstorm & Grow</b> — best for rough ideas.");
      lines.push("• <b>Checkup Only</b> — best for fairly complete sparks.");
      lines.push("• <b>Skip Maturation</b> — keep the spark as-is.");
    } else {
      lines.push(`Selected mode: <b>${escapeHtml(MODE_LABELS[state.sparkMode])}</b>`);
      lines.push("");
      lines.push("Gate: <code>G2</code>");
      const pending = runner.pendingGate(state) === "G2";
      lines.push(pending ? "Status: ⏳ awaiting your approval" : "Status: ✅ resolved");
    }
    return { text: lines.join("\n"), parseMode: "HTML" };
  },

  async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const back = btn("⬅ Back", { intent: "back", callback_data: "nav:/" });
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return [[back]];

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return [[back]];

    if (state.sparkMode !== null) {
      return [
        [
          btn("✅ Approve", {
            intent: "approve",
            style: "success",
            callback_data: "action:architect:approve",
          }),
        ],
        [btn("✏️ Edit", { intent: "edit", callback_data: "action:architect:edit" })],
        [btn("🔁 Revise", { intent: "revise", callback_data: "action:architect:revise" })],
        [
          btn("❌ Reject", {
            intent: "reject",
            style: "danger",
            callback_data: "action:architect:reject",
          }),
        ],
        [back],
      ];
    }

    return [
      ...MODE_VALUES.map((mode) => [btn(MODE_LABELS[mode], { callback_data: modeCallback(mode) })]),
      [back],
    ];
  },
};

/**
 * Register the three mode-picker callback handlers. Each handler
 * pre-stages `state.sparkMode`, runs the orchestrator (P2 short-circuits
 * once `sparkMode` is set), and re-renders `/mode` so the approval
 * keyboard appears.
 */
export function registerModePageActions(bot: Bot, deps: ActionDeps): void {
  for (const mode of MODE_VALUES) {
    bot.callbackQuery(modeCallback(mode), makeModeHandler(deps, mode));
  }
}

function makeModeHandler(
  deps: ActionDeps,
  mode: SparkMode,
): (grammyCtx: GrammyContext) => Promise<void> {
  return async (grammyCtx: GrammyContext): Promise<void> => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await runModeSelection(ctx, deps, mode);
      await deps.store.save(ctx.session);
    } catch (err) {
      await reportFailure(ctx, err);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  };
}

async function runModeSelection(ctx: Ctx, deps: ActionDeps, mode: SparkMode): Promise<void> {
  const projectRoot = ctx.session.projectRoot;
  if (projectRoot === null) {
    await toast.warning(ctx, "No active project — start one first.");
    await navigateTo(ctx, "/", navDeps(ctx));
    return;
  }
  let state = await deps.runner.loadCurrent(projectRoot);
  if (state === null) {
    ctx.session.projectRoot = null;
    await navigateTo(ctx, "/", navDeps(ctx));
    return;
  }

  // If the user previously picked another mode and G2 is already
  // pending, treat this click as an "edit" so the orchestrator can
  // re-present G2 with the new selection.
  if (state.pendingApproval?.gate === "G2") {
    state = await deps.runner.resolveApproval(state, { status: "edited" });
  }

  const staged: ArchitectState = { ...state, sparkMode: mode };
  await deps.runner.advance(staged, makeGatePagePrompts());

  await navigateTo(ctx, "/mode", navDeps(ctx));
}

// ── Helpers ──────────────────────────────────────────────────────────

function missingProjectBody(): string {
  return [
    "<b>Spark Mode</b>",
    "",
    "No active project. Return to the start screen and create or open one.",
  ].join("\n");
}

function navDeps(ctx: Ctx): {
  registry: PageRegistry;
  renderer: MenuRenderer;
  store: SessionStore;
} {
  const nav = (ctx.services as { nav?: unknown }).nav;
  if (typeof nav !== "object" || nav === null) {
    throw new DopellerError("internal_db_unavailable", "internal", "no_nav_service");
  }
  return nav as { registry: PageRegistry; renderer: MenuRenderer; store: SessionStore };
}

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
  const message = err instanceof Error ? err.message : String(err);
  try {
    await toast.danger(ctx, `Could not select mode: ${escapeHtml(message)}`);
  } catch {
    // Swallow rendering failures.
  }
}
