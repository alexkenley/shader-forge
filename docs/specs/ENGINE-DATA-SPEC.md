# Engine Data Spec

## Purpose

The data layer defines how source data is authored, validated, cooked, queried, and stored across the engine.

## Framework Decision

Recommended split:

- source data: TOML via `toml++`
- cooked runtime data: FlatBuffers
- tooling/session/asset database: SQLite

## Current First Slice

The current Phase 5.5 slice locks the first engine-wide data conventions into the repo:

- `data/foundation/engine-data-layout.toml` defines the source, cooked, tooling-db, and content-root conventions
- `content/scenes/*.scene.toml`, `content/prefabs/*.prefab.toml`, `content/data/*.data.toml`, and `content/effects/*.effect.toml` are now the first real source-data roots
- `content/procgeo/*.procgeo.toml` is now the first procedural-geometry source-data root
- `audio/buses.toml`, `audio/sounds/*.sound.toml`, and `audio/events/*.audio-event.toml` are now the first dedicated authored audio-metadata roots beside `content/`
- `animation/skeletons/*.skeleton.toml`, `animation/clips/*.anim.toml`, and `animation/graphs/*.animgraph.toml` are now the first dedicated authored animation-data roots beside `content/`
- `physics/layers.toml`, `physics/materials/*.physics-material.toml`, and `physics/bodies/*.physics-body.toml` are now the first dedicated authored physics-data roots beside `content/`
- the native runtime loads that foundation manifest through `DataFoundation`, validates source assets, and logs the resulting cook plan
- scene lookup is now tied to real text assets instead of a purely free-form runtime scene name
- scene-to-prefab relationships and `runtime_bootstrap` defaults are validated across the catalog rather than treated as isolated files
- prefab component payloads can now reference `content/procgeo/*.procgeo.toml` and `content/effects/*.effect.toml` through deterministic `[component.render]` and `[component.effect]` sections
- runtime startup now resolves the active scene and overlay preference from the text-backed source assets when possible
- cooked outputs are still planning targets only in this slice, but they now target a stable `FlatBuffers` runtime-data lane under `build/cooked/`
- the current staged cook lane now also validates prefab-component references and stages prefab component payloads into cooked prefab outputs under the same deterministic authored-data workflow
- the current staged cook lane now also validates animation graph relationships and animation-to-audio event links under the same deterministic authored-data workflow
- the current staged cook lane now also validates physics layer/material/body relationships under the same deterministic authored-data workflow

## Source Ownership Rules

- scene source assets belong to the scene system
- prefab source assets belong to the scene system
- gameplay/bootstrap data assets belong to the data system
- effect descriptor assets belong to the VFX system
- procedural geometry source assets belong to the procedural geometry system
- SQLite is for tooling/session/index state, not the authored source of truth

## Responsibilities

- readable source configuration and gameplay data
- readable source scene and prefab data
- schema validation and versioning
- cooking source data into runtime-ready binary form
- storing tool/session/index state
