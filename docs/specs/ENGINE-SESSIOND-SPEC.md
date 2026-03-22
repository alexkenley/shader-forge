# Engine Sessiond Spec

## Purpose

`engine_sessiond` is the local backend for shell sessions, PTY terminals, filesystem APIs, git APIs, runtime lifecycle, and shell/runtime coordination.

## Required APIs

- session create/get/update
- file read/write/list
- git status/diff
- PTY open/input/resize/close
- runtime start/stop/restart
- log streaming

