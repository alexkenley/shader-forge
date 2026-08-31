# Shader Forge Redesign and Uplift Plan

Date: 2026-08-31
Status: In execution
Scope: Product direction, engine shell UX, external-agent integration, implementation sequence, and acceptance gates  
Scheduling: Deliberately omitted. Work is ordered by dependency and proof, not calendar estimates.

Current execution status:

- the React shell now uses World, Code, Playtest, and Assets as its primary workspaces, with Guide kept under Help
- the main shell no longer presents a built-in development assistant or provider controls
- `engine_sessiond` now owns workspace-scoped agent registration, private credentials, hierarchical leases, writer fairness, expiry, disconnect cleanup, and build/runtime exclusivity
- `engine_sessiond` now also owns a hardened revision-safe text-file write operation workflow with preview, SHA-256 revisions, structured conflicts, approval, journaled apply/undo, journaled code-trust effects, serialized CLI provenance transitions, immutable workspace identity, append-only recovery provenance, loopback-only bind, local Origin filtering, provenance, SSE events, and restart-safe history
- the shell now exposes durable active-workspace operation provenance and lease-free summary review through the global Activity bottom dock; exact public diffs and Activity apply/undo remain gated
- Shader Forge MCP (`sf-mcp`) is the current process-scoped stdio adapter for external clients
- `sf-mcp` now exposes the first lease-gated spatial attachment preview/review/apply/undo workflow through the shared operation contract; generic mutation remains disabled
- the native spatial tool now emits deterministic rest-pose bone/socket/hand/item frames and joint-segment endpoints for one attachment; sessiond exposes that schematic through a revision-safe transient GET and exact baseline/candidate preview responses, with expected-ID binding and no persisted evaluation or false review-evidence claim
- the Assets workspace now exposes that native evaluation in an accessible responsive three-pane rest-rig workbench with exact revision/operation evidence binding, three orthographic projections, coordinates/diagnostics, fail-closed report guards, fixed cached visuals, and authoritative operation reconciliation through App's one SSE subscription
- prefab/scene/runtime now share a strict authored perspective-camera source: one root `player_camera` drives composed-transform/FOV/clip projection, ordinary scenes retain an explicit legacy fallback, and stale quickloads or parented player cameras fail closed; native frame capture and review packets remain open
- fixture-backed Unity, Unreal, and Godot project migration now preserves startup-scene intent through exact source-setting provenance, deterministic duplicate-scene disambiguation, fail-closed unresolved declarations, and visibly approximated no-declaration fallback; emitted records pass the production asset baker while source asset payload conversion remains `Manual`

## 1. Executive Decision

Shader Forge is on the right path if it becomes an **agent-native game engine**, not another editor with an AI chat panel attached.

The product promise should be:

> Build, inspect, run, test, and package games through normal visual and code workflows, while external AI development tools can safely operate the same engine through MCP.

That creates a meaningful distinction from Unreal Engine and Unity:

- engine state is inspectable and mutable through structured tools
- projects remain code- and text-backed rather than trapped in opaque editor state
- every agent change can be previewed, validated, approved, traced, and undone
- visual editing, command-line editing, and agent editing use the same engine-owned operations
- the editor focuses on authoring and verification instead of hosting an AI conversation

Shader Forge should not yet claim feature parity with Unreal or Unity, or that it can already create every kind of game. The credible route to that ambition is to prove complete game-making loops across representative genres, then broaden the runtime without weakening the authoring contract.

## 2. Fixed Product Decisions

These decisions govern the redesign and should be treated as non-negotiable until evidence justifies changing them.

1. **External agents own the AI experience.** Codex, Claude, Cursor, and other MCP clients provide chat, planning, model selection, and context management.
2. **Shader Forge owns the engine control plane.** The engine exposes structured resources and tools through MCP, backed by the same services used by the shell and CLI.
3. **There is no built-in AI assistant.** Remove provider pickers, model configuration, chat composer, token controls, and general-purpose assistant panels from the main editor.
4. **The editor shows agent work, not agent conversation.** Surface proposed changes, diffs, approvals, validation, provenance, test results, conflicts, and undo.
5. **React, TypeScript, and Vite remain the shell stack.** Do not introduce another shell framework or a second component architecture.
6. **The native runtime remains a separate process initially.** The shell controls and observes it truthfully; it does not fake an embedded viewport.
7. **The project is the source of truth.** Code, scenes, assets, settings, and generated outputs remain inspectable on disk.
8. **No control appears functional unless it is wired.** Unsupported commands are removed, disabled with a clear reason, or marked as an explicit preview.
9. **Safety precedes autonomous mutation.** Atomic writes, revision checks, validation, diffing, and recovery are required before broad agent write access.
10. **One current shell replaces the dual-shell state.** Legacy code may be mined for proven behavior, but it does not remain a parallel product surface.
11. **Multi-agent coordination is engine-owned.** External agents receive identified sessions, isolated change sets, and resource-scoped concurrency. The engine coordinates conflicts and serializes only operations that genuinely require exclusive runtime access.

## 3. Product Positioning

### 3.1 Category

Use **agent-native game engine** as the primary category. “AI-native” can remain marketing language, but the product architecture must explain what it means:

- complete, structured engine control through MCP
- deterministic build, run, inspect, and test operations
- machine-readable project and runtime state
- reversible agent-authored changes
- no dependency on one model vendor or one AI client

### 3.2 Primary Users

- AI-assisted solo developers who want an agent to perform real engine work
- small technical teams that prefer code-first, inspectable projects
- tool builders integrating their own agents or automated pipelines
- experienced engine users frustrated by opaque editor state and manual repetition

### 3.3 Initial Proof Standard

