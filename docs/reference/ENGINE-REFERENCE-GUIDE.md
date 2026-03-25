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

### Native Runtime Setup

- Yes: the guide now has an explicit native-runtime setup section for Windows.
- `.\scripts\start-dev-clean.ps1` now auto-detects CMake, including the copy bundled with Visual Studio, and exports `SHADER_FORGE_CMAKE` when found.
- `.\scripts\install-windows-native-runtime-deps.ps1` is the repo helper for the Windows native-runtime dependency lane.
- If the startup script prints `Using CMake: ...`, CMake itself is not the blocker.
- The real native runtime still requires SDL3 development files plus the Vulkan SDK/loader.
- On Windows, install the Vulkan SDK from LunarG.
- For the current Shader Forge setup, the Vulkan installer should use `The Vulkan SDK Core` only; the extra optional SDK components are not required for this repo right now.
- On Windows, the recommended SDL3 path is `vcpkg`, not Visual Studio Installer.
- Recommended one-step repo helper:
  `powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows-native-runtime-deps.ps1`
- That helper clones `vcpkg` if needed, bootstraps it, installs or rebuilds `sdl3[vulkan]:x64-windows` with `--recurse`, sets `VCPKG_ROOT` and `CMAKE_TOOLCHAIN_FILE` for the current process, and persists them to the user environment by default.
- If `Build + Run` reaches SDL startup and then says Vulkan support is not configured in SDL, the installed SDL3 package is missing the `vulkan` feature; rerun `.\scripts\install-windows-native-runtime-deps.ps1` or run `C:\src\vcpkg\vcpkg.exe install sdl3[vulkan]:x64-windows --recurse`.
- Recommended environment variables for CMake-based Windows runs:
  `VCPKG_ROOT=C:\src\vcpkg`
  `CMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake`
- `.\scripts\start-dev-clean.ps1` now also auto-detects the `vcpkg` toolchain file and the Vulkan SDK when they are installed.
- After installing Vulkan SDK or SDL3 through `vcpkg`, reopen PowerShell and rerun `.\scripts\start-dev-clean.ps1`.
- If build logs say `SDL3 was not found`, `Vulkan was not found`, or `built in stub mode`, that means CMake worked but the native runtime dependencies are still missing.

### Shell Workspace Overview

- The left rail currently exposes `Workspaces`, `Explorer`, and `Source Control`.
- The center dock currently exposes `Scene`, `Game`, `Preview`, `Code`, and `Guide`.
- The right panel currently exposes `Runtime`, `Build`, and `Workspace` for non-`Scene` tabs, and it is intentionally hidden during `Scene` authoring so the editor can use that space directly.
- The bottom dock currently exposes `Terminal`, `Logs`, and `Output`.
- The bottom dock can now be resized vertically from its top edge and explicitly `Collapse`d, `Restore`d, or `Maximize`d so terminal/log surfaces do not overlap the main workspace.
- The `Workspace` right-panel tab now also exposes the active code-trust policy summary, supported authored hot-reload roots, and recent tracked artifacts for the selected workspace.
- Use `Code` for the preserved Monaco bridge and repo workspace context.
- Use `Game` and `Preview` to drive the external native runtime window from the shell, with runtime/build/workspace tools grouped beside those runtime-facing surfaces.
- Use `Scene` for repo-backed scene/prefab authoring with a viewport-first layout, authoring/review separation, explicit `Run Scene` plus `Build + Run` controls in the editor, save/reload/duplicate commands, a resizable adjacent level-tools sidebar (`Scenes`, `Outliner`, `Inspector`, `Assets`), and a compact bottom status bar instead of oversized summary cards.
- If `Build` or `Build + Run` fails because `cmake` is missing, the shell now surfaces that as setup guidance; the clean-start scripts also auto-detect common CMake installs and export `SHADER_FORGE_CMAKE` when possible, while plain `Run` still depends on an already-built runtime binary under `build/runtime/bin`.
- A successful native build can still be a stub runtime if SDL3 or Vulkan are missing; the shell now surfaces that separately as native dependency setup rather than another CMake problem.
- Use `Guide` for the in-app wiki and repo source references.

