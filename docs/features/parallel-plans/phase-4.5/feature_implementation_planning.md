# Phase 4.5 — Refactoring + Bug Resolution

> **Parent:** [feature_architecture.md](../feature_architecture.md)  
> **Audit:** [manager-solid-audit.md](../bugs/manager-solid-audit.md)  
> **Bug List:** [stream-isolation.md](../bugs/stream-isolation.md)  
> **Status:** Planning  
> **Branch:** `feature/parallel-plans-phase-4.5`  
> **Depends on:** Parallel Plans v1.0 (Phase 4 ✅), v1.1 Steps 1–3 ✅  
> **Scope:** Full SOLID refactoring + all 4 stream isolation bugs + all previously-deferred cleanup. Nothing deferred.

## What's Already Done (v1.0 + v1.1 Steps 1–3)

- GoalContext Map + execution mutex + auto-advance (backend)
- Per-goal ChatAgent lifecycle via callbacks (backend)
- goal:stateChange Socket.IO event + PlanList component (frontend)
- Task filtering by goalId in sidebar (frontend)
- Per-goal chat history via goalPrefix key (frontend)
- "+ New Plan" button in sidebar (frontend)

## What This Phase Delivers

| # | Item | Type | Effort |
|---|------|------|--------|
| 1 | Move PlannerAgent + ChatAgent ownership into GoalManager | Refactor | 1.5d |
| 2 | PP-001: Add goalId to all stream events (backend) | Bug | 0.5d |
| 3 | PP-002: Frontend filters streams by goalId | Bug | 0.5d |
| 4 | PP-003: Per-goal planner instances (real, no shared fallback) | Bug | 0.5d |
| 5 | PP-004: Goal-scoped Socket.IO rooms | Bug | 1d |
| 6 | Extract TaskContextBuilder from OrchestratorService.dispatchTask() | Refactor | 0.5d |
| 7 | Extract DispatchManager (concurrency + retry) from OrchestratorService | Refactor | 0.5d |
| 8 | Delete legacy V1 API from AgentManagerV2 | Cleanup | 0.5d |
| 9 | Move auto-approve logic from AgentManagerV2 to OrchestratorService | Refactor | 0.5d |
| **Total** | | | **6 days** |

Steps 1 and 4 overlap (planner moves into GoalManager = per-goal planners). Steps 6–9 are independent of each other.

---

## Event Flow Diagrams

### Current Event Flow (BEFORE Phase 4.5)

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │                    BACKEND                                  │
                         │                                                             │
  User message ──────────┤► SocketServerV2                                             │
  (Socket.IO)            │    │                                                        │
                         │    ▼                                                        │
                         │  AgentManagerV2.orchestratorMessage(content)                 │
                         │    │                                                        │
                         │    ▼                                                        │
                         │  OrchestratorService.handleMessage(content)                  │
                         │    │                                                        │
                         │    ├──► callbacks.onPlannerInput(content)                    │
                         │    │     │                                                   │
                         │    │     ▼                                                   │
                         │    │   AgentManagerV2 closure: executePlannerTurn()           │
                         │    │     │  ⚠️ Uses shared plannerAgent (PP-003)             │
                         │    │     ▼                                                   │
                         │    │   PlannerAgent.execute() → yields stream_part           │
                         │    │     │                                                   │
                         │    │     ▼                                                   │
                         │    │   streamCallbacks.onStream({ taskId, agentId, part })   │
                         │    │     │  ⚠️ NO goalId (PP-001)                            │
                         │    │     ▼                                                   │
                         │    │   SocketServerV2 → io.to("team:{id}").emit("stream")   │
                         │    │     │  ⚠️ Team-scoped room, ALL clients (PP-004)        │
                         │    │     ▼                                                   │
                         │    │   FRONTEND: useOrchestration onStream handler           │
                         │    │     ⚠️ No goalId filter (PP-002)                        │
                         │    │                                                        │
                         │    │   [Planner calls submit_plan tool]                      │
                         │    │     ▼                                                   │
                         │    │   GoalManager.approvePlan()                             │
                         │    │     │                                                   │
                         │    │     ├──► callbacks.onEnableChatAgentsForGoal(goalId)    │
                         │    │     │     └► AgentManagerV2.enableChatAgentsForGoal()   │
                         │    │     │        ⚠️ Roundtrip callback (SOLID violation)    │
                         │    │     │                                                   │
                         │    │     ├──► TaskStore.create() per task                    │
                         │    │     └──► callbacks.onDispatchTask(taskId, role)          │
                         │    │           │                                             │
                         │    ▼           ▼                                             │
                         │  OrchestratorService.handleReadyTask(taskId, role)            │
                         │    │                                                        │
                         │    ├──► [ChatAgent path] chatAgentDispatch(taskId, role)     │
                         │    │     └► ChatAgent.handleTask() → directDispatchTask()   │
                         │    │                                                        │
                         │    └──► [Direct path] dispatchTask(taskId, role)             │
                         │          │  ⚠️ ~150 lines of context enrichment inline      │
                         │          ▼                                                   │
                         │        WorkerPool.runTask(task)                              │
                         │          │                                                   │
                         │          ▼                                                   │
                         │        AiSdkAgent.execute() → yields stream_part             │
                         │          │                                                   │
                         │          ▼                                                   │
                         │        callbacks.onStream({ taskId, agentId, part })         │
                         │          │  ⚠️ NO goalId (PP-001)                            │
                         │          ▼                                                   │
                         │        OrchestratorService.callbacks.onStream(data)           │
                         │          ▼                                                   │
                         │        AgentManagerV2.streamCallbacks.onStream(data)          │
                         │          ▼                                                   │
                         │        SocketServerV2 → io.to("team:{id}").emit("stream")   │
                         │                                                             │
                         │  ── Channel B (Task Updates) ──                              │
                         │                                                             │
                         │  WorkerPool.onAgentComplete(data)                            │
                         │    ▼                                                        │
                         │  GoalManager.onWorkerDone(data)                              │
                         │    ├──► TaskStore.completeTask()                             │
                         │    │     ▼                                                   │
                         │    │   RoleTaskQueue → onTaskComplete callback               │
                         │    │     ▼                                                   │
                         │    │   GoalManager.onTaskComplete()                          │
                         │    │     ├──► Check all-done → auto-advance                 │
                         │    │     └──► callbacks.onNotifyPlanner(msg)                 │
                         │    │           ▼                                             │
                         │    │         NotificationQueue.push() → debounce             │
                         │    │           ▼                                             │
                         │    │         executePlannerTurn(batchedMsg)                  │
                         │    │                                                        │
                         │    └──► callbacks.onWorkerTaskUpdate(update)                 │
                         │          ├──► ChatAgent.ingestTaskUpdate()                   │
                         │          └──► SocketServerV2 → "taskUpdate" event            │
                         └─────────────────────────────────────────────────────────────┘
