# Engine Packaging Spec

## Purpose

The packaging/export system owns release layout generation, cooked-asset bundling, platform packaging, and reproducible game-build output.

It exists so Shader Forge can ship projects through explicit engine workflows rather than leaving release builds as an ad-hoc manual process.

## Core Principles

- packaging should be driven from CLI-first automation
- builds must separate tool outputs, cooked assets, and distributable release layouts
- export configuration should be text-backed and source-controlled where safe
- platform packaging should be scriptable and extensible without rewriting the core engine workflow

## Responsibilities

- release layout generation
- cooked asset bundling
- platform-specific export steps
- packaging presets and configuration
- signing or credential-hook integration where applicable
- deterministic build and packaging harnesses

## Current Implemented Slice

The first Phase 6.2 checkpoint is now real:

- `tooling/export-presets/default.export-preset.toml` is the source-controlled default export preset
- `engine export inspect` resolves that preset, validates the required runtime/authored/cooked roots, reports cooked-asset counts, and surfaces last-package metadata
- `engine package` now emits a reproducible release-layout scaffold under `build/package/<preset>/`
- the current package layout bundles the runtime binary, packaged authored runtime roots, cooked outputs, launch scripts, the resolved export preset, a runtime-launch manifest, and a package report
- `engine_sessiond` and the shell `Workspace` tab now expose the same inspect/package flow for workspace-backed operators
- deterministic harness coverage now exists for the packaging/export scaffold

## Current Boundary

The current launch scripts still point at packaged authored roots rather than cooked-runtime inputs. Cooked outputs are bundled in the release layout now so the workflow is reproducible and inspectable before cooked-runtime loading, signing, archive generation, and real platform hook execution land.

## Non-Goals

- making packaging a GUI-only workflow
- hiding export logic in undocumented shell scripts
- blocking the first shipping path on every platform at once
