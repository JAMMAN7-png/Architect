import type { PageRegistry } from "../registry.ts";
import type { SessionStore } from "../session/store.ts";
import type { Ctx, InlineKeyboardMarkup, Middleware, NextFn, PageDefinition } from "../types.ts";

/**
 * Middleware pipeline contracts.
 *
 * The pipeline is the ordered chain every Telegram update passes through.
 * See [docs/design-system/10-middleware.md](../../../../../docs/design-system/10-middleware.md)
 * for the canonical specification, including the contract order and the
 * rationale for each stage's responsibility.
 *
 * ## Forward declarations
 *
 * `MenuRenderer` and `InputFlowEngine` are declared structurally here so
 * the pipeline can be wired without taking a hard dependency on their
 * concrete implementations. The actual classes live alongside the engine
 * (`../renderer/menu-renderer.ts`, `../flow/engine.ts`) and satisfy these
 * interfaces structurally — TypeScript's structural typing means no
 * `implements` clause is required for the wiring to type-check.
 */

export type { Middleware, NextFn };

/**
 * Public surface of the menu renderer consumed by the pipeline. Mirrors
 * the renderer API documented in design-system §03.
 */
export interface MenuRenderer {
  /** Renders a page on the menu message. Sends fresh if no ID or stale. */
  renderMenu(ctx: Ctx, page: PageDefinition): Promise<void>;
  /** Re-renders the current page (useful after an action). */
  rerender(ctx: Ctx): Promise<void>;
  /** Edits only the keyboard when text is unchanged. */
  editKeyboardOnly(ctx: Ctx, markup: InlineKeyboardMarkup): Promise<void>;
}

/**
 * Public surface of the input-flow engine consumed by the pipeline.
 * Mirrors the engine API documented in design-system §05.
 */
export interface InputFlowEngine {
  /** Begin a flow at step 0; sends the first prompt + progress message. */
  start(flowId: string, ctx: Ctx): Promise<void>;
  /**
   * Validate the current update against the active step. Returns:
   * * `'advanced'`  — value accepted, advanced to next step.
   * * `'completed'` — value accepted, flow finished, `onComplete` ran.
   * * `'rejected'`  — validation failed; UX (toast + retry) was rendered.
   */
  capture(ctx: Ctx): Promise<"advanced" | "rejected" | "completed">;
  /** Cancel the active flow; runs `onCancel`, resets session state. */
  cancel(ctx: Ctx): Promise<void>;
  /** Re-render the current step after an engine restart mid-flow. */
  resume(ctx: Ctx): Promise<void>;
}

/**
 * Service container injected into {@link buildPipeline}. The bootstrap
 * constructs each implementation once and threads the container through
 * the chain. Additional services (analytics, rate-limit, mem0, …) live in
 * future-wave middleware factories that the bootstrap composes alongside
 * this base set; see design-system §10 "Insertion points".
 */
export interface MiddlewareDeps {
  store: SessionStore;
  registry: PageRegistry;
  renderer: MenuRenderer;
  flow: InputFlowEngine;
}
