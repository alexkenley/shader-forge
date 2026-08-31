# Engine Spatial Authoring And Attachment Tuning Spec

Status: native schema/query/cook/rest-schematic evaluation, compatible v1 plus strict v2 attachment profiles, deterministic schema-v2 clip sampling and sampled two-bone secondary-hand IK, authored v2 cone-twist parse/cook plus end-to-end diagnose-only joint-limit and capsule-to-item clipping diagnostics, deterministic depth-tested close/player-camera sample capture, revision-safe operation validation, lease-gated sessiond recapture, atomic immutable review packets and reads, semantic operation, constrained Assets tuner, exact authored rest/sampled Assets schematics, lease-free typed MCP rest/sample reads, thin CLI/MCP review adapters, and packet-referenced Assets review presentation implemented; generic collision and bake/runtime consumption deferred

Date: 2026-08-31

## Purpose

Shader Forge spatial authoring is the engine-owned contract for skeleton sockets, attachment profiles, pose-stable review, and constrained attachment tuning.

It exists so a weapon, tool, or held item has one authored truth that native runtime code, cooked data, the React shell, the CLI, and `sf-mcp` all share. It is the product answer to Unreal's split truth, where Blueprint or editor presentation can drift from native C++ behavior.

This document specifies the complete target contract. The current slice implements compatible skeleton/attachment parsing, deterministic rest/sample evaluation, native v2 two-bone IK, authored v2 cone-twist parse/cook, native rest-relative joint-limit diagnostics, a diagnose-only capsule-axis-to-authored-oriented-box clipping metric, deterministic native close-camera plus strict authored root or parented `player_camera` capture of sampled posed-bone and authored procgeo geometry, fail-closed operation validation, lease-gated sessiond recapture, atomic immutable review packets and capture reads, attachment preview/apply/undo, exact rest/sampled Assets schematics, one session-pinned typed MCP rest/sample read tool, explicit CLI review commands, MCP review tools, the typed MCP review resource, and Assets packet publication/loading/presentation. Sessiond binds animation, authored content TOML, and the foundation manifest into one sorted revision snapshot and fails closed on drift or symbolic sources. Recapture expands selected authored motion-envelope phases, records exact source/capture/review leases, writes only under a same-filesystem temporary review directory, rechecks every revision and lease, atomically publishes a new `rev_` directory, and releases its leases on success or failure. Assets keeps the authored visual box distinct from the authored collision box and diagnostic capsules, labels clipping `CLEAR` or `OVERLAP` rather than reusing joint-limit PASS/FAIL, and shows real packet-referenced PNGs only inside a separate immutable-review panel. Schema-v1 two-hand profiles remain pre-IK. Runtime graph playback, general collision/contact evaluation, generic bake/runtime consumption, and gameplay attachment rendering remain open.

## Authored-Truth Contract

One contract, five owners of distinct jobs:

1. Native engine code owns behavior, typed schemas, validation, runtime pose evaluation, IK, diagnostics, and execution.
2. Source-controlled typed assets own project tuning values. Those assets are the editable truth.
3. Shell, CLI, and `sf-mcp` edit those exact assets only through `engine_sessiond` revision-safe operations. There is no editor-private write path and no MCP-private write path.
4. Preview candidates are transient, visibly labelled, and never the source of truth until apply succeeds.
5. Cooked data is derived, reproducible, and non-editable. Review captures are generated artifacts, not authored assets.

If a value affects how an item sits in a hand, it lives in an attachment profile or a skeleton socket. It does not live in a hidden editor database, a duplicated C++ constant, generated code that humans edit, or a prefab copy of the profile.

## Current Native Schema Slice

`AnimationSystem` now provides:

- unchanged schema-version-1 skeleton loading for the current authored `debug_humanoid` lane
- unchanged schema-version-1 clip loading plus strict schema-version-2 per-bone keyframe tracks for v2 skeletons
- deterministic `sampleClipPose` evaluation at normalized time with linear translation, shortest-path normalized quaternion interpolation, rest-local fallback for untracked bones, stable skeleton order, parent-composed world transforms, and no root-motion accumulation
- strict, section-aware schema-version-2 skeleton parsing with stable dotted IDs, bone hierarchy, semantic roles, sockets, finite vectors, canonical unit quaternions, graph validation, and capability checks
- compatible schema-version-1 plus strict schema-version-2 attachment-profile loading from an `attachments/` directory, including primary grip, contact/handle frames, two-hand target/item-space pole/tolerances, and motion-envelope sample metadata
- cross-reference validation for v2 skeleton IDs, primary sockets, dominant-hand roles, and animation clips on the same skeleton
- UTF-8 validation for every loaded animation source path and file before any new animation generation is committed, plus explicit UTF-8 source-file sort keys so handles and cooked table order do not depend on Windows UTF-16 versus POSIX byte ordering
- generation-tagged `SkeletonId`, `BoneId`, `SocketId`, and `AttachmentProfileId` handles plus snapshot/query APIs; successful reloads invalidate older handles, while failed reloads retain the last valid generation
- strict optional schema-v2 `[bone.<key>.joint_limit]` and `[bone.<key>.diagnostic_capsule]` tables, exposed through the same generation-safe bone snapshots and deterministic cooker; schema v1 rejects both v2-only table shapes
- isolated humanoid, rifle, and pistol fixtures under `animation/fixtures/spatial/`, outside normal authored and cooked roots
- `npm run test:spatial-authoring-scaffold`, which compiles and executes a native C++ validation driver; WSL `g++` is required on Windows
- a dependency-free `shader_forge_spatial validate --animation-root <path>` executable that calls the same `AnimationSystem::loadFromDisk` path and emits deterministic JSON with normalized root, collection counts, stable IDs, schema versions, bone/socket counts, attachment references/mode/perspective, and motion-envelope phase/sample counts
- `shader_forge_spatial cook --animation-root <path> --output-root <path>`, which validates through that same loader and stages exactly one deterministic UTF-8 JSON payload at `<output-root>/animation/spatial-authoring.bin`; it includes complete snapshot-backed bone/socket/profile tables, relative source paths, canonical quaternions, and no generation handles or absolute machine paths
- `shader_forge_spatial evaluate-rest --animation-root <path> --attachment <id> --content-root <path> --data-foundation <path>`, which composes the selected skeleton rest pose, sockets, dominant/item frames, contact/handle frames, secondary target, versioned pole truth, and joint-segment endpoints into deterministic machine-readable geometry; it also emits exact independent `authored_visual_box` and `authored_collision_box` evidence when authored, one exact typed `diagnostics.jointLimits` object, and one exact typed diagnose-only `diagnostics.clipping` object
- `shader_forge_spatial evaluate-sample --animation-root <path> --attachment <id> --phase <phase> --normalized-time <value> --content-root <path> --data-foundation <path>`, which requires an exact authored envelope sample, composes the same geometry from the native clip sampler, applies primary attachment, runs deterministic two-bone secondary-hand IK for v2 two-hand profiles, and carries the same visual, joint-limit, and clipping contracts at the sampled pose; v1 two-hand profiles remain explicitly pre-IK
- `GET /api/spatial/attachment/evaluate` and `/evaluate-sample`, which stage exact current authored animation bytes, every authored `content/**/*.toml` input, and `data/foundation/engine-data-layout.toml` through `SessionStore`; bind the selected source to the validator-selected attachment ID/schema/skeleton/item/mode/perspective contract; bind sample phase/time when present; validate and independently recompute the joint-limit and clipping truth fail-closed; and compare the complete staged revision manifest against the live tree before returning
- sibling temporary-file replacement after a successful close, so invalid input and failed writes do not overwrite an existing final payload
- `engine build spatial`, plus strict `engine spatial validate`, `engine spatial cook`, `engine spatial evaluate-rest`, and `engine spatial evaluate-sample` adapters for running an already-built tool; none auto-builds or starts a daemon, and neither evaluator creates a review artifact
- `npm run test:spatial-tool`, which requires a native compiler, compiles and runs all four commands against isolated valid, invalid-schema, and invalid-UTF-8 fixtures, and checks deterministic validation, byte-stable v1/v2 cooking, representative field completeness, relative paths, sentinel preservation, rest and sampled geometry invariants, motion-envelope and procedural-layer truth, reachable and unreachable IK, separate reach/contact/angular tolerances, pole-side bending, degenerate failure, v1 compatibility, non-commuting transform composition, canonical quaternion sign, non-finite failure, CLI strictness, help, and build-first behavior; WSL `g++` is required on Windows and `g++` elsewhere

`AnimationSystem` retains `item_prefab` as a stable reference and does not take ownership of the prefab catalogue. The spatial evaluator resolves that reference through the existing `DataFoundation` instead of creating a second schema or lookup path. Missing, ambiguous, invalid, or non-box visual geometry produces a typed unavailable reason. Bone joint limits and diagnostic capsules parse as optional schema-v2 skeleton metadata and cook deterministically. Rest and sampled attachment evaluation decomposes each limited bone's local delta from authored rest into cone swing plus signed twist, then reports exact per-bone and aggregate violations without mutating or clamping the pose. `DataFoundation` parses an independent strict optional prefab box-collision component into typed snapshot truth. The evaluator transforms that box and each authored diagnostic capsule into world space for the implemented narrow clipping diagnostic; it does not provide a general collision/contact manifold or runtime collision response.

Both rest and sampled evaluators emit one exact typed `diagnostics.jointLimits` JSON object. Aggregate keys are `status`, `reason`, `policy`, `evaluatedBoneCount`, `violationCount`, `maxViolationDegrees`, `withinLimits`, and `bones`. Each bone entry has `boneId`, `role`, `swingDegrees`, `swingLimitDegrees`, `twistDegrees`, `twistMinDegrees`, `twistMaxDegrees`, `swingViolationDegrees`, `twistViolationDegrees`, and `withinLimits`. Bones appear in evaluator skeleton order and must match evaluator bone IDs and roles. `policy` is always `diagnose`; `clamp_and_diagnose` is rejected. Unavailable is exactly `status="unavailable"` with `reason="no_joint_limits_authored"`, empty `bones`, zero counts, and `withinLimits=null`. Available reports have `reason=null`, boolean `withinLimits`, and a non-empty bone list. Sessiond validates that object fail-closed against evaluator bones, order, roles, and recomputed swing/twist violation truth. Assets shows diagnose-only aggregate and per-bone PASS/FAIL; unavailable surfaces the exact `no_joint_limits_authored` reason.