```

### Target Event Flow (AFTER Phase 4.5)

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │                    BACKEND                                  │
                         │                                                             │
  User message ──────────┤► SocketServerV2                                             │
  (Socket.IO)            │    │                                                        │
                         │    ▼                                                        │
                         │  AgentManagerV2.orchestratorMessage(content)                 │
                         │    │  (composition root — delegates only)                    │
                         │    ▼                                                        │
                         │  OrchestratorService.handleMessage(content)                  │
                         │    │                                                        │
                         │    ▼                                                        │
                         │  GoalManager.executePlannerTurn(goalId, content)              │
                         │    │  ✅ Per-goal PlannerAgent (from GoalContext)             │
                         │    ▼                                                        │
                         │  PlannerAgent.execute() → yields stream_part                 │
                         │    │                                                        │
                         │    ▼                                                        │
                         │  config.onPlannerStream({ goalId, part })                    │
                         │    │  ✅ goalId included at source                           │
                         │    ▼                                                        │
                         │  AgentManagerV2.streamCallbacks.onStream({ ..., goalId })    │
                         │    │                                                        │
                         │    ▼                                                        │
                         │  SocketServerV2 → io.to("team:{id}:goal:{goalId}")           │
                         │    │  ✅ Goal-scoped room                                    │
                         │    ▼                                                        │
                         │  FRONTEND: useOrchestration onStream handler                 │
                         │    ✅ Filters by goalId (defense-in-depth)                   │
                         │                                                             │
                         │  [Planner calls submit_plan tool]                            │
                         │    ▼                                                        │
                         │  GoalManager.approvePlan()                                   │
                         │    │                                                        │
                         │    ├──► GoalManager.enableChatAgentsForGoal(goalId)          │
                         │    │     ✅ Direct call, no callback roundtrip               │
                         │    │                                                        │
                         │    ├──► TaskStore.create() per task                          │
                         │    └──► callbacks.onDispatchTask(taskId, role)                │
                         │          │                                                   │
                         │          ▼                                                   │
                         │  DispatchManager.handleReadyTask(taskId, role)                │
                         │    │  ✅ Extracted from OrchestratorService                  │
                         │    │  ✅ Concurrency + retry in one place                    │
                         │    │                                                        │
                         │    ├──► [ChatAgent path]                                    │
                         │    │     GoalManager.getChatAgent(goalId, role)              │
                         │    │       .handleTask() → directDispatchTask()             │
                         │    │                                                        │
                         │    └──► dispatchTask(taskId, role)                           │
                         │          │                                                   │
                         │          ├──► TaskContextBuilder.enrich(task)                │
                         │          │     ✅ Extracted pure function                    │
                         │          ▼                                                   │
                         │        WorkerPool.runTask(task)                              │
                         │          │                                                   │
                         │          ▼                                                   │
                         │        AiSdkAgent.execute() → yields stream_part             │
                         │          │                                                   │
                         │          ▼                                                   │
                         │        callbacks.onStream({ taskId, agentId, part, goalId }) │
                         │          │  ✅ goalId from task metadata                     │
                         │          ▼                                                   │
                         │        → SocketServerV2 → "team:{id}:goal:{goalId}" room     │
                         │                                                             │
                         │  ── Channel B (Task Updates) ──                              │
                         │  (unchanged — already works, just gains goalId)              │
                         │                                                             │
                         │  WorkerPool.onAgentComplete → GoalManager.onWorkerDone       │
                         │    → TaskStore.completeTask → RoleTaskQueue callbacks         │
                         │    → GoalManager.onTaskComplete → check all-done             │
                         │    → GoalManager.executePlannerTurn(goalId, statusMsg)        │
                         │                                                             │
                         └─────────────────────────────────────────────────────────────┘

  ── Socket.IO Room Architecture ──

  team:{teamId}                      ← Team-wide events
    ├── goal:stateChange             ← All goals status (all clients)
    ├── state                        ← Orchestrator state
    └── progress                     ← Orchestration logs

  team:{teamId}:goal:{goalId}       ← Goal-scoped events
    ├── stream                       ← AI stream parts (planner + workers)
    └── taskUpdate                   ← Channel B task lifecycle

  Client subscribes: socket.emit("subscribeToGoal", { teamId, goalId })
  On plan switch:    leave old goal room → join new goal room
```

### Callback Chain (Current vs Target)

```
CURRENT (⚠️ 4-layer callback roundtrip):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GoalManager.approvePlan()
  └──► callbacks.onEnableChatAgentsForGoal(goalId, roles)     ← callback to...
        └──► OrchestratorCallbacks.onEnableChatAgentsForGoal  ← ...passes through to...
              └──► AgentManagerV2.enableChatAgentsForGoal()    ← ...actual logic here
                    └──► new ChatAgent({ ... })                ← creates agent

GoalManager.onTaskComplete() → all done
  └──► callbacks.onDisposeChatAgentsForGoal(goalId)
        └──► OrchestratorCallbacks.onDisposeChatAgentsForGoal
              └──► AgentManagerV2.disposeChatAgentsForGoal()
                    └──► chatAgent.dispose()

executePlannerTurn() (in AgentManagerV2 closure):
  └──► this.planners.get(goalId) || this.plannerAgent          ← SHARED FALLBACK


TARGET (✅ direct ownership):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GoalManager.approvePlan()
  └──► this.enableChatAgentsForGoal(goalId, roles)             ← direct method
        └──► goal.chatAgents.set(role, createChatAgent(...))   ← factory call

GoalManager.onTaskComplete() → all done
  └──► this.disposeGoalAgents(goal)                            ← direct method
        ├── goal.planner = null
        └── goal.chatAgents.clear()

GoalManager.executePlannerTurn(goalId, message):
  └──► goal.planner.getAgent().execute(...)                    ← per-goal, no fallback
```

### Sequence Diagram — Full Event Flow with Payloads

Shows every event name, payload shape, and channel for a complete goal lifecycle: user submits goal → planner plans → tasks execute → completion.

