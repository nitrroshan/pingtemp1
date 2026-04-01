# Worker runtime

This folder hosts the runtime that orchestrates AI agents (workers) to collaborate on tasks.

## How it works
- Role discovery → Config generation → Worker initialization → Plan generation → Tasks → MemoryManager → Assignment to workers.
- Each worker wraps a LangGraph agent, executes tasks, and emits `taskComplete` events.
- Checkpointing uses LangGraph `MemorySaver`; every `agent.invoke` must include `{ configurable: { thread_id } }`.

## Build and run
- Build TypeScript:
  - `npm run build` (from `src/worker/`)
- Debug (VS Code): use "Debug AgentManager" in `.vscode/launch.json`.
- Programmatic entry: `agentManager/agentManager.ts` exports `runAgentManager` for manual runs.

## Key files
- `AgentWorker/AgentWorker.ts`: worker wrapper, task queue, event emission.
- `agentManager/agentManager.ts`: orchestrator (planning, assignment, event subscribers).
- `roleManager/RoleManager.ts`: role discovery and worker registry.
- `memoryManager/MemoryManager.ts`: task lifecycle and readiness.
- `agentManager/Agent.ts`: creates the LangGraph agent (Azure OpenAI + MCP tools).

## Conventions
- Workers keyed by lowercase role names.
- Task statuses: `ready | pending | in_progress | completed | failed`.
- Always pass `thread_id` to `.invoke`.# Worker
This are the background worker that will handle actual tasks. 
A Agent worker will spin up an agent with role, a definite goal & response format to acheive a goal. This will help in creating multible agent tabs like web pages in browser.

## How to start the worker service
1) yarn install
2) yarn build
3) yarn start