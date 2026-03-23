# Engine CLI Spec

## Purpose

`engine_cli` provides the command-line entry point for building, running, testing, importing, and baking.

## Phase 2 Initial Slice

The first implemented CLI slice focuses on backend bring-up and local inspection.

Current implemented commands:

- `engine sessiond start`
- `engine session create`
- `engine session list`
- `engine file list`
- `engine file read`
- `engine build`
- `engine run`

## Initial Commands

- `engine run`
- `engine build`
- `engine test`
- `engine import`
- `engine bake`
- `engine package`
- `engine export`

The initial build/run command family now targets the native runtime scaffold:

- `engine build` configures and builds `shader_forge_runtime` through `cmake`
- `engine run sandbox` builds and launches the native runtime target
- `engine run` now forwards `--input-root`, `--content-root`, `--data-foundation`, `--tooling-layout`, and `--tooling-layout-save` so native bring-up can inspect text-backed engine assets and configuration directly
- `engine_sessiond` also exposes a runtime build lifecycle surface so the shell can trigger native builds and stream logs without scraping a PTY

`engine test`, `engine import`, `engine bake`, `engine package`, and `engine export` remain reserved command space.

## Future Packaging And Diagnostics Commands

- `engine package`
- `engine export`
- `engine save inspect`
- `engine save migrate`
- `engine profile capture`
- `engine profile live`

## Future Migration Commands

- `engine migrate detect`
- `engine migrate unity`
- `engine migrate unreal`
- `engine migrate godot`
- `engine migrate report`

## Future AI Commands

- `engine ai providers`
- `engine ai test`
- `engine ai request`
- `engine ai budgets`
