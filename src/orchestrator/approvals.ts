import type { ProgressBus } from "./events.ts";
import type { Approval, ApprovalStatus, ArchitectState, GateId, PendingApproval } from "./state.ts";
import { saveState } from "./store.ts";

/**
 * Approval lifecycle. Architect pauses at every gate; the human approves,
 * rejects, edits, or revises. Approvals are append-only audit entries.
 *
 * The orchestrator is single-threaded per project: at most one pending
 * approval is allowed at a time.
 */

export class ApprovalLockError extends Error {
  constructor(existing: PendingApproval) {
    super(
      `Cannot present a new approval — gate ${existing.gate} (${existing.id}) is already pending.`,
    );
  }
}

export class NoPendingApprovalError extends Error {
  constructor() {
    super("No pending approval to resolve.");
  }
}

function nextApprovalId(state: ArchitectState): string {
  const seq = String(state.approvals.length + 1).padStart(3, "0");
  return `APPROVAL-${seq}`;
}

export async function presentApproval(
  state: ArchitectState,
  bus: ProgressBus,
  args: { gate: GateId; artifact: string; label: string },
): Promise<ArchitectState> {
  if (state.pendingApproval) throw new ApprovalLockError(state.pendingApproval);
  const pending: PendingApproval = {
    id: nextApprovalId(state),
    gate: args.gate,
    artifact: args.artifact,
    presentedAt: new Date().toISOString(),
    label: args.label,
  };
  const next: ArchitectState = { ...state, pendingApproval: pending };
  await saveState(next);
  bus.emit({
    type: "approval_required",
    approvalId: pending.id,
    gate: args.gate,
    label: args.label,
    artifact: args.artifact,
  });
  return next;
}

export async function resolveApproval(
  state: ArchitectState,
  bus: ProgressBus,
  args: { status: ApprovalStatus; notes?: string },
): Promise<ArchitectState> {
  const pending = state.pendingApproval;
  if (!pending) throw new NoPendingApprovalError();
  const approval: Approval = {
    id: pending.id,
    gate: pending.gate,
    status: args.status,
    artifact: pending.artifact,
    approvedBy: "user",
    signedAt: new Date().toISOString(),
    ...(args.notes !== undefined ? { notes: args.notes } : {}),
  };
  const next: ArchitectState = {
    ...state,
    pendingApproval: null,
    approvals: [...state.approvals, approval],
  };
  await saveState(next);
  bus.emit({
    type: "approval_recorded",
    approvalId: approval.id,
    gate: approval.gate,
    status: approval.status,
  });
  return next;
}

/** Convenience: did the user approve the latest pass at this gate? */
export function lastApprovalFor(state: ArchitectState, gate: GateId): Approval | null {
  for (let i = state.approvals.length - 1; i >= 0; i--) {
    const a = state.approvals[i];
    if (a && a.gate === gate) return a;
  }
  return null;
}
