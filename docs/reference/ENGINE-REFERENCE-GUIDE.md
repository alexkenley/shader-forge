# Shader Forge Reference Guide

Searchable operator and assistant wiki for the current Shader Forge shell, session backend, native runtime, tooling, content data, and deterministic verification workflow.

Use this file first from terminal assistants and repo search.

Primary searchable sources:

- `docs/reference/ENGINE-REFERENCE-GUIDE.md`
- `docs/reference/ENGINE-REFERENCE-GUIDE.json`
- `shell/engine-shell/src/reference-guide.ts`
- `plans/ENGINE-IMPLEMENTATION-PLAN.md`
- `docs/specs/ENGINE-SYSTEMS-INDEX.md`
- `docs/specs/ENGINE-MCP-SPEC.md`
- `docs/guides/SHADER-FORGE-MCP-SETUP.md`
- `docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md`
- `AGENTS.md`

Assistant entry points:

- `docs/reference/ENGINE-REFERENCE-GUIDE.md`
- `docs/reference/ENGINE-REFERENCE-GUIDE.json`
- `AGENTS.md`
- `plans/ENGINE-IMPLEMENTATION-PLAN.md`
- `docs/specs/ENGINE-SYSTEMS-INDEX.md`
- `docs/specs/ENGINE-MCP-SPEC.md`
- `docs/guides/SHADER-FORGE-MCP-SETUP.md`
- `docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md`

## Getting Started

### Reference Sources

- Use `docs/reference/ENGINE-REFERENCE-GUIDE.md` as the plain-text guide for terminal assistants and repo search.
- Use `docs/reference/ENGINE-REFERENCE-GUIDE.json` as the structured guide source for the shell and external development agents.
- Use `shell/engine-shell/src/reference-guide.ts` as the shell adapter that imports the structured guide data.
- Use `plans/ENGINE-IMPLEMENTATION-PLAN.md` to check current phase order, progress, and dependency gates.
- Use `docs/specs/ENGINE-SYSTEMS-INDEX.md` to jump to the subsystem specs that define the current architecture.
- Use `docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md` for the implemented native spatial schema/query/cook/rest evaluation, v2 sampled two-bone secondary-hand IK, operation-scoped validation, exact Assets rest/sampled rig workbench, and deferred rendered review workflow.
- Use `AGENTS.md` for repo workflow rules, documentation obligations, and required update discipline.

### Assistant Lookup Workflow

- Start with the markdown guide when you need a quick terminal-readable overview of current behavior.
- Use the JSON guide when an assistant needs structured categories, page ids, references, or search terms.
- Use the implementation plan and subsystem specs to widen from current behavior into target architecture.

### Update Discipline

- When user-facing behavior, shell workflow, runtime control, or assistant-facing engine behavior changes, update the reference guide in the same pass.
- Keep `docs/reference/ENGINE-REFERENCE-GUIDE.md`, `docs/reference/ENGINE-REFERENCE-GUIDE.json`, and `shell/engine-shell/src/reference-guide.ts` aligned so the shell and assistants resolve the same guide.
- Treat the guide as operator and assistant working documentation, not marketing copy or a post-hoc changelog.
- Keep the guide concrete enough that a coding assistant in a terminal can search it and act on it without needing the whole codebase first.

### Native Runtime Setup

- Yes: the guide now has an explicit native-runtime setup section for Windows.
- `.\scripts\start-dev-clean.ps1` now auto-detects CMake, including the copy bundled with Visual Studio, and exports `SHADER_FORGE_CMAKE` when found.
- `.\scripts\install-windows-native-runtime-deps.ps1` is the repo helper for the Windows native-runtime dependency lane.
- If the startup script prints `Using CMake: ...`, CMake itself is not the blocker.
- The real native runtime still requires SDL3 development files plus the Vulkan SDK/loader.
- On Windows, install the Vulkan SDK from LunarG.
- For the current Shader Forge setup, the Vulkan installer should use `The Vulkan SDK Core` only; the extra optional SDK components are not required for this repo right now.
- On Windows, the recommended SDL3 path is `vcpkg`, not Visual Studio Installer.
- Recommended one-step repo helper:
  `powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows-native-runtime-deps.ps1`
- That helper clones `vcpkg` if needed, bootstraps it, installs or rebuilds `sdl3[vulkan]:x64-windows` with `--recurse`, sets `VCPKG_ROOT` and `CMAKE_TOOLCHAIN_FILE` for the current process, and persists them to the user environment by default.
- If `Play` reaches SDL startup and then says Vulkan support is not configured in SDL, the installed SDL3 package is missing the `vulkan` feature; rerun `.\scripts\install-windows-native-runtime-deps.ps1` or run `C:\src\vcpkg\vcpkg.exe install sdl3[vulkan]:x64-windows --recurse`.
- Recommended environment variables for CMake-based Windows runs:
  `VCPKG_ROOT=C:\src\vcpkg`
  `CMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake`
- `.\scripts\start-dev-clean.ps1` now also auto-detects the `vcpkg` toolchain file and the Vulkan SDK when they are installed.
- After installing Vulkan SDK or SDL3 through `vcpkg`, reopen PowerShell and rerun `.\scripts\start-dev-clean.ps1`.
- If build logs say `SDL3 was not found`, `Vulkan was not found`, or `built in stub mode`, that means CMake worked but the native runtime dependencies are still missing.

### Shell Workspace Overview

