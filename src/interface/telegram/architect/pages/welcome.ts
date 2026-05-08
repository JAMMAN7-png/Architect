import {
  type Ctx,
  DopellerError,
  type InlineKeyboardButton,
  type InputFlowDefinition,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
  navigateTo,
  toast,
} from "../../engine/index.ts";
import { GATE_PATHS } from "../actions.ts";
import { getArchitectRunner } from "../runner.ts";

/**
 * `/` — Architect welcome page.
 *
 * Two states: pre-project (no `session.projectRoot`) and active. The
 * keyboard branches on that flag; the body summarises the live project
 * when present so a returning user can immediately resume from `▶ Continue`.
 *
 * The page hosts the `architect_new_project` input flow: name (validated
 * against the `^[a-z0-9-]+$` slug regex) and an optional spark file path.
 * On completion the runner bootstraps the project; subsequent navigation
 * jumps to G1's spark gate when present, or to `/status` when not.
 */

const FLOW_NEW_PROJECT = "architect_new_project";

export const welcomePage: PageDefinition = {
  path: "/",
  parent: null,
  async render(ctx: Ctx): Promise<MenuBody> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) {
      return { text: greetingBody(), parseMode: "HTML" };
    }
    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) {
      return { text: greetingBody(), parseMode: "HTML" };
    }
    return { text: activeProjectBody(state), parseMode: "HTML" };
  },
  async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
    const projectRoot = ctx.session.projectRoot;
    if (projectRoot === null) {
      return unboundKeyboard();
    }
    // Project is bound — but the on-disk state may have been wiped or
    // failed to load. In that case we fall back to the unbound branch
    // so the user isn't stranded with a Continue button that does
    // nothing useful. The continue handler also detects this and
    // navigates back to `/`, but doing it here keeps the rendered
    // keyboard honest.
    const runner = getArchitectRunner(ctx);
    const state = await runner.loadCurrent(projectRoot);
    if (state === null) {
      return unboundKeyboard();
    }
    const pendingGate = runner.pendingGate(state);
    const continueLabel =
      pendingGate !== null
        ? clampLabel(`🟡 ▶ Continue at ${pendingGate}`)
        : clampLabel("🟢 ✅ View Status");
    return [
      [{ text: continueLabel, callback_data: "action:architect:continue" }],
      [{ text: "🔍 Status", callback_data: "nav:/status" }],
      [{ text: "🔄 Reset Project", callback_data: "action:architect:reset" }],
      [{ text: "⚙ Settings", callback_data: "nav:/settings" }],
    ];
  },
  inputFlow: makeNewProjectFlow(),
};

function makeNewProjectFlow(): InputFlowDefinition {
  return {
    flowId: FLOW_NEW_PROJECT,
    maxRetries: 3,
    steps: [
      {
        field: "projectName",
        prompt: "Project name (lowercase letters, digits, hyphens):",
        inputType: "text",
        validation: {
          type: "regex",
          pattern: "^[a-z0-9-]+$",
          errorMessage: "Use lowercase letters, digits, and hyphens only.",
        },
      },
      {
        field: "sparkPath",
        prompt: "Optional: path to a spark file on disk. Send a single space to skip.",
        inputType: "text",
        validation: {
          type: "text",
          min: 0,
          max: 4096,
          errorMessage: "Path too long.",
        },
      },
    ],
    onComplete: async (collected: Record<string, unknown>, ctx: Ctx): Promise<void> => {
      const projectName = String(collected.projectName ?? "").trim();
      if (projectName === "") {
        await toast.danger(ctx, "Project name was empty — cancelled.");
        return;
      }
      const projectsRoot = getProjectsRoot(ctx);
      const runner = getArchitectRunner(ctx);
      try {
        const state = await runner.newProject({ projectName, projectsRoot });
        ctx.session.projectRoot = state.projectRoot;
        await toast.info(ctx, `Project <b>${escapeHtml(projectName)}</b> created.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await toast.danger(ctx, `Could not bootstrap project: ${escapeHtml(message)}`);
        return;
      }
      // Drive G1; if it's the active gate, route to /spark, otherwise /status.
      const target = GATE_PATHS.G1;
      await navigateTo(ctx, target, getNavDeps(ctx));
    },
  };
}

function greetingBody(): string {
  return [
    "<b>Architect</b>",
    "",
    "Turn an idea into a frozen blueprint and a strict per-service docs tree.",
    "Walk through ten gates — sketch, research, decisions, docs — each one paused for your approval.",
    "",
    "Start with a fresh project, or open one already on disk.",
  ].join("\n");
}

function activeProjectBody(state: {
  projectName: string;
  currentStage: string;
  pendingApproval: { gate: string; label: string } | null;
}): string {
  const lines = [
    `<b>${escapeHtml(state.projectName)}</b>`,
    "",
    `Stage: <code>${escapeHtml(state.currentStage)}</code>`,
  ];
  if (state.pendingApproval !== null) {
    lines.push(
      `Pending: <code>${escapeHtml(state.pendingApproval.gate)}</code> — ${escapeHtml(
        state.pendingApproval.label,
      )}`,
    );
  } else {
    lines.push("No pending approval.");
  }
  return lines.join("\n");
}

function getProjectsRoot(ctx: Ctx): string {
  const root = (ctx.services as { projectsRoot?: unknown }).projectsRoot;
  if (typeof root !== "string" || root.trim() === "") {
    throw new DopellerError("internal_db_unavailable", "internal", "no_projects_root_configured");
  }
  return root;
}

function getNavDeps(ctx: Ctx): {
  registry: import("../../engine/index.ts").PageRegistry;
  renderer: import("../../engine/renderer/menu-renderer.ts").MenuRenderer;
  store: import("../../engine/session/store.ts").SessionStore;
} {
  const nav = (ctx.services as { nav?: unknown }).nav;
  if (typeof nav !== "object" || nav === null) {
    throw new DopellerError("internal_db_unavailable", "internal", "no_nav_service");
  }
  const v = nav as Partial<{
    registry: import("../../engine/index.ts").PageRegistry;
    renderer: import("../../engine/renderer/menu-renderer.ts").MenuRenderer;
    store: import("../../engine/session/store.ts").SessionStore;
  }>;
  if (v.registry === undefined || v.renderer === undefined || v.store === undefined) {
    throw new DopellerError("internal_db_unavailable", "internal", "no_nav_service");
  }
  return { registry: v.registry, renderer: v.renderer, store: v.store };
}

/**
 * Pre-project keyboard. Shown when no `projectRoot` is bound, OR when
 * a bound `projectRoot` has no readable state on disk (the user has
 * probably wiped the project folder out-of-band).
 */
function unboundKeyboard(): InlineKeyboardButton[][] {
  return [
    [
      { text: "🆕 New Project", callback_data: "action:architect:new" },
      { text: "📦 Open Project", callback_data: "action:architect:open" },
    ],
    [{ text: "⚙ Settings", callback_data: "nav:/settings" }],
  ];
}

/**
 * Clamp a Telegram inline-button label to 64 UTF-16 code units (the
 * documented maximum for `InlineKeyboardButton.text`). The bound is
 * defensive: gate identifiers are short, so the dynamic Continue label
 * never approaches the cap in practice.
 */
function clampLabel(text: string): string {
  return text.length <= 64 ? text : text.slice(0, 64);
}
