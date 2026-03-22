# Engine Shell

This directory contains the Shader Forge browser shell.

Current status:

- the new shell framework target is React + TypeScript + Vite
- the current `web/` entrypoint is a compatibility scaffold
- the preserved code-editor implementation remains in `web/js/pages/code.js`
- inline find-in-file beside `Inspect` is a required retained behavior

Target shape:

- React shell frame
- Monaco editor
- repo explorer
- git panel
- PTY terminals with WSL/Linux shell workflows
- center dock with `Code`, `Game`, `Scene`, and `Preview`
- right-side engine panels such as `Details`, `Assets`, `Inspector`, `Build`, and `Profiler`

The shell should remain separate from:

- the native engine runtime
- the engine CLI
- any optional future AI assistant integration
