import type { InputFlowEngine, Middleware } from "./types.ts";

/**
 * Input-capture middleware factory (design-system §10.8).
 *
 * If an input flow is currently awaiting user input, hand the update to
 * the flow engine and short-circuit the chain — regardless of whether
 * the engine reports the value as `advanced`, `rejected`, or `completed`.
 * The engine is responsible for rendering its own UX (progress edit,
 * DANGER toast on rejection, `onComplete` on completion); the pipeline
 * never re-processes captured input as a command or callback.
 *
 * If no flow is active, the middleware is transparent: it simply yields
 * to the next stage.
 */
export function makeInputCapture(deps: { flow: InputFlowEngine }): Middleware {
  return async (ctx, next) => {
    const { active, awaitingInput } = ctx.session.inputFlow;
    if (!active || !awaitingInput) {
      return next();
    }
    await deps.flow.capture(ctx);
  };
}
