/**
 * grammY launcher for the TeleFocus engine.
 *
 * `startTelefocusBot` constructs a `Bot`, installs the `/start` shortcut
 * (which feeds the deep-link payload through `resolveStart` + `navigateTo`),
 * and registers a single catch-all middleware that adapts every other
 * update into a `Ctx` and runs the engine pipeline.
 *
 * The caller owns lifecycle: this function does NOT call `bot.start()`.
 * That keeps tests deterministic and lets the CLI choose between
 * long-poll and webhook deployment modes.
 */

import { Bot, type Context as GrammyContext } from "grammy";

import { TeleFocus } from "./engine/bootstrap.ts";
import type { InputFlowEngine } from "./engine/flow/engine.ts";
import type { PageRegistry } from "./engine/registry.ts";
import type { MenuRenderer } from "./engine/renderer/menu-renderer.ts";
import { resolveStart } from "./engine/router/deep-link.ts";
import { navigateTo } from "./engine/router/navigate.ts";
import type { SessionStore } from "./engine/session/store.ts";
import type { Ctx, PageDefinition, ServicesShape } from "./engine/types.ts";
import { adaptUpdate } from "./grammy-adapter.ts";

/**
 * Engine-side dependencies handed to {@link StartOptions.actions}. The
 * caller closes over their own runner / services to register
 * `bot.callbackQuery(...)` handlers before the catch-all pipeline.
 */
export interface ActionsHookDeps {
  registry: PageRegistry;
  renderer: MenuRenderer;
  flow: InputFlowEngine;
  store: SessionStore;
  services: ServicesShape;
}

export interface StartOptions {
  token: string;
  store: SessionStore;
  pages: PageDefinition[];
  services: ServicesShape;
  /**
   * Optional consumer hook to register `bot.callbackQuery(...)` /
   * `bot.command(...)` handlers BEFORE the catch-all `bot.use(...)`. The
   * handlers run as native grammY filters; they own their session
   * lifecycle (load + save) and never fall through to the engine
   * pipeline.
   */
  actions?: (bot: Bot, deps: ActionsHookDeps) => void;
}

/**
 * Wire a TeleFocus-backed grammY bot. Returns the constructed `Bot` so
 * the caller can attach further handlers and ultimately invoke
 * `bot.start()` (long-poll) or `webhookCallback(...)` (webhook).
 */
export async function startTelefocusBot(opts: StartOptions): Promise<Bot> {
  const bot = new Bot(opts.token);
  const tf = TeleFocus.attach({
    store: opts.store,
    pages: opts.pages,
    services: opts.services,
  });

  // Back-fill canonical nav handle so pages/action handlers can read
  // `ctx.services.nav` without each caller having to thread the registry
  // and renderer through bootstrap.
  (opts.services as { nav?: unknown }).nav = {
    registry: tf.registry,
    renderer: tf.renderer,
    store: opts.store,
  };

  // /start <payload> — bypass the pipeline, load the persisted session
  // directly, and route to the deep-link target. Registering before
  // `bot.use(...)` lets grammY's command matcher run first; the handler
  // does NOT call `next`, so the catch-all middleware is skipped for
  // /start updates.
  bot.command("start", async (grammyCtx: GrammyContext) => {
    const ctx = await adaptUpdate(grammyCtx, opts.services);
    if (!ctx) return;

    const session = await opts.store.load(ctx.userId, ctx.chatId);
    ctx.session = session;

    const payload = grammyCtx.match;
    const payloadStr = typeof payload === "string" && payload.length > 0 ? payload : undefined;
    const target = resolveStart(payloadStr, session);

    await navigateTo(ctx, target, {
      registry: tf.registry,
      renderer: tf.renderer,
      store: opts.store,
    });
  });

  if (opts.actions !== undefined) {
    opts.actions(bot, {
      registry: tf.registry,
      renderer: tf.renderer,
      flow: tf.flow,
      store: opts.store,
      services: opts.services,
    });
  }

  bot.use(async (grammyCtx: GrammyContext) => {
    const ctx: Ctx | null = await adaptUpdate(grammyCtx, opts.services);
    if (!ctx) return;
    await tf.handle(ctx);
  });

  return bot;
}
