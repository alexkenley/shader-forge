# Engine Level Editor Spec

## Purpose

The level editor is the pre-runtime world-authoring workflow for Shader Forge.

It exists so both humans and AI can modify levels, actors, prefabs, transforms, and component values without requiring scene changes to be hand-written in C++.

## Source Of Truth

The level editor must round-trip to text-backed scene assets.

Rules:

- authored levels are stored as deterministic text assets
- prefab instances and actor/component values are saved back to those assets
- visual edits do not try to rewrite arbitrary C++ source files
- runtime play-state changes are not the default persistent source of truth

## Authoring Model

The editing model should support three equal paths:

- direct UI editing through viewport, outliner, and details panels
- direct text editing of scene and prefab assets
- AI-driven editing through files, CLI commands, or structured runtime/session APIs

All three paths must converge on the same saved scene/prefab formats.

## Editing Modes

- `Edit`: persistent authoring mode for changing a world or reusable object
- `Verify`: read-only inspection mode; switching between Edit and Verify preserves the current draft
- `Simulate In Editor`: future mode for testing without leaving the editing context

## Current Implemented Slice

The first real level-authoring slice now lives in the shell `World` workspace.

Current implemented behavior:

- the shell loads `content/scenes/*.scene.toml` and `content/prefabs/*.prefab.toml` from the active session root
- `Edit` is the persistent authoring lane and `Verify` provides read-only inspection without discarding the current draft
- authored scenes can now round-trip deterministic `[entity.<id>]` sections with `source_prefab`, `parent`, `position`, `rotation`, and `scale`
- the visible workflow uses plain `World`, `Object`, `Selection`, and `Library` language while retaining scene, entity, and prefab terms in the source format
- prefab assets can now round-trip first-pass `[component.render]` and `[component.effect]` sections for procgeo/effect-driven component payloads
- a details surface can edit current scene metadata, placed-entity transform/source-prefab/parent data, prefab metadata, and the first prefab component payload fields
- an asset browser can inspect prefabs, assign the scene primary prefab, and instantiate prefab-backed entities into the active scene
- save, reload-from-disk, revert-draft, duplicate-scene, create-entity, duplicate-entity, delete-entity, and local undo/redo flows now exist for this first authoring slice
- `Play` saves the current world or reusable-object draft before building and launching the native runtime
- `Apply and restart` saves tuning changes and restarts the running game in one action
- low-level build, runtime, and bridge information is collapsed under diagnostics instead of filling the default authoring surface
- the World workspace remains mounted during ordinary shell navigation so local drafts survive moving between workspaces

Current boundary:

- viewport gizmos, in-viewport manipulation, deeper scene/component payload editing, and procedural bake-back are still ahead
- this slice is intentionally honest about being shell-side authoring over current text assets, not a fake full visual editor
- World saves still use raw file writes; migration to revision-bound semantic operations is pending

## Core Surfaces

- world viewport with translate/rotate/scale gizmos
- `World` and `Objects` hierarchy surfaces
- `Selection` inspector for tuning values
- `Library` browser for reusable objects
- placement controls for assets, prefabs, lights, volumes, and spawn points
- save, reload, revert, and duplicate commands
- undo and redo

## Persistence Model

Primary authored assets:

- `content/scenes/<name>.scene.toml`
- `content/prefabs/<name>.prefab.toml`

Expected properties:

- deterministic field ordering where practical
- stable identifiers for entities and prefab references
- explicit component payloads
- clear separation between authored source assets and cooked runtime output

## Procedural And Bake Workflow

Procedural generators should be able to:

- preview generated content live in the editor
- bake generated output into editable scene assets
- bake generated output into reusable prefabs
- regenerate selected subtrees without replacing unrelated manual edits

This is a required workflow, not a nice-to-have. Code-defined world generation must be tunable by hand afterward.

## AI Integration

The level editor should expose structured operations for assistant-driven editing.

Examples:

- `open_scene`
- `save_scene`
- `create_entity`
- `duplicate_entity`
- `delete_entity`
- `set_transform`
- `set_component_value`
- `instantiate_prefab`
- `bake_generator_to_scene`

## Non-Goals

- forcing all level authoring through C++ source code
- treating raw runtime state as the only source of persistent edits
- storing authored levels only in opaque editor-specific binary blobs
- trying to infer and rewrite arbitrary gameplay code from viewport edits
