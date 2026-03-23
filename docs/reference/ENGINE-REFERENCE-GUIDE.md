# Shader Forge Reference Guide

Searchable operator and assistant wiki for the current Shader Forge shell, session backend, native runtime, tooling, content data, and deterministic verification workflow.

Use this file first from terminal assistants and repo search.

Primary searchable sources:

- `docs/reference/ENGINE-REFERENCE-GUIDE.md`
- `docs/reference/ENGINE-REFERENCE-GUIDE.json`
- `shell/engine-shell/src/reference-guide.ts`
- `plans/ENGINE-IMPLEMENTATION-PLAN.md`
- `docs/specs/ENGINE-SYSTEMS-INDEX.md`
- `AGENTS.md`

Assistant entry points:

- `docs/reference/ENGINE-REFERENCE-GUIDE.md`
- `docs/reference/ENGINE-REFERENCE-GUIDE.json`
- `AGENTS.md`
- `plans/ENGINE-IMPLEMENTATION-PLAN.md`
- `docs/specs/ENGINE-SYSTEMS-INDEX.md`

## Getting Started

### Reference Sources

- Use `docs/reference/ENGINE-REFERENCE-GUIDE.md` as the plain-text guide for terminal assistants and repo search.
- Use `docs/reference/ENGINE-REFERENCE-GUIDE.json` as the structured guide source for the shell and future native assistants.
- Use `shell/engine-shell/src/reference-guide.ts` as the shell adapter that imports the structured guide data.
- Use `plans/ENGINE-IMPLEMENTATION-PLAN.md` to check current phase order, progress, and dependency gates.
- Use `docs/specs/ENGINE-SYSTEMS-INDEX.md` to jump to the subsystem specs that define the current architecture.
- Use `AGENTS.md` for repo workflow rules, documentation obligations, and required update discipline.

### Assistant Lookup Workflow

- Start with the markdown guide when you need a quick terminal-readable overview of current behavior.
- Use the JSON guide when an assistant needs structured categories, page ids, references, or search terms.
- Use the implementation plan and subsystem specs to widen from current behavior into target architecture.

### Update Discipline

- When user-facing behavior, shell workflow, runtime control, or assistant-facing engine behavior changes, update the reference guide in the same pass.
- Keep `docs/reference/ENGINE-REFERENCE-GUIDE.md`, `docs/reference/ENGINE-REFERENCE-GUIDE.json`, and `shell/engine-shell/src/reference-guide.ts` aligned so the shell and assistants resolve the same guide.
- Treat the guide as operator and assistant working documentation, not marketing copy or a post-hoc changelog.
- Keep the guide concrete enough that a coding assistant in a terminal can search it and act on it without needing the whole codebase first.

### Shell Workspace Overview

- The left rail currently exposes `Sessions`, `Explorer`, and `Source Control`.
- The center dock currently exposes `Code`, `Game`, `Scene`, `Preview`, and `Guide`.
- The right panel currently exposes `Details`, `Build`, and `Run`.
- The bottom dock currently exposes `Terminal`, `Logs`, and `Output`.
- Use `Code` for the preserved Monaco bridge and repo workspace context.
- Use `Game` and `Preview` to drive the external native runtime window from the shell.
- Use `Scene` to track the text-backed authoring direction for `.scene.toml` and `.prefab.toml` assets.
- Use `Guide` for the in-app wiki and repo source references.

## Session Backend And CLI

### Sessions, Files, And Source Control

- `engine_sessiond` currently provides session create/list/get/update/delete.
- Safe file list and file read APIs are already used by the `Explorer` rail.
- Host filesystem directory listing is already used by the workspace-root picker.
- Git status and repository initialization are already used by the `Source Control` rail.
- PTY terminal lifecycle is already wired into the bottom-dock terminal surfaces.

### Engine CLI Surfaces

- `engine sessiond start` starts the local backend service.
- `engine session create` and `engine session list` expose session bring-up from the terminal.
- `engine file list` and `engine file read` expose safe file inspection.
- `engine build runtime` configures and builds the native runtime with CMake.
- `engine run <scene>` builds and launches the native runtime and now forwards content, data, and tooling roots.
- `engine bake` scans text-backed content roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report.
- `engine migrate detect|unity|unreal|godot <path>` now emits normalized migration manifests and reports for supported source-engine fixtures and real projects.
- `engine migrate report <path>` summarizes a generated migration report from the terminal.
- `engine import`, `engine package`, and `engine export` are still later phases.
- The CLI bake lane is now real, but it still emits staged cooked payloads and generated-mesh previews rather than the final FlatBuffers writer.
- The CLI migration lane is now real for detection and reporting, but it does not convert source-engine content into Shader Forge-native assets yet.

### Migration Foundation