Both evaluators also emit one exact typed `diagnostics.clipping` object with `policy="diagnose"` and `metric="capsule_axis_to_oriented_box_clearance"`. For each authored diagnostic capsule, the evaluator transforms its center and normalized axis through the evaluated bone frame, derives the world segment endpoints from `halfLengthMeters`, and computes the shortest distance from that axis segment to the independently authored oriented prefab collision box. `surfaceClearanceMeters = axisDistanceToBoxMeters - radiusMeters`; `clearanceViolationMeters = max(0, -surfaceClearanceMeters)`; and `overlapping` is true exactly when the violation is positive. Tangency is therefore `CLEAR`. Aggregate fields are the exact capsule count, overlap count, maximum violation, and `hasOverlap`. This metric supplies numeric proxy intersection depth only: it has no authored acceptance tolerance, does not mutate the pose or item, and is not a contact manifold, gameplay-safety approval, or general collision result.

Unavailable clipping is exact and closed: `status="unavailable"`, one reason from `item_prefab_not_found`, `item_prefab_ambiguous`, `item_prefab_invalid`, `item_collision_not_authored`, or `diagnostic_capsules_not_authored`, zero counts/max, `hasOverlap=null`, `itemBox=null`, and an empty capsule list. Available clipping has `reason=null`, a non-empty skeleton-ordered capsule list, and an `itemBox` of kind `authored_collision_box` with the attachment prefab ID, exact world frame, positive dimensions, and eight recomposable world corners. The visual procgeo box never substitutes for this collision box.

The rest evaluator remains an unsolved schematic geometry query with `pose.sampled=false`. For v2 profiles it resolves the authored item-space pole into world space; v1 pole space remains unresolved. The sampled evaluator reports `pose.sampled=true`, applies primary attachment, and for v2 two-hand profiles applies `secondary_hand_ik` to the semantic upper-arm/lower-arm/hand chain using the secondary palm socket as the effector. Reachable targets align the palm frame to the target. Unreachable targets clamp only the physical wrist solve and report exact reach/contact/angular residual and tolerance truth. Schema-v1 two-hand profiles still report the IK layer unavailable and carry `pre_ik_only`; one-hand profiles carry `sampled_attachment_schematic_only`. Both evaluators expose independent authored visual-box evidence and, when its required inputs exist, authored collision-box/capsule clipping evidence. `shader_forge_spatial` serializes joint and clipping diagnostics; sessiond validates both fail-closed and recomputes clipping geometry rather than trusting derived labels or aggregates. Assets presents joint limits as PASS/FAIL and clipping separately as CLEAR/OVERLAP. Every standalone evaluator result remains non-review evidence. Sessiond exposes both reports transiently with complete revision binding across animation, content, and the data-foundation manifest; `spatial_attachment_read` exposes the same session-pinned rest/sample responses through MCP without a lease or new resource. Operation validation uses the same strict reports in isolated staging, persists only bounded sample counts and controlled failure identity, and is exposed through thin CLI/MCP adapters. Candidate preview evidence remains rest-only. Sessiond recapture combines those reports with real native close/player-camera PNGs in immutable revision- and lease-bound packets; CLI, MCP, and Assets adapt that one packet workflow. Still deferred: general collision/contact evaluation, generic `engine bake` integration, cooked-runtime loading, runtime graph consumption, blending, gameplay attachment rendering, and native overlay tuning.

## Goals

- Give skeleton sockets and attachment profiles a canonical TOML schema with stable IDs and explicit schema versions.
- Keep native engine code as the only runtime interpreter of those assets.
- Let humans and agents inspect the same `reviewId` and the same immutable review packet instead of scraping a live cursor, camera, or viewport.
- Evaluate attachments on a deterministic staging workbench that uses the same transform hierarchy and procedural layers as gameplay runtime.
- Support two-hand weapons with a dominant-hand drive model and off-hand IK follow, plus named motion-envelope phases.
- Constrain human tuning to explicit spaces, single-axis edits, numeric entry, snapping, baseline reset, and axis probes.
- Route preview, validate, approve, apply, recapture, and undo through the existing `engine_sessiond` operation layer.
- Coordinate concurrent agents with hierarchical resource keys so unrelated profiles proceed and overlapping edits queue.
- Keep `sf-mcp` an adapter over engine operations, never a second authoring backend.
- Prove the contract with a deterministic harness that uses a real humanoid bone chain and a two-hand weapon fixture.

## Non-Goals

- Treating the implemented rest/sampled Assets schematics as a completed rendered review workbench, runtime attachment system, or capture workflow.
- Adding a new daemon, sidecar process, or provider-specific capture service.
- Adding a built-in AI assistant, VLM panel, prompt composer, or provider picker to the shell.
- Treating visual-language-model scores, screenshot hashes, or operator taste as apply authority.
- Requiring cross-GPU exact PNG hashes as a pass/fail invariant.
- Replacing the current three-bone `debug_humanoid` metadata asset; v1 compatibility remains required while v2 fixtures prove the new schema.
- Building a general cinematic sequencer, full rig editor, or animation DCC replacement.
- Allowing live gameplay objects to be mutated and then serialized back as authored attachment truth.
- Copying attachment fields into prefabs, Blueprints, generated C++, or editor user-settings files.
- Blocking World/Code/Playtest shell work on this contract. Spatial implementation is ordered after the operation layer and before broad World/Assets visual polish; other non-overlapping work may proceed.

## Ownership

| Concern | Owner | Not the owner |
| --- | --- | --- |
| Schema, validation, pose eval, IK, diagnostics | Native animation/runtime code | Shell, MCP, CLI presentation |
| Anatomical socket frames and bone hierarchy | `animation/skeletons/*.skeleton.toml` | C++ constants, item-specific offsets, generated code |
| Attachment tuning values | `animation/attachments/*.attachment.toml` | Prefab copies, editor DB, runtime objects |
| Item collision calibration | prefab `[component.collision]` | render procgeo inference, attachment profiles, C++ constants |
| Revision, approval, apply, undo, provenance | `engine_sessiond` operations journal | Direct file writes from MCP or ad-hoc scripts |
| Multi-agent leases and queues | `engine_sessiond` coordinator | A global MCP lock or chat orchestrator |
| Human inspection and constrained edits | React shell and native tooling overlay | A built-in assistant |
| External agent access | `sf-mcp` adapter calling the same operations | A Codex/Cursor Saved folder |
| Derived runtime bytes | `engine bake` cooked outputs | Hand-edited files under `build/cooked/` |
| Review packets and captures | Generated `build/spatial-reviews/<review-id>/` | Authored content roots |

`owner_system` for skeleton and attachment assets is `animation_system`. Scene prefabs remain owned by `scene_system` and are referenced by ID only.

The optional prefab collision source contract is:

```toml
[component.collision]
shape = "box"
center = [0.0, 0.0, 0.0]
rotation = [0.0, 0.0, 0.0, 1.0]
dimensions = [0.08, 0.12, 0.9]
```

`shape` is exactly `box`. `center` is a finite item-local vector in meters. `rotation` is a finite unit `xyzw` quaternion within `1e-6` with canonical `w >= 0`. Every `dimensions` component is finite and greater than zero. The section is optional and prefab-only; duplicates, missing or unknown keys, malformed or trailing numeric text, unsupported shapes, non-canonical rotations, non-positive dimensions, and use on another asset kind fail the load. It is never inferred from `[component.render]`.

## Dependencies

Already available foundations:

- The existing `engine_sessiond` revision-safe text-file operation contract. Spatial apply/undo must be another operation kind on that journal, not a second writer.
- The existing hierarchical lease coordinator, including FIFO overlapping-write queues and workspace-scoped `runtime` exclusivity.
- The authored animation root under `animation/` and the current `AnimationSystem` load/validate path, widened rather than replaced.
- The shared code-trust evaluate/review-queue path used by file-write apply.
- The native v1/v2 skeleton and compatible v1/strict v2 attachment-profile parser, validator, generation-safe query handles, isolated fixtures, deterministic sampled two-bone IK, and executable native harnesses.

Implemented capture and review dependencies:

- Sessiond orchestrates native `capture-sample` across every authored sample in the selected phases and every required camera, including authored `player_camera` evidence for `first_person` and `both`. The native path depth-tests posed bone prisms and the authored procgeo item box into clean PNGs; it does not reuse runtime debug-proxy cards.
- Promotion of the isolated humanoid/rifle fixture into a real authored/cooked runtime lane only when runtime graph playback, sampled attachment evaluation, and rendering can consume it; `debug_humanoid` remains the compatible v1 metadata asset.

Numeric capsule-to-authored-box clipping is already implemented for rest and sampled evaluator evidence. It remains diagnose-only proxy geometry and cannot substitute for rendered capture or an immutable review packet.

Required before `sf-mcp` capture and review tools:

- Thin CLI and shell adapters over the implemented sessiond reservation, recapture, manifest-read, and capture-read routes.

Must not wait for:

- Broad World/Assets visual polish, transform gizmos for general scene editing, or a fully skinned character renderer beyond the staging workbench's capture needs.
- HTTP MCP transport, hosted-provider execution, or a built-in assistant.

## Architecture

No new daemon. No built-in assistant. The existing four surfaces stay in their current jobs:

```text
External MCP clients
        |
        | adapter only
        v
     sf-mcp
        |
        | same typed operations
        v
 engine_sessiond
   operations, leases, files, runtime lifecycle
        |
   +----+-----+--------------------+
   |          |                    |
   v          v                    v
React shell  engine CLI      native runtime
(inspect,    (inspect,       (validate, sample,
 constrained  validate,       attach, IK, capture,
 edits)       apply)          diagnostics)
        |
        v
animation/skeletons/*.skeleton.toml
animation/attachments/*.attachment.toml
        |
        v
build/cooked/animation/          (derived, non-editable)
build/spatial-reviews/<id>/      (generated review artifacts)
engine_sessiond operations.json  (preview/apply/undo history)
```

Rules:

