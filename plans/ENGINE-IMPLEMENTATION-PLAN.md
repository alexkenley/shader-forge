# Shader Forge Implementation Plan

Date: 2026-03-23

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
- renderer subsystem
- asset pipeline
- migration subsystem
- AI subsystem
- input subsystem
- audio subsystem
- animation subsystem
- physics subsystem
- tooling UI subsystem
- game UI subsystem
- data subsystem
- VFX subsystem
- save/runtime persistence subsystem
- packaging/export subsystem
- profiling/diagnostics subsystem
- scene system and world systems
- level editor
- procedural geometry
- test and harness infrastructure

## Spec Coverage Map

- [Shader Forge Systems Index](../docs/specs/ENGINE-SYSTEMS-INDEX.md): canonical spec entry point used to keep this plan aligned with the subsystem spec set
- [Engine Shell Spec](../docs/specs/ENGINE-SHELL-SPEC.md): Phase 1 and Phase 4
- [Engine Tooling UI Spec](../docs/specs/ENGINE-TOOLING-UI-SPEC.md): Phase 4.4 native tooling UI foundations and Phase 6.3 native profiling/inspection panels
- [Engine Game UI Spec](../docs/specs/ENGINE-GAME-UI-SPEC.md): Fixed decision for RmlUi and Phase 6 player-facing game loop work
- [Engine Runtime Spec](../docs/specs/ENGINE-RUNTIME-SPEC.md): Phase 3 and Phase 6
- [Engine Input Spec](../docs/specs/ENGINE-INPUT-SPEC.md): Phase 4.2 and Phase 6 gameplay integration
- [Engine Audio Spec](../docs/specs/ENGINE-AUDIO-SPEC.md): Phase 5.7
- [Engine Animation Spec](../docs/specs/ENGINE-ANIMATION-SPEC.md): Phase 5.72
- [Engine Physics Spec](../docs/specs/ENGINE-PHYSICS-SPEC.md): Phase 5.74 and Phase 6
- [Engine Renderer Spec](../docs/specs/ENGINE-RENDERER-SPEC.md): Phase 3 renderer bring-up, Phase 5 shader-toolchain work, and Phase 6 materials/shaders
- [Engine Sessiond Spec](../docs/specs/ENGINE-SESSIOND-SPEC.md): Phase 2 and Phase 4 coordination surfaces
- [Engine CLI Spec](../docs/specs/ENGINE-CLI-SPEC.md): Phase 2, Phase 5.6 migration commands, and Phase 6.2 packaging/export commands
- [Engine Save System Spec](../docs/specs/ENGINE-SAVE-SYSTEM-SPEC.md): Phase 6.1
- [Engine Packaging Spec](../docs/specs/ENGINE-PACKAGING-SPEC.md): Phase 6.2
- [Engine Profiling Spec](../docs/specs/ENGINE-PROFILING-SPEC.md): Phase 6.3
- [Asset Pipeline Spec](../docs/specs/ENGINE-ASSET-PIPELINE-SPEC.md): Phase 5, Phase 5.5, Phase 5.6, and Phase 5.8
- [Engine Migration Spec](../docs/specs/ENGINE-MIGRATION-SPEC.md): Phase 5.6, Phase 5.8, and Phase 5.85
- [Engine VFX Spec](../docs/specs/ENGINE-VFX-SPEC.md): Phase 5.5 and Phase 6 content/runtime integration
- [Engine Data Spec](../docs/specs/ENGINE-DATA-SPEC.md): Phase 5.5
- [Engine AI Spec](../docs/specs/ENGINE-AI-SPEC.md): Phase 5.9 and Phase 6 runtime integration hooks
- [Scene System Spec](../docs/specs/ENGINE-SCENE-SPEC.md): Phase 5.75 authoring round-trip and Phase 6 runtime scene composition
- [Engine Level Editor Spec](../docs/specs/ENGINE-LEVEL-EDITOR-SPEC.md): Phase 5.75
- [Procedural Geometry Spec](../docs/specs/ENGINE-PROCGEO-SPEC.md): Phase 5

