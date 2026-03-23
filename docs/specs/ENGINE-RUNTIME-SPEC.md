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
- audio is intentionally deferred until after the first runtime window/render-loop slice; see the audio spec for the later subsystem plan

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

## Future AI Runtime Boundary

`engine_runtime` should consume AI outputs through validated asynchronous gameplay interfaces rather than direct arbitrary model control over frame-critical systems.
