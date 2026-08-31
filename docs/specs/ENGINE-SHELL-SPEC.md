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

The shell uses one strict typed v1 layout record in browser storage. It persists the active workspace, each workspace's left/right visibility, selected tabs and preferred widths, plus the shared bottom-dock tab, collapsed state, and preferred height. It stores chrome only: session ids, paths, credentials, drafts, operations, and terminal state never enter the layout record. Invalid or unavailable storage falls back to canonical defaults, and `Reset` clears all workspace layouts.

`Left`, `Right`, and `Bottom` controls remain available in the header. Visible side panes and the bottom dock support pointer and keyboard resizing through bounded accessible separators. Desktop sizing preserves at least 360 pixels for the center workspace when the available width allows it. At 800 pixels or narrower, the right pane becomes an on-demand overlay drawer instead of squeezing the primary workspace; its toggle remains reachable. `Playtest` starts with both side panes hidden, as do `World` and `Assets`; `Code` starts with only the left pane visible. The bottom dock starts collapsed. Ordinary workspace navigation keeps the `Code` and `World` surfaces mounted so their drafts survive tab changes; project-session changes remain authoritative boundaries.

The layout follows these rules:

- keep authoring, runtime, and utility surfaces separated instead of mixing them into one generic side column
- make the primary authoring or runtime surface the largest area in `World` and `Playtest`
- keep lightweight state such as dirty status, mode, and launch/runtime state in compact bars or chips instead of large summary cards
- keep terminals, logs, and other utility surfaces in the bottom dock rather than letting them compete with the main workspace
- put world hierarchy, selection inspection, and asset placement adjacent to the scene viewport, following familiar level-editor patterns from tools like Unreal, Unity, and Godot without copying any one layout blindly
- keep runtime launch/build controls inside `World`, `Playtest`, and runtime-facing panels; the top chrome reports status but does not duplicate those controls
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
- workspace-specific runtime build, run, stop, restart, and pause/resume controls, with run/restart launching against the active session root and no duplicate runtime control strip in the top chrome
- the shell surfaces explicit setup guidance when `Play` cannot build because `cmake` is unavailable, while the clean-start scripts auto-detect common CMake installs and export `SHADER_FORGE_CMAKE` when possible
- the shell now also calls out when a successful CMake build only produced the stub runtime because SDL3 or Vulkan were missing, so native dependency setup is separated clearly from CMake setup
- runtime and build logs routed into shell bottom-dock surfaces, with the bottom dock now supporting vertical resize plus explicit collapse/restore/maximize controls
- one strict typed browser-persisted shell layout with per-workspace side-pane state, a shared bottom dock, visible toggles, pointer/keyboard resizing, a full reset, and a narrow-screen right drawer; `Playtest` side panes are off by default
- a compact `Playtest` workspace with the active world, plain external-window status, and state-aware Play/Stop/Restart controls visible by default; build settings, raw runtime/build state, logs, and recent activity stay under collapsed `Diagnostics`
- the `Workspace` right-panel tab now also exposes export-preset inspection, release-layout readiness, package generation, visible prep state, and last-package summary for the selected workspace
- the `Workspace` right-panel tab now also exposes a live diagnostics snapshot plus capture-report controls for the current workspace, including runtime/build state, packaging readiness, stored capture history, and first profiling recommendations
- the `Workspace` right-panel tab also exposes the active code-trust policy summary, supported authored hot-reload roots, tracked trust-artifact hashes and verification state, explicit promote/quarantine controls, and pending code-trust approvals with inline approve/deny actions for the selected workspace plus the shared engine lane
- Explorer, Git, package, profiling, trust-summary, and trust-approval refreshes retain independent request generations plus active-session identity. Package, capture, trust, and Activity review actions additionally retain the initiating workspace-selection generation. Selecting another workspace synchronously invalidates these lanes, clears their transient busy state and pending build auto-run intent, and prevents an A-to-B-to-A return from publishing stale data, errors, or action status
- workspace-list and host-directory-picker reads retain their own request generations. A newer list/navigation request wins, closing the picker invalidates its pending request, and workspace selection/edit/delete controls remain disabled while workspace CRUD is active
- terminal tabs use sibling tab/close controls rather than nested buttons, support roving arrow/Home/End keyboard selection, label the shell selector and active panel, and announce terminal connection state. World Edit/Verify expose pressed state, workspace edit/delete controls have specific accessible names, and the collapsed bottom dock exposes only Restore rather than a redundant Maximize action
- the Assets workspace implementation and xterm JavaScript load only when opened; draft-owning World and Code stay mounted across ordinary workspace navigation
- a real `World` workspace that loads revision-bearing `content/scenes/*.scene.toml` plus `content/prefabs/*.prefab.toml`, keeps draft-safe `Edit` and read-only `Verify` stances, and sends save/create/duplicate through one semantic scene-asset helper with exact leases, native validation, and authoritative apply reconciliation. It auto-saves dirty world/object drafts before one-click Play requests Build + Run, keeps actionable play failures visible, preserves drafts across ordinary shell navigation, and detaches them across incompatible project/session changes. World load, reload, save, create, and duplicate responses must retain their request generation plus workspace/path authority so an A-to-B-to-A switch cannot revive stale state. Runtime/build request generations reject late HTTP completions after a newer command or SSE event, stopped builds cancel pending auto-run, and runtime telemetry never replaces the authored World selection; hierarchy, transform, reusable-object, save/reload/duplicate, and guarded destructive flows remain available in the viewport-first editor
- an `Assets` workspace with a constrained primary-grip tuner and native-evaluated rest/sampled rig schematics for `animation/attachments/*.attachment.toml`; selection plus rest/sample evaluation are read-only until the operator chooses `Begin tuning`, then an exact attachment lease gates numeric translation/Euler-degree edits and explicit preview, approve, apply, reject, and undo transitions
- a global `Activity` bottom-dock surface that lists durable operation history for the active workspace, refetches selected public operation detail, follows operation SSE events, and exposes lease-free Approve/Reject review actions without adding an Activity primary workspace
- a native `Code` workspace that lists and reads bounded session files, keeps revision-bound Monaco tabs and unsaved drafts across shell navigation, exposes current-file search immediately beside `Inspect`, and routes Preview/Approve/Reject/Apply/Undo through the durable file-write operation contract instead of direct writes
- temporary harness sessions are not the intended user workflow and should be clearly separated from real repo-root workspaces in the `Workspaces` rail
- the global right panel is currently reserved for runtime/build/workspace tools in `Code` and `Playtest` so World and Assets can use the center area directly
- an in-app `Guide` opened from `Help`, backed by repo-native markdown and structured guide content so shell users and external assistants can resolve the same operator wiki without treating Guide as a primary workspace

