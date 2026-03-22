# O3DE Borrow Guide

Date: 2026-03-22

## Purpose

Use O3DE as a reference for modular tooling, project packaging, asset-processing scale, and editor/runtime separation at larger scope.

Repository:
- `https://github.com/o3de/o3de`

Primary phases:
- Phase 1
- Phase 2
- Phase 4
- Phase 5.5
- Phase 5.6
- Phase 5.75
- Phase 5.8
- Phase 5.9

## Borrow Targets

### Tooling And Project Packaging

Look at repo areas such as:
- `Gems`
- `Tools`
- `Templates`
- `Code`

Borrow:
- modular subsystem packaging concepts
- project template and project-metadata layout ideas
- clearer boundaries between runtime code, tools, and optional modules

Adapt for Shader Forge:
- keep the repo much smaller and flatter
- keep `engine_sessiond` and CLI lighter than O3DE's service graph

Do not borrow as-is:
- full build-system complexity
- the full editor dependency stack
- service layering that would overcomplicate current milestones

### Asset And Prefab Workflow

Borrow:
- asset-processing pipeline concepts
- large-toolchain change detection and processing ideas
- prefab and authoring workflow boundaries where they clarify phase design
