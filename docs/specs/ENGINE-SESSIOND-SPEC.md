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
- `GET /api/code-trust/summary`
- `POST /api/code-trust/evaluate`
- `GET /api/code-trust/artifacts`
- `POST /api/code-trust/artifacts/transition`
- `GET /api/code-trust/approvals`
- `POST /api/code-trust/approvals/:id/decision`
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
- safe path resolution inside each session root
- UTF-8 file reads
- UTF-8 file writes inside the active session root, with parent-directory creation for authored asset workflows
- directory listing with stable relative paths and timestamps
- JSON HTTP API suitable for local shell integration and harness use
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
- `POST /api/code-trust/artifacts/transition` now supports explicit `promote` and `quarantine` transitions, and those transitions emit SSE updates so shell trust state can refresh without polling hacks
- sessiond now exposes workspace-backed AI provider inspection and smoke-test routes so the shell and harnesses can inspect `ai/providers.toml` without building their own provider clients
- `GET /api/ai/providers` now reports manifest source, default provider, provider readiness, installed Ollama models when reachable, and diagnostics for unimplemented hosted-provider entries
- `POST /api/ai/test` now runs the current first-slice smoke-test path through the shared AI layer, with deterministic fake-provider coverage and optional Ollama-backed requests

## Future AI APIs

- AI request submit/cancel
- AI request/event stream
- queued request metadata and budgeting
- optional secure local key-management hooks
