import type { Ctx } from "../types.ts";
import { type NavigateDeps, navigateTo } from "./navigate.ts";

/**
 * Pop the navigation stack and route to the previous page.
 *
 * Bound to the `nav:back` callback. The current page is removed from the
 * stack first; whatever sits on top after that is the destination. An
 * empty stack falls back to root `/` so Back is always meaningful.
 *
 * The actual transition is delegated to {@link navigateTo}, which means
 * `← Back` honours `hasUnsavedWork` guards just like a forward nav.
 *
 * See design-system §06-navigation.
 */
export async function goBack(ctx: Ctx, deps: NavigateDeps): Promise<void> {
  const stack = ctx.session.menu.navigationStack;
  stack.pop();
  const previous = stack[stack.length - 1] ?? "/";
  await navigateTo(ctx, previous, deps);
}
