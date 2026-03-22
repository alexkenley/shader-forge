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

## Non-Goals

- full cloth, destruction, or soft body support in the first slice
- hiding backend details behind a giant abstraction layer before the engine path works
