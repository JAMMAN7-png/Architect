# Coolify deployment

Architect's Telegram bot ships as a single Bun-based container. Coolify builds
it from the repo `Dockerfile`, terminates TLS at its bundled Caddy, and injects
runtime env vars from the project's secret store.

## Prerequisites

- A Coolify instance reachable from the public internet.
- A FQDN for the bot, e.g. `arch.example.com`, with DNS pointing at Coolify.
- A Telegram bot token from `@BotFather`.
- API keys for the LLM and search providers you actually use (the bot will
  no-op cleanly if a provider key is missing).
- A Coolify API token with `applications:write` scope.

## Environment

The image bakes in **no** secrets. Coolify must inject every runtime value.
Copy `.env.example` to your Coolify "Environment Variables" panel and fill in
real values. Required keys:

- `TELEGRAM_BOT_TOKEN` — bot token from BotFather.
- `BOT_PUBLIC_URL` — full https URL of your FQDN (e.g.
  `https://arch.example.com`). When set, the bot registers a Telegram webhook
  at `${BOT_PUBLIC_URL}/webhook` on boot — no manual `curl setWebhook` needed.
- `BOT_PORT` — internal listen port (default `3000`, matches `EXPOSE`).
- `BOT_WEBHOOK_SECRET` — optional shared secret; if set, the bot enforces it
  on the webhook handshake.
- `TELEGRAM_ADMIN_CHAT_ID` — chat id that receives operational notifications.

Optional: any of the provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY`, etc.) and the
`ARCHITECT_MODEL_*` / `ARCHITECT_SEARCH_PROVIDER` overrides — see
`.env.example` for the complete list.

## Persistent storage

The container writes project state and TeleFocus sessions to `/data`. Mount
two persistent volumes so a redeploy does not erase user work:

| Container path     | Purpose                          |
| ------------------ | -------------------------------- |
| `/data/projects`   | Per-project Architect state JSON |
| `/data/sessions`   | TeleFocus session JSON store     |

In Coolify's "Storages" tab, add both as named volumes scoped to the app.

## Deploy via API

The minimum Coolify API payload to register the app:

```bash
curl -X POST "$COOLIFY_URL/api/v1/applications/public" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "architect-bot",
    "git_repository": "https://github.com/JAMMAN7-png/Architect",
    "git_branch": "main",
    "build_pack": "dockerfile",
    "ports_exposes": "3000",
    "fqdn": "https://arch.example.com",
    "instant_deploy": true
  }'
```

Coolify provisions a Caddy route, requests a Let's Encrypt cert for the FQDN,
and starts a build. Push env vars before the first deploy:

```bash
curl -X POST "$COOLIFY_URL/api/v1/applications/$UUID/envs/bulk" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @env.json
```

The container's `HEALTHCHECK` hits `http://127.0.0.1:${BOT_PORT}/health`;
externally the same endpoint is reachable at `https://<fqdn>/health` and
returns `200 ok` once the bot is ready.

## Updating

Two options:

- **Manual**: `POST /api/v1/applications/{uuid}/restart` — pulls the latest
  image / rebuilds and rolls the container.
- **Webhook**: enable Coolify's git webhook on the application; pushes to
  `main` then trigger an automatic rebuild + redeploy.

Coolify performs a rolling restart: the new container must pass `/health`
before the old one is stopped.

## Switching to long-poll

Webhook mode is the default and recommended path. To fall back to long-poll
(e.g. while debugging Telegram delivery), unset `BOT_PUBLIC_URL` in the env
panel and restart. On boot the bot calls `deleteWebhook` and starts polling;
`/health` still answers on `BOT_PORT` so the Coolify health probe keeps
working.
