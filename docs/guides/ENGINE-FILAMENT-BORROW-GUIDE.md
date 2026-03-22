# Filament Borrow Guide

Date: 2026-03-22

## Purpose

Use Filament as a reference for renderer architecture, material/shader tooling separation, and asset-tool discipline.

Repository:
- `https://github.com/google/filament`

Primary phases:
- Phase 3
- Phase 5
- Phase 6

## Borrow Targets

### Renderer Decomposition

Look for:
- renderer/runtime module boundaries
- diagnostic and validation surfaces
- resource lifetime discipline

Borrow:
- clear separation between runtime renderer code and offline tools
- disciplined material and shader pipeline boundaries
- practical diagnostics surfaces for rendering errors

Adapt for Shader Forge:
- keep Vulkan-first decisions explicit
- map ideas into Shader Forge's runtime rather than mirroring Filament's API surface

Do not borrow as-is:
- the full renderer abstraction model
- backend and platform assumptions that do not serve Shader Forge's narrower stack

### Material And Asset Toolchain

Look for:
- material compiler flow
- glTF import/tool split
- offline asset preparation concepts

Borrow:
- offline compile plus runtime cache ideas
- asset-tool separation from runtime frame code

Adapt for Shader Forge:
- route cooked outputs into FlatBuffers and runtime asset bundles
- keep authored assets human-editable where Shader Forge intends them to be