## Progress Update

Current implementation status:

- Phase 1 is substantially underway.
- Phase 2 has a working first implementation and is the main active backend surface.
- Phase 3 now has a first real native runtime slice in the repo, with native SDL3/Vulkan verification and follow-on renderer expansion still ahead.
- Phase 4 now has shell-side runtime build/run/pause controls, bridge diagnostics, and dedicated viewer-workflow surfaces, but not a full embedded viewer yet.
- Phase 4.2 has now started through a first engine-owned input slice with text-backed actions/contexts and runtime-side named action queries.
- Phase 4.4 has now started through a native tooling substrate slice with a panel registry, text-backed layout loading/saving, and runtime inspection hooks, but not a Dear ImGui frontend yet.
- Phase 5.5 has now started through a first data-and-effects foundation slice with an engine-wide format manifest, text-backed scene/prefab/data/effect assets, runtime-side catalog validation, and bootstrap-driven scene resolution.

What is already done:

- `shell/engine-shell` exists as a React + TypeScript + Vite shell scaffold.
- The preserved code workspace remains bridged under `shell/engine-shell/web/`, including the extracted Monaco inline search toolbar and related behavior.
- The shell layout has moved toward an engine-style workspace with large docked panels rather than a generic web-app layout.
- A real multi-tab PTY terminal dock is wired through `engine_sessiond` and the shell.
- Windows and Unix clean-start scripts exist in `scripts/start-dev-clean.ps1` and `scripts/start-dev-clean.sh`.
- `engine_sessiond` exists and currently provides session create/list/get/update/delete, safe file list/read, host filesystem directory listing for the session root picker, git status/init, PTY terminal lifecycle, runtime lifecycle, and build lifecycle surfaces.
- The shell already consumes those backend surfaces for session CRUD, workspace-root picking, explorer reads, source control status, terminal tabs, runtime build/run/pause/log controls, and external-window viewer workflow diagnostics.
- The native runtime scaffold now includes a first swapchain-backed clear-color render loop with resize-aware recreation and present-path synchronization when SDL3 and Vulkan are available locally.
- The native runtime now loads `input/actions.toml` plus `input/contexts/*.input.toml` and routes SDL keyboard, mouse, and gamepad input through named engine actions.
- The native runtime now loads a text-backed tooling layout, exposes a named tool registry, and saves a session tooling layout snapshot for later native panel persistence.
- The native runtime now loads a data-foundation manifest, validates text-backed content roots under `content/`, resolves the selected runtime scene against `.scene.toml` source assets, and applies bootstrap scene/overlay defaults.
- Deterministic harnesses exist for the shell, session backend, viewer bridge, runtime scaffold, data foundation scaffold, input scaffold, and tooling UI scaffold.
- A local Hell2025 reference snapshot now exists under `docs/references/hell2025/`, with a scoped borrow plan in `docs/guides/ENGINE-HELL2025-BORROW-PLAN.md`.

Where the build is currently up to:

- the shell foundation is usable for active iteration
- session management is now UI-driven rather than terminal-only
- source control and project-root workflows are in the shell, but still need UX refinement
- the runtime has moved past pure scaffolding into a first native render-loop slice, but still needs full local-toolchain verification, richer rendering, and tighter shell/runtime integration around real project execution
- engine-owned input has moved past ad-hoc raw-event handling into a first text-backed action/context slice, but rebinding, user overrides, and richer gameplay/tool context switching still remain
- native tooling UI groundwork now exists behind text-backed layout and registry code, but Dear ImGui docking and actual in-process panel rendering still remain
- Phase 5.5 groundwork now exists through a shared data manifest, content catalog, scene-to-prefab relationship validation, and bootstrap-driven runtime defaults, but there is still no real FlatBuffers cook step, SQLite-backed index implementation, or Effekseer runtime integration yet

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

