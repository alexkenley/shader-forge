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

## Core Technical Direction

- renderer: Vulkan-first
- platform layer: SDL3
- language/build: C++23 + CMake
- scene model: ECS-style runtime
- asset model: source assets plus cooked runtime assets
- runtime debugging: in-engine overlays and structured logs
- AI integration: optional local control layer over files, CLI, and runtime APIs

OpenGL is useful for isolated prototypes or teaching, but not as a full production backend in v1.

## Shell Experience

The shell should feel like a developer IDE for a native engine:

- left rail for sessions, explorer, source control, world, and search
- center dock for `Code`, `Game`, `Scene`, and `Preview`
- right panel for `Details`, `Assets`, `Inspector`, `Build`, `Run`, and `Profiler`
- bottom panel for `Terminal`, `Logs`, `Output`, and `Console`

The shell is not the runtime. The runtime remains a separate native process.

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

## Immediate Recommendation

Build order:

1. engine shell scaffold
2. session backend and CLI
3. native runtime bring-up
4. viewer bridge
5. asset pipeline and procedural geometry systems

This gets Shader Forge to a usable development loop quickly while keeping the architecture reusable.

