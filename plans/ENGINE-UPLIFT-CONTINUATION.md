# Shader Forge Uplift Continuation

Read `AGENTS.md` first. Resume from the current pushed `origin/main`; the streamlined World/Playtest checkpoint begins at `2d2c263` and its safety/documentation follow-ups immediately after it. Work through the priorities below in order; do not reopen settled product direction.

## Fixed product direction

- Build an AI-native, general-purpose alternative to Unity and Unreal Engine.
- Agents work through the external **Shader Forge MCP** (`sf-mcp`) and engine-owned CLI/session APIs. Do not add a built-in chat assistant.
- Multi-agent work is native: all mutations use semantic resources, leases, revision checks, previews, durable operations, validation, and auditable apply/undo. Agents must not write over one another or directly drive a fragile single-lane editor bridge.
- The human loop is **view, verify, play, tune**. Keep default UI plain, sparse, and task-led; hide technical facts and low-level controls under diagnostics.
- Text/code assets remain source of truth. Human visual tuning must write the same source-owned values that agents edit.
- Spatial collaboration is a differentiator: sockets, skeletal meshes, weapon/hand alignment, poses, deterministic evidence, and human fine-tuning must be first-class.
- Unity, Unreal, and Godot project migration remains required. Existing detection/conversion foundations are a start, not the finished migration workflow.

## Pushed checkpoint

- Persistent per-workspace layouts, bounded accessible resizing, reset, narrow-screen drawer behavior, and Playtest's minimal default layout.
- Restart-safe bounded spatial validation summary/event journal.
- Code workspace async/session/tab/operation authority guards and preservation of newer drafts.
- Streamlined World and Playtest UX: plain labels, one Play/Stop path, explicit Verify, dirty-change guards, active-object draft retention, collapsed diagnostics, and truthful external-window play messaging.
- Existing coordination foundation: process-scoped `sf-mcp`, agent registration, hierarchical leases, operation journal, spatial attachment preview/read/apply/undo, Assets tuning, and revision-bound rest/sample schematics.
- Matching specs, implementation plan, and searchable reference guide were updated through this checkpoint.

Verified at the checkpoint:

```text
npm run test:shell-layout
npm run test:code-shell
npm run test:scene-authoring
npm run test:viewer-bridge
npm run test:sessiond
npm test
npm run shell:typecheck
npm run shell:build
git diff --check
```

Known non-blocking warnings: `test:sessiond` can print the Windows `node-pty` `AttachConsole` warning, and Vite reports the existing bundle-over-500-KiB warning. Play still opens a native external window; the browser viewport is not connected.

## Work order

### 1. Move World writes onto semantic operations

Status: completed. World scene/prefab documents now carry revisions; save/create/duplicate/reusable-object save share the semantic operation helper with exact leases and authoritative reconciliation. Dirty project/session changes detach instead of resetting, public JSON input is bounded while streaming, and `shader_forge_data` is provisioned by the CLI/runtime/clean-start paths with fail-closed coverage.

Replace every raw World scene/prefab write with the existing `SceneAssetService` operation lane. Add revision-bearing scene/prefab documents and a typed shell preview call. One helper should cover save, create, duplicate, and reusable-object save: register agent, acquire canonical write lease(s), preview, verify captured session/path/content/base revision and operation identity, approve, recheck/heartbeat lease, apply, then authoritatively reread. Preserve drafts on conflicts, late responses, queued work, and uncertain apply; reconcile by rereading the operation and file, never blind-retry.

Critical rules:

- New targets use base revision `"missing"`; duplicate binds both target and source identity/revision and holds both leases.
- Keep semantic resource IDs consistent (`scene/world/<id>` and `scene/prefab/<id>`).
- Build/provision `shader_forge_data` through `engine build data`, runtime build preparation, and both clean-start scripts. `SceneAssetService` must fail closed when the validator is unavailable; never fall back to raw writes.
- Fix sessiond request limiting so the 1 MiB JSON bound is enforced while bytes are accumulated, not after the whole body is buffered.
- Before or alongside the semantic-write migration, make active project/session changes save, confirm, or explicitly detach dirty World drafts. Never reset them merely because the `activeSession` object identity refreshed; treat this as part of priority 1.

Minimum checks: `test:scene-authoring`, `test:scene-operations`, `test:sessiond` (including oversized-body 413 and health capability), `test:data-tool`, shell typecheck/build, and clean-start contract coverage.

### 2. Add native spatial operation validation and the apply dispatcher

Status: completed. Previewed/approved spatial operations now validate lease-free through native staged rest/sample evaluation and CAS only a bounded summary; strict samples, source drift, stale snapshots, private diagnostics, and native timeouts fail closed. One dispatcher routes every scene/spatial apply and undo to its semantic mutation validator, with spatial truth and lease rechecked inside the existing mutation lane without recursive locking.

Add `SpatialAttachmentService.validateOperation`, its mutation validator, and `POST /api/operations/:id/validate` before the generic action matcher. Route every apply/undo through one dispatcher: scene operations to `SceneAssetService`, spatial operations to the spatial service. Spatial apply/undo must independently validate current truth while the write lease is held.

Critical rules:

