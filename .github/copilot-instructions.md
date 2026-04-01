# Copilot Instructions for this repo

These rules orient AI coding agents to be productive in this multi-agent orchestration codebase.

## Big picture
- Runtime lives under `src/worker/` and orchestrates AI agents to collaborate on tasks.
- Frontend lives under `src/AgentChat/` - React+TypeScript UI for interacting with agents.
- Key backend components:
  - `agentManager/AgentManager.ts`: top-level orchestrator. Plans tasks, adds them to memory, assigns to workers, and coordinates events.
  - `roleManager/RoleManager.ts`: discovers roles via a builder agent and spins up role-specific workers.
  - `agentManager/agentBuilder/*`: builder agents (ROLE, CONFIG, PLAN) that prompt LLMs to produce roles/configs/plans.
  - `AgentWorker/AgentWorker.ts`: executes tasks against a LangGraph-based agent, emits events via EventEmitter.
  - `memoryManager/MemoryManager.ts`: stores tasks, prerequisites, status, and outputs; provides ready tasks per role.
  - `agentManager/Agent.ts`: initializes a LangGraph agent using Azure OpenAI and optional MCP tools.
  - `api/`: HTTP and WebSocket servers for frontend communication.

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
- Workflow: Role discovery → Config generation → Worker initialization → Plan generation → Tasks -> MemoryManager → Assignment to workers.
- Tasks in `MemoryManager` use:
  - `status`: one of `ready | pending | in_progress | completed | failed`
  - `assigned_role`: lowercase role key to match worker registry keys
  - `prerequisites`: `Map<string, boolean>`; tasks are ready when all are true or empty.
- Agent outputs are normalized to strings (AgentWorker returns content string via extraction logic) and stored as `output_data`.
- Threading/checkpointing: LangGraph with `MemorySaver` requires a `configurable.thread_id` on `agent.invoke`. Builders and workers must supply it.

## AgentWorker Details
- Implements `IAgentWorker<TInput, TOutput>` interface.
- Uses `TaskQueue` to serialize task execution per worker.
- Emits events via `EventEmitter`:
  - `message`: Real-time updates during task execution with `{ thread_id, role, content, timestamp }`.
  - `taskUpdate`: Task completion events (currently commented out).
- `execute(input)`: Main entry point for task execution. Initializes agent, enqueues task.
- `callAgent(input, thread_id)`: Invokes LangGraph agent with messages, handles errors.
- Messages are stored in `this.messages` array for conversation continuity.
- Workspace support (currently commented out) for git-based agent workflows.

## Frontend (AgentChat)
- **Location**: `src/AgentChat/`
- **Framework**: React 18 + TypeScript + Vite
- **Key Services**:
  - `AgentManagerService`: Unified service combining Socket.IO and HTTP communication
  - `SocketService`: Real-time agent message streaming
  - `HttpService`: REST API calls for teams, roles, workflows
- **State Management**: React hooks (useState, useEffect)
- **Key Components**:
  - `App.tsx`: Main orchestration, connects to backend, manages agents/teams
  - `Sidebar`: Agent/team navigation
  - `ChatArea`: Message display and input
  - `AgentManagerPanel`: Shows active orchestration agents and logs
  - `AgentModal`: Create agents/workflows
- **Types** (`types.ts`):
  - `Agent`, `Message`, `Task`, `ChatSession`
  - `ActiveAgentState`: For orchestration panel
  - `OrchestrationEvent`: Logs for agent activities
- **Communication**:
  - WebSocket for real-time agent responses
  - HTTP for CRUD operations (teams, roles, workflows)
  - Subscribes to specific agents via `subscribeToAgent(agentRole)`

## Builders and response formats
- Builders use createAgent/createDeepAgent behind `Agent.ts`. DeepAgents enforce `responseFormat`; if the model deviates, middleware errors arise ("Invalid response format").
- When strict schemas are set, prompts must instruct the model to return ONLY the exact JSON. If not, relax `responseFormat` or add fallback parsing.
- `AgentBuilder.runAgent` prefers `structuredResponse` and falls back to raw response; RoleManager accepts either `{ roles: [...] }` or `[...]`.

