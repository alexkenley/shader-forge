# Engine CLI Spec

## Purpose

`engine_cli` provides the command-line entry point for building, running, testing, migrating, importing, and baking.

## Phase 2 Initial Slice

The first implemented CLI slice focuses on backend bring-up and local inspection.

Current implemented commands:

- `engine sessiond start`
- `engine session create`
- `engine session list`
- `engine file list`
- `engine file read`
- `engine ai providers`
- `engine ai test`
- `engine ai request`
- `engine export inspect`
- `engine package`
- `engine profile list`
- `engine profile live`
- `engine profile capture`
- `engine policy inspect`
- `engine policy check`
- `engine policy artifacts`
- `engine policy approvals`
- `engine policy approve`
- `engine policy deny`
- `engine policy promote`
- `engine policy quarantine`
- `engine build`
- `engine run`
- `engine spatial validate`
- `engine spatial cook`
- `engine spatial evaluate-rest`
- `engine spatial evaluate-sample`
- `engine spatial preview`
- `engine spatial approve`
- `engine spatial reject`
- `engine spatial apply`
- `engine spatial undo`
- `engine bake`
- `engine migrate detect`
- `engine migrate unity`
- `engine migrate unreal`
- `engine migrate godot`
- `engine migrate report`

## Initial Commands

- `engine run`
- `engine build`
- `engine test`
- `engine import`
- `engine bake`
- `engine package`
- `engine export`

The initial build/run/bake command family now targets the native runtime and cooked-content scaffolds:

