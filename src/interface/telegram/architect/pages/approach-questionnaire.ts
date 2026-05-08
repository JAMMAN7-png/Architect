import { lastApprovalFor } from "../../../../orchestrator/approvals.ts";
import {
  type Ctx,
  DopellerError,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  type PageRegistry,
  btn,
  navigateTo,
} from "../../engine/index.ts";
import type { MenuRenderer } from "../../engine/renderer/menu-renderer.ts";
import type { SessionStore } from "../../engine/session/store.ts";
import { getArchitectRunner } from "../runner.ts";

/**
 * `/approach-questionnaire` — G7 Approach Questionnaire review.
 *
 * **v1 limitation.** Same constraint as G6: the HITL Q2 questionnaire
 * (P8) is multi-question with a custom-answer research detour. v1
 * relies on the user running the CLI to pre-stage
 * `docs/research/_approach_decisions.json`; P8 short-circuits to that
 * file and the orchestrator pauses at G7 here.
 *
 * Behaviour matrix:
 *   - **G7 already approved** → forward to `/decisions`.
 *   - **G7 pending** → standard approval keyboard.
 *   - **otherwise** → guidance body explaining the v1 path.
 */
export const approachQuestionnairePage: PageDefinition = {
  path: "/approach-questionnaire",
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
    if (lastApprovalFor(state, "G7")?.status === "approved") {
      await navigateTo(ctx, "/decisions", navDeps(ctx));
    }
  },

  async render(ctx: Ctx): Promise<MenuBody> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return { text: missingProjectBody(), parseMode: "HTML" };

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return { text: missingProjectBody(), parseMode: "HTML" };

    const lines: string[] = ["<b>Approach Questionnaire</b>", ""];
    if (runner.pendingGate(state) === "G7") {
      lines.push("Approach decisions ready for review.");
      lines.push("");
      lines.push("📄 <code>docs/research/02-approach-decisions.md</code>");
      lines.push("");
      lines.push("Gate: <code>G7</code>");
      lines.push("Status: ⏳ awaiting your approval");
    } else {
      lines.push("This questionnaire is multi-question and includes a research detour for");
      lines.push("custom answers. v1 cannot drive it inline from Telegram.");
      lines.push("");
      lines.push("Run the CLI to answer the questionnaire and pre-stage");
      lines.push("<code>docs/research/_approach_decisions.json</code>; the orchestrator will then");
      lines.push("pause here so you can approve the recorded decisions.");
    }
    return { text: lines.join("\n"), parseMode: "HTML" };
  },

  async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const back: InlineKeyboardButton = btn("⬅ Back", { intent: "back", callback_data: "nav:/" });
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return [[back]];

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return [[back]];

    if (runner.pendingGate(state) === "G7") {
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
    return [[back]];
  },
};

function missingProjectBody(): string {
  return [
    "<b>Approach Questionnaire</b>",
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
