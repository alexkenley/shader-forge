# Engine Shell Spec

Status: target architecture  
Date: 2026-08-30

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
- distinct World, Code, Playtest, and Assets workspaces
- operational activity, change, approval, conflict, and provenance surfaces for external agents

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

Primary workspaces:

- `World`
- `Code`
- `Playtest`
- `Assets`

Right panel:

- context-aware inspector, runtime, build, change, and activity tools
- current implemented tabs: `Runtime`, `Build`, `Workspace`

Bottom panel:

- `Terminal`
- `Logs`
- `Output`

Secondary surfaces:

- searchable `Guide` under `Help`
- external-agent connection, change, approval, and conflict status without a built-in chat assistant

## Workspace Layout Architecture

The shell layout should follow these rules:

- keep authoring, runtime, and utility surfaces separated instead of mixing them into one generic side column
- make the primary authoring or runtime surface the largest area in `World` and `Playtest`
- keep lightweight state such as dirty status, mode, and launch/runtime state in compact bars or chips instead of large summary cards
- keep terminals, logs, and other utility surfaces in the bottom dock rather than letting them compete with the main workspace
- put world hierarchy, selection inspection, and asset placement adjacent to the scene viewport, following familiar level-editor patterns from tools like Unreal, Unity, and Godot without copying any one layout blindly
- keep runtime launch/build controls grouped with `Playtest` and runtime-facing side panels rather than leaving them visible during pure world authoring
- prefer resizable editor sidebars and docks where screen-real-estate tradeoffs matter

## Core Behavior

- browser shell in v1
- native runtime window outside the browser
- terminal-first workflow
- Windows clean-start path through a PowerShell launcher that delegates into WSL
- persistent backend-owned sessions once `engine_sessiond` exists
- text and code as the source of truth
- `World` workflows should edit persistent text-backed scene and prefab assets rather than opaque editor state
- external AI development clients connect through the MCP control plane; the shell does not own model selection, prompts, provider setup, or development-assistant chat

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
- a single `Playtest` workspace that truthfully tracks and controls the external native runtime, recent runtime/build activity, and viewer workflow diagnostics
- the `Workspace` right-panel tab now also exposes export-preset inspection, release-layout readiness, package generation, visible prep state, and last-package summary for the selected workspace
- the `Workspace` right-panel tab now also exposes a live diagnostics snapshot plus capture-report controls for the current workspace, including runtime/build state, packaging readiness, stored capture history, and first profiling recommendations
- the `Workspace` right-panel tab also exposes the active code-trust policy summary, supported authored hot-reload roots, tracked trust-artifact hashes and verification state, explicit promote/quarantine controls, and pending code-trust approvals with inline approve/deny actions for the selected workspace plus the shared engine lane
- a real `World` workspace that loads `content/scenes/*.scene.toml` plus `content/prefabs/*.prefab.toml`, exposes shell-side authoring/review separation, surfaces explicit `Run Scene` plus `Build + Run` actions directly inside the editor, placed-entity hierarchy plus transform editing, first prefab component payload editing, writes deterministic save/reload/duplicate flows back through `engine_sessiond`, and uses a viewport-first level-editor layout with an adjacent resizable `Scenes`/`Outliner`/`Inspector`/`Assets` tool stack plus a compact bottom status bar
- an `Assets` workspace with a constrained primary-grip tuner for `animation/attachments/*.attachment.toml`; selection is read-only until the operator chooses `Begin tuning`, then an exact attachment lease gates numeric translation/Euler-degree edits and explicit preview, approve, apply, reject, and undo transitions
- temporary harness sessions are not the intended user workflow and should be clearly separated from real repo-root workspaces in the `Workspaces` rail
- the global right panel is currently reserved for runtime/build/workspace tools in `Code` and `Playtest` so World and Assets can use the center area directly
- an in-app `Guide` opened from `Help`, backed by repo-native markdown and structured guide content so shell users and external assistants can resolve the same operator wiki without treating Guide as a primary workspace

The preserved Monaco workspace is still hosted through the compatibility bridge under `web/`.

## Spatial Authoring Surface

The first constrained spatial authoring surface is implemented in `Assets`. See [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md).

The shell lists and reads the exact attachment root through sessiond, exposes identity/skeleton/socket/item references read-only, and edits only primary-grip translation plus display Euler degrees. A strict source helper rewrites only the primary-grip translation and quaternion lines while preserving all other bytes and newline style. Missing, duplicate, multiline, or otherwise unsupported layouts fail closed. Session file reads include the authoritative text revision used by preview.

Browsing never registers an agent or takes a lease. `Begin tuning` registers the fixed shell actor in memory, requests `spatial/attachment/<id>`, refreshes source after grant, and disables mutations while queued or lost. Preview is visibly `NOT APPLIED`; approval and apply remain separate. Apply releases the lease and disconnects. Undo explicitly reacquires a fresh covering lease. Credentials remain memory-only headers and are redacted from client errors.

Pose sampling, diagnostics, render/capture, and immutable review packets remain deferred. When those land, humans and agents share a `reviewId` with explicit cameras; the shell must not scrape the World camera, cursor, or selection to invent that packet.

This surface must not:

- ship as part of broad World/Assets visual polish before the spatial operation kinds exist
- add a built-in assistant, VLM apply button, or provider-specific Saved/Codex capture path
- write attachment bytes through a private file-write path that bypasses operations once spatial operations exist

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
- a process-scoped MCP adapter backed by engine-owned multi-agent coordination, revision checks, change previews, validation, and approval policies
- the implemented constrained attachment tuner and later spatial capture/review tooling over the same `engine_sessiond` operations used by CLI and `sf-mcp`, as specified in [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md)

The shell should not be reused as the native tooling UI layer or the shipped in-game UI framework.
