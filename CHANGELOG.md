# Changelog

## 0.1.0-pre.0 — 2026-05-06

Initial structure.

### Added
- CLI: `new`, `brainstorm`, `blueprint`, `review`, `service-map`, `generate`, `verify`, `config`, `doctor`
- 8-phase pipeline: Spark → Blueprint forge → QA attack review (5 perspectives) → Revise + freeze → Architecture docs → Per-service fanout → Cross-service consistency → Registry
- Pluggable LLM adapter with Anthropic, OpenAI, DeepSeek, xAI, OpenRouter providers
- Auto-fallback to OpenRouter when a tier-mapped provider has no key
- Pluggable search adapter shaped after parallel.ai's API; Firecrawl is the v1 backend
- 85%-noise research filter capped at 500 tokens per finding
- Brainstorm mode that fetches `obra/superpowers/skills/brainstorming/SKILL.md` at runtime (24h cache)
- Strict per-service docs whitelist (8 files) enforced by `architect verify`
- Deterministic doc registry written by Phase 7
- TOML config at `~/.config/architect/config.toml` with env + CLI overrides

### Tests
- 30 unit + e2e tests, all green
- Mock LLM provider with rule-based responses for deterministic CI
- E2E test produces a verify()-clean tree against a 2-service fixture
