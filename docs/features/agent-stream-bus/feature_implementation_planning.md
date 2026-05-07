# Agent Stream Bus + AgentFactory — Implementation Plan

**Date:** May 6, 2026
**Status:** Ready to implement
**Architecture:** [feature_architecture.md](./feature_architecture.md)
**Effort:** 1.5 weeks (7 working days)

---

## Scope

Two connected refactors in one pass:

1. **AgentFactory** — Unified agent creation (planner, worker, chat). One `create(type, config)` method. Replaces 3 scattered creation paths + 8 WorkerPool setter methods.
2. **AgentStreamBus** — Tiered observer bus for streaming. Replaces 4-hop callback chain. Fixes ChatAgent unicast bug.

**What changes:** WorkerPool 686 → ~150 lines. AgentManagerV2 closures eliminated. SocketEventBroadcaster deleted. 7 new files added.
**What stays:** Orchestration flow, tool callbacks (complete_task etc.), TaskStore, DispatchManager, agent classes.

---

## Implementation Steps

### Step 0: Create AgentFactory (Day 1)

**New file:** `packages/agent-manager/src/agent/AgentFactory.ts` (~150 lines)

Unified factory that creates all agent types:

```typescript
interface AgentCreateConfig {
  consumer: "planner" | "worker" | "chat";
  goalId: string;
  taskId?: string;     // workers only
  role?: string;       // workers + chat
  callbacks?: LifecycleToolCallbacks;  // workers only (complete_task, etc.)
  taskServices?: TaskServices;         // workers only
  plannerContext?: PlannerContext;      // planners only
  chatContext?: ChatAgentContext;       // chat only
}

class AgentFactory {
  constructor(
    private pluginRegistry: PluginRegistry,
    private definitions: Map<string, AgentDefinition>,
    private teamId: string,
    private teamRoles: string[],
  ) {}

  async create(config: AgentCreateConfig) {
    switch (config.consumer) {
      case "planner": return this.buildPlanner(config);
      case "worker":  return this.buildWorker(config);
      case "chat":    return this.buildChatAgent(config);
    }
  }

  private async buildWorker(config: AgentCreateConfig): Promise<AiSdkAgent> {
    const definition = this.definitions.get(config.role!);
    const agent = new AiSdkAgent(definition);
    await agent.initialize();

    // Unified tool assembly — same path for all callers
    const tools = [
      ...assembleLifecycleTools(config.taskId!, config.role!, config.callbacks!, config.taskServices!),
      ...this.pluginRegistry.getTools({ consumer: "worker", role: config.role!, taskId: config.taskId!, goalId: config.goalId }),
    ];

    await this.pluginRegistry.prepareForTask({ taskId: config.taskId!, role: config.role!, goalId: config.goalId });
    const skills = this.pluginRegistry.getSkillInstructions({ role: config.role!, taskId: config.taskId! });
    if (skills.length) agent.appendSystemPrompt(skills);

    const lifecycleSkill = loadTaskLifecycleSkill();
    if (lifecycleSkill) agent.appendSystemPrompt([lifecycleSkill]);

    await agent.setTools(tools);
    return agent;
  }

  private async buildPlanner(config: AgentCreateConfig): Promise<PlannerAgent> {
    // Port from AgentManagerV2 L286-328 closure
    const planner = new PlannerAgent({ ... });
    await planner.initialize();
    const tools = [
      ...createPlannerTools(config.plannerContext!),
      ...this.pluginRegistry.getTools({ consumer: "planner", role: "planner", goalId: config.goalId }),
    ];
    await planner.setTools(tools);
    return planner;
  }

  private buildChatAgent(config: AgentCreateConfig): ChatAgent {
    // Port from AgentManagerV2 L330-349 closure
    return new ChatAgent({ role: config.role!, teamId: this.teamId, goalId: config.goalId, ...config.chatContext! });
  }
}
```

**Callers after this step:**

