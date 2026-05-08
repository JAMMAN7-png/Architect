import type { Bot, Context as GrammyContext } from "grammy";
import { lastApprovalFor } from "../../../../orchestrator/approvals.ts";
import { docExists, projectDoc, writeDoc } from "../../../../util/files.ts";
import {
  type Ctx,
  DopellerError,
  type InlineKeyboardButton,
  type InputFlowDefinition,
  type MenuBody,
  type PageDefinition,
  type PageRegistry,
  escapeHtml,
  navigateTo,
} from "../../engine/index.ts";
import type { MenuRenderer } from "../../engine/renderer/menu-renderer.ts";
import type { SessionStore } from "../../engine/session/store.ts";
import { adaptUpdate } from "../../grammy-adapter.ts";
import type { ActionDeps } from "../actions.ts";
import { makeGatePagePrompts } from "../gate-page.ts";
import { getArchitectRunner } from "../runner.ts";

/**
 * `/spark` — G1 Human Spark Capture review.
 *
 * Two display modes:
 *   - **No spark file yet** (post-bootstrap): render a guidance body and
 *     a `📝 Capture spark` button. Clicking it triggers the
 *     `architect_spark` input flow defined on this page. Flow completion
 *     writes `docs/00-human-spark.md`, drives the orchestrator to
 *     present G1 (P1 short-circuits when the file exists), then
 *     re-navigates to `/spark` so the approval keyboard renders.
 *   - **G1 pending**: standard Approve / Edit / Revise / Reject keyboard.
 *
 * Callers MUST register {@link registerSparkPageActions} from inside the
 * `actions` hook of `startTelefocusBot`, alongside
 * `registerArchitectActions`:
 *
 *   actions: (bot, deps) => {
 *     registerArchitectActions(bot, { ...deps, runner });
 *     registerSparkPageActions(bot, { ...deps, runner });
 *   }
 */

const FLOW_SPARK = "architect_spark";
const ACTION_BEGIN = "action:architect:spark:begin";
const SPARK_DOC = "00-human-spark.md";

const sparkFlow: InputFlowDefinition = {
  flowId: FLOW_SPARK,
  steps: [
    {
      field: "sparkText",
      prompt: "Paste your raw spark.",
      inputType: "text",
      validation: {
        type: "text",
        min: 16,
        errorMessage: "A spark needs at least 16 characters.",
      },
    },
  ],
  async onComplete(collected: Record<string, unknown>, ctx: Ctx): Promise<void> {
    const text = String(collected.sparkText ?? "").trim();
    if (text.length === 0) {
      throw new DopellerError("invalid_flow", "user", "empty_spark_text");
    }
    const runner = getArchitectRunner(ctx);
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) {
      throw new DopellerError("architect_phase_failed", "user", "no_project");
    }
    let state = await runner.loadCurrent(projectRoot);
    if (state === null) {
      throw new DopellerError("architect_phase_failed", "user", "no_project");
    }
    await writeDoc(projectDoc(state.projectRoot, SPARK_DOC), text);
    state = await runner.advance(state, makeGatePagePrompts());
    await navigateTo(ctx, "/spark", navDeps(ctx));
  },
};

export const sparkPage: PageDefinition = {
  path: "/spark",
  parent: "/",
  inputFlow: sparkFlow,

  async onEnter(ctx: Ctx): Promise<void> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) {
      await navigateTo(ctx, "/", navDeps(ctx));
      return;
    }
    const runner = getArchitectRunner(ctx);
    let state = await runner.loadCurrent(projectRoot);
    if (state === null) {
      await navigateTo(ctx, "/", navDeps(ctx));
      return;
    }

    // Already approved — hand the user off to G2.
    if (lastApprovalFor(state, "G1")?.status === "approved") {
      await navigateTo(ctx, "/mode", navDeps(ctx));
      return;
    }

    // Already paused at G1 — render the approval keyboard.
    if (runner.pendingGate(state) === "G1") return;

    // Spark file pre-staged on disk → drive the engine so P1 picks it up
    // and presents G1. If the engine advances past G1, follow it forward.
    const sparkPath = projectDoc(state.projectRoot, SPARK_DOC);
    if (await docExists(sparkPath)) {
      state = await runner.advance(state, makeGatePagePrompts());
      if (runner.pendingGate(state) !== "G1") {
        await navigateTo(ctx, "/mode", navDeps(ctx));
      }
    }
    // Otherwise: no file yet, no pending — keyboard renders the
    // `📝 Capture spark` button which triggers the input flow.
  },

  async render(ctx: Ctx): Promise<MenuBody> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return { text: missingProjectBody(), parseMode: "HTML" };

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return { text: missingProjectBody(), parseMode: "HTML" };

    const lines: string[] = ["<b>Human Spark</b>", ""];
    const pending = runner.pendingGate(state) === "G1";
    if (pending) {
      lines.push("Review your captured spark.");
      lines.push("");
      lines.push(`📄 <code>docs/${escapeHtml(SPARK_DOC)}</code>`);
      lines.push("");
      lines.push("Gate: <code>G1</code>");
      lines.push("Status: ⏳ awaiting your approval");
    } else {
      lines.push("No spark captured yet. Tap the button below to paste one.");
      lines.push("");
      lines.push("Gate: <code>G1</code>");
    }
    return { text: lines.join("\n"), parseMode: "HTML" };
  },

  async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const back: InlineKeyboardButton = { text: "← Back", callback_data: "nav:/" };
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return [[back]];

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return [[back]];

    if (runner.pendingGate(state) === "G1") {
      return [
        [{ text: "✅ Approve", callback_data: "action:architect:approve" }],
        [{ text: "✏️ Edit", callback_data: "action:architect:edit" }],
        [{ text: "🔁 Revise", callback_data: "action:architect:revise" }],
        [{ text: "❌ Reject", callback_data: "action:architect:reject" }],
        [back],
      ];
    }

    return [[{ text: "📝 Capture spark", callback_data: ACTION_BEGIN }], [back]];
  },
};

/**
 * Register the `📝 Capture spark` callback handler. This action starts
 * the on-page `architect_spark` input flow once the user is parked on
 * `/spark` (so `session.menu.currentPage === '/spark'` and the engine's
 * flow lookup finds {@link sparkFlow}).
 */
export function registerSparkPageActions(bot: Bot, deps: ActionDeps): void {
  bot.callbackQuery(ACTION_BEGIN, async (grammyCtx: GrammyContext): Promise<void> => {
    const ctx = await loadCtx(grammyCtx, deps);
    if (ctx === null) {
      await silenceSpinner(grammyCtx);
      return;
    }
    try {
      await deps.flow.start(FLOW_SPARK, ctx);
      await deps.store.save(ctx.session);
    } finally {
      await silenceSpinner(grammyCtx);
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

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

function missingProjectBody(): string {
  return [
    "<b>Human Spark</b>",
    "",
    "No active project. Return to the start screen and create or open one.",
  ].join("\n");
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