The preserved `web/` editor remains available only through an explicit legacy bridge or standalone link. The default `Code` workspace is shell-native and reuses the vendored Monaco runtime without adding a second editor dependency.

## Spatial Authoring Surface

The first constrained spatial authoring surface is implemented in `Assets`. See [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md).

The shell lists and reads the exact attachment root through sessiond, exposes identity/skeleton/socket/item references read-only, and edits only primary-grip translation plus display Euler degrees. A strict source helper rewrites only the primary-grip translation and quaternion lines while preserving all other bytes and newline style. Missing, duplicate, multiline, or otherwise unsupported layouts fail closed. Session file reads include the authoritative text revision used by preview.

Assets now uses a functional three-pane desktop layout: attachment selection, the constrained numeric tuner, and a responsive rig-schematic pane. At the responsive breakpoint those panes stack into one column. The schematic consumes only sessiond `SpatialAttachmentEvaluation` reports and validates the complete bounded report before display. It provides Front X/Y, Side Z/Y, and Top X/Z views plus exact coordinate and evaluator-diagnostic tables. Semantic figure labelling, external description/live/error text, path/revision identity, keyboard-operable projection controls, readable dense text, and visible limitations keep the SVG from becoming the sole evidence channel.

Authored rest evidence is bound to the active session, selected path, exact source revision, and returned source-revision manifest. Authored sampled evidence is additionally bound to one exact phase, clip, normalized time, and the full staged animation-input manifest. The shell parses `[motion_envelope.<phase>]` independently from the constrained grip editor, offers only authored phase/time values through native selects, and guards late responses against session/path/revision/phase/time drift. Candidate evidence remains rest-only and is bound to operation id, base revision, proposed revision, and operation state. Draft edits mark cached evidence stale and never optimistically move it. Conflict state remains visibly stale even when numeric draft values equal the evaluated candidate. Malformed nested values, non-finite transforms, contradictory IK diagnostics, overflowed projection bounds, excessive coordinate rows, oversized arrays/text, or incomplete manifests fail closed for the entire schematic and never announce a loaded result.

