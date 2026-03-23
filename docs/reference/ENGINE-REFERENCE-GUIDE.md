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
- Use `Scene` for repo-backed scene/prefab authoring with edit/play separation, save/reload/duplicate commands, a world outliner, details editing, and prefab assignment over the real text assets.
- Use `Guide` for the in-app wiki and repo source references.

## Session Backend And CLI

### Sessions, Files, And Source Control

- `engine_sessiond` currently provides session create/list/get/update/delete.
- Safe file list, file read, and file write APIs are now available inside the active session root.
- Host filesystem directory listing is already used by the workspace-root picker.
- Git status and repository initialization are already used by the `Source Control` rail.
- PTY terminal lifecycle is already wired into the bottom-dock terminal surfaces.

### Engine CLI Surfaces

- `engine sessiond start` starts the local backend service.
- `engine session create` and `engine session list` expose session bring-up from the terminal.
- `engine file list` and `engine file read` expose safe file inspection.
- `engine build runtime` configures and builds the native runtime with CMake.
- `engine run <scene>` builds and launches the native runtime and now forwards content, audio, animation, physics, data, and tooling roots.
- `engine bake` scans text-backed content, audio, animation, and physics roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report.
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
- `audio/buses.toml`, `audio/sounds/*.sound.toml`, and `audio/events/*.audio-event.toml` are the initial authored audio lanes.
- `animation/skeletons/*.skeleton.toml`, `animation/clips/*.anim.toml`, and `animation/graphs/*.animgraph.toml` are the initial authored animation lanes.
- `physics/layers.toml`, `physics/materials/*.physics-material.toml`, and `physics/bodies/*.physics-body.toml` are the initial authored physics lanes.
- `data/foundation/engine-data-layout.toml` defines the current `TOML -> FlatBuffers -> SQLite` split.
- The runtime validates the content roots through `DataFoundation` before startup continues.
- Scene-to-prefab relationships are validated across the catalog.
- `runtime_bootstrap.data.toml` can now provide a default scene and tooling overlay preference.
- The runtime window title and startup logs now include active scene and primary prefab context from the authored assets.
- The shell `Scene` workspace now opens scene and prefab assets directly from the active session root and round-trips deterministic save, reload, revert, duplicate, and primary-prefab edits back to those files.
- `Play Mode` in the current shell authoring slice is intentionally discard-only. Entering it drops unsaved drafts and disables persistent writes until `Edit Mode` is restored.
- The runtime now loads authored audio buses, sounds, and named events through `AudioSystem`.
- Runtime startup resolves a `runtime_boot` audio event, and `ui_accept` now flows through the same engine-owned audio event API.
- The runtime now loads authored animation skeletons, clips, and graphs through `AnimationSystem`.
- Runtime startup resolves a default animation graph, logs graph/state/event catalog data, and routes entry-clip `audio_event` hooks through the engine-owned audio event API.
- The runtime now loads authored physics layers, materials, and primitive bodies through `PhysicsSystem`.
- Runtime startup logs physics layer/body summaries and runs deterministic raycast plus overlap queries against the active scene.
- `engine bake` now emits staged cooked outputs into `build/cooked/`, writes generated-mesh preview payloads for `procgeo` assets, stages cooked audio metadata under `build/cooked/audio/`, stages cooked animation metadata under `build/cooked/animation/`, and stages cooked physics metadata under `build/cooked/physics/`.
- There is not yet a final FlatBuffers writer, SQLite asset index, or Effekseer runtime integration.

### Audio Foundation

- `audio/buses.toml` defines the initial required buses: `Master`, `Music`, `SFX`, `Voice`, and `Ambience`.
- `audio/sounds/*.sound.toml` defines named sounds with bus routing, playback mode, spatialization, streaming, and default volume metadata.
- `audio/events/*.audio-event.toml` defines named audio events that currently resolve to sound-play requests through engine-owned APIs.
- The current audio slice validates and resolves requests, but it does not decode or mix sound yet. Playback backend integration is still ahead.

### Animation Foundation

- `animation/skeletons/*.skeleton.toml` defines named authored skeletons with root-bone and bone-list metadata.
- `animation/clips/*.anim.toml` defines named clips with skeleton ownership, looping/root-motion metadata, and text-backed clip events.
- `animation/graphs/*.animgraph.toml` defines named animation graphs with float parameters, named states, and explicit entry-state selection.
- The current runtime slice validates and resolves default graphs plus entry-clip events, but it does not sample, blend, or retarget animation yet.

### Physics Foundation

- `physics/layers.toml` defines the initial collision layers and text-backed collision masks.
- `physics/materials/*.physics-material.toml` defines named physics materials with friction, restitution, and density metadata.
- `physics/bodies/*.physics-body.toml` defines primitive scene bodies with scene ownership, layer/material references, motion type, and box or sphere shape data.
- The current runtime slice validates and resolves deterministic raycast and overlap queries over those primitive bodies, but it does not run a full simulation backend yet.

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
- `npm run test:scene-authoring` validates the shell scene-authoring surface plus session-root scene/prefab file writes.
- `npm run test:runtime-scaffold`, `test:data-foundation-scaffold`, `test:asset-pipeline`, `test:migration-fixtures`, `test:audio-scaffold`, `test:animation-scaffold`, `test:physics-scaffold`, `test:input-scaffold`, and `test:tooling-ui-scaffold` validate the native bring-up and first cook slices.
- `./scripts/start-dev-clean.sh` is the Unix/WSL clean-start path.
- `powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1` is the Windows clean-start path.
- Both scripts remove generated outputs, rerun the current deterministic baseline, start `engine_sessiond`, and then launch the active shell workflow.

## Current Boundaries And Next Widening Passes

### What Exists Now

- A React/Vite shell workspace with backend-owned sessions, file preview, source control, terminal tabs, and runtime control.
- A real shell-side scene authoring workflow with repo-backed `.scene.toml` and `.prefab.toml` save/reload/duplicate flows.
- A real native SDL3/Vulkan runtime slice with input, tooling, data-foundation, audio, animation, and physics hooks.
- Text-backed scene, prefab, data, effect, procedural-geometry, audio, animation, and physics roots represented in the repo.
- A first CLI bake lane that emits staged cooked outputs, generated-mesh preview artifacts, and staged cooked audio, animation, and physics metadata.
- A first CLI migration lane that detects supported source-engine project shapes and emits normalized migration manifests plus reports.
- A searchable in-app guide plus repo-native markdown and JSON assistant guides.

### What Still Needs Widening

- The shell still needs deeper UX and more app-native surfaces beyond the preserved code bridge.
- Scene authoring still needs placed-entity editing, transform gizmos, component payload authoring, and bake-back flows beyond the current metadata round-trip slice.
- The runtime still needs richer rendering, real scene loading, and broader native verification.
- The content pipeline still needs the real FlatBuffers writer, import lanes, and deeper preview surfaces beyond the first staged bake path.
- Audio still needs the real playback backend, bus mixing/control, and preview surfaces on top of the new authored event-definition lane.
- Animation still needs the real sampling/blending backend, graph-parameter control, root-motion application, and preview tooling on top of the new authored graph-definition lane.
- Physics still needs the real backend integration, sweeps, joints, character support, and debug draw on top of the new authored query-definition lane.
- Migration still needs actual scene, prefab, asset, and gameplay conversion lanes on top of the new detect/report foundation.
- Tooling UI still needs the full Dear ImGui frontend and deeper authoring/profiling panels.
