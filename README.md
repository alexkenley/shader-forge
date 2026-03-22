# Shader Forge

Shader Forge is a code-first, AI-native game engine project focused on building games directly against native runtime systems rather than on top of middleware editors.

Current direction:

- native C++ runtime with a Vulkan-first renderer
- browser-based developer shell for editing, runtime control, and inspection
- terminal-first workflow with WSL2 on Windows and native Linux support
- text-first assets, procedural geometry, and assistant-friendly development surfaces

Project status:

- architecture, implementation plan, and system specs are in place
- the shell scaffold and preserved code-editor search implementation are in the repo
- harness testing scaffolding exists for shell smoke validation and local Ollama smoke checks

Key docs:

- [Direct Engine Proposal](docs/direct-engine-proposal.md)
- [Engine Implementation Plan](plans/ENGINE-IMPLEMENTATION-PLAN.md)
- [Engine Systems Index](docs/specs/ENGINE-SYSTEMS-INDEX.md)
- [Engine Harness Testing](docs/guides/ENGINE-HARNESS-TESTING.md)

Quick start:

```bash
npm run shell:serve
npm test
```

License:

MIT. See [LICENSE](LICENSE).

