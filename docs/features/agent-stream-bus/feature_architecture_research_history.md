# Agent Stream Bus — Feature Architecture

**Date:** May 7, 2026 (updated with SOLID audit + LLD)
**Status:** Architecture — reviewed, ready to implement
**Priority:** P1 — Foundation for clean streaming, extensibility, and ChatAgent unicast fix
**Depends on:** Multi-goal scalar fixes ✅ (completed May 7)
**Related:** [goal-sessions](../goal-sessions/) (multi-goal scalar fixes ✅ done), [plugin-tool-runtime](../plugin-tool-runtime/)

---

## Problem

SOLID audit (May 7, 2026) found **6 critical SRP violations** across 4 files. WorkerPool has 11 responsibilities. SocketEventBroadcaster mixes transport + accumulation + DB writes. OrchestratorService.dispatchTask() has 7 sub-responsibilities in one method. AgentManagerV2 closures capture `self` with hidden coupling.

Only `DispatchManager` and `assembleLifecycleTools` are clean — they're the pattern to follow.

## What This Feature Does

Extract single-responsibility classes following SOLID principles. Each class has one reason to change, depends on abstractions, and is independently testable.

---

## Low-Level Design: Target Class Structure

### Class Diagram (After Refactor)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AgentManager (composition root — wires everything, delegates all)     │
│  Public API: orchestratorMessage, approvePlan, chatAgentMessage, ...   │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ creates + injects
               ▼
┌──────────────────────────┐  ┌───────────────────────────────┐
│  OrchestratorService     │  │  GoalManager                  │
│  handleMessage()         │  │  Goal lifecycle + state        │
│  dispatchTask() → uses:  │  │  approvePlan() → delegates to: │
│    TaskDispatcher         │  │    PlanApprovalService         │
│    DispatchManager        │  │    TaskCompletionHandler       │
└──────────┬───────────────┘  └───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  TaskDispatcher (NEW — extracted from dispatchTask)              │
│  Single responsibility: execute one task end-to-end              │
│                                                                  │
│  dispatch(taskId, role):                                         │
│    1. agent = agentFactory.create({ consumer: "worker", ... })   │
│    2. for await (event of workerPool.executeAgent(agent)):       │
│         streamBus.emit(event, ctx)                               │
│    3. autoCompleteGuard(task)                                    │
└──────────┬───────────────────────────────────────────────────────┘
           │ uses
           ▼
┌─────────────────────┐  ┌────────────────────────┐  ┌───────────────────┐
│  AgentFactory (NEW) │  │  WorkerPool (stripped)  │  │  AgentStreamBus   │
│  create({config})   │  │  executeAgent(agent)    │  │  emit(event, ctx) │
│  buildWorker()      │  │  dispose(taskId)        │  │  addObserver(o)   │
│  buildPlanner()     │  │  getDefinition(role)    │  └────────┬──────────┘
│  buildChatAgent()   │  │  hasActiveWorker()      │           │ observers
└─────────────────────┘  └────────────────────────┘           ▼
                                                    ┌────────────────────────┐
AgentFactory delegates to:                          │  StreamPublisher       │
┌─────────────────────────┐                         │  (sync) Socket.IO emit │
│  WorkerToolAssembler    │                         │  + accumulate + persist │
│  assembleLifecycleTools │                         ├────────────────────────┤
│  pluginRegistry.getTools│                         │  ChannelBObserver      │
│  skillInstructions      │                         │  (sync) progress +     │
│  taskLifecycleSkill     │                         │  milestones → ChatAgent│
│  identityFile           │                         ├────────────────────────┤
└─────────────────────────┘                         │  CrdtStatusObserver    │
                                                    │  (async) busy/idle     │
                                                    └────────────────────────┘
```

### Interface Definitions

```typescript
// ── AgentFactory ──────────────────────────────────────────────
interface IAgentFactory {
  create(config: AgentCreateConfig): Promise<ConfiguredAgent>;
}

interface AgentCreateConfig {
  consumer: "planner" | "worker" | "chat";
  goalId: string;
  taskId?: string;
  role?: string;
  callbacks?: LifecycleToolCallbacks;  // complete_task, report_status, etc.
  taskServices?: TaskServices;
  plannerContext?: PlannerContext;
  chatContext?: ChatAgentContext;
}

// ── TaskDispatcher ────────────────────────────────────────────
interface ITaskDispatcher {
  dispatch(taskId: string, role: string): Promise<void>;
}

// ── AgentStreamBus ────────────────────────────────────────────
interface IAgentStreamObserver {
  onEvent?(event: AgentEvent, ctx: StreamContext): void;        // sync tier
  onEventAsync?(event: AgentEvent, ctx: StreamContext): Promise<void>; // async tier
}

interface StreamContext {
  teamId: string;
  goalId: string;
  agentKey: string;   // "planner" | "worker:backend-dev" | "chat:researcher"
  taskId?: string;
}

// ── WorkerPool (stripped) ─────────────────────────────────────
interface IWorkerPool {
  registerDefinitions(defs: AgentDefinition[]): void;
  getDefinition(role: string): AgentDefinition | undefined;
  executeAgent(agent: AiSdkAgent, taskId: string, input: AgentInput): AsyncGenerator<AgentEvent>;
  dispose(taskId: string): void;
  disposeByGoal(goalId: string): void;
  hasActiveWorker(taskId: string): boolean;
  getAgentMessages(taskId: string): ModelMessage[];
}

// ── StreamPublisher ───────────────────────────────────────────
// Replaces SocketEventBroadcaster. Transport + accumulation + persistence.
interface IStreamPublisher extends IAgentStreamObserver {
  // Also called directly by AgentManager for non-stream events:
  onPlanUpdate(data: PlanUpdateData): void;
  onPlanProposed(data: PlanProposedData): void;
  onGoalStatusChange(data: GoalStatusChangeData): void;
  onTaskStatusChange(data: TaskStatusData): void;
}
```

### What Each Class Does (Single Responsibility)

| Class | SRP Statement | Lines | Reason to Change |
|-------|--------------|-------|-----------------|
| `AgentFactory` | Creates configured agents from definitions | ~150 | Tool sources or agent types change |
| `TaskDispatcher` | Executes one task: create agent → run → emit to bus → auto-complete | ~80 | Task execution flow changes |
| `WorkerPool` | Tracks active workers + definitions | ~100 | Worker lifecycle changes |
| `AgentStreamBus` | Routes events to observers | ~45 | Observer tier model changes |
| `StreamPublisher` | Accumulates, broadcasts, persists stream events | ~120 | Transport or persistence changes |
| `ChannelBObserver` | Synthesizes coarse progress events | ~50 | Progress format changes |
| `CrdtStatusObserver` | Updates CRDT busy/idle status | ~20 | CRDT integration changes |
| `WorkerToolAssembler` | Assembles tools from all sources for a worker | ~60 | Tool sources change |

### Data Flow: Worker Task Execution

```
User approves plan → OrchestratorService.dispatchTask(taskId, role)
  │
  └─→ TaskDispatcher.dispatch(taskId, role)
        │
        ├── 1. AgentFactory.create({ consumer: "worker", ... })
        │     ├── WorkerToolAssembler.assemble(role, taskId, goalId)
        │     │     ├── assembleLifecycleTools(taskId, role, callbacks, taskServices)
        │     │     ├── pluginRegistry.prepareForTask(ctx)
        │     │     ├── pluginRegistry.getTools(ctx)
        │     │     ├── pluginRegistry.getSkillInstructions(ctx)
        │     │     └── loadTaskLifecycleSkill()
        │     ├── new AiSdkAgent(definition)
        │     ├── agent.initialize()
        │     ├── agent.setTools(allTools)
        │     └── return agent
        │
        ├── 2. for await (event of WorkerPool.executeAgent(agent, taskId, input))
        │     │
        │     └── AgentStreamBus.emit(event, { teamId, goalId, agentKey, taskId })
        │           │
        │           ├── [sync] StreamPublisher.onEvent()
        │           │     ├── io.to(goalRoom).emit("stream", payload)
        │           │     ├── accumulate text/tools/reasoning
        │           │     └── on "finish" → services.chat.addMessage(accumulated)
        │           │
        │           ├── [sync] ChannelBObserver.onEvent()
        │           │     ├── step counting → progress events
        │           │     ├── milestone tool detection
        │           │     └── → ChatAgent.ingestTaskUpdate() + io.emit("task_update")
        │           │
        │           └── [async] CrdtStatusObserver.onEventAsync()
        │                 └── crdtTaskSync.updateAgentStatus(busy/idle)
        │
        └── 3. Auto-complete guard
              ├── if task.status === "in_progress" && !task.completionSource
              │     ├── if task.lastReportedStatus === "blocked" → mark failed
              │     └── else → pluginRegistry.onTaskComplete() → taskStore.completeTask()
              └── (runs AFTER for-await loop — all events processed)
```

### Data Flow: Planner Streaming

```
GoalManager.executePlannerTurn(goalId, message)
  │
  ├── planner = AgentFactory.create({ consumer: "planner", goalId, plannerContext })
  │
  ├── for await (event of planner.execute(input))
  │     └── AgentStreamBus.emit(event, { teamId, goalId, agentKey: "planner" })
  │           ├── [sync] StreamPublisher → io.emit("stream", { agentId: "planner" })
  │           └── [sync] ChannelBObserver → progress events
  │
  └── saveConversation(planner.getMessages())