## External Reference Track: Open-Source Engine Guides

Goal:
- keep a bounded set of open-source engine and framework references available per phase without turning Shader Forge into a composite of borrowed architectures

Reference artifacts:
- `docs/guides/ENGINE-OPEN-SOURCE-BORROW-INDEX.md`
- `docs/guides/ENGINE-THE-FORGE-BORROW-GUIDE.md`
- `docs/guides/ENGINE-WICKED-ENGINE-BORROW-GUIDE.md`
- `docs/guides/ENGINE-FILAMENT-BORROW-GUIDE.md`
- `docs/guides/ENGINE-GODOT-BORROW-GUIDE.md`
- `docs/guides/ENGINE-O3DE-BORROW-GUIDE.md`
- `docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md`
- `docs/guides/ENGINE-BEVY-BORROW-GUIDE.md`
- `docs/guides/ENGINE-FYROX-BORROW-GUIDE.md`
- `docs/guides/ENGINE-DISTILL-BORROW-GUIDE.md`
- `docs/guides/ENGINE-BGFX-BORROW-GUIDE.md`
- `docs/guides/ENGINE-INPUT-BORROW-GUIDE.md`
- `docs/guides/ENGINE-PHYSICS-BORROW-GUIDE.md`
- `docs/guides/ENGINE-SAVE-SYSTEM-BORROW-GUIDE.md`
- `docs/guides/ENGINE-PACKAGING-BORROW-GUIDE.md`
- `docs/guides/ENGINE-PROFILING-BORROW-GUIDE.md`
- `docs/guides/ENGINE-AUDIO-BORROW-GUIDE.md`
- `docs/guides/ENGINE-ANIMATION-BORROW-GUIDE.md`
- `docs/guides/ENGINE-SBOX-BORROW-GUIDE.md`
- `docs/guides/ENGINE-CODE-ACCESS-BORROW-GUIDE.md`

Use rules:
- use the guides to decide where to inspect prior art before each phase expands
- borrow patterns, workflow ideas, test shapes, and manager boundaries before borrowing code
- keep direct code copy behind explicit license review and Shader Forge adaptation
- prefer the smallest useful reference pull for the current milestone rather than broad framework adoption

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

Reference inputs:
- for mature editor/workspace composition patterns, consult the [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md), and [Fyrox guide](../docs/guides/ENGINE-FYROX-BORROW-GUIDE.md)

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

Reference inputs:
- for project, tooling, and authoring/runtime ownership boundaries, consult the [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md), and [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md)

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
- get the first native runtime window and renderer loop running

Status:
- first clear-color swapchain render loop now lands in the repo; runtime stabilization and richer renderer work are the next major steps

Scope:
- window bootstrap
- renderer bootstrap and upload path foundations
- Vulkan device and swapchain
- frame loop
- input and timing
- logging and error surfaces
- a basic rendered scene
- debug-draw and render diagnostics foundations
- use the Hell2025 Vulkan reference snapshot only as a structure guide for manager boundaries and upload paths while keeping Shader Forge SDL3-first and CMake-first

Reference inputs:
- for runtime bootstrap and renderer boundaries, consult the [Hell2025 borrow plan](../docs/guides/ENGINE-HELL2025-BORROW-PLAN.md), [The Forge guide](../docs/guides/ENGINE-THE-FORGE-BORROW-GUIDE.md), [Wicked Engine guide](../docs/guides/ENGINE-WICKED-ENGINE-BORROW-GUIDE.md), and [Filament guide](../docs/guides/ENGINE-FILAMENT-BORROW-GUIDE.md)
- for smaller graphics bring-up harness ideas and shader-tool ergonomics, consult the [bgfx guide](../docs/guides/ENGINE-BGFX-BORROW-GUIDE.md)

Exit criteria:
- `engine run sandbox` opens a native runtime window
- runtime is stable enough to leave running during shell work

## Phase 4: Viewer Bridge

Goal:
- make the shell a useful engine workspace rather than only a code surface

