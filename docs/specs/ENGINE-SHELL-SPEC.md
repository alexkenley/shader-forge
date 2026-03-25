# Engine Shell Spec

Status: target architecture  
Date: 2026-03-22

## Purpose

The engine shell is the browser-based control surface for Shader Forge.

It is responsible for:

- repo-aware editing
- session management
- file and git browsing
- terminal access
- runtime launch and control
- asset/details/inspector surfaces
- persistent scene authoring surfaces
- viewer tabs for code and runtime-facing workflows

It is not the engine runtime.

## Framework Decision

The shell framework target is:

- React
- TypeScript
- Vite

## Primary Layout

Left rail:

- `Workspaces`
- `Explorer`
- `Source Control`

Center dock:

- `Scene`
- `Game`
- `Preview`
- `Code`
- `Guide`

Right panel:

- context-aware runtime/workspace tools for non-`Scene` tabs
- current implemented tabs: `Runtime`, `Build`, `Workspace`

Bottom panel:

- `Terminal`
- `Logs`
- `Output`

## Workspace Layout Architecture

The shell layout should follow these rules:

- keep authoring, runtime, and utility surfaces separated instead of mixing them into one generic side column
- make the primary viewport the largest surface in `Scene`, `Game`, and `Preview`
- keep lightweight state such as dirty status, mode, and launch/runtime state in compact bars or chips instead of large summary cards
- keep terminals, logs, and other utility surfaces in the bottom dock rather than letting them compete with the main workspace
- put world hierarchy, selection inspection, and asset placement adjacent to the scene viewport, following familiar level-editor patterns from tools like Unreal, Unity, and Godot without copying any one layout blindly
- keep runtime launch/build controls grouped with `Game`, `Preview`, and runtime-facing side panels rather than leaving them visible during pure scene authoring
- prefer resizable editor sidebars and docks where screen-real-estate tradeoffs matter

## Core Behavior

- browser shell in v1
- native runtime window outside the browser
- terminal-first workflow
- Windows clean-start path through a PowerShell launcher that delegates into WSL
- persistent backend-owned sessions once `engine_sessiond` exists
- text and code as the source of truth
- `Scene` workflows should edit persistent text-backed scene and prefab assets rather than opaque editor state

## Implemented Shell Bridge

Current implemented bridge surfaces:

- `engine_sessiond` health status in the shell header
- session create/list state in the `Workspaces` rail
- file list/read preview in the `Explorer` rail
- session-root file write support for repo-backed authoring workflows
- runtime build, run, stop, restart, and pause/resume controls in the shell chrome and runtime-facing panels, with run/restart now launching against the active session root
- the shell now surfaces explicit setup guidance when the build lane is unavailable, including the current `cmake` requirement for `Build` and `Build + Run`, while the clean-start scripts auto-detect common CMake installs and export `SHADER_FORGE_CMAKE` when possible
- the shell now also calls out when a successful CMake build only produced the stub runtime because SDL3 or Vulkan were missing, so native dependency setup is separated clearly from CMake setup
- runtime and build logs routed into shell bottom-dock surfaces, with the bottom dock now supporting vertical resize plus explicit collapse/restore/maximize controls
- `Game` and `Preview` tabs that track external-runtime bridge state, recent runtime/build activity, and shell-side viewer workflow diagnostics
- the `Workspace` right-panel tab now also exposes the active AI provider manifest summary, ready-provider counts, per-provider diagnostics, and a workspace-backed AI smoke-test action
- the `Workspace` right-panel tab also exposes the active code-trust policy summary, supported authored hot-reload roots, tracked trust-artifact hashes and verification state, explicit promote/quarantine controls, and pending code-trust approvals with inline approve/deny actions for the selected workspace plus the shared engine lane
- a real `Scene` workspace that loads `content/scenes/*.scene.toml` plus `content/prefabs/*.prefab.toml`, exposes shell-side authoring/review separation, surfaces explicit `Run Scene` plus `Build + Run` actions directly inside the editor, placed-entity hierarchy plus transform editing, first prefab component payload editing, writes deterministic save/reload/duplicate flows back through `engine_sessiond`, and now uses a viewport-first level-editor layout with an adjacent resizable `Scenes`/`Outliner`/`Inspector`/`Assets` tool stack plus a compact bottom status bar
- temporary harness sessions are not the intended user workflow and should be clearly separated from real repo-root workspaces in the `Workspaces` rail
- the global right panel is now reserved for runtime/build/workspace tools on non-`Scene` tabs so scene authoring is not visually mixed with unrelated run/build controls
- an in-app `Guide` tab backed by repo-native markdown and structured guide content so shell users, terminal assistants, and future native assistants can resolve the same operator wiki from the workspace

The preserved Monaco workspace is still hosted through the compatibility bridge under `web/`.

## Preservation Rule

The preserved code-editor implementation under `shell/engine-shell/web/` is the compatibility baseline.

Phase 1 should:

- keep the preserved Monaco/editor behavior intact
- keep the inline file-search behavior intact
- build the new shell frame around it

Phase 1 should not start by rewriting the editor internals.

## Phase 1 Requirement

The shell scaffold must preserve the inline file search control beside `Inspect`.

Required behavior:

- search input in the editor toolbar
- match count
- `Prev`
- `Next`
- `Clear`
- revealed active match
- visible highlight for all matches
- stronger highlight for the active match

## Future Integration Boundary

The shell should eventually talk to:

- `engine_sessiond` for sessions, file APIs, git APIs, PTY, runtime lifecycle, and logs
- `engine_runtime` through structured runtime control and viewer protocols
- `engine_cli` through normal shell terminals and explicit command surfaces

The shell should not be reused as the native tooling UI layer or the shipped in-game UI framework.