```

### Data Flow: ChatAgent (fixes unicast bug)

```
SocketMessageHandler.handleChatAgentMessage(socket, ...)
  │
  ├── chatAgent = AgentFactory.create({ consumer: "chat", goalId, role, chatContext })
  │
  ├── for await (event of chatAgent.execute(input))
  │     └── AgentStreamBus.emit(event, { teamId, goalId, agentKey: "chat:role" })
  │           └── [sync] StreamPublisher → io.to(goalRoom).emit("stream", ...)
  │                                         ↑ broadcasts to room, NOT socket.emit
  │
  └── (accumulation + persistence handled by StreamPublisher observer)
```

### Data Flow: Plan Approval (H1+H2 gap resolved)

```
AgentManager.approveOrchestratorPlan(goalId)
  │
  ├── GoalManager.approvePlan(goalId)  // domain logic: task creation, DAG, etc.
  │
  ├── streamPublisher.onPlanUpdate({   // DIRECT call, not through bus
  │     teamId, goalId,
  │     sessionState: "executing",
  │     plan: tasks
  │   })
  │   ├── io.to(goalRoom).emit("state", stateResponse)
  │   └── services.goals.updateGoal(goalId, { status: "executing" })  ← H2 resolved
  │
  └── return { success: true }
```

### What Stays Unchanged

| Component | Why |
|-----------|-----|
| `DispatchManager` | Already clean — SRP, DIP via config callbacks. Gold standard. |
| `assembleLifecycleTools` | Already clean — single function, interfaces for callbacks. |
| `TaskStore` / `RoleTaskQueue` | Task state machine — separate concern, well-factored. |
| `DependencyResolver` | DAG logic — isolated. |
| `AiSdkAgent` / `PlannerAgent` / `ChatAgent` | Agent classes — factory creates them, doesn't change them. |
| `GoalEventBus` + handlers | Domain events for CRDT projection — separate from streaming. |
| Lifecycle tool callbacks | `report_status`, `complete_task`, `bounce_task`, `request_task` — direct awaited callbacks, NOT on bus. |

### SOLID Compliance Check

| Principle | How It's Met |
|-----------|-------------|
| **S**ingle Responsibility | Each new class has exactly 1 reason to change (see table above) |
| **O**pen/Closed | AgentStreamBus — add observers without editing bus. AgentFactory — add consumer types without editing existing builders. WorkerToolAssembler — add tool sources without editing assembler (plugin registry already extensible). |
| **L**iskov Substitution | `IAgentStreamObserver` — sync and async observers are interchangeable. `IAgentFactory` — swap implementations without breaking callers. |
| **I**nterface Segregation | `IWorkerPool` — callers only see what they need (no setters). `IStreamPublisher` — extends observer for direct calls, keeps observer interface minimal. `ITaskDispatcher` — single method. |
| **D**ependency Inversion | AgentFactory depends on `PluginRegistry` interface, not concrete plugins. TaskDispatcher depends on `IAgentFactory` + `IWorkerPool` + `IAgentStreamBus` — all abstractions. StreamPublisher depends on `IChatService` + `IGoalService` interfaces, not `ServiceRegistry`. |

---

## Research: Hooks + Visitor Pattern (May 7, 2026)

### Discovery: AI SDK Already Has the Extension Points We Need

AI SDK's `streamText()` provides lifecycle hooks that fire at every stage of agent execution. We're already using 3 of them (for logging). The remaining hooks are the exact extension points our observer bus was trying to build externally.

#### AI SDK Hooks Available on `streamText()`

| Hook | When It Fires | Currently Used? | Extension Opportunity |
|------|--------------|-----------------|----------------------|
| `onChunk` | Every stream chunk (text-delta, tool-call, reasoning, etc.) | ❌ Not used | **StreamPublisher**: emit to Socket.IO per chunk, accumulate for persistence |
| `onStepFinish` | After each LLM step completes | ✅ Logging only | **ChannelB**: step counting, token usage, progress events |
| `onFinish` | After ALL steps complete | ❌ Not used | **Persistence**: save accumulated message to DB. **CRDT**: mark idle. |
| `prepareStep` | Before each LLM call (can modify tools, messages, model) | ✅ Context trimming | **ActiveTools filtering**, tool budget enforcement, dynamic tool injection |
| `experimental_onToolCallStart` | Before tool execute runs | ✅ Logging only | **Tool approval** (future), tool timing, milestone detection |
| `experimental_onToolCallFinish` | After tool execute completes | ✅ Logging only | **Milestone detection**, cost per tool, tool success/failure tracking |
| `experimental_onStepStart` | Before each step begins | ❌ Not used | **CRDT**: mark busy, Channel B "started" |
| `experimental_onStart` | Before first LLM call | ❌ Not used | Initialization hooks |
| `onError` | On stream error | ❌ Not used | Error handling, Channel B "failed" |
| `onAbort` | On abort signal | ❌ Not used | Cleanup |

### Key Insight: Hooks Replace Both Bus AND the Stream Mapping Loop

The current `executeToolMode()` in AiSdkAgent has a **120-line `for await` loop** that:
1. Iterates `result.fullStream` (AI SDK's raw stream)
2. Maps 15 AI SDK part types to our `AgentEvent` wrapper
3. Adds IDs, smooth buffering, step tracking

Then consumers unwrap `event.type === "stream_part"` to get back to the AI SDK data. This is circular:

```
AI SDK TextStreamPart → 120-line mapping → AgentEvent wrapper → consumer unwraps → uses the original data
```

With hooks, the data stays as AI SDK types. Visitors receive them directly:

```
AI SDK hooks fire → visitors receive TextStreamPart directly → done
```

### AgentEvent Is a Dead Abstraction

Audit of all 23 `yield` statements in `AiSdkAgent.executeToolMode()`:

| Yield Type | Count | What It Wraps |
|-----------|-------|---------------|
| `{ type: "stream_part", part: { ... } }` | **20** | AI SDK data wrapped in our envelope |
| `{ type: "thinking", content }` | 1 | Duplicates `reasoning-delta` |
| `{ type: "message", content }` | 1 | Duplicates accumulated text |
| `{ type: "done", output }` | 1 | Only useful lifecycle event |

20 of 23 yields are `stream_part` — every consumer checks `if (event.type === "stream_part")` then reads `event.part`. The wrapper adds zero value.

The `AgentEvent` union has 12 variants (`thinking`, `planning`, `tool_start`, `tool_result`, `message`, `message_delta`, `artifact`, `frame`, `hotspots`, `error`, `stream_part`, `done`). Only 2 are used by the streaming path (`stream_part` and `done`). The rest are legacy dead code from the pre-AI-SDK era.

### The Visitor Pattern on Agent Hooks

Instead of an external `AgentStreamBus` that observes yielded events, visitors register directly on the agent and get wired into `streamText()` hooks:

```typescript
// ── Visitor interface — matches AI SDK hook signatures ──────────────
interface AgentVisitor {
  /** Called for every stream chunk (text-delta, tool-call, reasoning, etc.) */
  onChunk?(chunk: TextStreamPart, ctx: StreamContext): void;
  /** Called after each LLM step completes — has token usage */
  onStepFinish?(result: StepFinishResult, ctx: StreamContext): void;
  /** Called when all steps are done — has full text, usage, steps */
  onFinish?(result: FinishResult, ctx: StreamContext): void;
  /** Called before each tool executes */
  onToolCallStart?(event: ToolCallStartEvent, ctx: StreamContext): void;
  /** Called after each tool completes — has duration, success/failure */
  onToolCallFinish?(event: ToolCallFinishEvent, ctx: StreamContext): void;
  /** Called before each LLM call — can modify tools, messages, model */
  prepareStep?(options: PrepareStepOptions, ctx: StreamContext): PrepareStepResult | void;
  /** Called on stream errors */
  onError?(error: unknown, ctx: StreamContext): void;
}

// ── Registration on the agent ───────────────────────────────────────
class AiSdkAgent {
  private visitors: AgentVisitor[] = [];
  
  addVisitor(visitor: AgentVisitor): void {
    this.visitors.push(visitor);
  }
}
```

#### How AiSdkAgent Wires Visitors into streamText()

```typescript
// Inside AiSdkAgent.executeToolMode():
const ctx: StreamContext = { teamId, goalId, agentKey, taskId };

const result = await streamText({
  model: this.model,
  messages: this.buildMessages(),
  tools: this.loadedTools,
  stopWhen: stopConditions,

  // ── Hooks dispatch to registered visitors ──────────────────
  onChunk: ({ chunk }) => {
    for (const v of this.visitors) v.onChunk?.(chunk, ctx);
  },
  onStepFinish: (stepResult) => {
    for (const v of this.visitors) v.onStepFinish?.(stepResult, ctx);
  },
  onFinish: (finishResult) => {
    for (const v of this.visitors) v.onFinish?.(finishResult, ctx);
  },
  experimental_onToolCallStart: (event) => {
    for (const v of this.visitors) v.onToolCallStart?.(event, ctx);
  },
  experimental_onToolCallFinish: (event) => {
    for (const v of this.visitors) v.onToolCallFinish?.(event, ctx);
  },
  prepareStep: async ({ stepNumber, messages }) => {
    let result: any = {};
    // Existing context trimming
    if (messages.length > 50) {
      result.messages = [messages[0]!, ...messages.slice(-30)];
    }
    // Visitor contributions
    for (const v of this.visitors) {
      const r = v.prepareStep?.({ stepNumber, messages }, ctx);
      if (r) result = { ...result, ...r };
    }
    return result;
  },
  onError: ({ error }) => {
    for (const v of this.visitors) v.onError?.(error, ctx);
  },
});