- The left rail currently exposes `Workspaces`, `Explorer`, and `Source Control`.
- The primary workspace navigation exposes `World`, `Code`, `Playtest`, and `Assets`.
- The right panel currently exposes `Runtime`, `Build`, and `Workspace` in `Code` and `Playtest`, while `World` and `Assets` use the center area directly.
- The bottom dock currently exposes `Terminal`, `Logs`, `Output`, and `Activity`.
- One strict v1 browser record persists the active workspace, each workspace's left/right visibility, selected tabs and preferred widths, and the shared bottom-dock tab, collapsed state, and preferred height. It stores layout chrome only, never sessions, paths, credentials, drafts, operations, or terminal state.
- Use the header `Left`, `Right`, and `Bottom` toggles plus `Reset` to manage layout. Visible panes support bounded pointer and keyboard resizing. At 800 pixels or narrower the right pane becomes an on-demand overlay drawer and its toggle remains reachable.
- `Playtest`, `World`, and `Assets` start with both side panes hidden; `Code` starts with the left pane visible; the bottom dock starts collapsed. Malformed or unavailable browser storage falls back to those defaults.
- The bottom dock can be resized vertically from its top edge and explicitly `Collapse`d, `Restore`d, or `Maximize`d so terminal/log surfaces do not overlap the main workspace.
- The `Workspace` right-panel tab now also exposes export-preset inspection, release-layout readiness, package generation, visible prep state, and last-package summary for the selected workspace.
- The `Workspace` right-panel tab now also exposes a live diagnostics snapshot plus capture-report controls for the selected workspace, including runtime/build state, packaging readiness, stored capture history, and first profiling recommendations.
- The `Workspace` right-panel tab now also exposes the active code-trust policy summary, supported authored hot-reload roots, tracked artifact hashes and verification state, explicit promote/quarantine controls, and pending code-trust approvals for the selected workspace plus the shared engine lane.
- Use `Code` for bounded workspace-file browsing, revision-bound Monaco tabs, inline search beside `Inspect`, source/draft diffing, and explicit Preview/Approve/Reject/Apply/Undo. Unsaved drafts survive shell navigation; changing the active project session keeps foreign dirty tabs read-only and detached until their original session returns. A changed draft stales its prior preview. Request/session/tab/path/operation guards reject late reads, events, and actions; apply/undo refresh the baseline only if the draft still equals the captured pre-action draft. Typed state, revision, and code-trust conflicts preserve the draft and adopt returned operation state only when id, session, and path match.
- The preserved `web/` editor remains available only through `Load legacy bridge` or `Open standalone`; it is not the default Code workflow.
- Use `Playtest` for a compact human loop around the external native runtime window. It names the current world, states whether the game is stopped, building, running, or paused, and shows only state-valid `Play`, `Stop`, `Restart`, `Pause`, or `Resume` actions by default. Build controls, paths, bridge facts, and recent logs stay under collapsed `Diagnostics`, while build and runtime failures remain visible beside the primary surface.
- Use `World` for the plain-language view, verify, play, and tune loop. Its sidebar tabs are `World`, `Objects`, `Selection`, and `Library`; `Edit` enables changes and `Verify` is a read-only view of the same in-memory drafts. `Play` saves dirty world and object drafts before building and launching; while changed content is already running, `Apply and restart` saves and relaunches it. Scene/prefab saves, creates, and duplicates use revision-bound semantic operations with exact write leases and native validation. World stays mounted during shell navigation, and an incompatible project/session change prompts before discard or leaves dirty drafts visibly detached until their original workspace returns.
- Use `Assets` for the constrained attachment-profile tuner and native-evaluated rest/sampled rig schematics. Browsing and authored sample evaluation are lease-free; editing starts only after `Begin tuning` acquires the exact attachment lease.
- If `Play` cannot build because `cmake` is missing, the shell surfaces setup guidance; the clean-start scripts also auto-detect common CMake installs and export `SHADER_FORGE_CMAKE` when possible. The low-level `Run existing build` action under `Diagnostics` still depends on a runtime binary under `build/runtime/bin`.
- A successful native build can still be a stub runtime if SDL3 or Vulkan are missing; the shell now surfaces that separately as native dependency setup rather than another CMake problem.
- Use `Help` to open the Guide as a secondary searchable reference surface.
- External development agents connect through Shader Forge MCP (`sf-mcp`); the shell does not contain provider selection, prompts, or an assistant chat surface.

## Session Backend And CLI

### Workspaces, Files, And Source Control

