# Scene System Spec

## Purpose

The scene system owns entities, transforms, hierarchy, serialization, and runtime scene composition.

## Authoring Model

The scene system should separate runtime state from authored source data.

Rules:

- C++ defines component types, systems, and gameplay behavior
- scene and prefab content live in text assets, not in C++ source files
- visual level-editing tools and AI automation both read and write the same asset formats
- procedural generators can preview temporary output or bake results back into editable scene assets

## Core Artifacts

- `.scene.toml` files for levels and authored scene instances
- `.prefab.toml` files for reusable placed content
- cooked FlatBuffers scene data for runtime loading

## Initial Scope

- entity identifiers
- transform graph
- component storage
- scene load/save
- prefab instancing
- deterministic text serialization
- cooked runtime scene loading
- selection surfaces for the shell
- procedural-to-scene bake support

## Current Early Foundation

Before the full scene-system phase lands, the repo now has a first authored scene lane:

- `.scene.toml` metadata is already present under `content/scenes/`
- scenes can declare a primary prefab relationship into `content/prefabs/`
- the shared data foundation validates those scene-to-prefab references
- the runtime can now resolve its selected scene against those authored scene assets and surface that choice in logs and window state
- the shell `Scene` workspace can now open authored scene assets from the active session, inspect linked prefab assets, and round-trip deterministic save, reload, duplicate, and primary-prefab edits back to those same files
- `engine_sessiond` now provides safe session-root file writes so shell workflows and future assistants can mutate the same scene/prefab assets without relying on hidden editor-only state

Current boundary:

- this slice currently round-trips scene and prefab metadata, not full entity/component hierarchy editing
- transform gizmos, broader component payload editing, and procedural subtree bake/apply flows still remain for later widening passes

## Non-Goals

- persisting arbitrary viewport edits back into C++ source files
- relying on opaque binary editor-only scene blobs as the authoring source of truth
