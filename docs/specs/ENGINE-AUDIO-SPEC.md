# Engine Audio Spec

## Purpose

The audio system owns sound playback, mixing, routing, spatialization, music, voice, ambient playback, and the authoring/runtime bridge for audio content.

It exists so Shader Forge projects can define, preview, control, and automate audio inside the engine rather than treating external tools as the only usable authoring path.

## Core Principles

- authored audio behavior must be controllable through code and text assets
- humans and AI should be able to modify the same sound definitions, bus routing, and playback metadata
- the initial runtime backend should stay small, explicit, and easy to debug
- raw source media, authored playback definitions, and cooked runtime data should remain separate
- animation, gameplay, UI, and runtime events should trigger audio through explicit engine-facing APIs rather than ad-hoc direct file playback

## Implementation Direction

Initial implementation direction:

- backend: `miniaudio`-backed engine subsystem
- authoring and mixer reference model: Godot-style buses and effects
- runtime feature-shape references: Fyrox and Stride
- architectural boundary reference: O3DE, without copying its full abstraction stack

This is a direction, not a requirement to mirror any external engine API exactly.

## Authoring Model

Primary authored artifacts should be text-backed.

Recommended first artifacts:

- `audio/buses.toml`
- `audio/sounds/<name>.sound.toml`
- `audio/events/<name>.audio-event.toml`

Expected source inputs:

- `.wav`
- `.ogg`
- `.flac`
- `.mp3`

Authoring rules:

- source media files remain import inputs, not the full source of truth for playback behavior
- bus assignment, volume defaults, looping, spatial settings, streaming policy, and event bindings live in text assets
- gameplay code should trigger named audio events or sound definitions rather than hardcoding random file paths
- shell, CLI, and future native tools should be able to preview and inspect those same assets

## Responsibilities

- one-shot and looped playback
- music, ambience, UI, voice, and SFX routing
- 2D and 3D playback
- listener management
- distance attenuation and panning
- per-bus volume, mute, and effect chain control
- streaming for large assets and buffered playback for small assets
- playback events, fades, and stop/restart control
- animation and gameplay event hooks for audio triggers
- deterministic cook metadata for runtime loading

## Initial Runtime Scope

The first useful engine audio slice should include:

- one active listener
- named buses: `Master`, `Music`, `SFX`, `Voice`, and `Ambience`
- sound definitions backed by imported media files
- named audio events that map to sound playback requests
- 2D playback
- simple 3D playback with attenuation
- loop, pause, stop, and fade controls
- streaming toggle for long-running assets like music and ambience
- runtime logging and failure reporting for missing assets or bad playback requests

## Later Scope

Later audio work should add:

- multiple listeners only if a real use case appears
- send buses and reverb zones
- ducking and sidechain-style control
- richer DSP and effect chains
- optional HRTF path for higher-fidelity spatial audio
- timeline-aware synchronization with gameplay and animation
- waveform preview, meters, and live bus inspection in tools
- capture, profiling, and automated audio validation harnesses

## Runtime Model

The runtime should expose a narrow engine-owned audio API.

Example responsibilities:

- play a named event
- play a named sound definition
- stop an instance, event group, or bus
- set bus volume or mute state
- attach an emitter to an entity or world position
- update listener pose from camera or gameplay logic
- receive animation motion-event triggers

The audio system should not require gameplay code to know backend-specific decoder or mixer details.

## Data And Cook Path

Source path:

- raw media under project content roots
- text-backed audio metadata under `audio/`

Cook path:

- validate authored sound and bus definitions
- resolve source-media references
- generate runtime-ready metadata tables
- emit cooked audio registry data and any stream/cache metadata required by the runtime

SQLite may track indexing, import state, and preview metadata, but not replace text-backed authored source assets.

## Tooling And Editor Surfaces

Expected tooling surfaces:

- sound preview from the shell and future native tools
- bus routing inspection
- per-sound metadata editing
- event trigger testing
- listener/emitter visualization for 3D debugging
- later waveform and meter surfaces

These tools should round-trip to text assets and explicit runtime APIs.

## AI Integration

The coding assistant and future engine AI workflows should be able to:

- create or edit sound definitions
- create or edit audio events
- adjust bus routing and default levels
- add animation or gameplay event hooks that trigger named audio events
- run deterministic preview or validation harnesses where possible

The assistant should not directly rewrite opaque binary middleware projects as the main authoring path.

## Phase Alignment

- Phase 5.5 establishes data, cook, and storage foundations the audio system depends on
- Phase 5.7 introduces the engine audio subsystem
- Phase 5.75 and later authoring work should expose audio preview and event wiring
- Phase 6 integrates audio deeply with gameplay, animation, runtime tools, and hot reload

## Non-Goals

- requiring Wwise or FMOD for the first engine audio slice
- building a DAW or music-production environment inside Shader Forge
- making audio authoring depend on opaque external project formats
- adding a giant abstraction layer before a working engine audio path exists
- blocking initial audio bring-up on advanced HRTF, convolution reverb, or cinematic tooling
