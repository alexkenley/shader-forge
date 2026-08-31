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

The current implementation now spans the Phase 5.6 foundation, a first real Phase 5.8 conversion slice, and a first explicit Phase 5.85 Unreal offline fallback lane.

Implemented now:

- `engine migrate detect <path>`
- `engine migrate unity <path>`
- `engine migrate unreal <path>`
- `engine migrate godot <path>`
- `engine migrate report <path>`
- normalized `migration-manifest.toml`, `report.toml`, and `warnings.toml` outputs under `migration/<run-id>/`
- `engine migrate detect` remains detect/report only and still writes a `script-porting/README.md` placeholder
- `engine migrate unity|godot` now emit a self-contained `shader-forge-project/` skeleton under each run root
- `engine migrate unreal` now marks the active lane as `unreal_offline_fallback`, emits the same target-project skeleton shape, and records lower conversion confidence instead of pretending exporter-assisted parity
- the current fixture lanes now generate first-pass `content/scenes/migrated/<engine>/*.scene.toml`, `content/prefabs/migrated/<engine>/*.prefab.toml`, and `content/data/migrated/<engine>/runtime_bootstrap.data.toml`
- startup-scene translation is implemented for Unity's first enabled `EditorBuildSettings` scene, Unreal's `GameDefaultMap`, and Godot's `res://` `run/main_scene`
- startup-scene settings resolve against exact source-project-relative scene records; duplicate scene basenames receive deterministic path-derived target names so the bootstrap remains unambiguous
- a declared startup scene that cannot be resolved is fail-closed: no plausible-looking bootstrap is emitted, the setting is marked `skipped`, and the report carries a manual task
- when no startup scene is declared, the first source-relative converted scene is selected deterministically and the setting is marked `approximated`
- manifest and report output includes `[startup_scene]` source/target provenance plus converted, approximated, and skipped project-setting counts
- Unity text-YAML scenes now map active `GameObject` plus `Transform`/`RectTransform` documents into parent-linked scene entities and scene-owned prefabs, preserving source file IDs and local position/quaternion rotation/scale provenance; `m_IsActive: 0` objects and their hierarchy subtrees fail closed, while enabled valid perspective `Camera` optics and enabled valid non-trigger `BoxCollider` center/size geometry map into the existing strict prefab components
- Godot text scenes now map every declared node into a parent-linked scene entity, carry explicit `Vector3` position/rotation/scale into Shader Forge transforms, derive prefab spawn tags from source node types, preserve source paths/types as generated comments, and map valid explicit perspective `Camera3D` optics plus enabled non-`Area3D` `CollisionShape3D`-referenced `BoxShape3D` geometry into strict prefab components; explicitly disabled and `Area3D` trigger collision shapes fail closed
- migration manifests and reports include `mapped_scene_entities`, `mapped_prefab_components`, and `mapped_script_bindings`; normalized Unity and Godot object-name collisions receive deterministic source-derived target names instead of overwriting output
- pinned engine lanes now emit first-pass script porting manifests under `migration/<run-id>/script-porting/*.port.toml`
- Unity `MonoBehaviour` records now resolve script GUIDs through `.cs.meta` files and emit per-component binding manifests with source scene, node path, GameObject file ID, component file ID, and resolution confidence; C# behavior and serialized fields remain manual
- Godot node script `ExtResource` references now resolve `res://` project paths and emit per-node binding manifests with source scene, node path, resource ID/path, and resolution confidence; GDScript behavior and node fields remain manual
- the Unreal offline fallback now derives scene/prefab/script outputs from `.uproject`, `.umap`, `.uasset` package names, and C++ class symbols when no exporter-assisted data is available
- deterministic Unity, Unreal, Unreal offline fallback, and Godot fixture projects under `fixtures/migration/`

Current boundaries:

- source-engine detection is real for the first supported lanes
- target layout intent and provenance are captured in the emitted manifest/report files
- engine-specific lanes now perform a real first conversion pass, but only to project skeleton depth rather than full parity
- generated scenes, prefabs, and script manifests are first-pass approximations based on minimal fixture/source inspection; Unity and Godot text-scene hierarchy plus explicit local transforms are mapped, but full source-engine graph extraction is not
- binary Godot `.scn` files retain reviewable placeholder output but are not counted as mapped scene entities
- project-setting support is currently limited to startup-scene selection; other engine settings remain manual even when detection finds them
- `asset_conversion` remains `Manual`: placeholder asset directories are not payload import, conversion, or runtime fidelity
- the Unreal lane is currently explicit about its fallback status: Blueprint package outputs are low-confidence manifests derived from package names rather than parsed graphs
- art assets, materials, animation, audio, Unity prefab instances/other components/disabled camera and collider preservation/orthographic cameras/trigger-layer-material collider semantics/coordinate-system remediation, Unreal hierarchy extraction, Godot transform matrices/resource instances/other component payloads/camera enabled-current semantics/physics-body-disabled-collider-preservation/layer/material semantics, exported Unreal actor data, and real exporter-manifest ingestion are still ahead

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

