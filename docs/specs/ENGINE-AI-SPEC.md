# Engine AI Spec

## Purpose

The AI subsystem provides a reusable engine-level integration layer for external and local language-model providers.

It exists to support:

- dialogue and conversation systems
- high-level NPC and director-style decisions
- quest, lore, and social interactions
- game-facing AI tooling and deterministic provider test surfaces

It should not turn remote model output into the only source of core gameplay behavior.

## Design Position

Shader Forge should treat AI as a reusable engine service, not as a reusable game design.

Rules:

- the engine owns provider adapters, request lifecycles, budgets, caching, and structured outputs
- each game owns prompts, personas, tools, skills, memory rules, and AI-facing gameplay policies
- deterministic systems such as combat resolution, movement, pathfinding, physics, and authoritative world mutation remain engine/game code, not raw model output

Development agents and game-facing AI are separate products:

- external development agents such as Codex and Grok own their models, prompts, and conversation UI, and operate Shader Forge through `sf-mcp`
- this subsystem owns optional game-facing dialogue, director, and other shipped runtime AI behaviors

They may call the same engine-owned operations, but development agents do not depend on this provider core and Shader Forge does not host a built-in development assistant.

## Supported Provider Model

The subsystem should support multiple providers behind a common interface.

Initial provider targets:

- OpenAI
- Anthropic
- Gemini
- OpenRouter
- OpenAI-compatible endpoints
- local model endpoints such as Ollama

## Deployment Modes

The subsystem should support three deployment modes:

- `LocalOnly`
  - local endpoint such as Ollama
  - good for privacy, modding, offline development, and low-cost experimentation
- `DeveloperHosted`
  - the game or studio backend owns provider credentials
  - preferred model for mainstream shipped titles
- `BringYourOwnKey`
  - advanced opt-in desktop mode
  - player provides their own key for a supported provider
  - not the default for consumer gameplay

## Security Model

Rules:

- player-supplied API keys are an advanced optional feature, not the default architecture
- browser shell code should not become the primary storage location for provider secrets
- provider secrets should flow through local secure storage hooks or trusted backend surfaces
- remote provider adapters must pin credential names and trusted endpoints rather than allowing a workspace manifest to redirect arbitrary environment secrets
- provider responses must be bounded before JSON materialization
- unknown provider types and explicitly requested provider IDs must fail closed rather than silently becoming or falling back to the fake provider
- the engine must support rate limits, spend caps, per-feature budgets, and provider allowlists
- game projects must be able to disable external AI completely
- assistant-triggered compile, load, hot reload, install, or apply actions must pass through explicit engine permission and code-trust policy surfaces

## Core Architecture

Recommended modules:

- `engine_ai`
  - core orchestration layer
- `engine_ai_provider_openai`
- `engine_ai_provider_anthropic`
- `engine_ai_provider_gemini`
- `engine_ai_provider_openai_compatible`
- `engine_ai_memory`
- `engine_ai_action_schema`
- `engine_ai_budget_policy`
- `engine_ai_cache`
- `engine_ai_tool_registry`
- `engine_ai_skill_registry`
- `engine_ai_client_cli`
- `engine_ai_client_runtime`

## Request Lifecycle

The AI layer should be asynchronous and explicit.

Required behavior:

- queue requests instead of blocking frame-critical systems
- support cancellation, timeout, retry, and fallback rules
- emit structured status and error events
- cache safe repeatable results where useful
- record request metadata for debugging and budgeting

## Gameplay Integration Model

Preferred AI use cases:

- dialogue generation
- reactive NPC speech
- high-level goal selection
- quest flavor and narration
- social simulation
- turn-level tactical suggestions
- game-director style pacing decisions

Avoid making these depend directly on external AI:

- movement authority
- hit detection
- combat resolution
- replication authority
- physics
- frame-critical animation logic

## Structured Output Model

Game-facing AI should produce constrained structured outputs rather than unconstrained world mutation.

Examples:

- `speak`
- `set_goal`
- `request_action`
- `choose_dialogue_branch`
- `set_emotion_state`
- `spawn_story_event`

The game or engine must validate and apply these outputs through deterministic code.

## Tools, Skills, And Action Bridge

The AI subsystem should use both tools and skills.

Definitions:

