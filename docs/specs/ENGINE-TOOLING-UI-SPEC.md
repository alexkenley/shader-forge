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
- runtime inspection hooks for frame timing, input state, scene name, recent log capture, and first live gameplay-state context such as player id, movement speed, animation state, movement blocking, active save slot, interaction target, and physics-debug state
- input-driven overlay and panel toggles wired through the engine-owned action map

Dear ImGui docking is still the target frontend, but the current slice is the substrate and persistence groundwork rather than a full Dear ImGui renderer integration.

The implemented Assets rest/sampled rig schematic is a React shell surface, not this native tooling layer. It consumes bounded v1/v2 sessiond evaluations and shows exact evaluator frames, coordinates, resolved v2 pole points, procedural-layer truth, sampled v2 IK diagnostics, diagnose-only joint-limit aggregate and per-bone PASS/FAIL, and an exact prefab-bound authored visual-box outline in three orthographic projections. Joint-limit unavailable is exact `no_joint_limits_authored`. The box is render-procgeo evidence, not a rendered mesh or collision truth. The schematic is not review evidence and has no available clipping result, camera, or capture; candidate evaluation remains rest-only.

Planned native spatial overlays may later show labelled candidates, axis probes, the same sampled-pose diagnostics, and capture state, but they must consume the same spatial operations and never persist assets directly. Native overlay work must not promote the current shell schematic into review evidence or invent a second attachment path. See [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md).
