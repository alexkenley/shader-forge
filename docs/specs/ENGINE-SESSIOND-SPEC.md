# Engine Sessiond Spec

## Purpose

`engine_sessiond` is the local backend for shell sessions, PTY terminals, filesystem APIs, git APIs, runtime lifecycle, and shell/runtime coordination.

## Phase 2 Initial Slice

The first implemented slice is intentionally narrow and dependency-free.

Current implemented surfaces:

- `GET /health`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `GET /api/files/list`
- `GET /api/files/read`
- `POST /api/files/write`
- `GET /api/runtime/status`
- `POST /api/runtime/start`
- `POST /api/runtime/stop`
- `POST /api/runtime/restart`
- `POST /api/runtime/pause`
- `POST /api/runtime/resume`
- `POST /api/build/runtime`
- `POST /api/build/stop`
- `GET /api/ai/providers`
- `POST /api/ai/test`
- `GET /api/package/inspect`
- `POST /api/package/run`
- `GET /api/profile/live`
- `GET /api/profile/captures`
- `POST /api/profile/capture`
- `GET /api/code-trust/summary`
- `POST /api/code-trust/evaluate`
- `GET /api/code-trust/artifacts`
- `POST /api/code-trust/artifacts/transition`
- `GET /api/code-trust/approvals`
- `POST /api/code-trust/approvals/:id/decision`
- `POST /api/coordination/agents`
- `POST /api/coordination/agents/:id/heartbeat`
- `POST /api/coordination/agents/:id/disconnect`
- `GET /api/coordination/state`
- `POST /api/coordination/leases`
- `GET /api/coordination/leases/:id`
- `POST /api/coordination/leases/:id/release`
- `POST /api/operations/file-write/preview`
- `POST /api/operations/spatial-attachment/preview`
- `POST /api/operations/scene-asset/preview`
- `GET /api/spatial/attachment/evaluate`
- `GET /api/spatial/attachment/evaluate-sample`
- `GET /api/operations`
- `GET /api/operations/:id`
- `POST /api/operations/:id/approve`
- `POST /api/operations/:id/reject`
- `POST /api/operations/:id/apply`
- `POST /api/operations/:id/undo`
- `GET /api/events`

This gives the shell and harnesses a real backend-owned session and file model before PTY and runtime lifecycle work land.

## Required APIs

- session create/get/update
- file read/write/list
- git status/diff
- PTY open/input/resize/close
- runtime start/stop/restart
- log streaming

## Current Behavior