- `tools`
  - deterministic engine operations with explicit schemas, permissions, and return shapes
- `skills`
  - reusable higher-level workflows that orchestrate tools, prompts, validation rules, and step ordering

Rules:

- tools own capability
- skills own workflow
- tools and text assets remain the source of truth, not skill-local hidden state
- game-facing AI roles may share engine-owned tool and skill registries where practical
- skills may compose tools, but they should not bypass engine permission and validation layers

Recommended tool categories:

- scene and prefab editing
- audio playback and routing control
- animation graph and clip editing
- runtime inspection and diagnostics
- build, package, import, and bake flows
- project and asset queries

For level-authoring workflows, the subsystem should prefer explicit scene-bridge style tools over opaque editor-only mutation.

Examples:

- `dump_scene_region`
- `apply_scene_patch`
- `spawn_prefab_batch`
- `query_scene_references`

Recommended skill categories:

- project setup and configuration
- gameplay feature scaffolding
- scene blockout and authoring flows
- audio and animation wiring flows
- packaging and diagnostics workflows
- domain-specific assistant behaviors for particular game genres or project types

The subsystem should expose tool-style integrations for game logic.

Examples:

- `query_nearby_entities`
- `query_npc_memory`
- `query_inventory`
- `request_navigation_target`
- `request_interaction`
- `commit_dialogue_choice`

Games should explicitly choose which tools are exposed to each AI-driven role.

Examples of external-agent workflows exposed through `sf-mcp` rather than hosted by this subsystem:

- `setup_third_person_controller`
- `wire_animation_events_to_audio`
- `create_pause_menu`
- `package_windows_playtest_build`
- `blockout_combat_arena`

These workflows should operate against structured scene and prefab data so external agents, shell tools, CLI commands, and the runtime converge on the same source of truth.

## Authoring Model

The engine should define reusable AI-facing asset patterns, while keeping project behavior game-specific.

Suggested data locations:

- `ai/providers.toml`
- `ai/personas/*.toml`
- `ai/prompts/*.toml`
- `ai/tools/*.toml`
- `ai/skills/*.toml`
- `ai/policies/*.toml`

Runtime-ready forms can be cooked into FlatBuffers alongside other engine data.

Tool and skill assets should be able to declare:

- capability names
- input/output schemas
- allowed clients
- permission level
- dry-run support
- undo/apply behavior where relevant
- dependency on other tools or skills

## Tooling And CLI Surfaces

The main editor does not host provider selection, prompts, chat, token controls, or a general-purpose development assistant. Project diagnostics may report whether game-facing AI configuration is healthy, but provider setup and smoke testing remain CLI/backend concerns.

Expected CLI surfaces:

- `engine ai providers`
- `engine ai test`
- `engine ai request`
- `engine ai budgets`
- `engine ai tools`
- `engine ai skills`

## Current Phase 5.9 Checkpoint

The first implemented Phase 5.9 slice is the provider/status/test foundation.

Current implemented behavior:

