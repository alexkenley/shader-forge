# Shader Forge MCP Spec

Status: read, coordinate, and lease-gated spatial mutation slice

Date: 2026-08-30

## Purpose

Shader Forge MCP is the external-agent control adapter for Shader Forge. Its short name is `sf-mcp`.

It lets Codex, Grok CLI, and other MCP clients inspect the same project state and participate in the engine-owned multi-agent coordinator without embedding an assistant, model, prompt surface, or provider configuration inside Shader Forge.

## Current Transport And Startup

The first version is a process-scoped stdio MCP server launched independently by each client.

Supported startup inputs:

- `--base-url <url>` selects the local `engine_sessiond` endpoint and defaults to `http://127.0.0.1:41741`
- `--root <path>` resolves or creates the persistent Shader Forge workspace session for that project root
- `--session <id>` attaches to an existing session directly
- `--name <client-name>` identifies the client process in coordination state

Exactly one of `--root` or `--session` selects the workspace. Client configurations should prefer `--root` because it remains stable across restarts, while deterministic harnesses may use `--session`.

Stdout is reserved for MCP protocol messages. Operational diagnostics use stderr. HTTP MCP transport is not part of this slice.

## Process-Scoped Coordination

Each `sf-mcp` process registers one workspace-scoped coordinator agent when it starts.

- the registration credential stays private in process memory
- the credential is never returned through MCP resources or tool results
- the process sends heartbeats while connected
- normal shutdown and input closure disconnect the coordinator agent
- heartbeat expiry and disconnect release held leases and allow queued work to progress
- every client process has its own agent identity, so Codex and Grok do not share one global bridge slot

The coordinator allows concurrent reads and non-overlapping work. Hierarchical conflicts, queued writers, and workspace-exclusive `build` or `runtime` resources are still enforced by `engine_sessiond`.

## Current Resources

### `shaderforge://project`

Returns the selected workspace session plus current Shader Forge and `engine_sessiond` status needed to establish project identity.

### `shaderforge://coordination`

Returns the credential-free coordination view for the selected workspace, including connected agents and active or queued leases.

## Current Tools

Read tools:

- `project_status` reads the selected project/session and backend status
- `project_files_list` lists files or directories inside the session root
- `project_file_read` reads a UTF-8 file inside the session root
- `coordination_state` reads the current workspace coordination view

Coordination tools:

- `work_lease_request` requests a read or write lease for one or more hierarchical resource keys using the process-owned agent identity
- `work_lease_status` reads a lease state
- `work_lease_release` releases a lease owned by the current process agent
- `agent_heartbeat` refreshes the current process agent explicitly; the server also heartbeats automatically

Operation tools:

- `operation_list` returns a bounded recent operation view for the selected workspace
- `operation_read` returns one selected-workspace operation without staged file contents
- `spatial_attachment_preview` validates a full attachment candidate and records a no-write preview under an owned granted write lease
- `operation_approve` and `operation_reject` perform separate review transitions; neither applies file bytes
- `operation_apply` and `operation_undo` accept only spatial attachment operations and require an owned granted write lease covering every persisted resource key

The MCP actor is fixed from the process coordinator registration as `kind: mcp`. Tool callers cannot provide an actor, agent id, or credential. Preview, apply, and undo heartbeat first, verify the process-owned lease view, then send the private credential to `engine_sessiond`, which repeats the authoritative lease, resource, revision, workspace, state, and policy checks.

Operation failures are structured MCP error results. HTTP status, safe code/diagnostic/conflict/lease/operation/approval/code-trust fields, and a refreshed authoritative operation on transition conflicts are retained without exposing request bodies, headers, staged content, or credentials. Conflict recovery is explicit: reread the source and operation, then create a new preview. The adapter never retries or applies automatically.

Tool results are structured, bounded to the selected workspace, and do not expose the coordinator credential.

## Multi-Agent Use

