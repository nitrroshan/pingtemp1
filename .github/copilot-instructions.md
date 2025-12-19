# Copilot Instructions for this repo

These rules orient AI coding agents to be productive in this multi-agent orchestration codebase.

## Big picture
- Runtime lives under `src/worker/` and orchestrates AI agents to collaborate on tasks.
- Key components:
  - `agentManager/AgentManager.ts`: top-level orchestrator. Plans tasks, adds them to memory, assigns to workers, and coordinates events.
  - `roleManager/RoleManager.ts`: discovers roles via a builder agent and spins up role-specific workers.
  - `agentManager/agentBuilder/*`: builder agents (ROLE, CONFIG, PLAN) that prompt LLMs to produce roles/configs/plans.
  - `AgentWorker/AgentWorker.ts`: executes tasks against a LangGraph-based agent, emits `taskComplete` events.
  - `memoryManager/MemoryManager.ts`: stores tasks, prerequisites, status, and outputs; provides ready tasks per role.
  - `agentManager/Agent.ts` + `AgentConfig.ts`: initializes a LangGraph agent using Azure OpenAI and optional MCP tools.

## Data flow and conventions
- Workflow: Role discovery → Config generation → Worker initialization → Plan generation → Tasks -> MemoryManager → Assignment to workers.
- Tasks in `MemoryManager` use:
  - `status`: one of `ready | pending | in_progress | completed | failed`
  - `assigned_role`: lowercase role key to match worker registry keys
  - `prerequisites`: `Map<string, boolean>`; tasks are ready when all are true or empty.
- Agent outputs are normalized to strings (AgentWorker returns content string via extraction logic) and stored as `output_data`.
- Threading/checkpointing: LangGraph with `MemorySaver` requires a `configurable.thread_id` on `agent.invoke`. Builders and workers must supply it.

## Builders and response formats
- Builders use createAgent/createDeepAgent behind `Agent.ts`. DeepAgents enforce `responseFormat`; if the model deviates, middleware errors arise ("Invalid response format").
- When strict schemas are set, prompts must instruct the model to return ONLY the exact JSON. If not, relax `responseFormat` or add fallback parsing.
- `AgentBuilder.runAgent` prefers `structuredResponse` and falls back to raw response; RoleManager accepts either `{ roles: [...] }` or `[...]`.

## Event-driven execution
- `AgentWorker` exposes `events: EventEmitter` and emits `taskComplete` with `{ input, result, content }`.
- `AgentManager.assignTasksToWorkers` subscribes to `taskComplete` per task, updates `MemoryManager`, and does not await execution (fire-and-forget).
- Workers are keyed by lowercase role names.

## Debugging and run targets
- VS Code debug configs are in `.vscode/launch.json`.
  - "Debug AgentManager" runs TypeScript using `tsx` or `ts-node/esm` depending on setup.
- To build worker code:
  - From `src/worker/`: `npm run build` (tsc)
- Common pitfalls:
  - Missing `thread_id` in invoke ⇒ checkpoint errors. Always pass `{ configurable: { thread_id } }`.
  - Role/worker key mismatch ⇒ use lowercase for `assigned_role` and worker registry.
  - Strict response schemas ⇒ either tighten prompts or relax `responseFormat`.

## External integrations
- Azure OpenAI via `@langchain/openai` with env vars:
  - `AZURE_OPENAI_ENDPOINT_URL`, `AZURE_OPENAI_API_KEY`, `azureOpenAIApiDeploymentName`, `azureOpenAIApiVersion`.
- MCP tools via `@langchain/mcp-adapters` (MultiServerMCPClient). Tools are appended to agent config.
- LangGraph checkpointing via `@langchain/langgraph` `MemorySaver`.

## Patterns to follow when adding features
- New role/task flows:
  - Add tasks to `MemoryManager` with lowercase `assigned_role`; wire prerequisites if needed.
  - Subscribe to `AgentWorker.events` for non-blocking updates; remove listeners after completion.
- Builder changes:
  - If adding/adjusting schemas, ensure prompts return strict JSON and keep `runAgent` tolerant (structuredResponse or raw).
- Concurrency:
  - Per-worker concurrency is serialized via `TaskQueue`. For parallelism, spawn multiple workers or ensure unique `thread_id`s and safe agent state.

## Key files
- `src/worker/agentManager/agentManager.ts`: orchestrator (planning, assignment, event subscribers).
- `src/worker/roleManager/RoleManager.ts`: role discovery and worker registry.
- `src/worker/AgentWorker/AgentWorker.ts`: invocation, event emission, message handling.
- `src/worker/memoryManager/MemoryManager.ts`: task lifecycle and readiness checks.
- `src/worker/agentManager/agentBuilder/AgentBuilder.ts`: unified builder interface with `runAgent`.

If anything feels ambiguous (e.g., exact responseFormat expected for builders, or desired concurrency model), flag it and propose a small code patch aligning prompts, schemas, and invoke configs.
