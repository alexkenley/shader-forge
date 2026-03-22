# Input Borrow Guide

Date: 2026-03-22

## Purpose

Capture the best references for Shader Forge's raw-input backend, action mapping layer, and runtime/editor input workflow.

## Recommended Reference Set

### 1. SDL3

Repository:
- `https://github.com/libsdl-org/SDL`

Reference docs:
- `https://wiki.libsdl.org/SDL3/SDL_GetKeyboards`
- `https://wiki.libsdl.org/SDL3/SDL_GetMice`
- `https://wiki.libsdl.org/SDL3/SDL_GetGamepads`
- `https://wiki.libsdl.org/SDL3/SDL_GetGamepadMappings`

Borrow:
- raw device discovery
- hot-plug handling
- keyboard, mouse, and gamepad backend plumbing

### 2. Godot

Repository:
- `https://github.com/godotengine/godot`

Reference docs:
- `https://docs.godotengine.org/en/stable/classes/class_inputmap.html`

Borrow:
- action-map model
- code and editor parity for bindings
- deadzone and event-binding concepts

### 3. O3DE

Repository:
- `https://github.com/o3de/o3de`

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/interactivity/input/`
- `https://www.docs.o3de.org/docs/user-guide/components/reference/gameplay/input/`

Borrow:
- `.inputbindings` style data-driven binding assets
- local-player routing ideas
- input component and event ownership patterns

## Recommended Shader Forge Direction

- keep SDL3 as the raw backend
- build an engine-owned text-backed action and context layer above it
- borrow the action-map ergonomics mostly from Godot
- borrow binding-asset and local-player ideas from O3DE

## Explicit Non-Goals

- exposing SDL-only device details to gameplay code
- shipping only raw keycode bindings with no action abstraction
