import type { UserSession } from "../types.ts";

/**
 * Resolve the initial route for a `/start` interaction.
 *
 * Architect-flavoured rules (design-system §06-navigation):
 *
 *   - No bound project root        → `/welcome` (one-time onboarding).
 *   - No payload                   → `/` (home).
 *   - `project_<id>` payload       → `/project/<id>` (caller validates id).
 *   - Anything else                → `/`.
 *
 * The function is pure: id validation, side-effects (e.g. binding a
 * project), and unknown-page handling are the caller's responsibility.
 */
export function resolveStart(payload: string | undefined, session: UserSession): string {
  if (session.projectRoot === null) return "/welcome";
  if (!payload) return "/";
  const prefix = "project_";
  if (payload.startsWith(prefix)) return `/project/${payload.slice(prefix.length)}`;
  return "/";
}
