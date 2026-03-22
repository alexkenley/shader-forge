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

## Non-Goals

- making packaging a GUI-only workflow
- hiding export logic in undocumented shell scripts
- blocking the first shipping path on every platform at once