- The shell never writes attachment TOML through a private `fetch` that bypasses operations once spatial operations exist. Until then, do not ship a spatial editor that uses raw `/api/files/write` as the product path.
- The CLI never writes those files with ad-hoc filesystem calls.
- `sf-mcp` never wraps `/api/files/write` for attachments.
- Native tooling overlays may manipulate a labelled preview candidate in memory. Persistence happens only by proposing asset bytes to `engine_sessiond`.
- SQLite may index skeletons, sockets, attachments, and reviews. It is not the authored source of truth.

## Coordinate Conventions

All spatial authored assets use the same conventions:

- units: meters and seconds
- handedness: right-handed
- up: `+Y`
- forward: `+Z`
- bone translation: local meters relative to the parent bone
- socket translation: local meters relative to the named bone
- attachment translation: local meters in the profile's declared space
- rotation: unit quaternion stored as `[x, y, z, w]`
- canonical animation quaternion: Euclidean length `1` within `1e-6`; negate `x,y,z,w` when `w < 0`, or when `w == 0` and the first non-zero component of `x,y,z` is negative, before write, compare, or cook; reject non-finite components. The `w == 0` tie-break makes equivalent exact-half-turn `q` and `-q` deterministic. The independent DataFoundation collision schema currently guarantees unit length and `w >= 0` only.
- Euler degrees are a human-tuning input only. They convert to a canonical quaternion on preview and apply. Authored spatial assets do not persist Euler triples.
- target composition is world = parent * local, with translation applied in parent space after parent rotation

The current scene files still persist Euler-like `rotation = "0, 35, 0"` strings, and the current runtime composition adds local translation without rotating it by the parent. Spatial assets do not copy that storage shape. Runtime pose evaluation and the staging workbench must first share the target quaternion composition above; claiming runtime-equivalent capture before that unification is a specification failure. A later general scene migration remains separate work.

## Canonical Skeleton And Socket Assets

Path: `animation/skeletons/<name>.skeleton.toml`

Current schema version 1 remains valid until a migration converts it. Version 1 may keep a comma-separated `bones` list and has no sockets. Spatial authoring requires schema version 2.

Version 2 required fields:

- `schema = "shader_forge.skeleton"`
- `schema_version = 2`
- `id`: stable dotted identifier, independent of file name
- `name`: project-local display name
- `owner_system = "animation_system"`
- `root_bone`: bone id
- `units = "meters"`
- `up = "y"`
- `forward = "z"`
- `handedness = "right"`
- one `[bone.<key>]` table per bone
- zero or more `[socket.<key>]` tables

Each bone table:

- `id`: stable bone id
- `parent`: parent bone id, or empty for the root
- `role`: optional semantic role from the known set below; use `other` only when a meaningful standard role does not apply
- `translation`: local `[x, y, z]` rest translation in meters
- `rotation`: canonical rest quaternion `[x, y, z, w]`
- optional `[bone.<key>.joint_limit]`: `kind = "cone_twist"`, normalized finite local `twist_axis`, `swing_degrees` in `[0, 180]`, and ordered `twist_min_degrees` / `twist_max_degrees` in `[-180, 180]`
- optional `[bone.<key>.diagnostic_capsule]`: finite local `center`, normalized finite local `axis`, and positive finite `radius` / `half_length` in meters; it is diagnostic geometry, not a runtime collision replacement

Both nested tables are schema-v2-only, strict-keyed, and optional per bone. Missing metadata cooks as explicit `null`. A valid bone table whose section key itself ends in `.joint_limit` or `.diagnostic_capsule` remains a bone table; nested metadata is identified by its strict table shape, not suffix alone.

Each socket table:

- `id`: stable socket id
- `bone`: bone id the socket is parented to
- `role`: optional socket semantic role; use `other` for project-specific sockets
- `translation`: local `[x, y, z]` relative to the bone
- `rotation`: canonical quaternion relative to the bone

Known semantic bone roles:

- `hips`, `spine`, `chest`, `neck`, `head`
- `clavicle_l`, `clavicle_r`
- `upper_arm_l`, `upper_arm_r`, `lower_arm_l`, `lower_arm_r`
- `hand_l`, `hand_r`
- `upper_leg_l`, `upper_leg_r`, `lower_leg_l`, `lower_leg_r`
- `foot_l`, `foot_r`
- `other` for twist, finger, face, cloth, weapon, or imported helper bones that do not need a standard capability role

Semantic socket roles:

- `primary_grip`
- `secondary_ik_target`
- `palm_contact`
- `muzzle`
- `holster`
- `utility`
- `other`

Validation rules:

- bone ids and socket ids are unique inside the asset
- the parent graph is a single tree rooted at `root_bone`
- cycles fail
- every socket bone exists
- `debug_humanoid` schema version 1 continues to load as metadata-only and is rejected by attachment profiles that require hands
- bone semantic roles are unique when present; socket roles are unique per parent bone; a capability fails only when a role that it requires is missing
- a two-hand weapon profile requires unique bones with roles `hand_r` and `hand_l`, plus a socket with role `primary_grip`
- contact diagnostics require a `palm_contact` socket on each participating hand bone

Native code loads bones and sockets into typed handles. Gameplay code refers to `SkeletonId`, `BoneId`, and `SocketId`, not raw strings after load.

Sockets are reusable anatomical or rig frames. They must not contain offsets tuned for one weapon or item. Attachment profiles exclusively own item-specific placement. A socket preview must enumerate every referencing attachment profile, acquire read leases for those profiles during validation, and show their resulting transform/diagnostic impact before apply. A socket change that cannot validate all affected profiles fails closed.

## Canonical Attachment Profile Assets

Path: `animation/attachments/<name>.attachment.toml`

Required fields:

- `schema = "shader_forge.attachment_profile"`
- `schema_version = 1` or `2`; v1 remains compatible and pre-IK, while v2 enables explicit pole semantics and sampled IK
- `id`: stable dotted identifier
- `name`
- `owner_system = "animation_system"`
- `skeleton`: skeleton `id`, not a file path
- `item_prefab`: prefab `name` / id, not an inline mesh, not a copied transform
- `dominant_hand`: `right` or `left`
- `mode`: `one_hand` or `two_hand`
- `perspective`: `first_person`, `third_person`, or `both`

`[primary_grip]`:

- `socket`: skeleton socket id with role `primary_grip`
- `space`: `socket` for the first slice; `bone`, `parent`, and `world` are allowed only as tuning spaces, then baked back to socket-local before apply
- `translation`: `[x, y, z]` in meters
- `rotation`: canonical quaternion

Optional `[secondary_hand]` for `mode = "two_hand"`:

- `enabled = true`
- `target.translation` and `target.rotation`: item-local frame the off-hand IK follows after the item is driven by the dominant grip
- `pole.translation`: an authored pole point. Schema version 1 does not declare its coordinate space, so evaluation returns the raw translation with `space = "unresolved"` and no world transform. Schema version 2 requires `pole.space = "item"`; the point is transformed through the primary-driven item frame and no world/skeleton fallback is invented.
- `tolerances.reach_meters`: allowed residual beyond the physical two-bone reach interval
- `tolerances.angle_degrees`: allowed post-solve angular error between the secondary palm socket and target frame
- `tolerances.contact_meters`: allowed post-solve translation error between the secondary palm socket and target frame
- `joint_limit_policy`: `diagnose`
- `diagnose` reports numeric violations without changing the evaluated pose. `clamp_and_diagnose` is reserved for a future deterministic clamp pass and is rejected until that pass exists.

Optional authored diagnostic inputs:

- `[primary_contact]` and `[secondary_hand.target]` define item-local contact frames; contact and angular error are unavailable without the relevant frame
- `[handle_axis]` defines an item-local origin and normalized direction for handle-line diagnostics
- skeleton bone `joint_limit` data owns joint-limit diagnostics; no native fallback constant is allowed
- clipping diagnostics consume authored skeleton `diagnostic_capsule` values and collision geometry from the referenced item prefab; they are unavailable, never silently passing, when those inputs are absent

Optional `[motion_envelope.<phase>]` tables name the fixed poses used for review:

- `clip`: authored clip name on the same skeleton
- `normalized_times`: one or more fixed samples from `0.0` to `1.0` inclusive; a single value is a snapshot, while an envelope requires at least two samples
- `procedural_layers`: list of native layer ids that must run, default `["primary_attachment", "secondary_hand_ik"]` for two-hand profiles

Rules:

- prefabs are referenced by ID only. An attachment profile must not copy mesh, collider, socket, or grip fields out of the prefab.
- a prefab must not copy attachment translation, rotation, tolerances, or envelope times. Prefabs may declare that they are attachable; they do not own the grip.
- one-hand profiles omit `secondary_hand` or set `enabled = false`.
- two-hand profiles fail validation without `secondary_hand.enabled = true`, a target frame, pole, and tolerances.
- schema-v2 two-hand profiles additionally require direct semantic `upper_arm_<side> -> lower_arm_<side> -> hand_<side>` bones for the non-dominant side, a `palm_contact` socket on that hand, and `pole.space = "item"`.
- schema-v1 profiles may not author `pole.space`; their two-hand sampled output remains explicitly pre-IK.
- unknown schema versions fail closed.
- first-person and `both` profiles require a recorded `player_camera` in every complete review packet.

## Typed Native Handles

Native code now exposes generation-tagged, non-string `SkeletonId`, `BoneId`, `SocketId`, and `AttachmentProfileId` handles after validation. Query APIs resolve authored IDs to handles and handles to snapshots. A successful reload advances the generation so stale handles cannot resolve into reordered data; a failed reload retains the last valid generation and snapshots.

The review types in the example below remain target APIs. `SampledClipPoseSnapshot` and `SpatialSampledAttachmentEvaluationSnapshot` are implemented, including deterministic v2 two-bone IK and numeric reach/contact/angular diagnostics. `SpatialAttachmentEvaluationSnapshot` carries the shared geometry payload for rest and sampled wrappers; neither wrapper is review evidence.

