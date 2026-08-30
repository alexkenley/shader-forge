# Shader Forge Systems Index

Date: 2026-08-30

`engine_sessiond` remains a loopback-only control plane: it refuses non-loopback bind hosts such as `0.0.0.0` and `::`, keeps session `rootPath` immutable after creation, and owns the revision-safe text-file operation journal. That journal now records canonical workspace identity (path plus filesystem `dev`/`ino`), validates the full event sequence and coherent applying/undoing effect shapes on load, appends failure/recovery transitions, and finalizes code-trust artifacts before an operation is `applied` or `undone`. All supported mutations, including CLI provenance promote/quarantine, go through sessiond's serialized SessionStore mutation lane; artifact files use atomic replacement. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee. MCP mutation tools stay disabled until they call that same contract.

Spatial authoring now has a native schema/query/cook slice: compatible v1 skeleton loading, strict v2 skeleton/socket validation, v1 attachment-profile validation, generation-safe query handles, isolated fixtures, deterministic validation JSON, and one atomic derived socket/profile payload through `shader_forge_spatial cook`. Generic `engine bake` integration, runtime consumption, sampling, IK, capture, tuning operations, shell UI, and MCP remain deferred; see [ENGINE-SPATIAL-AUTHORING-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

Major system specs:

- [Engine Shell Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SHELL-SPEC.md)
- [Engine Tooling UI Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-TOOLING-UI-SPEC.md)
- [Engine Game UI Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-GAME-UI-SPEC.md)
- [Engine Runtime Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-RUNTIME-SPEC.md)
- [Engine Input Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-INPUT-SPEC.md)
- [Engine Audio Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-AUDIO-SPEC.md)
- [Engine Animation Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-ANIMATION-SPEC.md)
- [Engine Spatial Authoring Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md)
- [Engine Physics Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-PHYSICS-SPEC.md)
- [Engine Renderer Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-RENDERER-SPEC.md)
- [Engine Sessiond Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SESSIOND-SPEC.md)
- [Engine Operations Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-OPERATIONS-SPEC.md)
- [Shader Forge MCP Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-MCP-SPEC.md)
- [Engine CLI Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-CLI-SPEC.md)
- [Engine Save System Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SAVE-SYSTEM-SPEC.md)
- [Engine Packaging Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-PACKAGING-SPEC.md)
- [Engine Profiling Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-PROFILING-SPEC.md)
- [Asset Pipeline Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-ASSET-PIPELINE-SPEC.md)
- [Engine Migration Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-MIGRATION-SPEC.md)
- [Engine VFX Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-VFX-SPEC.md)
- [Engine Data Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-DATA-SPEC.md)
- [Engine AI Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-AI-SPEC.md)
- [Engine Code Trust Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-CODE-TRUST-SPEC.md)
- [Scene System Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SCENE-SPEC.md)
- [Engine Level Editor Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-LEVEL-EDITOR-SPEC.md)
- [Procedural Geometry Spec](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-PROCGEO-SPEC.md)
