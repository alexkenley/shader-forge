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
| `scripts/test-engine-shell-smoke.mjs` | Serves `shell/engine-shell/web`, validates the shell assets load, and verifies the preserved inline file search, current scene-authoring controls, terminal tab semantics, and World mode states remain present in source | deterministic |
| `scripts/test-engine-sessiond.mjs` | Starts the local backend in-process and validates session/file APIs including public route-level 4,096-entry/1-MiB caps plus pre-materialization bounded list/read rejection, revision-safe operations, bounded selected-operation exact diffs and summary-only degradation, recovery, mutation serialization, code-trust effects, CORS, and coordination leases | deterministic |
| `scripts/test-engine-ai-scaffold.mjs` | Starts sessiond plus a loopback provider stub and validates provider inspection, deterministic fake and Ollama-compatible requests, authenticated OpenRouter/Kimi requests, endpoint pinning, credential exclusion, fail-closed provider names/types/output limits, request token ceilings, normalized usage, and the 1 MiB response bound through backend and CLI surfaces | deterministic |
| `scripts/test-engine-mcp.mjs` | Starts sessiond plus the real stdio `sf-mcp`, validates lease-free session-pinned typed spatial rest/sample reads, coordinator lifecycle, queued/owned leases, lease-gated spatial preview/validation/apply/undo, explicit review reservation/recapture, immutable packet tool/resource reads, selected-session boundaries, stale/path/sample/authority-injection rejection, structured conflicts, generic-mutation refusal, and cleanup | deterministic |
| `scripts/test-engine-viewer-bridge.mjs` | Starts the local backend in-process, validates viewer-bridge SSE/runtime/build flows, checks stale lifecycle, World-selection, session-list, directory-picker, session-panel, and workspace-action guards, and verifies the shell bridge surfaces remain present | deterministic |
| `scripts/test-engine-scene-authoring.mjs` | Starts the local backend in-process, validates the shell scene-authoring surface and its request-generation/workspace/path stale-response guards, and checks deterministic scene, prefab, placed-entity, transform, and prefab-component file writes inside a session root | deterministic |
| `scripts/test-engine-scene-runtime-scaffold.mjs` | Validates the first Phase 6 scene-runtime composition slice, controlled-entity runtime hooks, and fallback syntax-only compilation of the widened native runtime sources | deterministic |
| `scripts/test-engine-runtime-scaffold.mjs` | Validates the native runtime scaffold, runtime CLI hooks, and fallback syntax-only compilation of the current native sources | deterministic |
| `scripts/test-engine-data-foundation-scaffold.mjs` | Validates the data foundation manifest, text-backed content roots, runtime integration, and fallback syntax-only compilation; its native probe proves exact optional prefab box-collision snapshots plus malformed, duplicate, unknown, missing, wrong-kind, non-finite, quaternion, and dimension rejection | deterministic native when `g++` or WSL `g++` is available |
| `scripts/test-engine-data-tool.mjs` | Compiles and executes `shader_forge_data validate-asset`, proving scene/prefab request binding, selected-path checks, absence validation, invalid relationship rejection, and strict arguments | deterministic native; requires `g++` or WSL `g++` |
| `scripts/test-engine-scene-operations.mjs` | Verifies lease- and revision-bound semantic scene save/create/duplicate preview, HTTP routing, native-validator protocol seams, durable operation context, mutation-lane apply/undo revalidation, retryable failure, rename refusal, and credential exclusion | deterministic |
| `scripts/test-engine-asset-pipeline.mjs` | Runs `engine bake`, validates staged cooked outputs plus generated-mesh preview payloads, and checks the first procedural-geometry, scene-entity, and prefab-component staging lane | deterministic |
| `scripts/test-engine-migration-fixtures.mjs` | Runs the production migration CLI against Unity, Unreal, and Godot fixtures; validates exact startup-scene binding from Unity's first enabled `EditorBuildSettings` scene, Unreal `GameDefaultMap`, and Godot `res://` `run/main_scene`; checks setting and mapped entity/component/script-binding counts, deterministic duplicate basenames, Unity text-YAML hierarchy/transforms/source IDs/Camera optics/BoxCollider geometry/MonoBehaviour `.cs.meta` bindings, normalized Godot node-name disambiguation, Godot node hierarchy/transforms/type provenance, explicit-unresolved fail-closed behavior with no bootstrap, no-declaration approximation, truthful `Manual` asset conversion, and production asset-pipeline baking of emitted scene/prefab/optional-bootstrap records | deterministic |
| `scripts/test-engine-audio-scaffold.mjs` | Validates authored audio buses/sounds/events, runtime audio integration hooks, and fallback syntax-only compilation of the native audio slice | deterministic |
| `scripts/test-engine-animation-scaffold.mjs` | Validates authored animation skeletons/clips/graphs, runtime animation integration hooks, and fallback syntax-only compilation of the native animation slice | deterministic |
| `scripts/test-engine-spatial-authoring-scaffold.mjs` | Builds an isolated animation root, compiles the native parser/evaluator, and validates v1/v2 skeleton, socket, strict optional cone-twist/capsule metadata, compatible v1/strict v2 attachment-profile, item-space pole, chain/palm capability, cross-reference, transactional reload, typed-handle, schema-v1 clip compatibility, deterministic schema-v2 pose sampling, exact envelope sampling, two-bone IK, procedural-layer truth, malformed metadata rejection, reserved-looking dotted bone keys, and CRLF fixture copies; WSL `g++` is required on Windows | deterministic native |
| `scripts/test-engine-spatial-tool.mjs` | Requires a native compiler, compiles the production `shader_forge_spatial` command, and checks deterministic validation/cooking including exact joint-limit/capsule object-or-null fields, rest and sampled geometry, independent DataFoundation visual/collision boxes, exact capsule-axis-to-oriented-box face/edge/corner/rotated clearance, tangency as CLEAR, positive overlap depth, typed unavailable reasons, non-finite geometry handling, rotated composition, v1 pre-IK compatibility, reachable/unreachable v2 IK, and strict native/CLI surfaces; WSL `g++` is required on Windows and `g++` elsewhere | deterministic native |
| `scripts/test-engine-spatial-operations.mjs` | Starts sessiond with injected deterministic validator/evaluator seams and verifies revision-safe rest/sample GETs, validator/profile/sample binding, exact visual-box, diagnose-only joint-limit, and clipping protocol validation with independent corner/endpoint/metric/aggregate recomputation, sign/exact-zero/negative-zero enforcement, complete animation/content/foundation revision manifests, content/foundation drift and deletion-race conflicts, symbolic-source rejection, safe staging, journal absence, preview/lease rechecks, apply/undo safety, CORS, and temp cleanup | deterministic |
| `scripts/test-engine-spatial-cli.mjs` | Starts sessiond with injected deterministic validator/evaluator seams and drives the real CLI through preview/review/apply/undo, strict arguments, fatal UTF-8 input, server diagnostics, and credential redaction | deterministic |
| `scripts/test-engine-spatial-shell.mjs` | Executes the primary-grip transformer, motion-envelope parser, source-manifest guard, rest/sampled validator, projection guards, and immutable review-packet parser; verifies independent visual/collision box recomposition, fail-closed joint-limit and clipping truth, distinct PASS/FAIL versus CLEAR/OVERLAP presentation, packet path/camera/sample rejection, review recapture/load presentation wiring, authored-only samples, v1/v2 IK truth, evidence binding, stale guards, accessible Assets mounting, operation-only routing, explicit locking, and credential-free evaluation GETs | deterministic |
| `scripts/test-engine-activity-shell.mjs` | Verifies the global Activity history/review dock, selected-operation structured diff request and revision binding, truthful summary-only/truncation states, one SSE subscription, authoritative refresh/409 handling, review-only actions, and accessible responsive diff behavior | deterministic |
| `scripts/test-engine-physics-scaffold.mjs` | Validates authored physics layers/materials/bodies, runtime physics integration hooks, and fallback syntax-only compilation of the native physics slice | deterministic |
| `scripts/test-engine-input-scaffold.mjs` | Validates the native input subsystem sources plus text-backed action/context assets and runs a fallback syntax-only compile | deterministic |
| `scripts/test-engine-tooling-ui-scaffold.mjs` | Validates the native tooling registry/layout substrate, runtime integration hooks, and runs a fallback syntax-only compile | deterministic |
| `scripts/test-ollama-smoke.mjs` | Resolves a reachable Ollama endpoint, optionally autostarts local WSL Ollama, and performs a minimal OpenAI-compatible chat completion smoke test | real local-model |

## Current Commands

```bash
npm test
node scripts/test-engine-shell-smoke.mjs
node scripts/test-engine-sessiond.mjs
npm run test:ai-scaffold
node scripts/test-engine-ai-scaffold.mjs
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