Browsing never registers an agent or takes a lease, and the evaluator GET is still attempted for a readable attachment when the constrained editor parser rejects its TOML layout. `Begin tuning` registers the fixed shell actor in memory, requests `spatial/attachment/<id>`, refreshes source after grant, and disables mutations while queued or lost. Preview is visibly `NOT APPLIED`; approval and apply remain separate. Apply releases the lease and disconnects. Undo explicitly reacquires a fresh covering lease. Credentials remain memory-only headers and are redacted from client errors.

`App` owns the shell's one sessiond SSE subscription. Active-session operation events increment a minimal epoch used by Assets to refetch its active operation from sessiond; no second EventSource is opened. Selection, session, request, and operation-id guards prevent late responses from reviving old state. External approval updates actions. Conflict rereads authoritative bytes and keeps the old candidate visibly stale; its captured connection is retained only after successful parse and refreshed attachment-resource coverage, while failure closes only that captured connection. External reject/apply/undo clear candidate evidence, reread source, and release/disconnect only the connection captured by that event/action, never a possibly newer connection. Applied state remains available for Undo's explicit fresh-lease flow, while rejected and undone state clear the active operation.

The current workbench exposes exact authored rest evidence and explicit read-only sampled evidence. Sampled one-hand reports show primary attachment, schema-v1 two-hand reports remain visibly `PRE-IK`, and schema-v2 two-hand reports show applied IK plus numeric reach, contact, and angular PASS/FAIL diagnostics. Both poses draw evaluator bone/socket/hand/palm/target frames, item origin/orientation axes, contact, handle direction, a resolved v2 item-space pole, and the exact twelve-edge prefab-bound visual box when available. Joint limits show diagnose-only aggregate and per-bone PASS/FAIL from the exact typed `diagnostics.jointLimits` object; unavailable is exact `no_joint_limits_authored`.

Capsule-to-item clipping is deliberately a distinct proxy layer. When `diagnostics.clipping` is available, Assets draws the independently authored collision box as a dashed amber outline and each authored diagnostic capsule with an explicit `CLEAR` or `OVERLAP` state; it does not reuse joint-limit PASS/FAIL. The details table exposes capsule radius/half-length, axis distance, signed surface clearance, and non-negative overlap depth. The aggregate names the exact `capsule_axis_to_oriented_box_clearance` metric. The native evaluator supplies every frame, corner, endpoint, and result; the shell synthesizes no fallback geometry or collision judgment. Unavailable evidence surfaces the exact typed reason. Copy states explicitly that CLEAR is not gameplay-safety approval and OVERLAP is numeric intersection depth rather than a contact manifold.

Every schematic remains `NOT REVIEW EVIDENCE`: the solid gray visual box is authored render-procgeo evidence, the dashed collision box and capsules are diagnose-only proxies, and neither is a rendered item mesh, general collision result, camera capture, or immutable review packet. Both visual and collision corners/capsules contribute to safe projection bounds and remain available in coordinate tables. Candidate evidence remains rest-only. A separate immutable-review panel validates a previewed or approved candidate over the selected authored phase, releases the tuning write lock, acquires exact source-read/capture-write/review-write leases through a fresh in-memory shell agent, publishes a new packet, and displays only its referenced real PNGs. Existing review IDs can be loaded within the active session; malformed packets and attachment mismatches fail closed. Packet, operation, sample, and camera identity stay visible, and the diagnostic schematic remains explicitly separate below it.

