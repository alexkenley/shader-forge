# Engine Harness Testing

Date: 2026-03-22

## Purpose

The engine should use self-contained black-box harnesses for the shell, backend surfaces, and future AI/runtime integration points.

Rules:

- deterministic harness lanes are the default regression baseline
- optional real local-model lanes are used for smoke validation, not as the only test path
- harnesses should start what they need, assert real behavior, and clean up after themselves

## Current Harnesses

| Script | Purpose | Lane |
| --- | --- | --- |
| `scripts/test-engine-shell-smoke.mjs` | Serves `shell/engine-shell/web`, validates the shell assets load, and verifies the preserved inline file search is still present in the code editor module and CSS | deterministic |
| `scripts/test-engine-sessiond.mjs` | Starts the local backend in-process, creates a project session, and validates safe file list/read behavior over HTTP | deterministic |
| `scripts/test-engine-viewer-bridge.mjs` | Starts the local backend in-process, validates viewer-bridge SSE/runtime/build flows, and checks the shell bridge surfaces remain present | deterministic |
| `scripts/test-engine-input-scaffold.mjs` | Validates the native input subsystem sources plus text-backed action/context assets and runs a fallback syntax-only compile | deterministic |
| `scripts/test-ollama-smoke.mjs` | Resolves a reachable Ollama endpoint, optionally autostarts local WSL Ollama, and performs a minimal OpenAI-compatible chat completion smoke test | real local-model |

## Current Commands

```bash
npm test
node scripts/test-engine-shell-smoke.mjs
node scripts/test-engine-sessiond.mjs
node scripts/test-engine-viewer-bridge.mjs
node scripts/test-engine-input-scaffold.mjs
HARNESS_OLLAMA_MODEL=<your-model> node scripts/test-ollama-smoke.mjs
node scripts/test-ollama-smoke.mjs --list-candidates
node scripts/serve-engine-shell.mjs
```

Windows clean-start path:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1
```

Unix/WSL clean-start path:

```bash
./scripts/start-dev-clean.sh
```

These scripts are the preferred dev entrypoints while the stack is still shell-first. They remove generated outputs, rerun the deterministic shell, sessiond, viewer-bridge, input-scaffold, and runtime-scaffold harnesses, start `engine_sessiond`, and then start the shell dev server.

## WSL And Windows-Hosted Ollama

The primary development workflow is Windows + WSL2, so the harness rules assume that local model hosting may be split across environments.

- `127.0.0.1:11434` inside WSL may not reach an Ollama instance bound on Windows
- if `HARNESS_OLLAMA_BASE_URL` is not set, the harness probes loopback plus the WSL host IP path from `/etc/resolv.conf`
- if a loopback endpoint is selected and `ollama` is installed in WSL, the harness can autostart `ollama serve`
- disable autostart with `HARNESS_AUTOSTART_LOCAL_OLLAMA=0`

## Future Harnesses

These should be added as implementation reaches the relevant phase:

- `scripts/test-engine-cli.mjs`
- `scripts/test-engine-runtime-smoke.mjs`
- `scripts/test-engine-shell-ui.mjs`
- `scripts/test-engine-migration-fixtures.mjs`
- `scripts/test-engine-ai-service.mjs`
- `scripts/test-engine-ai-bridge.mjs`
