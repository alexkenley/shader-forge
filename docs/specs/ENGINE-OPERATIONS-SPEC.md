# Engine Operations Spec

Status: hardened text-file write slice plus bounded selected-operation diff, transient spatial evaluation, attachment preview context, semantic scene/prefab backend operations, and CLI adapter implemented

Date: 2026-08-31

## Purpose

Shader Forge mutations must be previewable, revision-checked, attributable, atomically applied, and undoable before shell, CLI, and MCP clients share a write path.

This spec is the canonical contract for engine-owned operations. The implemented slice is a workspace-scoped text-file write workflow owned by `engine_sessiond`. It is the shared backend for Activity review, the spatial CLI and Assets tuner, and the first lease-gated `sf-mcp` spatial mutation tools. It does not replace `POST /api/files/write`.

`sf-mcp` exposes only the spatial attachment operation family because it has durable resource keys and authoritative lease checks. Generic MCP file apply/undo remains disabled. Actor strings recorded on operations are local provenance, not cryptographic attribution.

## Current Implemented Slice

`engine_sessiond` records file-write operations with:

- a stable `op_` identifier
- actor provenance whose `kind` is `human`, `shell`, `cli`, or `mcp`, plus `id` and `name` strings
- a normalized project-relative path
- the canonical physical `workspaceRoot` captured at preview
- created and updated timestamps
- state
- base revision and proposed revision
- a line-oriented preview summary
- journaled code-trust effect status (`idle`, `pending`, `recorded`, `reverted`, `skipped`, `failed`) with coherent applying/apply and undoing/undo shapes
- append-only lifecycle events, including `apply_failed`, `undo_failed`, and `recovered`

Spatial attachment previews remain `kind: "file_write"` and add only this normalized public context: `type: "spatial_attachment"`, non-empty `label`, authoritative candidate `subjectId`, sorted `resourceKeys`, and the preview `leaseId`. The context survives restart. Credentials and staged validation paths do not enter the journal.

The immediate spatial preview response also contains transient `evaluation.baseline` and `evaluation.candidate` rest-pose schematics. Baseline is `null` for a new file. These reports are not operation fields: they do not enter `operations.json`, public operation views, SSE, restart state, or later apply/undo responses.

Approve, reject, apply, and undo require an explicit valid actor object. The backend never defaults a missing actor to anonymous `human`. Credentials are stripped and are never stored, returned, or streamed.

Records persist atomically in the sessiond state directory as `operations.json`, next to `sessions.json`. Restarting `engine_sessiond` does not erase Activity/Changes history. Invalid persisted records are skipped on load and cannot become applicable operations.

Each operation also stores the canonical physical workspace-root identity captured at preview. Workspace identity is the canonical path plus filesystem identity (`dev`/`ino`). Session `rootPath` is immutable after creation; changing workspace identity requires deleting and recreating the session. Apply, undo, and restart recovery reject a record whose stored workspace root no longer matches the live session.

Legacy session records that lack `rootIdentity` are migrated during `SessionStore` load using the existing atomic session-store persist, before load returns. Operation records were unshipped on main `37b862c`; this slice keeps the initial released `operations.json` format internally consistent and skips invalid records rather than migrating intermediate WIP operation schemas.

## Revisions

A revision is a SHA-256 hash of UTF-8 file bytes, formatted as `sha256:<hex>`.

The explicit missing-file sentinel is `missing`.

Existing files are decoded as strict UTF-8. Invalid byte sequences are rejected; the backend does not decode replacement characters and continue.

Preview reads the current file through `SessionStore` physical-boundary enforcement (the same `realpath` / verified-parent / symlink-and-junction containment used by list/read/write). The caller's `baseRevision` must match the current revision. Before-content and proposed-content are stored server-side for later apply and undo. They are omitted from list/get views and SSE payloads. On load, recomputed hashes of stored before/proposed content must match the persisted revisions or the record is skipped.

A stale base revision returns HTTP 409 with a structured conflict:

