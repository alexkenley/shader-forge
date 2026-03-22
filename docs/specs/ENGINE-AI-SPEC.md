# Engine AI Spec

## Purpose

The AI subsystem provides a reusable engine-level integration layer for external and local language-model providers.

It exists to support:

- dialogue and conversation systems
- high-level NPC and director-style decisions
- quest, lore, and social interactions
- assistant-friendly game tooling and test surfaces

It should not turn remote model output into the only source of core gameplay behavior.

## Design Position

Shader Forge should treat AI as a reusable engine service, not as a reusable game design.

Rules:

- the engine owns provider adapters, request lifecycles, budgets, caching, and structured outputs
- each game owns prompts, personas, tools, memory rules, and AI-facing gameplay policies
- deterministic systems such as combat resolution, movement, pathfinding, physics, and authoritative world mutation remain engine/game code, not raw model output

## Supported Provider Model

The subsystem should support multiple providers behind a common interface.

Initial provider targets:

- OpenAI
- Anthropic
- Gemini
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
- the engine must support rate limits, spend caps, per-feature budgets, and provider allowlists
- game projects must be able to disable external AI completely

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

## Tools And Action Bridge

The subsystem should expose tool-style integrations for game logic.

Examples:

- `query_nearby_entities`
- `query_npc_memory`
- `query_inventory`
- `request_navigation_target`
- `request_interaction`
- `commit_dialogue_choice`

Games should explicitly choose which tools are exposed to each AI-driven role.

## Authoring Model

The engine should define reusable AI-facing asset patterns, while keeping project behavior game-specific.

Suggested data locations:

- `ai/providers.toml`
- `ai/personas/*.toml`
- `ai/prompts/*.toml`
- `ai/tools/*.toml`
- `ai/policies/*.toml`

Runtime-ready forms can be cooked into FlatBuffers alongside other engine data.

## Shell And CLI Surfaces

Expected shell surfaces:

- provider status
- budget/usage panel
- prompt and schema inspection
- request log viewer
- local model/Ollama connection status

Expected CLI surfaces:

- `engine ai providers`
- `engine ai test`
- `engine ai request`
- `engine ai budgets`

## Sessiond Integration

`engine_sessiond` should eventually expose:

- provider availability
- AI job submission and cancellation
- AI request/event log streaming
- local-model health checks
- optional secure key-management hooks for local desktop workflows

## Harness Requirements

The AI subsystem needs both deterministic and optional real-provider lanes.

Deterministic lane:

- fake provider harness for schema validation, queueing, timeout handling, retries, and fallback behavior

Optional real lanes:

- local Ollama smoke harness
- provider-specific smoke harnesses gated by environment configuration

## Non-Goals

- making remote AI mandatory for all games
- making model output authoritative over low-level gameplay
- baking one universal NPC prompt system into the engine
- forcing player API keys as the main product model
