# Procedural Geometry Spec

## Purpose

Procedural geometry is a first-class system in Shader Forge, not a side utility.

## Initial Scope

- primitives
- extrusion and sweep operations
- terrain and spline-adjacent generation
- bake-to-asset support
- preview support in the shell

## Current First Slice

The current first slice in the repo now includes:

- text-backed procedural geometry source assets under `content/procgeo/`
- `box` and `plane_grid` generators as the first deterministic procgeo lane
- `engine bake` support that turns those source assets into staged cooked payloads and generated-mesh preview artifacts

Extrusion, sweep operations, terrain shaping beyond a flat grid, and shell-native preview UX are still later widening passes.
