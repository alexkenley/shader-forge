# Audio Borrow Guide

Date: 2026-03-22

## Purpose

Capture the best open-source references for a Shader Forge audio system that stays code-first, text-backed, and engine-owned.

This guide is for borrowing architecture, authoring patterns, and feature slices. It is not a proposal to embed an entire third-party audio framework wholesale.

## Recommended Reference Set

### 1. Fyrox

Repository:
- `https://github.com/FyroxEngine/Fyrox`

Why it matters:
- dedicated `fyrox-sound` module
- practical small-engine audio architecture
- documented audio buses, effects, and optional HRTF path

Reference docs:
- `https://fyrox-book.github.io/sound/bus.html`
- `https://fyrox-book.github.io/sound/hrtf.html`

Borrow:
- compact engine-owned audio module boundaries
- bus and effect-chain shape
- sane path from simple playback to more advanced spatial audio

### 2. Godot

Repository:
- `https://github.com/godotengine/godot`

Why it matters:
- mature bus and mixer UX
- broad audio feature set for gameplay and tools
- clear split between raw clips, playback nodes, buses, and effects

Reference docs:
- `https://docs.godotengine.org/en/stable/tutorials/audio/audio_buses.html`
- `https://docs.godotengine.org/en/stable/tutorials/audio/audio_effects.html`

Borrow:
- reroutable bus model
- effect-chain concepts
- editor-facing expectations for preview and mixing
- property and event driven playback workflows

### 3. O3DE

Repository:
- `https://github.com/o3de/o3de`

Why it matters:
- clear high-level architectural separation
- Audio Translation Layer and backend swap concepts
- usable MiniAudio path without forcing proprietary middleware

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/interactivity/audio/overview/`
- `https://www.docs.o3de.org/docs/user-guide/interactivity/audio/audio-translation-layer/`
- `https://www.docs.o3de.org/docs/user-guide/components/reference/audio/mini-audio-playback/`

Borrow:
- subsystem boundary ideas
- event and component ownership patterns
- how to keep the audio runtime behind a stable engine API

Do not borrow as-is:
- heavy service layering
- full editor and gem complexity

### 4. Stride

Repository:
- `https://github.com/stride3d/stride`

Why it matters:
- practical runtime feature slice
- spatial audio and optional HRTF
- good reference for what a first useful engine audio system should expose

Reference docs:
- `https://doc.stride3d.net/latest/en/manual/audio/spatialized-audio.html`
- `https://doc.stride3d.net/latest/en/manual/audio/hrtf.html`

Borrow:
- listener/emitter feature expectations
- streamed versus buffered playback split
- practical component-facing API ideas

### 5. miniaudio

Repository:
- `https://github.com/mackron/miniaudio`

Why it matters:
- lightweight C/C++ friendly backend direction
- suitable for a first working engine-owned audio subsystem
- easier to integrate into Shader Forge than a heavyweight middleware stack

Reference docs:
- `https://miniaud.io/docs/examples/node_graph.html`

Borrow:
- backend implementation foundation
- decoder/device/playback primitives
- keep the engine API above it narrow and explicit

## Recommended Shader Forge Direction

Best fit for Shader Forge:

- implement a small `engine_audio` subsystem backed by `miniaudio`
- borrow the bus and effect-chain model primarily from Godot
- borrow module shape and small-engine practicality from Fyrox
- use O3DE only as an architectural guardrail for keeping the backend hidden behind engine APIs
- use Stride as a feature checklist for the first 3D playback slice

## First Borrow Pass

Use during the first engine audio implementation:

- define `Master`, `Music`, `SFX`, `Voice`, and `Ambience` buses
- add sound definitions and named audio events as text assets
- support 2D playback, 3D attenuation, looping, streaming, and per-bus volume
- expose audio preview through engine tools and deterministic harnesses

## Later Borrow Pass

Use when the runtime and tools are more mature:

- add send buses, reverb zones, and richer DSP
- investigate optional HRTF path
- add animation-event and gameplay-event driven audio triggering
- add audio meters, waveform preview, and bus inspection surfaces

## Explicit Non-Goals

- do not build around Wwise-first or FMOD-first workflow assumptions
- do not copy a full editor mixer UI before the runtime audio path works
- do not over-abstract the backend before a minimal shipping engine audio layer exists
