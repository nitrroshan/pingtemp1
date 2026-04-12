# Copilot Instructions for this repo

These rules orient AI coding agents to be productive in this multi-agent orchestration codebase.

## Big picture
- **Monorepo** with 3 packages: `packages/backend/`, `packages/frontend/`, `packages/registry/`
- Backend orchestrates AI SDK-based agents to collaborate on tasks via Azure OpenAI.
- Frontend is React 19 + TypeScript + Vite with real-time streaming via Socket.IO.
- Key backend components:
  - `agentManager/AgentManagerV2.ts`: top-level orchestrator. Creates plans, assigns tasks to workers, coordinates lifecycle.
  - `orchestrator/OrchestratorService.ts`: LLM-powered planning engine with 4 tools (create_plan, approve_plan, get_status, get_context).
  - `services/WorkerPool.ts`: manages agent workers per task. Creates AiSdkAgent instances, injects tools (workspace, collab, skills), iterates execute() generator.
  - `agent/internal/AiSdkAgent.ts`: AI SDK `streamText()` agent. Yields `AgentEvent` stream (stream_part, message, done). Autonomous tool loop via `stopWhen: [isLoopFinished(), stepCountIs(200)]`. Context trimming via `prepareStep`. Extended thinking via `buildProviderOptions()`.
  - `agent/AgentFactory.ts`: creates agent instances from YAML definitions.
  - `memoryManager/MemoryManager.ts`: stores tasks, prerequisites, status, outputs. DAG-based ready-task detection.
  - `api/SocketServerV2.ts`: Socket.IO server. Broadcasts `stream` events to frontend. Declarative `WORKER_EVENT_ROUTES` map.
  - `api/HttpServer.ts`: Express REST API. V2 endpoints at `/api/v2/*`.
  - `agentManager/plugins/SkillPlugin.ts`: loads SKILL.md files from registry plugins. Team-scoped, per-role filtered via roleSkillMap.

## Type Organization
All modules now have centralized type definitions in dedicated `types/` folders:
- `agentManager/types/`: AgentConfig, Status, TeamConfig, WorkspaceConfig, TaskAssignments, WorkerRegistry
- `AgentWorker/types/`: IAgentWorker
- `memoryManager/types/`: Task, TaskStatus
- `roleManager/types/`: AgentRole
- `api/types/`: User, SocketConnection

Import types from barrel exports: `import type { AgentConfig, Status } from './types/index.js'`

Deprecated files (kept for compatibility):
- `AgentConfig.ts`, `AgentRole.ts`, `IAgentWorker.ts`, `WorkspaceConfig.ts` now re-export from types folders.

## Data flow and conventions
- Workflow: Team created → Roles discovered → Workers registered in WorkerPool → OrchestratorService handles user messages → Plan generated → Tasks added to MemoryManager → Ready tasks assigned to workers → Workers stream results.
- Tasks in `MemoryManager` use:
  - `status`: one of `ready | pending | in_progress | completed | failed`
  - `assigned_role`: lowercase role key to match worker registry keys
  - `prerequisites`: `Map<string, boolean>`; tasks are ready when all are true or empty.
- Agent runtime uses AI SDK `streamText()` with `stopWhen: [isLoopFinished(), stepCountIs(200)]` for autonomous tool execution (no artificial step limits).
- Tools are converted from LangChain format via `toAiSdkTool()` which uses `inputSchema` (AI SDK v6 property).
- Structured output uses `generateText({ output: Output.object({ schema }) })` — `generateObject` is deprecated.
- Azure OpenAI configured via `ModelProvider.ts` with `useDeploymentBasedUrls: true` and `azure.chat()` for Chat Completions API.

