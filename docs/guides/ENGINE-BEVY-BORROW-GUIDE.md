# Bevy Borrow Guide

Date: 2026-03-22

## Purpose

Use Bevy as an architectural reference for app/plugin layering, scheduling, state transitions, and data-oriented subsystem composition.

Repository:
- `https://github.com/bevyengine/bevy`

Primary phases:
- Phase 5.5
- Phase 5.9
- Phase 6

## Borrow Targets

### App, Plugin, And Schedule Boundaries

Look for:
- app and plugin composition
- schedule staging and state transitions
- resource and system ownership patterns

Borrow:
- clean plugin boundaries for optional engine subsystems
- explicit scheduling concepts for non-frame-critical services
- data-oriented resource ownership ideas

Adapt for Shader Forge:
- keep the implementation in C++
- treat Bevy as architecture input, not an API template

Do not borrow as-is:
- Rust-specific ownership patterns
- crate-splitting habits that would over-fragment a still-small codebase

### AI And Service Surfaces

Borrow:
- ways to keep optional services isolated from the frame-critical runtime
- explicit state transitions for service startup, health, and shutdown