```typescript
// OrchestratorService.dispatchTask():
const agent = await this.agentFactory.create({ consumer: "worker", goalId, taskId, role, callbacks, taskServices });

// GoalManager.executePlannerTurn():
const planner = await this.agentFactory.create({ consumer: "planner", goalId, plannerContext });

// ChatAgent creation:
const chat = await this.agentFactory.create({ consumer: "chat", goalId, role, chatContext });
```

**Exit criteria:** Factory created. Not wired yet. Unit test: `create("worker", ...)` returns configured agent with correct tools.

---

### Step 1: Create AgentStreamBus + Interfaces (Day 2, morning)

**New file:** `packages/agent-manager/src/streaming/AgentStreamBus.ts`

```typescript
import { rootLogger } from "../logging.js";
import type { AgentEvent } from "../agent/types.js";

const logger = rootLogger.child({ module: "AgentStreamBus" });

export interface StreamContext {
  teamId: string;
  goalId: string;
  agentKey: string;  // "planner" | "worker:backend-dev" | "chat:researcher"
  taskId?: string;
}

export interface AgentStreamObserver {
  onEvent?(event: AgentEvent, ctx: StreamContext): void;
  onEventAsync?(event: AgentEvent, ctx: StreamContext): Promise<void>;
}

export class AgentStreamBus {
  private syncObservers: AgentStreamObserver[] = [];
  private asyncObservers: AgentStreamObserver[] = [];

  addObserver(observer: AgentStreamObserver, tier: "sync" | "async" = "sync") {
    if (tier === "sync") this.syncObservers.push(observer);
    else this.asyncObservers.push(observer);
  }

  emit(event: AgentEvent, ctx: StreamContext): void {
    for (const o of this.syncObservers) {
      try { o.onEvent?.(event, ctx); }
      catch (err) { logger.error({ err, observer: o.constructor.name }, "Sync observer error"); }
    }
    for (const o of this.asyncObservers) {
      o.onEventAsync?.(event, ctx)?.catch((err) => {
        logger.error({ err, observer: o.constructor.name }, "Async observer error");
      });
    }
  }
}
```

**New file:** `packages/agent-manager/src/streaming/index.ts` — barrel export

**Exit criteria:** `bun run build` passes. Bus is importable. No wiring yet.

---

### Step 2: Create StreamPublisherObserver (Day 1, afternoon)

**New file:** `packages/agent-manager/src/streaming/StreamPublisherObserver.ts`

Port the streaming logic from `SocketEventBroadcaster.ts` L68-146:
- Part accumulation (`messageAccumulator` Map)
- Text + tool + reasoning assembly
- `io.to(goalRoom).emit("stream", payload)` on each part
- Message persistence to MongoDB on `finish` part

```typescript
export class StreamPublisherObserver implements AgentStreamObserver {
  private messageAccumulator = new Map<string, MessageAccumulation>();
  
  constructor(
    private io: SocketIOServer,
    private services?: { chat: IChatService; teamRegistry?: ITeamRegistryService },
  ) {}
  
  onEvent(event: AgentEvent, ctx: StreamContext): void {
    if (event.type !== "stream_part") return;
    // ... port accumulation logic from SocketEventBroadcaster L70-146
  }
}
```

**Key:** This observer is sync (Socket.IO emit is non-blocking). Persistence on `finish` fires as async but doesn't block the sync `onEvent`.

**Exit criteria:** Observer created. Unit test: emit stream_parts → verify io.emit called correctly.

---

### Step 3: Create ChannelBObserver (Day 2, morning)

**New file:** `packages/agent-manager/src/streaming/ChannelBObserver.ts`

Port Channel B synthesis from `WorkerPool.ts` L449-505:
- `finish-step` → `{ type: "progress", stepIdx, tokensSoFar }`
- `tool-output-available` + MILESTONE_TOOLS → `{ type: "tool_milestone", tool, summary }`
- `done` event → `{ type: "completed", summary }`
- `error` event → `{ type: "failed", error }`
- `start` → `{ type: "started" }`