```cpp
struct SkeletonId { std::uint64_t generation = 0; std::uint64_t index = 0; };
struct BoneId { std::uint64_t generation = 0; std::uint64_t index = 0; };
struct SocketId { std::uint64_t generation = 0; std::uint64_t index = 0; };
struct AttachmentProfileId { std::uint64_t generation = 0; std::uint64_t index = 0; };
struct ReviewId { std::uint64_t value = 0; };

struct GripFrame {
  AttachmentProfileId profile{};
  SocketId socket{};
  float translation[3]{};
  float rotationXyzw[4]{0.f, 0.f, 0.f, 1.f};
};

class AnimationSystem {
 public:
  std::optional<AttachmentProfileId> findAttachment(std::string_view id) const;
  std::optional<GripFrame> evaluatePrimaryGrip(
      AttachmentProfileId profile,
      const PoseSnapshot& pose) const;
  std::optional<IkTargetSnapshot> evaluateSecondaryHand(
      AttachmentProfileId profile,
      const PoseSnapshot& pose,
      const GripFrame& primary) const;
};
```

After load, gameplay and tooling call handles, not path strings. String ids remain the authored form and the log/display form.

## Validator, Loader, And Cooker

Flow:

1. Read TOML from `animation/skeletons/` and `animation/attachments/`.
2. The implemented native validator checks supported schema versions, strict section/key shapes, stable IDs, the bone tree, required capability roles, vectors, quaternion canonicalization, socket and clip references, contact/handle inputs, attachment modes, tolerances, and envelope sample ranges.
3. The implemented loader assigns generation-tagged query handles and commits a new generation only after the whole load succeeds.
4. The animation loader strictly parses optional schema-v2 joint limits and diagnostic capsules into the existing bone snapshot. It rejects unknown keys, non-finite or non-unit axes, invalid angular ranges, non-positive capsule size, orphan nested tables, and all v2-only nested tables in schema v1.
5. `DataFoundation` strictly parses an optional prefab-only box collision component into `PrefabSourceSnapshot` without inferring from render procgeo. Native rest/sample evaluation transforms that box and authored diagnostic capsules into the exact `capsule_axis_to_oriented_box_clearance` diagnostic. General collision/contact evaluation remains deferred.
6. The implemented explicit cooker serializes complete snapshot-backed skeleton/socket and attachment-profile tables to one deterministic `<output-root>/animation/spatial-authoring.bin` JSON payload, using relative source paths and omitting query handles. Every cooked bone includes `jointLimit` and `diagnosticCapsule` as an object or explicit `null`. A pure-v1 profile set retains cooked schema version 1; any v2 profile produces cooked schema version 2 with explicit `poleSpace`.
7. It writes a sibling temporary file and replaces the final only after validation and a successful close. Generic `engine bake` integration and runtime consumption remain deferred.
8. The implemented rest evaluator composes parent-first rest bone transforms, sockets, attachment/item frames, hand targets, and joint-segment endpoints without running procedural IK. It resolves the attachment's `item_prefab` through `DataFoundation`, emits independent exact visual-box and collision-box world evidence when authored, and computes exact skeleton-ordered capsule clearance results. It also emits one exact typed `diagnostics.jointLimits` object from rest-relative cone swing and signed twist without mutating or clamping the pose. V1 pole input remains unresolved; v2 item-space pole input is resolved. Reports fail closed on non-finite output and use the exact typed unavailable reasons for missing visual, collision, or capsule inputs.
9. The implemented sampled evaluator runs primary attachment and then deterministic two-bone secondary-hand IK for v2 two-hand profiles. It preserves limb lengths and stable skeleton order, aligns the palm socket to the target when reachable, clamps only the physical wrist solve when unreachable, and reports separate reach/contact/angular residuals and tolerances plus the same exact typed joint-limit and clipping objects at the sampled pose. Missing/misparented chains, zero-length limbs, non-finite math, and degenerate pole planes fail closed.
10. Cooked files remain derived outputs rather than edit targets.

SQLite may store index rows for search. Deleting the tooling DB must not delete sockets or attachment tuning.

## Forbidden Patterns

These are specification failures, not style nits:

- hidden editor databases or unpublished binary blobs as the tuning source
- duplicated grip translations, rotations, or tolerances as native C++ literals after a profile exists
- generated C++ or generated TOML that is then hand-edited as source
- mutating a live runtime item/hand transform and then opaque-serializing that object back to disk
- prefabs that copy `primary_grip` or `secondary_hand` fields
- provider-specific capture dumps such as `Saved/Codex/`, `Saved/Cursor/`, `.codex/`, or any assistant cache treated as review storage
- scraping the operator's current camera, cursor, or selection to build a review
- applying a candidate because a VLM score, screenshot similarity, or "looks good" metric passed
- presenting three-bone metadata or proxy-card screenshots as attachment-review evidence

## Review Packets

Humans and agents share one `reviewId` and one immutable review packet. Recapture allocates a new `reviewId`. Existing packets are never mutated in place.

A packet is not a viewport dump. Every camera, target, FOV, light, pose phase, and selection is explicit.

Packet identity:

- `reviewId`: stable `rev_` token generated by `engine_sessiond`
- `schema = "shader_forge.spatial_review_packet"`
- `schemaVersion = 1`
- `immutable = true`

Required packet fields:

- `actor.kind` / `actor.id` / `actor.name` using the existing operation actor shape (`human`, `shell`, `cli`, `mcp`)
- `selection.skeletonId`
- `selection.attachmentId`
- `selection.socketId`
- `selection.itemPrefabId`
- `sourceRevisions.skeleton`
- `sourceRevisions.attachment`
- `sourceRevisions.itemPrefab`
- `sourceRevisions.clip` for each envelope phase used
- `sourceRevisions.playerCameraScene` and `sourceRevisions.playerCameraPrefab` when `player_camera` evidence is required
- `motionEnvelope`: the phase set captured with this packet
- `cameras[]`: each with `id`, `position`, `target`, `up`, `fovDegrees`, `nearMeters`, `farMeters`, `widthPx`, `heightPx`, `posePhase`, `normalizedTime`, and `sampleIndex`; close-camera framing is sample-specific
- `lighting`: key/fill/rim directions and intensities plus exposure, all explicit
- `samples[]`: one entry for every authored phase/time pair in the selected phases, each containing `posePhase`, `normalizedTime`, bone/socket/item/contact/target world transforms and local axes, character/item/combined/contact-region bounds, numeric-or-unavailable diagnostics, the exact sample cameras, and clean capture paths
- `candidateTransform.space`
- `candidateTransform.translation`
- `candidateTransform.rotation`
- `candidateTransform.label` must be `preview-candidate` or `applied-baseline`
- `baselineTransform` with the last applied socket-local grip
- each sample's diagnostics cover primary contact, secondary reach/contact/angular error, handle line, joint limits, and clipping; each result is numeric or explicitly `unavailable` with its missing authored input
- `operationId`: the `op_` operation that owns the candidate
- `leaseIds[]`: every coordinator lease used for the source snapshot, capture slot, and review creation

Optional fields:

- `samples[].captures.annotated` relative paths, stored separately from clean frames
- `visualScores[]` with scorer id, value, and notes. These are advisory. A non-zero or passing score must not change operation state.

Required close cameras, always present:

- `close_front`
- `close_side`
- `close_top`
- `close_three_quarter`

Optional cameras, present only when requested and recorded in the packet:

- `context`
- `player_camera`

Missing required cameras fail packet completeness. `player_camera` is additionally required for profiles whose `perspective` is `first_person` or `both`. Clients must not invent a camera by reading the live editor view.

The authored runtime camera is now a usable source dependency, not capture implementation: a required `player_camera` must resolve from the capture request's exact scene revision to its one valid root or parented `player_camera` prefab and strict `[component.camera]`. The ordinary runtime's legacy 70/0.15/1000 fallback cannot satisfy packet completeness. Recapture must revision-bind that scene and prefab, then stage and render from the true composed world transform/FOV/clips; absence, ambiguity, invalid hierarchy, or drift fails closed. Close cameras remain separate deterministic workbench cameras.

Every close camera must keep the contact region visible, unoccluded, inside frame, and between 50% and 75% of the frame's shorter dimension. A frame outside those bounds is rejected rather than silently reframed by a client.

## Staging Workbench And Captures

The staging workbench is a deterministic, transient native scene. It is not the sandbox play scene and not a user's unsaved World draft.

Workbench rules:

- spawn the referenced skeleton, the referenced item prefab, and the attachment profile by ID
- sample the named clip at every authored `normalized_times` value with fixed delta-time and no root-motion accumulation
- apply primary attachment, then secondary-hand IK, using the same procedural-layer order as gameplay
- parent the item to the dominant-hand grip frame; do not parent the dominant hand to the item
- use the same world-transform composition as runtime scene entities
- label preview candidates in logs, packet fields, and any on-screen overlay as `preview-candidate`
- destroy workbench state when the capture lease ends; do not write workbench entities into `content/scenes/`

Capture output:

```text
build/spatial-reviews/<review-id>/manifest.json
build/spatial-reviews/<review-id>/clean/<phase>/<sample-index>/close_front.png
build/spatial-reviews/<review-id>/clean/<phase>/<sample-index>/close_side.png
build/spatial-reviews/<review-id>/clean/<phase>/<sample-index>/close_top.png
build/spatial-reviews/<review-id>/clean/<phase>/<sample-index>/close_three_quarter.png
build/spatial-reviews/<review-id>/clean/<phase>/<sample-index>/context.png            # optional
build/spatial-reviews/<review-id>/clean/<phase>/<sample-index>/player_camera.png     # required for first-person/both
build/spatial-reviews/<review-id>/annotated/<phase>/<sample-index>/close_front.png   # optional
```

`manifest.json` is the immutable packet. Clean frames contain no debug overlay, no selection highlight, and no score text. Annotated frames may draw axes, tolerances, and diagnostics, and they must live under `annotated/`. A review reader can ignore annotations without losing the evidence set.

The native `capture-sample` command is a renderer primitive, not review publication. Sessiond is the publisher: it reserves the review ID, validates the completed operation and all three lease classes, stages candidate bytes, expands authored phase samples, captures into a temporary sibling directory, rechecks the full source manifest and leases, and atomically renames the directory into place. No caller may write proxy-card PNGs or standalone native frames and call them spatial reviews.

## Pose Evaluation And Two-Hand Model

Fixed sampling:

- clip, skeleton, and `normalized_times` are taken from the named motion-envelope phase
- sampling is deterministic for a given cooked clip revision; no wall-clock, no playing graph, no operator scrubber
- the same native sampler used by gameplay must be used by the workbench

Layer order, required and not reordered by tools:

1. sampled skeletal pose
2. `primary_attachment`: dominant hand socket drives the item transform
3. `secondary_hand_ik`: off-hand effector follows the profile target, using the pole and tolerances
4. diagnostic query against the resulting pose

Two-hand weapon model:

- dominant hand owns the item
- the item does not own the dominant hand
- off-hand follows the item-local secondary target with IK
- if a future operation-scoped validation policy requires reach, joint, contact, or clipping thresholds and they are exceeded, validation fails; the solver does not silently retarget the authored grip to "make it work". The current clipping read itself has no authored acceptance tolerance and reports exact CLEAR/OVERLAP geometry only

Named motion-envelope phase set for the first rifle fixture:

- `idle`
- `aim`
- `sprint`

Additional project phases may be added as `[motion_envelope.<name>]` tables. A review packet names the subset it captured.

Diagnostics, numeric and exact when their authored inputs are present:

- primary contact: translation and angular error between the socket frame and item primary-contact frame
- reach: meters the target lies outside the physical arm interval `[minReachMeters, maxReachMeters]`, compared to `tolerances.reach_meters`
- joint: degrees past each evaluated hinge/ball limit
- contact: post-solve meters between the off-hand palm frame and target contact frame, compared to `tolerances.contact_meters`
- angle: post-solve angular residual between those frames, compared to `tolerances.angle_degrees`
- handle line: distance and angular deviation from the authored item-local handle axis
- clipping: `capsule_axis_to_oriented_box_clearance`, with overlap depth `max(0, radius - shortest capsule-axis-segment distance to the authored oriented item collision box)`

Authored reach/contact/angular thresholds live in the attachment profile; the implemented clipping metric has no acceptance threshold. Joint limits and diagnostic capsules come from the skeleton, palm frames come from skeleton sockets, handle/contact frames come from the profile, and item collision geometry comes from the referenced prefab. Missing inputs produce `unavailable` diagnostics and cannot satisfy a future policy that requires them. None may fall back to C++ literals.

## Constrained Human Tuning

The first human tuner is intentionally narrower than a free 6DOF gizmo.

Allowed:

- spaces: `local`, `parent`, `world` during editing; apply bakes back to socket-local
- a single translation axis or a single rotation axis per edit
- numeric entry in meters or degrees
- snapping: default `0.01` m and `1.0` degree, overridable per session preference, not per hidden asset
- baseline reset to the last applied profile values
- positive and negative axis probes that nudge one snap increment and recapture
- before/after numeric diffs on translation, canonical quaternion, and baked Euler-for-display
- before/after visual diffs using two review packets, never a live camera wiggle

Forbidden in the first tuner:

- simultaneous multi-axis free drag that cannot be reconstructed as a single-axis operation
- silent space conversion that leaves Euler in the file
- applying from an in-view gizmo without an operation preview

Native overlay and shell inspector show the same numbers. If they disagree, the native evaluated candidate is truth and the shell is stale.

## Preview, Validate, Approve, Apply, Recapture, Undo

Spatial mutations are operation kinds on the existing `engine_sessiond` journal. They inherit actor requirements, SHA-256 revisions, HTTP 409 conflicts, durable `applying`/`undoing`, code-trust evaluation, and SSE events from [ENGINE-OPERATIONS-SPEC.md](ENGINE-OPERATIONS-SPEC.md).

Lifecycle:

1. `preview` reads current attachment/skeleton bytes, records `baseRevision`, stores proposed TOML, and returns a labelled candidate plus a numeric diff. It does not write the project file and does not create a review packet by itself.
2. `validate` runs the native validator and, when sampled attachment diagnostics exist, the diagnostic pass on requested envelope phases. Failure stays on the operation as structured field errors. Success does not apply.
3. `recapture` requires a validate pass, read leases for the exact skeleton/socket/profile/prefab/clips, a short exclusive `spatial/runtime-capture` lease, a write lease for the new review key, and an explicit camera set. It records all lease IDs, writes to a temporary review directory, rechecks every recorded source revision while the leases are still held, and only then atomically publishes the new immutable `reviewId` under `build/spatial-reviews/`. A changed revision discards the temporary output and returns 409. Recapture never overwrites an older packet.
4. `approve` is the existing operation approve. Review-packet completeness can be a policy gate, but a VLM score cannot.
5. `apply` writes the proposed TOML through the serialized SessionStore mutation lane and journals code-trust effects exactly as file-write apply does.
6. `undo` restores the previous TOML through the same lane. It does not delete review packets. Packets remain evidence.
7. A stale `baseRevision` returns 409 and marks the operation `conflicted`. The caller previews again from the live file.

Visual scores, annotated overlays, and operator comments never transition an operation to `applied`.

Until spatial operation kinds exist, do not ship a UI that applies attachment edits through generic file write and then backfills a fake review.

## Multi-Agent Resource Keys

Spatial work uses the existing hierarchical coordinator. Keys are lowercase slash-separated segments matching the current `normalizeResourceKey` rules.

Canonical keys:

- `spatial/skeleton/<skeleton-id>`
- `spatial/skeleton/<skeleton-id>/socket/<socket-id>`
- `spatial/attachment/<attachment-id>`
- `spatial/review/<review-id>`
- `spatial/runtime-capture`
- `scene/prefab/<prefab-id>` for the referenced item prefab
- `animation/clip/<clip-id>` for every sampled clip

Concurrency:

- unrelated attachment profiles may hold write leases at the same time
- a skeleton write conflicts with any child socket write and queues FIFO
- an attachment write conflicts with recapture that names that attachment because recapture holds a read lease on the exact attachment key
- prefab and clip writers must use the same `scene/prefab/<id>` and `animation/clip/<id>` keys, so capture read leases conflict with concurrent source edits
- `spatial/runtime-capture` is a short exclusive lease because capture drives the native workbench. Default lease lifetime is the coordinator heartbeat window; capture must release on completion, failure, or disconnect
- `runtime` remains the workspace-exclusive play/build runtime resource. Spatial capture should request `spatial/runtime-capture` and not hold the full `runtime` key unless it actually starts or stops the play process
- later readers cannot starve an earlier queued writer

Review packets are read-mostly after creation. A write lease on `spatial/review/<review-id>` is only for the creating capture. After the packet is immutable, further writes are rejected.

## Engine Surfaces

### `engine_sessiond`

Implemented:

- `GET /api/spatial/attachment/evaluate?sessionId=<id>&path=animation/attachments/<file>.attachment.toml&baseRevision=sha256:<hex>`
- `GET /api/spatial/attachment/evaluate-sample?sessionId=<id>&path=animation/attachments/<file>.attachment.toml&baseRevision=sha256:<hex>&phase=<phase>&normalizedTime=<value>`
- `POST /api/operations/spatial-attachment/preview`
- `POST /api/operations/:id/validate`
- `POST /api/operations/:id/review-reservations`
- `POST /api/operations/:id/recapture`
- `GET /api/spatial/reviews/:reviewId`
- `GET /api/spatial/reviews/:reviewId/captures/:name`
- existing approve/reject/apply/undo, with a live matching write lease recheck on spatial apply/undo

Both GETs accept only an existing attachment path and a non-`missing` SHA-256 base revision. The sampled route also requires a non-empty phase and locale-independent finite normalized time in `[0,1]`; the native envelope remains authoritative for exact phase/time membership. They reject symbolic paths, stage skeletons, `.anim.toml` clips, `.animgraph.toml` graphs, and attachments through strict `SessionStore` reads, require the staged attachment bytes to match the requested revision, validate the staged tree, and evaluate the full profile contract mapped to the selected source. After evaluator work, sessiond re-reads the complete authored animation source set and compares it against the sorted staged revision manifest. Selected attachment drift returns `revision_conflict`; any other added, removed, or changed input returns `spatial_evaluation_inputs_changed`. Responses are `{ evaluation, path, revision, sourceRevisions }`. Neither route needs a lease or creates an operation, journal entry, SSE event, authored/cooked write, or persisted evaluation.

Preview accepts the same attachment path family. Sessiond stages the authored animation tree into a fresh temporary root, rejects links, validates baseline and candidate through `shader_forge_spatial`, maps stable relative source paths to old/new profile IDs/schema versions, evaluates the exact staged baseline and candidate bytes under those expected identities, requires both resource keys on rename, and rechecks the complete source manifest plus granted write lease after evaluation immediately before operation creation. A new-file preview returns `evaluation.baseline: null`. The immediate response contains the transient evaluations, while the durable operation context stores only label, subject ID, resource keys, and preview lease ID; it never stores credentials or evaluation reports. No authored bytes or cooked output change during preview. Both GETs and preview always remove their temporary staging roots.

Operation validation is lease-free and accepts only previewed or approved spatial operations. Its optional `samples` array contains at most 64 exact `{phase, normalizedTime}` objects: unknown/extra keys, duplicate pairs, empty or overlong phases, non-number/non-finite/negative-zero times, and values outside `[0,1]` fail closed. Sessiond verifies the private proposed-content hash and staged base revision, replaces only the staged target with those exact bytes, native-validates, evaluates rest and each requested sample sequentially, rechecks the sorted live manifest, and compare-and-swap records the latest bounded summary by proposed revision and operation `updatedAt`. Native phase membership remains authoritative. Controlled candidate/sample failures record only a stable code/message and completed sample counts; raw stderr, full reports, credentials, staging paths, and proposed bytes are never exposed.

Apply and undo use one semantic dispatcher shared with scene assets. The spatial branch stages current truth inside the existing serialized file-mutation lane, checks the current revision and native identity/resource mapping, substitutes the exact apply/undo bytes in staging, native-validates and rest-evaluates the result, directly rechecks the live manifest without recursively taking the mutation lock, then rechecks the covering lease. Validation failure restores `approved` or `applied` and leaves authored bytes unchanged. Native child processes have a fixed timeout.

Evaluator responses must match the complete public geometry schema and return the attachment ID/schema/skeleton/item/mode/perspective selected by validation. Rest reports must remain `pose.sampled=false`. Sampled reports must bind the requested phase/time and exactly match one-hand, schema-v1 pre-IK, or schema-v2 applied-IK procedural/diagnostic truth. Sessiond strictly recomposes collision-box corners and capsule endpoints, independently recomputes segment-to-oriented-box distance, surface clearance, violation, overlap labels, counts, and maximum, and rejects malformed values, negative zero, ordering/role mismatches, or any derived geometric falsehood. Wrong profile fields, cross-version reports, phase/time drift, contradictory tolerance booleans, or malformed output fail closed. These reports help humans and machines inspect exact authored state, but they are not rendered review evidence and cannot satisfy a later review-packet gate.

