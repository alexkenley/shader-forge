# Packaging Borrow Guide

Date: 2026-03-22

## Purpose

Capture the best references for Shader Forge's packaging, export, and release-layout workflows.

## Recommended Reference Set

### 1. Godot

Repository:
- `https://github.com/godotengine/godot`

Reference docs:
- `https://docs.godotengine.org/en/stable/tutorials/export/exporting_projects.html`

Borrow:
- export presets
- resource selection filters
- CLI-driven release export
- clean split between project data packages and runnable builds

### 2. O3DE

Repository:
- `https://github.com/o3de/o3de`

Reference docs:
- `https://www.docs.o3de.org/docs/user-guide/packaging/project-export/project-export-pc/`
- `https://www.docs.o3de.org/docs/user-guide/project-config/cli-reference/`

Borrow:
- CLI-first export architecture
- scriptable export pipeline
- separation between asset preparation, executable build, and package layout

### 3. Stride

Repository:
- `https://github.com/stride3d/stride`

Reference docs:
- `https://doc.stride3d.net/latest/en/manual/files-and-folders/distribute-a-game.html`
- `https://doc.stride3d.net/latest/en/api/Stride.Core.Assets.Compiler.PackageCompiler.html`

Borrow:
- practical release publishing expectations
- asset compiler and package compiler split

## Recommended Shader Forge Direction

- add `engine package` and `engine export` style CLI surfaces later
- keep export configuration text-backed and scriptable
- separate cooked-asset bundling from release-layout generation

## Explicit Non-Goals

- GUI-only release pipelines
- one-off undocumented packaging scripts as the main shipping path
