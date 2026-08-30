# Engine Spatial Authoring And Attachment Tuning Spec

Status: planned foundational contract; not implemented

Date: 2026-08-30

## Purpose

Shader Forge spatial authoring is the engine-owned contract for skeleton sockets, attachment profiles, pose-stable review, and constrained attachment tuning.

It exists so a weapon, tool, or held item has one authored truth that native runtime code, cooked data, the React shell, the CLI, and `sf-mcp` all share. It is the product answer to Unreal's split truth, where Blueprint or editor presentation can drift from native C++ behavior.

This document specifies the contract. It does not describe a shipped workbench. The current repo still has a three-bone metadata skeleton, no sockets, no attachment profiles, no pose sampling, and projected debug-proxy cards rather than skinned attachment rendering.

## Authored-Truth Contract

One contract, five owners of distinct jobs:

1. Native engine code owns behavior, typed schemas, validation, runtime pose evaluation, IK, diagnostics, and execution.
2. Source-controlled typed assets own project tuning values. Those assets are the editable truth.
3. Shell, CLI, and `sf-mcp` edit those exact assets only through `engine_sessiond` revision-safe operations. There is no editor-private write path and no MCP-private write path.
4. Preview candidates are transient, visibly labelled, and never the source of truth until apply succeeds.
5. Cooked data is derived, reproducible, and non-editable. Review captures are generated artifacts, not authored assets.

If a value affects how an item sits in a hand, it lives in an attachment profile or a skeleton socket. It does not live in a hidden editor database, a duplicated C++ constant, generated code that humans edit, or a prefab copy of the profile.

## Current Reality

The current animation and scene slices are not this system:

- `animation/skeletons/debug_humanoid.skeleton.toml` is a schema-version-1 metadata file with `root_bone = "hips"` and `bones = "hips, spine, head"`. There is no parent table, rest pose, semantic role map, or socket list.
- `AnimationSystem` loads and validates skeleton, clip, and graph metadata. It does not sample poses, blend, retarget, or evaluate IK.
- The native window projects authored prefab render components as debug-proxy cards. That is not a skinned mesh, not a weapon in a hand, and not a spatial-review capture.
- Shell `Review` in the current World authoring slice is a discard-only scene stance. It is not a spatial `reviewId` packet.
- Embedded viewer transport and screenshot capture are still deferred.
- `engine_sessiond` already owns revision-safe text-file preview/approve/apply/undo. Spatial operations are not implemented on top of that journal.
- `sf-mcp` is read-and-coordinate only. It must not grow spatial mutation tools until the engine operations below exist.
- There is no `animation/attachments/` root, no `build/spatial-reviews/` output, and no spatial harness.

Later implementation must widen from this metadata/proxy-card baseline. It must not present the current three-bone skeleton or proxy cards as a completed attachment tuner.

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

- Implementing the workbench, UI, cooker, or harness in this documentation pass.
- Adding a new daemon, sidecar process, or provider-specific capture service.
- Adding a built-in AI assistant, VLM panel, prompt composer, or provider picker to the shell.
- Treating visual-language-model scores, screenshot hashes, or operator taste as apply authority.
- Requiring cross-GPU exact PNG hashes as a pass/fail invariant.
- Replacing the current three-bone `debug_humanoid` metadata slice before a real sampling backend exists.
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
| Revision, approval, apply, undo, provenance | `engine_sessiond` operations journal | Direct file writes from MCP or ad-hoc scripts |
| Multi-agent leases and queues | `engine_sessiond` coordinator | A global MCP lock or chat orchestrator |
| Human inspection and constrained edits | React shell and native tooling overlay | A built-in assistant |
| External agent access | `sf-mcp` adapter calling the same operations | A Codex/Cursor Saved folder |
| Derived runtime bytes | `engine bake` cooked outputs | Hand-edited files under `build/cooked/` |
| Review packets and captures | Generated `build/spatial-reviews/<review-id>/` | Authored content roots |

