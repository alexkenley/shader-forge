# Engine Animation Spec

## Purpose

The animation system owns skeleton definitions, clip playback, blend graphs, state machines, root motion, animation events, and procedural animation layers.

It exists so Shader Forge projects can author and iterate on animation behavior natively inside the engine and through text/code workflows rather than requiring Blender as the primary authoring surface.

## Core Principles

- Blender or any other DCC tool should be optional import input, not a required animation workflow
- authored animation behavior must be representable in text assets and explicit runtime APIs
- humans and AI should be able to inspect and modify the same animation definitions
- low-level sampling and blending should stay engine-owned and deterministic
- animation events must integrate cleanly with gameplay, audio, VFX, and runtime state
- native procedural animation should be a first-class layer, not a bolt-on afterthought

## Implementation Direction

Initial implementation direction:

- low-level runtime shape: `ozz-animation`-style skeleton sampling and blending
- engine-sized animation system reference: Fyrox-style animation state machines
- authoring/control reference: Godot-style tracks, graph control, and event concepts
- long-term feature checklist: O3DE EMotionFX

This is a reference direction, not a requirement to mirror any external API or asset format exactly.

## Authoring Model

Primary authored artifacts should be text-backed and assistant-editable.

Recommended first artifacts:

- `animation/skeletons/<name>.skeleton.toml`
- `animation/clips/<name>.anim.toml`
- `animation/graphs/<name>.animgraph.toml`
- `animation/masks/<name>.mask.toml`
- `animation/attachments/<name>.attachment.toml` once spatial authoring is implemented

Authoring rules:

- animation clips, graph states, transitions, events, masks, and procedural-layer settings live in text assets
- gameplay code should drive graph parameters and named animation events rather than hardcoding opaque animation state
- shell, CLI, and future native tools should be able to preview and inspect the same assets
- later spatial attachment edits must use the same assets through `engine_sessiond` operations rather than a private editor or MCP write path
- imported clips may exist, but imported data must be editable, overridable, or replaceable inside Shader Forge
- native code or structured CLI flows should be able to generate repetitive graph setup and procedural layers

## Responsibilities

- skeleton definition and runtime pose evaluation
- clip sampling and playback
- blend graphs and state machines
- additive and layered blending
- partial-body masking
- root motion extraction and application hooks
- animation events and notifies
- procedural layers such as look-at, aim, IK, or recoil correction
- skeleton sockets and attachment-profile evaluation once spatial authoring lands
- runtime graph-parameter control
- deterministic cook metadata for runtime loading

## Initial Runtime Scope

The first useful engine animation slice should include:

- one skeleton asset format
- one clip asset format
- one animation-graph asset format
- clip playback and looping
- graph parameters controlled from code
- animation events
- root motion extraction
- one procedural correction layer such as look-at or simple IK
- runtime logging and failure reporting for missing or invalid animation assets

## Current First Slice

The current Phase 5.72 slice now exists as a first engine-owned animation foundation:

- `animation/skeletons/*.skeleton.toml` is the first authored skeleton lane
- `animation/clips/*.anim.toml` is the first authored clip lane
- `animation/graphs/*.animgraph.toml` is the first authored graph lane
- the native runtime now loads those authored assets through `AnimationSystem` before startup continues
- skeleton, clip, graph, and graph-state relationships are validated at runtime rather than left as implied future structure
- clip events are now validated as named `marker`, `audio_event`, or `vfx_event` hooks
- runtime startup now resolves a default animation graph, logs the graph/state/event catalog, and routes entry-clip `audio_event` hooks through the engine-owned audio-event API
- named graph states can now be resolved directly at runtime, which gives Phase 6 a first movement-driven `idle`/`walk` state-selection lane instead of leaving authored states unused after startup
- walk clip `audio_event` hooks can now fire during movement-driven runtime playback, so authored clip events are no longer limited to the graph entry state
- `engine run` now forwards `--animation-root`
- `engine bake` now scans the animation root and stages cooked skeleton, clip, and graph metadata under `build/cooked/animation/`
- deterministic harness coverage now exists for the authored animation assets, runtime integration hooks, and staged animation cook lane
- `AnimationSystem` now preserves v1 skeleton loading while also strictly parsing and validating v2 skeleton hierarchies, roles, socket frames, and canonical quaternions
- schema-v1 clips remain compatible, while schema-v2 clips can author strict per-bone normalized-time translation/quaternion keyframes against v2 skeletons
- `AnimationSystem::sampleClipPose` deterministically samples schema-v2 clips with linear translation, shortest-path normalized quaternion interpolation, rest-local fallback for untracked bones, stable skeleton order, parent-composed world transforms, and no root-motion accumulation
- compatible v1 plus strict v2 attachment profiles now parse and validate primary grips, contact/handle frames, two-hand targets, item-space poles and tolerances, semantic secondary-arm/palm capability, motion-envelope samples, skeleton/socket references, and same-skeleton clip references
- generation-tagged skeleton, bone, socket, and attachment handles invalidate after a successful reload; a failed reload retains the prior valid generation and snapshots
- animation source paths and file bytes must be valid UTF-8 before a successful load can commit a new generation; source files sort by explicit UTF-8 keys for cross-platform handle and cooked-table stability
- isolated humanoid and rifle/pistol fixtures plus `npm run test:spatial-authoring-scaffold` provide an executable native WSL validation lane without entering normal authored or cooked roots
- `shader_forge_spatial validate --animation-root <path>` reuses `AnimationSystem::loadFromDisk` and emits deterministic JSON counts and stable skeleton/profile metadata; `shader_forge_spatial cook` reuses that validated snapshot to atomically stage complete socket/profile tables at `<output-root>/animation/spatial-authoring.bin`; `evaluate-rest` composes unsolved rest-pose attachment geometry; and `evaluate-sample` composes deterministic sampled geometry plus v2 two-bone secondary-hand IK at an exact authored envelope phase/time. The CLI exposes all four already-built commands without a daemon or auto-build.
- The rest evaluator is a schematic query, not clip sampling or rendered review evidence: `pose.sampled=false`; item mesh geometry plus solved IK, joint-limit, and clipping diagnostics are unavailable. V1 pole world space remains unresolved; v2 item-space poles resolve to world coordinates and can be projected by the Assets schematic.