```
 Browser           AgentServiceV2        SocketServerV2         AgentManagerV2        OrchestratorSvc       GoalManager         PlannerAgent         WorkerPool          AiSdkAgent
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │  PHASE A: CONNECTION + REGISTRATION
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │ socket.connect()   │                     │                      │                     │                    │                    │                    │                   │
   │ ──────────────────►│                     │                      │                     │                    │                    │                    │                   │
   │                    │ emit("register",    │                      │                     │                    │                    │                    │                   │
   │                    │  {userId,token?})   │                      │                     │                    │                    │                    │                   │
   │                    │ ───────────────────►│                      │                     │                    │                    │                    │                   │
   │                    │                     │ socket.join(         │                     │                    │                    │                    │                   │
   │                    │                     │  "team:{teamId}")    │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │  emit("registered", │                      │                     │                    │                    │                    │                   │
   │                    │  {clientId,userId,  │                      │                     │                    │                    │                    │                   │
   │                    │   timestamp})       │                      │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │  emit("state",      │                      │                     │                    │                    │                    │                   │
   │                    │  {sessionId,        │                      │                     │                    │                    │                    │                   │
   │                    │   sessionState,     │                      │                     │                    │                    │                    │                   │
   │                    │   plan?,            │                      │                     │                    │                    │                    │                   │
   │                    │   autoExecute,      │                      │                     │                    │                    │                    │                   │
   │                    │   timestamp})       │                      │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │  PHASE B: USER SUBMITS GOAL → PLANNER STREAMS
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │ sendMessage(goal)  │                     │                      │                     │                    │                    │                    │                   │
   │ ──────────────────►│                     │                      │                     │                    │                    │                    │                   │
   │                    │ emit("message",     │                      │                     │                    │                    │                    │                   │
   │                    │  {teamId,           │                      │                     │                    │                    │                    │                   │
   │                    │   content: goal,    │                      │                     │                    │                    │                    │                   │
   │                    │   agentId:"manager",│                      │                     │                    │                    │                    │                   │
   │                    │   sessionId})       │                      │                     │                    │                    │                    │                   │
   │                    │ ───────────────────►│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │ orchestratorMessage  │                     │                    │                    │                    │                   │
   │                    │                     │  (content)           │                     │                    │                    │                    │                   │
   │                    │                     │ ────────────────────►│                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │ handleMessage        │                    │                    │                    │                   │
   │                    │                     │                      │  (content)           │                    │                    │                    │                   │
   │                    │                     │                      │ ───────────────────►│                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │ setState            │                    │                    │                   │
   │                    │                     │                      │                     │  ("executing")      │                    │                    │                   │
   │                    │                     │                      │                     │ ──────────────────►│                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │ callbacks           │                    │                    │                   │
   │                    │                     │                      │                     │  .onPlannerInput    │                    │                    │                   │
   │                    │                     │                      │                     │  (content)          │                    │                    │                   │
   │                    │                     │                      │ ◄───────────────────│                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │ executePlannerTurn   │                    │                    │                    │                   │
   │                    │                     │                      │  (message)           │                    │                    │                    │                   │
   │                    │                     │                      │ ─────────────────────────────────────────────────────────────►│                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │  execute(           │                    │                   │
   │                    │                     │                      │                     │                    │   {message,         │                    │                   │
   │                    │                     │                      │                     │                    │    threadId:        │                    │                   │
   │                    │                     │                      │                     │                    │    "team-{id}"})    │                    │                   │
   │                    │                     │                      │                     │                    │  ─────────────────►│                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │    ┌──────────────────────────┐         │                   │
   │                    │                     │                      │                     │                    │    │ LLM streaming loop:      │         │                   │
   │                    │                     │                      │                     │                    │    │ yields AgentEvent:       │         │                   │
   │                    │                     │                      │                     │                    │    │  {type:"stream_part",    │         │                   │
   │                    │                     │                      │                     │                    │    │   part: StreamPart}      │         │                   │
   │                    │                     │                      │                     │                    │    └──────────────────────────┘         │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │  ◄─── yield {type:"stream_part", part:{type:"start", messageId}} ──────────────│                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │  streamCallbacks     │                     │                    │                    │                    │                   │
   │                    │                     │   .onStream(         │                     │                    │                    │                    │                   │
   │                    │                     │    {taskId:"team-x", │                     │                    │                    │                    │                   │
   │                    │                     │     agentId:"planner"│                     │                    │                    │                    │                   │
   │                    │                     │     part:{type:      │                     │                    │                    │                    │                   │
   │                    │                     │      "start",...}})  │                     │                    │                    │                    │                   │
   │                    │                     │ ◄────────────────────│                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │  io.to("team:{id}") │                      │                     │                    │                    │                    │                   │
   │                    │   .emit("stream",   │                      │                     │                    │                    │                    │                   │
   │                    │    {sessionId,       │                      │                     │                    │                    │                    │                   │
   │                    │     taskId,          │                      │                     │                    │                    │                    │                   │
   │                    │     agentId:"planner"│                      │                     │                    │                    │                    │                   │
   │                    │     part:{type:      │                      │                     │                    │                    │                    │                   │
   │                    │      "start",...},   │                      │                     │                    │                    │                    │                   │
   │                    │     timestamp})      │                      │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │ onStreamPart(      │                     │                      │                     │                    │                    │                    │                   │
   │  "planner",        │                     │                      │                     │                    │                    │                    │                   │
   │  {type:"start"})   │                     │                      │                     │                    │                    │                    │                   │
   │ ◄─────────────────│                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │     ┌─ REPEATS for each part: text-delta, reasoning-delta, tool-input-*, tool-output-*, finish ─┐        │                    │                   │
   │     │  Same flow: PlannerAgent → executePlannerTurn → streamCallbacks.onStream → Socket "stream" │        │                    │                   │
   │     └────────────────────────────────────────────────────────────────────────────────────────────┘        │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │  PHASE C: PLANNER CALLS submit_plan TOOL → AUTO-APPROVE → TASK DISPATCH
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │  [tool-call:        │                    │                   │
   │                    │                     │                      │                     │                    │   submit_plan({     │                    │                   │
   │                    │                     │                      │                     │                    │    goal, tasks[]})  │                    │                   │
   │                    │                     │                      │                     │                    │  ──────────────────►│(tool executes)     │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │ setPendingPlan      │                   │
   │                    │                     │                      │                     │                    │                    │  (plan)             │                   │
   │                    │                     │                      │                     │                    │ ◄───────────────────│                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │  callbacks           │                    │                    │                    │                   │
   │                    │                     │                      │   .onPlanProposed(   │                    │                    │                    │                   │
   │                    │                     │                      │    {plan,teamId,     │                    │                    │                    │                   │
   │                    │                     │                      │     timestamp})      │                    │                    │                    │                   │
   │                    │                     │                      │ ◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │ approveOrchestrator  │                    │                    │                    │                   │
   │                    │                     │                      │  Plan() [auto]       │                    │                    │                    │                   │
   │                    │                     │                      │ ────────────────────►│                    │                    │                    │                   │
   │                    │                     │                      │                     │ approvePlan()       │                    │                    │                   │
   │                    │                     │                      │                     │ ──────────────────►│                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ ┌──────────────────────────────────────┐│                   │
   │                    │                     │                      │                     │                    │ │ For each task in plan:               ││                   │
   │                    │                     │                      │                     │                    │ │  TaskStore.create({                  ││                   │
   │                    │                     │                      │                     │                    │ │   id, title, description,            ││                   │
   │                    │                     │                      │                     │                    │ │   assigned_role, status:"pending",   ││                   │
   │                    │                     │                      │                     │                    │ │   goalId, planId,                    ││                   │
   │                    │                     │                      │                     │                    │ │   prerequisites: Map<id,bool>})      ││                   │
   │                    │                     │                      │                     │                    │ │                                      ││                   │
   │                    │                     │                      │                     │                    │ │ goal.state = "executing"             ││                   │
   │                    │                     │                      │                     │                    │ │ DependencyResolver.rebuild()         ││                   │
   │                    │                     │                      │                     │                    │ └──────────────────────────────────────┘│                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ callbacks           │                    │                   │
   │                    │                     │                      │                     │                    │  .onPlanApproved(   │                    │                   │
   │                    │                     │                      │                     │                    │   {planId,teamId,   │                    │                   │
   │                    │                     │                      │                     │                    │    tasksQueued,     │                    │                   │
   │                    │                     │                      │                     │                    │    timestamp})      │                    │                   │
   │                    │                     │                      │                     │ ◄─────────────────│                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │  io.to("team:{id}") │                     │                    │                    │                    │                   │
   │                    │                     │   .emit("state",     │                     │                    │                    │                    │                   │
   │                    │                     │    {sessionState:     │                     │                    │                    │                    │                   │
   │                    │                     │     "executing",     │                     │                    │                    │                    │                   │
   │                    │                     │     plan:[tasks]})   │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ ── RoleTaskQueue resolves deps ──      │                   │
   │                    │                     │                      │                     │                    │  onTaskReady({taskId, role})           │                   │
   │                    │                     │                      │                     │                    │ ──────────────────►│                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ callbacks           │                    │                   │
   │                    │                     │                      │                     │                    │  .onDispatchTask    │                    │                   │
   │                    │                     │                      │                     │                    │  (taskId, role)     │                    │                   │
   │                    │                     │                      │                     │ ◄─────────────────│                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │ handleReadyTask    │                    │                    │                   │
   │                    │                     │                      │                     │  (taskId, role)    │                    │                    │                   │
   │                    │                     │                      │                     │ ─ ─ ─ ─ ─ ─ ─ ─ ─│ (concurrency check) │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │  PHASE D: WORKER EXECUTION + STREAMING
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │ dispatchTask       │                    │                    │                   │
   │                    │                     │                      │                     │  (taskId, role)    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │ callbacks.onTask   │                    │                    │                   │
   │                    │                     │                      │                     │  Update({taskId,   │                    │                    │                   │
   │                    │                     │                      │                     │  status:           │                    │                    │                   │
   │                    │                     │                      │                     │  "in_progress",    │                    │                    │                   │
   │                    │                     │                      │                     │  role, timestamp}) │                    │                    │                   │
   │                    │                     │                      │                     │ ─ ─ ─ ─ ─ ─ ─ ─ ► │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │  emit("stream",{part:│{type:"task-started",│taskId,role}})      │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │  workerPool        │                    │                    │                   │
   │                    │                     │                      │                     │   .runTask(        │                    │                    │                   │
   │                    │                     │                      │                     │    {id,role,       │                    │                    │                   │
   │                    │                     │                      │                     │     description,   │                    │                    │                   │
   │                    │                     │                      │                     │     context})      │                    │                    │                   │
   │                    │                     │                      │                     │ ──────────────────────────────────────────────────────────►│                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │ execute(          │
   │                    │                     │                      │                     │                    │                    │                    │  {message,        │
   │                    │                     │                      │                     │                    │                    │                    │   threadId})      │
   │                    │                     │                      │                     │                    │                    │                    │ ────────────────►│
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │   ┌──────────────┐│
   │                    │                     │                      │                     │                    │                    │                    │   │ streamText() ││
   │                    │                     │                      │                     │                    │                    │                    │   │ + tool loop  ││
   │                    │                     │                      │                     │                    │                    │                    │   └──────────────┘│
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │  callbacks.onStream│                   │
   │                    │                     │                      │                     │                    │                    │   ({taskId,        │                   │
   │                    │                     │                      │                     │                    │                    │    agentId:role,   │                   │
   │                    │                     │                      │                     │                    │                    │    part:{type:     │                   │
   │                    │                     │                      │                     │                    │                    │     "text-delta",  │                   │
   │                    │                     │                      │                     │                    │                    │     delta:"..."}}) │                   │
   │                    │                     │                      │                     │                    │                    │ ◄──────────────────│                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │ callbacks.onStream │                    │                    │                   │
   │                    │                     │                      │                     │  ({taskId,agentId, │                    │                    │                   │
   │                    │                     │                      │                     │   part})           │                    │                    │                   │
   │                    │                     │                      │ ◄───────────────────│                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │ streamCallbacks     │                    │                    │                    │                   │
   │                    │                     │                      │  .onStream({taskId, │                    │                    │                    │                   │
   │                    │                     │                      │   agentId,part})    │                    │                    │                    │                   │
   │                    │                     │ ◄────────────────────│                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │  io.to("team:{id}") │                      │                     │                    │                    │                    │                   │
   │                    │   .emit("stream",   │                      │                     │                    │                    │                    │                   │
   │                    │    {sessionId,       │                      │                     │                    │                    │                    │                   │
   │                    │     taskId,          │                      │                     │                    │                    │                    │                   │
   │                    │     agentId:role,    │                      │                     │                    │                    │                    │                   │
   │                    │     part:{type:      │                      │                     │                    │                    │                    │                   │
   │                    │      "text-delta",   │                      │                     │                    │                    │                    │                   │
   │                    │      delta:"..."},   │                      │                     │                    │                    │                    │                   │
   │                    │     timestamp})      │                      │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  processStreamPart │                     │                      │                     │                    │                    │                    │                   │
   │   (agentId, part)  │                     │                      │                     │                    │                    │                    │                   │
   │ ◄─────────────────│                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │     ┌─ REPEATS for each stream_part: text-delta, tool-input-*, tool-output-*, reasoning-delta ──┐        │                    │                   │
   │     │  Same flow: AiSdkAgent → WorkerPool.onStream → Orch.onStream → AM.streamCB → Socket.IO   │        │                    │                   │
   │     └───────────────────────────────────────────────────────────────────────────────────────────┘        │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │  PHASE E: WORKER COMPLETION → DEPENDENCY RESOLUTION → NEXT TASK
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │  [Agent calls      │                   │
   │                    │                     │                      │                     │                    │                    │   complete_task     │                   │
   │                    │                     │                      │                     │                    │                    │   tool]             │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │  callbacks          │                   │
   │                    │                     │                      │                     │                    │                    │   .onAgentComplete( │                   │
   │                    │                     │                      │                     │                    │                    │    {taskId, role,   │                   │
   │                    │                     │                      │                     │                    │                    │     summary,        │                   │
   │                    │                     │                      │                     │                    │                    │     deliverables[], │                   │
   │                    │                     │                      │                     │                    │                    │     nextSteps[],    │                   │
   │                    │                     │                      │                     │                    │                    │     timestamp})     │                   │
   │                    │                     │                      │                     │                    │                    │ ◄──────────────────│                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ onWorkerDone(data)  │                    │                   │
   │                    │                     │                      │                     │ ◄─────────────────│                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ TaskStore           │                    │                   │
   │                    │                     │                      │                     │                    │  .completeTask(     │                    │                   │
   │                    │                     │                      │                     │                    │   taskId, {summary, │                    │                   │
   │                    │                     │                      │                     │                    │   deliverables})    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ ── RoleTaskQueue ── │                    │                   │
   │                    │                     │                      │                     │                    │  resolves downstream│                    │                   │
   │                    │                     │                      │                     │                    │  prerequisites      │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ onTaskComplete(     │                    │                   │
   │                    │                     │                      │                     │                    │  {taskId, output})  │                    │                   │
   │                    │                     │                      │                     │                    │ ─(self-call)──────►│                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ [if all tasks done  │                    │                   │
   │                    │                     │                      │                     │                    │  for this goal:]    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │ callbacks           │                    │                   │
   │                    │                     │                      │                     │                    │  .onGoalStatus      │                    │                   │
   │                    │                     │                      │                     │                    │  Change({teamId,    │                    │                   │
   │                    │                     │                      │                     │                    │   status:           │                    │                   │
   │                    │                     │                      │                     │                    │   "completed"})     │                    │                   │
   │                    │                     │                      │                     │ ◄─────────────────│                    │                    │                   │
   │                    │                     │                      │ ◄───────────────────│                    │                    │                    │                   │
   │                    │                     │ ◄────────────────────│                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │  io.to("team:{id}") │                      │                     │                    │                    │                    │                   │
   │                    │   .emit(            │                      │                     │                    │                    │                    │                   │
   │                    │    "goal:stateChange"│                     │                    │                    │                    │                   │
   │                    │    {teamId, goalId,  │                      │                     │                    │                    │                    │                   │
   │                    │     state:"done",   │                      │                     │                    │                    │                    │                   │
   │                    │     allGoals:        │                      │                     │                    │                    │                    │                   │
   │                    │      GoalSummary[]}) │                      │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │ plans[] updated    │                     │                      │                     │                    │                    │                    │                   │
   │ PlanList re-renders│                     │                      │                     │                    │                    │                    │                   │
   │ ◄─────────────────│                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │  CHANNEL B — COARSE TASK UPDATES (parallel to Channel A streaming)
   │  ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │  WorkerPool emits  │                   │
   │                    │                     │                      │                     │                    │                    │  callbacks          │                   │
   │                    │                     │                      │                     │                    │                    │   .onTaskUpdate(    │                   │
   │                    │                     │                      │                     │                    │                    │    TaskUpdate)      │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │  TaskUpdate types:   │                    │                    │                    │                   │
   │                    │                     │                      │  ┌──────────────────────────────────────────────────────────┐ │                    │                   │
   │                    │                     │                      │  │ {type:"started",   taskId, role, ts}                     │ │                    │                   │
   │                    │                     │                      │  │ {type:"progress",  taskId, role, note, pct?, ts}         │ │                    │                   │
   │                    │                     │                      │  │ {type:"tool_milestone", taskId, role, tool, summary, ts} │ │                    │                   │
   │                    │                     │                      │  │ {type:"blocked",   taskId, role, reason, ts}             │ │                    │                   │
   │                    │                     │                      │  │ {type:"completed", taskId, role, summary, ts}            │ │                    │                   │
   │                    │                     │                      │  │ {type:"failed",    taskId, role, error, ts}              │ │                    │                   │
   │                    │                     │                      │  │ {type:"ask_user",  taskId, role, question, ts}           │ │                    │                   │
   │                    │                     │                      │  └──────────────────────────────────────────────────────────┘ │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │ callbacks            │                    │                    │                    │                   │
   │                    │                     │                      │  .onWorkerTaskUpdate │                    │                    │                    │                   │
   │                    │                     │                      │  (TaskUpdate)        │                    │                    │                    │                   │
   │                    │                     │                      │ ──────────┐          │                    │                    │                    │                   │
   │                    │                     │                      │           │          │                    │                    │                    │                   │
   │                    │                     │                      │  ChatAgent│.ingest   │                    │                    │                    │                   │
   │                    │                     │                      │  TaskUpdate(update)  │                    │                    │                    │                   │
   │                    │                     │                      │           │          │                    │                    │                    │                   │
   │                    │                     │ streamCallbacks      │           │          │                    │                    │                    │                   │
   │                    │                     │  .onWorkerTaskUpdate │ ◄─────────┘          │                    │                    │                    │                   │
   │                    │                     │  (TaskUpdate)        │                     │                    │                    │                    │                   │
   │                    │                     │ ◄────────────────────│                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │                    │  io.to("team:{id}") │                      │                     │                    │                    │                    │                   │
   │                    │   .emit(            │                      │                     │                    │                    │                    │                   │
   │                    │    "task_update",   │                      │                     │                    │                    │                    │                   │
   │                    │    TaskUpdate)      │                      │                     │                    │                    │                    │                   │
   │                    │ ◄───────────────────│                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
   │ Sidebar task       │                     │                      │                     │                    │                    │                    │                   │
   │  status updates    │                     │                      │                     │                    │                    │                    │                   │
   │ ◄─────────────────│                     │                      │                     │                    │                    │                    │                   │
   │                    │                     │                      │                     │                    │                    │                    │                   │
```