```json
{
  "error": "File revision conflict.",
  "conflict": {
    "code": "revision_conflict",
    "path": "notes/existing.txt",
    "expectedRevision": "sha256:...",
    "actualRevision": "sha256:..."
  }
}
```

## HTTP Surface

- `POST /api/operations/file-write/preview`
- `POST /api/operations/spatial-attachment/preview`
- `POST /api/operations/scene-asset/preview`
- `GET /api/spatial/attachment/evaluate`
- `GET /api/spatial/attachment/evaluate-sample`
- `GET /api/operations`
- `GET /api/operations/:id`
- `GET /api/operations/:id/diff`
- `POST /api/operations/:id/approve`
- `POST /api/operations/:id/reject`
- `POST /api/operations/:id/apply`
- `POST /api/operations/:id/undo`

Preview body:

- `sessionId`
- `path`
- `content` (UTF-8 text)
- `baseRevision`
- `actor.kind` / `actor.id` / `actor.name`

Preview does not mutate the workspace file.

The selected-operation diff route derives a structured line diff from the operation journal without widening list, detail, or SSE operation views. Its response binds `operationId` and `path` to `beforeRevision` / `afterRevision`, repeats the public preview summary, and returns bounded hunks. Every hunk has old/new start and line counts. Every returned line is exactly one `context`, `removed`, or `added` line with nullable old/new line coordinates, text, and an explicit `lf`, `crlf`, `cr`, or `none` ending.

Diff construction is deliberately bounded before dynamic-programming work: combined source text may be at most 256 KiB, the line comparison matrix may contain at most 1,000,000 cells, and the response may contain at most 400 hunk lines with three context lines around changes. A partial exact response sets `truncated: true`. Binary-like data, oversized input/comparison work, or unavailable journal bytes return `status: "summary_only"`, an exact `binary`, `too_large`, or `unavailable` reason, the public summary, and no hunks. The endpoint never returns the private journal byte fields or coordinator credentials. Unknown operation ids return HTTP 404.

Spatial attachment preview accepts only `animation/attachments/*.attachment.toml`. It requires full `content`, `baseRevision`, non-empty `label`, `actor`, `agentId`, `leaseId`, and the coordinator credential. Sessiond rejects stale revisions, stages a fresh animation/content/foundation snapshot exclusively through strict `SessionStore` reads, rejects symbolic sources, and validates baseline/candidate. The stable source mapping selects authoritative profile identities. Evaluator geometry must be either an exact typed unavailable reason or one eight-corner authored visual box that recomposes from the item frame. One granted write lease covers old/new IDs on rename; sessiond rechecks the complete input manifest and lease before operation creation. The temporary root is always removed.

Semantic scene assets use `scene/world/<id>` and prefabs use `scene/prefab/<id>`. `save`, `create`, and `duplicate` stage the full authored `content/**/*.toml` tree plus `data/foundation/engine-data-layout.toml`, then invoke the native `shader_forge_data validate-asset` command. Staging rejects symbolic paths and caps traversal at 16,384 entries, included sources at 4,096 files, total included UTF-8 source at 32 MiB, and the candidate at 1 MiB; the foundation file counts toward both file and byte limits. The native `DataFoundation` catalog is the schema and relationship authority; sessiond only checks the bounded protocol response and request binding. Preview rechecks the target revision, duplicate source revision, complete staged manifest, and one granted write lease covering the target plus duplicate source before it journals a generic file-write operation. Apply and undo bind the operation path back to its semantic subject, then repeat native validation, manifest checks, duplicate-source revision checks, and lease authentication from inside the serialized `SessionStore` mutation lane. Validator failure restores the stable `approved` or `applied` state without writing candidate bytes. Credentials and transient validation reports are not journaled.

Scene/prefab `rename` is rejected with stable code `multi_file_operation_required`: changing an asset ID can require bootstrap, scene, prefab, and other referer edits that the single-file journal cannot represent atomically. Duplicate content is not arbitrary cloning under a label; native validation requires its authored `name` and canonical staged path to bind to the target ID.

