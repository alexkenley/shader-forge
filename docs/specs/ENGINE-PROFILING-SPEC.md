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

## Non-Goals

- inventing a brand-new external profiler when strong open-source tools already exist
- relying on one profiler for every possible diagnostic need