### Key: Event Payload Reference

| Event | Direction | Payload |
|-------|-----------|---------|
| `register` | Client→Server | `{ userId: string; token?: string }` |
| `registered` | Server→Client | `{ clientId, userId, timestamp }` |
| `message` | Client→Server | `{ teamId, content, agentId, sessionId? }` |
| `message` | Server→Client | `{ sessionId, agentId, taskId?, content, timestamp }` |
| `state` | Server→Client | `{ sessionId, sessionState, plan?: Task[], autoExecute?, timestamp }` |
| `stream` | Server→Client | `{ sessionId, taskId?, agentId, part: StreamPart, timestamp }` |
| `goal:stateChange` | Server→Client | `{ teamId, goalId, state, allGoals: GoalSummary[] }` |
| `task_update` | Server→Client | `TaskUpdate` (7 discriminated union types — see Channel B box) |
| `action` | Client→Server | `{ teamId, type: "approve-plan"\|"start-task"\|..., taskId?, enabled? }` |

| StreamPart.type | Payload Fields |
|-----------------|----------------|
| `start` | `{ messageId }` |
| `text-delta` | `{ id, delta: string }` |
| `reasoning-delta` | `{ id, delta: string }` |
| `tool-input-available` | `{ toolCallId, toolName, input }` |
| `tool-output-available` | `{ toolCallId, toolName, output }` |
| `finish` | `{ messageId, finishReason, usage? }` |
| `task-started` | `{ taskId, role }` (Ping-specific) |
| `plan-proposed` | `{ plan, teamId }` (Ping-specific) |
| `plan-approved` | `{ planId, tasksQueued }` (Ping-specific) |

---

## Step 1: Move PlannerAgent + ChatAgent Ownership into GoalManager (1.5d)