## Streaming Pipeline
- `AiSdkAgent.executeToolMode()` yields `AgentEvent` objects including `{ type: "stream_part", part }` events.
- WorkerPool/OrchestratorService detect `stream_part` events → emit on `worker:stream` channel.
- SocketServerV2 `worker:stream` handler → broadcasts to Socket.IO `stream` channel.
- Frontend `useOrchestration` → routes stream payloads to `processStreamPart()`.
- `useChat.processStreamPart()` builds `streamParts: RenderedPart[]` on Message objects (immutable updates for React 18 StrictMode).
- MessageList renders `<StreamMessage>` → `ToolCard`, `ReasoningSection`, `NotificationChip`.
- Legacy `worker:event` events still emit for `progress` channel (AgentManager panel). Events route through `WORKER_EVENT_ROUTES` map.
- **No internal EventEmitters for new code** — use AsyncGenerator for streaming, direct callbacks for task lifecycle. Socket.IO is the only event bus.

## Frontend
- **Location**: `packages/frontend/`
- **Framework**: React 19 + TypeScript + Vite
- **Key Services**:
  - `AgentServiceV2`: Unified service combining Socket.IO and HTTP communication
- **State Management**: React hooks (useState, useEffect, useCallback)
- **Key Hooks**:
  - `useOrchestration`: Subscribes to Socket.IO events, routes stream/message/error to callbacks
  - `useChat`: Manages chat histories, `addMessage()`, `processStreamPart()` (immutable updates)
  - `useAgentTree`: Builds sidebar tree from teams/agents
- **Key Components**:
  - `App.tsx`: Main orchestration, connects to backend, wires hooks
  - `Sidebar`: Agent/team navigation tree
  - `ChatArea`: Message display and input, typing indicator
  - `MessageList`: Renders messages, uses `StreamMessage` for streaming
  - `StreamMessage / ToolCard / ReasoningSection`: Rich stream rendering
  - `DetailPanel`: Agent info + SkillSelector in Settings tab
- **Types** (`types.ts`):
  - `Agent`, `Message`, `Task`, `ChatSession`, `RenderedPart`, `ToolCardState`
  - `StreamPart` types for all AI SDK Data Stream Protocol events
- **Communication**:
  - Socket.IO `stream` channel for real-time streaming
  - Socket.IO `progress` channel for tool/thinking notifications
  - Socket.IO `state` channel for plan/task state updates
  - HTTP for CRUD operations (teams, roles, agents, skills)

## Builders and response formats
- Builders use `AgentFactory.getBuilder()` which creates AiSdkAgent instances from YAML definitions.
- Structured output uses `generateText({ output: Output.object({ schema }) })` — `generateObject` is deprecated in AI SDK v6.
- `AgentBuilder.runAgent` prefers `structuredResponse` and falls back to raw response; RoleManager accepts either `{ roles: [...] }` or `[...]`.

## Event architecture
- **Socket.IO is the ONLY event bus** — for frontend delivery.
- Internal backend communication uses **AsyncGenerator** (streaming) and **direct callbacks** (task lifecycle).
- `AiSdkAgent.execute()` → `AsyncGenerator<AgentEvent>` — yields stream_part, message, done events.
- WorkerPool iterates the generator, forwards stream_part to SocketServerV2 via `worker:stream`.
- SocketServerV2 `WORKER_EVENT_ROUTES` map controls which legacy events go to which channels.
- **Do NOT add new EventEmitters** — see `docs/features/task-orchestration/event-refactor/` for the refactoring plan.

## API Layer
- **HTTP Server** (`api/HttpServer.ts`): Express server for REST endpoints
  - `/api/teams`, `/api/roles`, `/api/workflows`
  - Team and role management
- **Socket Server** (`api/SocketServer.ts`): Socket.IO for real-time communication
  - Handles `subscribeToAgent`, `sendMessage` events
  - Emits `agent:message`, `agent:error` to subscribed clients
- **Managers**:
  - `UserManager`: Tracks user accounts and activity (in-memory, TODO: database)
  - `SocketConnectionManager`: Manages WebSocket connections and agent subscriptions
- All API types centralized in `api/types/`

