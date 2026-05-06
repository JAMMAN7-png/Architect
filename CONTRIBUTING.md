# Contributing

## Setup

```bash
git clone https://github.com/JAMMAN7-png/Architect ~/architect
cd ~/architect
bun install
bun run typecheck
bun test
```

## Verification

Before pushing, run:

```bash
bun run typecheck
bunx biome check .
bun test
```

CI runs the same on Linux, macOS, and Windows.

## Pillars (do not violate)

1. **The Blueprint is the only authoritative artifact.** Nothing exists in `docs/` unless the Blueprint mandated it.
2. **Per-service docs live inside each service folder.** Root `docs/` is for cross-cutting artifacts only.
3. **The 85% research filter is a hard cap, not a vibe.** Token budgets are enforced client-side after the LLM call.
4. **No model id is hard-coded.** Tiers map to ids via config; ids may not exist on every account.
5. **Secrets stay in env.** `~/.config/architect/config.toml` never contains an API key.

## Commit messages

Conventional Commits. Examples:

- `feat(cli): add config show subcommand`
- `fix(llm): retry on 429 with exponential backoff`
- `docs(readme): clarify search adapter contract`
- `test(verify): cover empty service dirs`

## Adding a new LLM provider

1. Add a new file under `src/llm/providers/` extending `OpenAICompatibleProvider` (or `AnthropicProvider` for Anthropic-shaped APIs).
2. Register it in `src/llm/router.ts` with a stable provider key.
3. Add a row to `MODEL_REGISTRY` in `src/llm/models.ts` for known model ids and rough costs.
4. Add a unit test that exercises the provider via the mock layer if its wire shape differs.

## Adding a new doc kind

1. Add the file name to the relevant whitelist in `src/core/registry.ts` (`ROOT_DOCS_WHITELIST` or `SERVICE_DOCS_WHITELIST`).
2. Add a generator under `src/agents/` or `src/agents/per-service.ts`.
3. Wire the new generator into `src/core/pipeline.ts` at the appropriate phase.
4. Add a test that asserts the new file is produced and registered.
