# Engine AI Spec

## Purpose

The AI subsystem provides a reusable engine-level integration layer for external and local language-model providers.

It exists to support:

- dialogue and conversation systems
- high-level NPC and director-style decisions
- quest, lore, and social interactions
- assistant-friendly game tooling and test surfaces
- native developer-assistant surfaces in the shell, CLI, and future in-engine tools

It should not turn remote model output into the only source of core gameplay behavior.

## Design Position

Shader Forge should treat AI as a reusable engine service, not as a reusable game design.

Rules:

- the engine owns provider adapters, request lifecycles, budgets, caching, and structured outputs
- each game owns prompts, personas, tools, skills, memory rules, and AI-facing gameplay policies
- deterministic systems such as combat resolution, movement, pathfinding, physics, and authoritative world mutation remain engine/game code, not raw model output

The engine should support both:

- developer-assistant surfaces
  - shell, CLI, and native in-engine tool assistants for editing, inspection, testing, and workflow automation
- game-facing AI surfaces
  - dialogue, director, and other shipped gameplay-facing AI behaviors

These should share the same provider core, policy controls, and structured tool architecture where practical.

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
- `engine_ai_tool_registry`
- `engine_ai_skill_registry`
- `engine_ai_client_shell`
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
- terminal, shell, and native in-engine assistants should share the same underlying tool and skill registries where practical
- skills may compose tools, but they should not bypass engine permission and validation layers

Recommended tool categories:

- scene and prefab editing
- audio playback and routing control
- animation graph and clip editing
- runtime inspection and diagnostics
- build, package, import, and bake flows
- project and asset queries

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

Examples of developer-assistant skills:

- `setup_third_person_controller`
- `wire_animation_events_to_audio`
- `create_pause_menu`
- `package_windows_playtest_build`
- `blockout_combat_arena`

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
- `engine ai tools`
- `engine ai skills`

Expected native in-engine assistant surfaces:

- runtime-aware assistant panel
- structured tool calls for scene, animation, audio, and runtime inspection/edit workflows
- context-aware capability/skill routing for engine-native tasks

The terminal coding assistant and the native in-engine assistant should be complementary, not mutually exclusive:

- terminal/CLI assistant is best for repo-wide code, files, build, and test work
- native in-engine assistant is best for structured engine-editing, runtime inspection, and tool-driven asset workflows
- both should use the same underlying provider and policy layer where possible

This implies a shared architecture:

1. provider and policy core
2. tool registry
3. skill registry
4. client-specific surfaces

The clients should differ mainly in context, permissions, and UI, not in fundamental AI capability definitions.

## Sessiond Integration

`engine_sessiond` should eventually expose:

- provider availability
- AI job submission and cancellation
- AI request/event log streaming
- local-model health checks
- optional secure key-management hooks for local desktop workflows
- tool discovery and invocation surfaces for shell and runtime clients
- skill discovery and execution surfaces for shell and runtime clients

## Harness Requirements

The AI subsystem needs both deterministic and optional real-provider lanes.

Deterministic lane:

- fake provider harness for schema validation, queueing, timeout handling, retries, and fallback behavior
- tool-registry harness for permission, schema, dry-run, and invocation behavior
- skill-registry harness for workflow orchestration and validation behavior

Optional real lanes:

- local Ollama smoke harness
- provider-specific smoke harnesses gated by environment configuration

## Non-Goals

- making remote AI mandatory for all games
- making model output authoritative over low-level gameplay
- baking one universal NPC prompt system into the engine
- forcing player API keys as the main product model