- `engine_sessiond` currently provides session create/list/get/update/delete. Session `rootPath` is immutable after creation; changing workspace identity requires delete/recreate.
- Session records now persist across `engine_sessiond` restarts and stay available until deleted.
- Safe file list, file read, and file write APIs are now available inside the active session root.
- `engine_sessiond` now also owns a revision-safe text-file write operation workflow: preview, list/get, approve/reject, apply, undo, durable journal recovery, and restart-safe history.
- World scene/prefab save, create, and duplicate use `POST /api/operations/scene-asset/preview`, canonical `scene/world/<id>` or `scene/prefab/<id>` leases, exact target/source revisions, native `DataFoundation` validation, and an authoritative post-apply reread. Queued, conflicting, late, or uncertain results preserve the draft and are never blindly retried.
- File-write operations persist in the sessiond state directory so Activity/Changes history survives backend restart. Credentials are never stored. Invalid persisted records are skipped on load after preview-schema and event-sequence validation.
- Previewed or approved spatial-attachment operations may now persist one latest strict validation summary plus at most eight actor-attributed `validated` events. Each summary is bound to the proposed revision and contains at most 64 phase/time samples whose joint-limit, overlap, and tolerance totals must exactly match its findings.
- Validation recording compare-and-swaps both proposed revision and `updatedAt`, preserves monotonic operation/event timestamps even under a frozen host clock, and rechecks canonical workspace identity. Reload rejects malformed summaries, invalid spatial context or revision binding, missing or actorless validation events, over-limit history, and backward or out-of-envelope timestamps.
- `POST /api/operations/:id/validate` now produces that summary for previewed/approved spatial operations without a lease. It verifies private proposed bytes in a complete staged animation/content/foundation snapshot, native-validates, evaluates rest plus at most 64 exact non-duplicate phase/time samples, rejects source/CAS drift, and exposes neither proposed content nor raw native diagnostics.
- Each operation stores the canonical workspace-root identity captured at preview. Apply, undo, and recovery reject a mismatched live session root.
- Revisions are SHA-256 content hashes plus an explicit `missing` sentinel. Stale preview/apply/undo calls return HTTP 409 with a structured conflict.
- Direct `/api/files/write`, operation apply/undo, and code-trust promote/quarantine share one serialized `SessionStore` file-mutation queue. Compare-and-write/remove run optional `beforeMutation` after revision/identity inspection and before source mutation. Apply/undo persist `applying`/`undoing` before touching the project file and recover by revision comparison after a crash or persistence failure.
- Failure and recovery append `apply_failed`, `undo_failed`, or `recovered` events and never replace persisted transitions. Recovery is attributed to the last applying/undoing actor, not the proposer.
- Replacement uses a same-directory temp-file + rename without deleting the destination first. Existing POSIX mode bits are preserved where the host supports them. Non-UTF-8 existing files are rejected.
- Approve/reject/apply/undo require an explicit valid actor and never default to anonymous human. Recorded actors are local provenance, not cryptographic attribution.
- Operation apply reuses the existing code-trust evaluate / review-queue path used by `POST /api/files/write`, but artifact recording is a journaled idempotent effect that must succeed before the operation is `applied`. Apply snapshots prior artifacts inside the mutation lane before source bytes change. Undo provenance precheck and artifact restore run in that same lane so a promote/quarantine cannot interleave. Undo refreshes, reverts, or tombstones that artifact so trust metadata does not claim reverted bytes are still applied.
- All supported mutations, including CLI `engine policy promote|quarantine`, go through `engine_sessiond`. Artifact files use serialized atomic replacement. Workspace identity is canonical path plus filesystem `dev`/`ino`. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee.
- Persisted operations validate coherent applying/apply and undoing/undo effect shapes. A fabricated `applying`+`recorded` record without evaluation/artifact is skipped. `applying`+`recorded` and `undoing`+`reverted` crash windows finalize without repeating the effect. Legacy session `rootIdentity` is persisted during load.
- `engine_sessiond` binds only loopback hosts. Non-loopback bind hosts including `0.0.0.0` and `::` are rejected until an authenticated remote mode exists.
- Public JSON requests are rejected with HTTP 413 as soon as accumulated input exceeds 1 MiB, including chunked bodies without `Content-Length`; health advertises the semantic scene-asset capability.
- Non-loopback browser Origins are rejected at the sessiond HTTP boundary. No-Origin native CLI/MCP requests and loopback shell Origins remain allowed. This is a local trust boundary, not client authentication.
- Operation lifecycle events stream on `/api/events`. `sf-mcp` spatial mutation tools now use process-owned coordinator credentials and leases through this same contract; non-spatial MCP mutation remains disabled.
- `GET /api/spatial/attachment/evaluate` reads an existing attachment at an exact SHA-256 revision, rejects symbolic paths, stages exact animation files plus every authored content TOML and the data-foundation manifest, validates the source-to-profile mapping, and rechecks the complete sorted revision manifest before returning. `GET /api/spatial/attachment/evaluate-sample` adds an exact authored phase/time under the same binding. Neither route requires a lease or persists evidence.
- `POST /api/operations/spatial-attachment/preview` creates a labelled generic file-write candidate only after a stale-revision precheck, isolated baseline/candidate native validation and rest evaluation against exact staged bytes, stable source-to-profile mapping, and a granted write lease. Attachment-ID renames require both old and new canonical resource keys. The lease is rechecked after evaluation immediately before operation creation. Preview never writes authored or cooked data.
- Preview returns transient `evaluation.baseline` and `evaluation.candidate` reports; a new file has a `null` baseline. Evaluator output must return the validator-selected attachment ID, schema, skeleton, item prefab, mode, and perspective. These reports are absent from the durable operation journal and remain `pose.sampled=false`, so they are not review evidence.
- Spatial operation context (label, authoritative subject ID, resource keys, preview lease ID) survives sessiond restart; credentials never persist. Spatial apply/undo accept a renewed matching lease but re-authenticate and recheck it immediately before mutation.
- Assets binds authored evaluations to active session/path/revision and candidate evaluations to operation/base/proposed/state. Draft edits mark cached geometry stale instead of moving it. The complete report is bounded and deep-validated before rendering; malformed nested data or unsafe projection bounds make the schematic unavailable.
- `App` retains one sessiond SSE subscription. Assets receives an active-session operation epoch and authoritatively refetches its current operation with session/selection/operation guards. Approval updates actions. Conflict rereads authored bytes, keeps the candidate visibly stale, and retains its captured connection only after successful parse and refreshed resource coverage. Reject/apply/undo clear and reread evidence while releasing/disconnecting only the connection captured by that event/action, never a newer one. Undo after apply requests a fresh lease.
- The shell `Activity` bottom-dock tab now lists durable operations for the active workspace, reads selected public detail and a selected-only bounded structured text diff, refreshes from operation SSE events, and supports fixed-shell-actor Approve/Reject. It has no Apply, Undo, lease, registration, or credential path.
- Activity binds each diff to the selected operation id, path, and before/after revisions, then shows exact old/new line coordinates, line endings, three-line context, truncation, or a truthful binary/too-large/unavailable summary-only reason. Raw journal content bytes are not published. Public validation summaries now exist, but Activity does not render them yet.
- The CLI now exposes `engine spatial preview|approve|reject|apply|undo` as strict adapters over that same sessiond workflow. Preview reads full strict BOM-free UTF-8 content from `--content-file`; preview/apply/undo read credentials only from `SHADER_FORGE_AGENT_CREDENTIAL`. The CLI never auto-registers, leases, approves, builds, or writes around sessiond.
- See `docs/specs/ENGINE-OPERATIONS-SPEC.md` for the canonical contract.
- Runtime start and restart can now launch against the selected session root so shell authoring and runtime testing point at the same project files.
- Runtime start and restart now also derive a save root under `<session-root>/saved/runtime` so quick-saves persist with the active project instead of the backend process directory.
- `GET /api/ai/providers` and `POST /api/ai/test` now expose the first Phase 5.9 AI provider inspection and smoke-test lane from `engine_sessiond`.
- `GET /api/package/inspect` and `POST /api/package/run` now expose the first Phase 6.2 release-layout inspect/package flow from `engine_sessiond`, including package prep state and optional auto-bake execution.
- `GET /api/profile/live`, `GET /api/profile/captures`, and `POST /api/profile/capture` now expose the first Phase 6.3 diagnostics snapshot, capture-history, and capture-report lanes from `engine_sessiond`.
- `GET /api/code-trust/summary` and `POST /api/code-trust/evaluate` now expose the shared code-trust boundary for shell, CLI, and future assistant clients.
- `GET /api/code-trust/artifacts` and `POST /api/code-trust/artifacts/transition` now expose tracked artifact hashes, verification state, and explicit promote/quarantine transitions through the SessionStore mutation lane.
- `GET /api/code-trust/approvals` and `POST /api/code-trust/approvals/:id/decision` now expose the review queue for `review_required` code-trust operations.
- Policy-relevant file writes now record origin and trust-tier metadata under `<session-root>/.shader-forge/code-trust-artifacts.json`.
- Runtime build and runtime start/restart now pass through the same code-trust policy layer before compile or load transitions continue.
- Host filesystem directory listing is already used by the workspace-root picker.
- Git status and repository initialization are already used by the `Source Control` rail.
- PTY terminal lifecycle is already wired into the bottom-dock terminal surfaces.
- `/api/coordination` provides workspace-scoped agent registration, credential-protected heartbeat/disconnect, hierarchical read/write leases, FIFO conflict queues, writer fairness, expiry cleanup, and state inspection for `sf-mcp` clients.
- Non-overlapping resources and separate workspaces can proceed concurrently; overlapping writes plus `build` or `runtime` exclusivity are coordinated without one global bridge lock.
- Coordination credentials are returned only at registration and are excluded from state, lease, SSE event, log, and error views.

### Shader Forge MCP

- Shader Forge MCP is the external-agent adapter; use `sf-mcp` as its short name.
- The current adapter is a process-scoped stdio server. Each Codex, Grok CLI, or other MCP client launches its own process, while stdout remains reserved for MCP protocol messages and diagnostics go to stderr.
- Start it with a stable project selection using `--root <path>`, or attach to an existing backend session with `--session <id>`. `--base-url <url>` selects `engine_sessiond`, and `--name <client-name>` identifies the client process.
- Each `sf-mcp` process registers one workspace-scoped coordinator agent, keeps the returned credential private in process memory, heartbeats while connected, and disconnects on shutdown so held leases do not strand other agents.
- The current resources are `shaderforge://project` and `shaderforge://coordination`.
- Current read tools are `project_status`, `project_files_list`, `project_file_read`, `coordination_state`, and read-only/idempotent `spatial_attachment_read` for exact revision-bound rest or authored sampled evidence.
- Current coordination tools are `work_lease_request`, `work_lease_status`, `work_lease_release`, and `agent_heartbeat`.
- Current operation tools are bounded `operation_list`, `operation_read`, `spatial_attachment_preview`, separate `operation_approve` / `operation_reject`, and spatial-only `operation_apply` / `operation_undo`.
- The MCP actor, agent id, session id, and credential come from process state. Preview/apply/undo require an owned granted write lease; apply/undo also require coverage for every persisted spatial resource key and sessiond rechecks immediately before mutation.
- Separate Codex and Grok processes can inspect the same workspace concurrently and receive non-overlapping leases, while conflicting hierarchical writes queue through `engine_sessiond` instead of running over each other.
- The mutation surface is limited to semantic spatial attachments. Generic file/scene/code writes, build/runtime mutation, arbitrary commands, and HTTP transport remain excluded.
- `sf-mcp` never calls `/api/files/write`, accepts caller-provided identity or credentials, or automatically leases, approves, retries, applies, undoes, or releases. Structured 409 results preserve safe conflict data plus a refreshed authoritative operation when available.
- Shader Forge MCP does not contain a built-in assistant, model execution, provider picker, or prompt UI. External clients own the AI experience.
- Run `npm run test:mcp` for deterministic stdio, boundary, coordination, revision-bound spatial rest/sample reads, full spatial operation, structured-conflict, and disconnect-cleanup coverage.
- See `docs/specs/ENGINE-MCP-SPEC.md` for the canonical contract and `docs/guides/SHADER-FORGE-MCP-SETUP.md` for Codex/Grok setup.

