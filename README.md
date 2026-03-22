# Shader Forge

Shader Forge is a code-first, AI-native game engine project focused on building games directly against native runtime systems rather than on top of middleware editors.

Current direction:

- native C++ runtime with a Vulkan-first renderer
- browser-based developer shell using React + TypeScript + Vite
- native tooling UI using Dear ImGui
- shipped game UI using RmlUi
- visual effects direction using Effekseer plus engine-owned simple effect descriptors
- data direction using TOML source, FlatBuffers cooked data, and SQLite tooling databases
- terminal-first workflow with WSL2 on Windows and native Linux support
- text-first assets, procedural geometry, and assistant-friendly development surfaces

Project status:

- architecture, implementation plan, and system specs are in place
- the React shell frame, preserved code-editor search implementation, and initial shell-to-sessiond bridge are in the repo
- a minimal local `engine_sessiond` backend and `engine` CLI slice are implemented
- a native runtime scaffold, `CMake` layout, and `engine build` / `engine run sandbox` CLI path are in the repo
- the shell can now drive runtime build and runtime start/stop flows through `engine_sessiond`, with separate build and runtime log docks
- harness testing scaffolding exists for shell smoke validation, session backend validation, and local Ollama smoke checks

Key docs:

- [Direct Engine Proposal](docs/direct-engine-proposal.md)
- [Engine Implementation Plan](plans/ENGINE-IMPLEMENTATION-PLAN.md)
- [Engine Systems Index](docs/specs/ENGINE-SYSTEMS-INDEX.md)
- [Engine Harness Testing](docs/guides/ENGINE-HARNESS-TESTING.md)

Quick start:

```bash
npm run sessiond:start
npm run shell:serve
npm test
npm run test:sessiond
npm run test:runtime-scaffold
```

Runtime scaffold:

```bash
node tools/engine-cli/shaderforge.mjs build
node tools/engine-cli/shaderforge.mjs run sandbox
```

Notes:

- `cmake` is required for `engine build` / `engine run`
- if `SDL3` and `Vulkan` development packages are available, the runtime target will use them
- if they are not available, the runtime still builds in stub mode and prints a clear dependency message at launch

Unix clean start:

```bash
./scripts/start-dev-clean.sh
```

This removes generated build outputs and caches, runs the shell and sessiond harnesses, starts `engine_sessiond`, and then launches the shell dev server.

Windows clean start:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1
```

This removes generated build outputs and shell caches, runs the shell, sessiond, and runtime scaffold harnesses, starts `engine_sessiond`, and then starts the React shell through WSL.

Shell workflow notes:

- `Build` in the shell drives the runtime build lane exposed by `engine_sessiond`
- `Play` / `Stop` / `Restart` in the shell drive the native runtime lifecycle
- `Output` shows build logs and `Logs` shows runtime logs
- if `cmake` is missing, the build lane will report that directly in the shell

License:

MIT. See [LICENSE](LICENSE).