- `fixtures/migration/unity-minimal`, `fixtures/migration/unreal-minimal`, and `fixtures/migration/godot-minimal` are the deterministic source-project fixtures for the first migration slice.
- `engine migrate detect` auto-detects Unity, Unreal, or Godot project structure and writes `migration-manifest.toml`, `report.toml`, and `warnings.toml` under `migration/<run-id>/`.
- `engine migrate unity`, `engine migrate unreal`, and `engine migrate godot` pin the requested source-engine lane while producing the same normalized outputs.
- Every migration run currently creates a `script-porting/README.md` placeholder so later gameplay/code translation has a stable destination.
- The current migration slice captures provenance and target layout intent only. No asset, scene, prefab, or gameplay conversion is performed yet.

## Runtime And Authoring

### Runtime Bring-Up And Viewer Bridge

- The native runtime has Vulkan instance, surface, device, swapchain, render pass, framebuffer, submit, and present bring-up.
- Resize-aware swapchain recreation is already implemented.
- Runtime build, play, stop, restart, pause, and resume are already controlled from the shell.
- The shell tracks runtime state, build state, bridge activity, and recent log tails in `Game` and `Preview`.
- The native runtime still renders in an external window.
- The browser shell remains the primary workspace.
- Embedded viewer transport and screenshot capture are still deferred.

### Scene, Prefab, And Data Foundation

- `content/scenes/*.scene.toml` is the initial authored scene lane.
- `content/prefabs/*.prefab.toml` is the initial authored prefab lane.
- `content/data/*.data.toml` is the initial authored engine/bootstrap data lane.
- `content/effects/*.effect.toml` is the initial authored effect-descriptor lane.
- `content/procgeo/*.procgeo.toml` is the initial authored procedural-geometry lane.
- `data/foundation/engine-data-layout.toml` defines the current `TOML -> FlatBuffers -> SQLite` split.
- The runtime validates the content roots through `DataFoundation` before startup continues.
- Scene-to-prefab relationships are validated across the catalog.
- `runtime_bootstrap.data.toml` can now provide a default scene and tooling overlay preference.
- The runtime window title and startup logs now include active scene and primary prefab context from the authored assets.
- `engine bake` now emits staged cooked outputs into `build/cooked/` and writes generated-mesh preview payloads for `procgeo` assets.
- There is not yet a final FlatBuffers writer, SQLite asset index, or Effekseer runtime integration.

## Input, Tooling, And Testing

### Input And Native Tooling Foundations

- `input/actions.toml` plus `input/contexts/*.input.toml` define the current action and context maps.
- Keyboard, mouse, and gamepad input are routed through engine-owned named actions and axes.
- The runtime currently consumes actions such as `runtime_exit`, `move_x`, `move_y`, `look_x`, `look_y`, `ui_accept`, and `ui_back`.
- The native tooling substrate currently has a named panel registry.
- Tooling layouts are loaded from text and session layouts can be saved back to disk.
- The current panel set covers runtime stats, input debug, log view, and debug state.
- Tooling overlay and panel toggles are already bound through the engine-owned input actions.
- Dear ImGui docking and real in-process native panel rendering are still ahead.

### Deterministic Harnesses And Clean Start

- `npm test` runs the preserved shell smoke harness.
- `npm run test:sessiond` validates the local backend session and file flows.
- `npm run test:viewer-bridge` validates build/runtime bridge events.
- `npm run test:runtime-scaffold`, `test:data-foundation-scaffold`, `test:asset-pipeline`, `test:migration-fixtures`, `test:input-scaffold`, and `test:tooling-ui-scaffold` validate the native bring-up and first cook slices.
- `./scripts/start-dev-clean.sh` is the Unix/WSL clean-start path.
- `powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1` is the Windows clean-start path.
- Both scripts remove generated outputs, rerun the current deterministic baseline, start `engine_sessiond`, and then launch the active shell workflow.

## Current Boundaries And Next Widening Passes

### What Exists Now

- A React/Vite shell workspace with backend-owned sessions, file preview, source control, terminal tabs, and runtime control.
- A real native SDL3/Vulkan runtime slice with input, tooling, and data-foundation hooks.
- Text-backed scene, prefab, data, effect, and procedural-geometry roots represented in the repo.
- A first CLI bake lane that emits staged cooked outputs and generated-mesh preview artifacts.
- A first CLI migration lane that detects supported source-engine project shapes and emits normalized migration manifests plus reports.
- A searchable in-app guide plus repo-native markdown and JSON assistant guides.

### What Still Needs Widening

- The shell still needs deeper UX and more app-native surfaces beyond the preserved code bridge.
- The runtime still needs richer rendering, real scene loading, and broader native verification.
- The content pipeline still needs the real FlatBuffers writer, import lanes, and deeper preview surfaces beyond the first staged bake path.
- Migration still needs actual scene, prefab, asset, and gameplay conversion lanes on top of the new detect/report foundation.
- Tooling UI still needs the full Dear ImGui frontend and deeper authoring/profiling panels.
