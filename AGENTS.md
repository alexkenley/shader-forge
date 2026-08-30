# Repository Guidelines

## Project Structure & Module Organization
Shader Forge is split between engine architecture docs and implementation scaffolding. `shell/engine-shell/` contains the browser-based developer shell. The new shell framework lives in `shell/engine-shell/src/`, while the preserved editor compatibility baseline remains under `shell/engine-shell/web/`. `tools/engine-sessiond/` contains the local backend service, and `tools/engine-cli/` contains the `engine` command entrypoint. `docs/specs/` is the source of truth for subsystem design. `docs/guides/` holds operational runbooks such as harness testing. `plans/` holds phased execution plans. `scripts/` contains local dev servers and verification harnesses. Future runtime and sample-game code should land under dedicated top-level folders such as `engine/` and `games/`.

## Build, Test, and Development Commands
- `npm run shell:serve`: serve the current shell scaffold from `shell/engine-shell/web/`.
- `npm run sessiond:start`: start the dependency-free local `engine_sessiond` service on `127.0.0.1:41741`.
- `npm run mcp:serve -- --root <path>`: start the process-scoped Shader Forge MCP (`sf-mcp`) stdio adapter for a workspace.
- `npm run engine -- --help`: inspect the current `engine` CLI surface.
- `npm run shell:dev`: run the React/Vite shell package once dependencies are installed in `shell/engine-shell/`.
- `npm run shell:build`: build the React/Vite shell package once dependencies are installed.
- `npm run shell:typecheck`: type check the React/Vite shell package once dependencies are installed.
- `npm test`: run the deterministic shell smoke harness.
- `npm run test:shell-smoke`: explicit alias for the shell smoke harness.
- `npm run test:sessiond`: run the deterministic backend session/file harness.
- `npm run test:mcp`: run the deterministic real-stdio MCP harness, including coordination and lease-gated spatial mutation.
- `npm run test:spatial-authoring-scaffold`: compile and execute the native spatial skeleton/socket, compatible v1/strict v2 attachment-profile, clip-sampling, and two-bone IK harness; WSL `g++` is required on Windows.
- `npm run test:spatial-tool`: compile and execute native spatial validation/cooking/rest/sample evaluation, including exact DataFoundation-backed authored visual-box evidence, missing/ambiguous/non-box paths, rotated composition, v1 compatibility, and v2 IK truth; WSL `g++` is required on Windows and `g++` elsewhere.
- `npm run test:spatial-operations`: validate sessiond rest/sample evidence, exact visual-box protocol handling, animation/content/foundation revision staging and drift rejection, symbolic-source rejection, profile binding, preview, leases, durable context, apply, undo, and temporary staging.
- `npm run test:spatial-cli`: validate the strict sessiond-backed spatial attachment CLI preview, review, apply, undo, UTF-8, and credential-redaction contract.
- `npm run test:spatial-shell`: validate the Assets-only tuner, exact source rewrite, v1/v2 rest/sampled schematics, authored visual-box recomposition/drawing guards, source-revision binding, explicit locks, and operation-only routing.
- `npm run test:activity-shell`: validate the global operation history and summary-review dock, public operation boundary, SSE refresh, review-only actions, and keyboard-resizable dock.
- `npm run test:ollama-smoke`: probe a local Ollama endpoint and run a minimal chat-completion smoke test. If Ollama is not already reachable on a local loopback candidate, prefer starting it with `ollama serve` and rerunning the harness instead of treating the real local-model lane as unavailable.
- `./scripts/start-dev-clean.sh`: Unix/WSL clean-start path that removes generated outputs, runs the shell and sessiond harnesses, starts `engine_sessiond`, and then launches the shell dev server.
- `powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1`: Windows clean-start path that removes generated outputs, runs the shell and sessiond harnesses, starts `engine_sessiond`, and then starts the WSL-backed dev shell.

## Coding Style & Naming Conventions
Prefer small, explicit modules and straightforward edits. Avoid broad rewrites unless they materially simplify the architecture. Default to ASCII. Use stable descriptive names such as `engine-session-record`, `test-engine-shell-smoke`, or `runtime-control-panel`. For docs, keep language concrete and implementation-oriented.

## Testing Guidelines
Run the relevant harnesses whenever you change a subsystem. For shell changes, run `npm test`. For backend session/file changes, run `npm run test:sessiond`. For MCP adapter changes, run `npm run test:mcp`. For spatial skeleton/socket or attachment-profile changes, run `npm run test:spatial-authoring-scaffold`. For the native spatial command, run `npm run test:spatial-tool`. For spatial attachment operation changes, run `npm run test:spatial-operations`. For its CLI adapter, run `npm run test:spatial-cli`. For its constrained Assets tuner, run `npm run test:spatial-shell`. For the Activity/Changes operation consumer, run `npm run test:activity-shell`. For AI-surface work, run `npm run test:ollama-smoke`; if Ollama is not already reachable, prefer starting it with `ollama serve` and rerunning instead of falling back immediately to the deterministic fake-provider lane. Prefer self-contained Node `.mjs` harnesses that start what they need, assert behavior programmatically, and shut down cleanly. Follow [ENGINE-HARNESS-TESTING.md](/mnt/s/Development/AI-Game-Engine/docs/guides/ENGINE-HARNESS-TESTING.md) for the deterministic lane and the optional real local-model lane.

## Documentation Requirements
When you change a major subsystem, update the matching spec in `docs/specs/` in the same pass. Start from [ENGINE-SYSTEMS-INDEX.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SYSTEMS-INDEX.md). Keep [ENGINE-REFERENCE-GUIDE.md](/mnt/s/Development/AI-Game-Engine/docs/reference/ENGINE-REFERENCE-GUIDE.md), [ENGINE-REFERENCE-GUIDE.json](/mnt/s/Development/AI-Game-Engine/docs/reference/ENGINE-REFERENCE-GUIDE.json), and [reference-guide.ts](/mnt/s/Development/AI-Game-Engine/shell/engine-shell/src/reference-guide.ts) in sync with any user-facing workflow, shell navigation, runtime control, or assistant-facing engine behavior change so the guide remains searchable for terminal, in-app, and future native assistants. The inline file-search control beside `Inspect` in [code.js](/mnt/s/Development/AI-Game-Engine/shell/engine-shell/web/js/pages/code.js) and [style.css](/mnt/s/Development/AI-Game-Engine/shell/engine-shell/web/css/style.css) is currently a required preserved behavior.

## Commit & Review Guidelines
Keep commits scoped and explain what you verified. Call out changes that affect shell UX, runtime control, AI integration, or harness infrastructure. Prefer incremental follow-up patches over broad refactors that obscure what changed.
