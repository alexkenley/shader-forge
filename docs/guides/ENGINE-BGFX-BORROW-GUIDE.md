# bgfx Borrow Guide

Date: 2026-03-22

## Purpose

Use bgfx selectively for tooling ergonomics, rendering examples, and small diagnostic harness ideas. It is not a fit for Shader Forge's core renderer direction.

Repository:
- `https://github.com/bkaradzic/bgfx`

Primary phases:
- Phase 3
- Phase 5

## Borrow Targets

### Tooling And Diagnostics

Look for:
- shader build tooling
- compact rendering samples
- platform bring-up and diagnostics examples

Borrow:
- small-surface harness ideas for graphics bring-up
- shader tool ergonomics
- disciplined example coverage for renderer validation

Adapt for Shader Forge:
- keep Vulkan-first and SDL3-first
- use only for tooling and validation ideas, not renderer architecture

Do not borrow as-is:
- the backend abstraction layer as Shader Forge's renderer baseline
- API-neutral design choices that weaken explicit Vulkan ownership
