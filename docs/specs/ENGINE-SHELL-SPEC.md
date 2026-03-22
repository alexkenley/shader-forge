# Engine Shell Spec

Status: target architecture  
Date: 2026-03-22

## Purpose

The engine shell is the browser-based control surface for Shader Forge.

It is responsible for:

- repo-aware editing
- session management
- file and git browsing
- terminal access
- runtime launch and control
- asset/details/inspector surfaces
- viewer tabs for code and runtime-facing workflows

It is not the engine runtime.

## Primary Layout

Left rail:

- `Sessions`
- `Explorer`
- `Source Control`
- `World`
- `Search`

Center dock:

- `Code`
- `Game`
- `Scene`
- `Preview`

Right panel:

- `Details`
- `Assets`
- `Inspector`
- `Build`
- `Run`
- `Profiler`

Bottom panel:

- `Terminal`
- `Logs`
- `Output`
- `Console`

## Core Behavior

- browser shell in v1
- native runtime window outside the browser
- terminal-first workflow
- backend-owned sessions once `engine_sessiond` exists
- text and code as the source of truth

## Phase 1 Requirement

The shell scaffold must preserve the inline file search control beside `Inspect`.

Required behavior:

- search input in the editor toolbar
- match count
- `Prev`
- `Next`
- `Clear`
- revealed active match
- visible highlight for all matches
- stronger highlight for the active match

## Future Integration Boundary

The shell should eventually talk to:

- `engine_sessiond` for sessions, file APIs, git APIs, PTY, runtime lifecycle, and logs
- `engine_runtime` through structured runtime control and viewer protocols
- `engine_cli` through normal shell terminals and explicit command surfaces

