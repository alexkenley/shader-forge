# Engine Save System Spec

## Purpose

The save system owns runtime persistence for player progress, checkpoints, world-state deltas, settings, and other non-authoring data.

It exists so Shader Forge clearly separates authored source assets from runtime save data.

## Core Principles

- save-game data is not the same thing as authored scene or prefab source data
- save formats must be explicit, versioned, and migration-aware
- games should control what is persistent through explicit save contracts
- saves must be testable and inspectable through engine APIs and tooling

## Responsibilities

- save slots and metadata
- runtime world-state persistence
- player and profile persistence
- settings persistence
- save/load versioning and migration
- deterministic validation harnesses

## Implementation Direction

Recommended split:

- authored source remains text-backed under content roots
- runtime saves use explicit save payload formats, with optional JSON for simple cases and binary for larger state
- user settings may use a simpler config path than save-game payloads

## Current First Slice

The current first slice in the repo is an engine-owned runtime save lane rather than a full gameplay save stack.

Implemented now:

- `engine_runtime` owns a native `SaveSystem` subsystem instead of mixing save logic into authored asset writes
- the first slot is a deterministic quick-save payload at `saved/runtime/quickslot_01.runtime-save.toml`
- the payload is versioned through explicit schema fields and keeps runtime persistence separate from authored `content/` assets
- shell/sessiond launch and `engine run` now forward a `--save-root` path so saves stay scoped to the active session or project root
- `F8` triggers `save_runtime_state` and `F9` triggers `load_runtime_state` through the engine-owned input system
- the current snapshot captures active scene name, controlled-entity identity, transform state, animation graph/state context, and triggered overlap-body state for manual runtime iteration
- the current save payload is intentionally text-backed and inspectable so terminal assistants, shell tooling, and future native assistants can reason about the same runtime persistence format

Current boundary:

- this is still a first quick-save lane, not the final save-game architecture
- broader world-state deltas, profile/settings persistence, multiple slots, and save migration tooling are still ahead
- gameplay-facing save contracts still need to widen beyond the current runtime-owned controlled-entity snapshot

## Non-Goals

- treating live runtime state as the authored source of truth
- forcing every game to use one monolithic binary save blob
