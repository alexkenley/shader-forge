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

- `engine build` configures and builds `shader_forge_runtime` through CMake, resolving the executable from `SHADER_FORGE_CMAKE` first and then falling back to `cmake` on `PATH`
- `engine run sandbox` builds and launches the native runtime target
- `engine run` now forwards `--input-root`, `--content-root`, `--audio-root`, `--animation-root`, `--physics-root`, `--data-foundation`, `--save-root`, `--tooling-layout`, and `--tooling-layout-save` so native bring-up can inspect text-backed engine assets and configuration directly while keeping runtime persistence under the active project root
- `engine bake` now scans the text-backed content, audio, animation, and physics roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report plus generated-mesh preview payloads for procedural geometry assets
- `engine migrate detect <path>` now detects Unity, Unreal, or Godot project structure and emits a normalized migration manifest, report, warnings file, and script-porting placeholder under `migration/<run-id>/`
- `engine migrate unity|godot <path>` now pins the requested source-engine lane and emits a first-pass `shader-forge-project/` migration skeleton plus updated manifest/report outputs for deterministic fixture coverage
- `engine migrate unreal <path>` now reports the explicit `unreal_offline_fallback` lane when exporter-assisted data is unavailable in this slice, emits first-pass scene/prefab/data skeleton outputs, and records low-confidence Blueprint package manifests from offline `.uasset` name inspection
- `engine migrate report <path>` now summarizes a generated migration report without requiring manual file inspection
- `engine_sessiond` also exposes a runtime build lifecycle surface so the shell can trigger native builds and stream logs without scraping a PTY
- `engine policy inspect [--root <path>]` now prints the effective code-trust policy, supported hot-reload roots, and tracked artifact metadata for a workspace
- `engine policy check <action> [path] [--root <path>] [--actor ...] [--origin ...]` now dry-runs the shared code-trust layer so assistant-facing workflows can be validated without executing a risky transition first
- `engine policy artifacts [--root <path>]` now prints tracked artifact hashes, verification state, and promote/quarantine metadata for a workspace
- `engine policy approvals [--session <id>] [--state pending|all] [--base-url <url>]` now lists queued review-required requests from a live `engine_sessiond`
- `engine policy approve <approval-id>` and `engine policy deny <approval-id>` now resolve queued code-trust approvals from the terminal
- `engine policy promote <path> [--root <path>] [--decision-by <name>] [--note <text>]` now promotes a tracked artifact into a reviewed project-owned state and refreshes its trusted hash
- `engine policy quarantine <path> [--root <path>] [--decision-by <name>] [--note <text>]` now marks a tracked artifact as quarantined so later risky transitions deny it until it is promoted again
- `engine ai providers [--root <path>]` now prints the effective AI provider manifest, provider readiness state, and current default provider for a workspace
- `engine ai test [--root <path>] [--provider <id>] [--prompt <text>] [--system <text>]` now runs a workspace-backed smoke test through the shared AI layer
- `engine ai request <prompt> [--root <path>] [--provider <id>] [--system <text>]` now reuses the same first-slice request path for deterministic fake-provider output and optional Ollama-backed prompts
- `engine export inspect [--root <path>] [--preset <id>] [--package-root <path>]` now prints the resolved export preset, packaging prerequisites, cooked-asset counts, and last package summary for a workspace
- `engine package [--root <path>] [--preset <id>] [--package-root <path>] [--skip-bake] [--force-bake]` now emits a reproducible release-layout scaffold under `build/package/<preset>/`, bundling the current runtime binary, packaged authored runtime roots, cooked outputs, launch scripts, and a package report; missing cooked outputs are auto-baked unless that step is explicitly skipped
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
