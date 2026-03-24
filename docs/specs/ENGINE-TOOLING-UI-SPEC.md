# Engine Tooling UI Spec

## Purpose

The native tooling UI layer is the runtime-facing UI used for debug overlays, editor-only panels, profiling, and low-latency inspection inside the native process.

## Framework Decision

Use Dear ImGui with docking.

## Responsibilities

- debug overlays
- profiler surfaces
- frame graph and GPU inspection views
- native visualizers and gizmos
- runtime-only editor tools that belong inside the native process

## Current First Slice

The current first slice in the repo now includes:

- a native tool registry with named panels for runtime stats, input debug, log view, and debug state
- text-backed tooling layout data in `tooling/layouts/default.tooling-layout.toml`
- session-layout save groundwork through `tooling/layouts/runtime-session.tooling-layout.toml`
- runtime inspection hooks for frame timing, input state, scene name, recent log capture, and first live gameplay-state context such as player id, movement speed, animation state, movement blocking, and interaction target
- input-driven overlay and panel toggles wired through the engine-owned action map

Dear ImGui docking is still the target frontend, but the current slice is the substrate and persistence groundwork rather than a full Dear ImGui renderer integration.
