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

## Non-Goals

- treating live runtime state as the authored source of truth
- forcing every game to use one monolithic binary save blob
