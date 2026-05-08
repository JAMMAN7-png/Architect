import type { LLMRouter } from "../llm/router.ts";
import type { SearchProvider } from "../search/adapter.ts";
import type { ProgressBus } from "./events.ts";
import type { ArchitectState, Stage } from "./state.ts";

/**
 * Phase contract. Every phase is a pure-ish unit that accepts the current
 * state, performs work, may pause for an approval, and returns the new state.
 *
 * `prompt` is the only channel for user input — supplied by the active
 * interface (CLI or Telegram) so phase logic stays UI-agnostic.
 */

export interface PhasePrompts {
  /** Free-text input. Returns the user's reply verbatim. */
  text(question: string, opts?: { multiline?: boolean }): Promise<string>;
  /** Single-choice pick. Returns the chosen value. */
  select<T extends string>(
    question: string,
    choices: readonly { value: T; label: string }[],
  ): Promise<T>;
  /** Yes/No confirm. */
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  /** Approval gate — returns one of approve/reject/edit/revise. */
  approve(
    label: string,
    artifact: string,
  ): Promise<{
    status: "approved" | "rejected" | "edited" | "revised";
    notes?: string;
  }>;
}

export interface PhaseContext {
  state: ArchitectState;
  bus: ProgressBus;
  router: LLMRouter;
  prompts: PhasePrompts;
  /** Optional injected search provider. When omitted, phases that need
   * search call `resolveSearchProvider(cfg)` themselves. Tests use this
   * to inject a deterministic mock. */
  searchOverride?: SearchProvider;
}

export type PhaseHandler = (ctx: PhaseContext) => Promise<ArchitectState>;

export interface PhaseDefinition {
  stage: Stage;
  label: string;
  run: PhaseHandler;
}

/** Registry of all phase implementations. */
export class PhaseRegistry {
  #map = new Map<Stage, PhaseDefinition>();

  register(def: PhaseDefinition): void {
    this.#map.set(def.stage, def);
  }

  get(stage: Stage): PhaseDefinition | undefined {
    return this.#map.get(stage);
  }
}
