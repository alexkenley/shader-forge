# Hell2025 Borrow Plan

Date: 2026-03-22

## Purpose

Capture the specific parts of Hell2025 that are useful to Shader Forge and keep them scoped as references for later implementation work.

This is not a migration plan and not a proposal to adopt Hell2025 as Shader Forge's base. Shader Forge remains:

- Vulkan-first
- SDL3-first
- C++23 + CMake
- browser-shell-led for workflow
- text-backed for authored scene and prefab source data

Reference snapshot:
- `docs/references/hell2025/`

## Borrow Tracks

### 1. Vulkan Runtime Structure

Reference files:
- `docs/references/hell2025/src/API/Vulkan/`
- `docs/references/hell2025/src/Main.cpp`

Borrow:
- separation between device, swapchain, frame, sync, texture, command, and renderer responsibilities
- texture upload and immediate-submit patterns
- practical naming and file-boundary examples for a first renderer scaffold

Adapt for Shader Forge:
- keep Shader Forge naming, repo structure, and coding style
- keep SDL3 as the runtime bootstrap path
- build the runtime under the engine's CMake structure, not a Visual Studio solution

Do not borrow as-is:
- the OpenGL-first program boot path
- the GLFW-based Vulkan bootstrap path
- any assumptions tied to the Hell2025 runtime globals and current object model

### 2. Text-Backed Scene And Prefab Authoring

Reference files:
- `docs/references/hell2025/src/Managers/HouseManager.cpp`
- `docs/references/hell2025/src/File/JSON.cpp`
- `docs/references/hell2025/src/File/JSON.h`
- `docs/references/hell2025/res/houses/TestHouse.house`

Borrow:
- create-info style decomposition of authored objects into serializable payloads
- round-trip save/load behavior for human-editable authored data
- use of explicit type strings and stable field names for editor-facing assets

Adapt for Shader Forge:
- emit `.scene.toml` and `.prefab.toml`, not JSON
- define TOML source schema first, then cook to FlatBuffers
- keep scene and prefab files engine-generic rather than game-specific

Do not borrow as-is:
- Hell2025 field naming mistakes and inconsistent spelling
- game-specific object taxonomies

### 3. Native Editor Save/Reload Workflow

Reference files:
- `docs/references/hell2025/src/Editor/Editor.cpp`

Borrow:
- explicit open, close, save, and reload flow
- edit-mode state management
- clear relationship between editor actions and reloading world state

Adapt for Shader Forge:
- native tools UI should use Dear ImGui with docking
- browser shell remains the primary workspace host
- editor actions should integrate with `engine_sessiond`, the runtime lifecycle, and text-backed asset files

Do not borrow as-is:
- hardcoded project content like `Shit` and `TestHouse`
- game-specific editor modes and assumptions

### 4. Shader Source Handling

Reference files:
- `docs/references/hell2025/src/API/OpenGL/Types/GL_shader.cpp`

Borrow:
- shader include expansion
- line-to-origin mapping for compile errors
- protection against duplicate `#version` handling in included files

Adapt for Shader Forge:
- apply the idea to the Vulkan shader toolchain
- integrate with shader cooking, diagnostics, and hot reload

Do not borrow as-is:
- OpenGL-specific compile path
- RenderDoc-specific define injection exactly as implemented there

### 5. Anti-References

Useful mainly as examples of what Shader Forge should not adopt directly:

- `docs/references/hell2025/src/Managers/MapManager.cpp`
  - Hell2025 stores maps as a custom binary blob with appended JSON
  - Shader Forge source assets should remain human-editable text, with binary outputs reserved for cooked data
- the original Visual Studio project and copied-DLL workflow
  - Shader Forge should keep CMake, explicit dependency management, and cross-platform build intent
- vendored middleware and bundled game assets
  - reuse only after separate license review

## Recommended Integration Order

### First borrow pass

Use when Phase 3 becomes active:

- mirror the Vulkan manager split as a Shader Forge runtime scaffold
- lift only ideas and selected helper logic, not file-for-file naming
- add a deterministic runtime bring-up harness beside the first window path

### Second borrow pass

Use when Phase 5.5 and Phase 5.75 become active:

- define a Shader Forge create-info style TOML schema for scenes and prefabs
- implement save/load round-trip tests for authored assets
- model native editor save/reload behavior on the Hell2025 workflow, but wire it to Shader Forge runtime control and shell surfaces

### Third borrow pass

Use when shader cooking and hot reload are active:

- port the shader include and source-line mapping ideas into the Vulkan shader toolchain

## Explicit Non-Goals

- do not import Hell2025 as a subtree or runtime base
- do not adopt OpenGL as the engine baseline
- do not pull in `vendor/`
- do not copy gameplay assets, audio, models, or animations into Shader Forge baseline work
- do not adopt the `.map` source format for authored engine assets
