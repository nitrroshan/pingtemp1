# Agent Runtime — Architecture Diagrams & Gap Analysis

**Date:** May 8, 2026
**Purpose:** Comprehensive diagrams for the hooks+visitor refactor. Current state vs proposed state. Gaps identified for parallel goals + horizontal scaling.

---

## ⚠️ Reading note — current state vs target state

Diagrams show the **target Phase 1.7+ state** unless explicitly labelled "Current State". As of May 9 2026 PM-6, most of the bridge has closed. The two remaining gaps are documented bridges:

- **Stream path (Sequence Diagrams §3 / §4):** `WorkerPool` is now hooks-only and uses `factory.wire()` + `runWithHooks()`. Workers, planner, and ChatAgent all flow through the same visitor stack. The remaining bridge is that `StreamPublisherVisitor` forwards into `OrchestratorService.callbacks.onStream` and `SocketEventBroadcaster` still owns Socket.IO emit + persistence. Statements like "NO WorkerPool in the stream path" are accurate; "NO SocketEventBroadcaster" is the next deletion (Patch #3 follow-up).
- **Lifecycle tools (Sequence Diagram §5):** `assembleLifecycleTools` is still present and is the only path for assembling worker lifecycle tools. The `executionMode: "legacy" | "hooks"` switch was REMOVED May 9 2026 (debt patch #5) — hooks is the only mode. The assembler throws if `lifecycleHooks` is missing.
- **`AiSdkAgent.execute()`** AsyncGenerator is `@deprecated @internal`; production callers all use `runWithHooks()`. `runWithHooks` still consumes `execute()` internally — the next refactor (Patch #1 follow-up) drives `streamText` callbacks directly.

Do NOT delete `SocketEventBroadcaster` until Patch #3 lands its frontend Socket.IO channel migration.

---

## 1. Class Diagram — Current State (20 Classes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPOSITION ROOT                                     │
│                                                                              │
│  AgentManagerV2 ─────────────────────────────────────────────────────────┐   │
│  │ owns: WorkerPool, OrchestratorService, TaskStore, PluginRegistry      │   │
│  │ state: streamCallbacks, chatAgentsEnabled                             │   │
│  │ closures: createPlanner(self), createChatAgent(self)                   │   │
│  │ api: orchestratorMessage, approvePlan, chatAgentMessage               │   │
│  │ callback: registerStreamCallbacks() ←── SocketEventBroadcaster        │   │
│  └───────────────┬─────────────┬──────────────┬──────────────────────────┘   │
│                  │             │              │                               │
│    ┌─────────────▼──┐  ┌──────▼───────┐  ┌──▼──────────────┐               │
│    │  WorkerPool     │  │ OrchestratorSvc│  │  PluginRegistry  │              │
│    │  686 lines       │  │  682 lines    │  │  ~200 lines      │              │
│    │                  │  │               │  │                   │              │
│    │ 11 responsibilities│ │ owns:        │  │ plugins: Map      │              │
│    │ 8 setter methods │  │  GoalManager  │  │ getTools(ctx)     │              │
│    │ 10 callbacks     │  │  DispatchMgr  │  │ prepareForTask()  │              │
│    │ runTask (280 ln) │  │               │  │ onTaskComplete()  │              │
│    └───┬──────────────┘  │ dispatchTask  │  └───────────────────┘              │
│        │                 │  (90 lines)   │                                     │
│        │                 │               │                                     │
│    ┌───▼──────┐         │  ┌────────────▼─────────┐                           │
│    │AiSdkAgent│         │  │ GoalManager            │                          │
│    │687 lines │         │  │ 1066 lines             │                          │
│    │          │         │  │                        │                          │
│    │ 120-line │         │  │ goals: Map<id, GoalCtx>│                          │
│    │ mapping  │         │  │ activeGoalId (scalar)  │                          │
│    │ loop     │         │  │ approvePlan (130 ln)   │                          │
│    │          │         │  │ onWorkerDone (70 ln)   │                          │
│    │ yields   │         │  │ executePlannerTurn     │                          │
│    │AgentEvent│         │  │ handleTaskFailure      │                          │
│    └──────────┘         │  └───────────┬────────────┘                          │
│                         │              │                                       │
│                         │  ┌───────────▼───────┐  ┌────────────────┐          │
│                         │  │ DispatchManager    │  │ TaskStore       │         │
│                         │  │ ~200 lines ✅ Clean│  │ state machine   │         │
│                         │  │ per-goal budget    │  │ write-through   │         │
│                         │  └───────────────────┘  │ owns RoleTaskQ  │         │
│                         │                          └────────────────┘         │
│                         └────────────────────────────────────────────         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND API LAYER                                  │
│                                                                              │
│  SocketServerV2 ──── creates: Broadcaster, MessageHandler, ActionHandler    │
│       │                                                                      │
│  ┌────▼──────────────────┐  ┌────────────────────┐  ┌──────────────────┐   │
│  │SocketEventBroadcaster │  │SocketMessageHandler │  │SocketActionHandler│  │
│  │ 374 lines (DELETE)    │  │ 342 lines           │  │ 325 lines        │   │
│  │                       │  │                     │  │                   │   │
│  │ ensureTeamCallbacks() │  │ handleOrchestrator  │  │ handleApprovePlan │   │
│  │ accumulate + persist  │  │ handleChatAgent ⚠️  │  │ handleRejectPlan  │   │
│  │ broadcast to rooms    │  │ handleWorker        │  │ handleStartTask   │   │
│  │ WORKER_EVENT_ROUTES   │  │ unicast bug here    │  │ handleGetState    │   │
│  └───────────────────────┘  └────────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT CLASSES                                      │
│                                                                              │
│  BaseAgent (abstract) ──── IAgent interface                                 │
│       │                                                                      │
│  ┌────▼──────────┐  ┌──────────────┐  ┌──────────────┐                     │
│  │  AiSdkAgent    │  │ PlannerAgent  │  │  ChatAgent    │                    │
│  │  (687 lines)   │  │ (wraps IAgent)│  │ (wraps Agent) │                    │
│  │                │  │ 119 lines     │  │ 440 lines     │                    │
│  │ streamText()   │  │              │  │               │                    │
│  │ tools: Record  │  │ execute()    │  │ handleUserMsg │                    │
│  │ messages[]     │  │ setTools()   │  │ ingestUpdate  │                    │
│  └────────────────┘  └──────────────┘  └──────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           SUPPORT CLASSES                                    │
│                                                                              │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐             │
│  │ DependencyResolver│  │ NotificationQueue│  │ GoalEventBus    │            │
│  │ DAG operations    │  │ per-goal debounce│  │ 2-tier events   │            │
│  │ topological sort  │  │ → planner turns  │  │ projection +    │            │
│  │ cycle detection   │  │                  │  │ notification    │            │
│  └──────────────────┘  └─────────────────┘  └────────────────┘             │
│                                                                              │
│  ┌──────────────────┐  ┌─────────────────┐                                 │
│  │assembleLifecycle  │  │ AgentFactory     │                                │
│  │Tools ✅ Clean     │  │ (from YAML defs) │                                │
│  │ 4 tools + shared  │  │ createById()     │                                │
│  │ agentState        │  └─────────────────┘                                 │
│  └──────────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Class Diagram — Proposed State (After Refactor)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPOSITION ROOT                                     │
│                                                                              │
│  AgentManager (thin facade — delegates everything) ─────────────────────┐   │
│  │ api: orchestratorMessage, approvePlan, chatAgentMessage               │   │
│  │ NO closures, NO streamCallbacks, NO registerStreamCallbacks           │   │
│  └───────────────┬──────────────┬──────────────┬────────────────────────┘   │
│                  │              │              │                             │
│    ┌─────────────▼──┐  ┌───────▼────────┐  ┌─▼─────────────────┐          │
│    │ AgentFactory    │  │OrchestratorSvc │  │  PluginRegistry    │          │
│    │ (NEW ~150 ln)   │  │ (~580 lines)   │  │  (unchanged)      │          │
│    │                 │  │                │  └────────────────────┘          │
│    │ create(config)  │  │ handleMessage  │                                  │
│    │ buildStreaming   │  │ dispatchTask   │  ┌────────────────────┐         │
│    │  Hooks()        │  │  (simplified)  │  │ GoalManager         │        │
│    │ buildTaskLife   │  │                │  │  (unchanged except   │        │
│    │  cycleHooks()   │  │ owns:          │  │   executePlannerTurn │        │
│    │                 │  │  GoalManager   │  │   simplified)       │        │
│    │ creates visitors│  │  DispatchMgr   │  └────────────────────┘         │
│    │ wires hooks     │  └────────────────┘                                  │
│    └─────────────────┘                                                      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                    IAgent INTERFACE                                     │  │
│  │                                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │  AiSdkAgent   │  │ PlannerAgent  │  │  ChatAgent    │               │  │
│  │  │  (~400 lines) │  │ (unchanged)  │  │ (simplified)  │               │  │
│  │  │               │  │              │  │               │               │  │
│  │  │ onStreaming    │  │ onStreaming   │  │ onStreaming   │               │  │
│  │  │ onTaskLifecycle│  │ onTaskLife...│  │ onTaskLife... │               │  │
│  │  │ run(input)     │  │ run(input)   │  │ run(input)    │               │  │
│  │  │               │  │              │  │               │               │  │
│  │  │ streamText()   │  │ delegates to │  │ delegates to  │               │  │
│  │  │ hooks → visitors│ │ inner agent  │  │ inner agent   │               │  │
│  │  │ tools → hooks  │  │              │  │               │               │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │  │
│  │                                                                        │  │
│  │  Future adapters (same interface):                                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │HttpAgentAdptr│  │PingTeamAdptr │  │DockerAdptr   │                │  │
│  │  │ (future)     │  │ (future)     │  │ (future)     │                │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                    VISITORS (implemented once, shared)                  │  │
│  │                                                                        │  │
│  │  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐        │  │
│  │  │StreamPublisher   │  │ChannelBVisitor│  │CrdtStatusVisitor │        │  │
│  │  │ (~180 lines)     │  │ (~60 lines)  │  │ (~30 lines)      │        │  │
│  │  │                  │  │              │  │                   │        │  │
│  │  │ onChunk→Socket.IO│  │ onStepFinish │  │ onChunk → busy   │        │  │
│  │  │ onFinish→persist │  │  →progress   │  │ onFinish → idle  │        │  │
│  │  │ onPlanUpdate     │  │ onToolCall   │  └──────────────────┘        │  │
│  │  │  →state broadcast│  │  →milestones │                               │  │
│  │  │ onGoalStatusChg  │  │ onFinish     │  Future visitors:             │  │
│  │  │  →goal DB update │  │  →completed  │  ┌──────────────────┐        │  │
│  │  └──────────────────┘  └──────────────┘  │CostTrackingVistr │        │  │
│  │                                           │RedisStreamVistr  │        │  │
│  │                                           └──────────────────┘        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND API LAYER                                  │
│                                                                              │
│  SocketServerV2 ──── creates: StreamPublisher (visitor), MsgHandler, ActionH │
│       │             (SocketEventBroadcaster DELETED)                         │
│  ┌────▼──────────────────┐  ┌──────────────────┐                           │
│  │SocketMessageHandler    │  │SocketActionHandler│                          │
│  │ (~280 lines)           │  │ (~310 lines)     │                           │
│  │                        │  │                  │                           │
│  │ handleChatAgent:       │  │ handleApprovePlan:│                          │
│  │  agent.run() + visitors│  │  streamPublisher  │                          │
│  │  handle everything     │  │  .onPlanUpdate()  │                          │
│  │  (unicast bug FIXED)   │  │                   │                          │
│  └────────────────────────┘  └──────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘

UNCHANGED:
  TaskStore, DependencyResolver, DispatchManager, RoleTaskQueue,
  GoalEventBus, NotificationQueue, assembleLifecycleTools (refactored into agent),
  PluginRegistry
```

---

## 3. Sequence Diagram — Worker Task (Current: 10 Hops)

```
User        SocketMsgH   AgentMgr   OrchestratorSvc   DispatchMgr   GoalManager   WorkerPool   AiSdkAgent   assembleTools   SocketEvtBcaster   Socket.IO   MongoDB
 │              │            │            │               │              │             │            │              │                │              │          │
 │ goal msg     │            │            │               │              │             │            │              │                │              │          │
 │─────────────>│            │            │               │              │             │            │              │                │              │          │
 │              │ orchestratorMessage     │               │              │             │            │              │                │              │          │
 │              │───────────>│            │               │              │             │            │              │                │              │          │
 │              │            │ handleMessage              │              │             │            │              │                │              │          │
 │              │            │───────────>│               │              │             │            │              │                │              │          │
 │              │            │            │ executePlannerTurn           │             │            │              │                │              │          │
 │              │            │            │──────────────────────────────>│             │            │              │                │              │          │
 │              │            │            │               │              │ planner runs│            │              │                │              │          │
 │              │            │            │               │              │────────────────────────>│              │                │              │          │
 │              │            │            │               │              │             │ stream     │              │                │              │          │
 │              │            │            │               │              │ onPlannerStream (HOP 1)  │                │              │          │
 │              │            │            │               │              │<────────────────────────│              │                │              │          │
 │              │            │            │ onStream (HOP 2)             │             │            │              │                │              │          │
 │              │            │<───────────│               │              │             │            │              │                │              │          │
 │              │ streamCallbacks.onStream (HOP 3)       │              │             │            │              │                │              │          │
 │              │<───────────│            │               │              │             │            │              │                │              │          │
 │              │            │            │               │              │             │            │              │ onStream (HOP 4)│              │          │
 │              │────────────────────────────────────────────────────────────────────────────────────────────────>│              │          │
 │              │            │            │               │              │             │            │              │ io.emit (HOP 5)│              │          │
 │              │            │            │               │              │             │            │              │───────────────>│              │          │
 │ <── stream   │            │            │               │              │             │            │              │                │              │          │
 │              │            │            │               │              │             │            │              │                │              │          │
 │              │            │  PLAN APPROVED             │              │             │            │              │                │              │          │
 │              │            │            │               │              │             │            │              │                │              │          │
 │              │            │            │ onTaskReady   │              │             │            │              │                │              │          │
 │              │            │            │<──────────────────────────────│             │            │              │                │              │          │
 │              │            │            │ dispatch      │              │             │            │              │                │              │          │
 │              │            │            │──────────────>│              │             │            │              │                │              │          │
 │              │            │            │               │ executeTask  │             │            │              │                │              │          │
 │              │            │            │ dispatchTask()│              │             │            │              │                │              │          │
 │              │            │            │──────────────────────────────────────────>│            │              │                │              │          │
 │              │            │            │               │              │             │ runTask()  │              │                │              │          │
 │              │            │            │               │              │             │───────────>│              │                │              │          │
 │              │            │            │               │              │             │            │ assembleLT   │                │              │          │
 │              │            │            │               │              │             │            │─────────────>│                │              │          │
 │              │            │            │               │              │             │            │ pluginTools  │                │              │          │
 │              │            │            │               │              │             │            │ streamText() │                │              │          │
 │              │            │            │               │              │             │            │──────────┐   │                │              │          │
 │              │            │            │               │              │             │            │ for await │   │                │              │          │
 │              │            │            │               │              │             │            │ yields    │   │                │              │          │
 │              │            │            │               │              │             │ onStream   │<─────────┘   │                │              │          │
 │              │            │            │               │              │             │<───────────│              │                │              │          │
 │              │            │            │ cb.onStream   │              │             │            │              │                │              │          │
 │              │            │            │<──────────────────────────────────────────│            │              │                │              │          │
 │              │            │ cb.onStream│               │              │             │            │              │                │              │          │
 │              │            │<───────────│               │              │             │            │              │                │              │          │
 │              │ streamCB   │            │               │              │             │            │              │                │              │          │
 │              │<───────────│            │               │              │             │            │              │                │              │          │
 │              │            │            │               │              │             │            │              │ onStream       │              │          │
 │              │────────────────────────────────────────────────────────────────────────────────────────────────>│              │          │
 │              │            │            │               │              │             │            │              │ io.emit        │              │          │
 │              │            │            │               │              │             │            │              │───────────────>│              │          │
 │ <── stream   │            │            │               │              │             │            │              │                │              │          │
 │              │            │            │               │              │             │            │              │ on "finish":   │              │          │
 │              │            │            │               │              │             │            │              │ addMessage     │              │          │
 │              │            │            │               │              │             │            │              │───────────────────────────────────────>│
```

## 4. Sequence Diagram — Worker Task (Proposed: 2 Hops)

```
User     SocketMsgH   AgentMgr   OrchestratorSvc   DispatchMgr   AgentFactory   AiSdkAgent   StreamPublisher   ChannelB   Socket.IO   MongoDB
 │          │            │            │               │              │             │              │              │          │          │
 │ goal     │            │            │               │              │             │              │              │          │          │
 │─────────>│            │            │               │              │             │              │              │          │          │
 │          │ orchestratorMessage     │               │              │             │              │              │          │          │
 │          │───────────>│            │               │              │             │              │              │          │          │
 │          │            │ handleMessage              │              │             │              │              │          │          │
 │          │            │───────────>│               │              │             │              │              │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │ dispatch      │              │             │              │              │          │          │
 │          │            │            │──────────────>│              │             │              │              │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │ create(worker)│              │             │              │              │          │          │
 │          │            │            │──────────────────────────────>│             │              │              │          │          │
 │          │            │            │               │              │ new AiSdkAgent              │              │          │          │
 │          │            │            │               │              │ wire streaming hooks         │              │          │          │
 │          │            │            │               │              │ wire lifecycle hooks          │              │          │          │
 │          │            │            │               │              │ set tools                     │              │          │          │
 │          │            │            │ <── agent     │              │             │              │              │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │ agent.run(task)│             │             │              │              │          │          │
 │          │            │            │──────────────────────────────────────────>│              │              │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │               │              │             │ streamText() │              │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │               │              │             │ onChunk hook │              │          │          │
 │          │            │            │               │              │             │─────────────>│              │          │          │
 │          │            │            │               │              │             │              │ io.emit      │          │          │
 │          │            │            │               │              │             │              │─────────────────────────>│          │
 │ <── stream│           │            │               │              │             │              │              │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │               │              │             │ onStepFinish │              │          │          │
 │          │            │            │               │              │             │──────────────────────────────>│          │          │
 │          │            │            │               │              │             │              │     progress │          │          │
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │               │              │             │ onFinish hook│              │          │          │
 │          │            │            │               │              │             │─────────────>│              │          │          │
 │          │            │            │               │              │             │              │ addMessage   │          │          │
 │          │            │            │               │              │             │              │──────────────────────────────────>│
 │          │            │            │               │              │             │              │              │          │          │
 │          │            │            │ <── result    │              │             │              │              │          │          │
 │          │            │            │ autoComplete  │              │             │              │              │          │          │
 │          │            │            │ guard         │              │             │              │              │          │          │

 NO WorkerPool in the stream path.
 NO OrchestratorCallbacks forwarding.
 NO AgentManager.streamCallbacks.
 NO SocketEventBroadcaster.
 Agent → Hook → Visitor → Socket.IO. Done.
```

---

## 5. Sequence Diagram — Lifecycle Tool (complete_task) — Current vs Proposed

### Current: 9 Hops

```
LLM          completeTaskTool   assembleLifecycleTools   WorkerPool   OrchestratorSvc   GoalManager   PluginRegistry   TaskStore
 │ calls         │                    │                     │              │                │              │              │
 │ complete_task │                    │                     │              │                │              │              │
 │──────────────>│                    │                     │              │                │              │              │
 │               │ blocked guard     │                     │              │                │              │              │
 │               │ onComplete?()     │                     │              │                │              │              │
 │               │──────────────────>│                     │              │                │              │              │
 │               │                   │ cb.onAgentComplete  │              │                │              │              │
 │               │                   │───────────────────>│              │                │              │              │
 │               │                   │                     │ onAgentComplete               │              │              │
 │               │                   │                     │─────────────>│                │              │              │
 │               │                   │                     │              │ onWorkerDone   │              │              │
 │               │                   │                     │              │───────────────>│              │              │
 │               │                   │                     │              │                │ onTaskComplete│              │
 │               │                   │                     │              │                │─────────────>│              │
 │               │                   │                     │              │                │              │ completeTask │
 │               │                   │                     │              │                │              │─────────────>│
 │               │                   │                     │              │                │              │              │
 │<──────────────│ "Task complete"   │                     │              │                │              │              │
```

### Proposed: 3 Hops

```
LLM          AiSdkAgent.tool    onTaskLifecycle.onComplete     GoalManager   PluginRegistry   TaskStore
 │ calls         │                    │                           │              │              │
 │ complete_task │                    │                           │              │              │
 │──────────────>│                    │                           │              │              │
 │               │ this.onTaskLife    │                           │              │              │
 │               │ cycle.onComplete() │                           │              │              │
 │               │──────────────────>│                           │              │              │
 │               │                   │ goalManager.onWorkerDone  │              │              │
 │               │                   │─────────────────────────>│              │              │
 │               │                   │                           │ pluginReg    │              │
 │               │                   │                           │─────────────>│              │
 │               │                   │                           │ taskStore    │              │
 │               │                   │                           │──────────────────────────>│
 │               │                   │ { success: true }         │              │              │
 │               │                   │<─────────────────────────│              │              │
 │               │ <── { success }   │                           │              │              │
 │<──────────────│ "Task complete"   │                           │              │              │

 WorkerPool REMOVED from chain.
 assembleLifecycleTools REMOVED — tools built inside agent.
 OrchestratorService REMOVED from lifecycle path.
```

---

## 6. Data Flow Diagram — Parallel Goals (Proposed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GOAL A                        GOAL B                 │
│                                                                         │
│  User msg A                              User msg B                     │
│      │                                       │                          │
│      ▼                                       ▼                          │
│  messageChains["A"]                    messageChains["B"]              │
│  (independent promise)                 (independent promise)           │
│      │                                       │                          │
│      ▼                                       ▼                          │
│  GoalManager.goals["A"]               GoalManager.goals["B"]          │
│  ├── GoalContext A                     ├── GoalContext B               │
│  │   ├── planner A                     │   ├── planner B              │
│  │   ├── chatAgents Map A              │   ├── chatAgents Map B       │
│  │   └── state: executing             │   └── state: planning        │
│  │                                     │                               │
│  │  ┌──────────────┐                  │  ┌──────────────┐            │
│  │  │ Task A-1      │                  │  │ Task B-1      │           │
│  │  │ in_progress   │                  │  │ ready         │           │
│  │  │ worker: dev   │                  │  │ worker: qa    │           │
│  │  └──────┬────────┘                  │  └──────────────┘            │
│  │         │                           │                               │
│  │         ▼                           │                               │
│  │  AgentFactory.create()             │                               │
│  │  ├── AiSdkAgent                    │                               │
│  │  ├── onStreaming → visitors         │                               │
│  │  │   └── StreamPublisher            │                               │
│  │  │       └── io.to("goal:A").emit   │                               │
│  │  └── onTaskLifecycle → hooks        │                               │
│  │      └── GoalManager.onWorkerDone   │                               │
│  │                                     │                               │
│  │  DispatchManager                    │                               │
│  │  goalDispatchCounts["A"] = 1        │                               │
│  │  goalDispatchCounts["B"] = 0        │                               │
│  │  (per-goal budget: max 2 each)      │                               │
│  │                                     │                               │
│  │  CRDT: {teamId}/A/*                 │  CRDT: {teamId}/B/*          │
│  │  Socket: team:T:goal:A              │  Socket: team:T:goal:B       │
│  │  TaskStore: tasks with goalId=A     │  TaskStore: tasks goalId=B   │
│  │                                     │                               │
│  └─────────────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘

Key isolation points:
  ✅ messageChains: Map<goalId, Promise> — goals don't serialize
  ✅ DispatchManager: per-goal budget — goals don't starve each other
  ✅ GoalContext: per-goal planner + chatAgents — no shared state
  ✅ Socket.IO: per-goal rooms — no cross-goal stream bleed
  ✅ CRDT: per-goal namespace — no cross-goal doc access
  ✅ StreamContext: goalId scopes every visitor — correct room targeting

  ⚠️ GAP: TaskStore is global (single Map) — tasks from all goals in one Map
  ⚠️ GAP: DependencyResolver is global — DAG contains all goals' tasks
  ⚠️ GAP: PluginRegistry is global — all goals share same plugins
  ⚠️ GAP: WorkerPool definitions are global — all goals share same agent defs

  FIX (Phase 4): TaskStore + DependencyResolver move INTO GoalContext — per-goal scoped.
  Each goal owns its own task store and DAG. No cross-goal data. No getByGoal() filtering.

  GoalContext (after fix):
    ├── planner (per-goal)
    ├── chatAgents (per-goal)
    ├── taskStore (per-goal — NEW)
    └── dagResolver (per-goal — NEW)

  PluginRegistry stays global — correct, plugins are team-scoped.
  WorkerPool definitions stay global — correct, agent definitions are team-scoped.
```

---

## 7. Dependency Diagram — What Depends on What

```
                    ┌──────────────┐
                    │ SocketServerV2│
                    └──────┬───────┘
                           │ creates
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌─────────────┐ ┌──────────┐ ┌──────────┐
     │ MsgHandler   │ │ActionHndlr│ │StreamPub │
     └──────┬──────┘ └─────┬────┘ │(visitor)  │
            │              │      └──────┬────┘
            │              │             │
            └──────┬───────┘             │
                   ▼                     │
          ┌────────────────┐             │
          │  AgentManager   │◄────────────┘
          │  (facade)       │   uses StreamPublisher
          └───────┬────────┘   for plan/goal events
                  │
         ┌────────┼─────────────┐
         ▼        ▼             ▼
   ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │AgentFactory│ │OrchestrSvc│ │PluginRegistry│
   └─────┬────┘ └─────┬────┘ └──────────────┘
         │            │
         │     ┌──────┼──────────┐
         │     ▼      ▼          ▼
         │ ┌──────┐ ┌──────────┐ ┌──────────┐
         │ │GoalMgr│ │DispatchMgr│ │TaskStore │
         │ └──┬───┘ └──────────┘ └────┬─────┘
         │    │                       │
         │    │         ┌─────────────┤
         │    │         ▼             ▼
         │    │   ┌──────────┐  ┌──────────┐
         │    │   │DependRslvr│  │RoleTaskQ │
         │    │   └──────────┘  └──────────┘
         │    │
         │    ▼
         │ ┌───────────────┐  ┌──────────────┐
         │ │GoalEventBus   │  │NotificationQ │
         │ └───────────────┘  └──────────────┘
         │
         ▼
   ┌──────────────────────────────────────┐
   │            IAgent                     │
   │  ┌─────────┐ ┌────────┐ ┌─────────┐ │
   │  │AiSdkAgent│ │Planner │ │ChatAgent│ │
   │  └─────────┘ └────────┘ └─────────┘ │
   │                                       │
   │  hooks:                               │
   │  ├── onStreaming → visitors            │
   │  └── onTaskLifecycle → GoalManager    │
   └──────────────────────────────────────┘
```

---

## 8. Component Diagram — Horizontal Scaling (Phase 5)

```
┌─────────────────────────────────────────────────────────────────┐
│                        WEB SERVER PROCESS                        │
│                                                                  │
│  SocketServerV2 ←→ Socket.IO ←→ Browser                        │
│       │                                                          │
│  ┌────▼──────────┐                                              │
│  │ AgentManager   │  (No agents run here — just routing)        │
│  │ receives Redis │                                              │
│  │ events, emits  │                                              │
│  │ to Socket.IO   │                                              │
│  └────────────────┘                                              │
│       ▲                                                          │
│       │ Redis pub/sub                                            │
└───────┼──────────────────────────────────────────────────────────┘
        │
   ┌────▼────┐
   │  Redis   │  pub/sub + BullMQ queues
   └────┬────┘
        │
┌───────▼──────────────────────────────────────────────────────────┐
│                      WORKER PROCESS(ES)                           │
│                                                                   │
│  ┌────────────────┐                                              │
│  │ AgentFactory    │  Creates agents with LOCAL visitors:        │
│  │                 │                                              │
│  │  agent.onStreaming = {                                         │
│  │    onChunk: (chunk, ctx) => {                                 │
│  │      redis.publish(`stream:${ctx.goalId}`, chunk);  ← NEW    │
│  │    },                                                         │
│  │  };                                                           │
│  │                                                               │
│  │  agent.onTaskLifecycle = {                                    │
│  │    onComplete: async (output) => {                            │
│  │      await goalManager.onWorkerDone(...);  ← same as today   │
│  │    },                                                         │
│  │  };                                                           │
│  └────────────────┘                                              │
│                                                                   │
│  IAgent interface is IDENTICAL — same hooks, same visitors.      │
│  Only StreamPublisher swaps Socket.IO for Redis pub/sub.         │
│  Everything else is unchanged.                                    │
└──────────────────────────────────────────────────────────────────┘

Key: The IAgent interface + hooks design makes scaling a VISITOR SWAP.
     StreamPublisherVisitor → RedisStreamVisitor. One class change.
     No interface changes. No agent changes. No factory changes.
```

---

## 9. Gap Analysis — What the Refactor Doesn't Fix

### Gaps for Parallel Goals

| # | Gap | Where | Risk | Fix | When |
|---|-----|-------|------|-----|------|
| G1 | **TaskStore is global** | `tasks: Map<string, Task>` — all goals' tasks in one Map | Medium — works with `getByGoal()` but violates isolation principle | **Move TaskStore into GoalContext** — each goal owns its data | Phase 4 (parallel goals) |
| G2 | **DependencyResolver is global** | `nodes: Map<string, TaskNode>` — all goals' DAG in one graph | Medium — works with `rebuildForGoal()` but global state is a smell | **Move DependencyResolver into GoalContext** — each goal owns its DAG | Phase 4 (parallel goals) |
| G3 | **GoalContext in memory only** | `goals: Map<goalId, GoalContext>` — lost on restart | Medium — goals survive via PG, but GoalContext (planner instance, chatAgents) doesn't | GoalContext state → PostgreSQL. Agent instances recreated on recovery. | Phase 4.1 |
| G4 | **Planner not per-goal-persistent** | Planner conversation lost if process restarts mid-goal | Low — conversation persistence (save/restore) handles this | Already handled via loadConversationFn | ✅ Resolved |
| G5 | **WorkerPool definitions shared** | All goals use same agent definitions | Not a bug — definitions ARE team-scoped, not goal-scoped | Correct by design | N/A |
| G6 | **PluginRegistry shared** | All goals share same plugins | Not a bug — plugins ARE team-scoped, not goal-scoped | Correct by design | N/A |

### Gaps for Horizontal Scaling (Phase 5)

| # | Gap | Where | Risk | Fix |
|---|-----|-------|------|-----|
| S1 | **In-process Socket.IO** | `io.to(room).emit()` only works on local server | Blocked for multi-server | Redis adapter for Socket.IO (`@socket.io/redis-adapter`) |
| S2 | **In-memory TaskStore** | Worker process needs task state | Blocked for multi-server | TaskStore reads from PostgreSQL (already has write-through) |
| S3 | **In-memory GoalManager** | Worker process needs goal context | Blocked for multi-server | GoalContext → PostgreSQL (Phase 4.1) |
| S4 | **StreamPublisher needs io** | Visitor has Socket.IO server reference | Can't run in worker process | Swap to `RedisStreamVisitor` in worker process |
| S5 | **PluginRegistry in-process** | Plugins loaded once per process | Fine — both processes load plugins independently | OK |

### Gaps in Current Refactor Plan

| # | Gap | Where | Risk | Fix |
|---|-----|-------|------|-----|
| R1 | **`buildMessageWithContext()` orphaned** | WorkerPool L660-700 — builds context from inputDocs, upstream decisions | Medium — context enrichment may be lost if not ported | Verify overlap with `TaskContextBuilder.enrich()`. Port missing fields. |
| R2 | **`lastResponses` Map not addressed** | WorkerPool L640-645 | Low — used by `startTaskExecution()` | Keep in stripped WorkerPool |
| R3 | **`wireDiscussionEvents()` homeless** | SocketEventBroadcaster L350-385 | Medium — discussion events stop working | Move to SocketServerV2 |
| R4 | **`onPlanMutation` wiring** | AgentManagerV2 L310-313 — forwards to streamCallbacks + orchestrator | Medium — plan mutation events to frontend break | Wire through StreamPublisher.onPlanUpdate() |
| R5 | **`startTaskExecution()` direct streamCallbacks** | AgentManagerV2 L845 | Medium — manual task start doesn't broadcast state | Call StreamPublisher directly |
| R6 | **`completeTaskByUser()` direct streamCallbacks** | AgentManagerV2 L905 | Medium — user-initiated completion doesn't broadcast | Call StreamPublisher directly |
| R7 | **Smooth stream buffering** | AiSdkAgent's `SmoothStream` for word-boundary text buffering | Low — can be re-added as a stream transform or visitor | Defer — AI SDK's native streaming is already smooth enough |
| R8 | **Identity file writing** | WorkerPool L373-392 — writes `.ping/identity.json` to workspace | Low — move to AgentFactory or plugin prepareForTask | Move to AgentFactory.create() |
| R9 | **`streamedTasks` double-finish guard** | SocketEventBroadcaster closure — prevents duplicate finish events | Low — add to StreamPublisher | Easy fix |
| R10 | **Auto-complete guard timing** | OrchestratorService L630-655 — reads `completionSource` after `run()` returns | Already fixed — `onComplete` is awaited, sets `completionSource` before `run()` finishes | ✅ Resolved |
