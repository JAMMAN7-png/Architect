import type { PhaseDefinition } from "../phase.ts";

/**
 * P0 — Project Bootstrap. Workspace creation happens before the engine ever
 * runs (`bootstrapProject`), so this phase is a no-op transition step that
 * exists to keep the state machine linear.
 */
export const p0Bootstrap: PhaseDefinition = {
  stage: "P0_BOOTSTRAP",
  label: "Project bootstrap",
  run: async ({ state }) => state,
};
