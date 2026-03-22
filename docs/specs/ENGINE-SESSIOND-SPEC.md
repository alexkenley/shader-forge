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
- `GET /api/files/list`
- `GET /api/files/read`

This gives the shell and harnesses a real backend-owned session and file model before PTY and runtime lifecycle work land.

## Required APIs

- session create/get/update
- file read/write/list
- git status/diff
- PTY open/input/resize/close
- runtime start/stop/restart
- log streaming

## Current Behavior

- in-memory project sessions
- safe path resolution inside each session root
- UTF-8 file reads
- directory listing with stable relative paths and timestamps
- JSON HTTP API suitable for local shell integration and harness use

## Future AI APIs

- provider status and health checks
- AI request submit/cancel
- AI request/event stream
- local-model endpoint health probes
- optional secure local key-management hooks