- `engine build runtime` configures and builds `shader_forge_runtime` through CMake, resolving the executable from `SHADER_FORGE_CMAKE` first and then falling back to `cmake` on `PATH`; the no-target `engine build` form remains compatible and selects `runtime`
- `engine build spatial` configures the same native tree and builds only the dependency-free `shader_forge_spatial` validate/cook/evaluate-rest/evaluate-sample executable
- `engine build data` configures the same native tree and builds only `shader_forge_data`; the runtime build path also builds this validator so semantic World operations are provisioned for normal development
- `engine spatial validate [--animation-root animation] [--build-dir build/runtime] [--config Debug]` runs an already-built validator and prints deterministic JSON for valid skeleton/socket and attachment-profile data; it fails with a build-first diagnostic rather than compiling implicitly
- `engine spatial cook [--animation-root animation] [--output-root build/cooked] [--build-dir build/runtime] [--config Debug]` runs the same already-built tool, validates through `AnimationSystem`, and atomically stages one deterministic derived payload at `<output-root>/animation/spatial-authoring.bin`; it rejects unknown, missing, duplicate, or positional arguments and does not auto-build or join the generic `engine bake` lane yet
- `engine spatial evaluate-rest --attachment <id> [--animation-root animation] [--content-root content] [--data-foundation data/foundation/engine-data-layout.toml] [--build-dir build/runtime] [--config Debug]` runs the same already-built tool and emits `shader_forge.spatial_attachment_evaluation` schema version 1 or 2 according to the attachment profile. The output is deterministic unsolved rest-pose schematic geometry with `pose.sampled=false`, meters/right-handed `+Y` up and `+Z` forward, `xyzw` quaternions, local/world bone and socket frames, joint-segment endpoints, item/contact/handle frames, and hand targets. It keeps exact `authored_visual_box` evidence separate from an independently authored `authored_collision_box`. `diagnostics.jointLimits` is the exact diagnose-only aggregate/per-bone cone-swing/signed-twist object. `diagnostics.clipping` uses exact metric `capsule_axis_to_oriented_box_clearance`: for each authored skeleton capsule, surface clearance is axis-segment distance to the oriented collision box minus radius, positive violation is overlap depth, and exact tangency is CLEAR. It never mutates the pose, substitutes visual geometry, supplies a contact manifold, or makes a gameplay-safety judgment. Missing inputs return only the exact typed reasons `item_prefab_not_found`, `item_prefab_ambiguous`, `item_prefab_invalid`, `item_collision_not_authored`, or `diagnostic_capsules_not_authored` with empty evidence. Solved IK remains unavailable in rest output. A v1 pole remains `space="unresolved"` with `world=null`; a v2 pole is an item-space point with a resolved world coordinate. The result is not rendered review evidence and creates no review artifact.
- `engine spatial evaluate-sample --attachment <id> --phase <phase> --normalized-time <value> [--animation-root animation] [--content-root content] [--data-foundation data/foundation/engine-data-layout.toml] [--build-dir build/runtime] [--config Debug]` resolves an exact authored motion-envelope phase/time and emits geometry over the deterministic schema-v2 clip sampler. Its pose is `kind="clip_sample"` and `sampled=true`; primary attachment is applied and requested/applied/unavailable procedural layers are explicit. V2 two-hand results apply deterministic two-bone `secondary_hand_ik`, use the item-space pole and secondary palm socket, preserve limb lengths, and report physical reachability plus separate reach/contact/angular residual and tolerance truth. The same independent visual-box and collision-box/capsule evidence is composed at the sampled pose, with the same exact typed joint-limit and clipping contracts. Unreachable targets clamp only the physical wrist solve and remain out of tolerance. V1 two-hand results retain `pre_ik_only`; one-hand results retain `sampled_attachment_schematic_only`. Every result includes `not_review_evidence`. The command is read-only and creates no review artifact.
- `engine spatial preview --session <id> --path animation/attachments/<file>.attachment.toml --content-file <path> --base-revision <sha256:...|missing> --label <text> --agent <id> --lease <id> [--base-url <url>]` decodes the candidate file as strict BOM-free UTF-8 and sends the full candidate to the semantic sessiond preview route without writing authored data
- `engine spatial approve|reject <operation-id> [--base-url <url>]` performs the lease-free review transition through sessiond
- `engine spatial apply|undo <operation-id> --agent <id> --lease <id> [--base-url <url>]` sends the coordinator identity and lease through sessiond; the credential comes only from `SHADER_FORGE_AGENT_CREDENTIAL` and is never accepted as a flag or printed
- all spatial operation commands record actor `{kind: "cli", id: "engine-cli", name: "Shader Forge CLI"}`, reject unknown/duplicate/missing arguments, print the returned JSON, and never auto-register, acquire a lease, approve, build, or bypass sessiond
- `engine run sandbox` builds and launches the native runtime target
- `engine run` now forwards `--input-root`, `--content-root`, `--audio-root`, `--animation-root`, `--physics-root`, `--data-foundation`, `--save-root`, `--tooling-layout`, and `--tooling-layout-save` so native bring-up can inspect text-backed engine assets and configuration directly while keeping runtime persistence under the active project root
- `engine bake` now scans the text-backed content, audio, animation, and physics roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report plus generated-mesh preview payloads for procedural geometry assets
- `engine migrate detect <path>` now detects Unity, Unreal, or Godot project structure and emits a normalized migration manifest, report, warnings file, and script-porting placeholder under `migration/<run-id>/`
- `engine migrate unity|godot <path>` now pins the requested source-engine lane and emits a first-pass `shader-forge-project/` migration skeleton plus updated manifest/report outputs; conversion output reports mapped scene-entity, prefab-component, and script-binding counts
- `engine migrate unreal <path>` now reports the explicit `unreal_offline_fallback` lane when exporter-assisted data is unavailable in this slice, emits first-pass scene/prefab/data skeleton outputs, and records low-confidence Blueprint package manifests from offline `.uasset` name inspection
- `engine migrate report <path>` now summarizes a generated migration report, including mapped entity/component/script-binding coverage, without requiring manual file inspection
- `engine_sessiond` also exposes a runtime build lifecycle surface so the shell can trigger native builds and stream logs without scraping a PTY
- `engine policy inspect [--root <path>]` now prints the effective code-trust policy, supported hot-reload roots, and tracked artifact metadata for a workspace
- `engine policy check <action> [path] [--root <path>] [--actor ...] [--origin ...]` now dry-runs the shared code-trust layer so assistant-facing workflows can be validated without executing a risky transition first
- `engine policy artifacts [--root <path>]` now prints tracked artifact hashes, verification state, and promote/quarantine metadata for a workspace
- `engine policy approvals [--session <id>] [--state pending|all] [--base-url <url>]` now lists queued review-required requests from a live `engine_sessiond`
- `engine policy approve <approval-id>` and `engine policy deny <approval-id>` now resolve queued code-trust approvals from the terminal
- `engine policy promote <path> [--session <id>] [--root <path>] [--base-url <url>] [--decision-by <name>] [--note <text>]` now promotes a tracked artifact through `engine_sessiond`'s HTTP transition route and refreshes its trusted hash
- `engine policy quarantine <path> [--session <id>] [--root <path>] [--base-url <url>] [--decision-by <name>] [--note <text>]` now marks a tracked artifact as quarantined through that same sessiond mutation authority so later risky transitions deny it until it is promoted again
- `engine ai providers [--root <path>]` now prints the effective AI provider manifest, provider readiness state, and current default provider for a workspace
- `engine ai test [--root <path>] [--provider <id>] [--prompt <text>] [--system <text>]` now runs a workspace-backed smoke test through the shared AI layer for deterministic fake, optional Ollama, or enabled OpenRouter providers and reports normalized token usage when supplied
- `engine ai request <prompt> [--root <path>] [--provider <id>] [--system <text>]` reuses the same path for freeform prompts; the disabled-by-default `openrouter_kimi` and `openrouter_glm` manifest entries use `OPENROUTER_API_KEY`, the `moonshotai/kimi-k3` or `z-ai/glm-5.2` model slug, and a validated `max_output_tokens` ceiling
- `engine export inspect [--root <path>] [--preset <id>] [--package-root <path>]` now prints the resolved export preset, packaging prerequisites, cooked-asset counts, and last package summary for a workspace; source-controlled `default` and `release` desktop presets provide Debug and Release package configurations
- `engine package [--root <path>] [--preset <id>] [--package-root <path>] [--skip-bake] [--force-bake]` now emits a reproducible release-layout scaffold under `build/package/<preset>/`, auto-bakes missing cooked outputs unless skipped, and executes the default `archive_zip` hook to produce `build/package/<preset>.zip`; unsupported hooks remain explicit `declared_only` report entries
- `engine profile list [--root <path>] [--session <id>] [--base-url <url>] [--limit <count>]` now lists persisted diagnostics captures from either a workspace or a live `engine_sessiond` session
- `engine profile live [--root <path>]` now prints the first diagnostics snapshot lane, including runtime/build state, git summary, AI/code-trust summary, packaging readiness, and recommendations; `--session` plus `--base-url` can switch that to a live `engine_sessiond` snapshot
- `engine profile capture [--root <path>] [--label <name>] [--output <path>]` now writes a shareable JSON diagnostics capture under `build/profiling/captures/`, and `--session` plus `--base-url` can capture a live sessiond-backed runtime/build snapshot with recent logs plus later list that history

`engine test` and `engine import` remain reserved command space.

The current migration lane is split honestly:

- `engine migrate detect` remains the foundation slice for supported source-engine detection plus provenance capture
- pinned Unity and Godot lanes now generate first-pass Shader Forge scene/prefab/data skeleton outputs and script-porting manifests, but they do not yet provide full asset or gameplay parity
- the current Unreal CLI lane is explicitly the Phase 5.85 offline fallback path: it records `unreal_offline_fallback`, lower conversion confidence, and manual follow-up rather than pretending exporter-assisted parity

## Future Packaging And Diagnostics Commands

- `engine export preset init`
- `engine package hook run`
- `engine save inspect`
- `engine save migrate`
- `engine profile trace`
- `engine profile external-capture`

## Current Migration Commands

- `engine migrate detect`
- `engine migrate unity`
- `engine migrate unreal`
- `engine migrate godot`
- `engine migrate report`

## Remaining AI Commands

- `engine ai budgets`
