# Engine Profiling Spec

## Purpose

The profiling and diagnostics system owns CPU, GPU, frame, memory, and runtime diagnostic capture surfaces for Shader Forge.

It exists so performance work becomes a first-class engine workflow rather than a late manual scramble.

## Core Principles

- live profiling must be available inside the engine workflow
- deep external capture tools should integrate cleanly with Shader Forge
- profiling should cover CPU, GPU, frame timing, memory, and resource lifetime where possible
- instrumentation must be lightweight enough for everyday engine work

## Responsibilities

- CPU frame profiling
- GPU timing and markers
- memory and allocation tracking
- lock/contention inspection where supported
- capture export and archival
- runtime debug overlays and diagnostics views

## Implementation Direction

Recommended first stack:

- Tracy for runtime CPU/GPU/memory instrumentation
- RenderDoc for Vulkan frame capture and graphics debugging
- native tooling UI for live lightweight inspection

## Current Implemented Slice

The first Phase 6.3 checkpoint is now real:

- `engine profile live` now emits a diagnostics snapshot for a workspace, and it can switch to a live `engine_sessiond` snapshot when pointed at a running backend session
- `engine profile list` now exposes persisted diagnostics-capture history for either a workspace or a live `engine_sessiond` session
- `engine profile capture` now writes a shareable JSON report under `build/profiling/captures/`
- the current snapshot records runtime/build state, recent runtime/build log tails when sessiond is present, git summary, code-trust counts, AI-provider readiness, packaging readiness, stored-capture history, and manual next-step recommendations
- `engine_sessiond` now exposes `GET /api/profile/live`, `GET /api/profile/captures`, and `POST /api/profile/capture`
- the shell `Workspace` tab now exposes the same live snapshot, recent-capture history, and capture-report actions
- deterministic harness coverage now exists for the profiling/diagnostics scaffold

## Current Boundary

This slice is diagnostics-first rather than deep profiler integration. Tracy, RenderDoc capture launch, memory/allocation tracking, GPU markers, and native Dear ImGui profiling panels are still ahead.

## Non-Goals

- inventing a brand-new external profiler when strong open-source tools already exist
- relying on one profiler for every possible diagnostic need
