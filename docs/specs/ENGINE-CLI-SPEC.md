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

- `engine build` configures and builds `shader_forge_runtime` through `cmake`
- `engine run sandbox` builds and launches the native runtime target
- `engine run` now forwards `--input-root`, `--content-root`, `--audio-root`, `--animation-root`, `--physics-root`, `--data-foundation`, `--tooling-layout`, and `--tooling-layout-save` so native bring-up can inspect text-backed engine assets and configuration directly
- `engine bake` now scans the text-backed content, audio, animation, and physics roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report plus generated-mesh preview payloads for procedural geometry assets
- `engine migrate detect <path>` now detects Unity, Unreal, or Godot project structure and emits a normalized migration manifest, report, warnings file, and script-porting placeholder under `migration/<run-id>/`
- `engine migrate unity|godot <path>` now pins the requested source-engine lane and emits a first-pass `shader-forge-project/` migration skeleton plus updated manifest/report outputs for deterministic fixture coverage
- `engine migrate unreal <path>` now reports the explicit `unreal_offline_fallback` lane when exporter-assisted data is unavailable in this slice, emits first-pass scene/prefab/data skeleton outputs, and records low-confidence Blueprint package manifests from offline `.uasset` name inspection
- `engine migrate report <path>` now summarizes a generated migration report without requiring manual file inspection
- `engine_sessiond` also exposes a runtime build lifecycle surface so the shell can trigger native builds and stream logs without scraping a PTY

`engine test`, `engine import`, `engine package`, and `engine export` remain reserved command space.

The current migration lane is split honestly:

- `engine migrate detect` remains the foundation slice for supported source-engine detection plus provenance capture
- pinned Unity and Godot lanes now generate first-pass Shader Forge scene/prefab/data skeleton outputs and script-porting manifests, but they do not yet provide full asset or gameplay parity
- the current Unreal CLI lane is explicitly the Phase 5.85 offline fallback path: it records `unreal_offline_fallback`, lower conversion confidence, and manual follow-up rather than pretending exporter-assisted parity

## Future Packaging And Diagnostics Commands

- `engine package`
- `engine export`
- `engine save inspect`
- `engine save migrate`
- `engine profile capture`
- `engine profile live`

## Current Migration Commands

- `engine migrate detect`
- `engine migrate unity`
- `engine migrate unreal`
- `engine migrate godot`
- `engine migrate report`

## Future AI Commands

- `engine ai providers`
- `engine ai test`
- `engine ai request`
- `engine ai budgets`