A Codex process and a Grok CLI process can launch separate `sf-mcp` servers against the same `--root`.

- both processes can inspect project state concurrently
- agents can request resource scopes before work begins
- non-overlapping resource leases can be granted together
- overlapping writes are queued rather than executed over each other
- build and runtime exclusivity can be declared without blocking unrelated project inspection
- a crashed or disconnected client does not permanently hold the bridge

This is the engine-native equivalent of the buddy-system orchestrator: agents remain independent, while Shader Forge owns the shared safety boundary.

## Current Safety Boundary

The current mutation boundary is deliberately limited to the implemented semantic spatial attachment operation.

It does not expose:

- generic file, scene, entity, asset, or code mutations
- build, cook, package, or runtime mutation
- shell, PTY, or arbitrary command execution
- an HTTP MCP endpoint
- built-in model execution, assistant chat, prompts, or provider selection

`sf-mcp` never calls `POST /api/files/write`. Its first mutation tools adapt the same spatial preview/review/apply/undo workflow already used by the CLI and Assets tuner. Generic operations have no persisted lease context, so MCP apply/undo rejects them even if the caller supplies a lease id. A lease grants coordination ownership; it is not authority to bypass the operation journal, revision checks, native validation, approval state, or code-trust policy.

## Verification

The deterministic MCP harness must:

- start a temporary `engine_sessiond`
- attach `sf-mcp` to a real temporary session
- complete MCP initialization over stdio
- enumerate and call the documented resources and tools
- verify file reads stay inside the session root
- verify coordinator registration, lease use, and disconnect cleanup
- verify queued, foreign, released, and resource-mismatched lease refusal
- verify no-write spatial preview, MCP actor provenance, explicit approve/apply/undo/reject, and exact restored bytes
- verify selected-session operation boundaries and rejection of generic apply/undo
- verify structured revision and transition conflict recovery without credential leakage
- verify stdout contains protocol messages only
- shut down all child processes cleanly

Run it with `npm run test:mcp`.

## Next Widening Gate

The next MCP widening requires an engine-owned coordinated context for each additional operation family. Do not expose generic file apply/undo while context-free file operations lack persisted resource keys and authoritative lease checks. Scene, asset, build, runtime, validation, and review-packet tools land only after their matching sessiond operations define those keys and policies. HTTP transport remains deferred until a real remote-client requirement justifies its additional authentication and lifecycle surface. `engine_sessiond` remains loopback-only. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee.

## Planned Spatial Authoring Adapter

Spatial authoring is specified in [ENGINE-SPATIAL-AUTHORING-SPEC.md](ENGINE-SPATIAL-AUTHORING-SPEC.md). The first attachment preview/review/apply/undo operation is implemented and now exposed through `sf-mcp`; rendered validation, capture, and immutable review packets remain deferred. `sf-mcp` remains adapter-only.

Planned resources after that gate:

- `shaderforge://spatial/skeleton/{skeletonId}`
- `shaderforge://spatial/attachment/{attachmentId}`
- `shaderforge://spatial/review/{reviewId}`

Implemented tools:

- `spatial_attachment_preview`
- `operation_approve`
- `operation_reject`
- `operation_apply`
- `operation_undo`

Planned after matching sessiond operations exist:

- `spatial_attachment_read` as a typed view beyond the existing project-file read
- `spatial_attachment_validate`
- `spatial_review_read`
- `spatial_review_recapture`

Current mutation tools use coordinator credentials and the hierarchical spatial keys in the spatial-authoring spec. Capture will also hold the shared `scene/prefab/<id>` and `animation/clip/<id>` read keys used by their writers. Unrelated attachment profiles may proceed concurrently; overlapping writes queue. Visual scores never apply, and MCP must not scrape a live camera or cursor to synthesize a `reviewId` packet.

See [SHADER-FORGE-MCP-SETUP.md](../guides/SHADER-FORGE-MCP-SETUP.md) for Codex and Grok CLI registration and verification.
