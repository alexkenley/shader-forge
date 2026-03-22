# Engine VFX Spec

## Purpose

The VFX layer handles real-time visual effects such as particles, trails, impacts, pulses, decals, and effect-driven rendering hooks.

## Framework Decision

Recommended direction:

- Effekseer integration for authored particle/effect content
- engine-owned simple effect descriptors for code-first effects

## Responsibilities

- impact and environment effects
- trails and bursts
- parameter-driven effect playback
- engine/runtime integration for effect spawning and control

