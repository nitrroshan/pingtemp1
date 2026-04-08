# Ping Platform — Architecture Reference

**Created:** April 6, 2026  
**Scope:** Complete system architecture with Planner-as-Agent (Phase 1) integration  
**Use:** Verify feature changes don't violate architectural contracts

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Package Structure](#2-package-structure)
3. [Class Relationships](#3-class-relationships)
4. [Message Flow — Golden Path](#4-message-flow--golden-path)
5. [Event Architecture](#5-event-architecture)
6. [Planner-as-Agent Architecture](#6-planner-as-agent-architecture)
7. [State Machines](#7-state-machines)
8. [Callback Chain](#8-callback-chain)
9. [Socket.IO Protocol](#9-socketio-protocol)
10. [Tool Catalog](#10-tool-catalog)
11. [Data Models](#11-data-models)
12. [Architectural Contracts](#12-architectural-contracts)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React 19)                        │
│  useOrchestration ── useChat ── MessageList ── StreamMessage        │
│         │                                                           │
│    Socket.IO Client  ←──────── stream / state / progress ──────────┤
│         │                                                           │
│    HTTP Client ──────────────── REST /api/v2/* ─────────────────────┤
└─────────┬───────────────────────────────────────────────────────────┘
          │ WebSocket + HTTP
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND (packages/backend)                       │
│                                                                     │
│  AgentManagerAPI ─── HttpServer (Express)                           │
│        │             SocketServerV2 (Socket.IO)                     │
│        │                  │                                         │
│        ▼                  ▼                                         │
│  AgentManagerRegistry ── per-team AgentManager instances            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ imports
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│               @ping/agent-manager (core engine)                     │
│                                                                     │
│  AgentManager (V2) ── OrchestratorService ── PlannerAgent [NEW]     │
│       │                     │                     │                 │
│       ├── WorkerPool        ├── DependencyResolver [NEW]            │
│       │     │               ├── UserInteractionManager [NEW]        │
│       │     └── AiSdkAgent  ├── NotificationQueue [NEW]            │
│       │                     └── NotificationTransport [NEW]         │
│       ├── MemoryManager                                             │
│       │     └── RoleTaskQueue                                       │
│       ├── PluginRegistry                                            │
│       │     ├── WorkspacePlugin (L1)                                │
│       │     ├── CollaborationPlugin (L2)                            │
│       │     └── KnowledgePlugin (L3)                                │
│       └── AgentFactory                                              │
│             └── planner.yaml / orchestrator.yaml / agents/*.yaml    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Package Structure

```
packages/
  agent-manager/     @ping/agent-manager    Core engine (no HTTP, no Socket.IO)
  backend/           Thin API server         Express + Socket.IO (imports agent-manager)
  frontend/          React 19 + Vite         Chat UI, streaming, team management
  workspace/         @ping/workspace         L1: 31 workspace tools, git, codeintel
  collaboration/     @ping/collaboration     L2: CRDT, group chat, search, publish
  knowledge/         @ping/knowledge         L3: knowledge base, wiki, runbooks
  registry/          Agent registry           Vector search, MCP endpoints
```

**Dependency graph (no circular deps):**
```
@ping/workspace ──────┐
@ping/collaboration ──┤── depend on ──→ @ping/agent-manager ──→ AI SDK
@ping/knowledge ──────┘
backend ──→ @ping/agent-manager + all plugins
frontend ──→ (Socket.IO + HTTP only, no package imports)
```

---

## 3. Class Relationships

### Current State (with SRP violations noted)

```
┌────────────────────────────┐     ┌──────────────────────────────┐
│   AgentManager (~1250 LOC) │────→│  OrchestratorService (~600)  │
│   🔴 10+ responsibilities  │     │  🟠 5-6 responsibilities     │
│                            │     │                              │
│   - orchestrator wiring    │     │  - plan lifecycle            │
│   - task lifecycle (v2)    │     │  - agent execution           │
│   - auto-approve logic     │     │  - task dispatch             │
│   - team management        │     │  - plan persistence          │
│   - legacy API (deprecated)│     │  - workspace publish/merge   │
│   - queue execution        │     │  - state management          │
│   - plugin management      │     └──────────────────────────────┘
│   - workspace access       │
│   - callback forwarding    │     ┌──────────────────────────────┐
└────────────┬───────────────┘     │  MemoryManager (~290)        │
             │                     │  🟡 5 responsibilities        │
             ▼                     │                              │
┌────────────────────────────┐     │  - task CRUD                 │
│   WorkerPool (~400 LOC)    │     │  - dependency tracking       │
│   🟠 6-7 responsibilities  │     │  - context management        │
│                            │     │  - queue integration         │
│   - agent creation         │     │  - status lifecycle          │
│   - task execution         │     │                              │
│   - tool assembly (plugins)│     │  └── RoleTaskQueue           │
│   - workspace management   │     │       - dispatch per role    │
│   - branch merge/cleanup   │     │       - priority queues      │
│   - callback forwarding    │     └──────────────────────────────┘
└────────────────────────────┘
```

### Target State — SOLID Refactor

**Principles applied:**
- **S** — Single Responsibility: Each class has ONE reason to change
- **O** — Open/Closed: New features via new classes, not modifying existing
- **L** — Liskov: TaskStore and MemoryManager share no inheritance — composition only
- **I** — Interface Segregation: Small, focused callback interfaces per consumer
- **D** — Dependency Inversion: Core depends on abstractions (interfaces), not implementations

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        COMPOSITION ROOT                                 │
│                                                                         │
│  AgentManager (thin facade — wiring only, ~100 LOC)                     │
│                                                                         │
│  Responsibility: Create components, wire callbacks, expose API          │
│  Does NOT contain business logic. Only:                                 │
│  - initializeOrchestrator() → creates everything below                  │
│  - registerStreamCallbacks() → passes to OrchestratorService            │
│  - orchestratorMessage() → delegates to OrchestratorService             │
│  - approveOrchestratorPlan() → delegates to OrchestratorService         │
│  - dispose() → tears down                                               │
└─────┬───────────────┬──────────────────┬───────────────┬───────────────┘
      │               │                  │               │
      ▼               ▼                  ▼               ▼
┌─────────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────────┐
│ PlannerAgent│ │  TaskStore  │ │  WorkerPool  │ │ Orchestrator  │
│             │ │             │ │              │ │ Service       │
│ The brain.  │ │ Single auth-│ │ Agent life-  │ │               │
│ Decides WHAT│ │ ority for   │ │ cycle only   │ │ The runtime.  │
│ via tools.  │ │ task state  │ │              │ │ Reacts to     │
│             │ │             │ │              │ │ callbacks.    │
└──────┬──────┘ └──────┬─────┘ └──────┬───────┘ └──────┬────────┘
       │               │              │                │
       │       ┌───────┴──────────────┴────────────────┘
       │       │  PlannerAgent and OrchestratorService
       │       │  are PEERS — neither owns the other.
       │       │  Both operate on shared services:
       ▼       ▼
  ┌──────────────────────────────────────────────────┐
  │           SHARED SERVICES (injected)              │
  │                                                   │
  │  TaskStore ←── PlannerAgent (via tools)           │
  │            ←── OrchestratorService (via callbacks) │
  │                                                   │
  │  DependencyResolver ←── PlannerAgent (via tools)  │
  │                     ←── OrchestratorService (DAG)  │
  │                                                   │
  │  WorkerPool ←── OrchestratorService (dispatch)    │
  │             ←── PlannerAgent (cancel_task tool)    │
  └──────────────────────────────────────────────────┘
```

**Why peers, not parent-child:**
- PlannerAgent = "the leader" — decides WHAT to do (via LLM + tools)
- OrchestratorService = "the runtime" — does HOW (reacts to task events, dispatches workers)
- Neither references the other directly. Both talk to shared services.
- PlannerAgent calls tools that close over TaskStore/DependencyResolver — NOT over OrchestratorService
- OrchestratorService receives callbacks from RoleTaskQueue — NOT from PlannerAgent
- AgentManager (composition root) wires both to the same shared services

#### TaskStore (NEW — extracted from MemoryManager)

```
┌─────────────────────────────────────────────────────────┐
│  TaskStore                                               │
│  Responsibility: Task state — the SINGLE WRITER          │
│  "Only I change task status. Everyone else reads."       │
│                                                          │
│  Methods:                                                │
│    create(task) → void          // add task to store     │
│    get(taskId) → Task           // read single task      │
│    getAll() → Task[]            // read all tasks        │
│    getByRole(role) → Task[]     // query by role         │
│    getByStatus(status) → Task[] // query by status       │
│    updateStatus(taskId, status) // enforced state machine│
│    updateTask(taskId, patch)    // plan mutation          │
│    remove(taskId)               // plan mutation          │
│    storeOutput(taskId, output)  // task result            │
│    clear()                      // new plan               │
│                                                          │
│  State Machine Enforcement:                              │
│    pending → ready (deps met)                            │
│    ready → in_progress (dispatched)                      │
│    in_progress → completed | failed                      │
│    failed → ready (retry)                                │
│    * → cancelled (planner cancels)                       │
│    INVALID: completed → anything (throws)                │
│    INVALID: in_progress → pending (throws)               │
│                                                          │
│  Does NOT:                                               │
│    - Resolve dependencies (that's DependencyResolver)    │
│    - Dispatch tasks (that's WorkerPool)                  │
│    - Store plan metadata (that's PlanStore)              │
│    - Manage queues (that's RoleTaskQueue)                │
│                                                          │
│  Notifies via callbacks:                                 │
│    onStatusChanged(taskId, oldStatus, newStatus)         │
│    onTaskCreated(taskId)                                 │
│    onTaskRemoved(taskId)                                 │
└─────────────────────────────────────────────────────────┘
```

#### OrchestratorService (refactored — reactive runtime only)

```
┌─────────────────────────────────────────────────────────┐
│  OrchestratorService                                     │
│  Responsibility: React to task lifecycle, dispatch workers│
│  "I'm the runtime. I execute what the planner decides."  │
│                                                          │
│  Owns:                                                   │
│    - UserInteractionManager (ask/respond bridge)         │
│    - plannerWakeSignal (suspend/resume planner)          │
│    - messageChain (serialized message handling)          │
│    - dispatchChain (serialized workspace access)         │
│    - NotificationQueue (deferred — only for Step 7/10)   │
│                                                          │
│  Uses (injected):                                        │
│    - TaskStore (reads + triggers status changes)         │
│    - WorkerPool (dispatches tasks to workers)            │
│    - DependencyResolver (checks which tasks are ready)   │
│    - PlanStore (plan persistence — injected by plugin)   │
│    - callbacks (stream events → AgentManager → Socket.IO)│
│                                                          │
│  Does NOT own PlannerAgent — they are peers.             │
│  PlannerAgent calls tools → tools call TaskStore.        │
│  OrchestratorService reacts to callbacks from TaskStore. │
│                                                          │
│  Methods:                                                │
│    handleMessage(content) → string  // route to planner  │
│    approvePlan() → result           // user approves     │
│    onUserMessage(content)           // mid-execution msg │
│                                                          │
│  Internal (wired as callbacks from RoleTaskQueue):       │
│    onTaskReady(taskId, role) → dispatch to WorkerPool    │
│    onTaskComplete(taskId)   → check deps, wake planner   │
│    onTaskFailed(taskId)     → push to NotificationQueue  │
│    onWorkerDone(data)       → publish workspace, complete│
│                                                          │
│  Does NOT:                                               │
│    - Own or create PlannerAgent (peer, not child)        │
│    - Store task state (that's TaskStore)                 │
│    - Create agents (that's AgentFactory)                 │
│    - Manage workspaces (that's WorkspaceManager)         │
│    - Execute agents (that's WorkerPool)                  │
└─────────────────────────────────────────────────────────┘
```

#### WorkerPool (refactored — agent execution only)

```
┌─────────────────────────────────────────────────────────┐
│  WorkerPool                                              │
│  Responsibility: Create and execute agent workers        │
│  "I run agents. That's it."                              │
│                                                          │
│  Methods:                                                │
│    runTask(task, signal?) → result  // execute one task  │
│    dispose(taskId)                  // kill one worker    │
│    disposeAll()                     // kill all workers   │
│    getActiveWorkers() → Map        // query active       │
│                                                          │
│  Internal:                                               │
│    createWorker(taskId, role) → AiSdkAgent               │
│    assembleTools(taskId, role) → Tool[] // via plugins    │
│                                                          │
│  Uses (injected):                                        │
│    - PluginRegistry (tool assembly)                      │
│    - AgentFactory (agent creation from definitions)      │
│    - callbacks (stream events → OrchestratorService)     │
│                                                          │
│  Does NOT:                                               │
│    - Manage git branches (that's WorkspaceManager)       │
│    - Merge/publish workspaces (that's WorkspaceManager)  │
│    - Store task status (that's TaskStore)                 │
│    - Decide when to dispatch (that's OrchestratorService)│
│    - Manage definitions registry (injected)              │
└─────────────────────────────────────────────────────────┘
```

#### DependencyResolver (already built — stays)

```
┌─────────────────────────────────────────────────────────┐
│  DependencyResolver                                      │
│  Responsibility: DAG graph queries                       │
│  "I answer questions about the dependency graph."        │
│                                                          │
│  Methods:                                                │
│    rebuildFromTaskStore(store)  // sync from task state   │
│    validate() → string|null    // cycle detection        │
│    getReady() → taskId[]       // tasks with met deps    │
│    getBlocked() → BlockedInfo  // stuck tasks + reasons  │
│    getCriticalPath() → taskId[]// longest chain          │
│    validateDependencies(id, deps) // check before mutate │
│    validateNewTasks(tasks)     // check before add       │
│                                                          │
│  Does NOT:                                               │
│    - Store tasks (reads from TaskStore)                   │
│    - Change task status (that's TaskStore)                │
│    - Dispatch tasks (that's OrchestratorService)          │
└─────────────────────────────────────────────────────────┘
```

#### RoleTaskQueue (stays — dispatch queue)

```
┌─────────────────────────────────────────────────────────┐
│  RoleTaskQueue                                           │
│  Responsibility: Priority-based dispatch per role        │
│  "I queue tasks and hand them out by priority."          │
│                                                          │
│  Methods:                                                │
│    queueTask(task) → void      // add to role queue      │
│    poll(role) → task           // get next for role      │
│    pollN(role, n) → task[]     // parallel dispatch [A6] │
│    removeTask(taskId) → bool   // plan mutation          │
│    updatePriority(id, pri)     // reprioritize           │
│                                                          │
│  Callbacks:                                              │
│    onTaskReady(role, taskId)   // → OrchestratorService  │
│    onTaskComplete(taskId, out) // → OrchestratorService  │
│    onTaskFailed(taskId, err)   // → OrchestratorService  │
│                                                          │
│  Owner: OrchestratorService (via TaskStore)               │
│  NOT owned by MemoryManager anymore                      │
└─────────────────────────────────────────────────────────┘
```

#### ~~MemoryManager~~ → DELETED after A6 migration

```
MemoryManager has no remaining responsibilities after TaskStore extraction:
  - Task CRUD + status      → TaskStore
  - RoleTaskQueue ownership → TaskStore
  - Dependency tracking     → DependencyResolver (done ✅)
  - Context/knowledge       → PluginRegistry (already does this)
  - Task context builder    → ContextBuilder (A6 Step 3)

PluginRegistry already coordinates L1/L2/L3 plugins:
  - PluginRegistry.getTools(context) → tool assembly
  - PluginRegistry.getSkills(context) → skill resolution
  - PluginRegistry.getPluginStorage(id) → PlanStore, etc.
  - WorkerPool already calls PluginRegistry directly

MemoryCoordinator (referenced in docs) was the planned name for
what became PluginRegistry. It never existed as a class.

After A6: MemoryManager is deleted. No replacement needed.
```

### Dependency Graph (Target — No Circular Deps)

```
AgentManager (facade)
    │
    ├── creates → PlannerAgent (peer — tools close over shared services)
    │
    ├── creates → OrchestratorService (peer — callbacks from shared services)
    │                 │
    │                 ├── uses → TaskStore (injected)
    │                 ├── uses → WorkerPool (injected)
    │                 ├── uses → DependencyResolver (injected)
    │                 ├── uses → PlanStore (injected by plugin)
    │                 └── owns → UserInteractionManager
    │
    ├── creates → TaskStore
    │                 │
    │                 └── uses → RoleTaskQueue (owns)
    │
    ├── creates → DependencyResolver
    │
    ├── creates → WorkerPool
    │                 │
    │                 ├── uses → PluginRegistry (injected)
    │                 └── uses → AgentFactory (injected)
    │
    └── creates → PluginRegistry (L1/L2/L3 context & tools)

PlannerAgent ──(tools)──→ TaskStore, DependencyResolver, WorkerPool
OrchestratorService ──(callbacks)──→ TaskStore, WorkerPool
PlannerAgent ✕ OrchestratorService  (no direct reference between them)

Direction: AgentManager → everything (no reverse deps)
           PlannerAgent → shared services (via tools, no reverse)
           OrchestratorService → shared services (via callbacks, no reverse)
           TaskStore → RoleTaskQueue (no reverse)
           WorkerPool → PluginRegistry, AgentFactory (no reverse)
```

### Migration Path (Current → Target)

| Step | What Moves | From | To | When |
|---|---|---|---|---|
| 1 | Task CRUD + status | MemoryManager | TaskStore | A6 Step 1 |
| 2 | RoleTaskQueue ownership | MemoryManager | TaskStore | A6 Step 1 |
| 3 | Dependency tracking | MemoryManager (prerequisite maps) | DependencyResolver | A5 Step 4 (done ✅) |
| 4 | Workspace publish/merge | OrchestratorService | WorkspaceManager (plugin) | A6 Step 2 |
| 5 | Legacy API removal | AgentManager | deleted | ✅ Done (legacy orchestrator removed) |
| 6 | Auto-approve logic | AgentManager | OrchestratorService config | A5 Step 10 |
| 7 | Team management | AgentManager | TeamService (exists) | Phase 3 |
| 8 | Task context | MemoryManager | ContextBuilder (new) | A6 Step 3 |
| 9 | MemoryManager class | MemoryManager | **DELETED** (PluginRegistry covers it) | After A6 complete |

---

## 4. Message Flow — Golden Path

**The golden path that must NEVER break:**

```
1. User opens frontend
2. User submits a goal
3. Planner creates a plan (tasks + deps)
4. User approves the plan
5. Workers execute tasks (parallel when DAG allows)
6. Each task produces output
7. User sees results
8. Goal completes
```

### Sequence: Goal → Plan → Approve → Execute → Done

```
Frontend              SocketServerV2           AgentManager          OrchestratorService
   │                       │                       │                       │
   │──message(goal)───────→│                       │                       │
   │                       │──orchestratorMessage──→│                       │
   │                       │                       │──handleMessage────────→│
   │                       │                       │                       │
   │                       │                       │  [LEGACY MODE]        │
   │                       │                       │  orchestratorAgent    │
   │                       │                       │  calls create_plan    │
   │                       │                       │  → PlanBuilder agent  │
   │                       │                       │                       │
   │                       │                       │  [PLANNER MODE - NEW] │
   │                       │                       │  plannerAgent runs    │
   │                       │                       │  cognitive loop:      │
   │                       │                       │  ask_user → research  │
   │                       │                       │  → discuss → plan     │
   │                       │                       │  calls submit_plan    │
   │                       │                       │  calls request_approval
   │                       │                       │                       │
   │←─stream(text-delta)───│←─onStream─────────────│←─stream_part events───│
   │←─stream(tool-*)───────│←─onStream─────────────│←─stream_part events───│
   │←─state(plan-proposed)─│←─onPlanProposed───────│←─onPlanProposed───────│
   │                       │                       │                       │
   │──action(approve-plan)→│                       │                       │
   │                       │──approveOrchestratorPlan→│                    │
   │                       │                       │──approvePlan─────────→│
   │                       │                       │                       │
   │←─state(executing)─────│←─onPlanUpdate─────────│←─callbacks.onPlanApproved
   │                       │                       │                       │
   │                       │                       │  Tasks added to       │
   │                       │                       │  MemoryManager        │
   │                       │                       │                       │
   │                       │                       │  RoleTaskQueue fires  │
   │                       │                       │  onTaskReady callback │
   │                       │                       │           │           │
   │                       │                       │           ▼           │
   │                       │                       │  wakeWorker(taskId)   │
   │                       │                       │           │           │
   │                       │                       │           ▼           │
   │                       │               WorkerPool.runTask(task)        │
   │                       │                       │                       │
   │←─stream(text-delta)───│←─onStream─────────────│←─worker stream events │
   │←─stream(tool-*)───────│←─onStream─────────────│                       │
   │                       │                       │                       │
   │                       │               Worker calls complete_task      │
   │                       │                       │                       │
   │                       │               handleAgentTaskComplete()       │
   │                       │                       │                       │
   │                       │               MemoryManager.completeTask()    │
   │                       │                       │                       │
   │                       │               RoleTaskQueue fires             │
   │                       │               onTaskComplete callback         │
   │                       │                       │                       │
   │←─state(task-completed)│←─onTaskUpdate─────────│                       │
   │                       │                       │                       │
   │                       │               Next ready tasks dispatched...  │
   │                       │                       │                       │
   │←─state(completed)─────│←─onProgress───────────│  All tasks done       │
   │                       │                       │  state → idle         │
```

### Sequence: Planner Ask User (NEW — Planner Mode Only)

`ask_user` is a regular tool call — the question appears in the `stream` as `tool-input-available`.
The user's answer comes via the existing `message` event (user types in chat).

```
Frontend              SocketServerV2           AgentManager          PlannerAgent
   │                       │                       │                    │
   │                       │                       │  Planner calls     │
   │                       │                       │  ask_user tool     │
   │                       │                       │        │           │
   │                       │                       │        ▼           │
   │                       │                       │  UserInteraction    │
   │                       │                       │  Manager.ask()     │
   │                       │                       │  (blocks agent)    │
   │                       │                       │        │           │
   │←─stream(tool-input)───│←─onStream────────────│←───────┘           │
   │  (ToolCard shows the  │  (same stream channel │                    │
   │   question in chat)   │   as any tool call)   │                    │
   │                       │                       │                    │
   │  (User types answer   │                       │                    │
   │   in chat input)      │                       │                    │
   │                       │                       │                    │
   │──message(answer)──────→│                      │                    │
   │                       │──resolveQuestion──────→│                   │
   │                       │  (routes mid-execution │  UserInteraction   │
   │                       │   message to UIM)      │  Manager.resolve() │
   │                       │                       │  (unblocks agent)  │
   │                       │                       │        │           │
   │←─stream(tool-output)──│←─onStream────────────│←───────┘           │
   │                       │                       │  Agent continues   │
   │                       │                       │  with user's answer│
```

### Sequence: Plan Mutation Mid-Flight (NEW)

```
Frontend              SocketServerV2           OrchestratorService       PlannerAgent
   │                       │                       │                       │
   │                       │                       │  Worker fails →       │
   │                       │                       │  RoleTaskQueue fires  │
   │                       │                       │  onTaskFailed callback│
   │                       │                       │       │              │
   │                       │                       │       ▼              │
   │                       │                       │  handleTaskFailed()   │
   │                       │                       │  pushes to            │
   │                       │                       │  NotificationQueue    │
   │                       │                       │  (owned by this       │
   │                       │                       │   OrchestratorService)│
   │                       │                       │       │              │
   │                       │                       │  NotificationQueue    │
   │                       │                       │  wakes planner via    │
   │                       │                       │  plannerWakeSignal    │
   │                       │                       │       │              │
   │                       │                       │       ▼              │
   │                       │                       │  Planner wakes,       │
   │                       │                       │  calls check_notifs   │
   │                       │                       │  → drains queue       │
   │                       │                       │           │           │
   │                       │                       │  Planner calls        │
   │                       │                       │  add_tasks tool       │
   │                       │                       │           │           │
   │                       │                       │  DependencyResolver   │
   │                       │                       │  validates DAG        │
   │                       │                       │           │           │
   │                       │                       │  MemoryManager        │
   │                       │                       │  .addTask() for each  │
   │                       │                       │           │           │
   │←─state(plan:mutation)─│←─onPlanMutation───────│←──────────┘          │
   │                       │                       │                       │
   │                       │                       │  New tasks dispatched  │
```

---

## 5. Event Architecture

### Design Principle: Socket.IO is the ONLY Event Bus

```
Internal (same-process):     Direct callbacks / AsyncGenerator
Network boundary (frontend): Socket.IO only
Future services:             Socket.IO client or direct callback in SocketServerV2
```

**0 EventEmitters in new code.** Legacy EventEmitters (BaseAgent, TaskList) are deprecated.

### Complete Callback Chain

```
                    ┌──────────────────────────┐
                    │      AiSdkAgent          │
                    │  execute() → AsyncGen     │
                    │  yields AgentEvent        │
                    └────────────┬─────────────┘
                                 │ for await (event of agent.execute())
                                 ▼
                    ┌──────────────────────────┐
                    │      WorkerPool          │
                    │  runTask() iterates gen   │
                    │  calls callbacks:         │
                    │  onStream(stream_part)    │
                    │  onEvent(legacy events)   │
                    │  onDone(task result)      │
                    │  onError(failure)         │
                    │  onAgentComplete(done)    │
                    │  onStatusUpdate(progress) │
                    └────────────┬─────────────┘
                                 │ callbacks
                                 ▼
                    ┌──────────────────────────┐
                    │   OrchestratorService    │
                    │                          │
                    │  Forwards to its own     │
                    │  callbacks (passthrough): │
                    │  callbacks.onStream()     │
                    │  callbacks.onEvent()      │
                    │  callbacks.onDone()       │
                    │  callbacks.onError()      │
                    │                          │
                    │  + orchestrator-specific: │
                    │  callbacks.onPlanProposed │
                    │  callbacks.onPlanApproved │
                    │  callbacks.onTaskUpdate   │
                    │  callbacks.onProgress     │
                    │  callbacks.onPlanMutation│  [NEW]
                    └────────────┬─────────────┘
                                 │ callbacks
                                 ▼
                    ┌──────────────────────────┐
                    │      AgentManager        │
                    │  (AgentManagerV2)         │
                    │                          │
                    │  registerStreamCallbacks  │
                    │  maps to:                │
                    │  streamCallbacks.onStream │
                    │  streamCallbacks.onEvent  │
                    │  streamCallbacks.onDone   │
                    │  streamCallbacks.onError  │
                    │  streamCallbacks.onTaskUp │
                    │  streamCallbacks.onPlanUp │
                    │  streamCallbacks.onPlanP  │
                    └────────────┬─────────────┘
                                 │ streamCallbacks
                                 ▼
                    ┌──────────────────────────┐
                    │    SocketServerV2        │
                    │  ensureTeamCallbacks()    │
                    │                          │
                    │  Maps to Socket.IO:       │
                    │  onStream → emit('stream')│
                    │  onEvent → emit('progress')
                    │  onDone → emit('stream',  │
                    │           finish part)     │
                    │  onError → emit('error')  │
                    │  onTaskUpdate → emit('state')
                    │  onPlanUpdate → emit('state')
                    │  onPlanProposed → emit    │
                    │    ('state', pending)      │
                    └────────────┬─────────────┘
                                 │ socket.emit / io.to(room).emit
                                 ▼
                    ┌──────────────────────────┐
                    │      Frontend            │
                    │  useOrchestration hook    │
                    │                          │
                    │  'stream' → processStream │
                    │  'state' → update plan UI │
                    │  'progress' → notifications
                    │  'error' → error toast    │
                    └──────────────────────────┘
```

### Task Lifecycle Callbacks (Direct — No Events)

```
RoleTaskQueue                    OrchestratorService
     │                                │
     │  onTaskReady(role, taskId)  ───→│  wakeWorker() → dispatch to WorkerPool
     │  onTaskComplete(taskId, out)──→│  handleTaskComplete() → check if all done
     │  onTaskFailed(taskId, err)  ──→│  handleTaskFailed() → notify planner
     │                                │
     │  (set via memoryManager        │  (uses arrow functions,
     │   .taskQueue.setCallbacks())   │   no .bind(this) needed)
```

---

## 6. Planner-as-Agent Architecture

### Current Architecture (legacy orchestrator removed)

```
  ┌────────────────────────────────────────┐
  │            Planner Agent               │
  │                                        │
  │  14 tools in 4 categories:             │
  │                                        │
  │  KNOWLEDGE (3):                        │
  │    research_domain, analyze_requirements│
  │    get_team_capabilities               │
  │                                        │
  │  EXECUTION (6):                        │
  │    submit_plan, get_status, get_context │
  │    cancel_task, get_blocked             │
  │    get_critical_path, search_agents     │
  │                                        │
  │  PLAN MUTATION (5):                    │
  │    update_task, add_tasks, remove_task  │
  │    reprioritize, replan                │
  │                                        │
  │  Cognitive Loop (natural language):     │
  │  CLARIFY → RESEARCH → PLAN → MONITOR   │
  └────────────────────────────────────────┘
```

> **Note:** Legacy dual-agent mode (orchestrator agent + plan-builder agent with 4 tools) has been removed. `PLANNER_MODE` feature flag deleted. Only planner mode exists.
> 
> **Deferred to sandbox phase:** cockatiel auto-retry + circuit-breaker, AbortController worker cancellation, watchdog heartbeat loop.  
> **Deferred to L3 phase:** Real LLM research via GPT Researcher MCP or Stanford STORM.
  │  Cognitive Loop:                       │
  │  CLARIFY → RESEARCH → ANALYSE →        │
  │  DISCUSS → ASSESS → REASON →           │
  │  PLAN → MONITOR/ADAPT                  │
  └────────────────────────────────────────┘
```

### Planner Suspend/Wake Cycle

The planner is an LLM agent. Each `streamText()` call is one "turn" — the agent
runs until it stops calling tools. To make the planner react to task events,
we send a new message to start a new turn.

**Phase 1 (simple — no NotificationQueue):**
```
Turn 1: User sends goal
  → planner: clarify → research → submit_plan → request_approval
  → turn ends (agent stops calling tools)

User approves → tasks execute autonomously

Turn 2: Task fails (OrchestratorService sends message to planner)
  → planner: assess failure → retry via replan tool / skip / add_tasks
  → turn ends

Turn 3: All tasks complete (OrchestratorService sends message)
  → planner: tell_user("All done! Here's what was built...")
  → turn ends
```

**Mechanism:** OrchestratorService calls `plannerAgent.execute({ message })` 
when something needs a planner decision. Same handleMessage pattern as the 
user's initial goal. No special infrastructure.

**Current implementation (NotificationQueue wired):**
NotificationQueue batches events (100ms debounce), sends ONE message
when multiple events occur rapidly:
"3 tasks failed, 2 completed since last check. Details: ..."

```
  Tasks executing...
       │
  multiple events occur within 100ms:
  - task-1 completed
  - task-3 failed (timeout)
  - task-4 failed (rate limit)
       │
       ▼
  NotificationQueue (100ms debounce)
       │
       ▼ (single batched message)
  plannerAgent.execute({
    message: "Events since last check:\n✅ task-1 completed\n❌ task-3 failed: timeout\n❌ task-4 failed: rate limit"
  })
       │
       ▼
  Planner turn N: assess → retry task-4 (retriable) → replan task-3 → turn ends
```

---

## 7. State Machines

### OrchestratorService States

```
             ┌──────────────────────────────────────────────┐
             │                                              │
             │  OrchestratorService (2 states)              │
             │  Planner manages its own phases via tools    │
             │                                              │
             │  idle ──→ executing                          │
             │   ↑           │                              │
             │   └───────────┘  (planner decides when done) │
             │                                              │
             └──────────────────────────────────────────────┘
```

### Task Status Lifecycle

```
              ┌──────────┐
              │ proposed  │  (in plan, before approval)
              └─────┬────┘
                    │ plan approved
               ┌────┴────┐
               ▼         ▼
          ┌────────┐ ┌───────┐
          │ ready  │ │pending│  (deps not met)
          └───┬────┘ └───┬───┘
              │          │ deps satisfied
              │          ▼
              │     ┌────────┐
              ├────→│ ready  │
              │     └───┬────┘
              │         │ dispatched
              ▼         ▼
         ┌──────────────┐
         │ in_progress   │
         └──┬─────────┬──┘
            │         │
      success│    failure│
            ▼         ▼
     ┌───────────┐ ┌────────┐
     │ completed │ │ failed │
     └───────────┘ └───┬────┘
                       │ planner retries
                       ▼
                  ┌────────┐
                  │ ready  │  (fresh attempt)
                  └────────┘
```

---

## 8. Callback Chain — Complete Map

### Layer 1: OrchestratorCallbacks (types.ts)

| Callback | Payload | When Fired | Socket.IO Channel |
|---|---|---|---|
| `onStream` | `{ taskId, agentId, part }` | Every AI SDK stream part | `stream` |
| `onEvent` | `{ taskId, event }` | Legacy thinking/tool events | `progress` |
| `onDone` | `{ taskId, role, output }` | Agent finished response | `stream` (finish part) |
| `onError` | `{ taskId, error }` | Agent or worker error | `error` |
| `onPlanProposed` | `{ plan, teamId, timestamp }` | Plan created, needs approval | `state` (awaiting_approval) |
| `onPlanApproved` | `{ planId, teamId, tasksQueued }` | Plan approved, execution starting | `state` (executing) |
| `onTaskUpdate` | `{ taskId, status, role?, output? }` | Task status changed | `state` |
| `onProgress` | `{ teamId, state, message, ... }` | General progress update | `state` |
| `onPlanMutation` **[NEW]** | `{ type, data }` | Plan modified mid-flight | `state` (mutation) |
| `onPlannerInput` **[NEW]** | `string` (message) | Orchestrator needs planner decision | Triggers new planner turn (not a Socket.IO event) |

> **Why no `onPlannerAskUser` / `onPlannerTellUser`?**  
> `ask_user` and `tell_user` are just tool calls. The AI SDK streaming pipeline already emits  
> `tool-input-start → tool-input-delta → tool-input-available → tool-output-available`  
> through the existing `stream` channel. Frontend renders them as `ToolCard` components.  
> User responses come via the existing `message` event → routed to `UserInteractionManager`.  
> No separate Socket.IO events needed.

### Layer 2: ManagerStreamCallbacks (AgentManagerV2.ts)

| Callback | Maps From | Maps To (Socket.IO) |
|---|---|---|
| `onStream` | WorkerPool + Orchestrator | `io.to(room).emit('stream', ...)` |
| `onEvent` | WorkerPool + Orchestrator | `io.to(room).emit('progress', ...)` |
| `onDone` | WorkerPool | `io.to(room).emit('stream', finish)` |
| `onError` | WorkerPool | `io.to(room).emit('error', ...)` |
| `onTaskUpdate` | OrchestratorService | `io.to(room).emit('state', ...)` |
| `onPlanUpdate` | AgentManager | `io.to(room).emit('state', ...)` |
| `onPlanProposed` | OrchestratorService | `io.to(room).emit('state', pending)` |

### Layer 3: TaskCallbacks (RoleTaskQueue)

| Callback | When Fired | Consumer |
|---|---|---|
| `onTaskReady` | `queueTask()` adds task with 0 deps, or completeTask resolves deps | OrchestratorService.wakeWorker() |
| `onTaskComplete` | `completeTask(taskId, output)` called | OrchestratorService.handleTaskComplete() |
| `onTaskFailed` | `failTask(taskId, error)` called | OrchestratorService.handleTaskFailed() |

### Layer 4: WorkerCallbacks (WorkerPool)

| Callback | When Fired | Consumer |
|---|---|---|
| `onStream` | Worker's AiSdkAgent emits stream_part | OrchestratorService (passthrough to callbacks) |
| `onEvent` | Worker's AiSdkAgent emits legacy event | OrchestratorService (passthrough) |
| `onDone` | Worker finishes execution | OrchestratorService (passthrough) |
| `onError` | Worker encounters error | OrchestratorService (passthrough) |
| `onAgentComplete` | Worker calls complete_task tool | OrchestratorService.handleAgentTaskComplete() |
| `onStatusUpdate` | Worker calls report_status tool | OrchestratorService (forwards as progress) |

---

## 9. Socket.IO Protocol

### Server → Client Events

| Event | Channel | Payload | When |
|---|---|---|---|
| `stream` | team room | `{ sessionId, taskId, agentId, part, timestamp }` | Every AI SDK stream part (text, tools, reasoning) |
| `progress` | team room | `{ sessionId, taskId, agentId, type, content }` | Legacy thinking/tool progress events |
| `state` | team room | `{ sessionId, sessionState, plan?, timestamp }` | Plan/task state changes |
| `error` | team room | `{ taskId, error, timestamp }` | Worker or task failure |
| `message` | point-to-point | `{ sessionId, taskId, role, message }` | Worker direct chat response |
| `output` | point-to-point | `{ sessionId, taskId, agentId, output }` | Task output/artifact |
| `registered` | point-to-point | `{ clientId, userId, timestamp }` | Registration acknowledgment |

> **ask_user / tell_user** are NOT separate Socket.IO events. They are tool calls visible  
> in the `stream` channel as tool-input/tool-output parts, rendered as ToolCards.

### Client → Server Events

| Event | Payload | Handler |
|---|---|---|
| `message` | `{ teamId, agentId, content }` | → orchestratorMessage() or workerMessage() |
| `action` | `{ teamId, type, ...data }` | → handleAction() |
| `disconnect` | — | → cleanup |

> **User responses to ask_user** come through the existing `message` event.  
> SocketServerV2 routes mid-execution messages to `UserInteractionManager.resolveQuestion()`.

### Action Types (via `action` event)

| Type | Purpose | Handler |
|---|---|---|
| `approve-plan` | Approve pending plan | → AgentManager.approveOrchestratorPlan() |
| `auto-execute` | Toggle auto-execute mode | → AgentManager.setAutoExecute() |
| `get-state` | Request current state | → buildStateResponse() |
| `start` | Start a specific task | → AgentManager.startTask() |
| `complete` | Complete a task manually | → AgentManager.completeTask() |
| `cancel` | Cancel running task | → (not yet wired) |

### Stream Part Types (AI SDK Protocol + Ping Custom)

**AI SDK Data Stream Protocol:**
```
start, finish, abort
text-start, text-delta, text-end
reasoning-start, reasoning-delta, reasoning-end
tool-input-start, tool-input-delta, tool-input-available
tool-output-available
start-step, finish-step
error
```

**Ping Custom Stream Part Types:**
```
task-started, task-completed, task-failed    (task lifecycle)
artifact-state                               (workspace artifacts)
plan-proposed, plan-approved                 (plan lifecycle)
```

---

## 10. Tool Catalog

### Worker Tools (injected by WorkerPool per task)

| Category | Tools |
|---|---|
| **Lifecycle** | `report_status`, `complete_task` |
| **Workspace (L1)** | `workspace_create_file`, `workspace_write_file`, `workspace_read_file`, `workspace_list_files`, `workspace_delete_file`, `workspace_file_exists`, `workspace_grep`, `workspace_glob`, `workspace_keyword_search`, `workspace_search_and_replace`, `workspace_commit`, `workspace_publish`, `workspace_status`, `workspace_info`, `workspace_get_history`, `workspace_file_stats` |
| **Scratchpad** | `scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`, `promote_to_workspace` |
| **Collaboration (L2)** | `collab` (discover, list, read, read-block, write, write-block) |
| **Identity** | `who_am_i`, `my_progress`, `my_tools`, `my_context` |

### Planner Tools — 14 tools

> Legacy orchestrator tools (`create_plan`, `approve_plan`) have been removed. User interaction tools (`ask_user`, `tell_user`, `discuss_approach`) are implemented but intentionally excluded — planner uses natural language chat instead.

| Category | Tool | Purpose |
|---|---|---|
| **Knowledge** | `research_domain` | Deep-dive research on topic (stub — planner reasons directly) |
| | `analyze_requirements` | Decompose goal into requirements (stub) |
| | `get_team_capabilities` | Query available roles/skills |
| **Execution** | `submit_plan` | Submit plan with DAG validation |
| | `get_status` | Query task status |
| | `get_context` | Retrieve output manifests |
| | `cancel_task` | Cancel a running/pending task |
| | `get_blocked` | Query stuck tasks and reasons |
| | `get_critical_path` | Longest dependency chain |
| | `search_agents` | Find roles by capability |
| **Plan Mutation** | `update_task` | Modify task properties |
| | `add_tasks` | Inject new tasks into plan |
| | `remove_task` | Remove pending task |
| | `reprioritize` | Change task priority |
| | `replan` | Replace remaining plan entirely |

---

## 11. Data Models

### Task (MemoryManager)

```typescript
interface Task {
  id: string;                           // "task-1"
  description: string;                  // "Title: detailed description"
  assigned_role: string;                // "backend" (lowercase!)
  status: TaskStatus;                   // "pending" | "ready" | "in_progress" | "completed" | "failed"
  prerequisites: Map<string, boolean>;  // Map<depTaskId, isCompleted>
  dependants: string[];                 // tasks that depend on this one
  output?: any;                         // completion output
  context?: any;                        // task metadata (title, planId, goal, priority, etc.)
}
```

### Plan (PlanStore)

```typescript
interface AgentPlanOutput {
  planId: string;
  goal: string;
  tasks: TaskItem[];
}

interface TaskItem {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: number;
  complexity: "low" | "medium" | "high";
  dependencies: string[];
  onDependencyFail: "fail" | "skip" | "replan";
  expectedOutput: string;
  context?: { notes, files, artifacts, relatedTasks };
}
```

### Planner Types [NEW]

```typescript
// Plan mutation patch
interface TaskPatch {
  title?: string;
  description?: string;
  assignedRole?: string;
  priority?: TaskPriority;       // 1-5
  dependencies?: string[];
  expectedOutput?: string;
  context?: Partial<TaskContext>;
}

// User interaction
interface UserQuestion {
  id: string;
  from: "planner" | "worker";
  sourceId: string;
  question: string;
  options?: { label: string; description?: string }[];
  category?: "clarification" | "decision" | "approval" | "feedback";
}

// Worker failure
interface WorkerFailureReport {
  taskId: string;
  role: string;
  errorCategory: ErrorCategory;  // llm_error | tool_error | rate_limit | timeout | ...
  message: string;
  retriable: boolean;
  attemptNumber: number;
}

// Planner notification
type PlannerNotification =
  | { type: "task_completed"; taskId; role; summary; severity }
  | { type: "task_failed"; taskId; role; error; retriable; severity }
  | { type: "worker_stalled"; taskId; role; stallDurationMs; severity }
  | { type: "worker_died"; taskId; role; reason; severity }
  | { type: "plan_blocked"; blockedTaskIds; reason; severity }
  | { type: "execution_complete"; totalTasks; completed; failed; severity }
  | { type: "sla_warning"; taskId; elapsedMs; thresholdMs; severity };
```

---

## 12. Architectural Contracts

### Rules That Must NEVER Be Violated

| # | Contract | Enforcement |
|---|---|---|
| 1 | **Golden path works end-to-end** | Goal → Plan → Approve → Execute → Done |
| 2 | **Socket.IO is the ONLY event bus** | No new EventEmitters in any code |
| 3 | **Internal = direct callbacks** | Single consumer, full stack traces, no indirection |
| 4 | **Streaming = AsyncGenerator** | Backpressure preserved, type-safe chain |
| 5 | **Role keys are lowercase** | `assigned_role: "backend"`, not "Backend" |
| 6 | **Immutable state updates** | No `.push()` or `obj.prop = val` in React |
| 7 | **Tools use AI SDK format** | `tool()` from `ai` + Zod schema with `inputSchema` |
| 8 | **DAG must be validated** | DependencyResolver rejects cycles with path |
| 9 | **Guard rails on mutations** | Can't mutate in_progress/completed, can't create cycles |
| 10 | **Planner is the brain** | PlannerAgent is top-level agent. OrchestratorService is reactive runtime. Legacy orchestrator removed. |
| 11 | **No file creation without need** | Update existing, don't create duplicates |
| 12 | **Branching from dev** | Never push to main. Feature branches from dev. |

### Team Stacking Compatibility Contracts

| # | Contract | How Ensured |
|---|---|---|
| 1 | **Each team has its own planner** | PlannerAgent is per-team (scoped to AgentManager instance) |
| 2 | **NotificationTransport is pluggable** | Interface → SocketIOTransport / McpTransport (future) |
| 3 | **UserInteractionManager is per-team** | Scoped by constructor, no shared state |
| 4 | **DependencyResolver is per-team** | No shared DAG state, per-OrchestratorService instance |
| 5 | **Delegation uses IAgent interface** | ExternalAgent/TeamSubAgent wraps `execute() → AgentEvent` |
| 6 | **ask_user routing is configurable** | Transport decides where questions go (local / bubble up) |

### Event Refactor Target State

| Layer | Current | Target | Status |
|---|---|---|---|
| Agent → SocketServerV2 (streaming) | Callbacks (fire-and-forget) | AsyncGenerator (backpressure) | Planned (Step 1-2) |
| Task DAG lifecycle | Direct callbacks (RoleTaskQueue) | Direct callbacks (same) | **Done** ✅ |
| Internal coordination | Callbacks via setCallbacks() | Constructor injection | Partially done |
| Network boundary | Socket.IO emit | Socket.IO emit (same) | **Done** ✅ |
| Legacy EventEmitters | BaseAgent._emitter, TaskList.emitter | Remove entirely | Planned (Step 5) |

---

*This document is the authoritative reference for the Ping platform architecture. Update it when features ship. Verify against it before merging.*