### Engine CLI Surfaces

- `engine sessiond start` starts the local backend service.
- `engine session create` and `engine session list` expose session bring-up from the terminal.
- `engine file list` and `engine file read` expose safe file inspection.
- `engine ai providers [--root <path>]` now prints the workspace AI provider manifest, default provider, readiness state, and diagnostics.
- `engine ai test [--root <path>] [--provider <id>] [--prompt <text>] [--system <text>]` now runs the first shared AI smoke-test lane.
- `engine ai request <prompt> [--root <path>] [--provider <id>] [--system <text>]` now reuses that same first-slice request path for deterministic fake output and optional Ollama-backed prompts.
- `engine export inspect [--root <path>] [--preset <id>] [--package-root <path>]` now prints the resolved export preset, path readiness, cooked-asset counts, and last-package summary for a workspace.
- `engine package [--root <path>] [--preset <id>] [--package-root <path>] [--skip-bake] [--force-bake]` now emits a reproducible release-layout scaffold under `build/package/<preset>/`, bundling the runtime binary, packaged authored runtime roots, bundled cooked outputs, launch scripts, and a package report; missing cooked outputs are auto-baked unless that step is explicitly skipped.
- `engine profile live [--root <path>]` now prints the first diagnostics snapshot lane, and `--session` plus `--base-url` can switch that to a live `engine_sessiond` snapshot.
- `engine profile list [--root <path>] [--session <id>] [--base-url <url>] [--limit <count>]` now lists persisted diagnostics captures from either a workspace or a live `engine_sessiond` session.
- `engine profile capture [--root <path>] [--label <name>] [--output <path>]` now writes a shareable JSON diagnostics capture under `build/profiling/captures/`, and `--session` plus `--base-url` can capture a live sessiond-backed snapshot with recent runtime/build logs.
- `engine policy inspect [--root <path>]` now prints the effective code-trust policy, supported authored hot-reload roots, and tracked artifacts for a workspace.
- `engine policy check <action> [path] [--root <path>] [--actor ...] [--origin ...]` now dry-runs the same code-trust layer that sessiond enforces before risky assistant-facing transitions.
- `engine policy artifacts [--root <path>]` now prints tracked artifact hashes, verification state, and promote/quarantine metadata for a workspace.
- `engine policy approvals [--session <id>] [--state pending|all] [--base-url <url>]` now lists pending or historical code-trust approvals from a running backend.
- `engine policy approve <approval-id>` and `engine policy deny <approval-id>` now resolve queued code-trust approvals from the terminal.
- `engine policy promote <path> [--session <id>] [--root <path>] [--base-url <url>] [--decision-by <name>] [--note <text>]` now promotes a tracked artifact through `engine_sessiond` and refreshes its trusted hash.
- `engine policy quarantine <path> [--session <id>] [--root <path>] [--base-url <url>] [--decision-by <name>] [--note <text>]` now quarantines a tracked artifact through that same sessiond mutation authority so later risky transitions keep denying it until it is explicitly promoted again.
- `engine build runtime` configures and builds the native runtime plus the `shader_forge_data` validator with CMake; `engine build data` builds only that validator; `engine build spatial` builds the dependency-free native spatial validate/cook/evaluate-rest/evaluate-sample tool. All resolve CMake from `SHADER_FORGE_CMAKE` first and then `cmake` on `PATH`.
- `engine spatial validate [--animation-root animation] [--build-dir build/runtime] [--config Debug]` runs the already-built validator and prints deterministic JSON. It gives a build-first error when absent and does not compile, cook, or start a daemon.
- `engine spatial cook [--animation-root animation] [--output-root build/cooked] [--build-dir build/runtime] [--config Debug]` validates through the same `AnimationSystem` and atomically stages one byte-stable derived payload at `<output-root>/animation/spatial-authoring.bin`. It does not auto-build, start a daemon, or join generic `engine bake` yet.
- `engine spatial evaluate-rest --attachment <id> [--animation-root animation] [--content-root content] [--data-foundation data/foundation/engine-data-layout.toml] [--build-dir build/runtime] [--config Debug]` prints deterministic rest frames, exact prefab-bound render-procgeo visual-box corners when available, diagnose-only joint-limit evidence, and diagnose-only capsule-axis-to-authored-collision-OBB surface clearance. `pose.sampled=false`; solved IK is unavailable, and neither the visual box nor the clipping diagnostic is a rendered mesh, runtime collision result, or review evidence.
- `engine spatial evaluate-sample --attachment <id> --phase <phase> --normalized-time <value> [--animation-root animation] [--content-root content] [--data-foundation data/foundation/engine-data-layout.toml] [--build-dir build/runtime] [--config Debug]` requires an exact authored envelope sample and carries the same independent visual-box and collision/capsule diagnostic evidence. V2 two-hand profiles apply deterministic palm-effector IK before joint-limit and clipping evaluation with separate reach/contact/angular truth; v1 remains `pre_ik_only`; every result remains non-review schematic evidence.
- `engine spatial preview --session <id> --path animation/attachments/<file>.attachment.toml --content-file <path> --base-revision <sha256:...|missing> --label <text> --agent <id> --lease <id> [--base-url <url>]` sends a strict BOM-free UTF-8 full-content candidate to sessiond without mutating authored bytes.
- `engine spatial approve|reject <operation-id>` and `engine spatial apply|undo <operation-id> --agent <id> --lease <id>` call the existing operation transitions. Apply/undo require the credential in `SHADER_FORGE_AGENT_CREDENTIAL`; no command performs implicit coordination or approval.
- `engine run <scene>` builds and launches the native runtime and now forwards content, audio, animation, physics, data, save, and tooling roots.
- `engine bake` scans text-backed content, audio, animation, and physics roots, emits staged cooked outputs into `build/cooked/`, and writes a deterministic asset-pipeline report.
- `engine migrate detect|unity|godot <path>` now emits normalized migration manifests and reports for supported source-engine fixtures and real projects.
- `engine migrate unreal <path>` now reports the explicit `unreal_offline_fallback` lane, lower conversion confidence, and low-confidence Blueprint package manifests when exporter-assisted Unreal data is unavailable in the current slice.
- `engine migrate report <path>` summarizes a generated migration report from the terminal.
- `engine import` is still a later phase.
- `ai/providers.toml` is now the current source-controlled provider manifest, with deterministic `fake` coverage for offline harnesses and an optional Ollama-backed local model lane.
- `npm run test:ai-scaffold` is the deterministic harness for the first AI provider/status/test slice.
- The CLI bake lane is now real, but it still emits staged cooked payloads and generated-mesh previews rather than the final FlatBuffers writer.
- The CLI packaging lane is now real, but it still packages authored runtime roots plus bundled cooked outputs rather than a final cooked-runtime shipping layout.
- The CLI profiling lane is now real, but it still captures JSON diagnostics snapshots rather than Tracy, RenderDoc, or native in-process profiling panels.
- The CLI migration lane is now split honestly: `detect` is report-only, while pinned engine lanes emit a first-pass Shader Forge project skeleton rather than claiming full parity.

