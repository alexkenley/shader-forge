# Shader Forge Systems Index

Date: 2026-08-30

`engine_sessiond` remains a loopback-only control plane: it refuses non-loopback bind hosts such as `0.0.0.0` and `::`, keeps session `rootPath` immutable after creation, and owns the revision-safe text-file operation journal. That journal now records canonical workspace identity (path plus filesystem `dev`/`ino`), validates the full event sequence and coherent applying/undoing effect shapes on load, appends failure/recovery transitions, and finalizes code-trust artifacts before an operation is `applied` or `undone`. All supported mutations, including CLI provenance promote/quarantine and `sf-mcp` spatial attachment changes, go through sessiond's serialized SessionStore mutation lane; artifact files use atomic replacement. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee. Non-spatial MCP mutation stays disabled until each operation family persists resource keys and enforces equivalent leases.

Spatial authoring now has a native schema/query/cook slice plus a deterministic rest-pose attachment evaluator, semantic sessiond operation, strict CLI adapter, an Assets-only constrained primary-grip tuner, and lease-gated `sf-mcp` preview/review/apply/undo tools. The evaluator returns machine-readable bone/socket/hand/item frames and joint-segment endpoints, but `pose.sampled=false`; item geometry, IK, joint-limit, and clipping diagnostics are unavailable, and the result is not review evidence. Every mutating adapter uses the same authored TOML, revisions, operation journal, and hierarchical attachment keys. Generic `engine bake` integration, runtime consumption, sampling, IK, capture/review packets, typed MCP spatial resources, and MCP validation/recapture remain deferred; see [ENGINE-SPATIAL-AUTHORING-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

The shell now consumes the durable operation journal through a global `Activity` bottom-dock tab. It reloads active-workspace list/detail state through sessiond, follows the public operation SSE events, shows public provenance and preview summaries, and supports lease-free approve/reject. It deliberately cannot apply/undo, coordinate, or expose internal before/proposed bytes; exact review diffs and validation/test evidence need an explicit later public contract.

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
