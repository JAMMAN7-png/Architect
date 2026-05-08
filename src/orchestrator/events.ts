import type { GateId, Stage } from "./state.ts";

/**
 * ProgressEvent — the single contract between agents and any user-facing
 * surface. CLI (Ink) and Telegram (grammY) subscribe to the same bus.
 *
 * No agent prints to the user. Every output is a ProgressEvent.
 */
export type ProgressEvent =
  | { type: "stage_started"; stageId: Stage; label: string }
  | { type: "step_started"; stepId: string; label: string }
  | { type: "token_stream"; text: string }
  | { type: "tool_started"; tool: string; inputSummary: string }
  | { type: "tool_finished"; tool: string; resultSummary: string }
  | { type: "warning"; message: string }
  | {
      type: "approval_required";
      approvalId: string;
      gate: GateId;
      label: string;
      artifact: string;
    }
  | { type: "approval_recorded"; approvalId: string; gate: GateId; status: string }
  | { type: "stage_completed"; stageId: Stage; artifactPaths: string[] }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "info"; message: string };

export type ProgressListener = (event: ProgressEvent) => void;

export class ProgressBus {
  #listeners = new Set<ProgressListener>();

  subscribe(listener: ProgressListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: ProgressEvent): void {
    for (const l of this.#listeners) {
      try {
        l(event);
      } catch {
        // listener errors must not crash the orchestrator
      }
    }
  }
}
