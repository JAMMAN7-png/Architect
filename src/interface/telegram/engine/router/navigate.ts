import { cleanupScope } from "../messages/tracking.ts";
import type { PageRegistry } from "../registry.ts";
import type { SessionStore } from "../session/store.ts";
import { type Ctx, DopellerError, type PageDefinition, type UserSession } from "../types.ts";
import { goBack } from "./back.ts";
import { openNavigationGuard } from "./guard.ts";

/**
 * Navigation router.
 *
 * Resolves `nav:<path>` callbacks and programmatic transitions. The
 * router is the single owner of `session.menu.{currentPage, previousPage,
 * navigationStack}` mutations; handlers MUST go through `navigateTo`
 * rather than touching the menu state directly.
 *
 * See design-system §06-navigation.
 */

const MAX_STACK = 50;
const MAX_SAVE_RETRIES = 3;

/**
 * Structural shape the router needs from the menu renderer. Defining it
 * here as a port keeps the router agnostic of the concrete `MenuRenderer`
 * class living in `../renderer/`; class instances satisfy this interface
 * structurally.
 */
export interface MenuRenderer {
  renderMenu(ctx: Ctx, page: PageDefinition): Promise<void>;
  rerender(ctx: Ctx): Promise<void>;
}

export interface NavigateDeps {
  registry: PageRegistry;
  renderer: MenuRenderer;
  store: SessionStore;
}

/**
 * Apply the breadcrumb stack update. Truncates from the front once the
 * stack exceeds `MAX_STACK`; `← Back` keeps working locally because the
 * truncation only drops the oldest entries.
 */
function applyStackUpdate(session: UserSession, current: string, target: string): void {
  session.menu.previousPage = current;
  session.menu.currentPage = target;
  session.menu.navigationStack.push(target);
  if (session.menu.navigationStack.length > MAX_STACK) {
    session.menu.navigationStack.splice(0, session.menu.navigationStack.length - MAX_STACK);
  }
}

/**
 * Navigate the user from the current page to `target`.
 *
 * Pipeline:
 *   1. Capture current page; consult `hasUnsavedWork` and defer to the
 *      navigation guard if a different page is requested with dirty state.
 *   2. Run the current page's `onExit` and tear down its scoped messages.
 *   3. Resolve the target page (throws `unknown_page` if missing).
 *   4. Run the target page's `onEnter`.
 *   5. Update the breadcrumb stack and render via the menu renderer.
 *   6. Persist with the version-guarded session store; reload+retry on
 *      conflicts up to `MAX_SAVE_RETRIES`. Final failure surfaces as
 *      `internal_redis_unavailable` so the error boundary can render a
 *      retry-able warning toast.
 */
export async function navigateTo(ctx: Ctx, target: string, deps: NavigateDeps): Promise<void> {
  const current = ctx.session.menu.currentPage;
  const currentDef = deps.registry.get(current);

  if (currentDef?.hasUnsavedWork?.(ctx) === true && target !== current) {
    await openNavigationGuard(ctx, target, deps);
    return;
  }

  await currentDef?.onExit?.(ctx);
  await cleanupScope(ctx, current);

  const targetDef = deps.registry.getOrThrow(target);
  await targetDef.onEnter?.(ctx);

  applyStackUpdate(ctx.session, current, target);

  await deps.renderer.renderMenu(ctx, targetDef);

  for (let attempt = 0; attempt <= MAX_SAVE_RETRIES; attempt++) {
    if (await deps.store.save(ctx.session)) return;
    if (attempt === MAX_SAVE_RETRIES) break;
    ctx.session = await deps.store.load(ctx.session.userId, ctx.session.chatId);
    applyStackUpdate(ctx.session, current, target);
  }

  throw new DopellerError("internal_redis_unavailable", "internal", "session_save_conflict", {
    current,
    target,
  });
}

/**
 * Build a fluent router bound to a fixed dependency set. Convenient for
 * call sites (action handlers, command map) that want to invoke
 * `navigateTo` / `goBack` without threading deps through every call.
 */
export function makeRouter(deps: NavigateDeps): {
  navigateTo(ctx: Ctx, target: string): Promise<void>;
  goBack(ctx: Ctx): Promise<void>;
} {
  return {
    navigateTo: (ctx, target) => navigateTo(ctx, target, deps),
    goBack: (ctx) => goBack(ctx, deps),
  };
}
