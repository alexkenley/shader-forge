# Fyrox Borrow Guide

Date: 2026-03-22

## Purpose

Use Fyrox as a more digestible reference for editor workflows, prefab handling, scene-graph authoring, and inspector/outliner interaction.

Repository:
- `https://github.com/FyroxEngine/Fyrox`

Primary phases:
- Phase 1
- Phase 4
- Phase 5.75

## Borrow Targets

### Editor Workflow And Authoring UX

Look for:
- editor interaction flow
- scene outliner and inspector coupling
- save, reload, and prefab-edit patterns

Borrow:
- practical authoring UX patterns
- prefab and scene-edit workflow ideas
- inspector details layout concepts that can inform shell and native tools

Adapt for Shader Forge:
- keep text-backed scene and prefab assets
- keep browser shell ownership for workspace orchestration

Do not borrow as-is:
- exact scene-graph semantics
- Rust/editor assumptions that do not translate cleanly to Shader Forge
