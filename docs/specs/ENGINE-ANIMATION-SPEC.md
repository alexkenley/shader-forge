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

Authoring rules:

- animation clips, graph states, transitions, events, masks, and procedural-layer settings live in text assets
- gameplay code should drive graph parameters and named animation events rather than hardcoding opaque animation state
- shell, CLI, and future native tools should be able to preview and inspect the same assets
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

This is still a widening slice, not the final animation runtime. There is not yet a real sampling/blending backend, broader graph-parameter mutation from gameplay, root-motion application, retargeting, or native preview tooling.

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

Cook path:

- validate skeletons, clips, graphs, masks, and event bindings
- resolve clip and skeleton references
- emit cooked runtime animation tables and clip data
- preserve deterministic identifiers for states, parameters, and events

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
- Phase 5.75 and later authoring work should expose animation preview and asset editing
- Phase 6 integrates animation deeply with gameplay, audio, VFX, and runtime tools

## Non-Goals

- requiring Blender for core animation iteration
- forcing all animation behavior into opaque binary graph assets
- building a giant node editor before basic playback, blending, events, and procedural layers work
- blocking the first animation slice on motion matching, full retargeting, or cinematic tooling
