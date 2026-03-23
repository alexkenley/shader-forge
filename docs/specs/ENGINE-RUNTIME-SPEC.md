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
- engine-owned physics loading from `physics/layers.toml`, `physics/materials/*.physics-material.toml`, and `physics/bodies/*.physics-body.toml`
- runtime startup now logs physics layer/body summaries and runs deterministic raycast plus overlap queries for the active scene through engine-owned physics APIs
- native tooling registry/layout loading and session-layout save groundwork for later Dear ImGui-backed panels
- engine-owned data foundation loading from `data/foundation/engine-data-layout.toml` plus scene/prefab/data/effect/procgeo source catalog validation under `content/`
- runtime startup logs now expose the current data/cook decisions and scene-source lookup path for the selected runtime scene
- runtime startup can now resolve the active scene and initial tooling-overlay preference from `runtime_bootstrap.data.toml`
- scene metadata such as title and primary prefab now feeds runtime title/log state instead of staying disconnected from execution
- animation graph and entry-state context now feeds runtime title/log state instead of staying disconnected from execution
- physics scene-query state is now logged against the authored scene context instead of staying disconnected from execution

## Future AI Runtime Boundary

`engine_runtime` should consume AI outputs through validated asynchronous gameplay interfaces rather than direct arbitrary model control over frame-critical systems.