// Stream consumed — visitors already handled everything via hooks.
// No mapping loop needed. No AgentEvent wrapping. No generator yield.
await result.consumeStream();
```

#### Visitor Implementations

```typescript
// ── StreamPublisherVisitor (replaces SocketEventBroadcaster) ────────
class StreamPublisherVisitor implements AgentVisitor {
  private acc = { text: "", parts: [] as any[] };
  
  onChunk(chunk: TextStreamPart, ctx: StreamContext): void {
    // Real-time delivery — emit raw AI SDK chunk to Socket.IO
    this.io.to(goalRoom(ctx)).emit("stream", {
      teamId: ctx.teamId, agentId: ctx.agentKey,
      goalId: ctx.goalId, part: chunk,
    });
    // Accumulate for persistence
    switch (chunk.type) {
      case "text": this.acc.text += chunk.text; break;
      case "tool-call": this.acc.parts.push({ type: "tool-call", ...chunk }); break;
      case "tool-result": this.acc.parts.push({ type: "tool-result", ...chunk }); break;
      case "reasoning": this.acc.parts.push({ type: "reasoning", text: chunk.text }); break;
      // ... all 6 part types with exact merge semantics
    }
  }
  
  onFinish(result: FinishResult, ctx: StreamContext): void {
    // Persist accumulated message
    this.services.chat.addMessage({
      teamId: ctx.teamId, userId: ctx.userId, role: "assistant",
      content: this.acc.text, goalId: ctx.goalId,
      streamParts: JSON.stringify(toRenderedParts(this.acc.text, this.acc.parts)),
      agentLayer: ctx.agentKey === "planner" ? "planner" : "worker",
    });
  }
}

// ── ChannelBVisitor (replaces WorkerPool Channel B synthesis) ────────
class ChannelBVisitor implements AgentVisitor {
  private stepCount = 0;
  
  onStepFinish(result: StepFinishResult, ctx: StreamContext): void {
    this.stepCount++;
    if (this.stepCount % 3 === 0) {
      this.onTaskUpdate({ type: "progress", taskId: ctx.taskId!, stepIdx: this.stepCount,
        tokens: result.usage.totalTokens });
    }
  }
  
  onToolCallFinish(event: ToolCallFinishEvent, ctx: StreamContext): void {
    if (MILESTONE_TOOLS.has(event.toolCall.toolName)) {
      this.onTaskUpdate({ type: "tool_milestone", taskId: ctx.taskId!,
        tool: event.toolCall.toolName, summary: truncate(event.output, 100) });
    }
  }
  
  onFinish(_result: FinishResult, ctx: StreamContext): void {
    this.onTaskUpdate({ type: "completed", taskId: ctx.taskId! });
  }
  
  onError(error: unknown, ctx: StreamContext): void {
    this.onTaskUpdate({ type: "failed", taskId: ctx.taskId!, error: String(error) });
  }
}

// ── CrdtStatusVisitor ───────────────────────────────────────────────
class CrdtStatusVisitor implements AgentVisitor {
  private started = false;
  
  onChunk(_chunk: TextStreamPart, ctx: StreamContext): void {
    if (!this.started) {
      this.crdtTaskSync.updateAgentStatus(ctx.agentKey, "busy", ctx.taskId);
      this.started = true;
    }
  }
  
  onFinish(_result: FinishResult, ctx: StreamContext): void {
    this.crdtTaskSync.updateAgentStatus(ctx.agentKey, "idle", ctx.taskId);
  }
  
