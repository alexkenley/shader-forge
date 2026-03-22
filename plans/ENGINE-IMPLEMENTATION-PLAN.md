# Shader Forge Implementation Plan

Date: 2026-03-22

## Goal

Build Shader Forge as a reusable open-source, code-first game engine with:

- a native Vulkan-first runtime
- a terminal-first CLI workflow
- a browser-based developer shell
- procedural geometry and code-authored world building
- AI-friendly local tooling and test harnesses

## Fixed Decisions

- renderer: Vulkan-first
- platform bootstrap: SDL3
- engine language/build: C++23 + CMake
- shell host: local web app first
- shell model: editor/viewer tabs, split layouts, PTY terminals
- primary development workflow: Windows + WSL2, with native Linux support
- runtime bring-up: native runtime window first
- source of truth: code and text assets, not opaque editor state
- engine target: reusable generalized open-source engine
- AI model: optional integration later, not the foundation

## Major Subsystems

- `engine_runtime`
- `engine_cli`
- `engine_sessiond`
- `engine_shell`
- asset pipeline
- scene/world systems
- procedural geometry
- test and harness infrastructure

## Phase 1: Engine Shell Scaffold

Goal:
- establish the browser shell as a standalone product surface

Scope:
- left navigation for sessions, explorer, source control, world, and search
- center dock tabs for `Code`, `Game`, `Scene`, and `Preview`
- right tabs for `Details`, `Assets`, `Inspector`, `Build`, `Run`, and `Profiler`
- bottom tabs for `Terminal`, `Logs`, `Output`, and `Console`
- preserve the inline file search toolbar beside `Inspect`

Exit criteria:
- shell serves locally
- shell presents the intended layout for the engine workflow
- inline file search still provides match count, `Prev`, `Next`, `Clear`, and revealed active matches

## Phase 2: Session Backend And CLI

Goal:
- stand up the backend and command surfaces the shell will rely on

Scope:
- project sessions
- file APIs
- git APIs
- PTY lifecycle
- runtime lifecycle
- log streaming
- first `engine` CLI commands

Exit criteria:
- shell talks to `engine_sessiond`
- CLI works both from the terminal and through the shell

## Phase 3: Native Runtime Bring-Up

Goal:
- get the first native runtime window running

Scope:
- window bootstrap
- Vulkan device and swapchain
- frame loop
- input and timing
- logging and error surfaces
- a basic rendered scene

Exit criteria:
- `engine run sandbox` opens a native runtime window
- runtime is stable enough to leave running during shell work

## Phase 4: Viewer Bridge

Goal:
- make the shell a useful engine workspace rather than only a code surface

Scope:
- runtime status and control
- `Game` and `Preview` tabs
- play, stop, restart, pause, screenshot
- logs in shell panels

Exit criteria:
- shell can operate the runtime without leaving the workspace

## Phase 5: Assets And Procedural Geometry

Goal:
- make the engine able to ingest and generate real content

Scope:
- source import
- cooked assets
- generated meshes
- preview surfaces
- validation and import status

Exit criteria:
- imported and generated assets flow through a single engine pipeline

## Phase 6: Game-Ready Loop

Goal:
- make the stack usable for actual game development

Scope:
- scene runtime
- transform hierarchy
- materials and shaders
- collision and physics integration
- hot reload for assets and shaders

Exit criteria:
- the engine can drive a small real project end to end

## Harness Requirement

Every major subsystem needs:

- a spec in `docs/specs/`
- a deterministic harness path
- an optional real local-model smoke lane where AI behavior is relevant

## Immediate Build Order

1. shell scaffold
2. session backend and CLI
3. native runtime
4. viewer bridge
5. assets and procedural geometry

## Current Focus

Current build target:

- clean shell scaffold
- subsystem specs
- deterministic shell harness
- optional Ollama smoke harness

