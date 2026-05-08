# syntax=docker/dockerfile:1.7

FROM oven/bun:1.1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY tsconfig.json biome.json ./
COPY src ./src
COPY bin ./bin
# Typecheck so we fail fast at build time, not runtime.
RUN bunx tsc --noEmit

FROM oven/bun:1.1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    BOT_PORT=3000
RUN addgroup -S architect && adduser -S architect -G architect \
    && mkdir -p /data/projects /data/sessions \
    && chown -R architect:architect /data
COPY --from=builder --chown=architect:architect /app/node_modules ./node_modules
COPY --from=builder --chown=architect:architect /app/package.json ./package.json
COPY --from=builder --chown=architect:architect /app/src ./src
COPY --from=builder --chown=architect:architect /app/bin ./bin
COPY --from=builder --chown=architect:architect /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=architect:architect /app/bunfig.toml ./bunfig.toml
USER architect
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${BOT_PORT}/health" || exit 1
CMD ["bun", "run", "src/cli/index.ts", "bot", "--projects-root", "/data/projects", "--session-store", "/data/sessions"]
