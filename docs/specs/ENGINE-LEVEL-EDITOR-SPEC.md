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

- `Edit Mode`: persistent authoring mode; changes save to scene or prefab assets
- `Play Mode`: runtime simulation mode; changes are discarded unless explicitly applied
- `Simulate In Editor`: future mode for testing without leaving the editing context

## Current Implemented Slice

The first real level-authoring slice now lives in the shell `Scene` workspace.

Current implemented behavior:

- the shell loads `content/scenes/*.scene.toml` and `content/prefabs/*.prefab.toml` from the active session root
- `Edit Mode` is the persistent authoring lane
- `Play Mode` is currently a discard-only stance that drops unsaved drafts before returning to a non-persistent preview state
- a world outliner now exposes the authored scene plus its current primary prefab relationship
- a details surface can edit current scene metadata and prefab metadata
- an asset browser can inspect prefabs and assign the scene primary prefab
- save, reload-from-disk, revert-draft, duplicate-scene, and local undo/redo flows now exist for this metadata round-trip slice

Current boundary:

- viewport gizmos, placed-entity editing, transform authoring, and deeper component payload editing are still ahead
- this slice is intentionally honest about being shell-side authoring over current text assets, not a fake full visual editor

## Core Surfaces

- scene viewport with translate/rotate/scale gizmos
- `World` outliner for hierarchy and selection
- `Details` inspector for component values
- `Assets` and prefab browser
- placement controls for assets, prefabs, lights, volumes, and spawn points
- save, reload, revert, and duplicate commands
- undo and redo

## Persistence Model

Primary authored assets:

- `levels/<name>.scene.toml`
- `prefabs/<name>.prefab.toml`

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
