/**
 * TeleFocus bootstrap.
 *
 * Wires the engine's collaborators (registry, renderer, flow engine,
 * middleware pipeline) into a single `AttachedTeleFocus` handle that
 * application code feeds with adapter-shaped `Ctx` updates.
 *
 * This module deliberately does NOT import grammY: the bootstrap is
 * framework-agnostic so unit tests can drive `TeleFocus.attach({...})`
 * directly without spinning up a bot. The grammY adapter lives in
 * `../grammy-adapter.ts`; the long-poll launcher lives in `../server.ts`.
 *
 * See design-system §10 (middleware pipeline) and §11 (file structure).
 */

import { InputFlowEngine } from "./flow/engine.ts";
import { buildPipeline, runPipeline } from "./middleware/pipeline.ts";
import { type PageRegistry, defaultRegistry } from "./registry.ts";
import { MenuRenderer } from "./renderer/menu-renderer.ts";
import type { SessionStore } from "./session/store.ts";
import type { Ctx, Middleware, PageDefinition, ServicesShape } from "./types.ts";

export interface AttachOptions {
  /** Persistent session store (memory or file-backed). */
  store: SessionStore;
  /**
   * Page registry to use. Defaults to {@link defaultRegistry} so
   * application code can `import { defaultRegistry }` without threading
   * the registry through every handler.
   */
  registry?: PageRegistry;
  /**
   * Convenience: pages registered via `registry.registerMany`. Pass an
   * empty array (or omit) to attach an engine with no pages — useful for
   * tests and for staged bootstraps where pages register themselves
   * later. The pipeline tolerates an empty registry; the renderer will
   * throw `unknown_page` only if a navigation actually targets a missing
   * path.
   */
  pages?: PageDefinition[];
  /** Service container injected into every `Ctx.services`. */
  services: ServicesShape;
}

export interface AttachedTeleFocus {
  registry: PageRegistry;
  renderer: MenuRenderer;
  flow: InputFlowEngine;
  pipeline: Middleware[];
  /**
   * Process an Architect-shaped {@link Ctx} through the full pipeline.
   * Equivalent to `runPipeline(ctx, attached.pipeline)`.
   */
  handle(ctx: Ctx): Promise<void>;
}

export const TeleFocus = {
  /**
   * Compose the engine pieces and return a handle that the consumer's
   * transport (grammY, tests, …) feeds with `Ctx` updates.
   */
  attach(opts: AttachOptions): AttachedTeleFocus {
    const registry = opts.registry ?? defaultRegistry;
    if (opts.pages && opts.pages.length > 0) {
      registry.registerMany(opts.pages);
    }
    const renderer = new MenuRenderer(opts.store, registry);
    const flow = new InputFlowEngine({ registry, renderer, store: opts.store });
    const pipeline = buildPipeline({ store: opts.store, registry, renderer, flow });
    return {
      registry,
      renderer,
      flow,
      pipeline,
      handle: (ctx: Ctx): Promise<void> => runPipeline(ctx, pipeline),
    };
  },
  /** Engine version. Bumped on breaking surface changes. */
  version: "1.0.0" as const,
};
