import type { Bot, Context as GrammyContext } from "grammy";
import type { ArchitectConfig } from "../../../config/schema.ts";
import { LLM_PROVIDERS, SEARCH_PROVIDERS, makeSettingsService } from "../../../config/service.ts";
import { listAllDynamicModels } from "../../../llm/dynamic-models.ts";
import { listKnownModels } from "../../../llm/models.ts";
import { LLMRouter } from "../../../llm/router.ts";
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
 * Five callback shapes:
 *   - `action:settings:toggle:<dottedKey>:<member>` — flip list membership.
 *   - `action:settings:set:<dottedKey>:<value>`     — set scalar / enum / bool.
 *   - `action:settings:edit:<dottedKey>`            — start the host page's
 *      input flow with `editingKey` stashed in `pageData`; on completion
 *      the flow's `onComplete` reads that key and applies the value.
 *   - `action:settings:ping:<dottedKey>:idx:<n>`    — health-check the model
 *      at index `n` of the live dynamic-models snapshot.
 *   - `action:settings:page:<dottedKey>:<n>`        — bump the host page's
 *      pagination cursor in `session.pageData[currentPage].page`.
 *
 * Plus a `noop:*` matcher used to silence the spinner on header /
 * indicator buttons that have no behavior of their own.
 *
 * Every handler owns its own session lifecycle (load + save) since
 * `bot.callbackQuery(...)` short-circuits the engine pipeline.
 */

const TOGGLE_RE = /^action:settings:toggle:([^:]+):(.+)$/;
const SET_RE = /^action:settings:set:([^:]+):(.+)$/;
const EDIT_RE = /^action:settings:edit:(.+)$/;
const PING_RE = /^action:settings:ping:([^:]+):idx:(\d+)$/;
const PAGE_RE = /^action:settings:page:([^:]+):(\d+)$/;

const SCALAR_FIELD = "value";

export function registerSettingsActions(bot: Bot, deps: ActionDeps): void {
  bot.callbackQuery(TOGGLE_RE, makeToggleHandler(deps));
  bot.callbackQuery(SET_RE, makeSetHandler(deps));
  bot.callbackQuery(EDIT_RE, makeEditHandler(deps));
  bot.callbackQuery(PING_RE, makePingHandler(deps));
  bot.callbackQuery(PAGE_RE, makePageHandler(deps));
  bot.callbackQuery(/^noop:/, async (gctx) => {
    try {
      await gctx.answerCallbackQuery();
    } catch {
      // Telegram rejects acks for queries already answered or expired.
    }
  });
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
        const resolved = await resolveIndexedAsync(key, idx);
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
        const resolved = await resolveIndexedAsync(key, idx);
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

// ── Router factory test seam ─────────────────────────────────────────

/**
 * Health-check uses a tiny indirection so unit tests can substitute a
 * stub router without forking the action handler.
 */
export interface PingRouter {
  ping(modelId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

type RouterFactory = (cfg: ArchitectConfig) => PingRouter;

const defaultRouterFactory: RouterFactory = (cfg) => new LLMRouter(cfg);

let routerFactory: RouterFactory = defaultRouterFactory;

/**
 * Test seam — substitute the {@link LLMRouter} factory used by the
 * health-check handler. Pass `null` to reset.
 */
export function __setRouterFactoryForTests(factory: RouterFactory | null): void {
  routerFactory = factory ?? defaultRouterFactory;
}

function makePingHandler(deps: ActionDeps): (gctx: GrammyContext) => Promise<void> {
  return async (gctx) => {
    const ctx = await loadCtx(gctx, deps);
    if (ctx === null) {
      await silenceSpinner(gctx);
      return;
    }
    try {
      const data = gctx.callbackQuery?.data ?? "";
      const m = PING_RE.exec(data);
      if (m === null) {
        throw new DopellerError("internal_db_unavailable", "internal", "bad_settings_action", {
          data,
        });
      }
      const idx = Number.parseInt(m[2] ?? "", 10);
      const all = await listAllDynamicModels();
      const target = all[idx];
      if (target === undefined) {
        await toast.danger(ctx, "Unknown model.");
        await deps.store.save(ctx.session);
        return;
      }
      try {
        await toast.info(ctx, `🩺 Pinging <code>${escapeHtml(target.slug)}</code>…`);
        const svc = makeSettingsService();
        const cfg = await svc.load();
        const router = routerFactory(cfg);
        const r = await router.ping(target.slug);
        if (r.ok) {
          await toast.info(
            ctx,
            `💚 <code>${escapeHtml(target.slug)}</code> healthy in ${r.latencyMs} ms`,
          );
        } else {
          await toast.danger(
            ctx,
            `💔 <code>${escapeHtml(target.slug)}</code> failed: ${escapeHtml(r.error ?? "unknown")}`,
          );
        }
      } catch (err) {
        await reportFailure(ctx, err);
      }
      await deps.store.save(ctx.session);
    } finally {
      await silenceSpinner(gctx);
    }
  };
}

function makePageHandler(deps: ActionDeps): (gctx: GrammyContext) => Promise<void> {
  return async (gctx) => {
    const ctx = await loadCtx(gctx, deps);
    if (ctx === null) {
      await silenceSpinner(gctx);
      return;
    }
    try {
      const data = gctx.callbackQuery?.data ?? "";
      const m = PAGE_RE.exec(data);
      if (m === null) {
        throw new DopellerError("internal_db_unavailable", "internal", "bad_settings_action", {
          data,
        });
      }
      const n = Number.parseInt(m[2] ?? "", 10);
      if (!Number.isFinite(n) || n < 0) {
        await toast.danger(ctx, "Bad page number.");
        await deps.store.save(ctx.session);
        return;
      }
      const pagePath = ctx.session.menu.currentPage;
      const bucket = ctx.session.pageData[pagePath] ?? {};
      bucket.page = n;
      ctx.session.pageData[pagePath] = bucket;
      try {
        await deps.renderer.rerender(ctx);
      } catch (err) {
        await reportFailure(ctx, err);
      }
      await deps.store.save(ctx.session);
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
 * MUST back the page's keyboard so `idx` round-trips. For `models.*`
 * keys the dynamic snapshot is authoritative — see
 * {@link dynamicCandidatesFor}.
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

/**
 * Async candidate resolver. For `models.*` keys returns the live
 * dynamic-models snapshot so toggle / set / ping callbacks resolve
 * against the same enumeration the page just rendered. Falls back to
 * {@link candidatesFor} for non-model keys.
 */
async function dynamicCandidatesFor(key: string): Promise<readonly string[]> {
  if (key.startsWith("models.")) {
    const all = await listAllDynamicModels();
    return all.map((m) => m.slug);
  }
  return candidatesFor(key);
}

async function resolveIndexedAsync(key: string, idx: number): Promise<string | null> {
  if (!Number.isFinite(idx)) return null;
  const candidates = await dynamicCandidatesFor(key);
  if (idx < 0 || idx >= candidates.length) return null;
  return candidates[idx] ?? null;
}

/** Exported for pages to use the same enumeration when building keyboards. */
export function settingsCandidates(key: string): readonly string[] {
  return candidatesFor(key);
}

/**
 * Async variant — for `models.*` keys returns the live dynamic-models
 * snapshot. Pages whose keyboard is paginated against the dynamic list
 * SHOULD use this so set/toggle/ping callbacks round-trip through the
 * same enumeration the keyboard just rendered.
 */
export async function settingsCandidatesAsync(key: string): Promise<readonly string[]> {
  return dynamicCandidatesFor(key);
}
