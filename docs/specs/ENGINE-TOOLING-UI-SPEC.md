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

