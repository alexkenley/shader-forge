# Engine Code Trust Spec

Status: artifact verification and promotion slice implemented
Date: 2026-03-25

## Purpose

Shader Forge needs an explicit trust boundary before assistant-generated code, external plugins, and future hotload workflows become normal engine features.

This subsystem owns:

- trust tiers for engine, project, assistant-generated, external-plugin, and unsafe-dev override paths
- explicit policy decisions for apply, compile, load, install, and hot-reload requests
- artifact-origin tracking for policy-relevant writes
- artifact hashing and verification state for tracked files
- explicit promote and quarantine transitions for reviewed artifacts
- actionable diagnostics for blocked or review-gated transitions
- explicit review queues plus replay for `review_required` transitions
- deterministic verification for allowed, queued, approved, denied, and rejected paths

## First Implemented Slice

The first useful slice is intentionally local and explicit.

Current implemented surfaces:

- source-controlled policy data under `tooling/policy/code-access-policy.json`
- tracked artifact metadata under `<workspace>/.shader-forge/code-trust-artifacts.json`
- shared policy evaluation in `tools/shared/code-trust-policy.mjs`
- `GET /api/code-trust/summary`
- `POST /api/code-trust/evaluate`
- `GET /api/code-trust/artifacts`
- `POST /api/code-trust/artifacts/transition`
- `GET /api/code-trust/approvals`
- `POST /api/code-trust/approvals/:id/decision`
- policy enforcement on `POST /api/files/write`
- policy enforcement on `POST /api/build/runtime`
- policy enforcement on `POST /api/runtime/start`
- policy enforcement on `POST /api/runtime/restart`
- CLI inspection through `engine policy inspect`
- CLI artifact inspection through `engine policy artifacts`
- CLI dry-run checks through `engine policy check`
- CLI approval inspection and decisions through `engine policy approvals|approve|deny`
- CLI artifact promotion and quarantine through `engine policy promote|quarantine`
- shell-side inspection, artifact promote/quarantine controls, and pending approval controls in the `Workspace` right-panel tab

This slice still does not try to provide full sandboxing. It makes the trust boundary visible, queueable, and testable first.

## Current Trust Tiers

The first slice distinguishes:

- `engine_trusted`
- `project_authored`
- `assistant_generated`
- `external_plugin`
- `unsafe_dev_override`

The current policy also distinguishes the request actor:

- `human`
- `assistant`
- `automation`

The policy result is one of:

- `allow`
- `review_required`
- `deny`

## Current Path Model

The bundled default policy currently covers:

- engine-owned source under `engine/`, `shell/`, `tools/`, `scripts/`, `docs/`, and `plans/`
- built runtime artifacts under `build/runtime/`
- project-authored code under `games/` and `content/scripts/`
- assistant-generated code under `generated/assistant/` and `.shader-forge/assistant/`
- external plugins under `addons/` and `plugins/`
- authored hot-reload content under `content/`, `audio/`, `animation/`, `physics/`, `input/`, `data/`, and `tooling/layouts/`

Rules:

- assistant apply into engine-owned zones is review-gated by default
- assistant compile for engine-owned code is review-gated by default
- assistant load of assistant-generated or external-plugin artifacts is blocked by default
- hot reload is currently limited to authored content roots; code hot reload is blocked
- unsafe-dev overrides are explicit policy flags, not hidden bypasses

## Artifact Tracking

Policy-relevant writes record:

- relative path
- effective origin
- target trust tier
- target kind
- last policy action
- update timestamp
- current tracked content hash
- explicit promotion status: `tracked`, `promoted`, or `quarantined`

Inspect-time artifact state now also includes:

- hash verification status: `verified`, `modified`, `missing`, or `unhashed`
- promote/quarantine metadata including reviewer identity and note text

Promoted artifacts now have an explicit trusted hash snapshot. If the file changes after promotion, later `load`, `install`, or `hot_reload` checks deny the transition until the artifact is reviewed again. Quarantined artifacts are always denied for those risky transitions until they are explicitly promoted again.

## Review Workflow

`review_required` decisions now enqueue an explicit approval record instead of only returning diagnostics.

Each approval currently stores:

- the queued operation type such as `file_write` or `build_runtime`
- the normalized request payload that will be replayed if approved
- the original code-trust evaluation and summary text
- pending, approved, denied, or failed status plus resolver metadata

Current approval behavior:

- review-gated assistant file writes and assistant compile requests return HTTP `409` with both `codeTrust` and `approval`
- approvals can be listed by workspace session, while engine-wide approvals remain visible alongside session-scoped entries
- approving a queued request replays the stored operation as a human-reviewed action
- denying a queued request records the decision without executing the deferred operation
- failed replay attempts are captured as `failed` approvals so review history remains inspectable

## Current Tooling Surfaces

`engine_sessiond` provides the shared local control plane for policy checks.

The shell currently uses the summary surface to show:

- active policy source and path
- active unsafe-dev overrides
- supported hot-reload roots
- the most recent tracked artifacts with hash verification and promote/quarantine state
- inline promote and quarantine controls for tracked artifacts
- pending code-trust approvals with inline approve and deny actions

The CLI currently uses the same core for:

- policy inspection without running `engine_sessiond`
- full tracked-artifact inspection without running `engine_sessiond`
- deterministic dry-run checks for future assistant workflows
- explicit promote and quarantine transitions for tracked artifacts
- approval listing and approval decisions against a running `engine_sessiond`

## Deterministic Verification

Current deterministic harness:

- `npm run test:code-trust-scaffold`

That harness verifies:

- policy summary and dry-run surfaces
- tracked assistant-generated artifact metadata
- artifact hashes and current verification state
- explicit promote and quarantine transitions for tracked artifacts
- queued approval surfaces for assistant-triggered engine apply and compile requests
- approved replay of deferred file-write and runtime-build operations
- denied approval decisions without side effects
- rejected assistant-triggered engine load requests
- allowed authored-content hot reload and rejected code hot reload

## Current Boundaries

This first slice still does not provide:

- signed artifact verification
- real plugin package verification
- code hot reload or upgrade contracts
- cryptographic signing keys or trust-promotion workflows beyond local explicit review metadata

Those widening passes should land before Shader Forge treats assistant-driven code execution or plugin load as routine workflows.