## Debugging and run targets
- Build: `bun run build:backend` (tsc + copy agents)
- Dev backend: `bun run dev:backend`
- Dev frontend: `bun run dev:frontend` (Vite HMR on port 3000)
- Seed: `bun run seed` (3 teams, 10 agents, 10 skills)
- Reset: `bun run db:reset` (drops all collections)
- Use `start.ps1` for Windows PowerShell menu (options 20-22 for dev)
- Common pitfalls:
  - Role/worker key mismatch → use lowercase for `assigned_role` and worker registry.
  - Azure API version ⇒ must match deployment. `useDeploymentBasedUrls: true` required.
  - Agent uses `isLoopFinished()` by default (autonomous mode). Set `maxSteps > 0` in config to override.
  - React double-render in StrictMode ⇒ all state updates must be immutable (no `.push()` or `obj.prop = val`).

## External integrations
- **Model Providers** — `ModelProvider.ts` supports 10 providers via `ModelConfig.provider`:
  - `azure-openai` — `@ai-sdk/azure` with `azure.chat()` + `useDeploymentBasedUrls`. Env: `AZURE_OPENAI_ENDPOINT_URL`, `AZURE_OPENAI_API_KEY`.
  - `anthropic` — `@ai-sdk/anthropic`. Env: `ANTHROPIC_API_KEY`.
  - `openai` — `@ai-sdk/openai`. Env: `OPENAI_API_KEY`.
  - `ollama` — `@ai-sdk/openai` with `baseURL: http://localhost:11434/v1`. No API key needed.
  - `google`, `groq`, `mistral`, `deepseek`, `xai` — All use `@ai-sdk/openai` with custom `baseURL`. Each needs its own `*_API_KEY` env var.
  - `openai-compatible` — Any `/v1/chat/completions` endpoint. Needs `baseUrl` in config or `OPENAI_COMPATIBLE_BASE_URL` env var.
- **Agent loop** — `AiSdkAgent` uses `streamText()` with `isLoopFinished()` (autonomous mode) + `stepCountIs(200)` safety cap. `prepareStep` trims context. Extended thinking via `buildProviderOptions()` (Anthropic thinking + OpenAI reasoningEffort).
- LangChain tools converted to AI SDK via `toAiSdkTool()` in `AiSdkAgent.ts`.
- Socket.IO for real-time frontend-backend communication.

## File Management Rules

**CRITICAL: Do NOT create new files unnecessarily**
- **Default behavior**: Update existing files instead of creating new ones
- **When user requests changes**: Search for relevant existing files first, then update them
- **Documentation updates**: Append to or modify existing docs, don't create new files for every prompt
- **File size**: No strict word/line limits - files can be large (1000+ lines) if logically coherent
- **Only create new files when**:
  - User explicitly asks for a new file
  - No relevant existing file exists for the content
  - Creating a new file follows established patterns (e.g., new feature architecture doc)
  - The content is logically distinct from all existing files

**Examples of what NOT to do:**
- ❌ Creating `summary-2026-01-15.md` for every conversation
- ❌ Creating `update-log-v2.md` when `update-log.md` exists
- ❌ Creating `notes-final.md` when you can append to `notes.md`

**Examples of correct behavior:**
- ✅ Update `docs/ping/architecture.md` when architecture changes
- ✅ Append to `docs/ping/vision.md` when vision evolves
- ✅ Modify existing feature docs instead of creating duplicates

## Do NOT Hallucinate Links or URLs

**CRITICAL: Never create fake/placeholder URLs or links**
- **Never use**: `docs.example.com`, `github.com/your-org`, `support@example.com`, `discord.gg/placeholder`
- **Instead**: Either use real URLs if they exist, OR provide template text that clearly indicates placeholders
- **For documentation/help sections**: Use actual repository paths or indicate "[To be configured]" instead of fake URLs