## Session Backend And CLI

### Workspaces, Files, And Source Control

- `engine_sessiond` currently provides session create/list/get/update/delete.
- Session records now persist across `engine_sessiond` restarts and stay available until deleted.
- Safe file list, file read, and file write APIs are now available inside the active session root.
- Runtime start and restart can now launch against the selected session root so shell authoring and runtime testing point at the same project files.
- Runtime start and restart now also derive a save root under `<session-root>/saved/runtime` so quick-saves persist with the active project instead of the backend process directory.
- `GET /api/code-trust/summary` and `POST /api/code-trust/evaluate` now expose the shared code-trust boundary for shell, CLI, and future assistant clients.
- Policy-relevant file writes now record origin and trust-tier metadata under `<session-root>/.shader-forge/code-trust-artifacts.json`.
- Runtime build and runtime start/restart now pass through the same code-trust policy layer before compile or load transitions continue.
- Host filesystem directory listing is already used by the workspace-root picker.
- Git status and repository initialization are already used by the `Source Control` rail.
- PTY terminal lifecycle is already wired into the bottom-dock terminal surfaces.

### Engine CLI Surfaces

- `engine sessiond start` starts the local backend service.
- `engine session create` and `engine session list` expose session bring-up from the terminal.
- `engine file list` and `engine file read` expose safe file inspection.
- `engine policy inspect [--root <path>]` now prints the effective code-trust policy, supported authored hot-reload roots, and tracked artifacts for a workspace.
- `engine policy check <action> [path] [--root <path>] [--actor ...] [--origin ...]` now dry-runs the same code-trust layer that sessiond enforces before risky assistant-facing transitions.
- `engine build runtime` configures and builds the native runtime with CMake, resolving the executable from `SHADER_FORGE_CMAKE` first and then falling back to `cmake` on `PATH`.
- `engine run <scene>` builds and launches the native runtime and now forwards content, audio, animation, physics, data, save, and tooling roots.
- `engine bake` scans text-backed content, audio, animation, and physics roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report.
- `engine migrate detect|unity|godot <path>` now emits normalized migration manifests and reports for supported source-engine fixtures and real projects.
- `engine migrate unreal <path>` now reports the explicit `unreal_offline_fallback` lane, lower conversion confidence, and low-confidence Blueprint package manifests when exporter-assisted Unreal data is unavailable in the current slice.
- `engine migrate report <path>` summarizes a generated migration report from the terminal.
- `engine import`, `engine package`, and `engine export` are still later phases.
- The CLI bake lane is now real, but it still emits staged cooked payloads and generated-mesh previews rather than the final FlatBuffers writer.
- The CLI migration lane is now split honestly: `detect` is report-only, while pinned engine lanes emit a first-pass Shader Forge project skeleton rather than claiming full parity.

### Migration Foundation

- `fixtures/migration/unity-minimal`, `fixtures/migration/unreal-minimal`, `fixtures/migration/unreal-offline-minimal`, and `fixtures/migration/godot-minimal` are the deterministic source-project fixtures for the current migration slices.
- `engine migrate detect` auto-detects Unity, Unreal, or Godot project structure and writes `migration-manifest.toml`, `report.toml`, and `warnings.toml` under `migration/<run-id>/`.
- `engine migrate unity` and `engine migrate godot` now pin the requested source-engine lane while also emitting a self-contained `shader-forge-project/` skeleton under each run root.
- `engine migrate unreal` currently pins the explicit `unreal_offline_fallback` lane, emits the same `shader-forge-project/` skeleton shape, and records the preferred exporter-assisted lane separately in the manifest and report.
- Pinned engine lanes now generate first-pass migrated `.scene.toml`, `.prefab.toml`, `.data.toml`, and `script-porting/*.port.toml` outputs for the current fixtures.
- The Unreal offline fallback currently derives scene and prefab placeholders from `.umap` names, Blueprint-like `.uasset` package names, and available C++ class symbols rather than exported Unreal actor data.
- The current migration slice now converts project structure into a usable Shader Forge skeleton, but it still does not provide full asset, hierarchy, or gameplay parity.

