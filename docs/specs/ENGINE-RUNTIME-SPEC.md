# Engine Runtime Spec

## Purpose

`engine_runtime` is the native C++ application that owns rendering, audio playback integration, simulation, input, timing, and gameplay execution.

## Initial Scope

- native desktop window
- SDL3 bootstrap
- Vulkan device and swapchain
- frame loop
- timing and input
- logging
- audio playback backend integration is deferred until after the first runtime window/render-loop slice; see the audio spec for the authored-audio and later playback plan

## Current First Slice

The current runtime slice is the first real native bring-up pass:

- SDL3 window creation
- Vulkan instance, surface, physical-device, and logical-device selection
- swapchain-backed clear-color frame loop
- resize-aware swapchain recreation
- per-frame synchronization and present path
- optional validation-layer enablement when the local Vulkan setup exposes `VK_LAYER_KHRONOS_validation`
- engine-owned input loading from `input/actions.toml` and `input/contexts/*.input.toml`
- named input actions and axes consumed inside the runtime instead of direct raw SDL checks
- engine-owned audio loading from `audio/buses.toml`, `audio/sounds/*.sound.toml`, and `audio/events/*.audio-event.toml`
- runtime startup now resolves a `runtime_boot` audio event and logs engine-owned audio event requests such as `ui_accept`
- engine-owned animation loading from `animation/skeletons/*.skeleton.toml`, `animation/clips/*.anim.toml`, and `animation/graphs/*.animgraph.toml`
- runtime startup now resolves a default animation graph, logs animation graph/state/event catalog data, and routes entry-clip `audio_event` hooks through the engine-owned audio-event API
- movement can now drive a first runtime animation-state lane by resolving authored named graph states such as `idle` and `walk`, with walk clip `audio_event` hooks firing during movement-driven playback
- engine-owned physics loading from `physics/layers.toml`, `physics/materials/*.physics-material.toml`, and `physics/bodies/*.physics-body.toml`
- runtime startup now logs physics layer/body summaries and runs deterministic raycast plus overlap queries for the active scene through engine-owned physics APIs
- native tooling registry/layout loading and session-layout save groundwork for later Dear ImGui-backed panels
- engine-owned data foundation loading from `data/foundation/engine-data-layout.toml` plus scene/prefab/data/effect/procgeo source catalog validation under `content/`
- runtime startup logs now expose the current data/cook decisions and scene-source lookup path for the selected runtime scene
- runtime startup can now resolve the active scene and initial tooling-overlay preference from `runtime_bootstrap.data.toml`
- shell/sessiond launch now passes the active session project root into runtime startup so input/content/audio/animation/physics/data/tooling paths follow the selected workspace during manual testing
- scene metadata such as title and primary prefab now feeds runtime title/log state instead of staying disconnected from execution
- authored scene-entity hierarchy and transform summaries now feed runtime startup logs instead of staying disconnected from execution
- referenced prefab component payload summaries now feed runtime startup logs instead of staying disconnected from execution
- authored scenes and prefabs can now compose into a first runtime scene snapshot with resolved hierarchy-derived world transforms
- authored prefab render components now also drive a first projected debug-proxy scene pass in the Vulkan window so operators can see the composed scene while the full shader/material pipeline is still ahead
- the runtime now selects a preferred controlled entity from authored spawn tags such as `player_camera`
- named `move_*` and `look_*` actions now drive that controlled entity position and orientation at runtime
- the runtime now exposes a first authored-content reload lane for manual iteration: `reload_runtime_content` is bound to `F7`, and content/audio/animation/physics/data changes are also detected through a simple saved-file polling pass
- authored-content reload now stages replacement audio, animation, data-foundation, and physics state before swap-in so broken edits do not destroy the previous live runtime state
- the runtime now resolves effect-capable interaction targets from the current view/crosshair instead of pinning interaction to the first authored effect entity
- `ui_accept` can now trigger first effect-descriptor-backed runtime feedback and logs for the current interaction target, with visible debug-proxy feedback in the external window
- controlled-entity movement now respects a first authored-physics blocking lane by testing horizontal movement against scene physics bodies instead of always moving freely through the composed scene
- authored `on_overlap` effect triggers can now activate automatically from query-only scene bodies during runtime movement instead of requiring every effect-capable entity to be manually targeted with `ui_accept`
- movement now also drives a first runtime animation-state lane with authored `idle`/`walk` state selection, active clip context in the window title, and movement-triggered clip-event audio requests
- the runtime now owns a first save-system lane: `F8` writes a versioned quick-save payload under the configured `saved/runtime/` root, `F9` reloads it, and shell/sessiond launch now scopes that save root to the active project/session workspace
- the native tooling overlay now also surfaces live controlled-entity, movement-speed, animation-state, movement-block, and interaction-target context during manual runtime testing
- physics query origins and runtime interaction logs now follow the composed scene entity state instead of staying hard-coded at world zero
- animation graph and entry-state context now feeds runtime title/log state instead of staying disconnected from execution
- physics scene-query state is now logged against the authored scene context instead of staying disconnected from execution

Current boundary:

- the runtime now has first visible composed-scene rendering through projected debug proxies, but not a full mesh/material/shader pipeline yet
- the runtime now has a first shell-to-runtime project-root handoff, first polling/manual authored-content reload, first authored-physics movement blocking, first overlap-triggered effect activation, first movement-driven animation-state playback, first quick-save/quick-load lane, and first interaction-target/effect feedback for manual testing, but not shader reload, watcher-backed hot reload, full world-state persistence, or deeper mounted-project/package layering yet
- Dear ImGui-native panels, real asset-backed geometry submission, and player-facing game UI are still later widening passes

## Future AI Runtime Boundary

`engine_runtime` should consume AI outputs through validated asynchronous gameplay interfaces rather than direct arbitrary model control over frame-critical systems.
