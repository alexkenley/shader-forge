# Engine Physics Spec

## Purpose

The physics system owns collision detection, rigid body simulation, character interaction support, scene query APIs, joints, and physics-debug visualization.

It exists so Shader Forge can provide a clear deterministic gameplay-facing physics layer instead of treating collision and simulation as an unplanned late add-on.

## Core Principles

- the first physics backend should be engine-owned and C++ friendly
- gameplay code should target engine physics APIs, not backend-specific types
- authored collision and physics settings must be text-backed and assistant-editable
- physics must integrate cleanly with animation, scene authoring, and runtime tools
- debug visualization and deterministic harnesses are required, not optional

## Implementation Direction

Initial direction:

- backend direction: Jolt Physics
- integration and tooling references: O3DE PhysX flows and Godot-style collision object ergonomics

## Authoring Model

Recommended first artifacts:

- collider and body data embedded in scene and prefab component payloads
- `physics/materials/<name>.physics-material.toml`
- `physics/layers.toml`

## Responsibilities

- broadphase and narrowphase collision
- rigid bodies and kinematic bodies
- collision layers and masks
- scene queries: raycasts, overlaps, sweeps
- joints and constraints
- character movement support
- ragdoll and animation-physics handoff hooks
- debug visualization and capture support

## Initial Scope

- collision layers and masks
- static, kinematic, and dynamic bodies
- primitive colliders
- scene queries
- simple joints
- physics materials
- debug draw and deterministic test coverage

## Current First Slice

The current Phase 5.74 slice now exists as a first engine-owned physics foundation:

- `physics/layers.toml` is the first authored collision-layer and mask lane
- `physics/materials/*.physics-material.toml` is the first authored physics-material lane
- `physics/bodies/*.physics-body.toml` is the first authored primitive-body lane while scene/prefab component payloads are still widening
- the native runtime now loads those authored assets through `PhysicsSystem` before startup continues
- collision-layer relationships, material references, motion types, and primitive-body shape settings are validated at runtime rather than left as implied future structure
- deterministic raycast and sphere-overlap queries now exist through engine-owned physics APIs over authored primitive bodies
- runtime startup now logs layer/body summaries plus deterministic query results for the active scene
- the native runtime now also projects a first physics-debug visualization lane for authored bodies, with distinct query-only/blocking colors plus overlap/block highlights for manual testing
- `engine run` now forwards `--physics-root`
- `engine bake` now scans the physics root and stages cooked layer, material, and body metadata under `build/cooked/physics/`
- deterministic harness coverage now exists for the authored physics assets, runtime integration hooks, and staged physics cook lane

This is still a widening slice, not the final physics runtime. There is not yet a Jolt-backed simulation step, sweeps, joints, character movement, ragdoll/animation handoff, or richer native physics gizmo/capture tooling.

## Non-Goals

- full cloth, destruction, or soft body support in the first slice
- hiding backend details behind a giant abstraction layer before the engine path works
