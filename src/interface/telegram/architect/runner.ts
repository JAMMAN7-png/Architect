import type { LLMRouter } from "../../../llm/router.ts";
import { resolveApproval as resolveApprovalFn } from "../../../orchestrator/approvals.ts";
import { bootstrapProject } from "../../../orchestrator/bootstrap.ts";
import { advance as advanceFn } from "../../../orchestrator/engine.ts";
import type { ProgressBus } from "../../../orchestrator/events.ts";
import type { PhasePrompts, PhaseRegistry } from "../../../orchestrator/phase.ts";
import type { ApprovalStatus, ArchitectState, GateId } from "../../../orchestrator/state.ts";
import { loadState, stateExists } from "../../../orchestrator/store.ts";
import type { Ctx } from "../engine/index.ts";
import { DopellerError } from "../engine/index.ts";

/**
 * Architect ⇄ TeleFocus bridge.
 *
 * `ArchitectRunner` is the only module in the Telegram interface that
 * imports orchestrator functions. Every page and action handler reaches
 * the orchestrator through this service, which is injected into
 * `ctx.services.architect` by the bootstrap.
 *
 * The runner does not depend on the engine's renderer / registry / store;
 * those collaborators live alongside it on `ctx.services` (see
 * {@link getArchitectRunner}). Keeping the runner pure makes it trivial
 * to unit-test against an in-memory project root.
 */

export interface RunnerDeps {
  router: LLMRouter;
  bus: ProgressBus;
  /** Production phase registry, typically `buildDefaultRegistry()`. */
  phases: PhaseRegistry;
}

export interface ApprovalDecision {
  status: ApprovalStatus;
  notes?: string;
}

export interface ArchitectRunner {
  /** Load the state at `projectRoot`, or `null` if no project lives there. */
  loadCurrent(projectRoot: string): Promise<ArchitectState | null>;
  /** Bootstrap a new project; returns the freshly-saved state at P0. */
  newProject(args: { projectName: string; projectsRoot: string }): Promise<ArchitectState>;
  /**
   * Run `engine.advance` with a TeleFocus-shaped {@link PhasePrompts}.
   * The production search adapter is resolved at orchestrator level, so
   * `searchOverride` is never threaded through.
   */
  advance(state: ArchitectState, prompts: PhasePrompts): Promise<ArchitectState>;
  /** Resolve the pending approval and return the state with it recorded. */
  resolveApproval(state: ArchitectState, decision: ApprovalDecision): Promise<ArchitectState>;
  /** Convenience: which gate is paused, if any? */
  pendingGate(state: ArchitectState): GateId | null;
}

export function makeArchitectRunner(deps: RunnerDeps): ArchitectRunner {
  return {
    async loadCurrent(projectRoot: string): Promise<ArchitectState | null> {
      if (!(await stateExists(projectRoot))) return null;
      return loadState(projectRoot);
    },

    async newProject(args): Promise<ArchitectState> {
      return bootstrapProject(args);
    },

    async advance(state, prompts): Promise<ArchitectState> {
      return advanceFn(state, {
        bus: deps.bus,
        router: deps.router,
        prompts,
        registry: deps.phases,
      });
    },

    async resolveApproval(state, decision): Promise<ArchitectState> {
      return resolveApprovalFn(state, deps.bus, decision);
    },

    pendingGate(state): GateId | null {
      return state.pendingApproval?.gate ?? null;
    },
  };
}

/**
 * Pull the architect runner off `ctx.services`. Throws a typed
 * {@link DopellerError} when the bootstrap failed to wire it — the
 * error boundary middleware turns this into a recoverable warning toast.
 */
export function getArchitectRunner(ctx: Ctx): ArchitectRunner {
  const runner = (ctx.services as { architect?: unknown }).architect;
  if (!isArchitectRunner(runner)) {
    throw new DopellerError("internal_db_unavailable", "internal", "no_architect_runner");
  }
  return runner;
}

function isArchitectRunner(value: unknown): value is ArchitectRunner {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<ArchitectRunner>;
  return (
    typeof r.loadCurrent === "function" &&
    typeof r.newProject === "function" &&
    typeof r.advance === "function" &&
    typeof r.resolveApproval === "function" &&
    typeof r.pendingGate === "function"
  );
}
