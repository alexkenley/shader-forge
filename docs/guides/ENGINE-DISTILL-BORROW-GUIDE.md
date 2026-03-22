# Distill Borrow Guide

Date: 2026-03-22

## Purpose

Use Distill as a reference for asset import daemons, artifact caching, change detection, and hot-reload event flow.

Repository:
- `https://github.com/amethyst/distill`

Primary phases:
- Phase 5
- Phase 5.5
- Phase 6

## Borrow Targets

### Import, Cook, And Cache Pipeline

Look for:
- background import processing
- artifact keying and cache invalidation
- daemon-to-runtime event flow

Borrow:
- separation between authored inputs, cooked outputs, and cache metadata
- background processing concepts for asset cooking
- hot-reload event flow between tooling and runtime

Adapt for Shader Forge:
- route orchestration through `engine_sessiond`, CLI, and deterministic harnesses
- cook to Shader Forge runtime data formats rather than copying crate structure

Do not borrow as-is:
- Rust-specific service and crate layout
- outdated infrastructure choices if a simpler local approach works
