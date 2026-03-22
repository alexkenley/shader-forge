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
- persistent scene authoring surfaces
- viewer tabs for code and runtime-facing workflows

It is not the engine runtime.

## Framework Decision

The shell framework target is:

- React
- TypeScript
- Vite

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
- Windows clean-start path through a PowerShell launcher that delegates into WSL
- backend-owned sessions once `engine_sessiond` exists
- text and code as the source of truth
- `Scene` workflows should edit persistent text-backed scene and prefab assets rather than opaque editor state

## Implemented Shell Bridge

Current implemented bridge surfaces:

- `engine_sessiond` health status in the shell header
- session create/list state in the `Sessions` rail
- file list/read preview in the `Explorer` rail

The preserved Monaco workspace is still hosted through the compatibility bridge under `web/`.

## Preservation Rule

The preserved code-editor implementation under `shell/engine-shell/web/` is the compatibility baseline.

Phase 1 should:

- keep the preserved Monaco/editor behavior intact
- keep the inline file-search behavior intact
- build the new shell frame around it

Phase 1 should not start by rewriting the editor internals.

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

The shell should not be reused as the native tooling UI layer or the shipped in-game UI framework.