Status:
- bridge work now includes build/run/pause/log control surfaces plus shell-side viewer workflow dashboards and dedicated harness coverage; embedded viewer transport is still deferred

Scope:
- runtime status and control
- `Game` and `Preview` tabs
- play, stop, restart, pause, screenshot
- logs in shell panels
- browser-shell workflows that complement later native Dear ImGui tooling surfaces rather than replacing them

Reference inputs:
- for editor/runtime bridge patterns, consult the [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md), [Fyrox guide](../docs/guides/ENGINE-FYROX-BORROW-GUIDE.md), and [Wicked Engine guide](../docs/guides/ENGINE-WICKED-ENGINE-BORROW-GUIDE.md)

Exit criteria:
- shell can operate the runtime without leaving the workspace

## Phase 4.2: Input And Action Mapping

Goal:
- establish an engine-owned input subsystem so gameplay, UI, editor tools, and assistant workflows target stable actions and contexts instead of raw device events

Status:
- first native slice now exists through text-backed action/context assets, SDL3 event translation, and runtime-side named action consumption

Scope:
- `engine_input` runtime subsystem
- SDL3-backed keyboard, mouse, and gamepad intake
- text-backed action and context assets
- rebinding and user override support
- gameplay, UI, and tool input contexts

Reference inputs:
- for input backend and action-map design, consult the [Input borrow guide](../docs/guides/ENGINE-INPUT-BORROW-GUIDE.md) and the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md) for tool-context keybinding file ideas

Exit criteria:
- gameplay and UI code can consume named actions and axes
- input bindings are text-backed and inspectable
- keyboard, mouse, and gamepad routes are unified through engine APIs

## Phase 4.4: Native Tooling UI Foundations

Goal:
- stand up the native tooling UI substrate that later profiling, level-authoring, and runtime-inspection work will depend on

Status:
- first substrate slice now exists through tool registry, layout persistence groundwork, runtime inspection snapshots, and input-driven overlay toggles; Dear ImGui docking is still ahead

Scope:
- Dear ImGui runtime bootstrap with docking
- basic native debug overlay and panel host
- tool registry and layout-persistence groundwork
- runtime inspection hooks for logs, frame timing, and debug state
- bridge points for later gizmos, debug drawing, and editor-only native panels

Reference inputs:
- for tool registry, dock layout, and context-binding ideas, consult the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md)
- for native editor save/reload workflow expectations, consult the [Hell2025 borrow plan](../docs/guides/ENGINE-HELL2025-BORROW-PLAN.md)

Exit criteria:
- the native runtime can host docked tooling panels without replacing the browser shell as the primary workspace
- later profiling and level-authoring slices have a defined native panel and overlay substrate to build on
- layout and tool registration groundwork exists for future persistence and discoverability

## Phase 5: Assets And Procedural Geometry

Goal:
- make the engine able to ingest and generate real content

Scope:
- source import
- cooked assets
- generated meshes
- bake-to-asset support for procedural output
- preview surfaces
- validation and import status
- land after the Phase 5.5 data-format decisions so asset metadata, cooked outputs, and generated content target stable engine formats
- carry forward the Hell2025 shader include and line-mapping reference ideas into the Shader Forge shader toolchain rather than reusing the OpenGL compile path directly

Reference inputs:
- for renderer-adjacent asset tooling, consult the [Filament guide](../docs/guides/ENGINE-FILAMENT-BORROW-GUIDE.md), [Distill guide](../docs/guides/ENGINE-DISTILL-BORROW-GUIDE.md), [bgfx guide](../docs/guides/ENGINE-BGFX-BORROW-GUIDE.md), and [Hell2025 borrow plan](../docs/guides/ENGINE-HELL2025-BORROW-PLAN.md)

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

Reference inputs:
- for project metadata and asset import target shape, consult the [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), and [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md)

