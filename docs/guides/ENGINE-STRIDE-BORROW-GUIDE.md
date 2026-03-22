# Stride Borrow Guide

Date: 2026-03-22

## Purpose

Use Stride as a reference for editor/build/runtime separation, asset compilation workflow, and practical authoring surfaces.

Repository:
- `https://github.com/stride3d/stride`

Primary phases:
- Phase 1
- Phase 2
- Phase 4
- Phase 5.5
- Phase 5.6
- Phase 5.75

## Borrow Targets

### Editor And Build Handoff

Look for:
- engine/editor separation
- build/runtime handoff boundaries
- property-grid and inspector workflow patterns

Borrow:
- clean separation between authoring tools and runtime payloads
- asset compiler and build-graph concepts
- authoring-surface patterns that map well to inspector/details UI

Adapt for Shader Forge:
- keep C++ and browser-shell-led workflow
- translate ideas rather than mirroring managed-runtime APIs

Do not borrow as-is:
- managed-runtime assumptions
- package and build-system choices that do not fit the current stack

### Data And Asset Pipeline

Borrow:
- clear offline compile stages
- runtime-consumable output discipline