```typescript
export class ChannelBObserver implements AgentStreamObserver {
  private stepCount = 0;
  private totalTokens = 0;
  
  constructor(
    private onTaskUpdate: (update: TaskUpdate) => void,  // → ChatAgent + Socket.IO
  ) {}
  
  onEvent(event: AgentEvent, ctx: StreamContext): void {
    if (event.type === "stream_part") {
      const part = event.part;
      if (part?.type === "finish-step") { /* progress */ }
      if (part?.type === "tool-output-available") { /* milestone check */ }
    }
    if (event.type === "done") { /* completed */ }
    if (event.type === "error") { /* failed */ }
  }
}
```

**Exit criteria:** Unit test: emit stream_parts of various types → verify correct TaskUpdate events produced.

---

### Step 4: Create TaskLifecycleObserver (Day 2, afternoon)

**New file:** `packages/agent-manager/src/streaming/TaskLifecycleObserver.ts`

Port from `OrchestratorService.ts` L206-269 (the `workerPool.setCallbacks` block):
- `onAgentComplete` → `goalManager.onWorkerDone(data)`
- `onBounce` → Channel B blocked event + `goalManager.handleTaskFailure()` + planner notification
- `onTaskCreated` → `callbacks.onTaskUpdate` + planner notification + dispatch ready
- `onMentionedRoles` → `spawnCollabWorkers()`
- `onStatusUpdate` → update `task.lastReportedStatus` + Channel B forward

```typescript
export class TaskLifecycleObserver implements AgentStreamObserver {
  constructor(private config: {
    goalManager: GoalManager;
    notifyPlanner: (goalId: string, msg: string) => void;
    spawnCollabWorkers: (data: any) => void;
    taskStore: TaskStore;
    onTaskUpdate?: (data: any) => void;
    onWorkerTaskUpdate?: (update: any) => void;
  }) {}
  
  async onEventAsync(event: AgentEvent, ctx: StreamContext): Promise<void> {
    // Handle complete_task, bounce_task, request_task tool callbacks
    // These come as special AgentEvent types from the lifecycle tools
  }
}
```

**CRITICAL (from code review):** Lifecycle tool callbacks (`complete_task`, `report_status`, `bounce_task`) are called **during agent execution** (inside the generator). They MUST stay as direct function calls, NOT on the bus.

Specifically: `report_status("blocked")` sets `task.lastReportedStatus` synchronously. `OrchestratorService.dispatchTask()` L630-635 reads `afterTask.lastReportedStatus === "blocked"` immediately after `runTask()` returns to decide whether to auto-complete or mark failed. If this mutation goes async, a blocked worker gets auto-completed as success.

**Rule:** `onStatusUpdate` is a direct callback passed to `assembleLifecycleTools()`. TaskLifecycleObserver only handles post-execution events (`done`, `error`, `onBounce`, `onTaskCreated`, `onMentionedRoles`).

**Exit criteria:** Observer created. Handles done → forwards to goalManager.onWorkerDone.

---

### Step 5: Create CrdtStatusObserver (Day 3, morning, 30 min)

**New file:** `packages/agent-manager/src/streaming/CrdtStatusObserver.ts`

Port from `WorkerPool.ts` L418-421 and L522-524:

```typescript
export class CrdtStatusObserver implements AgentStreamObserver {
  constructor(private crdtTaskSync: CrdtTaskSync | null) {}
  
  onEventAsync(event: AgentEvent, ctx: StreamContext): Promise<void> {
    if (event.type === "stream_part" && event.part?.type === "start") {
      return this.crdtTaskSync?.updateAgentStatus(ctx.agentKey, "busy", ctx.taskId) ?? Promise.resolve();
    }
    if (event.type === "done" || event.type === "error") {
      return this.crdtTaskSync?.updateAgentStatus(ctx.agentKey, "idle", ctx.taskId) ?? Promise.resolve();
    }
    return Promise.resolve();
  }
}
```

**Exit criteria:** 20 lines, done.

---

### Step 6: Strip WorkerPool + Wire Bus (Day 4)

**Modify:** `packages/agent-manager/src/services/WorkerPool.ts`

WorkerPool loses tool assembly (moved to AgentFactory) AND callback chain (moved to bus):