## Runtime And Authoring

### Runtime Bring-Up And Viewer Bridge

- The native runtime has Vulkan instance, surface, device, swapchain, render pass, framebuffer, submit, and present bring-up.
- Resize-aware swapchain recreation is already implemented.
- Runtime build, run, stop, restart, pause, and resume are already controlled from the shell, and shell-driven run/restart now follow the active session root.
- The shell tracks runtime state, build state, bridge activity, and recent log tails in `Game` and `Preview`.
- The native runtime now projects authored prefab render components into visible debug-proxy scene cards in the external Vulkan window, so the active scene is no longer only a clear-color loop during manual testing.
- The native runtime now also has a first authored-content iteration lane: `F7` forces reload of content/audio/animation/physics/data state, and the runtime also polls saved authored-file timestamps to pick up shell edits without a full restart.
- The native runtime now resolves effect-capable interaction targets from the current view/crosshair, and `ui_accept` input such as Enter or left-click triggers first visible interaction feedback plus effect-descriptor-backed logs.
- The native runtime now also has a widened first save-system lane: `F8` writes the active `quickslot_01` through `quickslot_03` runtime save, `F9` reloads it, `F11`/`F12` cycle the active slot, and the save path follows the active session/project root instead of mixing runtime persistence into authored content roots.
- The native runtime now also has a first projected physics-debug lane: authored blocking bodies and query-only trigger bodies can be visualized in the external window, overlap-triggered bodies are highlighted, and `F10` toggles that view during manual testing.
- The native runtime still renders in an external window.
- The browser shell remains the primary workspace.
- Embedded viewer transport and screenshot capture are still deferred.
- On Windows, Visual Studio can provide CMake without providing the SDL3 development package or Vulkan SDK that the real native runtime needs, so a successful `Build + Run` can still end in stub-mode runtime exit until those native dependencies are installed.

### Scene, Prefab, And Data Foundation

