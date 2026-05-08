import type { Bot, Context as GrammyContext } from "grammy";
import { LLM_PROVIDERS, SEARCH_PROVIDERS, makeSettingsService } from "../../../config/service.ts";
import { listKnownModels } from "../../../llm/models.ts";
import {
  type Ctx,
  DopellerError,
  type InputFlowDefinition,
  type MenuRenderer,
  type SessionStore,
  escapeHtml,
  toast,
} from "../engine/index.ts";
import { adaptUpdate } from "../grammy-adapter.ts";
import type { ActionDeps } from "./actions.ts";

/**
 * grammY action handlers for `action:settings:*` callbacks.
 *
 * Three callback shapes:
 *   - `action:settings:toggle:<dottedKey>:<member>` — flip list membership.
 *   - `action:settings:set:<dottedKey>:<value>`     — set scalar / enum / bool.
 *   - `action:settings:edit:<dottedKey>`            — start the host page's
 *      input flow with `editingKey` stashed in `pageData`; on completion
 *      the flow's `onComplete` reads that key and applies the value.
 *
 * Every handler owns its own session lifecycle (load + save) since
 * `bot.callbackQuery(...)` short-circuits the engine pipeline.
 */

const TOGGLE_RE = /^action:settings:toggle:([^:]+):(.+)$/;
const SET_RE = /^action:settings:set:([^:]+):(.+)$/;
const EDIT_RE = /^action:settings:edit:(.+)$/;

const SCALAR_FIELD = "value";

export function registerSettingsActions(bot: Bot, deps: ActionDeps): void {
  bot.callbackQuery(TOGGLE_RE, makeToggleHandler(deps));
  bot.callbackQuery(SET_RE, makeSetHandler(deps));
  bot.callbackQuery(EDIT_RE, makeEditHandler(deps));
}

// ── Handlers ─────────────────────────────────────────────────────────

function makeToggleHandler(deps: ActionDeps): (gctx: GrammyContext) => Promise<void> {
  return async (gctx) => {
    const ctx = await loadCtx(gctx, deps);
    if (ctx === null) {
      await silenceSpinner(gctx);
      return;
    }
    try {
      const data = gctx.callbackQuery?.data ?? "";
      const m = TOGGLE_RE.exec(data);
      if (m === null) {
        throw new DopellerError("internal_db_unavailable", "internal", "bad_settings_action", {
          data,
        });
      }
      const key = m[1] ?? "";
      let member = m[2] ?? "";
      if (member.startsWith("idx:")) {
        const idx = Number.parseInt(member.slice(4), 10);
        const resolved = resolveIndexed(key, idx);
        if (resolved === null) {
          await toast.danger(ctx, "Unknown option.");
          await deps.store.save(ctx.session);
          return;
        }
        member = resolved;
      }
      const svc = makeSettingsService();
      const current = await svc.load();
      try {
        const next = svc.toggle(current, key, member);
        await svc.save(next);
        await deps.renderer.rerender(ctx);
        const v = svc.get(next, key);
        await toast.info(ctx, `${escapeHtml(key)}: ${escapeHtml(formatValue(v))}`);
      } catch (err) {
        await reportFailure(ctx, err);
      }
      await deps.store.save(ctx.session);
    } finally {
      await silenceSpinner(gctx);
    }
  };
}

function makeSetHandler(deps: ActionDeps): (gctx: GrammyContext) => Promise<void> {
  return async (gctx) => {
    const ctx = await loadCtx(gctx, deps);
    if (ctx === null) {
      await silenceSpinner(gctx);
      return;
    }
    try {
      const data = gctx.callbackQuery?.data ?? "";
      const m = SET_RE.exec(data);
      if (m === null) {
        throw new DopellerError("internal_db_unavailable", "internal", "bad_settings_action", {
          data,
        });
      }
      const key = m[1] ?? "";
      let raw = m[2] ?? "";
      if (raw.startsWith("idx:")) {
        const idx = Number.parseInt(raw.slice(4), 10);
        const resolved = resolveIndexed(key, idx);
        if (resolved === null) {
          await toast.danger(ctx, "Unknown option.");
          await deps.store.save(ctx.session);
          return;
        }
        raw = resolved;
      }
      const svc = makeSettingsService();
      const current = await svc.load();
      try {
        const next = svc.set(current, key, raw);
        await svc.save(next);
        await deps.renderer.rerender(ctx);
        const v = svc.get(next, key);
        await toast.info(ctx, `${escapeHtml(key)}: ${escapeHtml(formatValue(v))}`);
      } catch (err) {
        await reportFailure(ctx, err);
      }
      await deps.store.save(ctx.session);
    } finally {
      await silenceSpinner(gctx);
    }
  };
}

function makeEditHandler(deps: ActionDeps): (gctx: GrammyContext) => Promise<void> {
  return async (gctx) => {
    const ctx = await loadCtx(gctx, deps);
    if (ctx === null) {
      await silenceSpinner(gctx);
      return;
    }
    try {
      const data = gctx.callbackQuery?.data ?? "";
      const m = EDIT_RE.exec(data);
      if (m === null) {
        throw new DopellerError("internal_db_unavailable", "internal", "bad_settings_action", {
          data,
        });
      }
      const key = m[1] ?? "";
      const pagePath = ctx.session.menu.currentPage;
      const pageDef = deps.registry.getOrThrow(pagePath);
      const flow = pageDef.inputFlow;
      if (flow === undefined) {
        await toast.danger(ctx, "This page has no editor.");
        await deps.store.save(ctx.session);
        return;
      }
      const bucket = ctx.session.pageData[pagePath] ?? {};
      bucket.editingKey = key;
      ctx.session.pageData[pagePath] = bucket;
      try {
        await deps.flow.start(flow.flowId, ctx);
      } catch (err) {
        await reportFailure(ctx, err);
        await deps.store.save(ctx.session);
      }
    } finally {
      await silenceSpinner(gctx);
    }
  };
}

