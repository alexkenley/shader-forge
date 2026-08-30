# Shader Forge MCP Spec

Status: first read-and-coordinate slice

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

The first version is intentionally read-and-coordinate only.

It does not expose:

- file, scene, entity, asset, or code mutations
- build, cook, package, or runtime mutation
- shell, PTY, or arbitrary command execution
- an HTTP MCP endpoint
- built-in model execution, assistant chat, prompts, or provider selection

Write and exclusive-operation tools land only after the engine has shared contracts for preview, revision preconditions, structured diffs, atomic application, approval policy, provenance, validation, conflict handling, and recovery. A lease grants coordination ownership; it is not authority to bypass those contracts.

## Verification

The deterministic MCP harness must:

- start a temporary `engine_sessiond`
- attach `sf-mcp` to a real temporary session
- complete MCP initialization over stdio
- enumerate and call the documented resources and tools
- verify file reads stay inside the session root
- verify coordinator registration, lease use, and disconnect cleanup
- verify stdout contains protocol messages only
- shut down all child processes cleanly

Run it with `npm run test:mcp`.

## Next Widening Gate

The next MCP slice should add mutation or build/runtime tools only when the corresponding engine-owned preview, revision, atomicity, approval, and rollback contracts are implemented and shared by shell, CLI, and MCP. HTTP transport remains deferred until a real remote-client requirement justifies its additional authentication and lifecycle surface.