Do not measure progress by the number of panels or subsystems named in specifications. Measure it by end-to-end creation loops that work without hidden manual repair.

The first proof set should cover:

- a 3D character or vehicle game
- a 2D game
- a UI-heavy game
- a procedurally generated game

Each proof project must support create, edit, run, debug, test, save, reload, and package workflows through both human UI and external MCP-assisted operation. Multiplayer, massive-world streaming, console deployment, and cinematic production become product claims only after equivalent proof projects exist.

## 4. Target Product Architecture

```text
External AI clients
(Codex / Claude / Cursor / custom agents)
              |
              | MCP: resources, tools, events
              v
Shader Forge MCP adapter (`sf-mcp`)
              |
              | engine-owned typed operations
              v
engine_sessiond / engine CLI / runtime services
              |
       +------+------+
       |             |
       v             v
React shell      Native runtime
(author/inspect) (play/render/debug)
              |
              v
      project files and assets
```

The shell, CLI, and MCP adapter must call the same operations. Do not implement a separate “AI path” that edits project files differently from the editor.

### 4.1 Multi-Agent Coordinator

The MCP adapter must sit on an engine-owned coordinator rather than forwarding every client into one global bridge queue.

- each agent registers an identified, workspace-scoped session
- agents declare the resources and access modes required by an operation
- concurrent reads and non-overlapping writes may proceed in parallel
- overlapping writes and read/write conflicts are queued with visible ownership
- hierarchical resources allow a scene lease to conflict with its entities while unrelated scenes remain independent
- runtime, build, cook, and package operations use explicit workspace-scoped exclusive resources where required
- leases have heartbeats, expiry, cancellation, and disconnect cleanup
- queued work is promoted fairly so a continuous stream of reads cannot starve a waiting writer
- project mutations are staged as separate change sets and merged only after revision checks and validation
- the shell exposes active agents, scopes, leases, queued work, conflicts, and recovery state

The coordinator does not run or chat with agents. It provides the concurrency, isolation, and transaction rules that every MCP client must obey.

### 4.2 MCP Boundary

Shader Forge MCP, shortened to `sf-mcp`, starts as a process-scoped stdio MCP server launched by each client. It accepts stable `--root`, `--session`, `--base-url`, and `--name` startup inputs, registers one coordinator agent per process, keeps its credential private, heartbeats while connected, and disconnects on shutdown.

The base surface exposes `shaderforge://project`, `shaderforge://coordination`, project/file inspection, coordination inspection, lease request/status/release, and explicit heartbeat. The first mutation widening adds bounded operation list/read, spatial attachment preview, separate approve/reject, and spatial-only apply/undo. MCP identity and credentials come from process state, while every spatial mutation requires an owned granted covering lease and repeats authorization inside sessiond.

The shared text-file preview, revision, structured diff, journaled apply, approval, provenance, validation, conflict, and recovery contract now exists in `engine_sessiond`. Spatial attachment GET stages and evaluates exact current bytes without a lease or journal write; preview returns transient exact baseline/candidate evaluations and rechecks its lease after evaluator work before operation creation. All supported mutations, including CLI provenance promote/quarantine and MCP spatial attachment operations, go through that sessiond mutation authority and the serialized SessionStore lane. Code-trust artifact recording is a journaled idempotent effect that must succeed before apply is durable; prior-artifact snapshots persist before source bytes change, and undo provenance precheck plus restore cannot interleave with a later transition. Artifact files use serialized atomic replacement. Workspace identity is path plus filesystem identity. Session roots are immutable after creation, bind hosts stay loopback-only, and recovery appends events instead of rewriting history. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee. Generic file or scene writes, build/runtime mutation, and HTTP transport stay excluded from MCP until their operation families carry authoritative resource keys and policies. Actor strings are local provenance, not cryptographic attribution. If HTTP transport later becomes required, bind it to loopback, require an unguessable session credential, restrict origins, and expose only the MCP operation surface.

Do not expose the current broad `engine_sessiond` filesystem and PTY authority directly as the public MCP boundary.

### 4.3 Target MCP Resources After Safety Gates

These widen beyond the current base and spatial-mutation surface only as the underlying engine contracts become safe and shared:

- project identity, configuration, and revision
- scene graph and selected entity
- component schemas and current values
- asset registry and import status
- source files and diagnostics
- build configuration and last build result
- runtime state, logs, profiler summary, and current play session
- test catalogue and recent results
- engine reference guide and capability manifest
- pending change sets, approvals, and operation history
- connected agent sessions, active leases, declared scopes, and queued operations
- later spatial skeleton, attachment-profile, and immutable `reviewId` packet resources, only after engine spatial operations exist. See [ENGINE-SPATIAL-AUTHORING-SPEC.md](../docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

### 4.4 Target MCP Tools After Safety Gates

The following is the intended product surface, not the currently exposed first slice:

- `project_open`, `project_validate`, `project_build`, `project_package`
- `scene_query`, `scene_create`, `scene_patch_preview`, `scene_patch_apply`
- `entity_create`, `entity_update`, `entity_delete`, `entity_duplicate`
- `asset_import`, `asset_reimport`, `asset_move`, `asset_delete_preview`
- `code_read`, `code_patch_preview`, `code_patch_apply`, `diagnostics_query`
- `runtime_run`, `runtime_pause`, `runtime_stop`, `runtime_inspect`
- `test_list`, `test_run`, `test_result_read`
- `change_set_read`, `change_set_approve`, `change_set_reject`, `change_set_undo`
- `agent_session_register`, `agent_session_heartbeat`, `agent_session_disconnect`
- `work_lease_request`, `work_lease_status`, `work_lease_release`
- `change_set_create`, `change_set_validate`, `change_set_merge`
- implemented read-only, idempotent `spatial_attachment_read` for exact revision-bound rest or authored sampled evidence, plus mutation tools `spatial_attachment_preview`, `operation_approve`, `operation_reject`, and spatial-only `operation_apply` / `operation_undo`; typed spatial validate/review/recapture tools remain gated on their matching engine operations

Names may be refined in the MCP specification, but the contract must remain small, composable, typed, and versioned. Spatial MCP tools are adapter-only. They are specified in [ENGINE-SPATIAL-AUTHORING-SPEC.md](../docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md) and must not wrap `/api/files/write` or scrape a live camera.

### 4.5 Mutation Contract

Every mutating operation must support:

- project and document revision preconditions
- a dry-run or preview result
- a structured before/after diff
- validation errors tied to fields or files
- atomic application
- actor and client provenance
- an operation identifier and timestamp
- an undo or compensating operation where safe
- a clear conflict response when the source changed after preview

The scene serialization layer must preserve unknown fields and comments or use a structured lossless representation before agents receive general scene-write access.

## 5. Target Information Architecture

The current shell exposes too many competing tab systems and mixes project setup, diagnostics, authoring, runtime controls, and AI configuration. Replace it with four primary workspaces.

| Workspace | Primary purpose | Left sidebar | Main canvas | Right sidebar |
| --- | --- | --- | --- | --- |
| World | Build scenes and entities | Scenes and hierarchy | Viewport or honest scene representation | Inspector / Changes |
| Code | Edit and understand source | Explorer and source control | Monaco editor and diffs | Outline / Problems / Changes |
| Playtest | Run and verify the game | Sessions and tests | Runtime view or launch state | Runtime inspector / Results |
| Assets | Import and manage content | Folders and filters | Grid or list browser | Asset inspector / Import settings |

Global supporting surfaces:

- **Project switcher:** start/open/create/recent projects; not a permanent editor sidebar
- **Bottom dock:** Terminal, Output, Problems, Logs; collapsed by default and resizable by keyboard
- **Activity and Changes:** contextual right-sidebar view plus a global history entry point
- **Help:** searchable reference guide, shortcuts, and diagnostics
- **Command palette:** one searchable route to commands and navigation

Merge the existing Game and Preview concepts into Playtest. Move Guide under Help. Keep source control as a Code sidebar mode or bottom-dock surface rather than a primary workspace.

## 6. Shell Layout

### 6.1 Global Frame

The shell should have four stable regions:

1. compact title and command bar
2. primary workspace rail
3. workspace-specific content with optional sidebars
4. collapsible bottom dock and status bar

The center canvas must dominate. Sidebars should remember their size per workspace and collapse independently.

### 6.2 Command Bar

Keep only commands that work:

- project name and dirty/conflict state
- command palette/search trigger
- build target
- Build
- Run or Stop
- connection status for runtime and MCP clients
- overflow menu for secondary actions

Remove decorative File/Edit/View-style buttons until they open functioning menus with enabled, disabled, and shortcut states.

### 6.3 Status Bar

Show concise, actionable state:

- project and branch
- diagnostics count
- build state
- runtime state
- connected MCP client count
- pending approvals or conflicts

Status items open the relevant surface. A colored dot without a text label is insufficient.

## 7. Screen-by-Screen Redesign

### 7.1 Project Start and Switcher

Purpose: get into a real project without consuming permanent editor space.

Required content:

- recent projects with path, last-opened state, and compatibility status
- Open Project
- Create Project from a small set of proven templates
- explicit validation or migration errors
- recovery option for an interrupted or invalid session

Remove workspace creation from the editor rail. Templates should exist only when their projects build and run in the harness.

### 7.2 World Workspace

Purpose: author actual scene state.

Required structure:

- scene list and hierarchy on the left
- central viewport when the native renderer integration can supply one
- until then, an explicitly labelled scene canvas that does not imitate a rendered viewport
- selection, multi-selection, create, duplicate, rename, reparent, and delete
- transform editing with validated numeric fields
- component add/remove/edit using engine component schemas
- breadcrumbs and search/filter for large hierarchies
- Changes view for pending external-agent modifications

Required viewport interactions when real rendering is available:

- click and box selection
- translate, rotate, and scale gizmos
- local/world orientation
- frame selection
- camera orbit, pan, zoom, and speed controls
- grid and snapping
- play-from-here or run-current-scene

Do not build bespoke controls for systems without runtime support. Generic schema-driven component fields are acceptable until a real workflow proves the need for a specialized editor.

### 7.3 Code Workspace

Purpose: provide a credible code-first workflow instead of explanatory cards.

Implemented foundation: the default shell surface now owns bounded file browsing, revision-bound Monaco tabs, inline current-file search beside `Inspect`, baseline/draft diffing, dirty-draft retention across navigation and session detachment, typed conflict recovery, and explicit file-operation Preview/Approve/Reject/Apply/Undo. The legacy editor is now optional. Diagnostics/Problems navigation, tighter source-control integration, and final legacy retirement remain open.

Reuse the proven legacy behaviors where useful, then retire the legacy entry point:

- Monaco editor
- file explorer
- open-file tabs
- inline file search beside Inspect
- diagnostics and Problems navigation
- diff view
- terminal integration
- source-control status
- file context and reference guide lookup

Do not carry forward the legacy assistant chat, provider selection, prompt composer, or model controls.

The default Code screen must open a file or useful project overview, not a collection of placeholder feature cards.

### 7.4 Playtest Workspace

Purpose: run, observe, and verify games.

Required content:

- clear Run, Pause, Resume, Reload, and Stop state machine
- build progress and failure reason
- active runtime session identity
- native runtime launch/focus controls while embedding is unavailable
- live logs and diagnostics
- test list and recent results
- runtime entity/component inspection when supported
- input focus and capture state
- screenshot or artifact access for failed visual tests

The central area must truthfully describe whether the game is embedded, launching externally, running externally, stopped, or failed. Remove the empty grid that currently implies an unavailable game view.

### 7.5 Assets Workspace

Purpose: make content ingestion predictable and inspectable.

Required content:

- folder tree and asset filters
- grid/list density toggle
- drag-and-drop and file-picker import
- import queue with progress and errors
- asset preview appropriate to supported asset types
- metadata, dependency, and usage inspection
- reimport, rename, move, and delete-preview actions
- generated/cooked status separated from source assets
- conflict-safe handling of agent and human asset operations

Implemented specialized slice: attachment profiles open in a three-pane workbench with constrained tuning and native-evaluated rest/sampled rig schematics. Rest/sample evidence binds exact animation, content, and foundation revisions. The evaluator resolves render procgeo and authored prefab collision independently through `DataFoundation`; Assets draws both boxes plus diagnostic capsule segments and shows diagnose-only joint-limit aggregate/per-bone `PASS`/`FAIL` plus capsule/item surface-clearance aggregate/per-capsule `CLEAR`/`OVERLAP`. Missing authored inputs remain exact unavailable evidence, and tangency is `CLEAR`. This is schematic diagnostic evidence only, never a rendered mesh, runtime collision result, camera capture, or review packet. Draft edits never move cached geometry; v1 two-hand samples remain pre-IK and v2 exposes applied-IK reach/contact/angular/joint/clipping truth.

Specialized material, animation, audio, or VFX editors should be added only after their runtime pipeline is functional and a generic inspector is demonstrably insufficient.

### 7.6 Inspector

The Inspector is contextual, not a dumping ground.

It should show only the selected entity, asset, file symbol, runtime object, or change set. Use consistent sections, labels, validation, reset-to-default, and changed-value indicators.

Move packaging, profiling, code trust, provider readiness, and unrelated diagnostics out of the Inspector. Route them to commands, Playtest results, project settings, or Help > Diagnostics.

### 7.7 Activity and Changes

This is the visible agent-native surface.

Each entry should show:

- action summary
- originating client and actor
- affected files, scenes, assets, or entities
- status
- validation and test result
- approval requirement
- inspect diff
- approve, reject, retry, or undo when applicable

Supported states:

- disconnected
- connected and idle
- inspecting
- change proposed
- approval required
- applying
- validating
- running checks
- succeeded
- failed
- stale or conflicted
- rejected
- rolled back

Do not display chain-of-thought, hidden model reasoning, token counters, or a chat transcript. The editor needs operational evidence, not the agent’s conversation.

### 7.8 Settings and Diagnostics

Project settings should contain only engine and project configuration. Developer diagnostics should contain service connectivity, versions, environment checks, logs, and copyable remediation steps.

Local-model smoke tests and AI provider configuration do not belong in the main product UI. If still needed for engine runtime AI features, keep them in a dedicated project setting or CLI command, clearly separated from external development agents.

## 8. Core Workflows

### 8.1 Human Authoring

```text
Open project -> choose workspace -> select object -> edit -> validate -> save -> run -> inspect result
```

The shell should never require an agent for normal authoring.

### 8.2 Agent-Assisted Change

```text
MCP client connects
-> reads project capabilities and relevant resources
-> submits a change preview
-> engine validates and produces a diff
-> shell shows the proposed change
-> policy auto-approves or requests user approval
-> engine applies atomically
-> requested build/tests run
-> shell records results and provenance
-> user can inspect or undo
```

### 8.3 Conflict Handling

```text
Agent previews revision A
-> human edits document to revision B
-> agent apply is rejected as stale
-> shell shows the conflict and affected documents
-> agent re-reads and proposes a new change
```

Never silently overwrite a newer human or agent change.

### 8.4 Failure Recovery

Any failed mutation, import, build, run, or package operation must leave the project in a known state and produce:

- a plain-language summary
- structured error details
- affected resources
- safe retry guidance
- logs or artifacts
- rollback status

## 9. Visual and Interaction System

### 9.1 Visual Direction

Aim for a calm professional tool, not a sci-fi dashboard.

- neutral dark surfaces with clear elevation and restrained borders
- one accent color for selection and primary action
- semantic colors reserved for success, warning, error, conflict, and running state
- consistent spacing based on a small token scale
- readable default text; metadata should not rely on 9–11 px type
- strong focus, hover, selected, disabled, dirty, and error states
- icons paired with labels where meaning is not universally obvious

### 9.2 Component Set

Build a small internal component set from existing React and CSS:

- Button and IconButton
- Tabs
- Toolbar
- Tree row
- Field and validation message
- Select and combobox
- Split pane
- Panel header
- Status badge
- Empty state
- Toast and persistent notification
- Dialog
- Context menu
- Data list/table

Do not add a full UI framework or speculative component library. Add a component only when at least one redesigned screen needs it.

### 9.3 Density

Support one deliberate editor density first. Controls should generally provide a 32–36 px interaction target, with denser tree rows allowed when keyboard navigation and clear focus are present. Preserve user-adjustable panel sizes and avoid permanently visible explanatory copy.

### 9.4 Empty, Loading, Error, and Offline States

Every major surface must define:

- no project
- no selection
- empty collection
- loading
- partial data
- service offline
- permission denied
- validation error
- stale data
- operation in progress

Empty states should provide one useful next action, not marketing copy.

## 10. Accessibility and Keyboard Model

Accessibility is a release requirement, not a polish phase.

- implement correct landmark hierarchy
- use tablist, tab, and tabpanel semantics for tabs
- label all status, select, search, close, and icon-only controls
- expose operation changes through suitable live regions
- support full keyboard navigation in menus, trees, tabs, panels, and dialogs
- provide keyboard resizing or discrete resize commands for split panes
- preserve visible focus at all times
- meet WCAG AA contrast for text and essential controls
- ensure errors are identified by text as well as color
- keep pointer targets usable without reducing information density excessively
- provide a documented shortcut map and command-palette discovery

Baseline shortcuts:

- command palette
- quick open
- global search
- build
- run/stop
- focus World, Code, Playtest, or Assets
- toggle left sidebar, right sidebar, and bottom dock
- focus next panel
- save
- undo/redo

## 11. Responsive and Window Behaviour

Shader Forge is a desktop authoring tool. Do not build a mobile editor.

Required window behavior:

- a supported minimum desktop width and height
- sidebars collapse rather than silently disappear
- panel layouts remain recoverable through Reset Layout
- reduced-width mode keeps the active workspace usable
- no fixed-height layout that traps content behind `overflow: hidden`
- zoom and operating-system text scaling do not make essential commands unreachable
- terminal, logs, and dialogs resize without covering unrecoverable content

## 12. Architecture Uplift

### 12.1 Consolidate the Shell

Make the React/Vite shell the only product shell and development entry point. Move proven behavior from `web/` into focused React modules, verify it, then remove the equivalent legacy runtime path.

Preserve the required inline file-search behavior beside Inspect during migration.

### 12.2 Decompose by Product Surface

Break the current large application files along actual workspace boundaries, not abstract architectural layers:

```text
src/
  app/
  workspaces/world/
  workspaces/code/
  workspaces/playtest/
  workspaces/assets/
  panels/activity/
  panels/bottom-dock/
  components/
  engine-client/
```

Keep state local to a workspace unless multiple workspaces genuinely consume it. Avoid a new global state library until React state and existing patterns are proven insufficient.

### 12.3 Engine Client Contract

The shell should consume a typed client for engine-owned operations and events. This client should normalize connection, request, error, cancellation, and revision handling. It must not contain UI components or provider-specific AI logic.

### 12.4 Capability Discovery

The engine should publish a machine-readable capability manifest. The shell and MCP clients use it to determine what operations, asset types, components, runtime features, and packaging targets actually exist.

Unsupported capabilities are hidden or disabled with a reason. The UI must not infer support from placeholder panels.

### 12.5 Persistence

Persist only user-owned workspace preferences such as panel sizes, open files, active workspace, and density. Project state stays in project files or engine-owned storage. Session state must be versioned and recoverable if a layout becomes invalid.

## 13. General-Purpose Engine Capability Tracks

The shell redesign alone will not make Shader Forge an alternative to Unreal or Unity. The following tracks must become real, testable engine workflows. UI is added as each capability becomes operational.

| Track | Minimum credible capability |
| --- | --- |
| Project lifecycle | create, open, validate, migrate, build, run, test, package |
| 3D rendering | meshes, materials, textures, lighting, cameras, shadows, post-processing |
| 2D rendering | sprites, atlases, tilemaps, 2D cameras, sorting, 2D animation |
| Scenes and prefabs | composition, nesting, overrides, references, safe serialization |
| Gameplay code | stable APIs, hot reload or fast rebuild, diagnostics, debugging |
| Input | remappable actions, keyboard, mouse, controller, context handling |
| Physics | 3D and 2D integration appropriate to supported game claims |
| Animation | skeletal import, graphs/state machines, blending, events, root motion |
| Spatial authoring | foundation implemented: skeleton sockets, compatible v1/strict v2 profiles, strict optional cone-twist/capsule metadata with deterministic cooking, strict optional prefab-only box collision in `DataFoundation`, deterministic sampling and v2 two-bone IK, strict native/CLI and revision-safe sessiond rest/sample queries, exact baseline/candidate preview, lease-free operation validation, native apply/undo revalidation, constrained Assets tuning, shared CLI/MCP apply, exact independent visual/collision geometry, diagnose-only joint-limit and capsule/item surface-clearance evidence through Assets, and typed revision-bound MCP rest/sample reads. Animation/content/foundation revisions are staged together. A strict authored runtime perspective camera now exists, but deterministic capture must revision-bind it and may not use the runtime fallback. Runtime collision/physics integration, native frame capture, immutable review packets, and thin CLI/MCP validation/recapture/review adapters remain open. |
| Audio | spatial audio, buses, mixing, streaming, events |
| Game UI | layout, styling, input, localization path, accessibility hooks |
| Assets | import, cook, cache, dependencies, reimport, provenance |
| Runtime inspection | logs, entities, components, performance, captures |
| Testing | deterministic unit, scene, runtime, input, and visual checks |
| Packaging | reproducible standalone builds for each advertised platform |
| Persistence | save data, versioning, migration, failure recovery |
| Extensibility | documented modules and schemas before a plugin marketplace |

Networking, large-world streaming, consoles, VR/XR, cinematics, and live services should be separate proof tracks. Do not imply support until each has a complete reference project and packaging path.

Current migration proof is intentionally narrower than the full Project lifecycle target. Unity's first enabled `EditorBuildSettings` scene, Unreal `GameDefaultMap`, and Godot `res://` `run/main_scene` resolve against exact source-relative scene records and emit setting-level source/target provenance. An explicit unresolved value emits no bootstrap and a manual task; no declaration selects the first source-relative scene deterministically and marks it `approximated`. Duplicate basenames are disambiguated deterministically, emitted records are production-bake validated, and `asset_conversion` remains `Manual` until payload import exists.

## 14. Dependency-Gated Execution Plan

There are no time phases. A gate is complete only when its exit criteria pass.

### Gate 0: Resolve Product and Specification Contradictions

Actions:

- adopt the external-agent MCP model as the canonical AI-assisted development architecture
- update the implementation plan and affected AI, shell, CLI, session, scene, and code-trust specs
- separate game-runtime AI features from development-agent integration
- define the initial capability manifest and MCP contract
- identify legacy UI behavior to migrate, remove, or deliberately retain
- define the supported desktop window floor and browser/runtime assumptions

Exit criteria:

- no active specification describes a built-in development assistant as the primary workflow
- UI, CLI, and MCP operations share named engine-owned contracts
- security, revision, approval, diff, and undo requirements are explicit
- the four-workspace information architecture is approved

### Gate 1: Make Mutations Safe and Observable

Current status: the hardened text-file write operation contract is implemented in `engine_sessiond`, including journaled code-trust effects, serialized CLI provenance transitions, immutable workspace identity, append-only recovery provenance, loopback-only bind, bounded public JSON input, and exact public diffs. The shell consumes durable list/detail and event views in a review-only Activity dock; World consumes revision-bound lease-gated scene/prefab save/create/duplicate; and `sf-mcp` consumes the lease-gated spatial attachment workflow. Multi-file change sets, Activity apply/undo coordination, and non-spatial MCP mutation tools remain open.

Actions:

- completed: replace lossy scene writes with revision-safe, lease-gated semantic operations
- add document hashes or revisions and conflict responses
- add structured previews and diffs for mutations
- add operation provenance and history
- add approval policy hooks and undo/rollback support
- narrow the external process boundary before exposing MCP
- establish workspace-scoped agent sessions, resource leases, conflict queues, heartbeat expiry, and disconnect cleanup

Exit criteria:

- stale edits cannot overwrite newer project state
- interrupted writes do not corrupt project files
- every mutation can be traced to a human, shell, CLI, or MCP client through local provenance strings; cryptographic attribution is still later work
- representative scene, asset, and code changes can be previewed and validated
- non-overlapping agents can work concurrently while conflicting and runtime-exclusive work is queued deterministically

### Gate 1.5: Establish Spatial Authoring Truth

Status: native schema/query/cook/rest/sample evaluation, strict authored cone-twist/capsule metadata, strict optional prefab box-collision source truth, deterministic v2 two-bone IK, native numeric joint-limit and capsule/item surface-clearance diagnostics, fail-closed sessiond/Assets validation, revision-safe evidence, exact baseline/candidate preview, lease-free operation validation, native apply/undo revalidation through one semantic dispatcher, constrained Assets tuning, the first `sf-mcp` mutation adapter, and read-only revision-bound `spatial_attachment_read` are implemented. Sessiond stages and revision-binds animation, all content TOML, and the foundation manifest; operation validation verifies private proposed bytes, evaluates rest plus bounded requested samples, rejects manifest/CAS drift, and journals only controlled counts/failures. V1 two-hand samples remain pre-IK; v2 exposes physical reach plus contact/angular/joint/clipping truth. A strict root `player_camera` prefab component now supplies runtime perspective truth, but review capture must revision-bind it and cannot use the ordinary runtime fallback. Runtime collision/physics integration, native frame capture, immutable review packets, generic bake/runtime consumption, recapture, and typed CLI/MCP validation/review adapters remain open. Canonical contract: [ENGINE-SPATIAL-AUTHORING-SPEC.md](../docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

This gate is ordered after the operation layer and before broad World/Assets visual polish. Shell Code/Playtest work and unrelated capability tracks may proceed in parallel. World/Assets gizmos must not invent a second grip or socket persistence path while this gate is open.

Actions:

- widen skeleton assets to explicit bone hierarchy, semantic roles, and sockets without pretending the current `hips, spine, head` metadata already is that schema
- add source-controlled attachment profiles with primary grip, optional secondary-hand target/pole/tolerances, and named motion-envelope phases
- keep native code as the only runtime interpreter; assets own tuning values
- add spatial preview/validate/approve/apply/recapture/undo as operation kinds on the existing `engine_sessiond` journal
- share one `reviewId` and an immutable review packet with explicit cameras, resolution/framing, lighting, pose samples, revisions, evaluated transforms/bounds, diagnostics, captures, operation id, and all lease ids
- use hierarchical leases for skeleton, socket, attachment, review, and short runtime-capture exclusivity
- expose `sf-mcp` spatial tools only as an adapter after shell and CLI already call those operations
- add a deterministic harness with a real humanoid bone chain and two-hand weapon; do not retarget `debug_humanoid` or require cross-GPU PNG hashes

Exit criteria:

- attachment values are not duplicated as native constants, prefab copies, generated editable code, or hidden editor databases
- preview candidates are labelled and do not apply until the operation journal says so
- VLM or visual scores never apply
- denied approvals, stale revisions, and undo match the existing mutation contract
- current proxy-card rendering is not presented as spatial-review evidence
- the Assets rest/sampled rig schematics remain explicitly non-review evidence and cannot satisfy review-packet or capture gates

### Gate 2: Establish the New Shell Foundation

Actions:

- make React/Vite the canonical shell entry point
- implement the global frame, four workspaces, command palette, status bar, sidebars, and bottom dock
- create the small shared component and token set
- implement semantic tabs, focus handling, and keyboard panel navigation
- persist and reset workspace layouts
- remove or disable dead top-menu controls

Exit criteria:

- the shell has one navigation model
- all visible global controls work
- keyboard-only navigation reaches every global region
- minimum supported window size remains usable
- no built-in assistant or provider UI remains in the main frame

### Gate 3: Deliver the Code and Project Workflows

Actions:

- implement the project start/switcher surface
- migrate Monaco, file explorer, inline search, diagnostics, diffs, source-control status, and terminal behavior
- remove explanatory placeholder cards
- connect file revisions and external-change conflict handling
- retire the equivalent legacy Code entry point after parity checks

Current status: the native open/edit/search/diff/review/apply/undo path is implemented and rendered at desktop plus compact breakpoints. Remaining Gate 3 work is diagnostics/Problems, source-control context, project switching, and removing the optional legacy bridge after parity evidence.

Exit criteria:

- a user can open a project, edit code, navigate diagnostics, search, inspect a diff, build, and run without entering the legacy shell
- the inline file-search control beside Inspect remains available
- external file changes are detected and never silently overwritten

### Gate 4: Deliver World and Asset Authoring

Actions:

- implement reliable hierarchy, selection, transform, component, and scene operations
- clearly label the non-rendered scene canvas until a real viewport exists
- connect a real viewport only when selection, camera control, and gizmos work end to end
- implement the asset browser, import queue, inspection, dependency view, and safe file operations
- expose agent-proposed scene and asset changes through Changes
- consume the spatial-authoring contract for held items, sockets, and attachment tuning instead of copying grip fields into prefabs or scraping the live camera. Broad visual polish of World/Assets must not precede that contract for attachment editing. See Gate 1.5 and [ENGINE-SPATIAL-AUTHORING-SPEC.md](../docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

Exit criteria:

- a scene can be created, edited, saved, reloaded, and inspected without data loss
- an asset can be imported, reimported, located in the project, and used in a scene
- agent and human edits conflict safely
- no placeholder viewport is presented as rendered game output

### Gate 5: Deliver Playtest and Verification

Actions:

- merge Game and Preview into Playtest
- implement the runtime state machine and honest external-window handoff
- connect build, run, pause, reload, stop, logs, diagnostics, and tests
- add runtime inspection as engine support becomes available
- fix packaging path correctness before presenting packaging as ready

Exit criteria:

- runtime state in the shell always matches the actual process
- build and runtime failures are actionable
- test results link to logs and artifacts
- a supported project can be packaged from the same engine operation used by CLI and MCP

### Gate 6: Expose the MCP Control Plane

Current status: the process-scoped stdio adapter now covers read/coordination plus lease-gated spatial attachment preview/review/apply/undo. The shell Activity dock consumes operation history and lease-free review events. Generic scene/asset/code mutation, build/runtime tools, Activity apply/undo, and full parity scenarios remain open.

Actions:

- implement the process-scoped MCP adapter
- require MCP clients to register with the multi-agent coordinator before mutating or invoking exclusive operations
- publish the initial resources, tools, capability manifest, and version information
- connect operations to Activity and Changes
- implement approval, rejection, retry, conflict, and undo flows
- add client identity and connection status without adding chat UI
- publish example configurations for supported MCP clients

Exit criteria:

- an external agent can create or modify a representative scene, edit code, import an asset, build, run tests, and package through structured tools
- every proposed mutation is previewable and attributable
- policy-required approvals block application
- disconnects and failures leave the project consistent
- the same operation produces equivalent results from shell, CLI, and MCP
- multiple clients can complete non-overlapping work concurrently without sharing one global bridge lock

### Gate 7: Prove Representative Games

Actions:

- build and maintain the 3D, 2D, UI-heavy, and procedural reference games
- turn repeated manual repair into engine capabilities or tooling fixes
- add deterministic harnesses for each full creation loop
- document unsupported genres and platform constraints honestly

Exit criteria:

- every reference game builds, runs, tests, saves, reloads, and packages from a clean checkout
- an external agent can perform a meaningful feature change in each project using documented MCP operations
- failures identify the responsible subsystem rather than collapsing into a generic shell error
- product claims match demonstrated capability

### Gate 8: Remove the Transitional Architecture

Actions:

- delete the retired legacy shell entry point and duplicated styles/scripts
- remove obsolete assistant/provider UI and compatibility branches
- remove placeholder panels and dead commands
- consolidate harnesses around rendered React workflows and engine contracts
- update all user-facing guides and reference data

Exit criteria:

- one shell, one navigation model, and one engine operation path remain
- Vite no longer copies a second application for normal operation
- no current documentation directs users to the retired shell
- repository tests exercise the product users actually run

## 15. Verification Strategy

### 15.1 Shell Tests

Replace source-regex confidence with rendered behavior checks for:

- project open and recovery
- workspace navigation
- keyboard and focus movement
- hierarchy selection and editing
- Monaco open/edit/save/external-change flow
- command palette
- panel resizing and layout reset
- runtime state transitions
- Activity and Changes states
- approval, rejection, conflict, and undo
- accessibility landmarks, names, roles, and live updates

### 15.2 Contract Tests

Run the same scenario against shell, CLI, and MCP adapters and compare resulting project state:

- create entity and component
- patch transform
- edit source file
- import asset
- preview/validate/apply an attachment-profile candidate once spatial operations exist, including stale-revision and approval-denial cases
- build and run
- execute tests
- package project
- reject stale revision
- undo applied change

### 15.3 Failure Tests

Cover:

- service unavailable
- client disconnect during operation
- invalid project path
- malformed scene or asset metadata
- stale document revision
- failed validation
- build process crash
- runtime process crash
- packaging path error
- partial asset import
- denied approval
- failed rollback

### 15.4 Visual QA

Maintain screenshots for each workspace at the supported minimum and standard desktop sizes, covering default, empty, loading, error, conflict, approval, and running states. Visual review complements interaction tests; it does not replace them.

## 16. Definition of Done for the Redesign

The redesign is complete when a developer can:

1. create or open a project from the start screen
2. navigate World, Code, Playtest, and Assets without competing tab systems
3. edit a scene and code with real, persistent results
4. import and inspect an asset
5. build, run, inspect logs, execute tests, and package
6. connect an external MCP client
7. review an agent-proposed multi-file or scene change
8. approve it, observe validation, and inspect provenance
9. reproduce a stale-edit conflict without data loss
10. undo the applied change
11. restart the shell and recover the project and layout
12. complete the entire workflow by keyboard where practical

The same scenario must work from a clean checkout and be protected by runnable harnesses.

## 17. Explicitly Removed or Deferred

Remove from the main editor:

- built-in development assistant chat
- AI provider and model selectors
- prompt composer and token controls
- local-model readiness cards unrelated to game runtime AI
- placeholder Game, Preview, and Code feature cards
- dead top-menu buttons
- permanently visible workspace creation
- unrelated diagnostics stacked in the Inspector
- duplicate shell navigation and legacy entry points after migration

Deliberately defer until proven necessary:

- a new UI framework or global state library
- a plugin marketplace
- collaborative cloud editing
- mobile editor layouts
- embedded runtime streaming as a prerequisite for Playtest
- specialized editors for every component type
- speculative autonomous background agents inside the engine
- networking, consoles, VR/XR, cinematics, and massive worlds as product claims

## 18. First Execution Slice

The direction-setting shell and coordination work is now implemented. Continue with the smallest slices that widen the product without creating another temporary shell:

1. completed: amend the canonical specs to external-agent MCP architecture
2. completed: make React/Vite the documented shell and replace top-level navigation with World, Code, Playtest, and Assets
3. completed: remove built-in assistant/provider surfaces from the main workspace while preserving the real Code editor and inline search
4. completed: establish engine-owned multi-agent registration, heartbeat, leases, conflict queues, fairness, and cleanup
5. completed: expose the first Shader Forge MCP (`sf-mcp`) read-and-coordinate surface over process-scoped stdio
6. completed: implement and harden the sessiond-owned text-file mutation preview, revision, line-oriented diff summary, approval, journaled apply/undo, journaled code-trust effects, serialized CLI provenance transitions, immutable workspace identity, append-only recovery provenance, loopback-only bind, local Origin filter, and operation-event contract
7. completed: add a constrained Assets primary-grip tuner over the semantic spatial operation, with explicit exact-profile locking, visible unapplied candidates, separate review/apply, and fresh-lease undo
8. completed: add the global Activity history and summary-review state model over authoritative operation list/detail reads, public operation events, and lease-free approve/reject
9. completed: expose lease-gated `sf-mcp` spatial attachment preview/review/apply/undo with process-owned identity and credentials, selected-workspace checks, structured conflict recovery, and no generic write bypass
10. completed: add deterministic native and CLI rest-pose attachment evaluation with machine-readable bone/socket/hand/item frames and joint segments, while labelling it unsampled and not review evidence
11. completed: expose revision-safe transient sessiond evaluation plus exact baseline/candidate preview reports with expected-ID binding, no GET lease/journal/persistence, and a post-evaluation preview lease recheck
12. completed: add the Assets native-evaluated rest-rig schematic with exact authored/candidate binding, fixed cached evidence, Front/Side/Top projections, deep fail-closed guards, exact coordinates/diagnostics, accessible responsive layout, and one-SSE authoritative operation reconciliation with captured-connection cleanup
13. completed: add strict schema-v2 bone tracks and deterministic native pose sampling with interpolation, rest fallback, parent-composed world transforms, schema-v1 compatibility, and transactional validation
14. completed: feed exact authored envelope samples into native primary-attachment geometry, expose strict native/`engine` CLI sampled queries, and retain explicit v1 pre-IK and one-hand procedural-layer truth without claiming review evidence
15. completed: implement deterministic v2 two-bone secondary-hand IK with item-space pole, palm-socket effector, limb-length preservation, fail-closed chain/math validation, unreachable clamping, and separate reach/contact/angular residuals and tolerances
16. completed: expose transient sampled sessiond evidence with exact validator-profile/phase/time validation, complete animation-input revision manifests, dependency-drift conflicts, and no lease/journal/review claim
17. completed: feed exact authored sampled evidence through the Assets shell with independent envelope parsing, native phase/time selection, full source-revision binding, stale-response guards, v1 pre-IK/v2 applied-IK truth, and explicit non-review labels
18. completed: expose exact prefab-bound authored visual-box evidence through `DataFoundation`, revision-bind animation/content/foundation inputs, and draw the native outline in Assets without a collision or review claim
19. completed: add strict optional schema-v2 cone-twist joint limits and diagnostic capsules to typed skeleton snapshots and deterministic cooking, with v1 rejection and malformed-input coverage
20. completed: add strict optional prefab-only box collision to typed `DataFoundation` snapshots, independent of render procgeo, with compiled malformed/duplicate/wrong-kind rejection coverage
21. completed: serialize native rest/sample cone-twist joint-limit diagnostics through `shader_forge_spatial`, fail-closed sessiond validation against evaluator bones/order/roles and recomputed truth, and diagnose-only Assets aggregate/per-bone PASS/FAIL; unavailable is exact `no_joint_limits_authored`; clamp policy is rejected
22. completed: transform authored diagnostic capsules and the explicit prefab collision box into exact diagnose-only surface-clearance diagnostics, propagate them through sessiond/Assets, and expose revision-bound rest/sample evidence through typed `spatial_attachment_read`
23. completed: add lease-free operation-scoped native validation, strict bounded samples, full-manifest/proposed-hash binding, controlled CAS summaries, and lease-gated apply/undo native revalidation through one dispatcher
24. next: expose validation through thin CLI/MCP adapters, then add recapture, revision-bound native frame capture from the authored camera plus deterministic close cameras, immutable review packets, and typed review adapters

Do not begin broad MCP mutation tools before their engine-owned operations and resource keys exist. Spatial visual work can now build on the shared authored truth and mutation path without introducing another persistence backend.