### Migration Foundation

- `fixtures/migration/unity-minimal`, `fixtures/migration/unreal-minimal`, `fixtures/migration/unreal-offline-minimal`, and `fixtures/migration/godot-minimal` are the deterministic source-project fixtures for the current migration slices.
- `engine migrate detect` auto-detects Unity, Unreal, or Godot project structure and writes `migration-manifest.toml`, `report.toml`, and `warnings.toml` under `migration/<run-id>/`.
- `engine migrate unity` and `engine migrate godot` now pin the requested source-engine lane while also emitting a self-contained `shader-forge-project/` skeleton under each run root.
- `engine migrate unreal` currently pins the explicit `unreal_offline_fallback` lane, emits the same `shader-forge-project/` skeleton shape, and records the preferred exporter-assisted lane separately in the manifest and report.
- Pinned engine lanes now generate first-pass migrated `.scene.toml`, `.prefab.toml`, `.data.toml`, and `script-porting/*.port.toml` outputs for the current fixtures.
- Startup selection now maps Unity's first enabled `ProjectSettings/EditorBuildSettings.asset` scene, Unreal's `[/Script/EngineSettings.GameMapsSettings].GameDefaultMap`, and Godot's `[application].run/main_scene` when it uses `res://`, resolving against exact source-project-relative scene records.
- Every pinned conversion reports a `[startup_scene]` source/target provenance record plus converted, approximated, and skipped project-setting counts. Duplicate scene basenames receive deterministic source-path-derived target names, so a declared startup scene remains unambiguous.
- An explicit startup scene that does not resolve is fail-closed: no `runtime_bootstrap.data.toml` is emitted, the setting is `skipped`, and warnings/manual work identify the unresolved value. If no startup scene is declared, the first source-relative converted scene is selected deterministically and marked `approximated`.
- `asset_conversion` is `Manual` until real source payload import exists. Placeholder asset directories do not constitute conversion. The migration fixture harness also feeds emitted scene, prefab, and optional bootstrap records through the production asset-pipeline baker.
- The Unreal offline fallback currently derives scene and prefab placeholders from `.umap` names, Blueprint-like `.uasset` package names, and available C++ class symbols rather than exported Unreal actor data.
- The current migration slice now converts project structure into a usable Shader Forge skeleton, but it still does not provide full asset, hierarchy, or gameplay parity.

## Runtime And Authoring

### Runtime Bring-Up And Viewer Bridge

- The native runtime has Vulkan instance, surface, device, swapchain, render pass, framebuffer, submit, and present bring-up.
- Resize-aware swapchain recreation is already implemented.
- Runtime build, run, stop, restart, pause, and resume are already controlled from the shell, and shell-driven run/restart now follow the active session root.
- `Playtest` keeps the current world, runtime state, and valid primary actions visible. Build state, bridge activity, paths, and recent log tails are available under collapsed `Diagnostics`; build and runtime failures remain visible without opening it.
- The native runtime now projects authored prefab render components into visible debug-proxy scene cards in the external Vulkan window, so the active scene is no longer only a clear-color loop during manual testing.
- The native runtime now also has a first authored-content iteration lane: `F7` forces reload of content/audio/animation/physics/data state, and the runtime also polls saved authored-file timestamps to pick up shell edits without a full restart.
- The native runtime now resolves effect-capable interaction targets from the current view/crosshair, and `ui_accept` input such as Enter or left-click triggers first visible interaction feedback plus effect-descriptor-backed logs.
- The native runtime now also has a widened first save-system lane: `F8` writes the active `quickslot_01` through `quickslot_03` runtime save, `F9` reloads it, `F11`/`F12` cycle the active slot, and the save path follows the active session/project root instead of mixing runtime persistence into authored content roots.
- The native runtime now also has a first projected physics-debug lane: authored blocking bodies and query-only trigger bodies can be visualized in the external window, overlap-triggered bodies are highlighted, and `F10` toggles that view during manual testing.
- The native runtime still renders in an external window.
- The browser shell remains the primary workspace.
- Embedded viewer transport and screenshot capture are still deferred.
- On Windows, Visual Studio can provide CMake without providing the SDL3 development package or Vulkan SDK that the real native runtime needs, so a successful build and launch can still end in stub-mode runtime exit until those native dependencies are installed.

### Scene, Prefab, And Data Foundation

- `content/scenes/*.scene.toml` is the initial authored scene lane.
- `content/prefabs/*.prefab.toml` is the initial authored prefab lane.
- `content/data/*.data.toml` is the initial authored engine/bootstrap data lane.
- `content/effects/*.effect.toml` is the initial authored effect-descriptor lane.
- `content/procgeo/*.procgeo.toml` is the initial authored procedural-geometry lane.
- `audio/buses.toml`, `audio/sounds/*.sound.toml`, and `audio/events/*.audio-event.toml` are the initial authored audio lanes.
- `animation/skeletons/*.skeleton.toml`, `animation/clips/*.anim.toml`, and `animation/graphs/*.animgraph.toml` are the initial authored animation lanes.
- `AnimationSystem` supports an optional `animation/attachments/*.attachment.toml` project lane; current attachment profiles remain isolated validation fixtures under `animation/fixtures/spatial/attachments/`.
- `physics/layers.toml`, `physics/materials/*.physics-material.toml`, and `physics/bodies/*.physics-body.toml` are the initial authored physics lanes.
- `saved/runtime/*.runtime-save.toml` is now the initial runtime-persistence lane and is intentionally separate from authored source assets.
- `data/foundation/engine-data-layout.toml` defines the current `TOML -> FlatBuffers -> SQLite` split.
- The runtime validates the content roots through `DataFoundation` before startup continues.
- Scene-to-prefab relationships are validated across the catalog.
- Prefabs may optionally author one strict perspective `[component.camera]` with float32-compatible vertical FOV and near/far clips. A scene may reference at most one root `player_camera`; malformed lines, unknown `component.*` tables, duplicate camera fields/tables, invalid bounds, and parented player cameras fail validation and cook.
- Camera validation and staged camera cooking use the same native float32 values, so authored optics cannot change when the final FlatBuffers writer replaces the current JSON staging format.
- The runtime can now compose authored scene entities plus prefab payloads into a first runtime scene snapshot with resolved hierarchy-derived world transforms.
- The runtime can now look up authored procgeo dimensions and use them to size projected debug proxies for prefab render components in the scene viewer.
- `runtime_bootstrap.data.toml` can now provide a default scene and tooling overlay preference.
- The runtime window title and startup logs now include active scene and primary prefab context from the authored assets.
- The runtime now selects a preferred controlled entity from authored spawn tags such as `player_camera`, and `move_*` plus `look_*` input now drives that entity state.
- A valid root `player_camera` takes priority over `player_spawn` and drives projection from its composed world transform plus authored camera values. Ordinary scenes keep the legacy 70-degree, 0.15-meter near, and 1000-meter far defaults. Quickload rejects stale controlled authority instead of silently changing camera semantics.
- Controlled-entity movement now respects a first authored-physics blocking lane against scene physics bodies, and the runtime surfaces the blocking body in logs plus window state during manual testing.
- Authored `on_overlap` effect triggers can now activate automatically from query-only scene bodies during runtime movement, so the running scene has a first automatic trigger-volume lane alongside manual `ui_accept` interaction.
- The shell `World` workspace opens revision-bearing scene and prefab assets directly from the active session root and round-trips deterministic save, reload, revert, duplicate, and primary-object edits through the semantic scene-asset operation lane.
- Shell run/restart now forward the active session root into runtime launch so the external runtime reads the same authored scene files the shell edits.
- The running runtime now follows those authored edits through a first polling/manual reload lane rather than requiring a full process restart for every save.
- Effect-capable proxies in the running scene can now be aimed at with the crosshair and triggered through `ui_accept`, which surfaces first runtime feedback for authored `[component.effect]` data instead of leaving it as static catalog metadata.
- `saved/runtime/quickslot_01.runtime-save.toml` through `quickslot_03.runtime-save.toml` are now the first inspectable runtime save payloads, and the current snapshot stores scene, controlled-entity, transform, animation-context, and triggered-overlap state for manual iteration.
- `Edit` and `Verify` share the same in-memory World drafts. `Verify` is read-only and never discards unsaved work; returning to `Edit` restores write controls without rebuilding the draft.
- The runtime now loads authored audio buses, sounds, and named events through `AudioSystem`.
- Runtime startup resolves a `runtime_boot` audio event, and `ui_accept` now flows through the same engine-owned audio event API.
- The runtime now loads authored animation skeletons, clips, and graphs through `AnimationSystem`.
- Runtime startup resolves a default animation graph, logs graph/state/event catalog data, and routes entry-clip `audio_event` hooks through the engine-owned audio event API.
- Movement now drives a first authored animation-state lane in runtime: `idle` and `walk` can be resolved by name from the current graph, the active state/clip is surfaced in window state, and walk clip `audio_event` hooks now fire during movement playback.
- The native tooling overlay now also surfaces live player id/position, movement speed, active animation state/clip, blocking body, active save slot, current interaction target, active triggered effect, and physics-debug state so manual runtime testing is not dependent on log scanning alone.
- The runtime now loads authored physics layers, materials, and primitive bodies through `PhysicsSystem`.
- Runtime startup logs physics layer/body summaries and runs deterministic raycast plus overlap queries against the active scene.
- The current runtime slice can now project first physics-debug body visualization for blocking and query-only bodies, but it is still a debug overlay rather than final in-engine physics gizmos.
- `engine bake` now emits staged cooked outputs into `build/cooked/`, writes generated-mesh preview payloads for `procgeo` assets, stages cooked audio metadata under `build/cooked/audio/`, stages cooked animation metadata under `build/cooked/animation/`, and stages cooked physics metadata under `build/cooked/physics/`.
- There is not yet a final FlatBuffers writer, SQLite asset index, or Effekseer runtime integration.