Recapture requires a completed validation summary for the exact proposed revision. Sessiond first reserves an operation/session/agent-bound `rev_` ID so the caller can acquire the exact review-key write lease. The recapture request supplies the source-read lease, exclusive `spatial/runtime-capture` write lease, exact review write lease, selected authored phases, canonical camera list, and bounded resolution. Sessiond expands every authored time in those phases, enforces `player_camera` for `first_person`/`both`, validates native metadata and PNG dimensions, writes the full packet under a temporary sibling directory, rechecks the source manifest and all leases in the serialized mutation lane, atomically renames, then releases all three leases. Failure removes temporary output and cannot mutate an older packet. Manifest reads are JSON-only; capture reads serve only packet-referenced PNG paths with immutable caching and symbolic-path rejection.

Review artifacts live in the project under `build/spatial-reviews/` so they are inspectable. Operation history stays in existing `operations.json`. No new daemon and no provider cache directory.

### CLI

Implemented sessiond-backed operation commands:

- `engine spatial preview` reads strict BOM-free UTF-8 candidate bytes from `--content-file` and sends the full semantic preview request
- `engine spatial validate-operation <operation-id> --samples-file <path>` reads a strict BOM-free UTF-8 top-level JSON sample array and calls the lease-free sessiond route without coordinator credentials
- `engine spatial approve|reject <operation-id>` performs the review transition
- `engine spatial apply|undo <operation-id>` requires explicit agent and lease IDs plus `SHADER_FORGE_AGENT_CREDENTIAL`

These commands never write the attachment directly, auto-register an agent, acquire a lease, approve, build, or bypass sessiond. The native local `engine spatial validate|cook|evaluate-rest|evaluate-sample` commands remain separate from the sessiond operation adapter. Both evaluators are read-only; rest/sample require explicit content-root and data-foundation inputs, with project-relative defaults in `engine`. Sessiond invokes them only from isolated transient staging that contains exact animation files, the complete authored content TOML tree, and the foundation manifest. Rest reports have `pose.sampled=false` and never apply IK. Native/CLI/sessiond sample reports have `pose.sampled=true`, explicit procedural-layer truth, and `not_review_evidence`. Both emit exact typed `diagnostics.jointLimits` and `diagnostics.clipping` objects and keep `authored_visual_box` separate from `authored_collision_box`. Sessiond validates joint limits and independently recomputes the clipping metric fail-closed.

Implemented review commands:

- `engine spatial review reserve <operation-id>`
- `engine spatial recapture <operation-id>`
- `engine spatial review read <review-id>`

Reserve and recapture use explicit caller-owned agent and lease IDs; the CLI never acquires or widens authority. Read is lease-free and requires an explicit session.

### Shell

Implemented first surface: the `Assets` workspace lists exact source-owned attachment profiles and provides a constrained primary-grip tuner. Identity, skeleton, socket, and item references are read-only. Numeric translation XYZ is authored in meters; numeric rotation XYZ is displayed in degrees and written back as a canonical quaternion. The source helper accepts only an unambiguous single-line layout and replaces only those two primary-grip value lines, preserving comments, order, unrelated sections, and newline style.

The third pane is a responsive, accessible rig schematic that consumes only sessiond evaluation reports. Authored rest evidence is bound to active session, attachment path, exact source revision, and a validated source manifest. Authored sampled evidence additionally binds exact phase, clip, normalized time, and every staged animation, content, and foundation revision. An independent motion-envelope parser feeds native phase/time selects; arbitrary times and candidate sampling are not exposed. Candidate evidence remains rest-only and is bound to operation id, base revision, proposed revision, and allowed operation state. Draft numeric edits never move cached geometry: they mark that evidence stale until a new native evaluation returns. A conflicted operation remains visible as stale candidate evidence even when its numeric values happen to equal the current draft.

The schematic validates the complete public evaluation shape and bounded payload before rendering. Malformed nested values, non-finite vectors/quaternions/axes/transforms, contradictory IK booleans/numbers, joint-limit or clipping objects that fail evaluator bone/order/role, recomposition, derived-metric, aggregate, sign, or exact zero-boundary checks, unsafe projection bounds, oversized text/arrays, excessive coordinate rows, unknown geometry reasons, non-positive box dimensions, or invalid world corners make the whole schematic unavailable. Front X/Y, Side Z/Y, and Top X/Z projections show evaluator bone segments/origins, sockets, item origin and orientation axes, contact, hands and palms, secondary target, resolved v2 pole, handle direction, the solid gray authored visual-box outline, and independently the dashed amber authored collision box plus diagnostic capsule proxies when available. Exact coordinates and diagnostics remain available outside the SVG. Joint limits use diagnose-only PASS/FAIL; clipping uses a distinct CLEAR/OVERLAP result and per-capsule axis distance, surface clearance, and overlap depth. The UI states that CLEAR is not gameplay-safety approval and OVERLAP is numeric intersection depth rather than a contact manifold. It never invents an item mesh, collision geometry, unresolved v1 pole, or review evidence.

Browsing is read-only and still attempts the lease-free evaluator GET when the constrained TOML editing parser rejects the source layout. Explicit `Begin tuning` registers the fixed shell actor in memory and requests the exact profile write lease. Queued/lost leases disable editing with text explanations. Preview, Approve, and Apply are separate; candidates display `NOT APPLIED`; Reject is available before apply. Apply releases/disconnects. Undo reacquires a fresh covering lease. Source rereads clear the prior authored evaluation before fetching the exact new SHA-256 revision. Preview/apply/undo heartbeat and recheck coordination before mutation. Credentials never enter JSX, storage, logs, or JSON bodies.

`App` retains one sessiond SSE subscription. It converts operation notifications for the active session into a small epoch passed to Assets; the tuner then fetches its active operation authoritatively and rejects selection/operation races. External approval updates available actions. Conflict rereads authoritative bytes while preserving the old candidate as visibly stale evidence; it retains the connection captured for that event only when the refreshed source parses and the captured lease covers the refreshed attachment ID. A failed conflict refresh closes only that captured connection so editing stays fail-closed. Reject, apply, and undo clear candidate evidence, reread source, and release/disconnect only the connection captured by that event or action, never a possibly newer connection. Applied state remains available for explicit Undo, which reacquires a fresh lease; rejected and undone state clear the active operation.

Assets consumes review packets only through sessiond. `Validate + publish review` validates the current previewed/approved operation across every exact authored time in the selected motion-envelope phase, releases the tuning write lock, registers a fresh in-memory shell agent, reserves a new review ID, and requests exact source-read, capture-write, and review-write leases. First-person/both profiles also require explicit authored player-camera scene and prefab IDs. Sessiond performs the capture and publishes the packet; the shell releases/disconnects the temporary capture authority and requires `Begin tuning` again before further mutation.

The same panel can load an existing review ID in the active session. Its bounded parser requires the immutable packet schema, UUID-shaped review ID, selected attachment identity, unique exact phase/time samples, all four close cameras, only the optional `player_camera`, and safe relative PNG paths. Malformed packets, attachment mismatches, and unsafe capture paths fail closed. The panel shows packet and operation IDs, captured sample, camera, and only the packet-referenced PNG. Neither the rest nor sampled schematic below it is promoted to review evidence.

It does not:

- scrape World viewport cameras
- embed an assistant
- treat proxy-card Playtest frames as spatial evidence
- treat numeric source tuning as visual spatial evidence before a published review packet is loaded

### Native tooling overlay

Planned Dear ImGui diagnostics: candidate label, axis-probe readout, reach/joint/contact/clipping numbers, and envelope phase name. The overlay is not the persistence path.

### `sf-mcp`

`sf-mcp` stays an adapter. The implemented attachment validation and preview/review/apply/undo tools call the same sessiond operations already used by the CLI and Assets tuner. Session and actor are process-owned; preview/apply/undo require the process-owned agent id, credential, and a granted write lease, while validation is lease-free and sends no credential. Apply/undo reject non-spatial operations. The implemented `spatial_attachment_read` tool is a separate lease-free, read-only adapter over the same transient sessiond rest/sample GETs.

Implemented review resource:

- `shaderforge://spatial/review/{reviewId}`

Other planned spatial resources:

- `shaderforge://spatial/skeleton/{skeletonId}`
- `shaderforge://spatial/attachment/{attachmentId}`

Implemented tools:

- `spatial_attachment_read`
- `spatial_attachment_preview`
- `spatial_attachment_validate`
- `spatial_review_reserve`
- `spatial_review_read`
- `spatial_review_recapture`
- generic `operation_approve`
- generic `operation_reject`
- spatial-only `operation_apply`
- spatial-only `operation_undo`

`spatial_attachment_read` accepts the strict union `{view:"rest", path, baseRevision}` or `{view:"sample", path, baseRevision, phase, normalizedTime}`. `spatial_attachment_validate` accepts `{operationId, samples?}` with at most 64 exact `{phase,normalizedTime}` objects, verifies the operation belongs to the selected MCP session, and calls the sessiond route without a lease or credential. Neither tool exposes caller-controlled session or credential input. Validation returns only the public operation and bounded summary; it never auto-applies or exposes proposed bytes/raw native stderr. Review reservation is operation/session/agent-bound; recapture requires three explicit process-owned leases and canonical cameras, while read and the review resource use the process-selected session without caller-supplied authority. Mutation tools send the private coordinator credential and hold the resource keys in this spec. They do not wrap `/api/files/write`, auto-acquire, auto-approve, retry, or apply. Structured conflicts direct the caller to reread and create a new preview.

## Storage

Authored, source-controlled:

- `animation/skeletons/*.skeleton.toml`
- future project attachment profiles under `animation/attachments/*.attachment.toml`; the current profiles are isolated harness fixtures under `animation/fixtures/spatial/attachments/`

Derived, reproducible, non-editable:

- `build/cooked/animation/skeletons/`
- `build/cooked/animation/attachments/`

Generated review artifacts, not authored truth:

- `build/spatial-reviews/<review-id>/manifest.json`
- `build/spatial-reviews/<review-id>/clean/`
- `build/spatial-reviews/<review-id>/annotated/`

