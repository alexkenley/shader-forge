# Engine VFX Spec

## Purpose

The VFX layer handles real-time visual effects such as particles, trails, impacts, pulses, decals, and effect-driven rendering hooks.

## Framework Decision

Recommended direction:

- Effekseer integration for authored particle/effect content
- engine-owned simple effect descriptors for code-first effects

## Current First Slice

The first Phase 5.5 VFX slice is the descriptor and data-boundary groundwork:

- `content/effects/*.effect.toml` is now the initial authored effect-asset lane
- the repo includes a first engine-owned simple effect descriptor asset: `impact_spark.effect.toml`
- the shared data foundation validates effect metadata against the engine-wide TOML and FlatBuffers conventions
- prefab component payloads can now reference authored effect assets through first-pass `[component.effect]` sections in `.prefab.toml` source files
- effect descriptors currently declare authoring mode, runtime model, trigger, and category

Effekseer runtime integration is still a later step. The current slice records the authoring/runtime split so later integration lands on top of a stable data shape instead of inventing it ad hoc.

## Responsibilities

- impact and environment effects
- trails and bursts
- parameter-driven effect playback
- engine/runtime integration for effect spawning and control