```typescript
// WorkerPool — AFTER (~150 lines)
class WorkerPool {
  private definitions = new Map<string, AgentDefinition>();
  private workers = new Map<string, AiSdkAgent>();

  registerDefinitions(defs: AgentDefinition[]) { ... }
  getDefinition(role: string) { ... }

  async *executeAgent(agent: AiSdkAgent, taskId: string, input: AgentInput): AsyncGenerator<AgentEvent> {
    this.workers.set(taskId, agent);
    try {
      yield* agent.execute(input);
    } finally {
      this.workers.delete(taskId);
    }
  }

  dispose(taskId: string) { ... }
  disposeByGoal(goalId: string) { ... }
  getAgentMessages(taskId: string) { ... }
}
```

**Deleted from WorkerPool:**
- `runTask()` method (280 lines) — replaced by `executeAgent()` (~15 lines)
- `WorkerCallbacks` interface + `setCallbacks()` — replaced by bus
- `setPluginRegistry()`, `setTeamId()`, `setTaskServices()`, `setAuthTokenResolver()`, `setRoleAgentIdMap()`, `setTeamRoles()` — all 8 setters gone (factory has these)
- `buildMessageWithContext()` — moves to AgentFactory or OrchestratorService
- Channel B synthesis, CRDT status, all callback calls

**Exit criteria:** WorkerPool is ~150 lines. Only has definitions + workers Map + executeAgent generator + dispose.

---

### Step 7: Wire AgentFactory + Bus into OrchestratorService (Day 5, morning)

**Modify:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts`

In `initialize()` (L201-272):
- **Delete** the 70-line `workerPool.setCallbacks({...})` block entirely

In `dispatchTask()` (L552-644):
- Use AgentFactory to create agent
- Create bus per execution
- Iterate via `workerPool.executeAgent()` + emit to bus

```typescript
async dispatchTask(taskId: string, role: string) {
  await this.taskStore.updateStatus(taskId, "in_progress");
  
  // Create agent via factory (replaces 140 lines in WorkerPool)
  const agent = await this.agentFactory.create({
    consumer: "worker", goalId, taskId, role,
    callbacks: { onAgentComplete, onStatusUpdate, onBounce, onTaskCreated },
    taskServices: { taskStore, dagResolver, teamRoles, crdtTaskSync, ... },
  });
  
  // Create bus with observers for this execution
  const bus = new AgentStreamBus();
  bus.addObserver(this.streamPublisher, "sync");
  bus.addObserver(this.channelBObserver, "sync");
  bus.addObserver(this.crdtStatusObserver, "async");
  
  // Build message + iterate
  const input = { message: buildMessageWithContext(task), threadId: taskId };
  for await (const event of this.workerPool.executeAgent(agent, taskId, input)) {
    bus.emit(event, { teamId: this.teamId, goalId, agentKey: role, taskId });
  }
}
```

**Lines deleted:** ~70 (setCallbacks block)
**Lines added:** ~20 (factory + bus in dispatchTask)

**Exit criteria:** Worker dispatch uses factory + bus. No more callback chain for streaming.

---

### Step 8: Wire Bus into GoalManager for Planner (Day 4, afternoon)

**Modify:** `packages/agent-manager/src/orchestrator/GoalManager.ts`

In `executePlannerTurn()` (L235-248):

```typescript
// BEFORE (L240-245):
this.onPlannerStream({ goalId, taskId: sessionId, agentId: "planner", part: event.part });

// AFTER:
const bus = new AgentStreamBus();
bus.addObserver(this.streamPublisher, "sync");
// ... (same observers)

for await (const event of agent.execute(input)) {
  bus.emit(event, { teamId: this.teamId, goalId, agentKey: "planner" });
}
```

Remove `onPlannerStream` config field (L47, L80, L108).

**Exit criteria:** Planner streaming goes through bus. `onPlannerStream` callback eliminated.

---

### Step 9: Wire Bus into ChatAgent Path (Day 5, morning)

**Modify:** `packages/backend/api/SocketMessageHandler.ts`

In `handleChatAgentMessage()` (L256-313):

```typescript
// BEFORE (L260-265):
socket.emit("stream", { teamId, agentId: `chat-${role}`, part, goalId });