Exit criteria:
- the repo has a formal migration subsystem spec and fixture strategy
- the engine can detect supported source engines and emit a normalized migration manifest
- migrated content can enter the standard asset pipeline with provenance and warning metadata

## Phase 5.5: Data And Effects

Goal:
- establish the engine-wide data and effects foundation before gameplay scale-up

Status:
- first foundation slice now exists through an engine-wide format manifest, runtime-side asset catalog validation, scene/prefab/bootstrap relationship handling, text-backed scene/prefab/data/effect roots, and a first simple effect descriptor asset

Scope:
- TOML source-data schema and validation path
- FlatBuffers cooking path for runtime data
- SQLite tooling/session/asset database path
- Effekseer runtime integration plan
- code-defined simple effect descriptor model
- explicit scene/prefab source-data ownership boundaries shared with the scene system
- adapt the Hell2025 create-info serialization approach into engine-generic TOML scene/prefab source schemas instead of adopting its JSON and binary map formats directly

Reference inputs:
- for import/cook/cache flow and tooling data boundaries, consult the [Distill guide](../docs/guides/ENGINE-DISTILL-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md), [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md), [Bevy guide](../docs/guides/ENGINE-BEVY-BORROW-GUIDE.md), and [Hell2025 borrow plan](../docs/guides/ENGINE-HELL2025-BORROW-PLAN.md)

Exit criteria:
- data and effects frameworks are chosen, documented, and represented in the repo structure

## Phase 5.7: Audio System

Goal:
- establish an engine-owned audio subsystem so playback, routing, and event-driven sound behavior can be authored inside Shader Forge rather than deferred to external tooling only

Scope:
- `engine_audio` runtime subsystem
- imported sound assets and text-backed sound metadata
- bus routing and mix control
- 2D and 3D playback
- listener and emitter model
- named audio events for gameplay, UI, and animation hooks
- shell and future native-tool preview surfaces
- deterministic audio harness coverage

Reference inputs:
- for audio architecture and authoring/runtime shape, consult the [Audio borrow guide](../docs/guides/ENGINE-AUDIO-BORROW-GUIDE.md)

Exit criteria:
- the runtime can play named sounds and named audio events
- the engine supports bus routing for at least `Master`, `Music`, `SFX`, `Voice`, and `Ambience`
- 3D attenuation works for world-space emitters
- authored audio definitions are text-backed and cook into runtime-ready data
- tools can preview and inspect audio without bypassing engine APIs

## Phase 5.72: Animation System

Goal:
- establish an engine-owned animation subsystem so animation logic, state, and procedural control can be authored natively inside Shader Forge and through assistant-editable text/code workflows rather than requiring Blender

Scope:
- `engine_animation` runtime subsystem
- text-backed skeleton, clip, graph, and mask assets
- clip playback, blending, and state machines
- animation events and root motion
- procedural animation layers such as look-at or simple IK
- shell, CLI, and future native-tool preview surfaces
- deterministic animation harness coverage

Reference inputs:
- for animation runtime and authoring/runtime shape, consult the [Animation borrow guide](../docs/guides/ENGINE-ANIMATION-BORROW-GUIDE.md)

Exit criteria:
- the runtime can load and play text-backed clips and animation graphs
- gameplay code and assistant workflows can control graph parameters through explicit APIs
- animation events can drive gameplay, audio, or VFX hooks
- root motion extraction works for supported clips
- tools can preview and inspect animation assets without requiring Blender as the primary editing path

## Phase 5.74: Physics And Collision

Goal:
- establish an engine-owned physics subsystem so collision, rigid body simulation, and gameplay scene queries are first-class engine capabilities

Scope:
- `engine_physics` runtime subsystem
- collision layers and materials
- static, kinematic, and dynamic bodies
- scene queries
- joints and simple character-facing collision workflows
- physics debug visualization and deterministic harness coverage

Reference inputs:
- for backend and tooling/runtime shape, consult the [Physics borrow guide](../docs/guides/ENGINE-PHYSICS-BORROW-GUIDE.md)

