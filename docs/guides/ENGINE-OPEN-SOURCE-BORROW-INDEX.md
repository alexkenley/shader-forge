# Open Source Borrow Index

Date: 2026-03-22

## Purpose

Capture the open-source engine and framework repos that Shader Forge should use as bounded reference inputs during implementation.

These guides are reference inputs, not adoption plans. Shader Forge remains:

- Vulkan-first
- SDL3-first
- C++23 + CMake
- browser-shell-led for workflow
- text-backed for authored scene and prefab source data

## Use Rules

- borrow patterns, manager boundaries, workflow ideas, and harness shapes
- do not transplant whole architectures or object models into Shader Forge
- keep direct code-copy behind explicit license review and local adaptation
- prefer the smallest useful borrow that unblocks a concrete phase milestone

## Guide Set

- [The Forge Borrow Guide](./ENGINE-THE-FORGE-BORROW-GUIDE.md)
- [Wicked Engine Borrow Guide](./ENGINE-WICKED-ENGINE-BORROW-GUIDE.md)
- [Filament Borrow Guide](./ENGINE-FILAMENT-BORROW-GUIDE.md)
- [Godot Borrow Guide](./ENGINE-GODOT-BORROW-GUIDE.md)
- [O3DE Borrow Guide](./ENGINE-O3DE-BORROW-GUIDE.md)
- [Stride Borrow Guide](./ENGINE-STRIDE-BORROW-GUIDE.md)
- [Bevy Borrow Guide](./ENGINE-BEVY-BORROW-GUIDE.md)
- [Fyrox Borrow Guide](./ENGINE-FYROX-BORROW-GUIDE.md)
- [Distill Borrow Guide](./ENGINE-DISTILL-BORROW-GUIDE.md)
- [bgfx Borrow Guide](./ENGINE-BGFX-BORROW-GUIDE.md)
- [Input Borrow Guide](./ENGINE-INPUT-BORROW-GUIDE.md)
- [Physics Borrow Guide](./ENGINE-PHYSICS-BORROW-GUIDE.md)
- [Save System Borrow Guide](./ENGINE-SAVE-SYSTEM-BORROW-GUIDE.md)
- [Packaging Borrow Guide](./ENGINE-PACKAGING-BORROW-GUIDE.md)
- [Profiling Borrow Guide](./ENGINE-PROFILING-BORROW-GUIDE.md)
- [Audio Borrow Guide](./ENGINE-AUDIO-BORROW-GUIDE.md)
- [Animation Borrow Guide](./ENGINE-ANIMATION-BORROW-GUIDE.md)
- [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md)
- [Code Access Borrow Guide](./ENGINE-CODE-ACCESS-BORROW-GUIDE.md)
- [Hell2025 Borrow Plan](./ENGINE-HELL2025-BORROW-PLAN.md)

## Phase Lookup

### Phase 1: Engine Shell Scaffold

- use [Godot](./ENGINE-GODOT-BORROW-GUIDE.md), [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md), [Stride](./ENGINE-STRIDE-BORROW-GUIDE.md), and [Fyrox](./ENGINE-FYROX-BORROW-GUIDE.md) for editor/workspace composition ideas

### Phase 2: Session Backend And CLI

- use [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md) and [Stride](./ENGINE-STRIDE-BORROW-GUIDE.md) for project/tooling lifecycle ideas
- use [Godot](./ENGINE-GODOT-BORROW-GUIDE.md) for editor/runtime ownership boundaries

### Phase 3: Native Runtime Bring-Up

- use [The Forge](./ENGINE-THE-FORGE-BORROW-GUIDE.md), [Wicked Engine](./ENGINE-WICKED-ENGINE-BORROW-GUIDE.md), [Filament](./ENGINE-FILAMENT-BORROW-GUIDE.md), [bgfx](./ENGINE-BGFX-BORROW-GUIDE.md), and [Hell2025](./ENGINE-HELL2025-BORROW-PLAN.md)

### Phase 4: Viewer Bridge

- use [Godot](./ENGINE-GODOT-BORROW-GUIDE.md), [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md), [Stride](./ENGINE-STRIDE-BORROW-GUIDE.md), [Fyrox](./ENGINE-FYROX-BORROW-GUIDE.md), and [Wicked Engine](./ENGINE-WICKED-ENGINE-BORROW-GUIDE.md)

