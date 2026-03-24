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
- runtime status now includes `running`, `paused`, and `stopped` states plus the active session/workspace root when the runtime was started from a shell session
- pause/resume is exposed on hosts where process-signal control is available
- `/health` reports runtime pause/resume capabilities truthfully for the current host

## Future AI APIs

- provider status and health checks
- AI request submit/cancel
- AI request/event stream
- local-model endpoint health probes
- optional secure local key-management hooks
