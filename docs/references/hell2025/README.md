# Hell2025 Reference Snapshot

Purpose:
- preserve a small, local reference slice of `livinamuk/Hell2025` that maps to Shader Forge planning work
- keep future borrowing focused on architecture and workflow patterns rather than wholesale import

Status:
- reference-only
- not part of the build
- not a source of truth for Shader Forge

Important boundaries:
- repo-owned Hell2025 code is being treated as borrowable based on the user's direct permission from the author
- bundled third-party dependencies, middleware, SDKs, and any externally sourced assets still keep their own licenses and must be reviewed separately before reuse
- this snapshot intentionally excludes `vendor/`, bulk game assets, and project-specific runtime content outside a single house example

Included reference areas:
- `src/API/Vulkan/`
  - manager split, renderer scaffolding, Vulkan utility code, upload path
- `src/Main.cpp`
  - runtime boot sequence reference
- `src/Managers/MapManager.cpp`
  - custom map persistence reference, mainly as a format to avoid for Shader Forge source assets
- `src/Managers/HouseManager.cpp`
  - text-backed authored asset save/load reference
- `src/File/JSON.cpp`
- `src/File/JSON.h`
  - create-info serialization reference
- `src/Editor/Editor.cpp`
  - native editor open/save/reload/update workflow reference
- `src/API/OpenGL/Types/GL_shader.cpp`
  - shader include expansion and line-map error reporting reference
- `res/houses/TestHouse.house`
  - example human-editable authored asset
- `README.upstream.md`
  - upstream repo context snapshot

Primary Shader Forge uses:
- Phase 3 native Vulkan runtime structure
- Phase 5.5 data and effects plumbing
- Phase 5.75 text-backed level authoring and native editor workflow
- later shader compilation and hot-reload support
