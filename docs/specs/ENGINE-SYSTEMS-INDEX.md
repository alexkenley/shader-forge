# Shader Forge Systems Index

Date: 2026-08-31

`engine_sessiond` remains a loopback-only control plane: it refuses non-loopback bind hosts such as `0.0.0.0` and `::`, keeps session `rootPath` immutable after creation, and owns the revision-safe text-file operation journal. That journal now records canonical workspace identity (path plus filesystem `dev`/`ino`), validates the full event sequence and coherent applying/undoing effect shapes on load, appends failure/recovery transitions, and finalizes code-trust artifacts before an operation is `applied` or `undone`. All supported mutations, including CLI provenance promote/quarantine and `sf-mcp` spatial attachment changes, go through sessiond's serialized SessionStore mutation lane; artifact files use atomic replacement. Cooperative engine clients are covered; hostile out-of-process filesystem swaps at the OS syscall boundary are not an adversarial security guarantee. Non-spatial MCP mutation stays disabled until each operation family persists resource keys and enforces equivalent leases.

Spatial authoring now has a native schema/query/cook slice, compatible v1 plus strict v2 attachment profiles, strict optional schema-v2 cone-twist limits and diagnostic capsules, a strict optional prefab-only box-collision component in `DataFoundation`, deterministic schema-v2 clip pose sampling, sampled v2 two-bone secondary-hand IK, and exact prefab-bound authored visual-box evidence. Limits/capsules are generation-safe bone snapshot data and cook as deterministic object-or-null fields; prefab collision is typed source snapshot truth independent of render procgeo. Native rest/sample evaluation reports rest-relative cone swing and signed twist without mutating or clamping the pose; `shader_forge_spatial` emits one exact typed aggregate/per-bone `diagnostics.jointLimits` JSON object; sessiond validates it fail-closed against evaluator bones, order, roles, and recomputed truth; Assets shows diagnose-only aggregate and per-bone PASS/FAIL. Unavailable is exact `no_joint_limits_authored`. Clamp policy is rejected. Capsule/item overlap and collision evaluation remain unevaluated. Rest/sample resolve `item_prefab` through the existing `DataFoundation` prefab `[component.render].procgeo` chain and emit eight deterministic world corners only for one valid unambiguous box source; missing, ambiguous, invalid, and non-box paths remain typed unavailable evidence. Sessiond stages exact animation files, all authored `content/**/*.toml`, and the data-foundation manifest, exposes their sorted revision manifest, and fails closed on source drift or symbolic paths. Assets draws the exact twelve-edge visual-box outline and coordinates beside the rest/sampled rig, while labelling it authored render-procgeo evidence rather than a rendered mesh, collision truth, or review evidence. Schema-v1 two-hand sampled output remains explicitly pre-IK; v2 exposes physical reach plus separate contact/angular tolerance truth. Semantic operations and lease-gated `sf-mcp` preview/review/apply/undo remain the only mutation path. Capsule/item clipping, collision evaluation, sampled MCP evidence, cameras/capture, immutable review packets, generic bake/runtime consumption, and typed MCP spatial review resources remain deferred; see [ENGINE-SPATIAL-AUTHORING-SPEC.md](/mnt/s/Development/AI-Game-Engine/docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md).

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