Existing operation history:

- `engine_sessiond` `operations.json` in the sessiond state directory

Forbidden storage:

- `Saved/Codex/`
- `Saved/Cursor/`
- `.codex/`
- editor user-settings as attachment backups
- cooked files treated as the place to "just tweak the grip"

## Rifle Attachment Example

The following illustrates the full canonical profile contract. The isolated rifle fixture exercises the parser-supported subset; the normal authored `debug_humanoid` remains v1 and cannot satisfy the matching v2 skeleton requirements.

```toml
schema = "shader_forge.attachment_profile"
schema_version = 2
id = "attachment.rifle.two_hand.right_dominant"
name = "rifle_two_hand_right_dominant"
owner_system = "animation_system"
skeleton = "humanoid.standard"
item_prefab = "rifle_standard"
dominant_hand = "right"
mode = "two_hand"
perspective = "both"

[primary_grip]
socket = "socket.right_hand.primary_grip"
space = "socket"
translation = [0.020, 0.000, 0.118]
rotation = [0.000, 0.087, 0.000, 0.996]

[primary_contact]
translation = [0.000, 0.000, 0.000]
rotation = [0.000, 0.000, 0.000, 1.000]

[handle_axis]
origin = [0.000, 0.000, 0.118]
direction = [0.000, 0.000, 1.000]

[secondary_hand]
enabled = true
joint_limit_policy = "diagnose"

[secondary_hand.target]
translation = [0.018, -0.012, 0.265]
rotation = [0.000, 0.000, 0.000, 1.000]

[secondary_hand.pole]
translation = [0.000, 0.080, 0.160]
space = "item"

[secondary_hand.tolerances]
reach_meters = 0.040
angle_degrees = 12.0
contact_meters = 0.012

[motion_envelope.idle]
clip = "rifle_idle"
normalized_times = [0.0, 0.5]
procedural_layers = ["primary_attachment", "secondary_hand_ik"]

[motion_envelope.aim]
clip = "rifle_aim"
normalized_times = [0.0, 0.5]
procedural_layers = ["primary_attachment", "secondary_hand_ik"]

[motion_envelope.sprint]
clip = "rifle_sprint"
normalized_times = [0.20, 0.35, 0.50]
procedural_layers = ["primary_attachment", "secondary_hand_ik"]
```

Matching v2 skeleton socket fragment, represented by the isolated spatial fixture:

```toml
[socket.right_hand.primary_grip]
id = "socket.right_hand.primary_grip"
bone = "bone.hand_r"
role = "primary_grip"
translation = [0.000, 0.000, 0.085]
rotation = [0.000, 0.000, 0.000, 1.000]
```

## Typed Native Access Example

```cpp
const auto profileId = animation.findAttachment("attachment.rifle.two_hand.right_dominant");
if (!profileId) {
  return;
}

const PoseSnapshot pose = animation.sampleNamedPhase(*profileId, "aim");
const auto primary = animation.evaluatePrimaryGrip(*profileId, pose);
if (!primary) {
  return;
}

item.setParentHandGrip(*primary);  // dominant hand drives the item

const auto secondary = animation.evaluateSecondaryHand(*profileId, pose, *primary);
if (secondary) {
  animation.applyOffHandIk(*secondary);  // off hand follows the item target
}

const AttachmentDiagnostics diag = animation.diagnoseAttachment(*profileId, pose);
if (!diag.ok()) {
  // validation failure; do not apply authored bytes
}
```

Gameplay reads the profile through the animation system. It does not keep a parallel `kRifleGripOffset` constant.

## Deterministic Harness

`npm run test:spatial-authoring-scaffold` builds a temporary animation root from the normal v1 assets plus isolated v2 humanoid and weapon-profile fixtures under `animation/fixtures/spatial/`. It compiles and runs a native C++ driver, covers strict joint-limit/capsule parsing, exact rest/sample cone-twist diagnostics, deliberate numeric violation detection, deterministic repeat evaluation, and CRLF fixture copies, and requires WSL `g++` on Windows.

`npm run test:spatial-tool` compiles the production `shader_forge_spatial` source with `AnimationSystem`, runs valid fixtures twice to require byte-stable validation, cook, rest-evaluation, sampled-evaluation, and close-camera capture metadata, checks exact cooked joint-limit/capsule objects and explicit nulls, and proves the capsule-axis-to-oriented-box metric for separated face/edge/corner/rotated cases, exact tangency as CLEAR, and positive overlap depth. It decodes the native PNG zlib payloads with Node stdlib and requires four distinct deterministic depth-tested views with opaque shaded character/item pixels. It rejects invalid input, unsafe/existing output targets, unavailable item geometry, degenerate poses, invalid resolutions, and partial failed-capture output with precise diagnostics, and checks motion-envelope/layer truth plus the CLI help/build-first contract. On Windows it executes the Linux test binary through WSL and does not pretend that binary is a Windows executable.

`npm run test:spatial-operations` starts sessiond with deterministic validator/evaluator injection. It exercises revision-safe rest/sample GETs, complete sampled branch validation, strict clipping shape/recomposition plus independent metric/aggregate recomputation, whole-input revision manifests/drift conflicts, and the transient rest preview contract without requiring a native build.

`npm run test:spatial-shell` executes the pure primary-grip source transformer, v1/v2 schematic validator/projection guards, and operation-reconciliation helpers. It also protects exact evidence binding, the single shared App SSE subscription plus authoritative operation refetch, conflict refresh/resource-coverage decisions, captured-connection-only cleanup, no-lease browsing, operation-only mutation, fail-closed malformed/oversized evaluator handling, unresolved-v1 exclusion, resolved-v2 pole projection, distinct visual/collision proxies, CLEAR/OVERLAP clipping presentation, accessible evidence labels, and responsive three-pane stacking.

Current assertions cover:

- unchanged v1 loading alongside strict v2 skeleton/socket and attachment-profile loading
- dotted IDs, section isolation, tree/cycle/role/socket validation, quaternion validation and sign canonicalization
- strict schema-v2 cone-twist and diagnostic-capsule fields, ranges, unit axes, positive sizes, orphan/unknown-key rejection, schema-v1 rejection, reserved-looking dotted bone keys, and deterministic cooked object/null output
- attachment skeleton/socket/clip cross-references, two-hand requirements, ranges, duplicate keys/IDs, deterministic ordering, optional attachment-root behavior, and failed-load state retention
- generation-safe typed handle invalidation after successful reload
- exact rest-pose bone, socket, joint-segment, item, contact, handle, palm, and secondary-target invariants for the rifle fixture
- parent-first translation/rotation composition with non-commuting rotations, `xyzw` quaternion output, canonical non-negative `w`, and deterministic repeated output
- explicit `pose.sampled=false`, native available/unavailable joint-limit and clipping truth, exact clipping unavailable reasons/empty shape, independent visual and collision boxes, v1 unresolved versus v2 resolved item-space pole truth, and `not_review_evidence`
- fail-closed behavior when evaluated numeric diagnostics are non-finite
- GET path, symlink, session, revision, exact staged-byte, expected profile-contract/phase/time, full-input manifest, and selected/dependency drift checks before returning an evaluation
- rest/sample GET success without a lease, operation, journal entry, authored write, event, capture, or persisted evaluation
- preview baseline/candidate evaluation against exact staged bytes, including `baseline: null` for new files and no evaluation fields in the durable journal
- evaluator protocol and infrastructure failures, including wrong IDs/schema/phase/time, contradictory sampled layers/diagnostics, clipping geometric/aggregate falsehoods and negative zero, malformed JSON, bounded unavailable diagnostics, and temporary-root cleanup
- preview lease loss during evaluation rejected before operation creation
- Assets rest/sampled schematic deep validation across populated bone/segment/socket/item/contact/handle/hand/palm/target/pole/diagnostic/limitation entries, string/array/coordinate-row limits, contradictory IK truth, exact joint-limit and clipping objects with recomputed truth, distinct authored visual/collision boxes, CLEAR/OVERLAP output, and overflow-safe projection guards
- exact authored rest session/path/revision/manifest binding, sampled phase/clip/time/full-manifest binding, candidate operation/base/proposed/state binding, stale draft/conflict/sample behavior, sample availability outside the constrained grip parser, one App SSE subscription, guarded authoritative operation fetch, conflict lease-coverage decisions, and captured-connection-only cleanup

Later workflow assertions still required:

- rendered/captured review presentation remains intentionally limited to clean packet PNGs plus packet/operation/sample/camera identity; optional annotated meters/degrees are still deferred
- quaternion canonicalization: `w >= 0` and unit length after every apply
- review packet completeness: required cameras, resolution, framing, lighting, revisions, evaluated transforms/bounds/axes, candidate label, operation id, and all lease ids
- lease concurrency: two unrelated attachment writes can proceed; two writes to the same attachment queue FIFO
- `spatial/runtime-capture` is exclusive and released on completion
- stale `baseRevision` returns 409 and does not write
- approval denial leaves the attachment file unchanged
- apply/undo roundtrip restores byte-identical TOML
- shell, CLI, and MCP adapters use the same sessiond operations and packet schema for the same preview content
- annotated captures are optional and must not be required for packet completeness
- clean PNGs are present and readable, but exact cross-GPU PNG hashes are not an invariant

The fixtures remain outside `animation/skeletons/`, `animation/clips/`, `animation/graphs/`, and all cooked roots, so normal runtime startup and bake behavior are unchanged. `test:animation-scaffold` continues to cover the authored v1 animation lane.

## Acceptance Gates

A complete spatial-authoring workflow requires all gates below. The implemented slice satisfies parsing, validation, typed handles, deterministic v1/v2 cooking including authored joint-limit/capsule metadata, strict typed prefab box-collision source truth, native clip pose sampling, rest evaluation, sampled v2 two-bone IK with explicit v1 fallback, native numeric cone-twist and capsule-to-box diagnostics serialized through `shader_forge_spatial`, deterministic native close/player-camera sample rendering, fail-closed sessiond validation/recomputation, exact recapture leases, final revision checks, atomic immutable review publication and reads, distinct Assets PASS/FAIL and CLEAR/OVERLAP presentation, exact transient rest/sample sessiond evidence, one typed lease-free MCP rest/sample read, thin CLI/MCP review adapters, and packet-referenced Assets review presentation.