### Problem

AgentManagerV2 owns `plannerAgent`, `planners Map`, and `chatAgents Map` — all per-goal resources. GoalManager already owns per-goal state but fires callbacks to AgentManagerV2 to create/dispose agents. This roundtrip is the root cause of PP-003 (shared planner) and creates coupling that makes stream isolation harder.

### Design

**GoalContext gains agent fields:**

```typescript
// packages/agent-manager/src/orchestrator/types.ts
interface GoalContext {
  goalId: string;
  state: OrchestratorState;
  pendingPlan: any | null;
  currentPlanId: string | null;
  title: string;
  createdAt: number;
  // NEW — per-goal agents
  planner: PlannerAgent | null;
  chatAgents: Map<string, ChatAgent>;
}
```

**GoalManager gets a factory for creating goal agents:**

```typescript
// packages/agent-manager/src/orchestrator/GoalManager.ts
interface GoalManagerConfig {
  // ... existing fields ...
  // NEW: factory to create a PlannerAgent for a goal
  createPlanner: (goalId: string) => Promise<PlannerAgent>;
  // NEW: factory to create ChatAgents for a goal
  createChatAgent: (goalId: string, role: string) => ChatAgent;
  // NEW: stream callback for planner events
  onPlannerStream: (data: { goalId: string; part: any }) => void;
}
```

**AgentManagerV2 provides the factories (composition root job):**

```typescript
// In AgentManagerV2.initializeOrchestrator():
const createPlanner = async (goalId: string): Promise<PlannerAgent> => {
  const planner = new PlannerAgent({ agentFactory, teamRoles, teamId });
  await planner.initialize();
  const goalContext = { ...orchestratorContext, currentGoalId: goalId };
  const tools = createPlannerTools({ orchestratorContext: goalContext, agentFactory, dagResolver, onMutation });
  await planner.setTools(tools);
  return planner;
};

const createChatAgent = (goalId: string, role: string): ChatAgent => {
  return new ChatAgent({
    role: role.toLowerCase(), teamId, goalId,
    taskStore: this.taskStoreInstance!,
    onDispatchTask: (taskId, r) => this.orchestrator!.directDispatchTask(taskId, r),
    onNotifyPlanner: (msg) => this.orchestrator!.notifyPlannerFromRole(msg),
    loadConversation: this.loadConversationFn
      ? () => this.loadConversationFn!(teamId, `chat-${goalId}-${role.toLowerCase()}`)
      : undefined,
  });
};
```

### Files Changed

| File | Changes |
|------|---------|
| `orchestrator/types.ts` | Add `planner`, `chatAgents` to `GoalContext`. Update `GoalManagerConfig` with factories. Remove `onEnableChatAgentsForGoal`, `onDisposeChatAgentsForGoal` from `GoalManagerCallbacks`. |
| `orchestrator/GoalManager.ts` | `getOrCreateGoal()` initializes `planner: null, chatAgents: new Map()`. Add `enableChatAgentsForGoal(goalId, roles)` — calls `createChatAgent` factory. Add `disposeChatAgentsForGoal(goalId)` — disposes + clears. Add `executePlannerTurn(goalId, message)` — runs planner and yields stream events. Add `getChatAgent(goalId, role)`. In `approvePlan()` — call `enableChatAgentsForGoal` directly (remove callback). In auto-advance — call directly. |
| `orchestrator/OrchestratorService.ts` | Update constructor — pass new factories through to GoalManager. Remove `onEnableChatAgentsForGoal`/`onDisposeChatAgentsForGoal` from callbacks. Update `_handleMessage()` to call `goalManager.executePlannerTurn()` instead of `onPlannerInput` callback. |
| `AgentManagerV2.ts` | Remove `plannerAgent`, `planners Map`, `chatAgents Map`. Remove `enableChatAgents()`, `enableChatAgentsForGoal()`, `disposeChatAgentsForGoal()`, `chatAgentKey()`. Keep `getChatAgent()` — delegate to `orchestrator.goalManager.getChatAgent()`. Keep `chatAgentMessage()` — delegate to `orchestrator.goalManager`. Provide `createPlanner` and `createChatAgent` factories in orchestrator config. Remove `onEnableChatAgentsForGoal`/`onDisposeChatAgentsForGoal` from callback wiring. |

### Entry/Exit Criteria

**Entry:** Build passes, single-goal flow works.  
**Exit:** 
- GoalManager owns planner + ChatAgents per goal.
- No `plannerAgent` or `chatAgents` Map on AgentManagerV2.
- AgentManagerV2 delegates `getChatAgent()` and `chatAgentMessage()` to GoalManager.
- `onEnableChatAgentsForGoal`/`onDisposeChatAgentsForGoal` callbacks removed.
- Single-goal flow still works (no regressions).
- Build passes.

### Risk

Medium — large structural change. Test thoroughly after each sub-step:
1. First: add fields to GoalContext, update types → build.
2. Then: add factory params to GoalManagerConfig, update constructor → build.
3. Then: move planner logic → test single-goal planning.
4. Then: move ChatAgent logic → test ChatAgent message routing.
5. Then: remove old fields from AgentManagerV2 → build + test.

---

## Step 2: PP-001 — Add goalId to All Stream Events (0.5d)

### Problem

Stream events flow from WorkerPool → OrchestratorService → AgentManagerV2 → SocketServerV2 → Frontend. The `onStream` callback payload is `{ taskId, agentId, part }` — no goalId. SocketServerV2 emits to a team-scoped room, and the frontend can't distinguish which goal a stream belongs to.

### Design

**Add goalId at the source (WorkerPool):**

WorkerPool knows which goal a task belongs to via the task's `goalId` field (set during `approvePlan`). The `onStream` callback should include it.

**Thread goalId through every layer:**

```
WorkerPool.onStream({ taskId, agentId, part, goalId })      ← ADD
  ↓
OrchestratorService.callbacks.onStream(data)                  ← PASS-THROUGH
  ↓
AgentManagerV2.streamCallbacks.onStream(data)                 ← PASS-THROUGH
  ↓
SocketServerV2 → io.emit("stream", { ...payload, goalId })   ← EMIT
```

For planner streams (from `executePlannerTurn`), goalId comes from GoalManager (after Step 1, the planner is per-goal — goalId is known).

For ChatAgent streams, goalId comes from the ChatAgent's `goalId` property.

### Files Changed

| File | Changes |
|------|---------|
| `services/WorkerPool.ts` | Update `WorkerCallbacks.onStream` type: add `goalId?: string`. In `runTask()`, look up task's goalId from task services and include in callback: `this.callbacks.onStream?.({ taskId, agentId: roleKey, part: event.part, goalId: task?.goalId })`. |
| `orchestrator/types.ts` | Update `OrchestratorCallbacks.onStream` type: add `goalId?: string`. |
| `AgentManagerV2.ts` | Update `ManagerStreamCallbacks.onStream` type: add `goalId?: string`. Pass-through in callback wiring (already done — callbacks just forward). |
| `backend/api/SocketServerV2.ts` | In `ensureTeamCallbacks` `onStream` handler: include `goalId: data.goalId` in `StreamPayload`. In `handleOrchestratorMessage` stream emission: include `goalId: manager.getCurrentGoalId()`. In `handleChatAgentMessage` stream emission: include `goalId` from the chat agent's message payload. |
| `orchestrator/GoalManager.ts` | In `executePlannerTurn()` (from Step 1): include `goalId` in stream callback data. |

### Entry/Exit Criteria

**Entry:** Step 1 complete (planner in GoalManager — goalId available at source).  
**Exit:**
- Every `stream` Socket.IO event includes `goalId` field.
- Planner streams have the goal's goalId.
- Worker streams have the task's goalId.
- ChatAgent streams have the chatAgent's goalId.
- Frontend receives goalId in stream payload (verified via browser devtools).

---

## Step 3: PP-002 — Frontend Filters Streams by goalId (0.5d)

### Problem

`useOrchestration.ts` routes stream events by `agentId` only. When two goals are executing (or one is executing while viewing another), all streams appear in the active chat view.

### Design

**Add a ref tracking the currently viewed goalId:**

```typescript
// useOrchestration.ts
const activePlanGoalIdRef = useRef<string | null>(null);

// Update whenever activePlanId changes (caller passes this via prop/param)
useEffect(() => {
  activePlanGoalIdRef.current = activePlanGoalId ?? null;
}, [activePlanGoalId]);
```

**Filter in the stream handler:**

