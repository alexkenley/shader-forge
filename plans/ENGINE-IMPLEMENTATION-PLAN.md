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
- shell framework target: React + TypeScript + Vite
- native tooling UI: Dear ImGui with docking
- shipped game UI: RmlUi
- VFX framework direction: Effekseer integration plus code-defined engine effect descriptors
- data framework direction: TOML source via `toml++`, FlatBuffers cooked data, SQLite tooling/session DB
- shell model: editor/viewer tabs, split layouts, PTY terminals
- primary development workflow: Windows + WSL2, with native Linux support
- runtime bring-up: native runtime window first
- source of truth: code and text assets, not opaque editor state
- level authoring model: text-backed scene/prefab assets with visual editing, bake-from-procedural, and edit/play separation
- AI integration model: reusable provider-backed engine service with local-model support, optional BYOK desktop workflows, and structured game-facing outputs
- migration model: real project migration for continued development via normalized manifests, not asset-only import
- engine target: reusable generalized open-source engine
- AI model: optional integration later, not the foundation

## Major Subsystems

- `engine_runtime`
- `engine_cli`
- `engine_sessiond`
- `engine_shell`
- asset pipeline
- migration subsystem
- AI subsystem
- scene/world systems
- level editor
- procedural geometry
- test and harness infrastructure

## Progress Update

Current implementation status:

- Phase 1 is substantially underway.
- Phase 2 has a working first implementation and is the main active backend surface.
- Phase 3 has been scaffolded, but the native SDL3/Vulkan window bring-up is still ahead.
- Phase 4 has started through shell-side runtime build/run controls and log surfaces, but not through a full embedded viewer.

What is already done:

- `shell/engine-shell` exists as a React + TypeScript + Vite shell scaffold.
- The preserved code workspace remains bridged under `shell/engine-shell/web/`, including the extracted Monaco inline search toolbar and related behavior.
- The shell layout has moved toward an engine-style workspace with large docked panels rather than a generic web-app layout.
- A real multi-tab PTY terminal dock is wired through `engine_sessiond` and the shell.
- Windows and Unix clean-start scripts exist in `scripts/start-dev-clean.ps1` and `scripts/start-dev-clean.sh`.
- `engine_sessiond` exists and currently provides session create/list/get/update/delete, safe file list/read, host filesystem directory listing for the session root picker, git status/init, PTY terminal lifecycle, runtime lifecycle, and build lifecycle surfaces.
- The shell already consumes those backend surfaces for session CRUD, workspace-root picking, explorer reads, source control status, terminal tabs, and runtime build/run/log controls.
- Deterministic harnesses exist for the shell, session backend, and runtime scaffold.
- A local Hell2025 reference snapshot now exists under `docs/references/hell2025/`, with a scoped borrow plan in `docs/guides/ENGINE-HELL2025-BORROW-PLAN.md`.

Where the build is currently up to:

- the shell foundation is usable for active iteration
- session management is now UI-driven rather than terminal-only
- source control and project-root workflows are in the shell, but still need UX refinement
- the next major engine step remains native runtime bring-up and tighter shell/runtime integration around real project execution

## External Reference Track: Hell2025

Goal:
- preserve the useful parts of Hell2025 as a bounded reference source without turning Shader Forge into a derivative copy or inheriting mismatched architecture

Status:
- reference snapshot captured, no direct integration work started yet

Reference artifacts:
- `docs/references/hell2025/`
- `docs/guides/ENGINE-HELL2025-BORROW-PLAN.md`

Borrow targets:
- Vulkan runtime manager split and upload/helper patterns
- text-backed authored-asset serialization patterns from the house/create-info path
- native editor save/reload and world-refresh workflow patterns
- shader include expansion and compile error line-mapping ideas

Explicit non-goals:
- do not adopt the OpenGL runtime as the Shader Forge baseline
- do not adopt the Hell2025 custom binary `.map` source format for authored engine assets
- do not import bundled third-party middleware, SDKs, or vendor code wholesale
- do not import game-specific assets or gameplay systems into the engine baseline

## Phase 1: Engine Shell Scaffold

Goal:
- establish the browser shell as a standalone product surface

Status:
- core scaffold implemented, UX iteration ongoing

Scope:
- scaffold `shell/engine-shell` as a React + TypeScript + Vite app
- left navigation for sessions, explorer, source control, world, and search
- center dock tabs for `Code`, `Game`, `Scene`, and `Preview`
- right tabs for `Details`, `Assets`, `Inspector`, `Build`, `Run`, and `Profiler`
- bottom tabs for `Terminal`, `Logs`, `Output`, and `Console`
- preserve the inline file search toolbar beside `Inspect`
- keep the preserved editor implementation under `shell/engine-shell/web/` as the compatibility baseline while the new shell frame is built around it
- add a Windows PowerShell clean-start script that removes generated outputs, reruns the smoke harness, and launches the WSL-backed shell flow

Exit criteria:
- shell serves locally
- shell presents the intended layout for the engine workflow
- inline file search still provides match count, `Prev`, `Next`, `Clear`, and revealed active matches
- the React shell scaffold exists without replacing the preserved editor internals
- the Windows clean-start path is documented and available in `scripts/start-dev-clean.ps1`

## Phase 2: Session Backend And CLI

Goal:
- stand up the backend and command surfaces the shell will rely on

Status:
- working first implementation in place, now being expanded and refined

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

Implemented first slice:

- dependency-free local `engine_sessiond`
- session create/list/get over HTTP
- safe file list/read APIs
- initial `engine` CLI wrappers for backend bring-up and inspection
- deterministic `test-engine-sessiond.mjs` harness
- Unix and Windows clean-start scripts for dev boot plus harness execution