// ── Scalar editor flow factory ───────────────────────────────────────

/**
 * Build a one-step input flow for a scalar settings editor. `pagePath` is
 * the page that hosts the flow; `flowId` is the engine-required identifier
 * that the page's `inputFlow.flowId` MUST equal.
 *
 * On completion the flow reads `session.pageData[pagePath].editingKey`
 * (stashed by {@link registerSettingsActions} when the user tapped the
 * `✏ Edit` button), applies the value through {@link makeSettingsService},
 * persists, surfaces a toast, and re-renders the host page if the
 * services container exposes a navigation surface.
 */
export function makeScalarEditorFlow(pagePath: string, flowId: string): InputFlowDefinition {
  return {
    flowId,
    maxRetries: 3,
    steps: [
      {
        field: SCALAR_FIELD,
        prompt: "Enter the new value:",
        inputType: "text",
        validation: {
          type: "text",
          min: 1,
          max: 1024,
          errorMessage: "Value must be 1–1024 characters.",
        },
      },
    ],
    onComplete: async (collected: Record<string, unknown>, ctx: Ctx): Promise<void> => {
      const bucket = ctx.session.pageData[pagePath];
      const editingKey = typeof bucket?.editingKey === "string" ? bucket.editingKey : "";
      if (editingKey === "") {
        await toast.danger(ctx, "No setting was selected to edit.");
        return;
      }
      const raw = String(collected[SCALAR_FIELD] ?? "").trim();
      try {
        const svc = makeSettingsService();
        const cfg = await svc.load();
        const next = svc.set(cfg, editingKey, raw);
        await svc.save(next);
        const v = svc.get(next, editingKey);
        await toast.info(ctx, `${escapeHtml(editingKey)}: ${escapeHtml(formatValue(v))}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await toast.danger(ctx, escapeHtml(message));
      }
      if (bucket !== undefined) bucket.editingKey = undefined;
      await rerenderViaServices(ctx);
      await saveSessionViaServices(ctx);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function loadCtx(grammyCtx: GrammyContext, deps: ActionDeps): Promise<Ctx | null> {
  const ctx = await adaptUpdate(grammyCtx, deps.services);
  if (ctx === null) return null;
  const session = await deps.store.load(ctx.userId, ctx.chatId);
  ctx.session = session;
  session.lastInteractionAt = Date.now();
  return ctx;
}

async function silenceSpinner(grammyCtx: GrammyContext): Promise<void> {
  const cb = grammyCtx.callbackQuery;
  if (cb === undefined) return;
  try {
    await grammyCtx.answerCallbackQuery();
  } catch {
    // Telegram rejects acks for queries already answered or expired.
  }
}

async function reportFailure(ctx: Ctx, err: unknown): Promise<void> {
  if (err instanceof DopellerError) {
    throw err;
  }
  const message = err instanceof Error ? err.message : String(err);
  try {
    await toast.danger(ctx, escapeHtml(message));
  } catch {
    // Swallow rendering failures.
  }
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? "(none)" : v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === undefined || v === null) return "(unset)";
  return String(v);
}

interface NavServices {
  renderer?: MenuRenderer;
  store?: SessionStore;
}

function readNavServices(ctx: Ctx): NavServices | null {
  const nav = (ctx.services as { nav?: unknown }).nav;
  if (typeof nav !== "object" || nav === null) return null;
  return nav as NavServices;
}

async function rerenderViaServices(ctx: Ctx): Promise<void> {
  const nav = readNavServices(ctx);
  if (nav?.renderer === undefined) return;
  try {
    await nav.renderer.rerender(ctx);
  } catch {
    // Best-effort: caller already toasted the result.
  }
}

async function saveSessionViaServices(ctx: Ctx): Promise<void> {
  const nav = readNavServices(ctx);
  if (nav?.store === undefined) return;
  try {
    await nav.store.save(ctx.session);
  } catch {
    // Pipeline session-save did not run because input-capture short-
    // circuited; failure here is non-fatal.
  }
}

// ── Indexed-callback resolver registry ───────────────────────────────

/**
 * Map a settings key to its ordered candidate slug list. The same list
 * MUST back the page's keyboard so `idx` round-trips. Adding a new
 * indexed key requires updating both the page and {@link candidatesFor}.
 */
function candidatesFor(key: string): readonly string[] {
  if (
    key === "models.strategic" ||
    key === "models.execution" ||
    key === "models.ui" ||
    key === "models.fallback" ||
    key === "models.ensemble"
  ) {
    return listKnownModels();
  }
  if (key === "llm.enabled_providers") return LLM_PROVIDERS;
  if (key === "search.enabled_providers" || key === "search.provider") return SEARCH_PROVIDERS;
  return [];
}

function resolveIndexed(key: string, idx: number): string | null {
  if (!Number.isFinite(idx)) return null;
  const candidates = candidatesFor(key);
  if (idx < 0 || idx >= candidates.length) return null;
  return candidates[idx] ?? null;
}

/** Exported for pages to use the same enumeration when building keyboards. */
export function settingsCandidates(key: string): readonly string[] {
  return candidatesFor(key);
}