```typescript
const unsubStream = agentServiceV2.onStream((payload: any) => {
  if (!payload?.part) return;
  const { part, agentId: streamAgentId, goalId: streamGoalId } = payload;

  // Goal isolation: skip streams from other goals
  if (streamGoalId && activePlanGoalIdRef.current 
      && streamGoalId !== activePlanGoalIdRef.current) {
    return;
  }

  // ... existing routing logic unchanged
});
```

**Also filter task updates and progress events:**

```typescript
const unsubTaskUpdate = agentServiceV2.onTaskUpdate((update: any) => {
  if (!update?.taskId) return;
  // Goal isolation for Channel B
  if (update.goalId && activePlanGoalIdRef.current 
      && update.goalId !== activePlanGoalIdRef.current) {
    return; // Skip task updates from other goals
  }
  // ... existing logic
});
```

### Files Changed

| File | Changes |
|------|---------|
| `hooks/useOrchestration.ts` | Add `activePlanGoalId` parameter. Add `activePlanGoalIdRef`. Filter in `onStream` handler. Filter in `onTaskUpdate` handler. |
| `App.tsx` | Pass `activePlanGoalId` to `useOrchestration()`. |
| `services/AgentServiceV2.ts` | No changes (goalId already in payload from Step 2). |

### Edge Cases

- **No activePlanGoalId** (first load, no plan selected): Don't filter — show all streams (backward compat).
- **Plan switch mid-stream**: Filter immediately — old goal's in-flight streams stop appearing. Chat history for old goal persists in `chatHistories` under its goalPrefix key (v1.1 Step 2).
- **Single plan mode** (`plans.length <= 1`): activePlanGoalId may be null — no filter applied.

### Entry/Exit Criteria

**Entry:** Step 2 complete (goalId in stream payloads).  
**Exit:**
- Two goals active → switching plans shows only the selected goal's chat.
- Old goal's in-flight streams don't leak into new goal's view.
- Single-goal mode works unchanged.
- Orchestration logs still show for correct goal.

---

## Step 4: PP-003 — Per-Goal Planner Instances (0.5d)

### Problem

AgentManagerV2 has `plannerAgent` (default) and `planners Map` — but `executePlannerTurn` falls back to the shared planner:

```typescript
let planner = this.planners.get(goalId) || this.plannerAgent; // ← shared fallback!
```

This means goal-1's planner conversation leaks into goal-2 if goal-2 reuses the default planner.

### Design

**Solved by Step 1.** Once PlannerAgent moves into GoalContext:
- Each goal gets its own planner via `createPlanner(goalId)` factory.
- No shared fallback — `GoalManager.executePlannerTurn(goalId)` always uses `goal.planner`.
- If `goal.planner` is null, create one lazily via the factory.

**Key change in GoalManager:**

```typescript
async executePlannerTurn(goalId: string, message: string): Promise<void> {
  const goal = this.getOrCreateGoal(goalId);
  if (!goal.planner) {
    goal.planner = await this.createPlanner(goalId);
  }
  const agent = goal.planner.getAgent();
  const sessionId = `team-${this.teamId}:goal-${goalId}`;
  for await (const event of agent.execute({ message, threadId: sessionId })) {
    if (event.type === "stream_part") {
      this.config.onPlannerStream({ goalId, part: event.part });
    }
  }
}
```

**Cleanup on goal completion:**

```typescript
private disposeGoalAgents(goal: GoalContext): void {
  // Dispose planner
  if (goal.planner) {
    goal.planner = null; // PlannerAgent doesn't have a dispose method currently
  }
  // Dispose ChatAgents
  for (const [, agent] of goal.chatAgents) {
    agent.dispose();
  }
  goal.chatAgents.clear();
}
```

### Files Changed

Same files as Step 1 — this is part of the refactor, not a separate step. Listed here for traceability against the bug doc.

### Entry/Exit Criteria

**Entry:** Step 1 complete.  
**Exit:**
- Two goals submit simultaneously → each gets its own planner instance.
- Goal-1's planner conversation never appears in goal-2's thread.
- Planner is cleaned up when goal completes.
- `plannerAgent` field removed from AgentManagerV2.

---

## Step 5: PP-004 — Goal-Scoped Socket.IO Rooms (1d)

### Problem

SocketServerV2 joins all sockets to `team:{teamId}` room. All stream events emit to this room — every client connected to the team receives everything. Steps 2+3 add client-side filtering (goalId on events + frontend filter), which works. But it wastes bandwidth and creates a race condition: client processes + discards events that aren't for the active goal.

### Design

**Goal-scoped rooms alongside team rooms:**

```
team:{teamId}              — team-wide events (goal:stateChange, state, progress)
team:{teamId}:goal:{goalId} — goal-specific events (stream, task updates)
```

**Backend: SocketServerV2 changes**

1. New event: `subscribeToGoal` — client requests to join a goal room.

```typescript
// SocketServerV2.ts — in connection handler
socket.on("subscribeToGoal", ({ teamId, goalId }) => {
  // Leave previous goal room (if any)
  const prevGoalRoom = socket.data.currentGoalRoom;
  if (prevGoalRoom) socket.leave(prevGoalRoom);
  
  const goalRoom = `team:${teamId}:goal:${goalId}`;
  socket.join(goalRoom);
  socket.data.currentGoalRoom = goalRoom;
});
```

2. Stream events emit to goal room:

```typescript
// In ensureTeamCallbacks onStream:
const goalRoom = data.goalId 
  ? `team:${teamId}:goal:${data.goalId}` 
  : room;  // fallback to team room if no goalId
this.io.to(goalRoom).emit("stream", payload);
```

3. Team-wide events still go to team room:

```typescript
// goal:stateChange — always team room
this.io.to(room).emit("goal:stateChange", data);
// state — always team room
this.io.to(room).emit("state", stateResponse);
```

4. Task updates (Channel B) go to goal room:

```typescript
// onWorkerTaskUpdate:
const goalRoom = update.goalId
  ? `team:${teamId}:goal:${update.goalId}`
  : room;
this.io.to(goalRoom).emit("taskUpdate", update);
```

**Frontend: AgentServiceV2 changes**

```typescript
// AgentServiceV2.ts
subscribeToGoal(teamId: string, goalId: string): void {
  this.socket.emit("subscribeToGoal", { teamId, goalId });
}
```

**Frontend: App.tsx changes**

```typescript
// When activePlanGoalId changes, subscribe to the new goal room
useEffect(() => {
  if (selectedTeamId && activePlanGoalId) {
    agentServiceV2.subscribeToGoal(selectedTeamId, activePlanGoalId);
  }
}, [selectedTeamId, activePlanGoalId]);
```

### Why Not Defer

The SOLID audit said "defer to v2.0" but the user asked for no deferrals. Goal-scoped rooms are cleaner than client-side filtering alone:
- Reduces wasted bandwidth (especially with multiple concurrent goals).
- Prevents race conditions where a stream part arrives between plan switch and filter update.
- Works correctly with multiple browser tabs viewing different goals.
- Socket.IO rooms are cheap — no performance concern.

Client-side filtering (Step 3) is kept as defense-in-depth.

### Files Changed

| File | Changes |
|------|---------|
| `backend/api/SocketServerV2.ts` | Add `subscribeToGoal` event handler. Update stream emit to use goal room when goalId available. Update task update emit similarly. Keep team-wide events on team room. |
| `frontend/services/AgentServiceV2.ts` | Add `subscribeToGoal(teamId, goalId)` method. |
| `frontend/App.tsx` | Effect to call `subscribeToGoal` when `activePlanGoalId` changes. |

### Entry/Exit Criteria

**Entry:** Steps 2+3 complete (goalId on events + frontend filter).  
**Exit:**
- Client joins `team:X:goal:Y` room on plan select.
- Stream events only reach clients subscribed to that goal's room.
- Team-wide events (goal:stateChange, state) still reach all clients.
- Two tabs viewing different goals receive only their goal's streams.
- Switching goals leaves old room, joins new room.
- Build passes, single-goal mode unaffected.

---

## Step 6: Extract TaskContextBuilder from OrchestratorService (0.5d)

### Problem

`OrchestratorService.dispatchTask()` is ~230 lines. Of that, ~150 lines is pure data assembly: reading upstream outputs, building CRDT refs, resolving cross-plan references, injecting team roster, building discussion protocols. This is a pure function buried in a class method — untestable and violates SRP.

### Design

Extract a stateless `TaskContextBuilder` class with one public method:

