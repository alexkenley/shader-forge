# Engine Runtime Spec

## Purpose

`engine_runtime` is the native C++ application that owns rendering, simulation, input, timing, and gameplay execution.

## Initial Scope

- native desktop window
- SDL3 bootstrap
- Vulkan device and swapchain
- frame loop
- timing and input
- logging

## Future AI Runtime Boundary

`engine_runtime` should consume AI outputs through validated asynchronous gameplay interfaces rather than direct arbitrary model control over frame-critical systems.
