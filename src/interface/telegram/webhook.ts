/**
 * Telegram bot host: webhook (Bun.serve) or long-polling.
 *
 * Webhook mode (when `publicUrl` is set):
 *   - `Bun.serve` mounts a `webhookCallback(bot, "std/http")` adapter at
 *     `POST /webhook`.
 *   - `bot.api.setWebhook` is called before the server starts so Telegram
 *     knows where to deliver updates.
 *
 * Polling mode (when `publicUrl` is undefined):
 *   - `bot.api.deleteWebhook` clears any prior webhook, then `bot.start`
 *     runs in the background.
 *   - `Bun.serve` still binds so `/health` is reachable for orchestrator
 *     health checks (Coolify, k8s, Docker).
 *
 * Both modes expose `GET /health → 200 "ok"`. Lifecycle is wired to
 * SIGINT/SIGTERM and the returned `stop()` is idempotent.
 */

import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import { logger } from "../../util/logger.ts";

export interface ServeBotOptions {
  bot: Bot;
  /** Public URL the bot is reachable at, e.g. https://arch.v244.net. When set → webhook mode. */
  publicUrl?: string;
  /** Port to bind. Default 3000. */
  port?: number;
  /** Secret token for the webhook handshake. Optional. */
  secret?: string;
}

export interface ServeBotHandle {
  stop(): Promise<void>;
}

const HEALTH_BODY = "ok";

export async function serveBot(opts: ServeBotOptions): Promise<ServeBotHandle> {
  const { bot, publicUrl, secret } = opts;
  const port = opts.port ?? 3000;
  const log = logger.child({ component: "telegram-host" });

  let stopped = false;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let pollingTask: Promise<void> | undefined;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await bot.stop();
    } catch (err) {
      log.warn({ err }, "bot.stop threw");
    }
    if (server) {
      try {
        await server.stop(true);
      } catch (err) {
        log.warn({ err }, "server.stop threw");
      }
    }
    if (pollingTask) {
      try {
        await pollingTask;
      } catch (err) {
        log.warn({ err }, "polling task threw");
      }
    }
  };

  const onSignal = (sig: NodeJS.Signals): void => {
    log.info({ sig }, "received signal, stopping");
    void stop();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  if (publicUrl !== undefined && publicUrl !== "") {
    const handle = webhookCallback(bot, "std/http", {
      ...(secret ? { secretToken: secret } : {}),
    });

    const url = `${publicUrl.replace(/\/+$/, "")}/webhook`;
    await bot.api.setWebhook(url, {
      ...(secret ? { secret_token: secret } : {}),
      drop_pending_updates: true,
    });
    log.info({ url }, "webhook registered");

    server = Bun.serve({
      port,
      idleTimeout: 60,
      fetch: async (req: Request): Promise<Response> => {
        const path = new URL(req.url).pathname;
        if (path === "/health") return new Response(HEALTH_BODY, { status: 200 });
        if (path === "/webhook") return handle(req);
        return new Response("not found", { status: 404 });
      },
    });
    log.info({ port, mode: "webhook" }, "telegram host listening");
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    server = Bun.serve({
      port,
      idleTimeout: 60,
      fetch: (req: Request): Response => {
        const path = new URL(req.url).pathname;
        if (path === "/health") return new Response(HEALTH_BODY, { status: 200 });
        return new Response("not found", { status: 404 });
      },
    });

    pollingTask = bot.start({ drop_pending_updates: true }).catch((err: unknown) => {
      log.error({ err }, "bot.start failed");
    });
    log.info({ port, mode: "polling" }, "telegram host listening");
  }

  return { stop };
}
