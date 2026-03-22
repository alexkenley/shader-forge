# The Forge Borrow Guide

Date: 2026-03-22

## Purpose

Use The Forge as a reference input for native runtime and renderer bring-up, not as a base engine to embed into Shader Forge.

Repository:
- `https://github.com/ConfettiFX/The-Forge`

Primary phases:
- Phase 3
- Phase 5
- Phase 6

## Borrow Targets

### Runtime And Renderer Boundaries

Look for:
- renderer startup sequencing
- device, swapchain, queue, sync, and resource-loader boundaries
- sample frame-loop structure for a first stable runtime window

Borrow:
- explicit renderer manager boundaries
- startup and shutdown ordering
- upload and staging patterns that keep GPU work explicit

Adapt for Shader Forge:
- keep SDL3 as the bootstrap layer
- keep CMake and Shader Forge naming
- use it as a structure reference, not a platform abstraction mandate

Do not borrow as-is:
- engine-wide platform abstraction layers that compete with SDL3-first intent
- sample content, platform glue, or framework macros wholesale

### Shader And Asset Tooling

Look for:
- shader build utilities
- offline tool/runtime handoff ideas
- sample asset-loading flow

Borrow:
- separation between offline compilation and runtime consumption
- explicit diagnostics flow for shader/tool failures

Adapt for Shader Forge:
- integrate with Vulkan-first shader cooking
- keep Shader Forge's text-source plus cooked-output model