Exit criteria:
- the runtime supports authored colliders and rigid bodies
- raycast, sweep, and overlap queries are available through engine APIs
- collision layers and materials are text-backed and tool-visible
- debug draw and harness coverage exist for the first physics slice

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

Reference inputs:
- for authoring UX and prefab/scene editing patterns, consult the [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md), [Fyrox guide](../docs/guides/ENGINE-FYROX-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md), the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md), and the [Hell2025 borrow plan](../docs/guides/ENGINE-HELL2025-BORROW-PLAN.md)

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

Reference inputs:
- for target project layout and import metadata boundaries, consult the [Godot guide](../docs/guides/ENGINE-GODOT-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), and [Stride guide](../docs/guides/ENGINE-STRIDE-BORROW-GUIDE.md)

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
- shared tool registry for deterministic engine capabilities
- shared skill registry for higher-level engine workflows
- structured scene-bridge workflows for assistant-friendly scene inspection and scene patch application
- shell and CLI inspection/test surfaces
- native in-engine assistant surface for runtime/editor workflows
- shared provider and tool/skill core for terminal and in-engine assistant clients
- explicit policy hooks for assistant-triggered compile, hot reload, install, and apply operations
- optional BYOK desktop mode
- treat the first useful Phase 5.95 trust and policy slice as a prerequisite for assistant-triggered compile, install, apply, and hot reload workflows

Reference inputs:
- for plugin/service boundary ideas, consult the [Bevy guide](../docs/guides/ENGINE-BEVY-BORROW-GUIDE.md), [O3DE guide](../docs/guides/ENGINE-O3DE-BORROW-GUIDE.md), the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md), and the [Code access borrow guide](../docs/guides/ENGINE-CODE-ACCESS-BORROW-GUIDE.md)

Exit criteria:
- a project can configure at least one local model path and one hosted-provider path
- the engine can issue structured AI requests without blocking frame-critical systems
- AI-facing gameplay outputs are validated through explicit schemas and deterministic code paths
- terminal, shell, and native in-engine assistants can discover and execute shared tools and skills through explicit policies
- assistant scene-authoring workflows can inspect and patch structured scene data without relying on hidden editor-only state
- deterministic and optional real-provider harness lanes exist for the subsystem

## Phase 5.95: Code Access, Trust, And Hot Reload Safety

Goal:
- define the trust boundary for user-authored, addon-authored, plugin, and assistant-generated code before Shader Forge expands in-engine execution and hot reload flows

Scope:
- trust tiers for engine, project, assistant-generated, external-plugin, and unsafe-dev override code paths
- explicit allow and deny policy model for supported scripting or plugin surfaces
- trusted-artifact verification and origin tracking
- diagnostics for rejected code or blocked operations
- policy hooks for assistant-triggered compile, install, load, and hot reload actions
- deterministic hotload and policy harness coverage

Reference inputs:
- for trusted-code boundaries, policy design, and hotload test shape, consult the [Code access borrow guide](../docs/guides/ENGINE-CODE-ACCESS-BORROW-GUIDE.md) and the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md)

Exit criteria:
- risky code transitions run through explicit engine policy checks
- accepted and rejected code paths produce actionable diagnostics
- trusted origin and trust tier are inspectable in tooling
- supported hotload paths have deterministic verification coverage before they are treated as normal workflows

## Phase 6: Game-Ready Loop

Goal:
- make the stack usable for actual game development

Scope:
- scene runtime
- scene serialization/load path and prefab composition
- transform hierarchy
- materials and shaders
- player-facing game UI foundation via RmlUi
- collision and physics integration
- hot reload for assets and shaders
- mounted project and package filesystem layering
- editor/runtime scene handoff
- initial AI-driven gameplay integration hooks

