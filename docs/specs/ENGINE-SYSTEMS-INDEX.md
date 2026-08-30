# Shader Forge Systems Index

Date: 2026-08-31

`engine_sessiond` remains a loopback-only control plane: it refuses non-loopback bind hosts such as `0.0.0.0` and `::`, keeps session `rootPath` immutable after creation, and owns the revision-safe text-file operation journal. That journal now records canonical workspace identity (path plus filesystem `dev`/`ino`), validates the full event sequence and coherent applying/undoing effect shapes on load, appends failure/recovery transitions, and finalizes code-trust artifacts before an operation is `applied` or `undone`. All supported mutations, including CLI provenance promote/quarantine and `sf-mcp` spatial attachment changes, go through sessiond's serialized SessionStore mutation lane; artifact files use atomic replacement. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee. Non-spatial MCP mutation stays disabled until each operation family persists resource keys and enforces equivalent leases.

Spatial authoring now has a native schema/query/cook slice, compatible v1 plus strict v2 attachment profiles, deterministic schema-v2 clip pose sampling, deterministic rest evaluation, and sampled v2 two-bone secondary-hand IK with item-space pole, palm-effector, physical reach, and separate reach/contact/angular tolerance truth. Strict native/`engine` CLI queries, a revision-safe transient rest-only sessiond GET, semantic sessiond operations, a constrained Assets primary-grip tuner with a native-evaluated rest-rig schematic, and lease-gated `sf-mcp` preview/review/apply/undo tools are implemented. Schema-v1 two-hand sampled output remains explicitly pre-IK. GET stages and evaluates exact current authored bytes under the validator-selected attachment ID and schema version, then rechecks revision; it needs no lease and creates no operation or persisted record. Preview returns exact unsolved rest baseline/candidate evaluations with the same ID/schema binding, then rechecks its write lease before journaling. Assets binds authored evidence to session/path/revision and candidate evidence to operation/base/proposed/state, never moves cached geometry on draft edits, fails the entire schematic closed on malformed or oversized reports, and projects resolved v2 poles as green rings. Its Front X/Y, Side Z/Y, and Top X/Z projections remain rest-only and not review evidence. There is no item mesh, sampled solved pose, joint-limit/clipping result, camera, capture, or review packet. Every mutating adapter uses the same authored TOML, revisions, operation journal, and hierarchical attachment keys. Generic `engine bake` integration, runtime consumption, sampled sessiond/shell/MCP evidence, prefab geometry, joint/clipping integration, capture/review packets, typed MCP spatial resources, and MCP validation/recapture remain deferred; see [ENGINE-SPATIAL-AUTHORING-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

The shell now consumes the durable operation journal through a global `Activity` bottom-dock tab. `App` owns one sessiond SSE subscription for both Activity and Assets operation notifications. Activity reloads active-workspace list/detail state, while Assets receives an event epoch and authoritatively refetches its active operation with selection/operation race guards. Approval updates actions. Conflict rereads authored bytes, preserves visibly stale candidate evidence, and retains its captured lease only after successful parse and refreshed resource coverage. Reject/apply/undo clear and reread the appropriate evidence and clean up only the connection captured by that event/action, never a newer one; Undo reacquires explicitly after apply. Activity itself shows public provenance and preview summaries and supports lease-free approve/reject; it deliberately cannot apply/undo, coordinate, or expose internal before/proposed bytes. Exact review diffs and validation/test evidence need an explicit later public contract.

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
