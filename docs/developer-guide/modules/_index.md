# Backend Modules Overview

This guide documents the current backend implementation of Ping. Each module has its own page linked from the reading order below.

> **Note:** The architecture described in `docs/ping/architecture.md` is aspirational (monorepo with `packages/`). This guide covers the actual codebase in `src/worker/`.

## Component Map

```
AgentManager (agentManager/AgentManagerV2.ts)
├── OrchestratorService (orchestrator/OrchestratorService.ts)
│   ├── InternalAgent — orchestrator (tool mode, conversational)
│   ├── InternalAgent — planBuilder (structured output mode)
│   └── Tools: createPlan, approvePlan, getContext, getStatus
├── MemoryManager (memoryManager/MemoryManager.ts)
│   └── RoleTaskQueue (util/RoleTaskQueue.ts)
├── WorkerPool (services/WorkerPool.ts)
│   ├── InternalAgent instances (one per active task)
│   ├── WorkspaceManager (L1 git branch isolation)
│   └── Tool injection: report_status, complete_task, workspace, collab, knowledge
└── MemoryCoordinator (memory/MemoryCoordinator.ts)
    ├── L1 Plugin — Git workspace isolation
    ├── L2 Plugin — CRDT collaboration (Hocuspocus/Yjs)
    └── L3 Plugin — Knowledge base (MongoDB + embeddings)
```

## End-to-End Data Flow

```
1. User sends message via Socket.IO
2. SocketServerV2 → AgentManager.orchestratorMessage(content)
3. OrchestratorService.handleMessage(content)
   └── Orchestrator agent (LangGraph, tool mode) processes message
4. Orchestrator calls createPlan tool
   └── PlanBuilder agent (structured output) → AgentPlanOutput
5. Plan emitted as plan:proposed → Frontend shows plan for approval
6. User approves → AgentManager.approveOrchestratorPlan()
   └── OrchestratorService.approvePlan()
       └── Tasks added to MemoryManager → auto-queued via RoleTaskQueue
7. RoleTaskQueue emits task:available
   └── OrchestratorService.wakeWorker()
       ├── autoExecute=true → sequential dispatch via dispatchChain
       └── autoExecute=false → emits task:pending_approval (user must start)
8. WorkerPool.runTask(taskWithContext)
   └── Creates InternalAgent, injects tools, streams events
9. Agent executes, calls complete_task tool
   └── OrchestratorService.handleAgentTaskComplete()
       ├── Publishes workspace, merges branch
       └── MemoryManager.completeTask() → unlocks dependent tasks
10. Loop back to step 7 until all tasks complete
```

## Event System

| Event | Emitter | Purpose |
|-------|---------|---------|
| `plan:proposed` | OrchestratorService (via tools) | Plan generated, awaiting approval |
| `plan:approved` | OrchestratorService | Plan approved, tasks queued |
| `plan:update` | AgentManager | Plan state changed |
| `task:pending_approval` | OrchestratorService | Task ready but autoExecute=false |
| `task:approved` | AgentManager | Task approved for chat |
| `task:update` | OrchestratorService / AgentManager | Task status changed |
| `task:response` | OrchestratorService | Worker first response |
| `task:error` | OrchestratorService | Task failed |
| `task:agent-complete` | WorkerPool (complete_task tool) | Agent self-completed task |
| `worker:event` | WorkerPool | Streaming agent events (thinking, tool calls, messages) |
| `worker:done` | WorkerPool | Worker finished execution |
| `worker:error` | WorkerPool | Worker execution error |
| `orchestrator:progress` | OrchestratorService | State transitions and progress messages |
| `execution:complete` | OrchestratorService | All tasks done |
| `agent:registered` / `agent:unregistered` | AgentManager | Agent added/removed |
| `autoApprove:changed` | AgentManager | Auto-approve setting changed |

## Reading Order

1. **[MemoryManager](./memory-manager.md)** — Task storage, dependency resolution, RoleTaskQueue. Start here: it's the simplest module and defines the foundational Task data model.

2. **[InternalAgent](./internal-agent.md)** — The unified LangGraph execution engine. Understand how individual agents run in tool mode vs structured output mode.

3. **[WorkerPool](./worker-pool.md)** — Bridges agent definitions to running instances. Manages tool injection (workspace, collab, knowledge) and streams events.

4. **[OrchestratorService](./orchestrator-service.md)** — The planning brain. State machine from idle through planning to execution. Coordinates task dispatch and completion cascading.

5. **[AgentManager](./agent-manager.md)** — Top-level coordinator and public API. Composes all other modules. Handles initialization, auto-approve, and task lifecycle.

6. **[MemoryCoordinator](./memory-coordinator.md)** — Plugin architecture for the three memory layers: L1 workspace (git), L2 collaboration (CRDT), L3 knowledge (MongoDB).