```typescript
// packages/agent-manager/src/orchestrator/TaskContextBuilder.ts

export interface TaskContextInput {
  task: Task;
  role: string;
  teamRoles: string[];
  crdtSync?: any;       // resolved CRDT proxy
  planStore?: any;       // for cross-plan reference resolution
}

export interface EnrichedTask {
  enrichedDescription: string;
  contextPayload: { previousOutputs: any[]; artifacts: string[]; crdtRefs?: any };
}

export class TaskContextBuilder {
  /**
   * Enrich a task description with upstream context, CRDT refs, 
   * cross-plan references, team roster, and discussion protocol.
   * Pure function — no side effects, no state mutation.
   */
  static async enrich(input: TaskContextInput): Promise<EnrichedTask> {
    // ... moved from dispatchTask lines ~580-750
  }
}
```

**What stays in dispatchTask():**
1. Guard check (task exists, not completed/failed)
2. Status update to `in_progress`
3. Callbacks (onTaskUpdate, onProgress)
4. CRDT collab doc initialization (side effect — stays in dispatch)
5. `const enriched = await TaskContextBuilder.enrich(...)` ← delegate
6. `await this.workerPool.runTask(enriched)` ← dispatch
7. Auto-complete logic (post-runTask)

**dispatchTask() shrinks from ~230 lines to ~50 lines.**

### Files Changed

| File | Changes |
|------|---------|
| `orchestrator/TaskContextBuilder.ts` | **NEW** — extracted pure function (~150 lines) |
| `orchestrator/OrchestratorService.ts` | Shrink `dispatchTask()` — delegate enrichment to TaskContextBuilder |

### Entry/Exit Criteria

**Entry:** Steps 1–5 complete.  
**Exit:**
- `dispatchTask()` is ≤60 lines.
- `TaskContextBuilder.enrich()` is independently callable.
- Build passes. Single-goal flow produces same enriched descriptions as before.

---

## Step 7: Extract DispatchManager (Concurrency + Retry) from OrchestratorService (0.5d)

### Problem

OrchestratorService has 3 distinct dispatch concerns tangled together:
- **Concurrency**: `activeDispatches Set`, `MAX_CONCURRENT_DISPATCHES`, `deferredDispatches` queue, `drainDeferredDispatches()`
- **Retry**: `taskAttempts Map`, `MAX_TASK_RETRIES`, `classifyError()`, exponential backoff timer
- **Routing**: `handleReadyTask()`, `chatAgentDispatch` callback, `manualDispatch()`

These are ~120 lines of cross-cutting logic. Extracting them makes OrchestratorService purely about message routing + state queries.

### Design

```typescript
// packages/agent-manager/src/orchestrator/DispatchManager.ts

export interface DispatchManagerConfig {
  maxConcurrent: number;    // default 2
  maxRetries: number;       // default 3
  chatAgentDispatch?: (taskId: string, role: string) => Promise<void>;
  executeTask: (taskId: string, role: string) => Promise<void>;
  getTask: (taskId: string) => Task | undefined;
  onTaskUpdate?: (data: any) => void;
}

export class DispatchManager {
  private activeDispatches = new Set<string>();
  private deferredDispatches: Array<{ taskId: string; role: string }> = [];
  private taskAttempts = new Map<string, number>();

  constructor(private config: DispatchManagerConfig) {}

  /** Main entry — handles concurrency limit, routing, deferral */
  dispatch(taskId: string, role: string): void { ... }

  /** Manual dispatch — serialized, caller awaits */
  async manualDispatch(taskId: string): Promise<void> { ... }

  /** Handle error — classify, retry or fail permanently */
  handleError(taskId: string, role: string, error: unknown): void { ... }

  /** Drain deferred queue when a slot opens */
  private drainDeferred(): void { ... }
}
```

**OrchestratorService becomes:**
- Owns `DispatchManager` (injected)
- `handleReadyTask()` → `this.dispatchManager.dispatch(taskId, role)`
- `manualDispatch()` → `this.dispatchManager.manualDispatch(taskId)`
- Error handling in `dispatchTask()` catch → `this.dispatchManager.handleError()`

### Files Changed

