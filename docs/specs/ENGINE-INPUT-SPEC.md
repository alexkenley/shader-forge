# Engine Input Spec

## Purpose

The input system owns raw device intake, action mapping, rebinding, player input contexts, and the bridge between physical inputs and gameplay/editor commands.

It exists so Shader Forge can expose a stable, text-backed, assistant-editable input model instead of scattering device handling logic across runtime code.

## Core Principles

- SDL3 should remain the raw device backend
- gameplay and tool code should target actions and axes, not raw scancodes and device IDs
- action maps and bindings must be editable through text assets, CLI flows, and future tool surfaces
- keyboard, mouse, gamepad, and touch should converge on a common engine-facing action model
- input should support both runtime gameplay and editor/tool workflows without duplicating the full stack

## Authoring Model

Recommended first artifacts:

- `input/actions.toml`
- `input/contexts/<name>.input.toml`

Authoring rules:

- input actions, axes, deadzones, and bindings live in text assets
- gameplay code queries named actions and axes
- rebinding should update authored or user-override data through explicit engine APIs
- tools and AI should be able to inspect and modify bindings without editing source code directly

## Responsibilities

- raw keyboard, mouse, gamepad, and touch intake
- action and axis mapping
- deadzone and sensitivity handling
- context switching between gameplay, UI, editor, and debug modes
- local-player routing where needed
- device hot-plug handling
- runtime rebinding and user overrides
- deterministic action-state queries for gameplay and tools

## Initial Scope

- SDL3-backed device intake
- text-backed action and context definitions
- gameplay and UI action routing
- keyboard, mouse, and gamepad support
- runtime rebinding for desktop workflows
- shell and future native-tool inspection surfaces

## Current First Slice

The current first slice in the repo now includes:

- text-backed `input/actions.toml` and `input/contexts/*.input.toml` assets
- a native `engine_input` loader and named action query layer inside `engine_runtime`
- SDL3 keyboard, mouse, and gamepad translation into engine-owned button and axis actions
- gameplay and UI contexts loaded at runtime rather than hardcoded raw-event checks in the render loop
- runtime-side consumption of named actions such as `runtime_exit`, `reload_runtime_content`, `save_runtime_state`, `load_runtime_state`, `move_x`, `move_y`, `look_x`, `look_y`, `ui_accept`, and `ui_back`, including the current `F7` authored-content reload lane, the `F8` quick-save lane, the `F9` quick-load lane, and `ui_accept` interaction triggering

## Non-Goals

- shipping every input mode on day one
- tying gameplay logic directly to SDL device details
- making rebinding depend on opaque editor-only assets
