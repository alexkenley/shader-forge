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

## Initial Commands

- `engine run`
- `engine build`
- `engine test`
- `engine import`
- `engine bake`

The initial build/run/import/bake command family still exists as reserved command space, but not yet as real execution paths.

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
