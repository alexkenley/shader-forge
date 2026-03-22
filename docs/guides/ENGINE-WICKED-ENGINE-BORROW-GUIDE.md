# Wicked Engine Borrow Guide

Date: 2026-03-22

## Purpose

Use Wicked Engine as a practical reference for a modern C++ runtime/editor split, renderer organization, and scene-system boundaries.

Repository:
- `https://github.com/turanszkij/WickedEngine`

Primary phases:
- Phase 3
- Phase 4
- Phase 6

## Borrow Targets

### Runtime And Scene Organization

Look for:
- separation between core engine code and editor-facing code
- scene/component organization
- debug and runtime visualization surfaces

Borrow:
- pragmatic scene/runtime boundaries
- renderer debug-surface patterns
- component-oriented scene editing ideas where they stay simple

Adapt for Shader Forge:
- keep the browser shell as the primary workspace
- keep text-backed authored assets instead of inheriting Wicked Engine formats

Do not borrow as-is:
- direct editor embedding assumptions
- asset-format decisions tied to Wicked Engine's pipeline

### Viewer Bridge And Iteration Flow

Look for:
- play/stop/editor interaction
- runtime inspection flows
- practical editor-to-runtime handoff patterns

Borrow:
- ways to keep runtime status visible during authoring
- practical viewport-control concepts for `Game` and `Preview` workflows