### Phase 4.2: Input And Action Mapping

- use the [Input Borrow Guide](./ENGINE-INPUT-BORROW-GUIDE.md)
- use the [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md) for tool-context keybinding file ideas

### Phase 5: Assets And Procedural Geometry

- use [Filament](./ENGINE-FILAMENT-BORROW-GUIDE.md), [Distill](./ENGINE-DISTILL-BORROW-GUIDE.md), [bgfx](./ENGINE-BGFX-BORROW-GUIDE.md), and [Hell2025](./ENGINE-HELL2025-BORROW-PLAN.md)

### Phase 5.5: Data And Effects

- use [Distill](./ENGINE-DISTILL-BORROW-GUIDE.md), [Godot](./ENGINE-GODOT-BORROW-GUIDE.md), [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md), [Stride](./ENGINE-STRIDE-BORROW-GUIDE.md), [Bevy](./ENGINE-BEVY-BORROW-GUIDE.md), and [Hell2025](./ENGINE-HELL2025-BORROW-PLAN.md)

### Phase 5.7: Audio System

- use the [Audio Borrow Guide](./ENGINE-AUDIO-BORROW-GUIDE.md)

### Phase 5.72: Animation System

- use the [Animation Borrow Guide](./ENGINE-ANIMATION-BORROW-GUIDE.md)

### Phase 5.74: Physics And Collision

- use the [Physics Borrow Guide](./ENGINE-PHYSICS-BORROW-GUIDE.md)

### Phase 5.6 And 5.8: Migration Foundation And Source Conversion

- use [Godot](./ENGINE-GODOT-BORROW-GUIDE.md), [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md), and [Stride](./ENGINE-STRIDE-BORROW-GUIDE.md) for project layout, import metadata, and conversion target shape

### Phase 5.75: Level Authoring

- use [Godot](./ENGINE-GODOT-BORROW-GUIDE.md), [Fyrox](./ENGINE-FYROX-BORROW-GUIDE.md), [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md), [Stride](./ENGINE-STRIDE-BORROW-GUIDE.md), and [Hell2025](./ENGINE-HELL2025-BORROW-PLAN.md)
- use the [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md) for assistant-friendly scene editing and scene/prefab text round-trip ideas

### Phase 5.9: Reusable AI Subsystem

- use [Bevy](./ENGINE-BEVY-BORROW-GUIDE.md) and [O3DE](./ENGINE-O3DE-BORROW-GUIDE.md) for plugin/service boundary ideas only
- use the [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md) for assistant-facing scene bridge patterns
- use the [Code Access Borrow Guide](./ENGINE-CODE-ACCESS-BORROW-GUIDE.md) for tool, skill, and code-trust boundaries

### Phase 5.95: Code Access, Trust, And Hot Reload Safety

- use the [Code Access Borrow Guide](./ENGINE-CODE-ACCESS-BORROW-GUIDE.md)
- use the [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md) for hotload test shape and trusted-code boundary ideas

### Phase 6: Game-Ready Loop

- use [Wicked Engine](./ENGINE-WICKED-ENGINE-BORROW-GUIDE.md), [Bevy](./ENGINE-BEVY-BORROW-GUIDE.md), [The Forge](./ENGINE-THE-FORGE-BORROW-GUIDE.md), [Filament](./ENGINE-FILAMENT-BORROW-GUIDE.md), and [Distill](./ENGINE-DISTILL-BORROW-GUIDE.md)
- use the [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md) for mounted-filesystem, watcher, and hot iteration workflow ideas

### Phase 6.1: Save And Runtime Persistence

- use the [Save System Borrow Guide](./ENGINE-SAVE-SYSTEM-BORROW-GUIDE.md)

### Phase 6.2: Packaging And Export

- use the [Packaging Borrow Guide](./ENGINE-PACKAGING-BORROW-GUIDE.md)
- use the [s&box Borrow Guide](./ENGINE-SBOX-BORROW-GUIDE.md) for publish-manifest preflight and transient packaging-config ideas

### Phase 6.3: Profiling, Diagnostics, And Performance

- use the [Profiling Borrow Guide](./ENGINE-PROFILING-BORROW-GUIDE.md)