## Phase 3: Native Runtime Bring-Up

Goal:
- get the first native runtime window running

Status:
- scaffolded, but native window bring-up is still the next major implementation step

Scope:
- window bootstrap
- Vulkan device and swapchain
- frame loop
- input and timing
- logging and error surfaces
- a basic rendered scene
- use the Hell2025 Vulkan reference snapshot only as a structure guide for manager boundaries and upload paths while keeping Shader Forge SDL3-first and CMake-first

Exit criteria:
- `engine run sandbox` opens a native runtime window
- runtime is stable enough to leave running during shell work

## Phase 4: Viewer Bridge

Goal:
- make the shell a useful engine workspace rather than only a code surface

Status:
- early bridge work started through build/run/log control surfaces in the shell

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
- carry forward the Hell2025 shader include and line-mapping reference ideas into the Shader Forge shader toolchain rather than reusing the OpenGL compile path directly

Exit criteria:
- imported and generated assets flow through a single engine pipeline

## Phase 5.6: Project Migration Foundation

Goal:
- create the conversion foundation needed to bring Unity, Unreal, and Godot projects into Shader Forge for continued development

Scope:
- source-engine detection
- intermediate migration manifest model
- migrated asset provenance tracking
- migration report format
- first CLI migration commands
- fixture projects for Unity, Unreal, and Godot

Exit criteria:
- the repo has a formal migration subsystem spec and fixture strategy
- the engine can detect supported source engines and emit a normalized migration manifest
- migrated content can enter the standard asset pipeline with provenance and warning metadata

## Phase 5.5: Data And Effects

Goal:
- establish the engine-wide data and effects foundation before gameplay scale-up

Scope:
- TOML source-data schema and validation path
- FlatBuffers cooking path for runtime data
- SQLite tooling/session/asset database path
- Effekseer runtime integration plan
- code-defined simple effect descriptor model
- adapt the Hell2025 create-info serialization approach into engine-generic TOML scene/prefab source schemas instead of adopting its JSON and binary map formats directly

Exit criteria:
- data and effects frameworks are chosen, documented, and represented in the repo structure

## Phase 5.75: Level Authoring

Goal:
- make levels and prefabs directly editable by humans and AI without forcing scene authoring into C++ source

Scope:
- text-backed scene and prefab asset formats
- visual scene editing in `Scene` workflows
- world outliner and selection model
- details editing for component payloads
- transform gizmos
- save, reload, revert, duplicate, undo, and redo
- bake procedural results into editable scenes or prefabs
- edit mode and play mode separation
- borrow the Hell2025 native editor save/reload/world-refresh workflow patterns as reference input for Shader Forge native tooling while keeping shell-driven workflow integration

Exit criteria:
- a user can open a scene, make visual edits, save to text assets, and reload those edits
- AI and human edits converge on the same scene and prefab files
- play mode changes do not silently overwrite authored source data

## Phase 5.8: Source Engine Conversion

Goal:
- convert supported source-engine projects into Shader Forge-native projects that can continue development here

Scope:
- Unity scene/prefab and metadata conversion
- Unreal exporter-assisted asset and level conversion
- Unreal Blueprint manifest extraction through an Unreal-running exporter/plugin path
- Godot scene/project conversion
- best-effort gameplay/script translation manifests
- side-by-side migration inspection in the shell

Exit criteria:
- at least one Unity fixture, one Unreal fixture, and one Godot fixture can be converted into a Shader Forge project skeleton
- migrated scenes land as `.scene.toml` and migrated prefabs land as `.prefab.toml`
- each migration run emits a structured report with converted, approximated, skipped, and manual items

## Phase 5.85: Offline Unreal Fallback

Goal:
- add a later best-effort fallback for Unreal migration when the source project cannot be opened in Unreal

Scope:
- raw-project detection for Unreal-only repos
- offline `.uasset`/project parsing research and parser hardening
- low-confidence Blueprint extraction fallback
- clear reporting for reduced coverage relative to exporter-assisted migration

Exit criteria:
- the engine can detect when exporter-assisted migration is unavailable and fall back explicitly
- offline fallback emits lower-confidence migration reports instead of pretending parity
- Blueprint-heavy projects still warn that exporter-assisted migration is the preferred path

## Phase 5.9: Reusable AI Subsystem

Goal:
- add a reusable engine-level AI service without making remote models authoritative over core gameplay

Scope:
- provider abstraction for OpenAI, Anthropic, Gemini, and OpenAI-compatible endpoints
- local-model path for Ollama and similar endpoints
- request queueing, cancellation, timeout, retry, and fallback behavior
- budget and usage controls
- structured output and action-schema model
- shell and CLI inspection/test surfaces
- optional BYOK desktop mode

Exit criteria:
- a project can configure at least one local model path and one hosted-provider path
- the engine can issue structured AI requests without blocking frame-critical systems
- AI-facing gameplay outputs are validated through explicit schemas and deterministic code paths
- deterministic and optional real-provider harness lanes exist for the subsystem

## Phase 6: Game-Ready Loop

Goal:
- make the stack usable for actual game development

Scope:
- scene runtime
- transform hierarchy
- materials and shaders
- collision and physics integration
- hot reload for assets and shaders
- editor/runtime scene handoff
- initial AI-driven gameplay integration hooks

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
6. project migration foundation
7. level authoring
8. source-engine conversion
9. offline Unreal fallback
10. reusable AI subsystem

## Current Focus

Current build target:

- Phase 2 refinement: session UX, project-root workflows, source control, and terminal polish
- Phase 3 advance: native SDL3/Vulkan runtime bring-up
- Phase 4 continuation: shell/runtime control surfaces and viewer workflow preparation
- keep harness coverage current as each major slice lands
