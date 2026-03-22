# Asset Pipeline Spec

## Purpose

The asset pipeline converts source assets and generated assets into cooked runtime assets.

## Initial Scope

- source asset metadata
- cook step
- generated asset path for procedural geometry
- validation and import status
- preview support in the shell

## Migration Relationship

The asset pipeline must also accept normalized migration manifests from supported source engines.

Required behavior:

- ingest exported or parsed source-engine assets through the same validation and cook path
- preserve provenance metadata for migrated assets
- emit warnings when source-engine features are approximated or dropped