| File | Changes |
|------|---------|
| `orchestrator/DispatchManager.ts` | **NEW** — concurrency + retry (~120 lines) |
| `orchestrator/OrchestratorService.ts` | Remove `activeDispatches`, `deferredDispatches`, `taskAttempts`, `drainDeferredDispatches()`, retry catch block. Replace with `DispatchManager` delegation. |
| `orchestrator/types/workerTypes.ts` | No change — `classifyError()` stays (it's already standalone) |

### Entry/Exit Criteria

**Entry:** Step 6 complete (or independent).  
**Exit:**
- `activeDispatches`, `deferredDispatches`, `taskAttempts` no longer on OrchestratorService.
- Retry backoff logic lives in DispatchManager.
- OrchestratorService has no `setTimeout` calls.
- Build passes. Concurrency limit still enforced.

---

## Step 8: Delete Legacy V1 API from AgentManagerV2 (0.5d)

### Problem

AgentManagerV2 carries ~450 lines of deprecated V1 methods that are never called by any active code path:

| Method | Lines | Called by |
|--------|-------|-----------|
| `setupCompletionHandler()` | 1347-1360 | Constructor (dead — overridden by OrchestratorService init) |
| `queueReadyDependents()` | 1363-1386 | `setupCompletionHandler` only |
| `queuePlannedTask()` | 1388-1420 | `queueReadyDependents`, `executeAllTasks` only |
| `configureWorkflow()` | 1423-1460 | `run()`, `configureNewWorkflow()` only |
| `createPlan()` | 1463-1500 | `run()`, `configureNewWorkflow()` only |
| `startTask()` | 1520-1534 | `executeAllTasks()` only |
| `executeAllTasks()` | 1564-1640 | `run()` only |
| `run()` | 1772-1786 | Nothing |
| `configureNewWorkflow()` | 1808-1823 | Nothing |

Also delete the supporting types/fields they use:
- `private plan: TaskPlan | null`
- `private taskOutputs = new Map<string, any>()`
- `private taskRoles = new Map<string, string>()` (if unused by V2)
- Interface `PlannedTask`, interface `TaskPlan` (top of file)

### Design

**Straight deletion.** No replacement needed. These were the V1 workflow that was fully replaced by the OrchestratorService + PlannerAgent + TaskStore pipeline.

The constructor call `this.setupCompletionHandler()` sets callbacks on `taskQueue` (RoleTaskQueue) — but OrchestratorService's `initialize()` overwrites them via `taskStore.setQueueCallbacks()`. So the constructor call is dead code.

### Files Changed

| File | Changes |
|------|---------|
| `AgentManagerV2.ts` | Delete ~450 lines: 9 methods + supporting fields + `PlannedTask`/`TaskPlan` interfaces. Remove `this.setupCompletionHandler()` from constructor. |

### Entry/Exit Criteria

**Entry:** None (independent of other steps).  
**Exit:**
- AgentManagerV2 is ~400 lines shorter.
- `PlannedTask`, `TaskPlan` interfaces removed.
- `run()`, `configureWorkflow()`, `createPlan()`, `executeAllTasks()` deleted.
- Build passes. No test failures.
- `RoleTaskQueue` import may become unused → remove if so.

### Risk

Low. All deleted methods log `[DEPRECATED]` and are only called by each other.

Verify: `packages/backend/cli/index.ts` has its own `createPlan()` method — that's a different function on a different class. Not affected.

---

## Step 9: Move Auto-Approve Logic from AgentManagerV2 to OrchestratorService (0.5d)

### Problem

Auto-approve is a workflow concern (should a task auto-start when it becomes ready?) but it lives in the composition root (AgentManagerV2). It's 7 methods + 2 properties (~90 lines) that access TaskStore and OrchestratorService — domain logic, not wiring.

### Design

Move into OrchestratorService (where `autoExecute` already lives — auto-approve is a refinement of auto-execute):

```typescript
// packages/agent-manager/src/orchestrator/OrchestratorService.ts

// New properties
private autoApproveRoles = new Set<string>();
private autoApproveAll = false;

// Public API (same signatures — moved from AgentManagerV2)
setAutoApproveForRole(role: string, enabled: boolean): void { ... }
setAutoApproveAllRoles(enabled: boolean): void { ... }
isAutoApproveEnabled(role: string): boolean { ... }
getAutoApproveRoles(): string[] { ... }
```

**Integration with dispatch flow:**

Currently `tryAutoApproveTask()` calls `this.approveTaskForChat(taskId)` then `this.startTaskExecution(taskId)`. After the move:

- `handleReadyTask()` already runs when a task becomes ready.
- If `autoExecute` is ON and auto-approve is enabled for the role → task dispatches automatically (current behavior via auto-execute).
- If `autoExecute` is OFF but auto-approve is enabled for the role → auto-approve overrides the manual gate.

This merges cleanly: `handleReadyTask()` gains a check:

```typescript
private handleReadyTask(taskId: string, role: string): void {
  // AutoExecute takes priority — dispatches everything ready
  if (this.autoExecute) {
    // ... existing dispatch logic
    return;
  }
  
  // Auto-approve: even when autoExecute is OFF, approved roles auto-dispatch
  if (this.isAutoApproveEnabled(role)) {
    // ... same dispatch logic
    return;
  }
  
  // Neither enabled — task waits for manual start
}
```

**AgentManagerV2 delegates:**

```typescript
// AgentManagerV2 keeps public API (for SocketServerV2) but delegates:
setAutoApproveForRole(role: string, enabled: boolean): void {
  this.orchestrator?.setAutoApproveForRole(role, enabled);
}
```

### Files Changed

| File | Changes |
|------|---------|
| `orchestrator/OrchestratorService.ts` | Add auto-approve properties + methods (~40 lines). Update `handleReadyTask()` to check auto-approve. |
| `AgentManagerV2.ts` | Remove auto-approve properties + methods (~90 lines). Replace with delegation to orchestrator. |

### Entry/Exit Criteria

**Entry:** None (independent of other steps).  
**Exit:**
- `autoApproveRoles` and `autoApproveAll` no longer on AgentManagerV2.
- `tryAutoApproveTask()` and `processAutoApproveTasks()` deleted from AgentManagerV2.
- Auto-approve logic integrated into `handleReadyTask()` in OrchestratorService.
- Build passes. Auto-approve behavior unchanged.

---

## Implementation Order & Dependencies

```
                     ┌── Step 4: Per-goal planners (subset of Step 1)
                     │
Step 1 ──► Step 2 ──► Step 3 ──► Step 5
(GoalMgr)  (goalId)   (filter)   (rooms)

Step 6 ─── (independent)
(TaskCtxBuilder)

Step 7 ─── (independent, benefits from Step 6 being done first)
(DispatchMgr)

Step 8 ─── (independent, do first for cleaner diff)
(Legacy delete)

Step 9 ─── (independent, best after Step 7)
(Auto-approve)
```

**Critical path:** Steps 1 → 2 → 3 → 5 (3.5 days serial).  
**Step 4** is free — subset of Step 1.  
**Steps 6, 7, 8, 9** are independent of each other and of the bug fixes. Can be parallelized or done in any order.

### Recommended Execution

| Day | Morning | Afternoon |
|-----|---------|-----------|
| **Day 1** | Step 8: Delete legacy V1 API (clean slate) | Step 1a: Update types (GoalContext, GoalManagerConfig) |
| **Day 2** | Step 1b: Move planner into GoalManager | Step 1c: Move ChatAgent, remove from AgentManagerV2 |
| **Day 3** | Step 1d: Test single-goal, fix regressions | Step 2: goalId on stream events (WorkerPool → Socket) |
| **Day 4** | Step 3: Frontend goalId filter | Step 5: Goal-scoped rooms (backend + frontend) |
| **Day 5** | Step 6: Extract TaskContextBuilder | Step 7: Extract DispatchManager |
| **Day 6** | Step 9: Move auto-approve to OrchestratorService | Integration test: 2 goals, 2 tabs, full regression |

---

## Testing Strategy

### Unit Tests

| Test | Validates |
|------|-----------|
| GoalManager creates planner via factory on first message | Step 1 |
| GoalManager creates ChatAgents on approvePlan | Step 1 |
| GoalManager disposes agents on goal completion | Step 1 |
| GoalManager.executePlannerTurn uses per-goal planner | Step 4 |
| WorkerPool onStream includes goalId | Step 2 |
| Stream payload contains goalId in Socket.IO emit | Step 2 |
| TaskContextBuilder.enrich() produces correct upstream section | Step 6 |
| TaskContextBuilder.enrich() handles CRDT refs | Step 6 |
| TaskContextBuilder.enrich() builds discussion protocol | Step 6 |
| DispatchManager respects maxConcurrent | Step 7 |
| DispatchManager retries retriable errors with backoff | Step 7 |
| DispatchManager drains deferred queue | Step 7 |
| Auto-approve dispatches approved roles when autoExecute OFF | Step 9 |
| Build passes after legacy deletion (no dead references) | Step 8 |

### Integration Tests

| Test | Validates |
|------|-----------|
| Submit goal → plan → approve → tasks execute → complete | Regression |
| Submit 2 goals → each gets own planner, own ChatAgents | Steps 1, 4 |
| Stream events include goalId in browser devtools | Step 2 |
| Switch plans → old goal's streams stop, new goal's streams show | Step 3 |
| Two browser tabs, different goals → each sees only its goal | Step 5 |
| Goal completion disposes agents, auto-advances to queued goal | Step 1 |
| Rate-limited task retries automatically (3 attempts) | Step 7 |
| Auto-approve role starts task without manual approval | Step 9 |

### Manual Verification

1. Open 2 browser tabs on same team.
2. Tab A: submit "Build REST API" → planner plans, tasks start.
3. Tab B: submit "Setup CI pipeline" → gets queued.
4. Tab A: verify only REST API tasks/streams visible.
5. Tab B: verify no REST API streams visible (queued goal shows plan waiting).
6. Tab A goal completes → Tab B auto-advances, CI tasks start.
7. Tab A switches to CI goal → sees CI streams, not REST API history.
8. Tab B shows CI streams only.
9. Verify auto-approve still works for configured roles.
10. Verify retry on 429 error (can test with rate-limit simulation).

---

## Rollback Plan

Each step is independently revertable:

| Step | Rollback |
|------|----------|
| Step 1 | Revert GoalManager changes, restore planner/chatAgent ownership to AgentManagerV2 |
| Step 2 | Remove goalId from onStream callback — payloads return to `{ taskId, agentId, part }` |
| Step 3 | Remove goalId filter in useOrchestration — streams show for all goals (v1.0 behavior) |
| Step 4 | N/A (part of Step 1) |
| Step 5 | Remove goal-scoped rooms — all events go to team room (client filter still works) |
| Step 6 | Inline TaskContextBuilder.enrich() back into dispatchTask() |
| Step 7 | Inline DispatchManager logic back into OrchestratorService |
| Step 8 | `git revert` — restore deleted methods (no downstream impact) |
| Step 9 | Move auto-approve back to AgentManagerV2 |

Feature flag `FF_PARALLEL_PLANS` gates multi-goal behavior. When OFF, GoalManager enforces single-goal mode (clears goals Map when creating second goal), and frontend doesn't filter.

---

## Files Summary

### Backend — agent-manager package

| File | Steps | Type of Change |
|------|-------|----------------|
| `orchestrator/types.ts` | 1, 2 | Type updates (GoalContext, callbacks, config) |
| `orchestrator/GoalManager.ts` | 1, 4 | Major — gains planner/ChatAgent ownership + executePlannerTurn |
| `orchestrator/OrchestratorService.ts` | 1, 2, 7, 9 | Medium — removes callback indirection, passes goalId, delegates dispatch + gains auto-approve |
| `orchestrator/TaskContextBuilder.ts` | 6 | **NEW** — extracted from dispatchTask (~150 lines) |
| `orchestrator/DispatchManager.ts` | 7 | **NEW** — concurrency + retry (~120 lines) |
| `AgentManagerV2.ts` | 1, 2, 4, 8, 9 | Major — removes planner/chatAgent/auto-approve/legacy (~550 lines deleted) |
| `services/WorkerPool.ts` | 2 | Minor — adds goalId to onStream callback |

### Backend — backend package

| File | Steps | Type of Change |
|------|-------|----------------|
| `api/SocketServerV2.ts` | 2, 5 | Medium — goalId in emits + goal-scoped rooms |

### Frontend

| File | Steps | Type of Change |
|------|-------|----------------|
| `hooks/useOrchestration.ts` | 3 | Medium — goalId filter + ref |
| `App.tsx` | 3, 5 | Minor — pass activePlanGoalId + subscribeToGoal effect |
| `services/AgentServiceV2.ts` | 5 | Minor — subscribeToGoal method |

### Net Impact

- **AgentManagerV2**: ~550 lines deleted (legacy + planner/chatAgent + auto-approve), ~20 lines added (factory closures + delegation)
- **OrchestratorService**: ~120 lines deleted (dispatch/retry), ~50 lines added (auto-approve + delegation)
- **GoalManager**: ~150 lines added (executePlannerTurn, enableChatAgents, disposeGoalAgents)
- **New files**: 2 (TaskContextBuilder, DispatchManager) — ~270 lines total
- **Total files changed:** 11 (7 backend, 1 API, 3 frontend)
