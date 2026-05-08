import type { LLMRouter } from "../llm/router.ts";
import type { ProgressBus } from "./events.ts";
import type { PhasePrompts, PhaseRegistry } from "./phase.ts";
import type { ArchitectState } from "./state.ts";
import { saveState } from "./store.ts";
import { nextStage } from "./transitions.ts";

/**
 * Orchestrator engine. Advances the state machine one phase at a time:
 *   - looks up the phase handler for `state.currentStage`
 *   - runs it (which may emit progress events and present approvals)
 *   - persists the returned state
 *   - transitions to the next stage and saves
 *
 * The loop continues until either:
 *   - we reach `DONE`
 *   - a phase pauses by leaving `pendingApproval` set (e.g. CLI exits between
 *     phases), in which case the loop returns and resumes on next invocation
 */

export class MissingPhaseError extends Error {
  constructor(stage: string) {
    super(`No phase handler registered for stage ${stage}`);
  }
}

export interface EngineDeps {
  bus: ProgressBus;
  router: LLMRouter;
  prompts: PhasePrompts;
  registry: PhaseRegistry;
  /** Optional search provider injected for P7 (tests). */
  searchOverride?: import("../search/adapter.ts").SearchProvider;
}

export async function advance(state: ArchitectState, deps: EngineDeps): Promise<ArchitectState> {
  let current = state;
  while (current.currentStage !== "DONE") {
    const def = deps.registry.get(current.currentStage);
    if (!def) throw new MissingPhaseError(current.currentStage);

    deps.bus.emit({
      type: "stage_started",
      stageId: current.currentStage,
      label: def.label,
    });

    const after = await def.run({
      state: current,
      bus: deps.bus,
      router: deps.router,
      prompts: deps.prompts,
      ...(deps.searchOverride ? { searchOverride: deps.searchOverride } : {}),
    });

    // If a phase left pendingApproval set, the human owes us an answer —
    // pause the loop here. The interface layer will resume after the user
    // resolves it.
    if (after.pendingApproval) {
      await saveState(after);
      return after;
    }

    const transitioned: ArchitectState = {
      ...after,
      currentStage: nextStage(after.currentStage),
    };
    await saveState(transitioned);

    deps.bus.emit({
      type: "stage_completed",
      stageId: current.currentStage,
      artifactPaths: collectArtifactPaths(current, transitioned),
    });

    current = transitioned;
  }
  return current;
}

function collectArtifactPaths(before: ArchitectState, after: ArchitectState): string[] {
  const paths: string[] = [];
  const fields = [
    "grownSparkPath",
    "checkupPath",
    "approvedEssencePath",
    "sketchPath",
    "decisionsPath",
    "docsManifestPath",
  ] as const;
  for (const k of fields) {
    if (after[k] && after[k] !== before[k]) paths.push(after[k] as string);
  }
  if (after.spark && !before.spark) paths.push(after.spark.path);
  return paths;
}
