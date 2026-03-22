# Godot Borrow Guide

Date: 2026-03-22

## Purpose

Use Godot as a reference for editor/runtime boundaries, scene/resource authoring, import workflow, and large-scale engine organization.

Repository:
- `https://github.com/godotengine/godot`

Primary phases:
- Phase 1
- Phase 2
- Phase 4
- Phase 5.5
- Phase 5.6
- Phase 5.75
- Phase 5.8

## Borrow Targets

### Scene And Resource Authoring

Look at repo areas such as:
- `core`
- `scene`
- `editor`
- `servers`
- `modules`

Borrow:
- scene/resource decomposition ideas
- inspector and editor-surface ownership patterns
- import metadata and authored-resource separation

Adapt for Shader Forge:
- use TOML plus FlatBuffers instead of `.tscn` and `.tres`
- keep scene/prefab formats engine-generic and AI-editable
- keep the browser shell as the primary workspace host

Do not borrow as-is:
- the node tree as Shader Forge's required object model
- GDScript or Godot-specific editor/plugin assumptions

### Viewer And Tool Integration

Borrow:
- practical editor/runtime workflow boundaries
- save/reload/inspect expectations users already understand from mature tooling