`GET /api/spatial/attachment/evaluate` accepts `sessionId`, an existing attachment `path`, and a non-`missing` SHA-256 `baseRevision`. Sessiond stages the current animation tree, every authored content TOML, and the data-foundation manifest; binds evaluation to the selected profile; and passes the three staged roots to the native evaluator. After evaluation it compares every staged input against a sorted live revision manifest. Selected attachment drift retains `revision_conflict`; any other animation/content/foundation change returns `spatial_evaluation_inputs_changed`.

`GET /api/spatial/attachment/evaluate-sample` adds required `phase` and locale-independent finite `normalizedTime` in `[0,1]`. The native loader remains authoritative for unknown phases and times not listed in the authored motion envelope. The response uses the same identity, full-input revision, cleanup, and transient-read guarantees, while its complete report validator accepts only the exact one-hand, schema-v1 pre-IK, or schema-v2 applied-IK branch and binds the returned phase/time to the request.

Both GET routes require no lease because they are read-only and create no operation, journal entry, persisted evaluation, SSE event, authored write, or cooked output. Preview and the rest GET retain `pose.sampled=false`. The sampled GET returns `pose.sampled=true` and numeric IK truth, but it remains schematic, carries `not_review_evidence`, and provides no rendered capture or review packet.

Rest and sampled reports may include diagnose-only joint-limit evidence. Sessiond accepts only the exact unavailable `no_joint_limits_authored` form or a complete ordered per-bone report whose roles, ranges, violations, labels, counts, and maximum agree with recomputed evaluator truth. This evidence remains transient and never becomes operation validation, a clamp request, or review evidence.

## State Machine

Supported states: `previewed`, `approved`, `rejected`, `applying`, `applied`, `undoing`, `undone`, `conflicted`.

Client-driven transitions:

- `previewed` -> `approved` or `rejected`
- `approved` -> `applied`, `rejected`, or `conflicted`
- `applied` -> `undone` or `conflicted`

`applying` and `undoing` are durable journal intermediates, not client-requested states. They exist only while apply/undo is in flight or awaiting restart reconciliation.

Invalid transitions return HTTP 409. `rejected`, `undone`, and `conflicted` are terminal in this slice. A conflicted operation is not retried; the caller previews a new operation from the current revision.

## Serialized File Mutation

Every project-file writer and every supported code-trust artifact transition shares one `SessionStore` file-mutation queue. That includes `POST /api/files/write`, operation apply/undo, and `POST /api/code-trust/artifacts/transition`. CLI `engine policy promote|quarantine` calls that same sessiond HTTP route instead of mutating artifacts in another process. Sessiond is the mutation authority; this slice does not add an inter-process lock.

Compare-and-write and compare-and-remove inspect revision and workspace identity, then run an optional `beforeMutation` callback, then mutate source bytes, then run `afterMutation`. `beforeMutation` executes inside the existing serialized queue after that inspection and before source mutation. Direct writes and provenance transitions cannot sneak between inspect, snapshot/precheck, source mutation, and artifact restore.

`SessionStore` throws a structured `revision_conflict` from those primitives. Artifact files under `.shader-forge/code-trust-artifacts.json` use serialized atomic replacement. The file-mutation queue is process-global on purpose. Upgrade to per-path serialization only if throughput later matters.

This covers cooperative engine clients (shell, CLI, sessiond, and later MCP callers of the same contract). Hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee.

## Apply And Undo

Apply requires `approved` state and an explicit actor. It reuses the existing code-trust policy/evaluation/review-queue path used by `POST /api/files/write`: `evaluateCodeTrustAction` with action `apply` and the same review/deny queue. Operation actor kinds `human`, `shell`, and `cli` evaluate as code-trust `human`. `mcp` evaluates as code-trust `assistant`. This is not a second policy model.

