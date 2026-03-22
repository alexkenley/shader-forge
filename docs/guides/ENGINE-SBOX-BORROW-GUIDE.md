# s&box Borrow Guide

Date: 2026-03-22

## Purpose

Capture the useful parts of the local `sbox-game-engine` repo as bounded reference inputs for Shader Forge.

This is not a proposal to copy the s&box architecture. Shader Forge remains:

- C++23 + CMake
- SDL3-first
- Vulkan-first
- browser-shell-led for workflow
- text-backed for authored assets and assistant-visible engine state

Local reference repo:
- `/mnt/s/Development/sbox-game-engine`

## License And Scope Caution

Useful source patterns exist in this repo, but Shader Forge should stay careful about what is actually borrowed.

- the engine source is MIT-licensed
- some native binaries in `game/bin` are EULA-covered
- third-party components under `game/thirdpartylegalnotices` carry separate licenses

Recommended rule:

- borrow workflow ideas, boundaries, data shapes, and test approaches from the managed/editor/tooling source
- do not treat Source 2-native runtime binaries or repo-specific native integrations as copy targets

## Borrow Tracks

### 1. Assistant-Friendly Scene And Prefab Workflows

Reference files:
- `/mnt/s/Development/sbox-game-engine/docs/coding_assistant_guide.md`
- `/mnt/s/Development/sbox-game-engine/game/templates/game.minimal/Assets/scenes/minimal.scene`

Borrow:
- structured scene and prefab source data that an assistant can read and edit
- explicit engine-to-assistant scene dump ideas
- explicit assistant-to-engine scene injection ideas
- procedural scene authoring through text/code instead of opaque editor state

Adapt for Shader Forge:
- keep Shader Forge scene and prefab source in `.scene.toml` and `.prefab.toml`
- route assistant edits through `engine_sessiond`, the CLI, and future native in-engine assistant tools
- make scene inspection and mutation explicit engine tools, not ad-hoc hidden editor magic

### 2. Tool Registry, Dock Layouts, And Context Keybindings

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Tools/EngineTools.cs`
- `/mnt/s/Development/sbox-game-engine/game/config/editor/layout/Default.json`
- `/mnt/s/Development/sbox-game-engine/game/core/tools/keybindings/shadergraph_editor_key_bindings.txt`

Borrow:
- named engine-tool registry ideas
- serialized default editor layout data
- context-based keybinding files instead of hardcoded global shortcuts

Adapt for Shader Forge:
- use this as a reference for shell panel presets and later native-tool layout persistence
- use tool-context keybinding ideas for input/editor action maps
- keep Shader Forge tools discoverable through the shared AI tool and skill model

### 3. Packaging, Publishing, And Manifest Preflight

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Tools/Utility/ProjectPublisher/ProjectPublisher.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Tools/Assets/Asset.Publishing.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Tools/SboxBuild/Pipelines/Build.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Tools/SboxBuild/Steps/BuildContent.cs`

Borrow:
- preflight manifest submission before upload or release work
- upload-only-what-is-needed manifest flow
- transient per-asset or per-project packaging configuration
- clean split between native build, managed build, content build, and publish steps

Adapt for Shader Forge:
- keep packaging CLI-first
- keep export/package manifests text-backed and source-controlled where safe
- separate cooked-asset production from release-layout generation and publication

### 4. Mounted Filesystems And Batched File Watching

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Filesystem/AggregateFileSystem.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Filesystem/FileWatch.cs`

Borrow:
- aggregate mounted filesystem shape
- batched change dispatch instead of per-event churn
- watcher suppression during bulk operations

Adapt for Shader Forge:
- use mounted roots and package layers for projects, addons, generated outputs, and imported content
- keep file watching deterministic enough for harness coverage
- allow explicit suppression or debouncing during imports, cooking, or assistant-driven batch edits

### 5. Hotload With Upgrade Contracts

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Hotload/InstanceUpgrader.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Hotload.Test/HotloadTests.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Compiling.Test/Tests/FastPathTest.cs`

Borrow:
- the idea of explicit upgrade contracts rather than blind reload
- test-driven hotload expectations
- separate fast-path and full-reload cases

Adapt for Shader Forge:
- do not copy the .NET implementation shape directly into the C++ engine
- use this mainly as a design reference for later code hot reload, shader hot reload, and live editor/runtime handoff safety
- require deterministic hotload harnesses for every supported fast path

### 6. Code Access And Trust Boundaries

Reference files:
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/AccessControl.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/Config/AccessRules.cs`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Access/Rules/BaseAccess.cs`

Borrow:
- explicit allowlist and denylist thinking for user-authored code
- trusted-artifact hashing
- actionable diagnostics when code uses disallowed APIs
- a clear difference between trusted engine code and user or external code

Adapt for Shader Forge:
- see the dedicated [Code Access Borrow Guide](./ENGINE-CODE-ACCESS-BORROW-GUIDE.md)
- treat this as a cross-cutting trust boundary for future scripting, plugins, hotload, and assistant-triggered code flows

### 7. Later Editor Feature Checklist

Reference paths:
- `/mnt/s/Development/sbox-game-engine/game/editor/ActionGraph`
- `/mnt/s/Development/sbox-game-engine/game/editor/ShaderGraph`
- `/mnt/s/Development/sbox-game-engine/game/editor/MovieMaker`
- `/mnt/s/Development/sbox-game-engine/engine/Sandbox.Tools/Animgraph`
- `/mnt/s/Development/sbox-game-engine/game/addons/tools/Code/Editor/VisemeEditor`
- `/mnt/s/Development/sbox-game-engine/game/addons/tools/Code/Widgets/ControlWidgets`

Borrow:
- feature-surface ideas for later graph, timeline, animation, viseme, sound, inspector, and publish tooling
- typed control-widget coverage expectations

Use as:
- a later-phase checklist only

Do not use as:
- a direct object model or tool framework to transplant into Shader Forge

## Recommended Shader Forge Direction

Best use of this repo:

- use it as a strong reference for assistant-friendly scene workflows
- use it as a strong reference for packaging/publish manifests
- use it as a strong reference for later tool registry and layout persistence
- use it as a conceptual reference for code trust boundaries and hotload contracts
- use it as a feature checklist for later editor capabilities

Least useful parts for direct borrowing:

- Source 2-specific runtime assumptions
- repo-specific native binary flows
- the full .NET/editor framework shape

## Explicit Non-Goals

- copying Source 2 runtime architecture into Shader Forge
- adopting s&box package identities, build flow, or tool framework wholesale
- reusing EULA-covered native binaries or repo-specific third-party bundles
