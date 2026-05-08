/**
 * User-visible error templates keyed by `DopellerError.code`.
 *
 * Templates are intentionally short and HTML-bold-ready; the boundary
 * middleware renders them as `<b>{title}</b>\n{body}` after escaping.
 *
 * See design-system §08-error-handling.
 */

export interface ErrorTemplate {
  /** Short, bold-ready headline. May contain `{placeholders}`. */
  title: string;
  /** Detail line. May contain `{placeholders}` filled from `err.metadata`. */
  body: string;
  /** Optional inline CTA button. */
  cta?: { label: string; callback: string };
  /** Toast subtype; defaults to `DANGER` when omitted. */
  subtype?: "WARNING" | "DANGER";
}

export const templates: Record<string, ErrorTemplate> = {
  insufficient_stars: {
    title: "Not enough Stars",
    body: "You need {need} Stars; you have {have}.",
    cta: { label: "⭐ Buy Stars", callback: "nav:/billing/top-up" },
  },
  invalid_input: {
    title: "Check that again",
    body: "{rule_error}",
    cta: { label: "← Back", callback: "nav:back" },
  },
  unknown_page: {
    title: "Couldn't find that—going home",
    body: "That page doesn't exist anymore.",
    cta: { label: "🏠 Home", callback: "nav:/" },
  },
  tool_timeout: {
    title: "That took too long",
    body: "The {tool} tool timed out. Retry, or cancel.",
    cta: { label: "🔄 Retry", callback: "action:retry:last" },
    subtype: "WARNING",
  },
  token_revoked: {
    title: "We need to reconnect",
    body: "Authentication is no longer valid. Contact support if you believe this is an error.",
    cta: { label: "📨 Contact Support", callback: "nav:/support" },
    subtype: "WARNING",
  },
  provider_all_down: {
    title: "We're catching our breath",
    body: "All AI providers are slow right now. Please try again in a minute.",
    cta: { label: "🔄 Retry", callback: "action:retry:last" },
    subtype: "WARNING",
  },
  bot_suspended: {
    title: "This bot is paused",
    body: "Reason: {reason}.\nContact support if you think this is wrong.",
    cta: { label: "📨 Contact Support", callback: "nav:/support" },
  },
  content_blocked: {
    title: "I can't go there",
    body: "{refusal_reason}",
  },
  internal_db_unavailable: {
    title: "We're having trouble",
    body: "A core service is temporarily unavailable. Please try again shortly.",
    cta: { label: "🔄 Retry", callback: "action:retry:last" },
    subtype: "WARNING",
  },
  internal_redis_unavailable: {
    title: "We're having trouble",
    body: "Session storage is temporarily unavailable. Please try again shortly.",
    cta: { label: "🔄 Retry", callback: "action:retry:last" },
    subtype: "WARNING",
  },

  // ── Architect-specific catalogue ───────────────────────────────────
  architect_no_project: {
    title: "No project yet",
    body: "No project loaded—run /new first.",
  },
  architect_pending_approval: {
    title: "Approval pending",
    body: "There is already a pending approval. Resolve it first.",
  },
  architect_phase_failed: {
    title: "Phase failed",
    body: "A pipeline phase failed: {phase}.",
    cta: { label: "🔄 Retry", callback: "action:architect:retry" },
    subtype: "WARNING",
  },
};
