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
- scenes can now declare deterministic `[entity.<id>]` sections with stable ids, `source_prefab`, `parent`, `position`, `rotation`, and `scale`
- the shared data foundation validates those scene-to-prefab references
- prefab assets can now declare first-pass `[component.render]` and `[component.effect]` sections that reference authored `procgeo` and `effect` assets
- the shared data foundation now validates scene-entity prefab references plus parent relationships inside those authored scenes
- the shared data foundation now also rejects authored parent cycles before runtime composition continues
- the shared data foundation now also validates prefab-component references into the procgeo and effect catalogs
- the runtime can now resolve its selected scene against those authored scene assets, surface that choice in logs and window state, and print an authored scene-entity layout summary
- the runtime can now print referenced prefab component summaries for the active scene instead of leaving authored prefab payloads disconnected from startup diagnostics
- the runtime can now compose authored scene entities and prefab payloads into a first runtime scene snapshot with resolved world transforms, root-entity tracking, and preferred player-entity selection from prefab spawn tags
- the runtime can now project authored prefab render components into first visible debug-proxy scene rendering so composed scene content is no longer invisible during manual runtime testing
- named runtime input now drives that composed controlled entity instead of leaving authored transforms entirely passive at startup
- the shell `Scene` workspace can now open authored scene assets from the active session, inspect linked prefab assets, round-trip deterministic save/reload/duplicate flows, and edit placed-entity hierarchy, transforms, plus first-pass prefab component payloads back to those same files
- shell play/restart now hand off the active session-root project context to the runtime so authored scene files and runtime manual testing stay aligned
- `engine_sessiond` now provides safe session-root file writes so shell workflows and future assistants can mutate the same scene/prefab assets without relying on hidden editor-only state
- `engine bake` now stages scene-entity summaries plus prefab component payloads into the cooked outputs and bake report so authored scene structure is visible outside the shell

Current boundary:

- this slice now covers scene metadata, first-pass entity hierarchy plus transform editing, first prefab component payloads, a first runtime composition path, first projected debug-proxy visibility, and first session-root editor/runtime handoff, but not full rendered mesh/material instancing yet
- transform gizmos, broader scene/component payload editing, and procedural subtree bake/apply flows still remain for later widening passes

## Non-Goals

- persisting arbitrary viewport edits back into C++ source files
- relying on opaque binary editor-only scene blobs as the authoring source of truth
