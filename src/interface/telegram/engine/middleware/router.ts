import type { PageRegistry } from "../registry.ts";
import { goBack } from "../router/back.ts";
import { resolveNavigationGuard } from "../router/guard.ts";
import { navigateTo } from "../router/navigate.ts";
import type { SessionStore } from "../session/store.ts";
import type { Ctx } from "../types.ts";
import type { InputFlowEngine, MenuRenderer, Middleware } from "./types.ts";

/**
 * Dependency container for the navigation/dispatch helpers. The shape is
 * shared with `../router/navigate.ts`, `../router/back.ts`, and
 * `../router/guard.ts`, which all accept the same struct so middleware
 * and direct callers may use them interchangeably.
 */
interface RouterDeps {
  registry: PageRegistry;
  renderer: MenuRenderer;
  store: SessionStore;
  flow: InputFlowEngine;
}

/**
 * Navigation router / action dispatcher middleware (design-system §10.9).
 *
 * Decodes the canonical `callback_data` grammar (design-system §03):
 *
 * | Prefix          | Behaviour                                        |
 * |-----------------|--------------------------------------------------|
 * | `nav:back`      | Pop the navigation stack and re-render.         |
 * | `nav:<path>`    | Navigate to `<path>` (runs nav-guards).         |
 * | `guard:stay`    | Resolve an open nav-guard with "stay".          |
 * | `guard:leave`   | Resolve an open nav-guard with "leave".         |
 * | `flow:*`        | Forward to the input-flow engine.               |
 * | `action:*`      | Fall through to consumer handlers.              |
 *
 * For text messages starting with `/`, the middleware falls through so
 * consumer command handlers (registered on grammY directly by the
 * bootstrap) can run.
 *
 * Regardless of which branch is taken, the Telegram callback-query
 * spinner is silenced before returning. Failures of
 * `answerCallbackQuery` are swallowed: Telegram rejects the call once
 * the query has expired (~15 s) or once a downstream handler has already
 * answered it, neither of which warrants surfacing an error to the user.
 */
export function makeRouterMiddleware(deps: RouterDeps): Middleware {
  return async (ctx, next) => {
    const callbackQuery = ctx.callbackQuery;
    if (callbackQuery !== undefined) {
      try {
        await dispatchCallback(ctx, callbackQuery.data, deps, next);
      } finally {
        await silenceSpinner(ctx, callbackQuery.id);
      }
      return;
    }

    // Commands and free text are forwarded to consumer handlers
    // (registered directly on grammY by the bootstrap).
    await next();
  };
}

async function dispatchCallback(
  ctx: Ctx,
  data: string,
  deps: RouterDeps,
  next: () => Promise<void>,
): Promise<void> {
  if (data === "nav:back") {
    await goBack(ctx, deps);
    return;
  }
  if (data.startsWith("nav:")) {
    await navigateTo(ctx, data.slice("nav:".length), deps);
    return;
  }
  if (data === "guard:stay") {
    await resolveNavigationGuard(ctx, "stay", deps);
    return;
  }
  if (data === "guard:leave") {
    await resolveNavigationGuard(ctx, "leave", deps);
    return;
  }
  if (data.startsWith("flow:")) {
    await deps.flow.capture(ctx);
    return;
  }
  // `action:*` and any unrecognised prefix fall through so consumer
  // code (registered on grammY) can pick them up.
  await next();
}

async function silenceSpinner(ctx: Ctx, callbackQueryId: string): Promise<void> {
  try {
    await ctx.api.answerCallbackQuery(callbackQueryId, {});
  } catch {
    // Spinner-acknowledgement failures are non-fatal.
  }
}