### Audio Foundation

- `audio/buses.toml` defines the initial required buses: `Master`, `Music`, `SFX`, `Voice`, and `Ambience`.
- `audio/sounds/*.sound.toml` defines named sounds with bus routing, playback mode, spatialization, streaming, and default volume metadata.
- `audio/events/*.audio-event.toml` defines named audio events that currently resolve to sound-play requests through engine-owned APIs.
- The current audio slice validates and resolves requests, but it does not decode or mix sound yet. Playback backend integration is still ahead.

### Animation Foundation

- `animation/skeletons/*.skeleton.toml` defines named authored skeletons with root-bone and bone-list metadata.
- The current `debug_humanoid` skeleton is three-bone metadata only: `hips, spine, head`. There is no parent table, rest pose, semantic role map, or socket list.
- `animation/clips/*.anim.toml` defines named clips with skeleton ownership, looping/root-motion metadata, and text-backed clip events.
- `animation/graphs/*.animgraph.toml` defines named animation graphs with float parameters, named states, and explicit entry-state selection.
- `AnimationSystem` now strictly validates v2 skeleton hierarchies, roles, sockets, and canonical quaternions plus v1 attachment profiles while keeping the existing v1 skeleton lane compatible.
- Every animation source path and file must be valid UTF-8 before `AnimationSystem` commits a new generation.
- Generation-tagged skeleton, bone, socket, and attachment handles invalidate after a successful reload; a failed reload retains the prior valid generation and snapshots.
- The current runtime slice validates and resolves default graphs plus entry-clip events. Deterministic schema-v2 clip sampling exists as a native query, but runtime graph playback still does not consume it, blend, or retarget animation.

### Spatial Authoring And Attachment Tuning