- Accept only exact samples `{ phase, normalizedTime }`: maximum 64; reject duplicate phases/times, unknown phases, non-finite numbers, negative zero, and values outside `[0,1]`.
- Stage the complete animation/content/foundation revision snapshot; verify proposed hash and base revision; replace only the staged target with the exact proposed bytes.
- Native-validate and evaluate rest plus requested samples, recheck the sorted live manifest, then CAS only the controlled journal validation summary.
- Validation is lease-free/concurrent; apply and undo remain lease-gated.
- Do not call `#assertSpatialSourcesUnchanged` while holding the mutation lock; that deadlocks. Give native child processes a fixed timeout and bound aggregate transient evidence well below the theoretical 8 MiB x 64 result.
- Never expose `proposedContent` or raw native stderr. Journal only controlled candidate/sample failures.

Minimum checks: `test:spatial-operations`, `test:sessiond`, and existing spatial native/tool harnesses affected by the evaluator contract.

### 3. Expose validation through sf-mcp and the CLI

Status: completed. `spatial_attachment_validate` and `engine spatial validate-operation <id> --samples-file <path>` are thin sessiond adapters with strict bounded samples, selected-session checks, no validation credential/lease, public-only output, and real stdio/CLI harness coverage.

After priority 2 works directly through sessiond, add the thin adapters only:

- MCP tool: `spatial_attachment_validate`
- CLI: `engine spatial validate-operation <id> --samples-file <path>`

Both must use the same sessiond route and exact sample schema; neither may duplicate validation logic, auto-apply, leak credentials, or expose proposed bytes/raw stderr. Update MCP capability discovery, reference docs, `test:mcp`, and `test:spatial-cli`.

### 4. Build real rendered spatial review evidence

Status: completed. The production native `capture-sample` primitive evaluates one exact authored phase/time and emits four deterministic depth-tested close views plus an optional strict authored root `player_camera` view, with explicit source/camera/bounds/lighting metadata and fail-clean output. Sessiond reserves new review IDs, expands selected authored phase samples, enforces source-read/capture-write/exact-review-write leases, validates PNG metadata, rechecks the full revision snapshot and leases, atomically publishes immutable packets, releases capture leases, and serves packet/capture reads. Thin CLI reserve/recapture/read commands plus MCP reserve/read/recapture tools and the `shaderforge://spatial/review/{reviewId}` resource adapt the same workflow. Assets now validates and publishes selected authored phases, loads shared review IDs, rejects malformed or mismatched packets, and displays only packet-referenced real PNGs with explicit review/sample/camera identity while keeping diagnostic schematics visibly separate.

Implement revision-bound native capture from the authored root `player_camera` plus deterministic close cameras, then immutable `build/spatial-reviews/<review-id>/` packets. Capture uses a transient native staging world, read leases for every source revision, a short exclusive `spatial/runtime-capture` lease, temporary output, final revision recheck, and atomic publish. Recapture creates a new review ID; it never mutates an old packet.

Do not promote Assets schematics, debug proxy cards, or browser screenshots as review evidence. Fail closed until real item/character rendering and clean frames exist. Packets must bind operation, leases, camera/framing, pose samples, transforms/bounds, diagnostics, source revisions, and clean/annotated capture paths.

### 5. Finish lifecycle safety and the remaining uplift backlog

Status: in progress. Runtime/build requests now use generation guards so newer commands or authoritative SSE events win, stopping a build cancels its pending auto-run, and runtime telemetry no longer replaces the authored World selection. World load, reload, save, create, and duplicate responses also require the initiating request generation plus current workspace/path authority, closing the A-to-B-to-A stale-response path. Explorer, Git, package, profiling, trust-summary, and trust-approval reads now have independent request generations and active-session guards. Package, capture, trust, and Activity review actions additionally retain the initiating workspace-selection generation; selection changes synchronously invalidate those lanes, transient busy state, and pending build auto-run intent. Workspace-list and host-directory-picker reads are generation-bound too, and workspace CRUD locks selection/edit/delete until it completes. Rendered accessibility QA also removed nested terminal buttons, added keyboard/named terminal semantics and explicit World/workspace action states, and simplified the collapsed dock to Restore only.

- Finish any remaining World lifecycle safety beyond the active-session priority-1 guard, with the same stale-response discipline as Code.
- Continue the sparse World/Playtest/Assets UX, rendered QA, accessibility, runtime identity/race cleanup, and documentation consistency.
- Expand migration from current Unity/Unreal/Godot skeleton conversion into useful asset/material/hierarchy/component/script mapping, conflict-safe reimport, provenance review, and exporter-assisted Unreal extraction.
- Then continue the ordered engine/runtime backlog in `ENGINE-IMPLEMENTATION-PLAN.md`; avoid speculative frameworks or a second coordination system.

## Execution contract

- Use Grok CLI as the primary bounded implementation workhorse. Use buddy reviewers or focused subagents in parallel for independent audits and verification; Codex owns integration and conflict resolution.
- Keep changes small and complete. Run the subsystem harnesses, typecheck/build where relevant, and `git diff --check` before each scoped commit.
- Update the matching spec, systems index, implementation plan, reference Markdown/JSON, and shell reference content in the same pass as user-facing or assistant-facing changes.
- Commit and push incremental verified slices to `main` as work progresses. Preserve unrelated user changes.
- Continue autonomously. Stop only for a genuinely critical product decision that cannot be inferred safely from the fixed direction above.
