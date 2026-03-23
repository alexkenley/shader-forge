# Asset Pipeline Spec

## Purpose

The asset pipeline converts source assets and generated assets into cooked runtime assets.

## Initial Scope

- source asset metadata
- cook step
- generated asset path for procedural geometry
- validation and import status
- preview support in the shell

## Current First Slice

The current first slice in the repo now includes:

- `engine bake` as the first real asset-pipeline command
- staged cooked outputs emitted into the stable `build/cooked/` layout
- a structured bake report at `build/cooked/asset-pipeline-report.json`
- text-backed procedural geometry assets under `content/procgeo/*.procgeo.toml`
- text-backed audio buses, sounds, and events under `audio/`
- text-backed animation skeletons, clips, and graphs under `animation/`
- deterministic generated-mesh preview payloads under `build/cooked/generated-meshes/`
- staged cooked audio bus, sound, and event metadata under `build/cooked/audio/`
- staged cooked animation skeleton, clip, and graph metadata under `build/cooked/animation/`

The animation lane also validates clip-to-skeleton, graph-to-clip, graph entry-state, and clip `audio_event` bindings during bake so later runtime sampling work can rely on a real staged catalog instead of ad-hoc file discovery.

This is a real first cook lane, but it is still a staging slice rather than the final FlatBuffers writer. The current bake command emits deterministic placeholder cooked payloads in the stable cooked layout so later runtime and tool work can target real paths before the binary writer lands.

## Migration Relationship

The asset pipeline must also accept normalized migration manifests from supported source engines.

Required behavior:

- ingest exported or parsed source-engine assets through the same validation and cook path
- preserve provenance metadata for migrated assets
- emit warnings when source-engine features are approximated or dropped