Reference inputs:
- for end-to-end runtime composition and iteration flow, consult the [Wicked Engine guide](../docs/guides/ENGINE-WICKED-ENGINE-BORROW-GUIDE.md), [Bevy guide](../docs/guides/ENGINE-BEVY-BORROW-GUIDE.md), [The Forge guide](../docs/guides/ENGINE-THE-FORGE-BORROW-GUIDE.md), [Filament guide](../docs/guides/ENGINE-FILAMENT-BORROW-GUIDE.md), [Distill guide](../docs/guides/ENGINE-DISTILL-BORROW-GUIDE.md), and the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md)

Exit criteria:
- the engine can drive a small real project end to end

## Phase 6.1: Save And Runtime Persistence

Goal:
- add a runtime save system that preserves player and world state without conflating saves with authored source assets

Scope:
- save slots and metadata
- runtime world-state persistence
- player/profile persistence
- settings persistence
- save/load validation and migration support

Reference inputs:
- for save architecture and data boundaries, consult the [Save system borrow guide](../docs/guides/ENGINE-SAVE-SYSTEM-BORROW-GUIDE.md)

Exit criteria:
- the engine can save and load runtime state through explicit engine APIs
- authored scene and prefab source data remain separate from save-game data
- save payloads are versioned and migration-aware

## Phase 6.2: Packaging And Export

Goal:
- add a CLI-first packaging workflow that turns built projects and cooked assets into distributable game layouts

Scope:
- package/export CLI commands
- release layout generation
- cooked asset bundling
- text-backed export presets
- platform-specific packaging hooks

Reference inputs:
- for export workflow and release-layout shape, consult the [Packaging borrow guide](../docs/guides/ENGINE-PACKAGING-BORROW-GUIDE.md) and the [s&box borrow guide](../docs/guides/ENGINE-SBOX-BORROW-GUIDE.md)

Exit criteria:
- the engine can package a project into a reproducible release layout
- export configuration is scriptable and source-controlled where safe
- the release flow does not depend on ad-hoc manual steps

## Phase 6.3: Profiling, Diagnostics, And Performance

Goal:
- make profiling and low-level diagnostics first-class engine workflows during development and stabilization

Scope:
- CPU and GPU profiling integration
- memory and allocation diagnostics
- native runtime profiling panels
- Dear ImGui-based native tooling UI panels for runtime inspection, debug drawing, and profiling workflows
- external capture integration for deep graphics debugging
- capture save/load and sharing workflows

Reference inputs:
- for profiling stack and workflow shape, consult the [Profiling borrow guide](../docs/guides/ENGINE-PROFILING-BORROW-GUIDE.md)

Exit criteria:
- the engine can capture useful CPU and GPU profiling data during runtime work
- developers can use native and external capture tools without custom one-off setup every time
- performance regressions can be investigated through explicit engine workflows

## Stretch Goals

Later systems that should exist, but do not need to block the current build order:

- networking and multiplayer
- localization
- accessibility
- cinematics and timeline tooling

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
5. input and action mapping
6. native tooling UI foundations
7. data and effects
8. assets and procedural geometry
9. audio system
10. animation system
11. physics and collision
12. project migration foundation
13. level authoring
14. source-engine conversion
15. offline Unreal fallback
16. code access, trust, and hot reload safety
17. reusable AI subsystem
18. game-ready loop
19. save and runtime persistence
20. packaging and export
21. profiling, diagnostics, and performance

## Current Focus

Current build target:

- Phase 2 refinement: session UX, project-root workflows, source control, and terminal polish
- Phase 3 advance: native SDL3/Vulkan runtime stabilization, local-toolchain verification, and renderer expansion
- Phase 4 continuation: shell/runtime control surfaces and viewer workflow preparation, but not ahead of runtime and input stabilization
- Phase 4.4 planning: native tooling UI substrate before deep authoring and profiling work
- Phase 5.5 advance: keep locking data/cook format choices and source-asset ownership boundaries before broad asset-pipeline expansion
- Phase 5.95 before Phase 5.9 execution: land trust and policy groundwork before assistant-triggered code and apply workflows expand
- keep harness coverage current as each major slice lands