- `content/scenes/*.scene.toml` is the initial authored scene lane.
- `content/prefabs/*.prefab.toml` is the initial authored prefab lane.
- `content/data/*.data.toml` is the initial authored engine/bootstrap data lane.
- `content/effects/*.effect.toml` is the initial authored effect-descriptor lane.
- `content/procgeo/*.procgeo.toml` is the initial authored procedural-geometry lane.
- `audio/buses.toml`, `audio/sounds/*.sound.toml`, and `audio/events/*.audio-event.toml` are the initial authored audio lanes.
- `animation/skeletons/*.skeleton.toml`, `animation/clips/*.anim.toml`, and `animation/graphs/*.animgraph.toml` are the initial authored animation lanes.
- `physics/layers.toml`, `physics/materials/*.physics-material.toml`, and `physics/bodies/*.physics-body.toml` are the initial authored physics lanes.
- `saved/runtime/*.runtime-save.toml` is now the initial runtime-persistence lane and is intentionally separate from authored source assets.
- `data/foundation/engine-data-layout.toml` defines the current `TOML -> FlatBuffers -> SQLite` split.
- The runtime validates the content roots through `DataFoundation` before startup continues.
- Scene-to-prefab relationships are validated across the catalog.
- The runtime can now compose authored scene entities plus prefab payloads into a first runtime scene snapshot with resolved hierarchy-derived world transforms.
- The runtime can now look up authored procgeo dimensions and use them to size projected debug proxies for prefab render components in the scene viewer.
- `runtime_bootstrap.data.toml` can now provide a default scene and tooling overlay preference.
- The runtime window title and startup logs now include active scene and primary prefab context from the authored assets.
- The runtime now selects a preferred controlled entity from authored spawn tags such as `player_camera`, and `move_*` plus `look_*` input now drives that entity state.
- Controlled-entity movement now respects a first authored-physics blocking lane against scene physics bodies, and the runtime surfaces the blocking body in logs plus window state during manual testing.
- Authored `on_overlap` effect triggers can now activate automatically from query-only scene bodies during runtime movement, so the running scene has a first automatic trigger-volume lane alongside manual `ui_accept` interaction.
- The shell `Scene` workspace now opens scene and prefab assets directly from the active session root and round-trips deterministic save, reload, revert, duplicate, and primary-prefab edits back to those files.
- Shell run/restart now forward the active session root into runtime launch so the external runtime reads the same authored scene files the shell edits.
- The running runtime now follows those authored edits through a first polling/manual reload lane rather than requiring a full process restart for every save.
- Effect-capable proxies in the running scene can now be aimed at with the crosshair and triggered through `ui_accept`, which surfaces first runtime feedback for authored `[component.effect]` data instead of leaving it as static catalog metadata.
- `saved/runtime/quickslot_01.runtime-save.toml` through `quickslot_03.runtime-save.toml` are now the first inspectable runtime save payloads, and the current snapshot stores scene, controlled-entity, transform, animation-context, and triggered-overlap state for manual iteration.
- `Review` in the current shell authoring slice is intentionally discard-only. Entering it drops unsaved drafts and disables persistent writes until `Authoring` is restored.
- The runtime now loads authored audio buses, sounds, and named events through `AudioSystem`.
- Runtime startup resolves a `runtime_boot` audio event, and `ui_accept` now flows through the same engine-owned audio event API.
- The runtime now loads authored animation skeletons, clips, and graphs through `AnimationSystem`.
- Runtime startup resolves a default animation graph, logs graph/state/event catalog data, and routes entry-clip `audio_event` hooks through the engine-owned audio event API.
- Movement now drives a first authored animation-state lane in runtime: `idle` and `walk` can be resolved by name from the current graph, the active state/clip is surfaced in window state, and walk clip `audio_event` hooks now fire during movement playback.
- The native tooling overlay now also surfaces live player id/position, movement speed, active animation state/clip, blocking body, active save slot, current interaction target, active triggered effect, and physics-debug state so manual runtime testing is not dependent on log scanning alone.
- The runtime now loads authored physics layers, materials, and primitive bodies through `PhysicsSystem`.
- Runtime startup logs physics layer/body summaries and runs deterministic raycast plus overlap queries against the active scene.
- The current runtime slice can now project first physics-debug body visualization for blocking and query-only bodies, but it is still a debug overlay rather than final in-engine physics gizmos.
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
- The runtime currently consumes actions such as `runtime_exit`, `reload_runtime_content`, `save_runtime_state`, `load_runtime_state`, `toggle_physics_debug`, `select_previous_save_slot`, `select_next_save_slot`, `move_x`, `move_y`, `look_x`, `look_y`, `ui_accept`, and `ui_back`, with `F7` active for authored-content reload plus `F8`, `F9`, `F10`, `F11`, and `F12` active for quick-save, quick-load, physics-debug toggling, and runtime save-slot cycling.
- The native tooling substrate currently has a named panel registry.
- Tooling layouts are loaded from text and session layouts can be saved back to disk.
- The current panel set covers runtime stats, input debug, log view, and debug state.
- The overlay summary now also carries first live gameplay-state context for the controlled entity, animation state, movement blocking, active save slot, interaction target, and physics-debug state during manual testing.
- Tooling overlay and panel toggles are already bound through the engine-owned input actions.
- Dear ImGui docking and real in-process native panel rendering are still ahead.

### Deterministic Harnesses And Clean Start