`owner_system` for skeleton and attachment assets is `animation_system`. Scene prefabs remain owned by `scene_system` and are referenced by ID only.

## Dependencies

Required before spatial implementation starts:

- The existing `engine_sessiond` revision-safe text-file operation contract. Spatial apply/undo must be another operation kind on that journal, not a second writer.
- The existing hierarchical lease coordinator, including FIFO overlapping-write queues and workspace-scoped `runtime` exclusivity.
- The authored animation root under `animation/` and the current `AnimationSystem` load/validate path, widened rather than replaced.
- The shared code-trust evaluate/review-queue path used by file-write apply.

Required before capture, IK diagnostics, and review packets can pass:

- Real animation sampling and a procedural IK layer in native runtime. Metadata-only graph resolution is not enough.
- A runtime capture path that can render the staging workbench to image files. The current projected debug-proxy cards are not an acceptable stand-in.
- A humanoid fixture with a real arm/hand bone chain. `debug_humanoid`'s hips/spine/head list cannot host a two-hand rifle.

Required before `sf-mcp` spatial tools:

- Engine spatial operations, including preview, validate, apply, undo, and review-packet read, already working from shell and CLI against `engine_sessiond`.

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
- canonical quaternion: Euclidean length `1` within `1e-6`; if `w < 0`, negate `x,y,z,w` before write, compare, or cook; reject non-finite components
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
- optional `joint_limit` with an authored limit kind, local axes, and numeric angular bounds; diagnostics report joint-limit status as unavailable when this is absent
- optional `diagnostic_capsule` with local axis, radius, and half-length for contact/clipping checks; it is review geometry, not a runtime collision replacement

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
- `schema_version = 1`
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
- `pole.translation`: item-local or parent-space pole vector origin used by the off-hand IK
- `tolerances.reach_meters`
- `tolerances.angle_degrees`
- `tolerances.contact_meters`
- `joint_limit_policy`: `diagnose` or `clamp_and_diagnose`

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
- two-hand profiles fail validation without `secondary_hand.enabled = true` and a target frame.
- unknown schema versions fail closed.
- first-person and `both` profiles require a recorded `player_camera` in every complete review packet.

## Typed Native Handles

Native code exposes typed, non-string handles after validation. The names below are the contract; they are not present in the current `AnimationSystem`.