- `ai/providers.toml` is now the source-controlled provider manifest for workspace or repo-root AI configuration
- provider manifests currently support deterministic `fake`, optional `ollama`, a real `openrouter` BYOK adapter, and reserved hosted-provider entries for `openai`, `anthropic`, `gemini`, and `openai_compatible`
- `tools/shared/engine-ai-service.mjs` now provides shared manifest loading, provider normalization, provider inspection, and smoke-test execution for game-facing AI configuration
- the deterministic `fake` provider is the current offline and harness-safe default so Phase 5.9 work does not depend on a live model endpoint
- the optional Ollama lane now probes `/api/tags`, selects an installed model when possible, and can issue a basic `/v1/chat/completions` smoke test against a reachable local endpoint
- disabled-by-default `openrouter_kimi` and `openrouter_glm` entries target `moonshotai/kimi-k3` and `z-ai/glm-5.2` through the same adapter and use only `OPENROUTER_API_KEY`
- OpenRouter requests use its fixed official HTTPS API root, bearer authentication, the existing chat-completions payload, and a 1 MiB response limit; only the deterministic harness can opt into a loopback endpoint
- real chat requests carry a manifest-backed `max_output_tokens` ceiling (default 256); OpenRouter requires an integer from 1 through 4096 before becoming ready
- `[request]` policy can opt into zero through two retries and up to two explicit fallback provider IDs; the bundled defaults perform no retry or fallback
- only transient network failures and HTTP 408/425/429/500/502/503/504 responses retry or fall back, using a bounded 100 ms retry delay; cancellation and configuration, authentication, other 4xx, malformed, empty, or oversized responses fail immediately
- successful results report attempt count, whether fallback was used, and the attempted provider IDs without exposing provider error bodies; explicitly requested unknown providers still fail before fallback
- real provider results normalize prompt, completion, and total token usage when the provider returns valid non-negative integer counts; deterministic fake results report no fabricated usage
- unknown manifest provider types report `invalid`, and an explicit unknown `--provider` selection fails instead of falling back
- other hosted-provider types remain inspection-only, with deployment mode plus required `api_key_env` diagnostics
- `engine_sessiond` now exposes `GET /api/ai/providers` and `POST /api/ai/test` for workspace-backed provider inspection and smoke testing
- `engine_sessiond` also exposes bounded process-scoped AI jobs through collection `POST`/`GET` plus per-job `GET`/`DELETE`; one request runs at a time, list responses omit result bodies, queued and active jobs can be cancelled, provider sockets receive abort signals, and `ai.job` lifecycle events use the existing SSE stream without including prompts or response content
- terminal queued jobs atomically enter a bounded 128-record workspace history under `.shader-forge/ai-history.json`; records retain lifecycle/provider/token metadata but exclude prompts, system prompts, responses, raw errors, and credentials
- `GET /api/ai/history` and `engine ai history` expose bounded terminal-history reads with status and limit filters; the live queue itself remains process-scoped and is not resumed after restart
- successful queued calls with provider-reported usage atomically accumulate request, prompt-token, completion-token, and total-token counts per workspace and provider under `.shader-forge/ai-usage.json`; direct smoke tests and requests do not change this ledger
- `GET /api/ai/usage` and `engine ai usage` expose the read-only workspace summary without prompts, response bodies, or credentials
- the main shell intentionally has no provider picker, prompt, chat, or smoke-test surface; live diagnostics may include a bounded game-AI readiness summary
- the CLI now exposes direct `engine ai providers|test|request`, queued `submit|jobs|status|cancel`, and read-only `history|usage` commands
- deterministic coverage now exists through `npm run test:ai-scaffold`

Still ahead in Phase 5.9:

- resumable queued jobs beyond the current process-scoped queue, bounded retry/fallback, cancellation, timeout, status, event lifecycle, and terminal metadata history
- budget enforcement, spend limits, pricing, and request logging beyond the current per-request output ceiling and durable token-usage evidence
- additional hosted-provider adapters and secure key storage beyond the current environment-backed OpenRouter BYOK lane
- game-facing tool registry, skill registry, and structured action schemas
- gameplay-facing AI integrations

External development agents use `sf-mcp` and the engine operation/code-trust boundary. They never receive implicit compile, hot-reload, plugin-install, apply, or filesystem authority from this subsystem.

## Sessiond Integration

`engine_sessiond` should eventually expose:

- provider availability
- durable AI job submission and cancellation beyond the current process-scoped queue
- durable AI request/event logging beyond the current metadata-only `ai.job` SSE events
- local-model health checks
- optional secure key-management hooks for local desktop workflows
- game-facing tool discovery and invocation surfaces for runtime clients
- game-facing skill discovery and execution surfaces for runtime clients

## Harness Requirements

The AI subsystem needs both deterministic and optional real-provider lanes.

Deterministic lane:

- fake provider harness for schema validation, queueing, timeout handling, retries, and fallback behavior
- tool-registry harness for permission, schema, dry-run, and invocation behavior
- skill-registry harness for workflow orchestration and validation behavior

Optional real lanes:

- local Ollama smoke harness
- OpenRouter Kimi/GLM smoke harness gated by `OPENROUTER_API_KEY`
- provider-specific smoke harnesses gated by environment configuration

## Non-Goals

- making remote AI mandatory for all games
- making model output authoritative over low-level gameplay
- baking one universal NPC prompt system into the engine
- forcing player API keys as the main product model
- hosting a built-in development assistant or provider UI in the main editor
- replacing external-agent MCP integration with an engine-owned chat client