Apply and undo for a spatial-context operation also require a currently granted matching write lease. `agentId` and `leaseId` are supplied in the mutation body and the credential header authenticates the agent. A renewed lease may replace the preview lease when it covers every persisted resource key. Sessiond rechecks immediately before mutation admission; approval/reject remain lease-free review transitions.

Code-trust artifact recording is a journaled operation effect, not a post-apply side effect. The apply path:

1. persists `applying` in `operations.json` before touching the project file, including pending code-trust effect metadata
2. inside the SessionStore mutation lane, snapshots any prior artifact in `beforeMutation` and persists that snapshot before source bytes change
3. compare-and-writes the proposed bytes against the recorded base revision
4. runs an idempotent code-trust finalizer in `afterMutation` and persists `applying` plus `recorded` or `skipped` before the terminal `applied` journal record
5. persists `applied` with `appliedRevision` and effect status `recorded` or `skipped`

The record is not declared `applied` until that finalizer succeeds. A failed effect stays `applying` with effect status `failed` so startup recovery can retry it. Direct `POST /api/files/write` still records artifacts in the same SessionStore mutation as the write; only the operation journal owns recoverable operation effects.

Undo requires `applied` state and an explicit actor, persists `undoing` first, then inside the same mutation lane:

- prechecks artifact provenance in `beforeMutation` after revision/identity inspection and before source mutation
- compare-and-writes the stored before-bytes when the file existed at preview time
- compare-and-removes the file when the operation created it (`baseRevision` was `missing`)
- reruns the same recoverable code-trust effect lane in `afterMutation` so the tracked artifact is refreshed, reverted, or tombstoned to match the restored bytes

A later promote/quarantine either runs to completion first, in which case undo leaves the source unchanged and records a `code_trust_artifact_conflict`, or undo completes atomically first. Undo must not return 409 after it has already restored source bytes.

Undo records `resultingRevision` (`sha256:...` or `missing`) and emits `operation.undone`. Trust metadata must not keep claiming reverted bytes are still applied. Expected content-hash validation remains in the finalizer: apply records must match the proposed SHA-256, and undo restore checks the restored bytes.

Replacement uses a same-directory temp-file + rename. A failed replacement never deletes the destination first; the original file is preserved. Existing POSIX mode bits, including executable bits, are copied onto the replacement where the host supports them.

An external change before apply or undo returns 409, marks the operation `conflicted`, and leaves the on-disk file unchanged.

## Journal Recovery

On startup, intermediate `applying` / `undoing` records are reconciled by comparing the current file revision with the recorded base, proposed, and applied revisions:

- if the file mutation landed, resume/finalize the code-trust effect and complete the record to `applied` or `undone`
- if the file is still at the prior stable revision, append a `recovered` event and return to `approved` or `applied`
- if an artifact conflict is observed while recovering a landed undo/apply, persist a terminal `conflicted` record with append-only provenance rather than leaving `undoing` or `applying` forever
- otherwise mark `conflicted`

Valid crash windows stay recoverable without repeating a completed effect:

- `applying` + `recorded` after a terminal `applied` persist failure reloads and finalizes to `applied`
- `undoing` + `reverted` after a terminal `undone` persist failure reloads and finalizes to `undone`

A persistence failure after the file mutation keeps the journal in the intermediate state. Restart recovery is comparison-based and does not blindly retry the write. Recovery events are attributed to the actor that initiated the last `applying` or `undoing` event, not the original proposer.

The event log is append-only. Apply/undo failure and recovery never replace or delete persisted transition events. A failed file mutation appends `apply_failed` or `undo_failed` and returns to the prior stable state while keeping the in-flight event.

## Local Trust Boundary

`engine_sessiond` is a loopback control plane, not a remote authenticated API.

- the HTTP server binds only loopback hosts such as `127.0.0.1`, `localhost`, and `::1`
- non-loopback bind hosts, including `0.0.0.0` and `::`, are rejected unless a future authenticated remote mode is explicitly implemented
- requests with no `Origin` header (native CLI and `sf-mcp` stdio) are accepted
- loopback browser Origins such as `http://127.0.0.1`, `http://localhost`, and `http://[::1]` are accepted for local shell development
- non-loopback browser Origins are rejected at the HTTP boundary

