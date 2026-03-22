# Save System Borrow Guide

Date: 2026-03-22

## Purpose

Capture the best references for Shader Forge's runtime save, load, and user-data persistence workflows.

## Recommended Reference Set

### 1. Godot

Repository:
- `https://github.com/godotengine/godot`

Reference docs:
- `https://docs.godotengine.org/en/4.3/tutorials/io/saving_games.html`

Borrow:
- explicit persistent-object model
- distinction between simple JSON saves and binary serialization
- practical save/load workflow examples

### 2. Fyrox

Repository:
- `https://github.com/FyroxEngine/Fyrox`

Reference docs:
- `https://fyrox-book.github.io/serialization/index.html`

Borrow:
- scene-diff save concepts
- serializer-driven save/load workflow
- explicit additional-data handling

### 3. O3DE Save Data Gem

Repository:
- `https://github.com/o3de/o3de`

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/gems/reference/utility/save-data/`

Borrow:
- platform-agnostic save-data service boundary
- clean split between persistence transport and game serialization format

## Recommended Shader Forge Direction

- keep authored scene and prefab data separate from save-game data
- use explicit save contracts and versioned runtime payloads
- borrow persistent-object concepts from Godot
- borrow serializer discipline from Fyrox
- borrow platform-facing save service boundaries from O3DE

## Explicit Non-Goals

- treating save data as the same thing as authored content
- hiding save/load logic behind a single opaque blob with no migration path
