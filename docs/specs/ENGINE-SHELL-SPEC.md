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
- an `Assets` workspace with a constrained primary-grip tuner and native-evaluated rest/sampled rig schematics for `animation/attachments/*.attachment.toml`; selection plus rest/sample evaluation are read-only until the operator chooses `Begin tuning`, then an exact attachment lease gates numeric translation/Euler-degree edits and explicit preview, approve, apply, reject, and undo transitions
- a global `Activity` bottom-dock surface that lists durable operation history for the active workspace, refetches selected public operation detail, follows operation SSE events, and exposes lease-free Approve/Reject review actions without adding an Activity primary workspace
- temporary harness sessions are not the intended user workflow and should be clearly separated from real repo-root workspaces in the `Workspaces` rail
- the global right panel is currently reserved for runtime/build/workspace tools in `Code` and `Playtest` so World and Assets can use the center area directly
- an in-app `Guide` opened from `Help`, backed by repo-native markdown and structured guide content so shell users and external assistants can resolve the same operator wiki without treating Guide as a primary workspace

The preserved Monaco workspace is still hosted through the compatibility bridge under `web/`.

## Spatial Authoring Surface

The first constrained spatial authoring surface is implemented in `Assets`. See [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md).

The shell lists and reads the exact attachment root through sessiond, exposes identity/skeleton/socket/item references read-only, and edits only primary-grip translation plus display Euler degrees. A strict source helper rewrites only the primary-grip translation and quaternion lines while preserving all other bytes and newline style. Missing, duplicate, multiline, or otherwise unsupported layouts fail closed. Session file reads include the authoritative text revision used by preview.

Assets now uses a functional three-pane desktop layout: attachment selection, the constrained numeric tuner, and a responsive rig-schematic pane. At the responsive breakpoint those panes stack into one column. The schematic consumes only sessiond `SpatialAttachmentEvaluation` reports and validates the complete bounded report before display. It provides Front X/Y, Side Z/Y, and Top X/Z views plus exact coordinate and evaluator-diagnostic tables. Semantic figure labelling, external description/live/error text, path/revision identity, keyboard-operable projection controls, readable dense text, and visible limitations keep the SVG from becoming the sole evidence channel.

Authored rest evidence is bound to the active session, selected path, exact source revision, and returned source-revision manifest. Authored sampled evidence is additionally bound to one exact phase, clip, normalized time, and the full staged animation-input manifest. The shell parses `[motion_envelope.<phase>]` independently from the constrained grip editor, offers only authored phase/time values through native selects, and guards late responses against session/path/revision/phase/time drift. Candidate evidence remains rest-only and is bound to operation id, base revision, proposed revision, and operation state. Draft edits mark cached evidence stale and never optimistically move it. Conflict state remains visibly stale even when numeric draft values equal the evaluated candidate. Malformed nested values, non-finite transforms, contradictory IK diagnostics, overflowed projection bounds, excessive coordinate rows, oversized arrays/text, or incomplete manifests fail closed for the entire schematic and never announce a loaded result.

Browsing never registers an agent or takes a lease, and the evaluator GET is still attempted for a readable attachment when the constrained editor parser rejects its TOML layout. `Begin tuning` registers the fixed shell actor in memory, requests `spatial/attachment/<id>`, refreshes source after grant, and disables mutations while queued or lost. Preview is visibly `NOT APPLIED`; approval and apply remain separate. Apply releases the lease and disconnects. Undo explicitly reacquires a fresh covering lease. Credentials remain memory-only headers and are redacted from client errors.

`App` owns the shell's one sessiond SSE subscription. Active-session operation events increment a minimal epoch used by Assets to refetch its active operation from sessiond; no second EventSource is opened. Selection, session, request, and operation-id guards prevent late responses from reviving old state. External approval updates actions. Conflict rereads authoritative bytes and keeps the old candidate visibly stale; its captured connection is retained only after successful parse and refreshed attachment-resource coverage, while failure closes only that captured connection. External reject/apply/undo clear candidate evidence, reread source, and release/disconnect only the connection captured by that event/action, never a possibly newer connection. Applied state remains available for Undo's explicit fresh-lease flow, while rejected and undone state clear the active operation.

The current workbench exposes exact authored rest evidence and explicit read-only sampled evidence. Sampled one-hand reports show primary attachment, schema-v1 two-hand reports remain visibly `PRE-IK`, and schema-v2 two-hand reports show applied IK plus numeric reach, contact, and angular PASS/FAIL diagnostics. Both poses draw evaluator bone/socket/hand/palm/target frames, item origin/orientation axes, contact, handle direction, and a resolved v2 item-space pole as a green ring; an unresolved v1 pole is never projected. Every schematic remains `NOT REVIEW EVIDENCE`: there is no item mesh, available joint-limit/clipping result, camera, capture, or immutable review packet. Candidate evidence remains rest-only. When rendered review lands, humans and agents share a `reviewId` with explicit cameras; the shell must not scrape the World camera, cursor, or selection to invent that packet.

This surface must not:

- ship as part of broad World/Assets visual polish before the spatial operation kinds exist
- add a built-in assistant, VLM apply button, or provider-specific Saved/Codex capture path
- write attachment bytes through a private file-write path that bypasses operations once spatial operations exist

## Activity And Changes Surface

The first global Activity slice lives in the resizable bottom dock. It consumes `GET /api/operations`, `GET /api/operations/:id`, the generic approve/reject routes, and the existing operation SSE events. Sessiond remains authoritative: changing workspaces and manual refresh reload the durable list, event notifications trigger another list/detail read, and HTTP 409 review races refetch the current operation.

Activity shows the public actor provenance, path, spatial context, resource keys, revisions, preview counts/summary, state, and append-only lifecycle. The public operation view does not expose `beforeContent`, `proposedContent`, or an exact diff, so the UI labels this evidence `Preview summary` and states that exact proposed content is unavailable. It must not claim content inspection or validation/test evidence that the journal does not publish.

This slice may approve `previewed` operations and reject `previewed` or `approved` operations with the fixed shell actor. It deliberately has no Apply, Undo, lease, agent registration, credential, or automatic navigation flow. Spatial apply/undo remain in a client that explicitly acquires and rechecks a covering coordination lease.

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