The bind-host and Origin checks are a local trust boundary. They are not cryptographic client authentication and do not attribute actors.

MCP spatial mutation tools now wire process-owned coordinator credentials and leases through this same operation contract. Other operation families remain disabled until they define equivalent durable resource keys and authoritative checks.

## Spatial CLI Adapter

The implemented `engine spatial preview|approve|reject|apply|undo` commands are thin clients of these HTTP routes. Preview reads a strict BOM-free UTF-8 `--content-file` and sends full candidate content; it never writes the source file. Preview/apply/undo read the coordinator credential only from `SHADER_FORGE_AGENT_CREDENTIAL`, while agent and lease IDs remain explicit arguments. Approve/reject are lease-free review transitions. Every command uses the fixed CLI actor and prints the returned JSON.

The CLI does not auto-register agents, acquire or renew leases, auto-approve, build the native tool, or call `/api/files/write`. `sf-mcp` now adapts the same spatial preview/review/apply/undo routes with its process-owned agent and credential; operation-scoped spatial validation, capture, diagnostics, and review packets remain deferred.

## Spatial Shell Adapter

The `Assets` workspace now adapts the same semantic spatial preview and generic transitions. It never calls `/api/files/write`. File selection is read-only; explicit `Begin tuning` registers the fixed shell actor and requests the exact attachment write lease. Source is reread after grant, and each preview/apply/undo heartbeats the agent and rechecks the live lease immediately before the request.

Candidate values are labelled `NOT APPLIED`. Approve and Apply are separate buttons, Reject is available before apply, and editing locks after preview. Apply releases the lease and disconnects instead of holding coordination indefinitely. Undo explicitly reacquires a fresh lease covering the operation resource keys. The opaque credential exists only in memory and the credential header; client errors preserve status/code/diagnostic/conflict while redacting it.

## Spatial MCP Adapter

The process-scoped `sf-mcp` server exposes `operation_list`, `operation_read`, `spatial_attachment_preview`, `operation_approve`, `operation_reject`, `operation_apply`, and `operation_undo` over this same contract. Session id, MCP actor, coordinator agent id, and credential come from process state rather than model-provided arguments.

Preview, apply, and undo heartbeat and inspect the process-owned lease before calling sessiond. Apply and undo accept only spatial attachment operations, require coverage for every persisted `context.resourceKeys` entry, and are rechecked authoritatively inside sessiond immediately before mutation. Operation ids are resolved against the process-selected workspace before every transition. A 409 returns safe structured conflict data plus a refreshed authoritative operation when available; the adapter does not retry, approve, apply, undo, acquire, or release implicitly.

Generic file-write apply/undo remains unavailable through MCP because context-free file operations do not persist authoritative lease resource keys. The adapter never calls `POST /api/files/write`.

## Activity Shell Adapter

The global shell `Activity` bottom-dock tab lists the active session through `GET /api/operations`, reads selected detail through `GET /api/operations/:id`, loads exact bounded changes only for that selection through `GET /api/operations/:id/diff`, and refreshes from the public operation SSE notifications. It uses the fixed shell actor for lease-free approve/reject only. A 409 transition race causes an authoritative detail/list refetch.

Activity renders the public operation view plus the selected structured diff. It rejects a diff whose operation id, path, or revisions do not match the current selection, renders exact line coordinates and endings in a keyboard-scrollable table, labels truncated output, and explains summary-only degradation truthfully. It never receives the journal's private raw-content fields. Apply, Undo, agent registration, leases, and credentials are absent until a later explicit coordination workflow can safely own them.

## Events

Lifecycle events stream on the existing `/api/events` SSE bus:

- `operation.previewed`
- `operation.approved`
- `operation.rejected`
- `operation.applied`
- `operation.undone`
- `operation.conflicted`

Payloads are operation views. They do not include file contents or credentials.