- Spatial authoring now has a native schema/query/cook/rest-schematic foundation, deterministic sampled attachment evaluation, semantic operations, strict CLI queries, revision-safe transient sessiond rest/sample evidence, and a constrained Assets primary-grip tuner with native-evaluated rest/sampled rig schematics. Sampled evidence is read-only and not review evidence. See `docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md`.
- Native engine code will own behavior, typed schemas, validation, and runtime execution. Source-controlled TOML will own tuning values. Shell, CLI, and `sf-mcp` will edit those same assets only through `engine_sessiond` revision-safe operations.
- V1 skeleton/clip/attachment compatibility, strict v2 skeleton/socket/clip-track/attachment validation, sampleable motion-envelope cross-references, canonical quaternions, and generation-safe query handles now exist.
- Isolated humanoid/rifle/pistol fixtures under `animation/fixtures/spatial/` and `npm run test:spatial-authoring-scaffold` exercise the native parser through WSL without entering authored or cooked roots.
- `shader_forge_spatial validate` and `cook` reuse the exact `AnimationSystem` loader. `evaluate-rest` composes deterministic rest geometry and one exact typed `diagnostics.jointLimits` object. `evaluate-sample --attachment <id> --phase <phase> --normalized-time <value>` resolves an exact authored envelope sample and composes the same bone/socket/item/contact/hand geometry over the native clip sampler with explicit procedural-layer truth and the same joint-limit object.
- Sessiond exposes revision-safe transient rest and sampled GETs and transient rest baseline/candidate preview evaluations. These paths stage exact animation files, every authored content TOML, and the data-foundation manifest, bind evaluator output to the selected profile, reject symbolic paths, recheck the complete sorted revision manifest, and persist no evaluation.
- Scene and spatial apply/undo share one semantic mutation dispatcher. The spatial branch independently native-validates and rest-evaluates staged current/resulting truth inside the existing file-mutation lane, rechecks the manifest without recursive locking, and rechecks the covering write lease before authored replacement. Validation failure writes nothing; native spatial child commands have a fixed timeout.
- Assets binds authored rest evidence to exact session/path/revision/source manifest, authored sampled evidence to exact phase/clip/time/full animation-content-foundation manifest, and candidate rest evidence to exact operation/base/proposed/state. It offers only authored envelope values through native selects. Editing values never moves cached evidence.
- The accessible responsive workbench offers Front X/Y, Side Z/Y, and Top X/Z projections, exact evaluator coordinates, diagnostics, path/revision/sample/source identity, live/error text, and explicit direction-glyph limits. A complete bounded deep validator rejects malformed nested entries, contradictory IK diagnostics, oversized payloads, non-finite transforms, unsafe manifests, and unsafe projection bounds.
- Rest evaluation is a schematic query only: `pose.sampled=false`. Exact `authored_visual_box` corners may be available through the prefab render-procgeo chain, and Assets draws their twelve-edge outline without treating it as collision. Authored v2 cone-twist limits and diagnostic capsules are parsed and cooked; optional prefab box collision is independent typed `DataFoundation` source truth. Native rest/sample evaluation reports rest-relative swing/signed twist and capsule-axis-to-oriented-box surface clearance without mutating, clamping, or retargeting the pose. `shader_forge_spatial` emits exact typed joint-limit and clipping aggregates plus stable per-bone/per-capsule records; sessiond and Assets recompute and validate their identities, geometry, derived values, and aggregate truth fail closed. Missing authored inputs produce exact unavailable diagnostics, while tangency is `CLEAR` with zero violation. Assets presents joint limits as diagnose-only `PASS`/`FAIL` and capsule/item clipping as `CLEAR`/`OVERLAP`, never as a runtime collision result or review packet. Authored runtime cameras exist, but revision-bound native capture remains unavailable.
- Sampled evaluation is also read-only and not review evidence. V2 two-hand profiles apply deterministic two-bone secondary-hand IK using the palm socket and item-space pole, preserving limb lengths and reporting separate physical reach, contact, angular, joint-limit, and clipping truth. V1 two-hand profiles remain visibly `PRE-IK`; one-hand profiles report `sampled_attachment_schematic_only`. Sessiond, Assets, and the typed `spatial_attachment_read` MCP tool expose this exact authored sampled evidence; candidate evaluation remains rest-only.
- Humans and agents will share one `reviewId` and an immutable review packet with explicit cameras, resolution/framing, lighting, pose samples, source revisions, evaluated transforms/bounds, diagnostics, captures, operation id, and all lease ids. Do not scrape a live cursor or camera.
- Preview candidates must be labelled. Cooked data is derived and non-editable. Generated packets live under `build/spatial-reviews/<review-id>/`. Provider-specific `Saved/Codex` paths are forbidden.
- Two-hand weapons use dominant-hand item drive then off-hand IK. VLM or visual scores never apply.
- In `Assets`, profile selection and native rest evaluation are read-only until `Begin tuning` requests `spatial/attachment/<id>`. Evaluation is still attempted for readable files whose layout the constrained editor cannot rewrite. The source is refreshed after grant; only primary-grip translation and degree-displayed rotation are editable. Preview is visibly `NOT APPLIED`, Approve and Apply are separate, Apply releases coordination, and Undo reacquires a fresh lease. All writes use the semantic operation path, never raw file write.
- `App` owns one sessiond SSE subscription. Operation notifications cause Assets to authoritatively refetch only its active operation with request/selection/id guards. External approval updates actions. Conflict rereads source, preserves stale candidate evidence, and retains its captured connection only after parse/resource checks. Reject/apply/undo clear candidate evidence, reread source, and release/disconnect only the connection captured by that event/action.
- `sf-mcp` now exposes the read-only, idempotent `spatial_attachment_read` tool for exact revision-bound rest or authored sampled evidence, including joint-limit and clipping diagnostics plus the sorted source-revision manifest. The tool uses the selected MCP session, requires the attachment base revision, rejects stale or out-of-scope requests, and neither acquires leases nor creates operations. Lease-gated attachment preview/review/apply/undo remains the mutation adapter; the sessiond validation operation is implemented, while its thin CLI/MCP adapter, runtime collision/physics use, rendering/capture, immutable review packets, and recapture/review tools remain deferred.
- Implementation is ordered after the existing operation layer and before broad World/Assets visual polish.

### Physics Foundation

- `physics/layers.toml` defines the initial collision layers and text-backed collision masks.
- `physics/materials/*.physics-material.toml` defines named physics materials with friction, restitution, and density metadata.
- `physics/bodies/*.physics-body.toml` defines primitive scene bodies with scene ownership, layer/material references, motion type, and box or sphere shape data.
- The current runtime slice validates and resolves deterministic raycast and overlap queries over those primitive bodies, but it does not run a full simulation backend yet.

## Input, Tooling, And Testing

### Input And Native Tooling Foundations

- `input/actions.toml` plus `input/contexts/*.input.toml` define the current action and context maps.
- Keyboard, mouse, and gamepad input are routed through engine-owned named actions and axes.
- The runtime currently consumes actions such as `runtime_exit`, `reload_runtime_content`, `save_runtime_state`, `load_runtime_state`, `toggle_physics_debug`, `select_previous_save_slot`, `select_next_save_slot`, `move_x`, `move_y`, `look_x`, `look_y`, `ui_accept`, and `ui_back`, with `F7` active for authored-content reload plus `F8`, `F9`, `F10`, `F11`, and `F12` active for quick-save, quick-load, physics-debug toggling, and runtime save-slot cycling.
- The native tooling substrate currently has a named panel registry.
- Tooling layouts are loaded from text and session layouts can be saved back to disk.
- The current panel set covers runtime stats, input debug, log view, and debug state.
- The overlay summary now also carries first live gameplay-state context for the controlled entity, animation state, movement blocking, active save slot, interaction target, and physics-debug state during manual testing.
- Tooling overlay and panel toggles are already bound through the engine-owned input actions.
- Dear ImGui docking and real in-process native panel rendering are still ahead.

### Deterministic Harnesses And Clean Start

