# Profiling Borrow Guide

Date: 2026-03-22

## Purpose

Capture the best references for Shader Forge's profiling, diagnostics, and GPU-debug workflows.

## Recommended Reference Set

### 1. Tracy

Repository:
- `https://github.com/wolfpld/tracy`

Reference docs:
- `https://github.com/wolfpld/tracy`

Borrow:
- CPU and GPU instrumentation direction
- memory and lock diagnostics
- lightweight everyday profiling workflow

### 2. RenderDoc

Repository:
- `https://github.com/baldurk/renderdoc`

Reference docs:
- `https://github.com/baldurk/renderdoc`
- `https://github.com/baldurk/renderdoc/wiki/Vulkan`

Borrow:
- Vulkan frame-capture workflow
- GPU debug expectations and capture ergonomics

### 3. O3DE

Repository:
- `https://github.com/o3de/o3de`

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/profiling/cpu_profiling/`

Borrow:
- in-engine profiler UI expectations
- capture saving and visualization surfaces
- integration between runtime profiling and native ImGui tools

## Recommended Shader Forge Direction

- Tracy for live CPU/GPU/memory instrumentation
- RenderDoc for Vulkan graphics capture
- native tooling UI for lightweight live metrics and capture controls

## Explicit Non-Goals

- inventing a proprietary standalone profiler before the engine can integrate existing tools
- relying only on offline capture with no in-engine live diagnostics
