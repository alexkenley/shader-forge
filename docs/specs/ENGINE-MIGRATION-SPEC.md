# Engine Migration Spec

## Purpose

The migration subsystem converts existing game projects from other engines into Shader Forge projects that can continue development inside Shader Forge.

This is broader than asset import. It includes:

- project detection
- asset conversion
- scene and prefab conversion
- project setting translation
- best-effort gameplay/code translation
- migration reporting for manual follow-up

## Design Position

Shader Forge should support real project migration, but it should not pretend every source project can be converted perfectly.

Rules:

- migration is a first-class engine capability
- migration targets continued development in Shader Forge, not archival-only import
- converted projects must land in Shader Forge-native assets, scenes, prefabs, and code layouts
- every migration run must produce a report of converted, approximated, skipped, and manual items

## Current Implemented Slice

The current implementation now spans the Phase 5.6 foundation plus a first real Phase 5.8 conversion slice.

Implemented now:

- `engine migrate detect <path>`
- `engine migrate unity <path>`
- `engine migrate unreal <path>`
- `engine migrate godot <path>`
- `engine migrate report <path>`
- normalized `migration-manifest.toml`, `report.toml`, and `warnings.toml` outputs under `migration/<run-id>/`
- `engine migrate detect` remains detect/report only and still writes a `script-porting/README.md` placeholder
- `engine migrate unity|unreal|godot` now emit a self-contained `shader-forge-project/` skeleton under each run root
- the current fixture lanes now generate first-pass `content/scenes/migrated/<engine>/*.scene.toml`, `content/prefabs/migrated/<engine>/*.prefab.toml`, and `content/data/migrated/<engine>/runtime_bootstrap.data.toml`
- pinned engine lanes now emit first-pass script porting manifests under `migration/<run-id>/script-porting/*.port.toml`
- deterministic Unity, Unreal, and Godot fixture projects under `fixtures/migration/`

Current boundaries:

- source-engine detection is real for the first supported lanes
- target layout intent and provenance are captured in the emitted manifest/report files
- engine-specific lanes now perform a real first conversion pass, but only to project skeleton depth rather than full parity
- generated scenes, prefabs, and script manifests are first-pass approximations based on minimal fixture/source inspection rather than full source-engine graph extraction
- art assets, materials, animation, audio, detailed hierarchy/component graphs, and exporter-assisted Unreal actor data are still ahead

## Primary Targets

Initial engine targets:

- Unity
- Unreal Engine
- Godot

These should be treated as the first supported migration lanes.

## Support Levels

Migration support should be explicit by subsystem.

Expected support levels:

- `Supported`
  - direct conversion path exists and is covered by tests
- `BestEffort`
  - partial conversion path exists but may require manual cleanup
- `Manual`
  - detected and reported, but not converted automatically

## Migration Scope

The migration system should aim to convert:

- meshes
- textures
- materials and material parameters
- animations
- audio
- scenes and levels
- placed actors/objects
- transforms and hierarchy
- lights and cameras
- collision markers and simple physics metadata
- input mappings where practical
- tags/layers/channels where practical
- project settings that have a meaningful Shader Forge equivalent

## Gameplay Translation Scope

Gameplay conversion should be supported, but with realistic boundaries.

Recommended approach:

- convert simple scripts and behaviors to intermediate manifests first
- use AI-assisted translation for higher-level script conversion
- keep every generated gameplay translation explicit, reviewable, and report-backed

Expected support:

- Unity C# scripts: `BestEffort`
- Unreal Blueprints: `BestEffort` through exported graph/manifests or plugin-assisted export
- Unreal C++ gameplay code: `Manual` or AI-assisted porting support
- Godot scripts: `BestEffort`

The migration subsystem should never silently claim gameplay parity when it only produced scaffolding.

## Conversion Strategy

The migration pipeline should normalize source projects into an intermediate model, then emit Shader Forge-native output.

