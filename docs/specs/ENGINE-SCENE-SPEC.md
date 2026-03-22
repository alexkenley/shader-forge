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

## Non-Goals

- persisting arbitrary viewport edits back into C++ source files
- relying on opaque binary editor-only scene blobs as the authoring source of truth