- `npm test` runs the shell smoke harness, including the integrated shell layout and native Code workspace contracts.
- `npm run test:shell-layout` validates strict v1 layout-only serialization, canonical fallback/reset, per-workspace independence, responsive side-pane geometry, narrow right-drawer reachability, and bounded short-viewport bottom-dock behavior.
- `npm run test:code-shell` validates revision-bound Code tabs, detached dirty-draft retention, current-file search, typed conflict matching, async session/tab/operation authority, and compare-before-refresh draft preservation.
- `npm run test:sessiond` validates local backend session/file flows, revision-safe file-write operations, bounded selected-operation exact diffs and summary-only degradation, durable bounded spatial-validation summaries/events with restart provenance and timestamp checks, journal recovery, writer serialization, loopback-only bind, immutable session roots, journaled code-trust effects, undo-vs-promote mutation-lane barriers, persisted `rootIdentity` migration, Origin/actor/code-trust gates, plus multi-agent leases, queue promotion, expiry, credential ownership, workspace cleanup, and isolation.
- `npm run test:viewer-bridge` validates build/runtime bridge events.
- `npm run test:packaging-scaffold` validates export-preset inspection, visible prep state, auto-bake packaging, and release-layout generation through the CLI and `engine_sessiond`.
- `npm run test:profiling-scaffold` validates live diagnostics snapshots, persisted capture reports, and capture-history listing through the CLI and `engine_sessiond`.
- `npm run test:code-trust-scaffold` validates the shared code-trust policy summary, artifact hashes plus verification state, promote/quarantine transitions, approval queue listing/decision flows, allowed authored-content hot reload, approved deferred apply/compile operations, and rejected assistant-triggered engine load paths.
- `npm run test:scene-authoring` validates the shell scene-authoring surface plus session-root scene/prefab/entity/transform file writes.
- `npm run test:scene-runtime-scaffold` validates the first Phase 6 composed-scene and controlled-entity runtime slice.
- `npm run test:spatial-authoring-scaffold` compiles and executes the native v1/v2 skeleton/clip/socket/attachment harness, including deterministic clip sampling, exact envelope sampling, sampled attachment composition, layer truth, rejection, reload, and typed-handle behavior; WSL `g++` is required on Windows.
- `npm run test:spatial-tool` requires a native compiler and runs the production validate/cook/evaluate-rest/evaluate-sample tool against isolated fixtures, checking deterministic rest/sample geometry, unchanged rest shape, v1 pre-IK/one-hand truth labels, v2 two-bone IK and tolerance truth, strict native/`engine` CLI behavior, and failure cases; WSL `g++` is required on Windows and `g++` elsewhere.
- `npm run test:spatial-operations` validates isolated full animation staging, exact source-revision manifests and drift rejection, rest/sample validator-profile/phase/time binding, sampled one-hand/v1-pre-IK/v2-applied-IK truth, no-write native-backed attachment preview, durable context, lease contention and rename coverage, apply/undo lease renewal and revision checks, bounded failures, CORS, and temporary cleanup.
- `npm run test:spatial-cli` drives the real CLI against an injected-validator sessiond and validates preview/review/apply/undo, strict arguments, fatal UTF-8 input, server diagnostics, and credential redaction.
- `npm run test:spatial-shell` validates exact primary-grip source rewriting, independent authored-envelope parsing, sorted source-manifest guards, complete v1/v2 rest/sampled evaluator-schema/size/projection guards, exact phase/time/revision evidence binding, one shared SSE subscription and authoritative operation refetch, Assets-only mounting, explicit lease intent, operation-only routing, accessible/responsive schematic markers, v1 pre-IK/v2 applied-IK truth, resolved-v2 pole projection, and credential-free evaluation GETs.
- `npm run test:runtime-scaffold`, `test:save-system-scaffold`, `test:data-foundation-scaffold`, `test:asset-pipeline`, `test:migration-fixtures`, `test:audio-scaffold`, `test:animation-scaffold`, `test:physics-scaffold`, `test:input-scaffold`, and `test:tooling-ui-scaffold` validate the native bring-up and first cook slices.
- `./scripts/start-dev-clean.sh` is the Unix/WSL clean-start path.
- `powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1` is the Windows clean-start path.
- Both scripts remove generated outputs, rerun the current deterministic baseline, auto-detect a usable CMake installation when possible, export `SHADER_FORGE_CMAKE`, start `engine_sessiond`, and then launch the active shell workflow.

## Current Boundaries And Next Widening Passes

### What Exists Now

- A React/Vite shell workspace with persistent backend-owned sessions, file preview, source control, terminal tabs, runtime control, and strict per-workspace browser-persisted layouts with accessible resizing/reset plus a narrow right drawer.
- A real shell-side scene authoring workflow with repo-backed `.scene.toml` and `.prefab.toml` save/reload/duplicate flows plus placed-entity hierarchy, transform editing, first prefab component payload editing, and active-session-root runtime handoff.
- A real native SDL3/Vulkan runtime slice with input, tooling, data-foundation, audio, animation, physics, first composed scene-runtime hooks, session-root launch alignment from the shell/session backend, and a first runtime save-system lane.
- Text-backed scene, prefab, data, effect, procedural-geometry, audio, animation, and physics roots represented in the repo.
- A first CLI bake lane that emits staged cooked outputs, generated-mesh preview artifacts, and staged cooked audio, animation, and physics metadata.
- A first CLI and shell/sessiond packaging lane that resolves export presets, emits release-layout scaffolds under `build/package/`, and records package reports plus launch manifests.
- A first CLI and shell/sessiond profiling lane that captures workspace diagnostics plus live runtime/build log context into JSON reports under `build/profiling/captures/`.
- A first CLI migration lane that detects supported source-engine project shapes, emits normalized migration manifests plus reports, converts the current fixtures into first-pass Shader Forge project skeletons, and preserves startup-scene intent through exact setting provenance or explicit fail-closed/approximated outcomes.
- A first code-trust lane with source-controlled policy data, shared sessiond/CLI evaluation, tracked assistant/code-path artifacts, explicit review queues for `review_required` operations, and assistant-triggered compile/load/apply gating.
- A hardened `engine_sessiond` revision-safe text-file operation workflow with preview, approval, journaled apply/undo, journaled code-trust effects, serialized CLI provenance transitions, immutable workspace identity, append-only recovery provenance, structured conflicts, loopback-only bind, local Origin filtering, restart-safe history, and the durable bounded validation-summary/event storage boundary for spatial operations. `sf-mcp` now consumes its lease-gated spatial attachment family; the validation HTTP/evaluator orchestration and other MCP operation families still require their explicit contracts. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee.
- A native spatial schema/query/cook/rest and sampled attachment evaluation slice with v2 two-bone secondary-hand IK, explicit v1 pre-IK compatibility, and diagnose-only joint-limit aggregate/per-bone PASS/FAIL, plus a constrained Assets tuner and accessible native-evaluated three-projection rest/sampled rig schematics with resolved v2 pole projection, exact full-input evidence binding, guarded SSE reconciliation, and no rendered-review claim in the shell.
- A searchable in-app guide plus repo-native markdown and JSON assistant guides.

### What Still Needs Widening

- The shell still needs deeper UX and more app-native surfaces beyond the preserved code bridge.
- Scene authoring still needs transform gizmos, deeper scene/component payload authoring, and bake-back flows beyond the current text-backed entity plus prefab-component slice.
- The runtime still needs a full mesh/material rendering path, richer prefab/component instancing beyond the current projected debug proxies, broader scene simulation, and broader native verification.
- The save system still needs wider world-state persistence, multiple slots, profile/settings support, and migration-aware tooling beyond the current quick-save lane.
- Packaging still needs auto-build/bake orchestration, archive generation, signing, richer preset families, and real cooked-runtime loading beyond the current release-layout scaffold.
- The content pipeline still needs the real FlatBuffers writer, import lanes, and deeper preview surfaces beyond the first staged bake path.
- Audio still needs the real playback backend, bus mixing/control, and preview surfaces on top of the new authored event-definition lane.
- Animation still needs runtime graph consumption of the deterministic sampler, blending, graph-parameter control, root-motion application, and preview tooling on top of the authored graph-definition lane.
- Spatial authoring still needs generic bake/runtime consumption, runtime collision/physics integration, attachment rendering and revision-bound native frame capture, recapture/review-packet operations, and typed CLI/MCP validation/review adapters beyond the implemented sessiond operation validation, revision-bound `spatial_attachment_read`, attachment mutation revalidation, diagnostics, and authored runtime camera.
- Physics still needs the real backend integration, sweeps, joints, character support, and richer debug gizmos/capture on top of the new authored query-definition lane.
- Migration still needs high-fidelity scene/prefab graphs, real asset payload import, gameplay conversion, conflict-safe reimport, and exporter-assisted Unreal extraction beyond the current fixture-backed project skeleton and startup-setting lane.
- Code trust still needs stronger artifact verification, trust-promotion workflows, and real code hot-reload contracts beyond the current policy-and-approval slice.
- Activity still needs safe explicit coordination before it can apply or undo. Non-spatial MCP mutation likewise needs engine-owned resource keys and lease enforcement; scene and general asset operations are not in this slice.
- Profiling still needs Tracy/RenderDoc integration, GPU and memory diagnostics, native profiling panels, and deeper performance-regression workflows beyond the current diagnostics snapshot lane.
- Tooling UI still needs the full Dear ImGui frontend and deeper authoring/profiling panels.
