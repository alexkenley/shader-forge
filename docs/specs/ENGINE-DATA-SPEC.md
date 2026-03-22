# Engine Data Spec

## Purpose

The data layer defines how source data is authored, validated, cooked, queried, and stored across the engine.

## Framework Decision

Recommended split:

- source data: TOML via `toml++`
- cooked runtime data: FlatBuffers
- tooling/session/asset database: SQLite

## Responsibilities

- readable source configuration and gameplay data
- readable source scene and prefab data
- schema validation and versioning
- cooking source data into runtime-ready binary form
- storing tool/session/index state