## Event-driven execution
- `AgentWorker` exposes `events: EventEmitter` and emits:
  - `message` events for real-time updates during execution.
  - `taskUpdate` events (currently commented) for task completion.
- `AgentManager.assignTasksToWorkers` can subscribe to worker events, updates `MemoryManager`.
- Workers are keyed by lowercase role names.
- Frontend listens to Socket.IO events: `agent:message`, `agent:error`, `orchestration:*`.

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
- VS Code debug configs are in `.vscode/launch.json`.
  - "Debug AgentManager" runs TypeScript using `tsx` or `ts-node/esm` depending on setup.
- To build worker code:
  - From `src/worker/`: `npm run build` (tsc)
- To run frontend:
  - From `src/AgentChat/`: `npm run dev` (Vite dev server)
- Common pitfalls:
  - Missing `thread_id` in invoke ⇒ checkpoint errors. Always pass `{ configurable: { thread_id } }`.
  - Role/worker key mismatch ⇒ use lowercase for `assigned_role` and worker registry.
  - Strict response schemas ⇒ either tighten prompts or relax `responseFormat`.
  - WebSocket not connected ⇒ check `agentManagerService.connect()` in frontend.

## External integrations
- Azure OpenAI via `@langchain/openai` with env vars:
  - `AZURE_OPENAI_ENDPOINT_URL`, `AZURE_OPENAI_API_KEY`, `azureOpenAIApiDeploymentName`, `azureOpenAIApiVersion`.
- MCP tools via `@langchain/mcp-adapters` (MultiServerMCPClient). Tools are appended to agent config.
- LangGraph checkpointing via `@langchain/langgraph` `MemorySaver`.
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
  - Subscribe to `AgentWorker.events` for non-blocking updates; remove listeners after completion.
- **Builder changes**:
  - If adding/adjusting schemas, ensure prompts return strict JSON and keep `runAgent` tolerant (structuredResponse or raw).
- **Type definitions**:
  - Add new types to appropriate `types/` folder
  - Export from `index.ts` barrel file
  - Update documentation in type file's README.md
- **Frontend changes**:
  - Update types in `src/AgentChat/types.ts`
  - Use `AgentManagerService` for all backend communication
  - Subscribe/unsubscribe from Socket.IO events properly in useEffect cleanup
- **Concurrency**:
  - Per-worker concurrency is serialized via `TaskQueue`. For parallelism, spawn multiple workers or ensure unique `thread_id`s and safe agent state.

## Key files
**Backend:**
- `src/worker/agentManager/agentManager.ts`: orchestrator (planning, assignment, event subscribers).
- `src/worker/roleManager/RoleManager.ts`: role discovery and worker registry.
- `src/worker/AgentWorker/AgentWorker.ts`: invocation, event emission, message handling.
- `src/worker/memoryManager/MemoryManager.ts`: task lifecycle and readiness checks.
- `src/worker/agentManager/agentBuilder/AgentBuilder.ts`: unified builder interface with `runAgent`.
- `src/worker/api/SocketServer.ts`: WebSocket server for real-time communication.
- `src/worker/api/HttpServer.ts`: REST API endpoints.
- All type files: `*/types/index.ts` for centralized type exports.

**Frontend:**
- `src/AgentChat/App.tsx`: main application component.
- `src/AgentChat/services/AgentManagerService.ts`: unified backend communication.
- `src/AgentChat/types.ts`: frontend type definitions.
- `src/AgentChat/components/`: UI components for chat, sidebar, panels.

If anything feels ambiguous (e.g., exact responseFormat expected for builders, or desired concurrency model), flag it and propose a small code patch aligning prompts, schemas, and invoke configs.

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
