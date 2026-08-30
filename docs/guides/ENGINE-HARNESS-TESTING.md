# Engine Harness Testing

Date: 2026-08-31

## Purpose

The engine should use self-contained black-box harnesses for the shell, backend surfaces, and future AI/runtime integration points.

Rules:

- deterministic harness lanes are the default regression baseline
- optional real local-model lanes are used for smoke validation, not as the only test path
- harnesses should start what they need, assert real behavior, and clean up after themselves

## Current Harnesses

| Script | Purpose | Lane |
| --- | --- | --- |
| `scripts/test-engine-shell-smoke.mjs` | Serves `shell/engine-shell/web`, validates the shell assets load, and verifies the preserved inline file search plus current shell scene-authoring controls remain present in source | deterministic |
| `scripts/test-engine-sessiond.mjs` | Starts the local backend in-process, creates a project session, and validates safe file list/read behavior over HTTP | deterministic |
| `scripts/test-engine-mcp.mjs` | Starts sessiond plus the real stdio `sf-mcp`, validates resources/read tools, coordinator lifecycle, queued/owned leases, lease-gated spatial preview/review/apply/undo, selected-session boundaries, structured conflicts, generic-mutation refusal, and cleanup | deterministic |
| `scripts/test-engine-viewer-bridge.mjs` | Starts the local backend in-process, validates viewer-bridge SSE/runtime/build flows, and checks the shell bridge surfaces remain present | deterministic |
| `scripts/test-engine-scene-authoring.mjs` | Starts the local backend in-process, validates the shell scene-authoring surface stays present, and checks deterministic scene, prefab, placed-entity, transform, and prefab-component file writes inside a session root | deterministic |
| `scripts/test-engine-scene-runtime-scaffold.mjs` | Validates the first Phase 6 scene-runtime composition slice, controlled-entity runtime hooks, and fallback syntax-only compilation of the widened native runtime sources | deterministic |
| `scripts/test-engine-runtime-scaffold.mjs` | Validates the native runtime scaffold, runtime CLI hooks, and fallback syntax-only compilation of the current native sources | deterministic |
| `scripts/test-engine-data-foundation-scaffold.mjs` | Validates the data foundation manifest, text-backed content roots, runtime integration, and fallback syntax-only compilation of the native data foundation slice | deterministic |
| `scripts/test-engine-asset-pipeline.mjs` | Runs `engine bake`, validates staged cooked outputs plus generated-mesh preview payloads, and checks the first procedural-geometry, scene-entity, and prefab-component staging lane | deterministic |
| `scripts/test-engine-migration-fixtures.mjs` | Runs the migration foundation CLI against Unity, Unreal, and Godot fixtures and validates normalized manifest/report outputs | deterministic |
| `scripts/test-engine-audio-scaffold.mjs` | Validates authored audio buses/sounds/events, runtime audio integration hooks, and fallback syntax-only compilation of the native audio slice | deterministic |
| `scripts/test-engine-animation-scaffold.mjs` | Validates authored animation skeletons/clips/graphs, runtime animation integration hooks, and fallback syntax-only compilation of the native animation slice | deterministic |
| `scripts/test-engine-spatial-authoring-scaffold.mjs` | Builds an isolated animation root, compiles the native parser, and validates v1/v2 skeleton, socket, attachment-profile, cross-reference, transactional reload, typed-handle, schema-v1 clip compatibility, and deterministic schema-v2 pose-sampling behavior; WSL `g++` is required on Windows | deterministic native |
| `scripts/test-engine-spatial-tool.mjs` | Requires a native compiler, compiles the production `shader_forge_spatial` command, and checks deterministic validation, UTF-8 input enforcement, byte-stable complete cooking, deterministic rest-pose attachment geometry, non-commuting transform composition, canonical quaternion sign, unresolved pole space, non-finite failure, and CLI help/strict/build-first behavior; WSL `g++` is required on Windows and `g++` elsewhere | deterministic native |
| `scripts/test-engine-spatial-operations.mjs` | Starts sessiond with injected deterministic validator/evaluator seams and verifies the revision-safe no-lease GET, safe exact-byte staging, expected-ID/schema binding, final revision drift, journal absence, bounded evaluator failures, transient baseline/candidate preview evaluations including new files, post-evaluation lease recheck, durable operation context, exact/rename lease coverage, apply/undo revision safety, CORS, and temp cleanup | deterministic |
| `scripts/test-engine-spatial-cli.mjs` | Starts sessiond with injected deterministic validator/evaluator seams and drives the real CLI through preview/review/apply/undo, strict arguments, fatal UTF-8 input, server diagnostics, and credential redaction | deterministic |
| `scripts/test-engine-spatial-shell.mjs` | Executes the pure primary-grip transformer, rest-evaluation validator/projection guards, and operation-reconciliation helpers; verifies exact-byte preservation, unsupported-layout lease-free evaluation, bounded deep-schema failure, exact authored/candidate evidence binding, fixed cached geometry, one App SSE subscription with authoritative operation refetch, conflict refresh/lease-coverage decisions, captured-connection-only cleanup, unresolved-pole exclusion, accessible/responsive Assets mounting, operation-only routing, explicit locking, and credential redaction | deterministic |
| `scripts/test-engine-activity-shell.mjs` | Verifies the global Activity history/summary-review dock, actual public operation shapes, one SSE subscription, authoritative refresh, review-only actions, and accessible responsive dock behavior | deterministic |
| `scripts/test-engine-physics-scaffold.mjs` | Validates authored physics layers/materials/bodies, runtime physics integration hooks, and fallback syntax-only compilation of the native physics slice | deterministic |
| `scripts/test-engine-input-scaffold.mjs` | Validates the native input subsystem sources plus text-backed action/context assets and runs a fallback syntax-only compile | deterministic |
| `scripts/test-engine-tooling-ui-scaffold.mjs` | Validates the native tooling registry/layout substrate, runtime integration hooks, and runs a fallback syntax-only compile | deterministic |
| `scripts/test-ollama-smoke.mjs` | Resolves a reachable Ollama endpoint, optionally autostarts local WSL Ollama, and performs a minimal OpenAI-compatible chat completion smoke test | real local-model |