- `npm test` runs the preserved shell smoke harness.
- `npm run test:sessiond` validates the local backend session and file flows.
- `npm run test:viewer-bridge` validates build/runtime bridge events.
- `npm run test:code-trust-scaffold` validates the shared code-trust policy summary, tracked artifact metadata, allowed authored-content hot reload, and rejected assistant-triggered engine apply/compile/load paths.
- `npm run test:scene-authoring` validates the shell scene-authoring surface plus session-root scene/prefab/entity/transform file writes.
- `npm run test:scene-runtime-scaffold` validates the first Phase 6 composed-scene and controlled-entity runtime slice.
- `npm run test:runtime-scaffold`, `test:save-system-scaffold`, `test:data-foundation-scaffold`, `test:asset-pipeline`, `test:migration-fixtures`, `test:audio-scaffold`, `test:animation-scaffold`, `test:physics-scaffold`, `test:input-scaffold`, and `test:tooling-ui-scaffold` validate the native bring-up and first cook slices.
- `./scripts/start-dev-clean.sh` is the Unix/WSL clean-start path.
- `powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1` is the Windows clean-start path.
- Both scripts remove generated outputs, rerun the current deterministic baseline, auto-detect a usable CMake installation when possible, export `SHADER_FORGE_CMAKE`, start `engine_sessiond`, and then launch the active shell workflow.

## Current Boundaries And Next Widening Passes

### What Exists Now

- A React/Vite shell workspace with persistent backend-owned sessions, file preview, source control, terminal tabs, and runtime control.
- A real shell-side scene authoring workflow with repo-backed `.scene.toml` and `.prefab.toml` save/reload/duplicate flows plus placed-entity hierarchy, transform editing, first prefab component payload editing, and active-session-root runtime handoff.
- A real native SDL3/Vulkan runtime slice with input, tooling, data-foundation, audio, animation, physics, first composed scene-runtime hooks, session-root launch alignment from the shell/session backend, and a first runtime save-system lane.
- Text-backed scene, prefab, data, effect, procedural-geometry, audio, animation, and physics roots represented in the repo.
- A first CLI bake lane that emits staged cooked outputs, generated-mesh preview artifacts, and staged cooked audio, animation, and physics metadata.
- A first CLI migration lane that detects supported source-engine project shapes, emits normalized migration manifests plus reports, and now converts the current fixtures into first-pass Shader Forge project skeletons.
- A first code-trust lane with source-controlled policy data, shared sessiond/CLI evaluation, tracked assistant/code-path artifacts, and explicit assistant-triggered compile/load/apply gating.
- A searchable in-app guide plus repo-native markdown and JSON assistant guides.

### What Still Needs Widening

- The shell still needs deeper UX and more app-native surfaces beyond the preserved code bridge.
- Scene authoring still needs transform gizmos, deeper scene/component payload authoring, and bake-back flows beyond the current text-backed entity plus prefab-component slice.
- The runtime still needs a full mesh/material rendering path, richer prefab/component instancing beyond the current projected debug proxies, broader scene simulation, and broader native verification.
- The save system still needs wider world-state persistence, multiple slots, profile/settings support, and migration-aware tooling beyond the current quick-save lane.
- The content pipeline still needs the real FlatBuffers writer, import lanes, and deeper preview surfaces beyond the first staged bake path.
- Audio still needs the real playback backend, bus mixing/control, and preview surfaces on top of the new authored event-definition lane.
- Animation still needs the real sampling/blending backend, graph-parameter control, root-motion application, and preview tooling on top of the new authored graph-definition lane.
- Physics still needs the real backend integration, sweeps, joints, character support, and richer debug gizmos/capture on top of the new authored query-definition lane.
- Migration still needs actual scene, prefab, asset, and gameplay conversion lanes on top of the new detect/report foundation.
- Code trust still needs approvals, stronger artifact verification, trust-promotion workflows, and real code hot-reload contracts beyond the current policy-and-diagnostics slice.
- Tooling UI still needs the full Dear ImGui frontend and deeper authoring/profiling panels.
