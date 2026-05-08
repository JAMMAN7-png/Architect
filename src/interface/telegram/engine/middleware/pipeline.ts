import { errorBoundary } from "../errors/boundary.ts";
import type { Ctx } from "../types.ts";
import { makeInputCapture } from "./input-capture.ts";
import { makeRouterMiddleware } from "./router.ts";
import { makeSessionLoader } from "./session-loader.ts";
import { makeSessionSave } from "./session-save.ts";
import type { Middleware, MiddlewareDeps } from "./types.ts";

/**
 * Build the canonical middleware chain (design-system §10).
 *
 * Order is contract — the framework invariants depend on it:
 *
 * 1. {@link errorBoundary}    — wraps the chain so typed errors render UX
 *    and unknown errors are caught + reported.
 * 2. session loader           — rehydrates `ctx.session` and sweeps stale
 *    ephemeral entries.
 * 3. input capture            — short-circuits when an input flow is
 *    awaiting the user's reply.
 * 4. router/dispatcher        — decodes `callback_data` and routes to the
 *    nav/guard/flow helpers; otherwise falls through.
 * 5. session save             — persists the (possibly mutated) session
 *    via the store's version guard.
 *
 * The bootstrap may insert further middlewares (rate-limit, language
 * enforcement, mem0 prefetch, persona signal, analytics, …) at the named
 * insertion points described in the design-system doc. Splice into the
 * returned array before handing it to {@link runPipeline}.
 */
export function buildPipeline(deps: MiddlewareDeps): Middleware[] {
  return [
    errorBoundary,
    makeSessionLoader(deps.store),
    makeInputCapture({ flow: deps.flow }),
    makeRouterMiddleware({
      flow: deps.flow,
      registry: deps.registry,
      renderer: deps.renderer,
      store: deps.store,
    }),
    makeSessionSave(deps.store),
  ];
}

/**
 * Compose the supplied middleware array into a single Koa-style chain
 * and execute it against `ctx`. Each middleware receives a `next`
 * continuation that advances exactly one step; not calling `next`
 * short-circuits the remaining middlewares.
 *
 * Calling `next()` more than once from the same middleware is a
 * programmer error: the dispatcher throws so the bug surfaces at the
 * call site instead of silently double-running downstream stages. An
 * empty `chain` is a no-op.
 */
export async function runPipeline(ctx: Ctx, chain: Middleware[]): Promise<void> {
  let lastIndex = -1;
  const dispatch = async (index: number): Promise<void> => {
    if (index <= lastIndex) {
      throw new Error("runPipeline: next() called multiple times in a single middleware");
    }
    lastIndex = index;
    const mw = chain[index];
    if (!mw) return;
    await mw(ctx, () => dispatch(index + 1));
  };
  await dispatch(0);
}