// AFTER:
const bus = new AgentStreamBus();
bus.addObserver(this.streamPublisher, "sync");  // broadcasts to room, not unicast

for await (const event of agent.execute({ message })) {
  bus.emit(event, { teamId, goalId, agentKey: `chat:${role}` });
}
```

**Fixes ChatAgent unicast bug** — now broadcasts to goal room like planner/worker.

Remove duplicated message accumulation + persistence (L265-313) — StreamPublisherObserver handles it.

**Lines deleted:** ~50 (duplicated accumulation + persistence)
**Lines added:** ~10 (bus creation + emit)

---

### Step 10: Cleanup — Delete Dead Code (Day 5, afternoon)

| File | Action |
|------|--------|
| `WorkerPool.ts` | Remove `WorkerCallbacks` interface, `setCallbacks()`, `callbacks` field. Keep tool callbacks (`onAgentComplete`, `onBounce`, etc.) as params to `assembleLifecycleTools`. |
| `OrchestratorService.ts` | Remove `callbacks.onStream`, `callbacks.onEvent`, `callbacks.onDone`, `callbacks.onError` pass-throughs from OrchestratorCallbacks type. |
| `AgentManagerV2.ts` | Remove `streamCallbacks` field, `registerStreamCallbacks()`, `ManagerStreamCallbacks` interface, `onPlannerStream` wiring in config. |
| `SocketEventBroadcaster.ts` | **Delete entire file** — replaced by `StreamPublisherObserver`. |
| `SocketServerV2.ts` | Remove `SocketEventBroadcaster` import + creation. Create `StreamPublisherObserver` instead. |

**Exit criteria:** `bun run build` clean. No references to deleted callbacks. `SocketEventBroadcaster` gone.

---

## Files Summary

### New (7 files, ~410 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `agent/AgentFactory.ts` | ~150 | Unified `create(type, config)` — planner, worker, chat |
| `streaming/AgentStreamBus.ts` | ~45 | Tiered bus + interfaces |
| `streaming/StreamPublisherObserver.ts` | ~65 | Channel A: Socket.IO emit + persist |
| `streaming/ChannelBObserver.ts` | ~50 | Coarse progress synthesis |
| `streaming/TaskLifecycleObserver.ts` | ~80 | done/error → GoalManager |
| `streaming/CrdtStatusObserver.ts` | ~20 | CRDT busy/idle |

### Modified (5 files)

| File | Before | After | Net |
|------|--------|-------|-----|
| `WorkerPool.ts` | 686 | ~150 | **-536** |
| `OrchestratorService.ts` | 680 | ~630 | -50 |
| `GoalManager.ts` | 1061 | ~1050 | -11 |
| `AgentManagerV2.ts` | 1310 | ~1100 | **-210** |
| `SocketMessageHandler.ts` | 345 | ~305 | -40 |

### Deleted (1 file)

| File | Lines |
|------|-------|
| `SocketEventBroadcaster.ts` | **-374** |

### Net Effect

```
Before: 5,108 lines across 8 core files
After:  ~3,645 lines across 12 files (5 modified + 7 new)
Change: -1,463 lines removed, +410 lines added
Net:    -1,053 lines