This surface must not:

- ship as part of broad World/Assets visual polish before the spatial operation kinds exist
- add a built-in assistant, VLM apply button, or provider-specific Saved/Codex capture path
- write attachment bytes through a private file-write path that bypasses operations once spatial operations exist

## Activity And Changes Surface

The global Activity slice lives in the resizable bottom dock. It consumes `GET /api/operations`, `GET /api/operations/:id`, selected-only `GET /api/operations/:id/diff`, the generic approve/reject routes, and the existing operation SSE events. Sessiond remains authoritative: changing workspaces and manual refresh reload the durable list, event notifications trigger another list/detail read, and HTTP 409 review races refetch the current operation.

Activity shows the public actor provenance, path, spatial context, resource keys, revisions, preview counts/summary, state, append-only lifecycle, and exact bounded line hunks for the selected operation. The diff is a separate structured response rather than an expansion of operation list/detail/SSE. The shell verifies operation id, path, and both revisions before display, exposes old/new coordinates and line-ending truth in a keyboard-scrollable responsive table, marks truncation, and states why binary-like, too-large, or unavailable content is summary-only. Public operation views may now carry the latest bounded spatial-validation summary, but Activity does not render that summary yet. It never receives private `beforeContent` or `proposedContent` journal bytes.

The operation journal has the restart-safe storage boundary used by `POST /api/operations/:id/validate`. Only `previewed` or `approved` spatial-attachment operations can receive a summary. A summary is bound to the operation's proposed revision, contains at most 64 phase/time samples with exact aggregate finding totals, and replaces the prior latest summary while appending an actor-attributed `validated` event. At most eight validation events are retained per operation. Snapshot compare-and-swap uses both proposed revision and `updatedAt`; mutation timestamps remain monotonic even when the host clock does not advance. Reload rejects malformed summaries, invalid spatial context or revision binding, actorless/missing validation events, over-limit history, and backward or out-of-envelope timestamps. The backend now produces these summaries from full staged native rest/sample validation without a lease and exposes neither proposed bytes nor raw diagnostics. Public operation and SSE views carry the bounded latest summary and event provenance, but Activity rendering remains deferred.

This slice may approve `previewed` operations and reject `previewed` or `approved` operations with the fixed shell actor. It deliberately has no Apply, Undo, lease, agent registration, credential, or automatic navigation flow. Spatial apply/undo remain in a client that explicitly acquires and rechecks a covering coordination lease.

## Code Workspace And Compatibility Baseline

The default shell-native Code surface owns bounded file browsing, revision-bound tabs, Monaco source/diff models, dirty-draft preservation, current-file search, inspect metadata, typed conflicts, and operation review/apply/undo. A preview is bound to the exact draft and revision that were reviewed; editing afterward makes the candidate stale. File-tree, directory, file-read, operation-event, and mutation responses are accepted only while their request generation plus session, tab, path, and operation authority still match. Changing the active project session closes clean foreign tabs and retains dirty foreign tabs as read-only detached drafts; returning to their original session reattaches them.

Apply and Undo reread the authoritative baseline but replace the draft only when it still equals the exact draft captured before that action, so a newer edit is preserved. Structured HTTP 409 state, revision, and code-trust conflicts may refresh the visible operation only when the returned operation matches the expected id, session, and path. Stale responses and unrelated conflict payloads cannot cross tab authority or erase current work.

The preserved implementation under `shell/engine-shell/web/` remains an optional compatibility baseline while parity work continues. It is not the default Code screen and must not regain separate assistant, provider, or prompt UI.

## Phase 1 Requirement

The shell-native Code workspace must preserve the inline file search control beside `Inspect`.

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
