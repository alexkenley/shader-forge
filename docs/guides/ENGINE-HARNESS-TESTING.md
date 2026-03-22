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
| `scripts/test-ollama-smoke.mjs` | Resolves a reachable Ollama endpoint, optionally autostarts local WSL Ollama, and performs a minimal OpenAI-compatible chat completion smoke test | real local-model |

## Current Commands

```bash
npm test
node scripts/test-engine-shell-smoke.mjs
HARNESS_OLLAMA_MODEL=<your-model> node scripts/test-ollama-smoke.mjs
node scripts/test-ollama-smoke.mjs --list-candidates
node scripts/serve-engine-shell.mjs
```

Windows clean-start path:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1
```

This script is the preferred Windows entrypoint while the team is developing through WSL2. It removes generated outputs, reruns the deterministic shell smoke harness, and then starts the shell dev server inside WSL.

## WSL And Windows-Hosted Ollama

The primary development workflow is Windows + WSL2, so the harness rules assume that local model hosting may be split across environments.

- `127.0.0.1:11434` inside WSL may not reach an Ollama instance bound on Windows
- if `HARNESS_OLLAMA_BASE_URL` is not set, the harness probes loopback plus the WSL host IP path from `/etc/resolv.conf`
- if a loopback endpoint is selected and `ollama` is installed in WSL, the harness can autostart `ollama serve`
- disable autostart with `HARNESS_AUTOSTART_LOCAL_OLLAMA=0`

## Future Harnesses

These should be added as implementation reaches the relevant phase:

- `scripts/test-engine-sessiond.mjs`
- `scripts/test-engine-cli.mjs`
- `scripts/test-engine-runtime-smoke.mjs`
- `scripts/test-engine-viewer-bridge.mjs`
- `scripts/test-engine-shell-ui.mjs`
- `scripts/test-engine-migration-fixtures.mjs`
- `scripts/test-engine-ai-service.mjs`
- `scripts/test-engine-ai-bridge.mjs`
