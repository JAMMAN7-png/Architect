import {
  type Ctx,
  type InlineKeyboardButton,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
} from "../../engine/index.ts";
import { GATE_PATHS } from "../actions.ts";
import { getArchitectRunner } from "../runner.ts";

/**
 * `/status` — Architect project status page.
 *
 * Surfaces the live state without driving any phase work: stage,
 * approvals tally, pending gate, spark path, and blueprint lock flag.
 * If a gate is currently pending, a deep-link button jumps directly to
 * that gate's review page.
 */
export const statusPage: PageDefinition = {
  path: "/status",
  parent: "/",
  async render(ctx: Ctx): Promise<MenuBody> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) {
      return { text: noProjectBody(), parseMode: "HTML" };
    }
    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) {
      return { text: noProjectBody(), parseMode: "HTML" };
    }
    return { text: statusBody(state), parseMode: "HTML" };
  },
  async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const back: InlineKeyboardButton = { text: "← Back", callback_data: "nav:/" };
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) return [[back]];

    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) return [[back]];

    const pending = runner.pendingGate(state);
    if (pending === null) return [[back]];

    return [[{ text: "✍️ Review Pending", callback_data: `nav:${GATE_PATHS[pending]}` }], [back]];
  },
};

function statusBody(state: {
  projectName: string;
  currentStage: string;
  approvals: { length: number };
  pendingApproval: { gate: string; label: string } | null;
  spark: { path: string } | null;
  blueprintLocked: boolean;
}): string {
  const lines: string[] = [
    `<b>${escapeHtml(state.projectName)}</b>`,
    "",
    `Stage: <code>${escapeHtml(state.currentStage)}</code>`,
    `Approvals recorded: <b>${state.approvals.length}</b>`,
  ];
  if (state.pendingApproval !== null) {
    lines.push(
      `Pending: <code>${escapeHtml(state.pendingApproval.gate)}</code> — ${escapeHtml(
        state.pendingApproval.label,
      )}`,
    );
  } else {
    lines.push("Pending: <i>none</i>");
  }
  lines.push(
    `Spark: ${state.spark ? `<code>${escapeHtml(state.spark.path)}</code>` : "<i>not yet captured</i>"}`,
  );
  lines.push(`Blueprint locked: ${state.blueprintLocked ? "✅" : "❌"}`);
  return lines.join("\n");
}

function noProjectBody(): string {
  return [
    "<b>Status</b>",
    "",
    "No active project. Return to the start screen and create or open one.",
  ].join("\n");
}