## Path And Trust Boundary

Operations reuse `SessionStore` path resolution. Symlinks and junctions cannot escape the session root. This slice does not introduce a second path resolver.

`POST /api/files/write` remains available and still runs the same code-trust policy. Operation apply uses that same evaluate/review-queue path, then records the artifact through the operation journal's recoverable effect lane rather than bypassing policy or recording after the operation is already durable. Multi-file change sets, shell scene-operation integration, Activity apply/undo coordination, and non-spatial MCP mutation tools are later slices.

## Persistence Validation

Records are loaded only when all of the following hold:

- state is one of the supported states
- actor kind is `human`, `shell`, `cli`, or `mcp`
- timestamps are ISO-8601
- revisions are `sha256:<hex>` or `missing` as required by the state
- preview schema is complete (`addedLines`, `removedLines`, `beforeLineCount`, `afterLineCount`, `created`, `summary`)
- a canonical `workspaceRoot` string is present
- event types and shapes are known
- the event type/state sequence is a legal transition history, and the final event state matches the record state
- recomputed hashes of stored before/proposed content match the persisted revisions
- code-trust effects are coherent for the record state, including applying/apply and undoing/undo combinations

Required effect shapes:

- `idle` is phase-less and has no evaluation, artifact, or error
- `pending` requires an evaluation and is apply or undo
- `failed` requires an evaluation and error string
- `recorded` is apply-phase and requires both an evaluation and an artifact
- `reverted` is undo-phase and requires an evaluation
- `skipped` is apply or undo with no artifact or error

A fabricated `applying` record marked `recorded`/`apply` without an evaluation and artifact is rejected on load and must never recover to `applied`.

Invalid records are skipped. They cannot be listed as applicable operations.

## Verification

`npm run test:sessiond` covers the first-pass workflow plus:

- preview without mutation
- selected-operation exact diff coordinates/endings, restart readability, output truncation, binary/too-large summary-only degradation, 404 handling, and exclusion of private journal field names and actor credentials
- approval plus apply
- stale-base conflict
- external-change conflict before apply
- undo
- created-file undo
- restart persistence
- lifecycle event emission
- invalid transitions
- path-boundary enforcement
- deterministic rename-barrier serialization of a direct write behind an in-flight apply
- simulated persistence failure plus restart reconciliation for apply and undo
- replacement failure preserving the original file and appending `apply_failed`
- invalid UTF-8 rejection
- executable mode preservation where the host supports it
- non-loopback Origin rejection
- non-loopback bind-host rejection, including `0.0.0.0` and `::`
- missing actors
- immutable session `rootPath` plus operation workspace-identity mismatch rejection
- journaled code-trust apply/undo effects, including failed-effect recovery
- prior-artifact snapshot persisted inside the mutation lane before source bytes change
- undo provenance precheck inside the same lane, plus a deterministic promote-during-undo barrier
- applying/undoing effect-state validation, including rejection of fabricated `applying`+`recorded` records without evaluation/artifact
- applying+recorded and undoing+reverted crash windows that finalize without repeating the effect
- persisted legacy session `rootIdentity` migration plus same-path root replacement
- malformed persisted records skipped on load, including preview-schema, event-sequence, and final-event/state corruption

`npm run test:spatial-operations` additionally covers the revision-safe GET, strict path/symlink and source-ID binding, exact staged baseline/candidate bytes, exact fail-closed joint-limit protocol and recomputed truth, new-file `baseline: null`, final-read revision drift, malformed or wrong-ID evaluator output, bounded unavailable/infrastructure errors, temporary cleanup, journal absence for GET, non-persistence of preview evaluations, and the post-evaluation preview lease recheck.

`npm run test:data-tool` compiles and executes the native selected-asset validator. `npm run test:scene-operations` covers save/create/duplicate context, canonical resource keys, target/source revisions, lease coverage, no-write preview, HTTP routing, mutation-lane apply/undo validation, retryable validation failure, native response binding, credential exclusion, and rename refusal.