This is still a widening slice, not the final animation runtime. The normal authored/runtime lane remains the compatible v1 `debug_humanoid` metadata path. V2 spatial assets currently live only in fixtures. The explicit spatial cooker emits derived metadata but is not integrated with generic `engine bake` or runtime loading. The native sampler feeds a read-only sampled attachment evaluator with deterministic v2 two-bone IK and exact reach/contact/angular diagnostics, but sampled output is not yet consumed by runtime graph playback, sessiond, MCP, or the shell. Prefab existence validation, joint-limit and diagnostic-capsule parsing, blending, attachment rendering, review capture, operation-scoped validation/recapture, and native preview tooling remain deferred; attachment mutation operations and their first `sf-mcp` adapter are implemented.

## Later Scope

Later animation work should add:

- retargeting
- mirroring
- richer blend spaces
- motion matching only if there is a concrete project need
- native rig editing and skeleton construction tools
- keyframe/timeline editing UI
- animation debugging overlays, scrubbers, and per-bone inspection
- tighter shell/native-tool preview and edit workflows
- sampled sessiond/shell evidence, joint/clipping diagnostics, and spatial review packets on top of the implemented v2 sampled two-bone IK evaluator, as specified in [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md)

## Runtime Model

The runtime should expose a narrow engine-owned animation API.

Example responsibilities:

- play or stop a named graph or clip
- set graph parameters
- query animation state
- consume root motion
- receive animation events
- attach procedural layers to entities or rigs
- bind animation events to audio, VFX, and gameplay hooks

Gameplay code should not need to know sampling backend details.

## Data And Cook Path

Source path:

- text-backed animation assets under `animation/`
- optional imported animation sources under project content roots
- optional project attachment profiles under `animation/attachments/`; current validation profiles remain isolated under `animation/fixtures/spatial/attachments/`

Cook path:

- validate skeletons, clips, graphs, masks, and event bindings
- resolve clip and skeleton references
- emit cooked runtime animation tables and clip data
- preserve deterministic identifiers for states, parameters, and events
- integrate the implemented explicit socket/profile cooker with generic `engine bake` and later runtime consumption; generated spatial reviews stay under `build/spatial-reviews/` and are not authored source

SQLite may track indexing and preview metadata, but not replace text-backed authored animation assets.

## Tooling And Editor Surfaces

Expected tooling surfaces:

- clip and graph preview from the shell and future native tools
- graph-parameter inspection and override
- event timeline inspection
- root-motion preview
- later keyframe and transition editing surfaces
- runtime pose and blend-debug views

These tools should round-trip to text assets and explicit runtime APIs.

## AI And CLI Integration

The coding assistant and CLI workflows should be able to:

- create or edit skeleton assets
- create or edit clips and graph definitions
- add, remove, or tune graph states and transitions
- wire animation events to gameplay, audio, or VFX hooks
- generate procedural animation layers or graph patches from structured inputs
- run deterministic preview or validation harnesses where possible

The animation system should expose structured operations through CLI and future `engine_sessiond` APIs rather than forcing AI edits through opaque UI-only flows.

## Phase Alignment

- Phase 5.5 establishes the text-data and cook foundations animation depends on
- Phase 5.72 introduces the engine animation subsystem
- Phase 5.73 now has its native schema/query/cook/rest-schematic slice, deterministic clip sampling, compatible v1 pre-IK output, v2 sampled two-bone IK, and attachment mutation operations; the visual evidence workflow still depends on sampled sessiond/shell evidence, item rendering, joint/clipping diagnostics, and capture work
- Phase 5.75 and later authoring work should expose animation preview and asset editing, but broad World/Assets visual polish must not invent a second attachment-truth path
- Phase 6 integrates animation deeply with gameplay, audio, VFX, and runtime tools

## Non-Goals

- requiring Blender for core animation iteration
- forcing all animation behavior into opaque binary graph assets
- building a giant node editor before basic playback, blending, events, and procedural layers work
- blocking the first animation slice on motion matching, full retargeting, or cinematic tooling