```cpp
struct SkeletonId { std::uint64_t value = 0; };
struct BoneId { std::uint64_t value = 0; };
struct SocketId { std::uint64_t value = 0; };
struct AttachmentProfileId { std::uint64_t value = 0; };
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
2. Native validator checks schema, ids, tree, required capability roles, quaternion canonicalization, authored joint/palm/capsule/handle inputs, prefab collision geometry, clip existence, and envelope sample ranges.
3. Loader intern ids into typed handles and keeps the source path plus content hash.
4. `engine bake` writes deterministic cooked tables under `build/cooked/animation/skeletons/` and `build/cooked/animation/attachments/`.
5. Runtime prefers cooked tables when present, and otherwise may load validated source during uncooked development exactly as other animation metadata currently does.
6. Cooked files are not an edit target. A harness must fail if a test edits cooked bytes and expects the change to round-trip as authored truth.

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
- `motionEnvelope`: the phase set captured with this packet
- `cameras[]`: each with `id`, `position`, `target`, `up`, `fovDegrees`, `nearMeters`, `farMeters`, `widthPx`, and `heightPx`
- `lighting`: key/fill/rim directions and intensities plus exposure, all explicit
- `samples[]`: one entry for every requested phase/time pair, each containing `posePhase`, `normalizedTime`, bone/socket/item/contact/target world transforms and local axes, character/item/contact-region bounds, numeric-or-unavailable diagnostics, and clean capture paths
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

Until a real capture path exists, spatial capture operations fail closed. They must not write proxy-card PNGs and call them spatial reviews.

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
- if reach, joint, contact, or clipping diagnostics exceed tolerances, validation fails; the solver does not silently retarget the authored grip to "make it work"

Named motion-envelope phase set for the first rifle fixture:

- `idle`
- `aim`
- `sprint`

Additional project phases may be added as `[motion_envelope.<name>]` tables. A review packet names the subset it captured.

Diagnostics, numeric and exact when their authored inputs are present:

- primary contact: translation and angular error between the socket frame and item primary-contact frame
- reach: meters between off-hand effector and secondary target, compared to `tolerances.reach_meters`
- joint: degrees past each evaluated hinge/ball limit
- contact: meters between off-hand palm frame and the target contact frame, compared to `tolerances.contact_meters`
- handle line: distance and angular deviation from the authored item-local handle axis
- clipping: overlap depth in meters between item bounds and torso/head/arm capsules

Diagnostic thresholds live in the attachment profile. Joint limits and diagnostic capsules come from the skeleton, palm frames come from skeleton sockets, handle/contact frames come from the profile, and item collision geometry comes from the referenced prefab. Missing inputs produce `unavailable` diagnostics and cannot satisfy a policy that requires them. None may fall back to C++ literals.

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
2. `validate` runs the native validator and, when sampling exists, the diagnostic pass on requested envelope phases. Failure stays on the operation as structured field errors. Success does not apply.
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

## Planned Engine Surfaces

None of the following are implemented. They are the adapter and UI shapes to build after the native validator and operation kinds exist.

### `engine_sessiond`

Planned routes, all workspace-scoped and loopback-only:

- `POST /api/operations/spatial-attachment/preview`
- `POST /api/operations/:id/validate`
- `POST /api/operations/:id/recapture`
- existing approve/reject/apply/undo
- `GET /api/spatial/reviews/:reviewId`
- `GET /api/spatial/reviews/:reviewId/captures/:name`

Review artifacts live in the project under `build/spatial-reviews/` so they are inspectable. Operation history stays in existing `operations.json`. No new daemon and no provider cache directory.

### CLI

Planned commands, calling sessiond rather than writing files:

- `engine spatial preview`
- `engine spatial validate`
- `engine spatial recapture`
- `engine spatial apply`
- `engine spatial undo`
- `engine spatial review read <review-id>`

### Shell

Planned surface: an Assets-adjacent attachment inspector and a labelled preview candidate. It consumes the same operations and review packets as CLI/MCP.

It does not:

- scrape World viewport cameras
- embed an assistant
- treat proxy-card Playtest frames as spatial evidence
- land as part of broad World/Assets visual polish before the operation kinds exist

### Native tooling overlay

Planned Dear ImGui diagnostics: candidate label, axis-probe readout, reach/joint/contact/clipping numbers, and envelope phase name. The overlay is not the persistence path.

### `sf-mcp`

`sf-mcp` stays an adapter. Spatial MCP tools are forbidden until the sessiond operations above exist and shell/CLI already call them.

Planned resources, after that gate:

- `shaderforge://spatial/skeleton/{skeletonId}`
- `shaderforge://spatial/attachment/{attachmentId}`
- `shaderforge://spatial/review/{reviewId}`

Planned tools, after that gate:

- `spatial_attachment_read`
- `spatial_attachment_preview`
- `spatial_attachment_validate`
- `spatial_review_read`
- `spatial_review_recapture`
- generic `operation_approve`
- generic `operation_apply`
- generic `operation_undo`

These tools must send coordinator credentials and hold the resource keys in this spec. They must not wrap `/api/files/write`. Current `sf-mcp` remains read-and-coordinate only.

## Storage

Authored, source-controlled:

- `animation/skeletons/*.skeleton.toml`
- `animation/attachments/*.attachment.toml`

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

The following is the canonical schema example. It is not in the repo yet. `debug_humanoid` cannot satisfy it.

