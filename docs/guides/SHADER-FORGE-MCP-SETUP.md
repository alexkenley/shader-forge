# Shader Forge MCP Setup

Shader Forge MCP (`sf-mcp`) is a local stdio adapter. Each external client launches its own process, so Codex, Grok CLI, and Google Antigravity receive separate coordinator identities and leases.

## Prerequisites

From the Shader Forge repository:

```powershell
npm install
npm run sessiond:start
```

Keep `engine_sessiond` running on `http://127.0.0.1:41741`. Use an absolute repository path in client configuration.

## Codex

Inspect an existing registration:

```powershell
codex mcp get sf-mcp
```

If it is absent, register the stdio server:

```powershell
codex mcp add sf-mcp -- node "<repo-root>\tools\engine-mcp\server.mjs" --base-url http://127.0.0.1:41741 --root "<repo-root>" --name codex
```

`codex mcp list` confirms the saved command. Start a new Codex task or reconnect MCP after changing the server because an existing process may retain its earlier tool list.

## Grok CLI

Register or update the user-scoped server:

```powershell
grok mcp add --scope user sf-mcp -- node "<repo-root>\tools\engine-mcp\server.mjs" --base-url http://127.0.0.1:41741 --root "<repo-root>" --name grok
grok mcp doctor sf-mcp
```

Grok also supports `--scope project`, but do not commit a machine-specific absolute path. Start a new Grok session after changing the MCP server tool surface.

## Google Antigravity

Antigravity supports local stdio MCP servers. Add this workspace-scoped entry to `.agents/mcp_config.json`, replacing `<repo-root>` with the absolute repository path on the machine running Antigravity:

```json
{
  "mcpServers": {
    "sf-mcp": {
      "command": "node",
      "args": [
        "<repo-root>/tools/engine-mcp/server.mjs",
        "--base-url", "http://127.0.0.1:41741",
        "--root", "<repo-root>",
        "--name", "antigravity"
      ]
    }
  }
}
```

Open Antigravity's MCP manager to reload the workspace server and inspect connection logs. Do not commit the expanded machine-specific absolute path.

## Safe Spatial Mutation Flow

1. Read the attachment with `project_file_read` and keep its returned revision.
2. Request a write lease for `spatial/attachment/<profile-id>` with `work_lease_request`.
3. Wait until `work_lease_status` reports `granted`.
4. Call `spatial_attachment_preview` with the full candidate content, base revision, label, and owned lease id.
5. Call lease-free `spatial_attachment_validate` with the operation id and up to 64 exact phase/time samples when sampled evidence is needed.
6. Inspect the bounded validation summary and operation. Call `operation_approve` or `operation_reject` separately.
7. For rendered evidence, call `spatial_review_reserve`, release the attachment write lease, then explicitly request the packet's exact source-read, `spatial/runtime-capture` write, and reserved review-key write leases.
8. Call `spatial_review_recapture` with those three leases, authored phases, canonical cameras, and bounded dimensions. Sessiond releases the three purpose-specific leases after an accepted capture attempt.
9. Read the immutable result with `spatial_review_read` or `shaderforge://spatial/review/<review-id>`.
10. Call `operation_apply` only after approval, reacquiring an owned write lease that covers every operation resource key when the tuning lease was released for capture.
11. Release ordinary leases when work is complete. Undo requires another currently granted covering lease if the prior lease was released.

No tool auto-acquires, auto-approves, retries, applies, or undoes. Recapture's three purpose-specific leases are released by sessiond; other leases remain explicit. A conflict is authoritative: reread current state and create a new preview. Generic file writes, commands, and build/runtime mutation are not exposed through MCP.

## Verification

```powershell
npm run test:mcp
```

The deterministic harness starts an isolated backend and real stdio server, exercises lease-free validation, the lease-gated attachment workflow, explicit review reservation/recapture, tool/resource packet reads, and cleanup plus credential exclusion.
