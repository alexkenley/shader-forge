# Animation Borrow Guide

Date: 2026-03-22

## Purpose

Investigate a code-first in-engine animation direction for Shader Forge so users and the coding assistant can author animation logic natively inside the engine instead of depending on Blender for core iteration.

This guide is focused on the animation system itself, not on DCC modeling or mesh rigging workflows.

## What Shader Forge Needs

Shader Forge does not just need animation playback. It needs:

- skeletal animation playback
- blend graphs and state machines
- animation events
- root motion support
- additive and layered blending
- procedural corrections such as look-at or IK
- text-backed or code-authored animation graph assets
- runtime APIs that the coding assistant can inspect and edit
- native and CLI-friendly workflows so Blender is optional at most

## Recommended Reference Set

### 1. ozz-animation

Repository:
- `https://github.com/guillaumeblanc/ozz-animation`

Why it matters:
- focused low-level C++ skeletal animation runtime
- strong runtime sampling, blending, additive, partial blending, and IK examples
- engine-agnostic and renderer-agnostic

Reference docs:
- `https://guillaumeblanc.github.io/ozz-animation/documentation/`
- `https://guillaumeblanc.github.io/ozz-animation/samples/look_at/`

Borrow:
- runtime skeleton, sampling, and blend foundation
- IK and procedural correction patterns
- compact C++ implementation ideas that fit Shader Forge better than a giant editor stack

Do not expect from it:
- a complete high-level blend-tree editor
- a full in-engine authoring workflow on its own

### 2. Fyrox

Repository:
- `https://github.com/FyroxEngine/Fyrox`

Why it matters:
- practical engine-integrated animation blending state machines
- lighter and easier to reason about than heavier editor stacks
- useful reference for code-facing animation graph ownership

Reference docs:
- `https://fyrox-book.github.io/animation/animation.html`
- `https://fyrox-book.github.io/animation/blending.html`
- `https://fyrox-book.github.io/animation/absm_editor.html`

Borrow:
- animation state machine structure
- engine-facing authoring/runtime split
- practical feature boundaries for a medium-sized engine

### 3. Godot

Repository:
- `https://github.com/godotengine/godot`

Why it matters:
- strong property-track animation model
- mature `AnimationPlayer` and `AnimationTree` authoring concepts
- clear examples of controlling complex graphs from code

Reference docs:
- `https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html`
- `https://docs.godotengine.org/en/3.3/tutorials/animation/animation_tree.html`

Borrow:
- track-based animation of arbitrary engine properties
- blend-tree and state-machine authoring concepts
- event and method tracks
- strong code-control model over authored graphs

### 4. O3DE EMotionFX

Repository:
- `https://github.com/o3de/o3de`

Why it matters:
- very full-featured animation authoring and runtime feature checklist
- motion sets, animation graphs, blend spaces, sync tracking, events, mirroring, and retargeting

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/gems/reference/animation/emotionfx/`

Borrow:
- long-term feature target list
- graph and event concepts
- retargeting and mirroring expectations

Do not borrow as-is:
- the full editor/runtime complexity
- asset and graph formats that would drag Shader Forge into a heavyweight stack too early

### 5. Stride

Repository:
- `https://github.com/stride3d/stride`

Why it matters:
- useful reference for a game-engine-facing animation component and runtime blending model
- practical code integration patterns

Reference docs:
- `https://doc.stride3d.net/4.1/en/manual/animation/animation-properties.html`

Borrow:
- runtime component shape
- blend and playback control expectations

## Recommended Shader Forge Direction

Best fit for Shader Forge:

- use a low-level C++ runtime foundation shaped like `ozz-animation`
- build a Shader Forge-owned text-backed animation asset layer above that runtime
- borrow the high-level authoring model primarily from Fyrox and Godot
- use O3DE EMotionFX as a checklist for later features, not as the implementation base

In other words:

- `ozz-animation` is the best backend-style reference
- Fyrox is the best engine-sized animation-system reference
- Godot is the best authoring/control reference
- O3DE is the best heavy-duty feature reference

## Code-First Authoring Direction

To reduce Blender dependence, Shader Forge should support:

- `.anim.toml` clips or clip metadata
- `.animgraph.toml` state machines and blend graphs
- animation-event definitions that trigger gameplay or audio hooks
- code-defined graph patches or generated graph assets for repetitive setup
- procedural layers for look-at, aim, IK, and other runtime corrections

This keeps authored animation behavior visible to both humans and the coding assistant.

Blender should be an optional import path, not the required place to make every change.

## First Useful Slice

The first useful in-engine animation slice should include:

- skeleton and clip playback
- one blend graph asset format
- one state-machine asset format
- animation events
- root motion extraction
- code control of graph parameters
- one procedural correction layer such as look-at or simple IK

That would already move a lot of iteration out of Blender and back into Shader Forge.

## Explicit Non-Goals

- replacing Blender for mesh creation or full rig authoring in the first pass
- building a giant node editor before basic playback, blending, and event flow work
- forcing all animation behavior into opaque binary graph assets