```toml
schema = "shader_forge.attachment_profile"
schema_version = 1
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

Matching skeleton socket fragment, also planned:

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

Planned harness, not present today. Command shape should follow existing Node `.mjs` harnesses and be runnable without a GPU-hash oracle.

Required fixture:

- a real humanoid bone chain with hips through hands and feet, not `debug_humanoid`'s three-bone list
- a two-hand rifle prefab referenced by ID
- `idle` and `aim` envelope phases, with `sprint` optional but recommended
- the rifle attachment profile in the example above, with known numeric values

Required assertions:

- exact numeric invariants on rest bone translations, socket-local grip, baked world grip, secondary target, and diagnostic meters/degrees at each named phase
- quaternion canonicalization: `w >= 0` and unit length after every apply
- review packet completeness: required cameras, resolution, framing, lighting, revisions, evaluated transforms/bounds/axes, candidate label, operation id, and all lease ids
- lease concurrency: two unrelated attachment writes can proceed; two writes to the same attachment queue FIFO
- `spatial/runtime-capture` is exclusive and released on completion
- stale `baseRevision` returns 409 and does not write
- approval denial leaves the attachment file unchanged
- apply/undo roundtrip restores byte-identical TOML
- shell, CLI, and MCP adapters, once they exist, produce the same resulting attachment bytes and the same packet field set for the same preview content
- annotated captures are optional and must not be required for packet completeness
- clean PNGs are present and readable, but exact cross-GPU PNG hashes are not an invariant

The current `test:animation-scaffold` remains the metadata harness for three-bone `debug_humanoid`. It must not be silently retargeted as this spatial harness.

## Acceptance Gates

A slice may be called spatial authoring only when all of the following hold for that slice:

1. Skeleton schema version 2 with hierarchy, roles, and sockets validates natively.
2. Attachment profiles validate, load to typed handles, and cook deterministically.
3. Prefabs are referenced by ID and do not contain copied grip fields.
4. Preview candidates are labelled and persist only through `engine_sessiond` operations.
5. Approve/apply/undo use the existing journal; stale revisions conflict; denied approvals do not write.
6. Review packets are immutable, identified by `reviewId`, and complete without viewport scraping.
7. Two-hand evaluation order is sampled pose, primary grip, secondary IK.
8. Diagnostics are numeric and profile-driven.
9. Unrelated profiles concurrent; overlapping keys queue; capture lease is short and exclusive.
10. `sf-mcp` tools, if exposed, call those operations and no other write path.
11. The deterministic harness above passes without a cross-GPU PNG hash check.
12. Current three-bone metadata and proxy-card rendering are still described honestly wherever they remain.

Failing any gate means the slice is still animation metadata or scene authoring, not spatial authoring.

## Staged Implementation Order

Dependency order, with no calendar estimates. This work starts after the operation layer, which already exists, and finishes its contract-sensitive slices before broad World/Assets visual polish.

1. **Schema and validator.** Skeleton version 2 and attachment profile version 1, including closed role enums and quaternion canonicalization. Keep schema version 1 `debug_humanoid` loading as metadata.
2. **Typed loader handles.** Native `findAttachment` / snapshot APIs with no sampling yet.
3. **Cooker.** Stage attachment and socket tables under `build/cooked/animation/`.
4. **Spatial operations.** Preview/validate/apply/undo over `engine_sessiond` for attachment TOML only. Label candidates. No fake captures.
5. **Humanoid fixture.** Add the real bone-chain skeleton, two-hand rifle prefab, and rifle profile used by the harness. Do not pretend `debug_humanoid` is that fixture.
6. **Sampling and procedural layers.** Native sampler, primary attachment, secondary-hand IK, diagnostics. This is the animation-runtime widening spatial authoring depends on.
7. **Workbench and recapture.** Deterministic staging scene, explicit cameras, immutable packets, clean/optional-annotated captures. Fail closed until capture exists.
8. **Constrained tuner.** Shell inspector plus native overlay for single-axis, numeric, snap, reset, and probe edits over the operation kinds.
9. **`sf-mcp` adapter.** Resources and tools from this spec, only after shell and CLI already use the operations.
10. **World/Assets visual polish.** Gizmos and viewport chrome may then consume the same candidate/operation contract. They must not introduce a second persistence path.

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
