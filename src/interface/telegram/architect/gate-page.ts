import type { PhasePrompts } from "../../../orchestrator/phase.ts";
import type { ArchitectState, GateId } from "../../../orchestrator/state.ts";
import type { PageRegistry } from "../engine/index.ts";
import {
  type Ctx,
  DopellerError,
  type InlineKeyboardButton,
  type InputFlowDefinition,
  type MenuBody,
  type PageDefinition,
  escapeHtml,
  navigateTo,
} from "../engine/index.ts";
import type { MenuRenderer } from "../engine/renderer/menu-renderer.ts";
import type { SessionStore } from "../engine/session/store.ts";
import { getArchitectRunner } from "./runner.ts";

/**
 * Gate page factory.
 *
 * `makeGatePage(spec)` produces a {@link PageDefinition} tailored to a
 * single approval gate (G1–G10). Each gate page is structurally identical:
 *
 *   - On entry, drive the orchestrator until either (a) it pauses at our
 *     gate, in which case we render the artifact summary and an
 *     Approve / Edit / Revise / Reject keyboard, or (b) it pauses at a
 *     different gate / completes, in which case we navigate forward to
 *     `spec.nextPath`.
 *
 *   - The gate page never calls `prompts.text()` itself. Phases that
 *     need free-form input from the user are wired to capture through
 *     either the page's `inputFlow` (G1) or a dedicated action handler
 *     (G2 / G6 / G8). The {@link makeGatePagePrompts} adapter wired here
 *     throws on any prompt call so accidental misuses surface loudly.
 */

export interface GatePageSpec {
  path: string;
  parent: string | null;
  gate: GateId;
  /** Shown as the body header. */
  title: string;
  /** Where to navigate once this gate is fully resolved. */
  nextPath: string;
  /** Read the artifact path from state. Return `null` when not yet produced. */
  artifactPath(state: ArchitectState): string | null;
  /** Short summary line shown above the action keyboard. */
  summarise(state: ArchitectState): string;
  /** Optional pre-step input flow (used by G1 spark capture). */
  inputFlow?: InputFlowDefinition;
}

/**
 * Navigation deps the gate page needs to forward the user past this gate.
 * Stashed on `ctx.services.nav` by the bootstrap.
 */
export interface NavServiceShape {
  registry: PageRegistry;
  renderer: MenuRenderer;
  store: SessionStore;
}

export function makeGatePage(spec: GatePageSpec): PageDefinition {
  const def: PageDefinition = {
    path: spec.path,
    parent: spec.parent,
    async onEnter(ctx: Ctx): Promise<void> {
      const projectRoot = ctx.session.projectRoot;
      if (projectRoot === null) {
        // No project — bounce back to root.
        await navigateTo(ctx, "/", getNavDeps(ctx));
        return;
      }
      const runner = getArchitectRunner(ctx);
      let state = await runner.loadCurrent(projectRoot);
      if (state === null) {
        await navigateTo(ctx, "/", getNavDeps(ctx));
        return;
      }

      // If we are not already paused at this gate, drive the engine.
      // The orchestrator either re-presents this gate, advances past it
      // and pauses elsewhere, or completes the project.
      if (runner.pendingGate(state) !== spec.gate) {
        const prompts = makeGatePagePrompts();
        state = await runner.advance(state, prompts);
      }

      if (runner.pendingGate(state) !== spec.gate) {
        // Phase advanced past us; hand the user off to the next page.
        await navigateTo(ctx, spec.nextPath, getNavDeps(ctx));
      }
    },
    async render(ctx: Ctx): Promise<MenuBody> {
      const projectRoot = ctx.session.projectRoot;
      if (projectRoot === null) {
        return { text: missingProjectBody(spec), parseMode: "HTML" };
      }
      const runner = getArchitectRunner(ctx);
      const state = await runner.loadCurrent(projectRoot);
      if (state === null) {
        return { text: missingProjectBody(spec), parseMode: "HTML" };
      }
      return { text: gateBody(spec, state), parseMode: "HTML" };
    },
    async keyboard(ctx: Ctx): Promise<InlineKeyboardButton[][]> {
      const projectRoot = ctx.session.projectRoot;
      const back = backRow(spec.parent);
      if (projectRoot === null) return [back];
      const runner = getArchitectRunner(ctx);
      const state = await runner.loadCurrent(projectRoot);
      if (state === null) return [back];

      const pending = runner.pendingGate(state);
      if (pending !== spec.gate) return [back];

      return [
        [{ text: "🟢 ✅ Approve", callback_data: "action:architect:approve" }],
        [{ text: "✏ Edit", callback_data: "action:architect:edit" }],
        [{ text: "🟡 🔁 Revise", callback_data: "action:architect:revise" }],
        [{ text: "🛑 ❌ Reject", callback_data: "action:architect:reject" }],
        back,
      ];
    },
  };
  if (spec.inputFlow !== undefined) {
    def.inputFlow = spec.inputFlow;
  }
  return def;
}

// ── Helpers ──────────────────────────────────────────────────────────

function gateBody(spec: GatePageSpec, state: ArchitectState): string {
  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(spec.title)}</b>`);
  lines.push("");
  lines.push(escapeHtml(spec.summarise(state)));
  const artifact = spec.artifactPath(state);
  if (artifact !== null) {
    lines.push("");
    lines.push(`📄 <code>${escapeHtml(artifact)}</code>`);
  }
  lines.push("");
  lines.push(`Gate: <code>${escapeHtml(spec.gate)}</code>`);
  if (state.pendingApproval && state.pendingApproval.gate === spec.gate) {
    lines.push("Status: ⏳ awaiting your approval");
  } else {
    lines.push("Status: ✅ resolved");
  }
  return lines.join("\n");
}

function missingProjectBody(spec: GatePageSpec): string {
  return [
    `<b>${escapeHtml(spec.title)}</b>`,
    "",
    "No active project. Return to the start screen and create or open one.",
  ].join("\n");
}

function backRow(parent: string | null): InlineKeyboardButton[] {
  if (parent === null) {
    return [{ text: "← Back", callback_data: "nav:/" }];
  }
  return [{ text: "← Back", callback_data: "nav:back" }];
}

/**
 * TeleFocus-shaped {@link PhasePrompts} that throws on every method.
 * Phases wired through {@link makeGatePage} must capture input via the
 * page's `inputFlow` or a dedicated action handler — never the synchronous
 * CLI-style `prompts.text()`.
 */
export function makeGatePagePrompts(): PhasePrompts {
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

function getNavDeps(ctx: Ctx): NavServiceShape {
  const nav = (ctx.services as { nav?: unknown }).nav;
  if (!isNavServiceShape(nav)) {
    throw new DopellerError("internal_db_unavailable", "internal", "no_nav_service");
  }
  return nav;
}

function isNavServiceShape(value: unknown): value is NavServiceShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<NavServiceShape>;
  return (
    typeof v.registry === "object" && typeof v.renderer === "object" && typeof v.store === "object"
  );
}