  onError(_error: unknown, ctx: StreamContext): void {
    this.crdtTaskSync.updateAgentStatus(ctx.agentKey, "idle", ctx.taskId);
  }
}
```

### How Extension Works: Zero Existing Code Changes

**Adding a new consumer** (e.g., cost tracking):
```typescript
// 1. Create: CostTrackingVisitor.ts (new file)
class CostTrackingVisitor implements AgentVisitor {
  onStepFinish(result: StepFinishResult, ctx: StreamContext): void {
    db.recordUsage({ teamId: ctx.teamId, goalId: ctx.goalId,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
  }
}

// 2. Register: one line in AgentFactory.create()
agent.addVisitor(new CostTrackingVisitor(db));
```

**Adding Redis Streams** (Phase 5):
```typescript
class RedisStreamVisitor implements AgentVisitor {
  onChunk(chunk: TextStreamPart, ctx: StreamContext): void {
    this.redis.xadd(`stream:${ctx.goalId}`, '*', 'chunk', JSON.stringify(chunk));
  }
}
// Register: agent.addVisitor(new RedisStreamVisitor(redis));
```

**Adding tool approval** (plugin-tool-runtime):
```typescript
class ToolApprovalVisitor implements AgentVisitor {
  prepareStep(options: PrepareStepOptions, ctx: StreamContext): PrepareStepResult | void {
    if (options.stepNumber > 10) {
      return { activeTools: options.tools.filter(t => !this.expensive.has(t)) };
    }
  }
}
```

### Comparison: External Bus vs Hooks+Visitor

| Aspect | External AgentStreamBus | Hooks+Visitor on streamText |
|--------|------------------------|---------------------------|
| Where events fire | After stream loop, in the caller | Inside `streamText()`, at the source |
| Stream mapping loop | 120 lines mapping AI SDK → AgentEvent | **Eliminated** — hooks provide data directly |
| `AgentEvent` wrapper | Required (12-variant union) | **Eliminated** — use AI SDK `TextStreamPart` directly |
| Generator `yield` chain | Required in 4 callers | **Eliminated** — `consumeStream()` drives hooks |
| Pre-execution interception | Not possible (bus is post-hoc) | `prepareStep` can modify tools, messages, model |
| Extension mechanism | `bus.addObserver(new X())` | `agent.addVisitor(new X())` |
| Type safety | `AgentEvent` union (mostly `stream_part`) | AI SDK `TextStreamPart` (proper discriminated union) |
| New dependency | Custom 45-line bus class | None — uses AI SDK's built-in hooks |
| Lines eliminated | ~400 (callbacks + broadcaster) | **~655** (callbacks + broadcaster + mapping loop + AgentEvent + generator chains) |

### What Hooks+Visitor Does NOT Handle

These 5 orchestration events are NOT from agent execution — they need **direct calls** on `IStreamPublisher`, not visitors:

| Event | Source | Mechanism |
|-------|--------|-----------|
| Plan approval broadcast + DB write | `AgentManager.approveOrchestratorPlan()` | `streamPublisher.onPlanUpdate()` |
| Plan proposed broadcast | `GoalManager` via callback | `streamPublisher.onPlanProposed()` |
| Goal status change + DB write | `GoalManager.onTaskComplete()` | `streamPublisher.onGoalStatusChange()` |
| Task status broadcast (DAG) | `GoalManager` / `TaskStore` | `streamPublisher.onTaskStatusChange()` |
| Discussion events | `CollabServer.onDiscussionChange()` | Stays as direct callback → Socket.IO |

### Roadmap Alignment

| Phase | Hooks+Visitor Compatible? | Notes |
|-------|--------------------------|-------|
| Phase 4: Parallel Goals | ✅ | `StreamContext.goalId` scopes visitors. Multiple concurrent agents = multiple visitor sets. |
| Phase 5: Process Isolation | ✅ | Add `RedisStreamVisitor` — zero interface changes. Worker process has local visitors. |
| Plugin Tool Runtime (MCP, dynamic tools) | ✅ | `prepareStep` visitor can filter `activeTools`. AgentFactory assembles MCP tools. |
| Cost Tracking | ✅ | `onStepFinish` has `result.usage` with full token breakdown. |
| Tool Approval | ⚠️ Partial | `experimental_onToolCallStart` is fire-and-forget (can't pause). Real approval needs `needsApproval` on tool definition. |
| ChatAgent Unicast Fix | ✅ | ChatAgent uses same `AiSdkAgent.execute()`. Add same visitors = broadcast via `StreamPublisherVisitor`. |

### Recommendation

**Use Hooks+Visitor.** It's strictly better than the external bus:
- Eliminates more code (~655 lines vs ~400)
- Uses AI SDK's native extension points instead of reimplementing them
- No intermediate `AgentEvent` abstraction
- `prepareStep` interception is impossible with an external bus
- Same extensibility (`addVisitor` = `addObserver`)
- Each visitor is still single-responsibility, independently testable

The external `AgentStreamBus` class is unnecessary. The agent IS the bus — its hooks ARE the extension points.

---

## Callback Hell: Before vs After Sequence Diagrams

### The Problem: 7 Callback Chains, 10 Hops Max

Every agent event traverses **4 forwarding layers** before reaching Socket.IO:

```
assembleLifecycleTools closure → WorkerPool.callbacks → OrchestratorCallbacks → AgentManager.streamCallbacks → SocketEventBroadcaster → Socket.IO
```

Two separate wiring sites (`OrchestratorService.initialize()` + `AgentManagerV2.initializeOrchestrator()`) connect 22 callbacks across 6 interfaces, 12 of which are pure pass-throughs.

### BEFORE: Worker Stream — 10 Hops (Current)

```
Agent         AiSdkAgent     WorkerPool    OrchestratorSvc    AgentManagerV2   SocketEventBcaster   Socket.IO   MongoDB
  │               │              │              │                   │                │                │          │
  │ streamText()  │              │              │                   │                │                │          │
  │──────────────>│              │              │                   │                │                │          │
  │               │              │              │                   │                │                │          │
  │               │ yield stream_part           │                   │                │                │          │
  │               │─────────────>│              │                   │                │                │          │
  │               │              │              │                   │                │                │          │
  │               │              │ HOP 1: callbacks.onStream(data)  │                │                │          │
  │               │              │─────────────>│                   │                │                │          │
  │               │              │              │                   │                │                │          │
  │               │              │              │ HOP 2: callbacks.onStream(data)    │                │          │
  │               │              │              │──────────────────>│                │                │          │
  │               │              │              │                   │                │                │          │
  │               │              │              │                   │ HOP 3: streamCallbacks.onStream │          │
  │               │              │              │                   │───────────────>│                │          │
  │               │              │              │                   │                │                │          │
  │               │              │              │                   │                │ HOP 4: accumulate part    │
  │               │              │              │                   │                │ HOP 5: io.to(room).emit  │
  │               │              │              │                   │                │───────────────>│          │
  │               │              │              │                   │                │                │          │
  │               │              │              │                   │                │ on "finish":   │          │
  │               │              │              │                   │                │ HOP 6: addMessage         │
  │               │              │              │                   │                │───────────────────────────>│
  │               │              │              │                   │                │                │          │
  │               │              │              │                   │                │                │          │
  │               │ yield done   │              │                   │                │                │          │
  │               │─────────────>│              │                   │                │                │          │
  │               │              │ HOP 7: callbacks.onDone          │                │                │          │
  │               │              │─────────────>│                   │                │                │          │
  │               │              │              │ HOP 8: callbacks.onDone            │                │          │
  │               │              │              │──────────────────>│                │                │          │
  │               │              │              │                   │ HOP 9: streamCallbacks.onDone   │          │
  │               │              │              │                   │───────────────>│                │          │
  │               │              │              │                   │                │ HOP 10: emit finish       │
  │               │              │              │                   │                │───────────────>│          │

  Total: 10 hops for a single text token to reach the user's browser.
  Hops 1→2, 2→3, 7→8, 8→9 are PURE PASS-THROUGHS — zero logic, just forwarding.
```

### AFTER: Worker Stream — 2 Hops (Hooks+Visitor)

```
Agent         AiSdkAgent           StreamPublisherVisitor    Socket.IO   MongoDB
  │               │                        │                    │          │
  │ streamText()  │                        │                    │          │
  │──────────────>│                        │                    │          │
  │               │                        │                    │          │
  │               │ onChunk hook fires     │                    │          │
  │               │ HOP 1: visitor.onChunk │                    │          │
  │               │───────────────────────>│                    │          │
  │               │                        │                    │          │
  │               │                        │ HOP 2: io.to(room).emit      │
  │               │                        │───────────────────>│          │
  │               │                        │                    │          │
  │               │ onFinish hook fires    │                    │          │
  │               │ HOP 1: visitor.onFinish│                    │          │
  │               │───────────────────────>│                    │          │
  │               │                        │ HOP 2: addMessage  │          │
  │               │                        │──────────────────────────────>│

  Total: 2 hops. No pass-throughs. No WorkerPool, OrchestratorService, or AgentManagerV2 in the path.
```

### BEFORE: Lifecycle Tool (complete_task) — 9 Hops

```
Agent     completeTaskTool  assembleLifecycle   WorkerPool   OrchestratorSvc   GoalManager     PluginRegistry   TaskStore    Socket.IO
  │            │                 │                 │              │                │                │              │            │
  │ complete() │                 │                 │              │                │                │              │            │
  │───────────>│                 │                 │              │                │                │              │            │
  │            │ await onComplete│                 │              │                │                │              │            │
  │            │────────────────>│                 │              │                │                │              │            │
  │            │                 │ HOP 1: callbacks.onAgentComplete               │                │              │            │
  │            │                 │────────────────>│              │                │                │              │            │
  │            │                 │                 │ HOP 2: onAgentComplete        │                │              │            │
  │            │                 │                 │─────────────>│                │                │              │            │
  │            │                 │                 │              │ HOP 3: await goalManager.onWorkerDone          │            │
  │            │                 │                 │              │───────────────>│                │              │            │
  │            │                 │                 │              │                │ HOP 4: await pluginRegistry.onTaskComplete  │
  │            │                 │                 │              │                │───────────────>│              │            │
  │            │                 │                 │              │                │    git merge   │              │            │
  │            │                 │                 │              │                │<───────────────│              │            │
  │            │                 │                 │              │                │ HOP 5: await taskStore.completeTask         │
  │            │                 │                 │              │                │──────────────────────────────>│            │
  │            │                 │                 │              │                │ HOP 6-9: DAG cascade + Socket.IO           │
  │            │                 │                 │              │                │              (Chain 6+7)      │            │
```

### AFTER: Lifecycle Tool (complete_task) — 5 Hops (Same — These Are Direct Callbacks)

```
Agent     completeTaskTool  assembleLifecycle   OrchestratorSvc   GoalManager     PluginRegistry   TaskStore
  │            │                 │                    │                │                │              │
  │ complete() │                 │                    │                │                │              │
  │───────────>│                 │                    │                │                │              │
  │            │ await onComplete│                    │                │                │              │
  │            │────────────────>│                    │                │                │              │
  │            │                 │ HOP 1: await onAgentComplete       │                │              │
  │            │                 │──────────────────>│                │                │              │
  │            │                 │                    │ HOP 2: await goalManager.onWorkerDone          │
  │            │                 │                    │──────────────>│                │              │
  │            │                 │                    │               │ HOP 3: await pluginRegistry   │
  │            │                 │                    │               │───────────────>│              │
  │            │                 │                    │               │ HOP 4: await taskStore        │
  │            │                 │                    │               │──────────────────────────────>│
  │            │                 │                    │               │ HOP 5: publishEvents → CRDT   │

  WorkerPool removed from the chain. Callbacks go directly from assembleLifecycleTools → OrchestratorService.
  These stay as direct awaited callbacks — NOT visitors. The caller reads task.completionSource immediately.
```

### BEFORE: Planner Streaming — 4 Hops

```
GoalManager    PlannerAgent    AiSdkAgent    onPlannerStream(closure)   AgentManagerV2    SocketEventBcaster   Socket.IO
  │               │               │                │                       │                   │                │
  │ executeTurn() │               │                │                       │                   │                │
  │──────────────>│ execute()     │                │                       │                   │                │
  │               │──────────────>│                │                       │                   │                │
  │               │               │ yield stream_part                      │                   │                │
  │ for await     │               │                │                       │                   │                │
  │ HOP 1: onPlannerStream(part)  │                │                       │                   │                │
  │───────────────────────────────────────────────>│                       │                   │                │
  │               │               │                │ HOP 2: streamCallbacks.onStream           │                │
  │               │               │                │──────────────────────>│                   │                │
  │               │               │                │                       │ HOP 3: broadcaster.onStream        │
  │               │               │                │                       │──────────────────>│                │
  │               │               │                │                       │                   │ HOP 4: io.emit │
  │               │               │                │                       │                   │───────────────>│
```

### AFTER: Planner Streaming — 2 Hops

```
GoalManager    PlannerAgent    AiSdkAgent    StreamPublisherVisitor   Socket.IO
  │               │               │                │                    │
  │ executeTurn() │               │                │                    │
  │──────────────>│ execute()     │                │                    │
  │               │──────────────>│                │                    │
  │               │               │ onChunk hook   │                    │
  │               │               │ HOP 1: visitor.onChunk              │
  │               │               │───────────────>│                    │
  │               │               │                │ HOP 2: io.emit     │
  │               │               │                │───────────────────>│

  3 intermediate layers eliminated. GoalManager doesn't even iterate the stream.
```

### BEFORE: ChatAgent — 3 Hops + UNICAST BUG

```
SocketMsgHandler    AgentManagerV2    ChatAgent    AiSdkAgent    socket (UNICAST)    MongoDB
  │                      │              │             │              │                 │
  │ handleChatAgentMsg() │              │             │              │                 │
  │─────────────────────>│              │             │              │                 │
  │                      │ chatAgentMessage()         │              │                 │
  │                      │─────────────>│             │              │                 │
  │                      │              │ execute()   │              │                 │
  │                      │              │────────────>│              │                 │
  │                      │              │             │ yield        │                 │
  │  for await           │              │             │              │                 │
  │  HOP 1: socket.emit("stream", part) │  ⚠️ UNICAST — only requesting socket sees it│
  │──────────────────────────────────────────────────>│                 │
  │                      │              │             │              │                 │
  │  on "finish":        │              │             │              │                 │
  │  HOP 2: accumulate   │              │             │              │                 │
  │  HOP 3: addMessage   │              │             │              │                 │
  │──────────────────────────────────────────────────────────────────>│

  Bug: socket.emit sends to ONE socket. Other team members in the goal room see nothing.
```

### AFTER: ChatAgent — 2 Hops, BROADCAST FIXED

```
SocketMsgHandler    ChatAgent    AiSdkAgent    StreamPublisherVisitor    Socket.IO(room)    MongoDB
  │                    │             │                │                      │                │
  │ handleChatAgentMsg │             │                │                      │                │
  │───────────────────>│             │                │                      │                │
  │                    │ execute()   │                │                      │                │
  │                    │────────────>│                │                      │                │
  │                    │             │ onChunk hook   │                      │                │
  │                    │             │ HOP 1: visitor.onChunk                │                │
  │                    │             │───────────────>│                      │                │
  │                    │             │                │ HOP 2: io.to(goalRoom).emit ✅ BROADCAST
  │                    │             │                │─────────────────────>│                │
  │                    │             │                │                      │                │
  │                    │             │ onFinish hook  │                      │                │
  │                    │             │ HOP 1: visitor.onFinish               │                │
  │                    │             │───────────────>│                      │                │
  │                    │             │                │ HOP 2: addMessage    │                │
  │                    │             │                │─────────────────────────────────────>│

  Same visitor as worker/planner. Broadcasts to goal room. All team members see the response.
  SocketMessageHandler no longer iterates the stream or accumulates — visitor does it all.
```

### BEFORE: Plan Approval — 7 Hops

```
SocketActionHandler   AgentManagerV2   GoalManager   TaskStore   streamCallbacks   SocketEventBcaster   Socket.IO   Goals DB
  │                        │               │            │              │                 │                │          │
  │ handleApprovePlan()    │               │            │              │                 │                │          │
  │───────────────────────>│               │            │              │                 │                │          │
  │                        │ approveOrch() │            │              │                 │                │          │
  │                        │──────────────>│            │              │                 │                │          │
  │                        │               │ approvePlan()             │                 │                │          │
  │                        │               │───────────>│              │                 │                │          │
  │                        │               │  create tasks             │                 │                │          │
  │                        │               │<───────────│              │                 │                │          │
  │                        │<──────────────│            │              │                 │                │          │
  │                        │                            │              │                 │                │          │
  │                        │ HOP 1: streamCallbacks.onPlanUpdate       │                 │                │          │
  │                        │─────────────────────────────────────────>│                 │                │          │
  │                        │                            │              │ HOP 2: broadcaster.onPlanUpdate  │          │
  │                        │                            │              │────────────────>│                │          │
  │                        │                            │              │                 │ HOP 3: io.emit("state")  │
  │                        │                            │              │                 │───────────────>│          │
  │                        │                            │              │                 │ HOP 4: goals.updateGoal  │
  │                        │                            │              │                 │──────────────────────────>│
```

### AFTER: Plan Approval — 3 Hops (Direct Call)

```
SocketActionHandler   AgentManagerV2   GoalManager   StreamPublisherVisitor   Socket.IO   Goals DB
  │                        │               │                │                    │          │
  │ handleApprovePlan()    │               │                │                    │          │
  │───────────────────────>│               │                │                    │          │
  │                        │ approveOrch() │                │                    │          │
  │                        │──────────────>│  approvePlan() │                    │          │
  │                        │               │  create tasks  │                    │          │
  │                        │<──────────────│                │                    │          │
  │                        │                                │                    │          │
  │                        │ HOP 1: streamPublisher.onPlanUpdate (DIRECT)        │          │
  │                        │───────────────────────────────>│                    │          │
  │                        │                                │ HOP 2: io.emit    │          │
  │                        │                                │───────────────────>│          │
  │                        │                                │ HOP 3: goals.updateGoal      │
  │                        │                                │─────────────────────────────>│

  streamCallbacks layer eliminated. AgentManagerV2 calls visitor directly. No SocketEventBroadcaster.
```

### Summary: Hop Count Reduction

| Chain | Before | After | Reduction | Pass-throughs Eliminated |
|-------|--------|-------|-----------|------------------------|
| Worker stream (text token) | 10 hops | 2 hops | **-8** | 4 pure forwarding layers |
| `complete_task` lifecycle | 9 hops | 5 hops | **-4** | WorkerPool removed from chain |
| `report_status` lifecycle | 5 hops | 5 hops | **0** | Stays as direct callback (sync mutation) |
| Planner stream | 4 hops | 2 hops | **-2** | 3-hop pass-through chain |
| ChatAgent stream | 3 hops + BUG | 2 hops + FIX | **-1 + fix** | Unicast → broadcast |
| Plan approval | 7 hops | 3 hops | **-4** | streamCallbacks + broadcaster |
| Goal status change | 6 hops | 3 hops | **-3** | streamCallbacks + broadcaster |

**Total: 44 hops → 22 hops (50% reduction).** 12 pure pass-through callbacks eliminated entirely.

---

## Architecture Options

### Option A: IStreamPublisher Interface (Simple)

**Implementation:** Single interface injected into WorkerPool and GoalManager. One class handles all stream consumers.

```
WorkerPool/GoalManager
  → streamPublisher.publish(part)
    → io.emit() + accumulate + Channel B + CRDT status
```

**Pros:**
- Simplest — one new interface, one impl
- Minimal code change (swap callback for method call)
- Easy to understand

**Cons:**
- All consumers in one class — violates SRP
- Adding consumers means editing the publisher
- Violates Open/Closed principle
- Channel B synthesis still mixed in somewhere

**Effort:** 3-4 days

---

### Option B: AgentStreamBus with Observers

**Implementation:** Agents emit events to a lightweight bus. Independent observer classes react to the events they care about. Each observer is a focused, testable class.

```
Agent yields event
  → bus.emit(event, context)
    → StreamPublisherObserver   (tokens → Socket.IO + persist)
    → ChannelBObserver          (progress + milestones → ChatAgent + sidebar)
    → TaskLifecycleObserver     (done/error → DAG + dispatch next)
    → CrdtStatusObserver        (busy/idle)
    → (future: CostTracker, RedisStreamObserver, ...)
```

```typescript
interface AgentStreamObserver {
  onEvent(event: AgentEvent, ctx: StreamContext): void;
}

class AgentStreamBus {
  private observers: AgentStreamObserver[] = [];
  addObserver(o: AgentStreamObserver): void { this.observers.push(o); }
  emit(event: AgentEvent, ctx: StreamContext): void {
    for (const o of this.observers) o.onEvent(event, ctx);
  }
}

interface StreamContext {
  teamId: string;
  goalId: string;
  agentKey: string;  // "planner" | "worker:backend-dev" | "chat:researcher"
  taskId?: string;
}
```

**Pros:**
- Each observer is SRP — one concern per class
- Open/Closed — add consumers without editing existing code
- Each observer independently testable
- Clean separation: streaming vs progress vs lifecycle vs CRDT
- Maps to real-world vision: agents stream freely, services observe
- Natural extension point for Redis Streams (add observer, don't replace)
- Fixes ChatAgent unicast bug (same bus for all agents)

**Cons:**
- More files (bus + 4 observers)
- Slightly more indirection than a direct method call
- Must be careful about observer error isolation

**Effort:** 1 week

---

### Option C: Node.js EventEmitter

**Implementation:** Use built-in EventEmitter. Agents emit typed events. Listeners registered per event type.

```typescript
const bus = new EventEmitter();
bus.on("stream_part", (part, ctx) => io.emit(...));
bus.on("stream_part", (part, ctx) => channelB.observe(part));
bus.on("done", (data, ctx) => taskStore.complete(...));
```

**Pros:**
- Built-in Node.js, no new classes needed
- Familiar API
- Wildcard listeners possible (`bus.on("*", ...)`)

**Cons:**
- No type safety — event names are strings
- Error in one listener crashes all (unless wrapped)
- **Copilot instructions say "Do NOT add new EventEmitters"** — project convention
- Hard to trace event flow (string-based dispatch)
- No structured context (just positional args)

**Effort:** 3-4 days

---

## Recommendation: Option B — Tiered AgentStreamBus with Observers

Option B with sync/async tiers is the gold standard:

### Why This Pattern

1. **It's what the codebase already wants to be.** The current callbacks ARE observers — just implemented as a 4-hop chain instead of a proper pattern.
2. **Satisfies the team vision.** Agents stream freely (like team members communicating). Services observe (dashboard, project tracker, team lead). Adding a new observer = plugging in a new service.
3. **Open/Closed.** Redis Streams = add `RedisStreamObserver`. Cost tracking = add `CostTrackingObserver`. No existing code changes.
4. **Respects project convention.** No EventEmitter (Option C rejected per copilot-instructions.md).
5. **Reactive Manifesto aligned.** Message-driven (async bus), resilient (per-observer error isolation), elastic (no contention), responsive (sync tier for real-time).

### Research Findings

| Pattern | Verdict |
|---------|---------|
| **Node.js Streams** (Transform/Writable pipeline) | Too heavy for in-memory object routing — designed for byte streams, not event fan-out. Our agents yield typed objects, not buffers. |
| **RxJS / ReactiveX** | Powerful but adds 50KB dependency. Overkill — we need fan-out, not map/filter/merge operators. |
| **Reactive Manifesto** | Validates our design: message-driven, resilient (failure isolation), elastic (no contention), responsive (consistent latency). |
| **Node.js `Readable.from(asyncGenerator)`** | AiSdkAgent.execute() is already an async generator. Composable with our bus — the generator feeds the bus, not a Node.js stream. |
| **`stream.pipeline()`** | Useful for sequential transforms, not parallel fan-out to N consumers. |

### The Tiered Design

```typescript
interface AgentStreamObserver {
  /** Sync — MUST be fast (<1ms). For real-time delivery. */
  onEvent?(event: AgentEvent, ctx: StreamContext): void;
  
  /** Async — can be slow. For persistence, CRDT, etc. Fire-and-forget. */
  onEventAsync?(event: AgentEvent, ctx: StreamContext): Promise<void>;
}

class AgentStreamBus {
  private syncObservers: AgentStreamObserver[] = [];
  private asyncObservers: AgentStreamObserver[] = [];

  addObserver(observer: AgentStreamObserver, tier: "sync" | "async" = "sync") {
    if (tier === "sync") this.syncObservers.push(observer);
    else this.asyncObservers.push(observer);
  }

  emit(event: AgentEvent, ctx: StreamContext): void {
    // Tier 1: Sync — run immediately, error-isolated
    for (const o of this.syncObservers) {
      try { o.onEvent?.(event, ctx); }
      catch (err) { logger.error({ err, observer: o.constructor.name }, "Sync observer error"); }
    }

    // Tier 2: Async — fire-and-forget, never blocks sync
    for (const o of this.asyncObservers) {
      o.onEventAsync?.(event, ctx)?.catch((err) => {
        logger.error({ err, observer: o.constructor.name }, "Async observer error");
      });
    }
  }
}

interface StreamContext {
  teamId: string;
  goalId: string;
  agentKey: string;  // "planner" | "worker:backend-dev" | "chat:researcher"
  taskId?: string;
}
```

### Observer Tiers

| Tier | Observer | What It Does | Latency |
|------|----------|-------------|---------|
| **Sync** | `StreamPublisherObserver` | `io.to(room).emit()` + accumulate text | <1ms |
| **Sync** | `ChannelBObserver` | `finish-step` → progress, `tool-output` → milestone → ChatAgent + Socket.IO | <1ms |
| **Async** | `TaskLifecycleObserver` | `done` → PG update + DAG dispatch; `error` → retry/notify planner | 5-50ms |
| **Async** | `CrdtStatusObserver` | `start` → busy; `done`/`error` → idle | 2-10ms |
| **Async** | (future) `CostTrackingObserver` | Count tokens, update billing | 1-5ms |
| **Async** | (future) `RedisStreamObserver` | `XADD stream:key * part {json}` | 1-5ms |

**Sync tier never waits for async tier.** Token delivery to the user's browser is never blocked by a database write.

### Why Not Other Patterns

| Alternative | Why Rejected |
|-------------|-------------|
| Single `IStreamPublisher.publish()` that does everything | Violates SRP + Open/Closed. All consumers in one method. Adding new consumer = edit existing code. |
| Node.js `EventEmitter` | Project convention says no new EventEmitters. No type safety. Error in one listener crashes all. |
| Node.js Streams (Transform pipeline) | Designed for sequential byte transforms, not parallel object fan-out. |
| RxJS Observables | External dependency. Powerful operators we don't need. Same result with 50 lines of custom code. |

---

## What Changes

### Refactoring: WorkerPool Split + AgentFactory

#### Current Problem: Three Agent Creation Paths

```
PLANNER:  Inline closure in AgentManagerV2.initializeOrchestrator() (42 lines)
          Creates PlannerAgent + planner tools + collab tools
          Captures `self`, 10+ closed-over variables

WORKER:   Inline in WorkerPool.runTask() (140 lines) 
          Creates AiSdkAgent + lifecycle tools + plugin tools + skills + identity file
          WorkerPool has 8 setter methods for dependencies it doesn't own

CHAT:     Inline closure in AgentManagerV2.initializeOrchestrator() (20 lines)
          Creates ChatAgent with dispatch/notify callbacks
          Captures `self`

Three different creation paths. Three different tool assembly patterns.
Tool assembly duplicated. Untestable closures.
```

#### Fix: Unified AgentFactory

```typescript
class AgentFactory {
  constructor(
    private pluginRegistry: PluginRegistry,
    private definitions: Map<string, AgentDefinition>,
    private teamId: string,
    private teamRoles: string[],
  ) {}

  /** One entry point — give me what you need, I build it. */
  async create(config: AgentCreateConfig): Promise<ConfiguredAgent> {
    // 1. Get or create base agent
    // 2. Assemble tools: lifecycle + plugin + skills (unified path)
    // 3. Prepare workspace (if worker)
    // 4. Return configured agent ready to execute
  }
}

// Usage — callers just ask:
const planner = await factory.create({ goalId, consumer: "planner" });
const worker  = await factory.create({ goalId, taskId, role: "backend-dev", consumer: "worker" });
const chat    = await factory.create({ goalId, role: "researcher", consumer: "chat" });
```

**All agents get tools from the same PluginRegistry path.** Adding a new tool type (MCP, custom) = add to PluginRegistry once, all agent types get it. The `consumer` field drives which tools/skills are assembled.

#### What Each Component Becomes

```
BEFORE:                                    AFTER:

AgentManagerV2 (1310 lines)               AgentManagerV2 (~900 lines)
├── initializeOrchestrator (400 lines)    ├── initializeOrchestrator (~250 lines)
│   ├── planner closure (42 lines)        │   └── wiring only, no closures
│   ├── chatAgent closure (20 lines)      │
│   ├── callback wiring (60 lines)        ├── AgentFactory (new, ~150 lines)
│   └── event bus setup (80 lines)        │   └── create(type, config) — all agents
│                                         │
├── streamCallbacks (dead code)           └── removes: streamCallbacks,
├── registerStreamCallbacks()                  registerStreamCallbacks(),
└── 8+ methods for WorkerPool setup            closures, callback wiring

WorkerPool (686 lines)                    WorkerPool (~150 lines)
├── runTask (280 lines, god method)       ├── definitions: Map<role, AgentDefinition>
│   ├── tool assembly (140 lines)         ├── workers: Map<taskId, AiSdkAgent>
│   ├── iteration + callbacks (50 lines)  ├── executeAgent(agent, taskId): AsyncGenerator
│   ├── Channel B (30 lines)              ├── dispose(taskId)
│   └── done/error (20 lines)            └── disposeByGoal(goalId)
├── 8 setter methods
├── callbacks interface
└── definitions + workers Maps

SocketEventBroadcaster (374 lines)        DELETED — replaced by StreamPublisherObserver
```

#### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `agent/AgentFactory.ts` | ~150 | Unified agent creation: planner, worker, chat. One tool assembly path. |
| `streaming/AgentStreamBus.ts` | ~45 | Tiered bus + observer interface |
| `streaming/StreamPublisherObserver.ts` | ~65 | Channel A → Socket.IO + persist on finish |
| `streaming/ChannelBObserver.ts` | ~50 | Coarse progress synthesis |
| `streaming/TaskLifecycleObserver.ts` | ~80 | done/error → GoalManager |
| `streaming/CrdtStatusObserver.ts` | ~20 | CRDT busy/idle |

#### Modified Files

| File | Change |
|------|--------|
| `WorkerPool.ts` | Strip from 686 → ~150 lines. Remove tool assembly, callbacks, setters. Keep definitions + executeAgent + dispose. |
| `OrchestratorService.ts` | `dispatchTask()`: use `agentFactory.create("worker", ...)` + iterate via `workerPool.executeAgent()` + emit to bus. Remove `workerPool.setCallbacks()` block (70 lines). |
| `GoalManager.ts` | `executePlannerTurn()`: use `agentFactory.create("planner", ...)` + emit to bus. Remove `onPlannerStream` callback. |
| `AgentManagerV2.ts` | Create `AgentFactory` instance. Remove planner/chatAgent closures. Remove `streamCallbacks`. Pass factory to OrchestratorService + GoalManager. |
| `SocketMessageHandler.ts` | ChatAgent: `agentFactory.create("chat", ...)` + emit to bus (fixes unicast). |
| `SocketServerV2.ts` | Create `StreamPublisherObserver` instead of `SocketEventBroadcaster`. |

#### Deleted Files

| File | Lines | Replaced By |
|------|-------|------------|
| `SocketEventBroadcaster.ts` | 374 | `StreamPublisherObserver` |

### What Stays Unchanged

| Component | Why |
|-----------|-----|
| **Orchestration flow** (GoalManager → OrchestratorService → dispatch) | Command/control, not observation |
| **Tool callbacks** (complete_task, report_status, bounce_task) | Synchronous, must return result to agent. `report_status(blocked)` mutates `task.lastReportedStatus` which `dispatchTask()` reads immediately — MUST stay in sync control path. |
| **Worker lifecycle callbacks** (onAgentComplete, onStatusUpdate, onBounce, onTaskCreated, onMentionedRoles) | Mutate task state or trigger orchestration. Stay as direct function calls, NOT on bus. |
| **TaskStore / RoleTaskQueue** | Task state machine transitions |
| **DispatchManager** | Concurrency management |
| **GoalEventBus** | Domain events for CRDT projection |
| **AiSdkAgent / PlannerAgent / ChatAgent** | Agent classes unchanged — factory creates them |

**Only streaming pass-throughs move to bus.** The 4 callbacks that are pure pass-throughs (onStream, onDone, onError, onEvent) become bus events. The 5 callbacks that mutate state (onAgentComplete, onStatusUpdate, onBounce, onTaskCreated, onMentionedRoles) stay as direct function calls.

---

## Callback Migration Map

### Current State: 4-Layer Callback Chain (BEFORE)

22 callbacks across 6 interfaces, 12 are pure pass-throughs.

```
┌─ AiSdkAgent (streamText generator) ──────────────────────────┐
│  yields: stream_part, done, error                             │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─ WorkerPool.runTask() ───────────────────────────────────────┐
│  WorkerCallbacks (10 callbacks)                               │
│  onStream, onEvent, onDone, onError, onTaskUpdate,            │
│  onAgentComplete, onStatusUpdate, onBounce,                   │
│  onTaskCreated, onMentionedRoles                              │
└──────────┬──────────────────────────┬────────────────────────┘
           │ (pass-throughs)          │ (orchestration)
           ▼                          ▼
┌─ OrchestratorService ──────────────────────────────────────┐
│  Forwards 4 streaming callbacks (onStream/Event/Done/Error) │
│  Handles 5 lifecycle callbacks (Complete/Status/Bounce/...)  │
│  OrchestratorCallbacks (11 callbacks, 7 pass-throughs)       │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─ AgentManagerV2 ───────────────────────────────────────────┐
│  ManagerStreamCallbacks (10 callbacks, all forwarded)        │
│  registerStreamCallbacks() wired by SocketEventBroadcaster   │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─ SocketEventBroadcaster ──────────────────────────────────┐
│  io.to(room).emit("stream" | "state" | "progress" | ...)   │
│  + message accumulation + persistence on "finish"           │
└─────────────────────────────────────────────────────────────┘

Separate path (ChatAgent) — bypasses entire chain:
  ChatAgent generator → SocketMessageHandler → socket.emit() (unicast bug)
```

### After Migration: Bus + Direct Callbacks (AFTER)

```
┌─ AiSdkAgent (streamText generator) ──────────────────────────┐
│  yields: stream_part, done, error                             │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─ AgentStreamBus.emit(event, ctx) ────────────────────────────┐
│  SYNC tier (<1ms):                                            │
│    StreamPublisherObserver  → io.to(room).emit("stream")      │
│    ChannelBObserver         → progress + milestone events     │
│                                                                │
│  ASYNC tier (fire-and-forget):                                │
│    TaskLifecycleObserver    → done/error → GoalManager        │
│    CrdtStatusObserver       → busy/idle                       │
└──────────────────────────────────────────────────────────────┘

Direct callbacks (unchanged, NOT on bus):
  report_status  → task.lastReportedStatus (sync mutation)
  complete_task  → GoalManager.onWorkerDone() (sync)
  bounce_task    → GoalManager.handleTaskFailure() (sync)
  request_task   → TaskStore.addTask() + DAG rebuild (sync)
```

### Callback Classification: What Stays vs What Moves

#### DELETED — Pure pass-throughs eliminated by bus (12 callbacks)

| Callback | Layer | Why Deleted |
|----------|-------|-------------|
| `WorkerCallbacks.onStream` | WorkerPool → Orch | Bus replaces: StreamPublisherObserver |
| `WorkerCallbacks.onEvent` | WorkerPool → Orch | Bus replaces: ChannelBObserver |
| `WorkerCallbacks.onDone` | WorkerPool → Orch | Bus replaces: TaskLifecycleObserver |
| `WorkerCallbacks.onError` | WorkerPool → Orch | Bus replaces: TaskLifecycleObserver |
| `WorkerCallbacks.onTaskUpdate` | WorkerPool → Orch | Bus replaces: ChannelBObserver |
| `OrchestratorCallbacks.onStream` | Orch → AgentMgr | Was just `this.streamCallbacks?.onStream?.(data)` |
| `OrchestratorCallbacks.onEvent` | Orch → AgentMgr | Was just `this.streamCallbacks?.onEvent?.(data)` |
| `OrchestratorCallbacks.onDone` | Orch → AgentMgr | Was just `this.streamCallbacks?.onDone?.(data)` |
| `OrchestratorCallbacks.onError` | Orch → AgentMgr | Was just `this.streamCallbacks?.onError?.(data)` |
| `ManagerStreamCallbacks.onStream` | AgentMgr → Broadcaster | Broadcaster replaced by StreamPublisherObserver |
| `ManagerStreamCallbacks.onEvent` | AgentMgr → Broadcaster | Broadcaster replaced by ChannelBObserver |
| `onPlannerStream` | GoalMgr → Orch → AgentMgr → Broadcaster | 3-hop pass-through. Bus replaces directly. |

#### STAYS — Direct callbacks (synchronous, state-mutating, or orchestration)

| Callback | Where | Why It Stays |
|----------|-------|-------------|
| `report_status` tool callback | assembleLifecycleTools → WorkerCallbacks.onStatusUpdate | **CRITICAL:** Writes `task.lastReportedStatus` synchronously. `dispatchTask()` reads it immediately after `runTask()` returns. Moving to async = race condition. |
| `complete_task` tool callback | assembleLifecycleTools → WorkerCallbacks.onAgentComplete → GoalManager.onWorkerDone() | Merges workspace, marks task complete, publishes domain events. Must complete before auto-complete guard. |
| `bounce_task` tool callback | assembleLifecycleTools → WorkerCallbacks.onBounce | Marks task failed, notifies planner. Reads/writes task state. |
| `request_task` tool callback | assembleLifecycleTools → WorkerCallbacks.onTaskCreated | Creates task in TaskStore, rebuilds DAG. Must complete atomically. |
| `onMentionedRoles` | WorkerPool → OrchestratorService.spawnCollabWorkers() | Spawns collab workers. Side-effect-heavy, no observation semantics. |
| `TaskCallbacks.onTaskReady` | RoleTaskQueue → GoalManager | Part of task DAG — triggers dispatch. |
| `TaskCallbacks.onTaskComplete` | RoleTaskQueue → GoalManager | Checks goal completion, cascades. |
| `TaskCallbacks.onTaskFailed` | RoleTaskQueue → GoalManager | Handles failure cascade. |
| `GoalManagerCallbacks.onDispatchTask` | GoalManager → OrchestratorService | Entry point to dispatch pipeline. |
| `GoalManagerCallbacks.onNotifyPlanner` | GoalManager → NotificationQueue → GoalManager | Circular roundtrip (debounced). |

#### MOVES TO BUS — Currently direct but becoming observers

| Callback | Current Location | New Observer |
|----------|-----------------|-------------|
| `onWorkerTaskUpdate` (Channel B) | Orch → AgentMgr → ChatAgent + Broadcaster | ChannelBObserver |
| `onGoalStatusChange` | GoalMgr → Orch → AgentMgr → Broadcaster | StreamPublisherObserver (state events) |
| `onPlanProposed` | GoalMgr → Orch → AgentMgr → Broadcaster | StreamPublisherObserver (state events) |
| `onPlanUpdate` | AgentMgr → Broadcaster | StreamPublisherObserver (state events) |
| `onTaskUpdate` (state) | GoalMgr → Orch → AgentMgr → Broadcaster | StreamPublisherObserver (state events) |

### Sequence Diagrams

#### Worker Task Execution (AFTER migration)

```
User               OrchestratorService    AgentFactory    WorkerPool     AiSdkAgent      Bus            Observers
 │                       │                    │              │              │              │                │
 │  goal/plan approved   │                    │              │              │              │                │
 │──────────────────────>│                    │              │              │              │                │
 │                       │                    │              │              │              │                │
 │                       │ create(worker,     │              │              │              │                │
 │                       │  { goalId, taskId, │              │              │              │                │
 │                       │    role, callbacks})│              │              │              │                │
 │                       │───────────────────>│              │              │              │                │
 │                       │                    │              │              │              │                │
 │                       │                    │ builds agent  │              │              │                │
 │                       │                    │ + lifecycle   │              │              │                │
 │                       │                    │   tools       │              │              │                │
 │                       │                    │ + plugin      │              │              │                │
 │                       │                    │   tools       │              │              │                │
 │                       │                    │ + skills      │              │              │                │
 │                       │   <configured agent>│              │              │              │                │
 │                       │<───────────────────│              │              │              │                │
 │                       │                    │              │              │              │                │
 │                       │ executeAgent(agent, taskId, input) │              │              │                │
 │                       │──────────────────────────────────>│              │              │                │
 │                       │                    │              │ execute()    │              │                │
 │                       │                    │              │─────────────>│              │                │
 │                       │                    │              │              │              │                │
 │                       │                    │              │   ┌─────────────────────────────────────┐   │
 │                       │                    │              │   │ for await (event of generator):     │   │
 │                       │                    │              │   │                                     │   │
 │                       │  <─── yield stream_part ─────────│<──│  stream_part {text-delta}           │   │
 │                       │                    │              │   │                                     │   │
 │                       │  bus.emit(event, ctx)             │   │                                     │   │
 │                       │───────────────────────────────────────────────>│                │            │
 │                       │                    │              │   │        │                │            │
 │                       │                    │              │   │        │ SYNC:          │            │
 │  <─ io.emit("stream") ─────────────────────────────────────────────── StreamPublisher  │            │
 │                       │                    │              │   │        │ ChannelB        │            │
 │                       │                    │              │   │        │                │            │
 │                       │                    │              │   │        │ ASYNC:         │            │
 │                       │                    │              │   │        │ CrdtStatus (busy)           │
 │                       │                    │              │   │                                     │
 │                       │                    │              │   │  ── agent calls report_status ──    │
 │                       │                    │              │   │  DIRECT CALLBACK (not bus):         │
 │                       │                    │              │   │  → task.lastReportedStatus = X      │
 │                       │                    │              │   │                                     │
 │                       │                    │              │   │  ── agent calls complete_task ──    │
 │                       │                    │              │   │  DIRECT CALLBACK (not bus):         │
 │                       │                    │              │   │  → GoalManager.onWorkerDone()       │
 │                       │                    │              │   │  → workspace merge + task complete  │
 │                       │                    │              │   │                                     │
 │                       │  <─── yield done ────────────────│<──│  done {summary, deliverables}       │
 │                       │                    │              │   └─────────────────────────────────────┘
 │                       │  bus.emit(done, ctx)              │              │              │                │
 │                       │───────────────────────────────────────────────>│                │                │
 │  <─ io.emit("stream", finish) ───────────────────────────────────────── StreamPublisher │                │
 │                       │                    │              │              │ CrdtStatus(idle)              │
 │                       │                    │              │              │              │                │
 │                       │  auto-complete check:             │              │              │                │
 │                       │  if (status==in_progress &&       │              │              │                │
 │                       │      lastReportedStatus!=blocked) │              │              │                │
 │                       │    → completeTask()               │              │              │                │
```

#### Planner Streaming (AFTER migration)

```
User        GoalManager     AgentFactory     PlannerAgent       Bus           StreamPublisher
 │              │                │                │               │                │
 │  message     │                │                │               │                │
 │─────────────>│                │                │               │                │
 │              │                │                │               │                │
 │              │ create(planner,│                │               │                │
 │              │  { goalId })   │                │               │                │
 │              │───────────────>│                │               │                │
 │              │                │ builds planner │               │                │
 │              │                │ + 15 plan tools│               │                │
 │              │                │ + collab tools │               │                │
 │              │ <─ planner ───│                │               │                │
 │              │                │                │               │                │
 │              │ executePlannerTurn()            │               │                │
 │              │───────────────────────────────>│               │                │
 │              │                │                │               │                │
 │              │   ┌────────────────────────────────────────┐   │                │
 │              │   │ for await (event of planner.execute()): │   │                │
 │              │   │                                         │   │                │
 │              │   │  stream_part {text-delta}               │   │                │
 │              │   │  bus.emit(event, {agentKey:"planner"})  │   │                │
 │              │───│─────────────────────────────────────────────>│                │
 │ <── io.emit("stream", {agentId:"planner"}) ───────────────────── StreamPublisher│
 │              │   │                                         │   │                │
 │              │   │  stream_part {tool-call: submit_plan}   │   │                │
 │              │───│─────────────────────────────────────────────>│                │
 │ <── io.emit("stream", {tool-call}) ───────────────────────────── StreamPublisher│
 │              │   │                                         │   │                │
 │              │   │  done                                   │   │                │
 │              │───│─────────────────────────────────────────────>│                │
 │ <── io.emit("stream", {finish}) + persist ────────────────────── StreamPublisher│
 │              │   └────────────────────────────────────────┘   │                │
```

#### ChatAgent Message (AFTER migration — unicast bug fixed)

```
User        SocketMessageHandler   AgentFactory    ChatAgent        Bus           StreamPublisher
 │              │                      │              │               │                │
 │ chat msg     │                      │              │               │                │
 │─────────────>│                      │              │               │                │
 │              │                      │              │               │                │
 │              │  create(chat,        │              │               │                │
 │              │   { goalId, role })  │              │               │                │
 │              │─────────────────────>│              │               │                │
 │              │                      │ builds chat  │               │                │
 │              │                      │ + read tools │               │                │
 │              │                      │ + plugin tools│              │                │
 │              │  <── chatAgent ─────│              │               │                │
 │              │                      │              │               │                │
 │              │  for await (event of chatAgent.execute()):         │                │
 │              │                      │              │               │                │
 │              │  bus.emit(event, {agentKey:"chat:researcher"})     │                │
 │              │──────────────────────────────────────────────────>│                │
 │              │                      │              │               │                │
 │ <── io.to(goalRoom).emit("stream") ────────────────────────────── StreamPublisher│
 │              │                      │              │               │                │
 │  ALL users in room see the response (not just requesting socket)  │                │
 │              │                      │              │               │                │
 │              │  finish → persist via StreamPublisher               │                │
 │              │──────────────────────────────────────────────────>│                │
 │              │                      │              │ persist       │ addMessage()   │
```

---

## Review Findings (May 7, 2026)

Code review against live runtime identified 4 risks and 1 open question. Classified as **fix first** (must resolve before or during this feature), **safe to defer** (separate feature/ticket), or **avoid** (do not change in this feature).

### Finding 1 — HIGH: Async lifecycle observer would regress blocked-task handling

**Classification: AVOID — keep report_status as direct callback**

The architecture doc already says `report_status(blocked)` must stay synchronous. But `TaskLifecycleObserver` in the implementation plan is scoped too broadly — it lists `onStatusUpdate` as something it handles. In reality:

- `report_status` tool → sets `task.lastReportedStatus = "blocked"` synchronously in WorkerPool callback
- `OrchestratorService.dispatchTask()` L630-635 reads `afterTask.lastReportedStatus === "blocked"` immediately after `runTask()` returns
- If this mutation lands in an async observer, a blocked worker can be auto-completed as success before the blocked status arrives

**Rule:** `onStatusUpdate` stays as a direct callback passed to `assembleLifecycleTools()`. It is NOT a bus event. The `TaskLifecycleObserver` only handles post-execution events (`done`, `error`) — never mid-execution state mutations.

### Finding 2 — HIGH: WorkerPool has 5 callers, not just dispatchTask

The plan treats `dispatchTask()` as the main (only) path. In reality, `WorkerPool.runTask()` has 5 distinct call sites:

| # | Caller | Overload | goalId? | Awaited? |
|---|--------|----------|---------|----------|
| 1 | `OrchestratorService.dispatchTask()` | TaskWithContext | Yes | Yes |
| 2 | `OrchestratorService.spawnCollabWorkers()` | (taskId, role, msg, goalId) | Yes (resolved) | No (fire-and-forget) |
| 3 | `AgentManagerV2.startTaskExecution()` | TaskWithContext | **No** — missing | Yes |
| 4 | `AgentManagerV2.startTask()` | (taskId, role, msg) | **No** | Yes |
| 5 | `AgentManagerV2.continueTask()` | (taskId, role, msg) | **No** | Yes |

**Classification: FIX FIRST — AgentFactory must handle all 5 paths**

Call sites 3-5 (AgentManagerV2) don't pass goalId and don't go through OrchestratorService. If AgentFactory only wires into the dispatchTask path, these callers silently lose plugin setup, skill injection, and workspace branching.

**Resolution:** AgentFactory.buildWorker() must handle both overloads. For legacy callers (3-5), factory resolves goalId from TaskStore (same as current WorkerPool fallback). Collab workers (2) must also route through factory — they currently skip plugin preflight and skill injection.

### Finding 3 — MEDIUM: ChatAgent persistence stamps wrong userId

**Classification: SAFE TO DEFER — separate bug fix**

The current ChatAgent path in `SocketMessageHandler.ts` L309 persists assistant messages with:
```typescript
userId: await this.services.teamRegistry?.getOwner(teamId) ?? "system"
```

This means assistant responses are attributed to the team owner, not the requesting user. Combined with Mongo's `getSessionMessages()` filter `{ $or: [{ userId }, { role: "assistant" }] }`, all users see all assistant messages regardless of who asked. SQLite's `getSessionMessages()` has no user filter at all.

This is a multi-user bug, not a stream-bus concern. The bus refactor preserves the existing (broken) behavior — `StreamPublisherObserver` will persist with the same userId logic. Fix separately in the multi-user feature.

### Finding 4 — HIGH: CRDT auth hole grows with more CRDT usage

**Classification: SAFE TO DEFER — but document the risk**

`HocuspocusServer.ts` L365-367:
```typescript
async onAuthenticate({ token }) {
  return { user: token || "anonymous" };
}
```

No team-level authorization. Any WebSocket client that reaches the Hocuspocus port can read/write any CRDT document. The stream-bus feature doesn't increase CRDT usage (observers don't create new CRDT docs), but the broader architecture trend of CRDT-as-planning-substrate amplifies this hole.

**Rule for this feature:** CrdtStatusObserver only calls `updateAgentStatus()` (existing path). Do NOT add new CRDT document creation or cross-goal CRDT access in this feature. CRDT auth is tracked in [crdt-auth](../crdt-auth/).

### Open Question: Multi-goal blockers are NOT fixed by this feature

The stream-bus improves structure but does not fix the scaling blockers:
- `messageChain` in OrchestratorService serializes all goals into one promise chain
- `activeGoalId` fallback in GoalManager collapses to last-active goal
- `MAX_CONCURRENT_DISPATCHES=2` is global, not per-goal

These are documented in [goal-sessions](../goal-sessions/feature_implementation_planning.md). The bus makes them easier to fix later (each observer is goal-scoped via `StreamContext.goalId`), but the fix is a separate feature.

---

### What This Does NOT Fix

The bus + factory is a streaming/creation cleanup. Multi-goal blockers need separate fixes:

| Blocker | Where | Fix |
|---------|-------|-----|
| `FF_PARALLEL_PLANS` gate | GoalManager | Remove if block |
| `activeGoalId` scalar | GoalManager | Require explicit goalId |
| `messageChain` serializes all goals | OrchestratorService | `Map<goalId, Promise>` |
| `MAX_CONCURRENT_DISPATCHES=2` global | DispatchManager | `Map<goalId, Budget>` |

See [goal-sessions implementation plan](../goal-sessions/feature_implementation_planning.md).

| File | Replaced By |
|------|------------|
| `SocketEventBroadcaster.ts` | `StreamPublisherObserver` |

---

## Execution Flow (After)

```
OrchestratorService.dispatchTask(taskId, role):
  │
  ├── 1. Configure agent
  │     definition = workerPool.getDefinition(role)
  │     agent = new AiSdkAgent(definition)
  │     tools = assembleLifecycleTools(...) + pluginRegistry.getTools(...)
  │     agent.setTools(tools)
  │
  ├── 2. Create bus with observers
  │     bus = new AgentStreamBus()
  │     bus.addObserver(streamPublisherObserver)  // Channel A
  │     bus.addObserver(channelBObserver)          // Channel B
  │     bus.addObserver(taskLifecycleObserver)     // done/error
  │     bus.addObserver(crdtStatusObserver)        // CRDT
  │
  └── 3. Iterate + emit
        for await (event of workerPool.executeAgent(agent, taskId)):
          bus.emit(event, { teamId, goalId, agentKey: role, taskId })
```

---

## Impact on Frontend

None. Socket.IO events are identical — same `stream` channel, same payload shape. `StreamPublisherObserver` emits the same data that `SocketEventBroadcaster` does now.

**One fix:** ChatAgent responses will now broadcast to the goal room (via observer) instead of unicasting to the requesting socket. This means other users watching the same goal will see ChatAgent responses — which is correct behavior.