**Examples of what NOT to do:**
- ❌ `https://docs.ping.ai` (doesn't exist)
- ❌ `github.com/your-org/ping` (fake org)
- ❌ `discord.gg/ping` (doesn't exist)
- ❌ `support@ping.ai` (fake email)

**Examples of correct behavior:**
- ✅ `See [docs/INDEX.md](docs/INDEX.md) for documentation`
- ✅ `Report issues at: [Your GitHub repository URL - update .env]`
- ✅ `Community support: [To be configured - add Discord/Slack link]`
- ✅ Use relative paths to actual files: `[Architecture](../../ping/architecture.md)`

## Patterns to follow when adding features
- **New role/task flows**:
  - Add tasks to `MemoryManager` with lowercase `assigned_role`; wire prerequisites if needed.
  - Use direct callbacks for task lifecycle events — no EventEmitters.
- **New agent tools**:
  - Use AI SDK `tool()` from `ai` package with `inputSchema` (Zod schema).
  - For LangChain tools, wrap with `toAiSdkTool()` in AiSdkAgent.
- **Builder changes**:
  - Use `generateText({ output: Output.object({ schema }) })` for structured output.
- **Type definitions**:
  - Add new types to appropriate `types/` folder
  - Export from `index.ts` barrel file
- **Frontend changes**:
  - Update types in `packages/frontend/types.ts`
  - Use `AgentServiceV2` for all backend communication
  - All state updates must be **immutable** (React 18 StrictMode)
  - Stream events flow through `processStreamPart()` in useChat
- **Concurrency**:
  - Per-worker concurrency is serialized via `TaskQueue`. For parallelism, spawn multiple workers.

## Key files
**Backend:**
- `packages/backend/agentManager/AgentManagerV2.ts`: orchestrator (planning, assignment, lifecycle).
- `packages/backend/orchestrator/OrchestratorService.ts`: LLM-powered planner with tools.
- `packages/backend/services/WorkerPool.ts`: agent worker management, skill loading, event forwarding.
- `packages/backend/agent/internal/AiSdkAgent.ts`: AI SDK streamText agent, stream_part lifecycle.
- `packages/backend/agent/AgentFactory.ts`: creates agents from YAML definitions.
- `packages/backend/memoryManager/MemoryManager.ts`: task lifecycle and readiness checks.
- `packages/backend/api/SocketServerV2.ts`: Socket.IO server, WORKER_EVENT_ROUTES, stream broadcasting.
- `packages/backend/api/HttpServer.ts`: REST API endpoints.
- `packages/backend/agentManager/plugins/SkillPlugin.ts`: team-scoped skill loading from SKILL.md files, per-role filtering.

**Frontend:**
- `packages/frontend/App.tsx`: main application, hook wiring.
- `packages/frontend/services/AgentServiceV2.ts`: Socket.IO + HTTP communication.
- `packages/frontend/hooks/useChat.ts`: chat histories, processStreamPart(), addMessage().
- `packages/frontend/hooks/useOrchestration.ts`: Socket.IO event routing, subscribeToTeam().
- `packages/frontend/types.ts`: all frontend type definitions.
- `packages/frontend/components/StreamMessage.tsx`: rich stream rendering (text, tool cards, reasoning).

## Branching Strategy

- **`dev`** is the default working branch. All development happens here.
- **`main`** is the production branch. It is automatically synced from `dev` via GitHub Actions (`.github/workflows/sync-dev-to-main.yml`).
- **Never push directly to `main`.** All changes flow through `dev` → `main`.
- When creating feature or fix branches, **always branch from `dev`**:
  - `git checkout dev && git checkout -b feature/my-feature`
  - `git checkout dev && git checkout -b fix/my-bugfix`
- Merge feature/fix branches back into `dev` via PR.
- Do NOT create branches from `main` unless it's a production hotfix (merge hotfix into both `main` and `dev`).

## Development Workflow

See specialized instruction files in `.github/instructions/`:

**Feature Development:**
- `feature-development.instructions.md` - Overall feature workflow and folder structure
- `feature-architecture.instructions.md` - Architecture decision process
- `feature-implementation-planning.instructions.md` - Planning and versioning
- `feature-implementation.instructions.md` - Implementation tracking
- `task-management.instructions.md` - Creating tasks and linking code TODOs

**Maintenance:**
- `bug-fixes.instructions.md` - Bug documentation (100-200 word notes)
- `document-maintenance.instructions.md` - How to update and cleanup docs

**Documentation Types:**
- `product-documentation.instructions.md` - User-facing product docs (update when complete)
- `developer-guide.instructions.md` - Developer onboarding and patterns (when architecture isn't enough)
