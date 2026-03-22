# Physics Borrow Guide

Date: 2026-03-22

## Purpose

Capture the best references for Shader Forge's physics backend, tooling integration, and authored collision workflow.

## Recommended Reference Set

### 1. Jolt Physics

Repository:
- `https://github.com/jrouwe/JoltPhysics`

Reference docs:
- `https://github.com/jrouwe/JoltPhysics`

Borrow:
- backend rigid body and collision runtime
- scene query APIs
- debug recorder and sample-driven learning path

### 2. Godot Physics And Godot Jolt

Repositories:
- `https://github.com/godotengine/godot`
- `https://github.com/godot-jolt/godot-jolt`

Reference docs:
- `https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html`
- `https://github.com/godot-jolt/godot-jolt`

Borrow:
- collision-object ergonomics
- gameplay-facing body categories
- examples of integrating Jolt into a general-purpose engine workflow

### 3. O3DE PhysX

Repository:
- `https://github.com/o3de/o3de`

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/interactivity/physics/nvidia-physx/`
- `https://www.docs.o3de.org/docs/user-guide/interactivity/physics/nvidia-physx/configuring/`
- `https://www.docs.o3de.org/docs/user-guide/gems/reference/physics/nvidia/physx-debug/`

Borrow:
- collision layer and material tooling expectations
- debug visualization surfaces
- animation/ragdoll handoff patterns

## Recommended Shader Forge Direction

- use Jolt Physics as the likely first backend direction
- keep an engine-owned physics API above it
- borrow editor and debug expectations from O3DE
- borrow body/category ergonomics from Godot rather than copying either engine's object model

## Explicit Non-Goals

- adopting a giant engine-wide PhysX-oriented architecture
- postponing physics structure until late gameplay integration