## Current Commands

```bash
npm test
node scripts/test-engine-shell-smoke.mjs
node scripts/test-engine-sessiond.mjs
npm run test:mcp
node scripts/test-engine-mcp.mjs
node scripts/test-engine-viewer-bridge.mjs
npm run test:scene-authoring
node scripts/test-engine-scene-authoring.mjs
npm run test:scene-runtime-scaffold
node scripts/test-engine-scene-runtime-scaffold.mjs
node scripts/test-engine-runtime-scaffold.mjs
node scripts/test-engine-data-foundation-scaffold.mjs
npm run test:asset-pipeline
node scripts/test-engine-asset-pipeline.mjs
npm run test:migration-fixtures
node scripts/test-engine-migration-fixtures.mjs
npm run test:audio-scaffold
node scripts/test-engine-audio-scaffold.mjs
npm run test:animation-scaffold
node scripts/test-engine-animation-scaffold.mjs
npm run test:spatial-authoring-scaffold
node scripts/test-engine-spatial-authoring-scaffold.mjs
npm run test:spatial-tool
node scripts/test-engine-spatial-tool.mjs
npm run test:spatial-operations
node scripts/test-engine-spatial-operations.mjs
npm run test:spatial-cli
node scripts/test-engine-spatial-cli.mjs
npm run test:spatial-shell
node scripts/test-engine-spatial-shell.mjs
npm run test:activity-shell
node scripts/test-engine-activity-shell.mjs
npm run test:physics-scaffold
node scripts/test-engine-physics-scaffold.mjs
node scripts/test-engine-input-scaffold.mjs
node scripts/test-engine-tooling-ui-scaffold.mjs
HARNESS_OLLAMA_MODEL=<your-model> node scripts/test-ollama-smoke.mjs
node scripts/test-ollama-smoke.mjs --list-candidates
node scripts/serve-engine-shell.mjs
```

Windows clean-start path:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1
```

Unix/WSL clean-start path:

```bash
./scripts/start-dev-clean.sh
```

These scripts are the preferred dev entrypoints while the stack is still shell-first. They remove generated outputs, rerun the deterministic shell, sessiond, viewer-bridge, scene-authoring, scene-runtime-scaffold, runtime-scaffold, data-foundation-scaffold, asset-pipeline, migration-fixtures, audio-scaffold, animation-scaffold, physics-scaffold, input-scaffold, and tooling-ui-scaffold harnesses, start `engine_sessiond`, and then start the shell dev server.

## WSL And Windows-Hosted Ollama

The primary development workflow is Windows + WSL2, so the harness rules assume that local model hosting may be split across environments.

- `127.0.0.1:11434` inside WSL may not reach an Ollama instance bound on Windows
- if `HARNESS_OLLAMA_BASE_URL` is not set, the harness probes loopback plus the WSL host IP path from `/etc/resolv.conf`
- if a loopback endpoint is selected and `ollama` is installed in WSL, the harness can autostart `ollama serve`
- disable autostart with `HARNESS_AUTOSTART_LOCAL_OLLAMA=0`

## Future Harnesses

These should be added as implementation reaches the relevant phase:

- `scripts/test-engine-cli.mjs`
- `scripts/test-engine-runtime-smoke.mjs`
- `scripts/test-engine-shell-ui.mjs`
- `scripts/test-engine-ai-service.mjs`
- `scripts/test-engine-ai-bridge.mjs`