WorkerPool: 686 → 150 lines (78% reduction)
AgentManagerV2: 1310 → 1100 lines (16% reduction)  
SocketEventBroadcaster: 374 → 0 (deleted)
+ 7 focused, testable files replacing tangled code
```

---

## Risk Mitigation

### Code Review Findings (May 7, 2026)

Review against live runtime identified 4 risks. Integrated into the plan:

| Finding | Severity | Classification | Resolution |
|---------|----------|---------------|------------|
| **Async observer would regress blocked-task handling** — `lastReportedStatus` is read synchronously by `dispatchTask()` auto-complete guard | HIGH | AVOID | `onStatusUpdate` stays as direct callback in `assembleLifecycleTools()`. `TaskLifecycleObserver` only handles post-execution `done`/`error`. Never mid-execution state mutations. |
| **WorkerPool has 5 callers, not just dispatchTask** — `spawnCollabWorkers` (fire-and-forget), `startTaskExecution` (no goalId), `startTask`/`continueTask` (legacy, no goalId) | HIGH | FIX IN STEP 0 | AgentFactory.buildWorker() handles both overloads. Legacy callers resolve goalId from TaskStore. Collab workers route through factory. Step 7 must wire ALL 5 callers, not just dispatchTask. |
| **ChatAgent persistence stamps wrong userId** — assistant messages attributed to team owner, not requesting user. SQLite has no user filter. | MEDIUM | DEFER | StreamPublisherObserver preserves existing behavior. Fix in multi-user feature. |
| **CRDT auth hole** — `onAuthenticate` returns `token \|\| "anonymous"`, no team authorization | HIGH | DEFER | CrdtStatusObserver only calls existing `updateAgentStatus()`. No new CRDT doc creation in this feature. Auth tracked in crdt-auth feature. |
| **Multi-goal blockers not fixed** — `messageChain`, `activeGoalId`, global dispatch budget | — | OUT OF SCOPE | Bus makes them easier to fix (goal-scoped StreamContext), but fix is in goal-sessions feature. |

### Step 0 Revision: AgentFactory Must Handle All 5 Callers

The original Step 0 only showed the 3 clean paths (planner, worker, chat). Updated to handle all 5 `runTask()` callers:

```typescript
// Call site 1: OrchestratorService.dispatchTask() — full context
const agent = await factory.create({ consumer: "worker", goalId, taskId, role, callbacks, taskServices });

// Call site 2: OrchestratorService.spawnCollabWorkers() — fire-and-forget, goalId resolved from source task
const agent = await factory.create({ consumer: "worker", goalId: collabGoalId, taskId: collabId, role });

// Call sites 3-5: AgentManagerV2.startTaskExecution/startTask/continueTask — no goalId, legacy
const goalId = taskStore?.get(taskId)?.goalId;  // Resolve from TaskStore, same as current WorkerPool fallback
const agent = await factory.create({ consumer: "worker", goalId, taskId, role, callbacks });
```

### Step 4 Revision: TaskLifecycleObserver Scope Narrowed

The original Step 4 listed `onStatusUpdate` as something TaskLifecycleObserver handles. **Removed.** The observer only handles:
- `done` → `goalManager.onWorkerDone(data)` (post-execution)
- `error` → retry/notify planner (post-execution)
- `onBounce` → Channel B blocked + `goalManager.handleTaskFailure()` (post-execution)
- `onTaskCreated` → planner notification + dispatch ready (post-execution)
- `onMentionedRoles` → `spawnCollabWorkers()` (post-execution)

**NOT on the bus:** `onStatusUpdate` (synchronous mid-execution mutation — `lastReportedStatus` must be written before `dispatchTask()` auto-complete check reads it).

### Original Risks

| Risk | Mitigation |
|------|-----------|
| StreamPublisherObserver misses edge cases from SocketEventBroadcaster | Port logic line-by-line. Same test scenarios. Feature flag to switch back. |
| Tool callbacks break (complete_task, bounce_task) | Tool callbacks stay as direct function calls. Only streaming callbacks change. |
| ChatAgent dispatch path breaks | ChatAgent.handleTask() unchanged — only the STREAMING of ChatAgent responses changes. |
| Build breaks in agent-manager package | Each step is a buildable increment. Test after each step. |

## Testing Plan

| What | How |
|------|-----|
| StreamPublisherObserver | Emit stream_parts → verify io.emit called with correct payload |
| ChannelBObserver | Emit finish-step/tool-output → verify TaskUpdate produced |
| Multi-goal isolation | Two buses with different goalIds → verify no cross-goal leakage |
| ChatAgent broadcast fix | ChatAgent response → verify io.to(room).emit (not socket.emit) |
| End-to-end | Send message → plan → approve → execute → verify tokens reach frontend |
