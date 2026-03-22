# Repository Guidelines

## Project Structure & Module Organization
Shader Forge is split between engine architecture docs and implementation scaffolding. `shell/engine-shell/` contains the browser-based developer shell. `docs/specs/` is the source of truth for subsystem design. `docs/guides/` holds operational runbooks such as harness testing. `plans/` holds phased execution plans. `scripts/` contains local dev servers and verification harnesses. Future runtime, tooling, and sample-game code should land under dedicated top-level folders such as `engine/`, `tools/`, and `games/`.

## Build, Test, and Development Commands
- `npm run shell:serve`: serve the current shell scaffold from `shell/engine-shell/web/`.
- `npm test`: run the deterministic shell smoke harness.
- `npm run test:shell-smoke`: explicit alias for the shell smoke harness.
- `npm run test:ollama-smoke`: probe a local Ollama endpoint and run a minimal chat-completion smoke test.

## Coding Style & Naming Conventions
Prefer small, explicit modules and straightforward edits. Avoid broad rewrites unless they materially simplify the architecture. Default to ASCII. Use stable descriptive names such as `engine-session-record`, `test-engine-shell-smoke`, or `runtime-control-panel`. For docs, keep language concrete and implementation-oriented.

## Testing Guidelines
Run the relevant harnesses whenever you change a subsystem. For shell changes, run `npm test`. For AI-surface work, run `npm run test:ollama-smoke` when a reachable Ollama instance exists. Prefer self-contained Node `.mjs` harnesses that start what they need, assert behavior programmatically, and shut down cleanly. Follow [ENGINE-HARNESS-TESTING.md](/mnt/s/Development/AI-Game-Engine/docs/guides/ENGINE-HARNESS-TESTING.md) for the deterministic lane and the optional real local-model lane.

## Documentation Requirements
When you change a major subsystem, update the matching spec in `docs/specs/` in the same pass. Start from [ENGINE-SYSTEMS-INDEX.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SYSTEMS-INDEX.md). The inline file-search control beside `Inspect` in [code.js](/mnt/s/Development/AI-Game-Engine/shell/engine-shell/web/js/pages/code.js) and [style.css](/mnt/s/Development/AI-Game-Engine/shell/engine-shell/web/css/style.css) is currently a required preserved behavior.

## Commit & Review Guidelines
Keep commits scoped and explain what you verified. Call out changes that affect shell UX, runtime control, AI integration, or harness infrastructure. Prefer incremental follow-up patches over broad refactors that obscure what changed.