Pipeline shape:

1. detect source engine and project structure
2. collect assets, scenes, metadata, and scripts
3. export or normalize into an intermediate manifest
4. map intermediate content into Shader Forge assets and source layout
5. emit migration report and validation results

## Engine-Specific Strategy

### Unity

Preferred approach:

- parse project metadata and text-serialized assets where available
- ingest exported art content and materials
- map scenes/prefabs into `.scene.toml` and `.prefab.toml`
- convert script references into porting manifests

### Unreal Engine

Preferred approach:

- use exporter/plugin-assisted paths instead of relying only on raw `.uasset` parsing
- export supported assets, levels, materials, and metadata into normalized manifests
- map exported levels and actor placements into Shader Forge scene assets
- surface unsupported Blueprint/material features explicitly in the migration report

Later phase:

- add a raw-project offline fallback for cases where Unreal cannot be run
- treat offline Blueprint parsing as a lower-confidence lane until a real parser with fixture coverage exists
- keep Blueprint-heavy projects primarily on the exporter-assisted path

### Godot

Preferred approach:

- parse text-backed project and scene files directly where practical
- import art assets and scene trees
- translate node/component patterns into Shader Forge entities/components

## Shader Forge Output

Converted projects should land in a standard Shader Forge layout.

Expected outputs:

- `assets-src/migrated/<engine>/...`
- `assets/migrated/<engine>/...`
- `content/scenes/migrated/<engine>/*.scene.toml`
- `content/prefabs/migrated/<engine>/*.prefab.toml`
- `content/data/migrated/<engine>/*.data.toml`
- `migration/<timestamp>/report.toml`
- `migration/<timestamp>/warnings.toml`
- `migration/<timestamp>/script-porting/`

## Migration Report

Every run must emit a structured report with:

- source engine and detected version where available
- converted assets
- approximated assets
- skipped assets
- unsupported project features
- code/script translation output
- manual tasks remaining

## AI-Assisted Porting

AI assistance should be available as an optional migration accelerator.

Good uses:

- porting simple gameplay scripts
- converting behavior graphs into Shader Forge scaffolds
- generating TODO-backed replacement code
- summarizing unsupported features into actionable porting tasks

AI should not be the only migration path. Deterministic migration passes must exist for the parts that can be converted mechanically.

## Unreal Blueprint Conversion Strategy

Blueprint-heavy Unreal projects need a dedicated strategy.

Recommended support tiers:

- `Near-term`
  - Unreal-running exporter/plugin path
  - extract Blueprint graphs, variables, functions, pins, links, components, widget data, animation data, and references into a normalized migration manifest
- `Later`
  - offline raw-project fallback for `.uasset`-level parsing
  - lower-confidence best-effort extraction for cases where the Unreal editor is unavailable

Rules:

- exporter-assisted Blueprint extraction is the primary supported path for Unreal-heavy projects
- offline fallback should be treated as a later migration phase, not a v1 promise
- every Blueprint conversion run must report unsupported nodes, engine-specific systems, and manual follow-up tasks

## Shell And CLI Surfaces

Expected CLI surfaces:

- `engine migrate detect <path>`
- `engine migrate unity <path>`
- `engine migrate unreal <path>`
- `engine migrate godot <path>`
- `engine migrate report <path>`

Expected shell surfaces:

- migration wizard
- source-engine detector
- asset and scene conversion progress
- warnings and manual-fix report
- side-by-side source-to-output inspection

## Harness Requirements

The migration subsystem needs deterministic fixture-based coverage.

Required harnesses:

- Unity fixture migration smoke
- Unreal exporter-manifest migration smoke
- Godot text-scene migration smoke
- migration-report validation harness

## Non-Goals

- claiming perfect one-click conversion for every source project
- promising binary compatibility with source-engine runtime features
- preserving source-engine editors as part of the target project
- hiding unsupported features instead of reporting them
