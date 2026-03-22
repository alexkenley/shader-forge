# Code Access Borrow Guide

Date: 2026-03-22

## Purpose

Capture the trust-boundary patterns Shader Forge should study before it allows broader user-authored, addon-authored, or assistant-generated code to compile, load, hot reload, or run through engine-owned pathways.

This is a later-phase guide. It does not block the current SDL3/Vulkan bring-up, but it should land before Shader Forge treats in-engine AI code workflows or plugin execution as routine.

## Why This Matters

Shader Forge is explicitly moving toward:

- assistant-editable engine assets and workflows
- a native in-engine assistant
- reusable tools and skills that can modify projects
- future hot reload and rapid iteration loops

That creates a real trust-boundary problem:

- what code is trusted
- what APIs are allowed
- what happens when assistant-generated code crosses into runtime or editor execution
- how policy violations are surfaced to the user

## Primary Reference Input

### s&box Access Control

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/AccessControl.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/Config/AccessRules.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/Rules/BaseAccess.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/TrustedBinaryStream.cs`

Borrow:
- explicit allowlist and denylist policy model
- trusted artifact tracking
- verification before load
- diagnostics with usable code locations
- a visible unsafe trust path instead of silent bypass

Do not borrow as-is:
- the exact .NET assembly-verification implementation
- the exact whitelist syntax or internal namespace assumptions

## Secondary Reference Input

### s&box Hotload Contracts

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Hotload/InstanceUpgrader.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Hotload.Test/HotloadTests.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Compiling.Test/Tests/FastPathTest.cs`

Borrow:
- hotload should have explicit upgrade contracts
- fast-path reload needs dedicated tests
- policy and upgrade behavior should be observable in harnesses

## Recommended Shader Forge Direction

Shader Forge should not try to clone s&box's .NET verification model directly. The portable ideas are higher level:

### 1. Define Trust Tiers

At minimum:

- `engine_trusted`
- `project_authored`
- `assistant_generated`
- `external_plugin`
- `unsafe_dev_override`

These tiers should affect:

- what can be compiled
- what can be loaded
- what can hot reload
- what engine tools or skills can invoke automatically

### 2. Make Policy Explicit

Shader Forge should have explicit, source-controlled policy data for:

- allowed APIs for supported scripting or plugin surfaces
- blocked operations
- trusted origins
- permitted hotload paths
- assistant-triggered compile or apply permissions

### 3. Treat Assistant Actions As Policy-Bound

The in-engine assistant and terminal assistant should not get a hidden bypass.

- if a tool triggers compile, load, install, or hot reload, it should pass through the same policy layer as human-driven tooling
- dry-run and approval modes should exist for risky actions

### 4. Surface Actionable Diagnostics

When policy rejects a code path, Shader Forge should report:

- what rule was violated
- where it was detected
- what safer alternative or next step exists

### 5. Pair Hot Reload With Verification

If Shader Forge later supports code hot reload:

- verify first
- then reload
- then apply explicit upgrade rules
- then validate with deterministic harness coverage

## First Useful Shader Forge Slice

The first useful implementation does not need OS-level sandboxing or a full secure runtime.

It should do at least this:

- define trust tiers for engine, project, assistant-generated, and external code
- gate assistant-triggered compile and apply workflows behind explicit permission checks
- record artifact origin and trust state in tooling metadata
- block unsupported hotload or code-apply paths with clear diagnostics
- add deterministic harness coverage for accepted and rejected policy cases

## Explicit Non-Goals

- promising perfect security from the first pass
- giving the assistant a hidden superuser path
- treating all project code as equally trusted by default
- adding opaque policy behavior that users cannot inspect