Current implemented slice:

- parse active text-YAML `GameObject`, `Transform`, and `RectTransform` documents from `.unity` scenes while omitting `m_IsActive: 0` hierarchy subtrees
- preserve source file IDs, parent hierarchy, and local position/rotation/scale in generated scene entities and scene-owned placeholder prefabs
- normalize source quaternions into deterministic Euler-degree output for reviewable generated records
- map enabled valid perspective `Camera` field-of-view and near/far clip values into `[component.camera]` while retaining the source component ID
- map enabled valid non-trigger `BoxCollider` center and size into `[component.collision]` box geometry with identity collider-local rotation while retaining the source component ID; trigger colliders fail closed because the target component has no trigger state
- resolve `MonoBehaviour` script GUIDs through `.cs.meta` files and emit binding-specific script-porting provenance without claiming behavior conversion
- leave prefab instances, other serialized component payloads, disabled camera/collider and trigger-collider preservation, orthographic cameras, layer/material collider semantics, source assets, runtime physics consumption, and coordinate-system remediation explicit manual work

### Unreal Engine

Preferred approach:

- use exporter/plugin-assisted paths instead of relying only on raw `.uasset` parsing
- export supported assets, levels, materials, and metadata into normalized manifests
- map exported levels and actor placements into Shader Forge scene assets
- surface unsupported Blueprint/material features explicitly in the migration report

Fallback widening still ahead:

- harden the raw-project offline fallback for cases where Unreal cannot be run
- treat offline Blueprint parsing as a lower-confidence lane until a real parser with fixture coverage exists
- keep Blueprint-heavy projects primarily on the exporter-assisted path

Current implemented fallback:

- `engine migrate unreal` now records the active lane as `unreal_offline_fallback` whenever exporter-assisted data is unavailable in the current slice
- offline fallback scene and prefab outputs are derived from `.umap` names, Blueprint-like `.uasset` package names, and C++ class symbols
- Blueprint-like packages currently emit low-confidence script-porting manifests instead of parsed graph data
- migration reports now call out the fallback lane, lower conversion confidence, and manual follow-up explicitly

### Godot

Preferred approach:

- parse text-backed project and scene files directly where practical
- import art assets and scene trees
- translate node/component patterns into Shader Forge entities/components

Current implemented pass:

- `.tscn` node headers map to stable scene entities and generated prefabs with parent links
- explicit `Vector3` position, rotation, and scale fields map to Shader Forge transforms; rotation is converted from radians to degrees
- valid explicit perspective `Camera3D` `fov`, `near`, and `far` values map into `[component.camera]`
- enabled `CollisionShape3D` nodes outside `Area3D` that reference valid `BoxShape3D` subresources map size into `[component.collision]`; the node transform preserves the collider offset/orientation, while `disabled = true` and direct `Area3D` trigger shapes fail closed
- node script `ExtResource` references resolve safe `res://` paths into binding-specific script-porting provenance
- generated scene and prefab comments retain source node paths and node types for review
- binary `.scn` files retain the existing placeholder path; their serialized contents are not parsed
- matrices, instanced resources, other component payloads, script behavior/fields, camera enabled/current semantics, and physics-body/disabled-or-trigger-collider-preservation/layer/material semantics remain manual and are reported as such

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
- mapped scene-entity, prefab-component, and script-binding counts
- manual tasks remaining
- setting-level source file, source key/value, resolved source-relative path, target file/key/value, status, and reason for startup-scene translation

The project-setting counts are separate from generated-file counts. A startup setting is exactly one of `converted`, `approximated`, or `skipped`; an explicit unresolved value must never silently fall back to another scene.

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

- Unity fixture migration smoke, including enabled build-scene selection, duplicate-basename disambiguation, text-YAML hierarchy/local transforms, source file IDs, enabled perspective Camera optics, enabled non-trigger BoxCollider geometry, disabled/trigger component rejection, MonoBehaviour-to-`.cs.meta` GUID binding provenance, and production-bakeable generated prefabs
- Unreal offline fallback migration smoke, including `GameDefaultMap` binding for both C++ and package-only fixtures
- Godot text-scene migration smoke, including exact startup and node-script `res://` binding, explicit perspective Camera3D optics, enabled non-Area3D CollisionShape3D/BoxShape3D geometry, disabled/Area3D-trigger collision rejection, explicit-unresolved fail-closed behavior, and no-declaration approximation
- migration manifest/report provenance and project-setting count validation
- production asset-pipeline bake validation for the generated scene, prefab, and optional runtime-bootstrap records

An Unreal exporter-manifest migration smoke remains required when real exporter-manifest ingestion lands; the current lane only detects exporter evidence and otherwise performs the explicit offline fallback.

## Non-Goals

- claiming perfect one-click conversion for every source project
- promising binary compatibility with source-engine runtime features
- preserving source-engine editors as part of the target project
- hiding unsupported features instead of reporting them