- persistent project sessions stored in a local JSON record and restored on `engine_sessiond` startup
- concurrent session creation is serialized by the session store, and physical-root identity is canonicalized so case aliases and symlink/junction aliases resolve to one workspace session ID
- workspace identity is the canonical path plus filesystem identity (`dev`/`ino`); same-path directory replacement is rejected when the live identity no longer matches
- session `rootPath` is immutable after creation; changing workspace identity requires deleting and recreating the session. Name updates remain allowed
- existing persisted session IDs remain loadable; available roots are canonicalized when restored, while temporarily unavailable roots retain their persisted record
- legacy session records that lack `rootIdentity` are migrated during load with the existing atomic session-store persist before load returns
- file list/read/write operations enforce the canonical physical workspace boundary: existing targets are resolved with `realpath`, created targets use a verified physical parent, and symlinks or junctions cannot escape the session root
- internal bounded list/read variants reuse that same canonical and symbolic-path authority while stopping directory iteration at a caller cap and rejecting files by handle size before bounded chunked UTF-8 decoding; scene staging uses these variants instead of materializing untrusted trees before enforcing its limits
- public `GET /api/files/list` and `GET /api/files/read` use server-owned fixed limits of 4,096 entries and 1 MiB respectively; clients cannot widen them, and oversized inputs return HTTP 413 with `directory_entry_limit_exceeded` or `file_size_limit_exceeded`
- directory listings inspect link entries without following them; a link may be listed from its safe parent, but using an outside-target link as the list/read/write target is rejected
- directory listings identify symbolic-link entries explicitly so isolated staging workflows can reject them without following them
- strict UTF-8 file reads that reject invalid byte sequences instead of inserting replacement characters
- UTF-8 file writes inside the active session root, with parent-directory creation for authored asset workflows and atomic same-directory replacement that preserves the original on failure
- directory listing with stable relative paths and timestamps
- JSON HTTP API suitable for local shell integration and harness use
- HTTP requests with no Origin (native CLI/MCP) and loopback browser Origins are accepted; non-loopback browser Origins are rejected. This is a local trust boundary, not cryptographic authentication
- `engine_sessiond` binds only loopback hosts (`127.0.0.1`, `localhost`, `::1`, and other `127.0.0.0/8` addresses). Non-loopback bind hosts including `0.0.0.0` and `::` are rejected until an authenticated remote mode exists
- session persistence defaults to `~/.shader-forge/engine-sessiond/sessions.json`, with `SHADER_FORGE_SESSIOND_DATA_DIR` available to override the storage directory for local setups and harnesses
- runtime start/restart can now resolve the active session root and launch the native runtime against that project context instead of only a repo-default root
- runtime start/restart now also derives a save root under `<session-root>/saved/runtime` so runtime quick-saves stay attached to the active project workspace instead of the backend process directory
- runtime status now includes `running`, `paused`, and `stopped` states plus the active session/workspace root when the runtime was started from a shell session
- pause/resume is exposed on hosts where process-signal control is available
- `/health` reports runtime pause/resume capabilities truthfully for the current host
- file writes now pass through the shared code-trust policy layer before sessiond persists policy-relevant code or assistant-authored outputs
- runtime build and runtime start/restart now also pass through explicit code-trust policy checks so assistant-triggered compile and load transitions cannot bypass the local policy layer
- sessiond now exposes an inspectable code-trust summary plus dry-run evaluation surface for shell and future assistant clients
- `review_required` transitions now enqueue explicit approval records instead of only surfacing diagnostics
- queued approvals can be listed, approved, denied, or marked failed after attempted replay
- approving a deferred file write replays the stored request and records trust metadata under `<session-root>/.shader-forge/code-trust-artifacts.json`
- approval lifecycle changes now stream through the same SSE event bus as runtime, build, and terminal events
- policy-relevant artifact writes now record trust metadata under `<session-root>/.shader-forge/code-trust-artifacts.json`
- tracked artifacts now also carry content hashes plus verification state so risky transitions can distinguish reviewed, modified, missing, and quarantined files
- `GET /api/code-trust/artifacts` now exposes the full tracked-artifact list for a workspace instead of only the summary card slice
- `POST /api/code-trust/artifacts/transition` now supports explicit `promote` and `quarantine` transitions through the same SessionStore mutation lane as file writes and operation apply/undo, and those transitions emit SSE updates so shell trust state can refresh without polling hacks
- CLI `engine policy promote|quarantine` calls that sessiond HTTP route instead of mutating artifacts in another process; sessiond is the mutation authority and this slice does not add an inter-process lock
- artifact files under `<session-root>/.shader-forge/code-trust-artifacts.json` use serialized atomic replacement
- cooperative engine clients are covered by that serialized lane; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee
- sessiond now exposes workspace-backed AI provider inspection and smoke-test routes so the shell and harnesses can inspect `ai/providers.toml` without building their own provider clients
- `GET /api/ai/providers` now reports manifest source, default provider, provider readiness, installed Ollama models when reachable, and diagnostics for unimplemented hosted-provider entries
- `POST /api/ai/test` now runs the current first-slice smoke-test path through the shared AI layer, with deterministic fake-provider coverage and optional Ollama-backed requests
- sessiond now exposes workspace-backed export-preset inspection and release-layout packaging routes so the shell can drive the first Phase 6.2 package workflow without scraping terminal output
- `GET /api/package/inspect` reports export preset source, prerequisite path readiness, cooked-asset counts, and last package metadata for a workspace, including whether runtime build or asset-bake prep is still needed
- `POST /api/package/run` now emits the first reproducible release-layout scaffold under `build/package/<preset>/`, bundling the runtime binary, packaged authored runtime roots, cooked outputs, launch scripts, and a package report; missing cooked outputs can be auto-baked before packaging
- sessiond now also records recent runtime and build log tails so profiling captures can preserve live diagnostics instead of only static workspace inspection
- `GET /api/profile/live` returns the first Phase 6.3 live diagnostics snapshot, including runtime/build state, recent log tails, git summary, AI/code-trust counts, packaging readiness, and recent capture history
- `GET /api/profile/captures` now lists persisted diagnostics captures for the active workspace session
- `POST /api/profile/capture` now writes a shareable JSON diagnostics capture under `build/profiling/captures/` from that same live snapshot lane
- sessiond now provides an in-process multi-agent coordinator for future process-scoped MCP clients instead of forcing every agent through one global bridge lock
- agents register against an existing workspace session and receive an opaque credential that is returned once and excluded from state, lease, event, log, and error views
- agent-owned heartbeat, disconnect, lease request, and lease release operations require that credential, and a lease can only be released by its owning agent
- resource leases use normalized hierarchical keys: read/read overlaps are allowed, while any overlapping ancestor/descendant write conflict queues in FIFO order
- later readers cannot bypass an earlier conflicting queued writer, preventing writer starvation
- `build` and `runtime` are documented workspace-scoped exclusive resources, so unrelated work and separate workspace sessions remain concurrent
- disconnect, heartbeat expiry, lease release, and workspace deletion clean up held work and promote eligible queued leases
- coordination lifecycle changes stream through the existing SSE event bus without exposing agent credentials
- sessiond now owns a revision-safe text-file write operation workflow with preview, approval, reject, apply, undo, durable applying/undoing journal states, and restart reconciliation
- file-write operations persist atomically in the sessiond state directory as `operations.json` so Activity/Changes history survives backend restart
- `GET /api/operations/:id/diff` derives only the selected operation's exact structured text hunks from private journal bytes. It binds path and before/after revisions, preserves line coordinates and endings, and caps combined UTF-8 input at 256 KiB, comparison work at 1,000,000 cells, response output at 400 lines, and context at three lines. Binary-like, too-large, or unavailable input degrades to a public summary plus a typed reason and no hunks; list/detail/SSE shapes remain unchanged
- each operation stores the canonical workspace-root identity captured at preview; apply/undo/recovery reject a mismatched live session root
- persisted operations are validated on load, including preview schema, the full event type/state sequence, and coherent applying/apply plus undoing/undo effect shapes; invalid records are skipped and cannot become applicable
- a fabricated `applying` record marked `recorded` without an evaluation and artifact is rejected on load and cannot recover to `applied`
- revisions are SHA-256 content hashes plus an explicit `missing` sentinel; stale preview/apply/undo calls return HTTP 409 with a structured conflict
- preview reads and apply/undo writes reuse `SessionStore` physical-boundary enforcement rather than a second path resolver
- every project-file writer and every supported code-trust artifact transition, including `POST /api/files/write`, operation apply/undo, and CLI provenance promote/quarantine, shares one serialized `SessionStore` file-mutation queue with compare-and-write / compare-and-remove primitives plus an optional `beforeMutation` callback
- apply snapshots prior artifacts in that `beforeMutation` callback and persists them before source bytes change; undo provenance precheck runs in the same callback so a transition cannot interleave between precheck, source mutation, and artifact restore
- apply/undo persist journal state before touching the project file; a persistence failure after the file mutation is recovered by revision comparison, not a blind retry
- `applying`+`recorded` and `undoing`+`reverted` after a terminal journal persist failure reload and finalize without repeating the effect
- an artifact conflict observed during startup recovery persists a terminal `conflicted` record with append-only provenance rather than leaving `undoing` forever
- apply/undo failure and recovery append `apply_failed`, `undo_failed`, or `recovered` events and never replace or delete persisted transitions; recovery is attributed to the last applying/undoing actor
- replacement uses a same-directory temp-file + rename without a Windows delete-destination fallback, so a failed replacement preserves the original
- existing POSIX mode bits are preserved on replacement where the host supports them; existing files that are not valid UTF-8 are rejected
- approve/reject/apply/undo require an explicit valid actor and never default to anonymous human; recorded actors are local provenance, not cryptographic attribution
- operation apply reuses the existing code-trust evaluate / review-queue path used by `POST /api/files/write`, but artifact recording is a journaled idempotent effect that must succeed before the operation is `applied`
- operation undo refreshes, reverts, or tombstones that same code-trust artifact in the recoverable effect lane
- the initial released operation-store format is internally consistent; operation records were unshipped on main `37b862c`, so this slice does not migrate intermediate WIP operation schemas
- non-loopback browser Origins are rejected at the HTTP boundary; no-Origin native CLI/MCP requests and loopback shell Origins remain allowed. This is a local trust boundary, not client authentication
- operation lifecycle events stream through the existing SSE bus; credentials and file contents are not persisted in public views
- semantic scene/prefab preview uses canonical lease resources `scene/world/<id>` and `scene/prefab/<id>` for save/create/duplicate; duplicate covers and revision-binds both source and target, while rename fails with `multi_file_operation_required`
- preview and mutation-lane apply/undo stage bounded full authored content plus the foundation manifest and delegate schema/relationship truth to native `DataFoundation`; target/source revisions, full input manifest, and granted lease are rechecked before journaling or mutation
- the native scene-asset validator fails closed with `scene_asset_validator_unavailable`; `engine build data`, runtime build preparation, and both clean-start scripts provision `shader_forge_data` instead of permitting a raw-write fallback
- public JSON request bodies are rejected with HTTP 413 once accumulated bytes exceed 1 MiB, including chunked requests without `Content-Length`; `/health` advertises `operations:scene-asset`
- `GET /api/spatial/attachment/evaluate` accepts an existing `animation/attachments/*.attachment.toml` path plus its exact SHA-256 `baseRevision`; `GET /api/spatial/attachment/evaluate-sample` additionally requires `phase` and finite `normalizedTime` in `[0,1]`
- both routes reject links and stale revisions through strict `SessionStore` reads; stage the current animation tree, every authored `content/**/*.toml`, and `data/foundation/engine-data-layout.toml`; bind the selected profile; validate independent exact authored visual-box and collision-box/capsule evidence; and compare the complete sorted revision manifest against the live tree before returning `{ evaluation, path, revision, sourceRevisions }`
- selected attachment drift returns `revision_conflict`; another added, removed, or changed animation/content/foundation input returns `spatial_evaluation_inputs_changed` with the first sorted differing path and expected/actual revision. A file or directory deleted while the initial snapshot is being read fails closed with the same code and a bounded relative path only, because no truthful expected revision exists yet
- both GET evaluations are transient and read-only: they require no agent or lease, create no operation, write no operation journal or authored/cooked file, persist no evaluation, emit no operation event, and always remove their temporary staging root
- spatial attachment preview validates and evaluates exact baseline/candidate bytes in a fresh `SessionStore`-staged animation/content/foundation snapshot, then records authoritative profile resource keys as context on the generic file-write operation. A new-file preview returns `evaluation.baseline: null`; evaluation results exist only in the immediate preview response and are not journaled
- rest evaluator output is schema-checked as an unsampled pose and sampled output is checked against the exact one-hand, v1 pre-IK, or v2 applied-IK branch; attachment identity, skeleton/item/mode/perspective, and sampled phase/time must equal validator/request authority. Lease-free GET reports stay transient; operation validation persists only their bounded diagnostic counts. Neither is rendered review evidence
- joint-limit diagnostics are an exact diagnose-only union: unavailable is only `no_joint_limits_authored`; available reports require one ordered, role-matched record for every evaluator bone. Sessiond rejects duplicate IDs, reversed limits, negative zero, non-finite/out-of-range numbers, inconsistent labels/counts/maxima, and even sub-tolerance values that cross the exact zero/violation boundary. It recomputes swing/twist truth from the raw angles and authored ranges instead of trusting evaluator aggregates. Clamp policy is rejected
- clipping diagnostics are a second exact diagnose-only union with metric `capsule_axis_to_oriented_box_clearance`. Unavailable accepts only `item_prefab_not_found`, `item_prefab_ambiguous`, `item_prefab_invalid`, `item_collision_not_authored`, or `diagnostic_capsules_not_authored`, with zero counts/max, null overlap/box, and no capsules. Available requires a positive authored collision box, eight recomposable corners, and a non-empty skeleton-ordered role-matched capsule list. Sessiond independently recomposes capsule endpoints, recomputes segment-to-oriented-box distance, `surfaceClearanceMeters = axisDistanceToBoxMeters - radiusMeters`, positive overlap depth, per-capsule overlap, aggregate count/max/boolean, and exact tangency as non-overlap. Unknown keys/reasons, negative zero, non-finite values, invalid vectors/dimensions, ordering/role mismatches, geometric falsehoods, inconsistent signs/zero boundaries, or contradictory aggregates fail closed; a `1e-6` numeric comparison tolerance never permits a sign or exact-zero transition
- preview re-authenticates and rechecks the granted write lease after both evaluations and immediately before operation creation, so expiry or release during evaluator work cannot create an operation
- attachment ID renames require one granted write lease covering both old and new `spatial/attachment/<id>` keys; apply and undo accept a renewed matching lease but re-authenticate and recheck it immediately before mutation
- `POST /api/operations/:id/validate` is lease-free for previewed/approved spatial operations. It accepts at most 64 exact non-duplicate `{phase, normalizedTime}` samples, stages and revision-binds the full spatial source manifest, verifies the private proposed hash/base, native-validates the target substitution, evaluates rest and samples sequentially, rechecks live sources, and compare-and-swap records only the bounded summary. Controlled candidate/sample failures are journaled without proposed bytes or raw native diagnostics
- one semantic mutation dispatcher routes scene apply/undo to `SceneAssetService` and spatial apply/undo to `SpatialAttachmentService`. Spatial mutation validation runs inside the existing serialized file-mutation lane, revalidates current and resulting native truth, rechecks the live manifest without recursively acquiring that lane, and rechecks the covering write lease before source replacement. Native spatial child processes have a fixed timeout
- `sf-mcp` spatial attachment mutation tools now wire process-owned coordinator credentials and leases through this same contract; other MCP mutation families remain disabled until they persist resource keys and enforce equivalent leases
- native `engine spatial evaluate-rest|evaluate-sample` remain local commands; sessiond invokes them through transient GETs and the operation-validation staging path while preview stays rest-only. The same lease-free GETs back the session-pinned MCP `spatial_attachment_read` tool. None creates a review packet
- the canonical contract lives in [ENGINE-OPERATIONS-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-OPERATIONS-SPEC.md)
- spatial attachment preview and operation validation are implemented through this journal. Recapture/review-packet operations specified in [ENGINE-SPATIAL-AUTHORING-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md) remain deferred and reuse the same actor, revision, conflict, and lease model. They do not add a daemon. Capture holds the spatial keys plus the shared `scene/prefab/<id>` and `animation/clip/<id>` read keys used by their writers, then rechecks source revisions before publishing. Review artifacts belong under project `build/spatial-reviews/<review-id>/`, not provider-specific Saved/Codex paths.

## Future AI APIs

- a process-scoped MCP adapter over the engine-owned coordination and mutation contracts
- MCP exposure of the existing file-write and semantic scene-asset operation workflows, plus later multi-file change sets
- MCP resources for project, scene, asset, code, runtime, test, diagnostics, coordination, and activity state
- later spatial-authoring resources and tools only as an adapter over sessiond spatial operations, after those operations exist for shell and CLI. See [ENGINE-SPATIAL-AUTHORING-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).
