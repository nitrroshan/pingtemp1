# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-agent orchestration platform ("Ping") that coordinates AI agents to collaborate on tasks. The backend runtime orchestrates AI SDK-based agents via Azure OpenAI, while the frontend provides a React chat UI with real-time streaming via WebSocket.

## Build & Development Commands

```bash
# Install all dependencies (Bun workspaces — single command)
bun install

# Backend (compiles TypeScript, copies YAML agent definitions)
bun run build:backend                 # or: cd packages/backend && bun run build

# Run backend (after building)
bun run dev:backend                   # builds then starts on port 3002

# Run frontend (Vite dev server on port 3000)
bun run dev:frontend                  # or: cd packages/frontend && bun run dev

# Type checking only (no emit)
cd packages/backend && bun run typecheck

# Run tests
bun run test                          # all packages

# Backend-specific scripts (from packages/backend/)
bun run test:workspace                # workspace E2E tests

# MongoDB via Docker
bun run mongo:start                   # start container on port 27017
bun run mongo:stop / bun run mongo:rm # stop/remove container

# Dev seeding & reset
bun run seed                          # seed 3 teams, 10 agents, 10 skills
bun run db:reset                      # drop all collections (with confirmation)
```

## Architecture

### Bun Monorepo with 3 Packages

- **Backend** (`packages/backend/`): Node.js + TypeScript, ES modules. Entry point: `server.ts` -> `api/AgentManagerAPI.ts`. Runs on port 3002.
- **Frontend** (`packages/frontend/`): React 19 + TypeScript + Vite. Entry point: `index.tsx` -> `App.tsx`. Runs on port 3000.
- **Registry** (`packages/registry/`): Agent registry service. Entry point: `index.ts`. Standalone Express server.

Each has its own `package.json` and `tsconfig.json`. The root `tsconfig.json` provides shared base config. Bun workspaces handle dependency hoisting.

### Backend Core Components

- **`agentManager/AgentManagerV2.ts`** - Top-level orchestrator. Plans tasks, assigns to workers, coordinates events. This is the current implementation (V1 is deprecated).
- **`memoryManager/MemoryManager.ts`** - Task lifecycle: stores tasks, tracks prerequisites (Map<string, boolean>), determines readiness, manages shared context.
- **`orchestrator/OrchestratorService.ts`** - LLM-powered planning engine with tools (createPlan, approvePlan, getContext, getStatus).
- **`api/AgentManagerAPI.ts`** - Unified entry point that initializes HttpServer (Express) and SocketServerV2 (Socket.IO).
- **`api/HttpServer.ts`** - REST endpoints: `/api/v2/*` (current), `/api/*` (legacy), `/api-docs` (Swagger).
- **`api/SocketServerV2.ts`** - Real-time WebSocket communication (preferred over V1).

### Data Flow

```
User goal -> AgentManager -> RoleManager discovers roles -> Workers initialized
-> Plan generated -> Tasks added to MemoryManager -> Ready tasks assigned to workers
-> Workers execute via AiSdkAgent (streamText) -> stream_part events via worker:stream
-> SocketServerV2 broadcasts to Socket.IO stream channel -> Frontend processStreamPart()
-> MemoryManager marks complete -> Dependent tasks become ready -> Loop
```

### Task Model

Tasks use `status`: `ready | pending | in_progress | completed | failed`. The `assigned_role` field must be **lowercase** to match worker registry keys. Prerequisites are `Map<string, boolean>`; a task is ready when all are `true` or the map is empty.

### Frontend Communication

- `AgentServiceV2` combines HTTP (CRUD) + Socket.IO (real-time streaming)
- WebSocket events: `subscribeToAgent`, `sendMessage` (client); `agent:message`, `agent:error`, `orchestration:*` (server)

## Key Conventions

- **Agent runtime is AI SDK** - AiSdkAgent uses `streamText()` with `stopWhen: stepCountIs(10)` for multi-step tool execution.
- **Role/worker keys must be lowercase** - Critical for worker registry lookups. `assigned_role: "researcher"`, not `"Researcher"`.
- **Tools use AI SDK format** - LangChain tools are converted via `toAiSdkTool()` with `inputSchema` property. Use `tool()` from `ai` package for new tools.
- **Streaming via stream_part events** - `AiSdkAgent.executeToolMode()` yields `{ type: "stream_part", part }` events. WorkerPool/OrchestratorService forward via `worker:stream`. SocketServerV2 broadcasts to `stream` Socket.IO channel.
- **No internal EventEmitters for new code** - Use AsyncGenerator (streaming) or direct callbacks (task lifecycle). Socket.IO is the only event bus (for frontend delivery).
- **Types live in `types/` folders** with barrel exports. Import from: `import type { AgentConfig } from './types/index.js'`.
- **Agent workers serialize execution** per worker via `TaskQueue`. Parallelism comes from multiple workers running concurrently.
- **Skills are file-based** - SKILL.md files in `packages/registry/plugins/<team>/skills/<skillId>/SKILL.md`. Loaded by `SkillPlugin` at startup, scoped per team via `pluginName`. Per-agent filtering via `defaultSkills` in agent `.md` frontmatter. No database.
- **Do not create files unnecessarily** - Update existing files first.

## Branching Strategy

- **`dev`** is the default working branch. All development happens here.
- **`main`** is production, auto-synced from `dev` via GitHub Actions.
- **Never push directly to `main`.** Always branch from `dev`.
- Feature/fix branches: `git checkout dev && git checkout -b feature/xyz`
- Merge back into `dev` via PR. `main` syncs automatically.

## Environment Configuration

Copy `packages/backend/.env.example` to `packages/backend/.env` and set:
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT_URL`, `AZURE_OPENAI_INSTANCE_NAME`
- `MONGODB_URI`

## Agent Definitions

YAML agent definitions live in `packages/backend/agent/agents/`. The build step copies these to `dist/` via `copy:agents`.