1. Skeleton schema version 2 with hierarchy, roles, sockets, optional cone-twist limits, and optional diagnostic capsules validates natively. **Implemented, including native numeric cone-twist and capsule-to-authored-box diagnostics, `shader_forge_spatial` serialization, sessiond fail-closed validation/recomputation, and Assets diagnose-only presentation.**
2. Attachment profiles validate and load to generation-safe typed handles, then cook with skeleton sockets and optional bone diagnostic metadata into a deterministic derived payload. **Implemented.** Generic bake and runtime-consumption integration remain deferred.
3. Prefabs are referenced by ID and do not contain copied grip fields. **Implemented for evaluator lookup and authored collision-proxy diagnostics: `item_prefab` resolves through `DataFoundation`, exact box procgeo corners remain visual-only, and an independent strict optional prefab collision box drives capsule clearance. General collision/contact evaluation remains open.**
4. Preview candidates are labelled and persist only through `engine_sessiond` operations. **Implemented for attachment TOML; transient GET/preview evaluations are never persisted.**
5. Approve/apply/undo use the existing journal; stale revisions conflict; denied approvals do not write. **Implemented for attachment TOML, including preview lease recheck after evaluation.**
6. Review packets are immutable, identified by `reviewId`, and complete without viewport scraping. **Implemented through native capture, sessiond atomic publication/reads, CLI/MCP adapters, and Assets publication/loading/presentation.**
7. Two-hand evaluation order is sampled pose, primary grip, secondary IK.
8. Diagnostics are numeric and authored-input-driven. **Implemented natively and end to end for cone-twist limits and capsule-to-authored-box clearance in `diagnose` mode; unimplemented clamp policy and general collision/contact claims are rejected.**
9. Unrelated profiles concurrent; overlapping keys queue; capture lease is short and exclusive. **Implemented; Assets releases its tuning write lease before requesting bounded source-read/capture-write/review-write capture authority.**
10. `sf-mcp` attachment mutation tools call those operations and no other write path. **Implemented for preview/review/apply/undo.**
11. The native schema and production validate/cook/evaluate-rest/evaluate-sample command harnesses pass; capture verification remains independent of cross-GPU exact PNG hashes. **Schema, validation, deterministic v1/v2 cooker, rest schematic, v1 pre-IK compatibility, v2 sampled two-bone IK, deterministic capture structure, sessiond publication, and adapter coverage are implemented.**
12. Current three-bone metadata, proxy-card rendering, and non-review Assets schematics are described honestly wherever they remain. **Implemented for Assets: exact authored visual-box outlines remain distinct from collision-box/capsule proxies; joint limits use PASS/FAIL and clipping uses CLEAR/OVERLAP with explicit no-gameplay-approval/no-contact-manifold caveats. Only separately loaded packet-referenced PNGs carry the immutable review-evidence label.**

Until the remaining workflow gates pass, the implementation is a spatial schema/query/cook/rest-schematic foundation rather than a complete authoring and review workbench.

## Staged Implementation Order

Dependency order, with no calendar estimates. This work starts after the operation layer, which already exists, and finishes its contract-sensitive slices before broad World/Assets visual polish.

1. **Schema, evaluator diagnostics, and validator — implemented.** V1 skeleton/attachment compatibility, strict v2 skeleton/socket/attachment parsing, optional cone-twist limits and diagnostic capsules, strict optional prefab box collision, item-space pole semantics, secondary-arm/palm capability checks, role and graph validation, quaternion canonicalization, supported cross-references, and non-mutating rest-relative swing/twist plus capsule-to-authored-box diagnostics are implemented. Evaluator-side prefab/procgeo lookup uses `DataFoundation`. `shader_forge_spatial` serialization, sessiond fail-closed validation/recomputation, and distinct Assets PASS/FAIL versus CLEAR/OVERLAP presentation are implemented; general collision/contact evaluation remains deferred.
2. **Typed loader handles — implemented.** Generation-tagged skeleton, bone, socket, and attachment handles plus snapshot/query APIs, with transactional reload behavior. Schema-v2 clip tracks now produce deterministic sampled pose snapshots by clip name and normalized time.
3. **Read-only native validation command — implemented.** One `shader_forge_spatial` executable reuses `AnimationSystem`, emits deterministic JSON, and is exposed by CLI build and validate commands without auto-build or daemon state.
4. **Deterministic cooker — implemented as an explicit spatial command.** `shader_forge_spatial cook` validates through `AnimationSystem` and atomically stages one complete skeleton/socket/profile payload, including optional joint-limit/capsule object-or-null fields, under `build/cooked/animation/`. Generic `engine bake` integration and runtime consumption remain deferred.
5. **Rest-pose schematic evaluation — implemented.** `shader_forge_spatial evaluate-rest` composes deterministic rest bone/socket, item, hand, joint-segment, target, and pole frames plus independent authored visual-box and collision-box/capsule evidence when available, one exact typed joint-limit object, and one exact typed clipping object. A revision-safe sessiond GET evaluates exact animation/content/foundation bytes, validates and recomputes diagnostic truth fail-closed, preview returns transient exact baseline/candidate evaluations, and the shell projects resolved v2 poles, the visual box, and diagnose-only joint/clipping proxies. All are explicitly unsampled, do not apply IK, and carry no rendered-mesh, general-collision, capture, or review-packet claim; the separate authored runtime camera component does not upgrade schematics into visual evidence.
6. **Spatial operations — attachment mutation, validation, and recapture implemented.** Preview/apply/undo over `engine_sessiond` remains attachment-TOML-only, with separate review transitions, labelled candidates, expected-ID binding, one semantic mutation dispatcher, native apply/undo revalidation, and a lease recheck after evaluator work. Lease-free operation validation stages private candidate bytes, evaluates rest plus bounded requested samples, rejects source drift, and CAS-records only controlled summary truth. Recapture requires that validation, three exact lease classes, and real native frames before atomic immutable publication. No fake captures.
7. **Humanoid fixture — implemented for validation, rest evaluation, and clip sampling.** Isolated humanoid, rifle, pistol, and schema-v2 clip fixtures plus the executable native harness now prove schema validation, interpolation, rest fallback, and transform composition without entering authored or cooked roots.
8. **Sampling and procedural layers — native, sessiond, Assets, and typed MCP evidence implemented.** Native schema-v2 pose sampling feeds primary attachment and deterministic secondary-hand two-bone IK at exact authored envelope phase/time. Requested/applied/unavailable layers are explicit, v1 remains pre-IK, and v2 reports reachable/unreachable plus separate reach/contact/angular tolerance truth. Both rest and sampled reports carry the same exact typed joint-limit and clipping objects. The transient sessiond sampled GET binds the complete input manifest and fail-closed recomputed diagnostic truth; Assets and lease-free `spatial_attachment_read` consume that exact authored sample without creating review evidence.
9. **Workbench and recapture — native renderer and sessiond packet publisher implemented.** `shader_forge_spatial capture-sample` evaluates one exact authored phase/time and software-rasterizes the authored procgeo item box plus every posed bone segment as depth-tested 3D triangles under fixed explicit lighting. It emits source identity, bounded camera/bounds/lighting metadata, four deterministic close-camera RGB PNGs, and an optional strict authored root or parented `player_camera` frame only into a new output directory. Sessiond expands selected authored phases, validates every source/capture/review lease and PNG, rechecks source revisions, atomically publishes a new immutable packet, serves manifests and referenced captures, and cleans up on failure. Optional annotations remain deferred.
10. **Constrained tuner, rest/sampled rig schematics, and immutable review panel — shell slice implemented.** The three-pane Assets workbench edits exact primary-grip translation/rotation fields through the operation workflow and presents exact native rest plus authored sampled evaluation in Front X/Y, Side Z/Y, and Top X/Z projections, including diagnose-only joint-limit PASS/FAIL and distinct clipping CLEAR/OVERLAP proxy evidence. Evidence remains fixed to its path/revision/operation/sample identity when drafts move; malformed reports and manifests fail closed; browsing and sampling remain lease-free; the shared App SSE lane reconciles active operation state authoritatively. A separate panel validates and publishes a selected authored phase or loads a shared review ID, fail-closes malformed/mismatched packets, and displays only packet-referenced real PNGs with review/sample/camera identity. Candidate sampling and native overlay remain deferred; the browser schematics remain explicitly non-review evidence.
11. **`sf-mcp` adapter — attachment and review workflows implemented.** One session-pinned, lease-free `spatial_attachment_read` tool adapts the exact revision-bound rest/sample responses, while lease-free `spatial_attachment_validate` adapts operation validation with bounded strict samples and no credential. Process-owned identity and credentials plus explicit leases adapt preview/review/apply/undo. `spatial_review_reserve`, `spatial_review_recapture`, `spatial_review_read`, and `shaderforge://spatial/review/{reviewId}` adapt the implemented sessiond review workflow without caller-controlled session or credential input.
12. **World/Assets visual polish.** Gizmos and viewport chrome may then consume the same candidate/operation contract. They must not introduce a second persistence path.

If World/Assets polish starts first, it must not ship free-drag attachment editing, proxy-card reviews, or prefab-copied grips.

## Related Specs

- [ENGINE-SYSTEMS-INDEX.md](ENGINE-SYSTEMS-INDEX.md)
- [ENGINE-ANIMATION-SPEC.md](ENGINE-ANIMATION-SPEC.md)
- [ENGINE-RUNTIME-SPEC.md](ENGINE-RUNTIME-SPEC.md)
- [ENGINE-OPERATIONS-SPEC.md](ENGINE-OPERATIONS-SPEC.md)
- [ENGINE-SESSIOND-SPEC.md](ENGINE-SESSIOND-SPEC.md)
- [ENGINE-MCP-SPEC.md](ENGINE-MCP-SPEC.md)
- [ENGINE-SHELL-SPEC.md](ENGINE-SHELL-SPEC.md)
- [ENGINE-TOOLING-UI-SPEC.md](ENGINE-TOOLING-UI-SPEC.md)
- [ENGINE-ASSET-PIPELINE-SPEC.md](ENGINE-ASSET-PIPELINE-SPEC.md)
- [ENGINE-SCENE-SPEC.md](ENGINE-SCENE-SPEC.md)
