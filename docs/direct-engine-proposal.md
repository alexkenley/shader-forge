# Shader Forge Proposal

Research snapshot: 2026-03-22

## Positioning

Shader Forge is a generalized open-source game engine for building games directly in code, with a native runtime and an AI-friendly development loop.

The core position is:

- native C++ runtime
- Vulkan-first rendering
- code-first authoring
- terminal-first workflow
- browser-based shell for editing, runtime control, inspection, and asset workflows

The engine should not depend on a middleware editor as the source of truth. The source of truth is code, text assets, cooked assets, and explicit tooling.

## Product Model

Shader Forge is split into four major parts:

- `engine_runtime`
  - native C++ process
  - rendering, simulation, input, audio, physics, gameplay
- `engine_cli`
  - `engine run`, `engine build`, `engine bake`, `engine import`, `engine test`
- `engine_sessiond`
  - backend service for sessions, PTY terminals, file APIs, git APIs, runtime control, logs, and viewer bridges
- `engine_shell`
  - browser-based development shell with code, viewer, asset, details, and terminal surfaces

## Framework Stack

Shader Forge should use different frameworks for different layers instead of forcing one UI/data model across the whole engine.

Recommended stack:

- browser shell: `React + TypeScript + Vite`
- native tooling UI: `Dear ImGui` with docking
- shipped game UI: `RmlUi`
- visual effects: `Effekseer` for authored particle/effect content, plus code-defined simple effect descriptors
- source data: `TOML` via `toml++`
- cooked runtime data: `FlatBuffers`
- tooling/session/asset database: `SQLite`

## Core Technical Direction

- renderer: Vulkan-first
- platform layer: SDL3
- language/build: C++23 + CMake
- scene model: ECS-style runtime
- asset model: source assets plus cooked runtime assets
- runtime debugging: in-engine overlays and structured logs
- AI integration: optional local control layer over files, CLI, and runtime APIs
- browser shell stack: React + TypeScript + Vite
- native tooling UI: Dear ImGui
- game UI: RmlUi
- VFX path: Effekseer integration plus internal effect descriptors
- data path: TOML source, FlatBuffers cooked data, SQLite tooling DB

OpenGL is useful for isolated prototypes or teaching, but not as a full production backend in v1.

## Shell Experience

The shell should feel like a developer IDE for a native engine:

- left rail for sessions, explorer, source control, world, and search
- center dock for `Code`, `Game`, `Scene`, and `Preview`
- right panel for `Details`, `Assets`, `Inspector`, `Build`, `Run`, and `Profiler`
- bottom panel for `Terminal`, `Logs`, `Output`, and `Console`

The shell is not the runtime. The runtime remains a separate native process.

Phase 1 rule:

- keep the preserved editor behavior under `shell/engine-shell/web/` as the compatibility baseline
- build the new shell frame around it instead of rewriting the editor internals first

## Workflow

Normal loop:

1. Open the project in the shell.
2. Edit C++, shaders, assets, or procedural builders.
3. Run engine commands from the shell terminal or the `Run` panel.
4. Launch the native runtime window.
5. Inspect logs, assets, scene state, and selection details.
6. Iterate with hot reload for shaders, assets, and runtime-facing data.

On Windows, WSL2 should be the primary development shell. On Linux, the workflow should remain native.

## Procedural And AI-Native Authoring

Shader Forge should treat procedural geometry as a first-class subsystem rather than a side utility.

Strong fit areas:

- greyboxing
- modular architecture
- props and repeated environment pieces
- roads, splines, and terrain
- collision meshes
- generated asset previews

The AI workflow should be built around:

- code and text assets
- CLI commands
- structured local runtime/session APIs
- optional local-model testing through Ollama

The engine should be automation-friendly without making a built-in chat panel the center of the product.

## Visual Effects

Recommended direction:

- `Effekseer` for authored particle/effect runtime integration
- simple engine-owned effect descriptors for code-defined sparks, hits, trails, pulses, and lightweight gameplay effects
- internal graph-based effect tooling only later, after the runtime and data pipeline are stable

## Data

The data stack should be split by use case:

- source auth/data definitions: TOML files with explicit schemas and validation
- cooked runtime data: FlatBuffers for low-overhead runtime reads
- shell/session/asset indexing DB: SQLite

## Reusable AI Integration

Shader Forge should provide a reusable AI integration layer for games, but it should not force one universal AI gameplay model.

Recommended direction:

- engine-owned provider adapters for hosted and local models
- support for OpenAI, Anthropic, Gemini, and OpenAI-compatible endpoints
- optional local-first workflows through Ollama
- optional `BringYourOwnKey` desktop mode for advanced users
- request queues, timeouts, retries, budgets, caching, and structured-output validation in the engine layer
- game-specific prompts, personas, tools, and policies defined per project

Strong fit areas:

- dialogue
- social NPC behavior
- narration and quest flavor
- director-style pacing
- high-level decision support

Poor fit areas for direct model authority:

- combat resolution
- pathfinding authority
- low-level movement
- physics
- frame-critical simulation

The safest model is hybrid:

- deterministic engine/game systems remain authoritative
- AI returns constrained structured intents
- the game applies those intents through normal validated code paths

## Level Authoring

Code-first should not mean C++-only level authoring.

Recommended model:

- gameplay systems and component types are implemented in C++
- levels and prefabs are stored as editable text assets
- the shell and runtime editor surfaces modify those same scene assets directly
- procedural generators can preview content live and bake it into editable scenes or prefabs
- `Edit Mode` persists changes; `Play Mode` discards changes unless explicitly applied

This gives the project three equal authoring paths:

- direct UI editing
- direct text editing
- AI-driven editing through files and structured commands

That is a much stronger model than trying to persist viewport edits back into arbitrary C++ source.

## Project Migration

Shader Forge should support migration of existing projects from other engines so development can continue inside Shader Forge.

This should be treated as a real subsystem, not a marketing checkbox.

Primary targets:

- Unity
- Unreal Engine
- Godot

The migration goal is:

- convert assets into Shader Forge asset pipelines
- convert scenes and prefabs into Shader Forge scene/prefab assets
- translate project settings where practical
- provide best-effort gameplay/script conversion support
- produce a structured migration report for everything that needs manual follow-up

The right architecture is not direct ad hoc import from every native engine file format. It is:

1. detect the source engine
2. export or normalize into an intermediate manifest
3. convert into Shader Forge-native assets and source layout
4. report approximations, skips, and manual work

For Unreal especially, exporter/plugin-assisted flows are the realistic path for continued-development migration.

For Blueprint-heavy Unreal projects, the primary path should be exporter-assisted conversion first, with raw-project offline Blueprint parsing treated as a later fallback phase rather than the initial promise.

## Immediate Recommendation

Build order:

1. engine shell scaffold
2. session backend and CLI
3. native runtime bring-up
4. viewer bridge
5. asset pipeline and procedural geometry systems
6. level editor and scene authoring workflow
7. migration pipeline for Unity, Unreal, and Godot

This gets Shader Forge to a usable development loop quickly while keeping the architecture reusable.
