# Agent Hooks + Visitor Refactor — Feature Architecture

**Date:** May 8, 2026
**Status:** Architecture — final design, ready to implement
**Priority:** P1 — Foundation for clean streaming, extensibility, universal agent interface
**Depends on:** Multi-goal scalar fixes ✅ (completed May 7)
**Related:** [plugin-tool-runtime](../plugin-tool-runtime/), [plugin-ecosystem](../plugin-ecosystem/)
**Research history:** [feature_architecture_research_history.md](./feature_architecture_research_history.md)

---

## Bridge State (current implementation, post-PM-6)

The code in `packages/agent-manager/src/agent/streaming/` is the **target** design. Most of the original Phase 1.5 strangler bridge has now closed: workers, planner, and ChatAgent all run through `factory.wire()` + `runWithHooks()`. The two remaining bridges are deferred to follow-up patches:

| Surface | Doc (target) | Current bridge | Resolution path |
|---|---|---|---|
| Method name | `IAgent.run(input)` | `IStreamingAgent.runWithHooks(input)` | The legacy `AiSdkAgent.run(prompt, threadId)` helper is still used by the definition builder. Converges in Phase 2 when the helper is removed. |
| `goalId` on context | `AgentInput.goalId?: string` (optional) | `StreamingAgentContext.goalId: string` (required); loose `AgentContext` keeps it optional for non-streaming/builder flows | Final shape — type-system enforcement so a streaming agent cannot be wired to Socket.IO/CRDT visitors without a goalId. Will not change. |
| Native AI SDK callbacks | `streamText({ onChunk, onStepFinish, onFinish, onError, experimental_onToolCallStart, ... })` driven directly | `runWithHooks()` still consumes the `execute()` AsyncGenerator internally and re-translates events into hook calls. `IAgent.execute` is `@deprecated @internal` — production callers use only `runWithHooks`. | **Patch #1 follow-up**: refactor `runWithHooks` to drive native `streamText` callbacks directly, then physically remove `execute()` from `IAgent` and `AiSdkAgent`. |
| Stream broadcast + persistence ownership | Visitors own everything — `StreamPublisherVisitor` broadcasts to goal room AND persists assistant messages | `StreamPublisherVisitor` forwards stream parts to `OrchestratorService.callbacks.onStream`; `SocketEventBroadcaster` (374 lines) accumulates + persists + broadcasts. | **Patch #3 follow-up**: visitor-owns-persistence migration. Delete `SocketEventBroadcaster`, rewire frontend Socket.IO channel mapping. Cross-package (backend + frontend). |

The `StreamingHooks` back-pressure contract is firm and final:
- `onStart`, `onChunk`, `onStepFinish` are **fire-and-forget** — slow visitors must not stall token flow.
- `onFinish` and `onError` are **awaited** — persistence/cleanup completes before `runWithHooks()` returns.
- Every visitor call is wrapped in try/catch (in the composer); a throwing visitor never aborts the agent loop.

---

## Problem

The agent runtime has **22 callbacks across 6 interfaces**, creating a 4-layer forwarding chain for every event. Adding a new consumer (cost tracking, Redis) requires editing 4 files. The ChatAgent path bypasses the chain entirely (unicast bug). Tools mix validation, LLM response, and orchestration side effects.

## Solution

Two extension points on a universal agent interface:

1. **Streaming Visitors** — observation of execution (text tokens, tool calls, reasoning). Plugged into AI SDK `streamText()` hooks. Open/Closed for new consumers.
2. **Task Lifecycle Hooks** — agent's decisions communicated to the system (complete, blocked, bounce, subtask). Tools call the agent's own hooks. System plugs in handlers at creation time.

---

## Universal Agent Interface

Every agent — internal AiSdkAgent, external HTTP agent, child Ping team, Docker container — implements one interface:

```typescript
interface IAgent {
  readonly id: string;
  readonly role: string;

  /** Execute the task. Hooks fire during execution. */
  run(input: AgentInput): Promise<AgentResult>;

  /** Streaming observation — system plugs in before calling run() */
  onStreaming: StreamingHooks;

  /** Lifecycle decisions — system plugs in before calling run() */
  onTaskLifecycle: TaskLifecycleHooks;
}

interface AgentInput {
  message: string;
  threadId?: string;
  goalId?: string;
  taskId?: string;
}

interface AgentResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  steps?: number;
  finishReason: string;
}
```

### Streaming Hooks (Observation — Read-Only)

Visitors observe execution. They can't modify it. Fire-and-forget with per-visitor error isolation.

```typescript
interface StreamingHooks {
  onChunk?(chunk: StreamChunk, ctx: AgentContext): void;
  onStepFinish?(result: StepResult, ctx: AgentContext): void;
  onFinish?(result: FinishResult, ctx: AgentContext): void;
  onToolCallStart?(event: ToolCallStartEvent, ctx: AgentContext): void;
  onToolCallFinish?(event: ToolCallFinishEvent, ctx: AgentContext): void;
  prepareStep?(options: PrepareStepOptions, ctx: AgentContext): PrepareStepResult | void;
  onError?(error: unknown, ctx: AgentContext): void;
}
```

### Task Lifecycle Hooks (Agent Decisions — System Responds)

The agent fires these when it makes decisions. The system wires handlers at creation time. The agent doesn't know who's listening.

```typescript
interface TaskLifecycleHooks {
  /**
   * Agent completed the task — system does workspace merge + DAG cascade.
   * Returns `{ accepted: false, reason }` to reject (e.g. unmet prereqs);
   * the tool surfaces `reason` back to the LLM as an actionable error.
   */
  onComplete?(payload: TaskCompletePayload, ctx: StreamingAgentContext)
    : Promise<{ accepted: boolean; reason?: string }>;
  /** Agent reports status change (blocked, in_progress, etc.). Awaited. */
  onStatusChange?(payload: TaskStatusPayload, ctx: StreamingAgentContext)
    : Promise<void>;
  /** Agent can't do this task — system reassigns. Awaited. */
  onBounce?(payload: TaskBouncePayload, ctx: StreamingAgentContext)
    : Promise<void>;
  /**
   * Agent needs help — system creates subtask. Returns `{ accepted, newTaskId }`
   * so the orchestrator owns ID assignment in hooks mode.
   */
  onSubtaskRequest?(payload: SubtaskRequestPayload, ctx: StreamingAgentContext)
    : Promise<{ accepted: boolean; newTaskId?: string; reason?: string }>;
}
```

> **Source-of-truth shapes:** `TaskCompletePayload`, `TaskStatusPayload`, `TaskBouncePayload`, and `SubtaskRequestPayload` are defined in [`packages/agent-manager/src/agent/streaming/types.ts`](../../../packages/agent-manager/src/agent/streaming/types.ts). The legacy `request_task` data (priority, type, relationship, parentTaskId, goalId, planId, context) IS carried on `SubtaskRequestPayload` so the orchestrator can persist parity with the legacy task object.

### Agent Context (Scoping)

```typescript
interface AgentContext {
  teamId: string;
  goalId: string;
  taskId?: string;
  agentKey: string;   // "worker:backend-dev" | "planner" | "chat:researcher"
  userId?: string;
}
```

---

## How It Works: AiSdkAgent Implementation

### Streaming: AI SDK Hooks → Visitor Dispatch

```typescript
class AiSdkAgent implements IAgent {
  onStreaming: StreamingHooks = {};
  onTaskLifecycle: TaskLifecycleHooks = {};

  async run(input: AgentInput): Promise<AgentResult> {
    const ctx = this.buildContext(input);

    const result = await streamText({
      model: this.model,
      messages: this.buildMessages(),
      tools: this.buildTools(),

      // AI SDK hooks dispatch to streaming visitors
      onChunk: ({ chunk }) => {
        try { this.onStreaming.onChunk?.(chunk, ctx); }
        catch (e) { logger.error({ err: e }, "Visitor onChunk error"); }
      },
      onStepFinish: (r) => {
        try { this.onStreaming.onStepFinish?.(r, ctx); }
        catch (e) { logger.error({ err: e }, "Visitor onStepFinish error"); }
      },
      onFinish: (r) => {
        try { this.onStreaming.onFinish?.(r, ctx); }
        catch (e) { logger.error({ err: e }, "Visitor onFinish error"); }
      },
      experimental_onToolCallStart: (event) => {
        try { this.onStreaming.onToolCallStart?.(event, ctx); }
        catch (e) { logger.error({ err: e }, "Visitor onToolCallStart error"); }
      },
      experimental_onToolCallFinish: (event) => {
        try { this.onStreaming.onToolCallFinish?.(event, ctx); }
        catch (e) { logger.error({ err: e }, "Visitor onToolCallFinish error"); }
      },
      prepareStep: async ({ stepNumber, messages }) => {
        let result: any = {};
        if (messages.length > 50) {
          result.messages = [messages[0]!, ...messages.slice(-30)];
        }
        try {
          const r = this.onStreaming.prepareStep?.({ stepNumber, messages }, ctx);
          if (r) result = { ...result, ...r };
        } catch (e) { logger.error({ err: e }, "Visitor prepareStep error"); }
        return result;
      },
    });

    await result.consumeStream();
    return { text: await result.text, usage: await result.usage, finishReason: "stop" };
  }
}
```

### Lifecycle: Tools Call Agent's Own Hooks

Tools are thin — validate input, call the agent's hook, format response for LLM.

The agent doesn't know who's listening. In tests → mocks. In CLI → console.log. In production → GoalManager + TaskStore + DAG.

```typescript
private buildLifecycleTools(): ToolSet {
  return {
    complete_task: tool({
      name: "complete_task",
      inputSchema: CompleteTaskSchema,
      execute: async (input) => {
        const ack = await this.onTaskLifecycle.onComplete?.(
          {
            summary: input.summary,
            deliverables: input.deliverables,
            nextSteps: input.nextSteps,
            producedDocs: input.producedDocs,
            decisions: input.decisions,
            timestamp: Date.now(),
          },
          this.ctx,
        );
        return ack?.accepted === false
          ? `ERROR: ${ack.reason ?? "no reason given"}`
          : `Task marked complete: ${input.summary}`;
      },
    }),
    report_status: tool({
      name: "report_status",
      inputSchema: TaskStatusSchema,
      execute: async (input) => {
        await this.onTaskLifecycle.onStatusChange?.(
          { status: input.status, detail: input.summary },
          this.ctx,
        );
        return `Status reported: ${input.status}`;
      },
    }),
    bounce_task: tool({
      name: "bounce_task",
      inputSchema: BounceTaskSchema,
      execute: async (input) => {
        await this.onTaskLifecycle.onBounce?.(
          { reason: input.reason, suggestedRole: input.suggestedRole },
          this.ctx,
        );
        return `Task bounced: ${input.reason}`;
      },
    }),
    request_task: tool({
      name: "request_task",
      inputSchema: RequestTaskSchema,
      execute: async (input) => {
        const ack = await this.onTaskLifecycle.onSubtaskRequest?.(
          {
            description: `${input.title}: ${input.description}`,
            title: input.title,
            assignedRole: input.targetRole.toLowerCase(),
            dependsOn: input.relationship === "blocks-me" ? [this.ctx.taskId!] : undefined,
            priority: input.priority,
            type: input.type,
            relationship: input.relationship,
            parentTaskId: this.ctx.taskId,
            goalId: this.ctx.goalId,
            planId: this.planId,
            context: input.context,
          },
          this.ctx,
        );
        if (ack?.accepted === false) return `ERROR: ${ack.reason ?? "no reason given"}`;
        return `Task created: ${ack?.newTaskId ?? "unknown"}`;
      },
    }),
  };
}
```

---

## System Wiring: AgentRuntimeFactory + Orchestrator Adapter

> **Phase 1.7+ implemented shape (collapsed May 9 2026 — review fix #4 / debt patch #7).** The wiring is split across two pieces:
>
> 1. **`AgentRuntimeFactory`** ([packages/agent-manager/src/agent/runtime/AgentRuntimeFactory.ts](../../../packages/agent-manager/src/agent/runtime/AgentRuntimeFactory.ts)) — composes per-team default visitors with per-execution extras and conditionally assembles the lifecycle tools. Hooks is the only orchestration mode (the `executionMode` flag was removed May 9 2026 — debt patch #5). **Single entry point** (`wire()`); `wireStreamingOnly()` is a deprecated 1-line alias kept for back-compat:
>    - `wire({ agent, context })` with `context.taskId` set — full task agent: composes streaming hooks, sets `agent.onTaskLifecycle`, returns lifecycle tools to inject into the agent's tool list.
>    - `wire({ agent, context })` without `context.taskId` — stream-only: composes streaming hooks only, returns `{ lifecycleTools: [], agentState: undefined }`. Used by ChatAgent + planner.
> 2. **`AgentRuntimeOrchestrator`** is the small interface the factory delegates to. The default implementation is **`GoalManagerOrchestratorAdapter`** ([packages/agent-manager/src/orchestrator/GoalManagerOrchestratorAdapter.ts](../../../packages/agent-manager/src/orchestrator/GoalManagerOrchestratorAdapter.ts)) which bridges back to existing `GoalManager` + `TaskStore` + `DependencyResolver`. After a successful `createSubtask`, the factory invokes the **required** `notifyTaskCreated` hook so the planner is notified + state is broadcast + `dispatchReadyTasks()` triggers — parity with the legacy `OrchestratorCallbacks.onTaskCreated` flow. (Made required May 9 2026 — review fix #4 / debt patch #10. Tests pass an explicit `async () => {}` no-op.)

```typescript
class AgentRuntimeFactory {
  constructor(deps: {
    defaultStreamingHooks: StreamingHooks[];   // StreamPublisher + ChannelB + Crdt + ErrorChannel + ...
    orchestrator: AgentRuntimeOrchestrator;    // GoalManagerOrchestratorAdapter in production
    taskServices: AgentRuntimeTaskServices;    // taskStore + dagResolver + teamRoles + crdtTaskSync
  });

  /**
   * Single entry point. Behaviour depends on `context.taskId`:
   *   - present → full task agent (lifecycle tools + onTaskLifecycle wired)
   *   - absent  → stream-only (planner / ChatAgent)
   */
  wire(config: AgentRuntimeWireConfig): WiredAgent;

  /** @deprecated 1-line alias for `wire()` without taskId. */
  wireStreamingOnly(config: { agent; context; extraStreamingHooks? }): IStreamingAgent;
}
```

```typescript
// Composite streaming hook — per-visitor isolation is mandatory.
//
// A throwing/rejecting visitor MUST NOT prevent later visitors from
// receiving the same event. AiSdkAgent's outer safeHook only wraps the
// composite call, so the compose helper itself wraps EACH visitor.
private composeStreamingHooks(parts: StreamingHooks[]): StreamingHooks {
  const safeSync = (label, fn) => { try { fn(); } catch (err) { logger.warn(`visitor ${label} threw`, err); } };
  const safeAsync = async (label, fn) => { try { await fn(); } catch (err) { logger.warn(`visitor ${label} rejected`, err); } };
  return {
    // Fire-and-forget: token flow must not block on visitors.
    onStart: (ctx)         => parts.forEach((p, i) => p.onStart        && safeSync(`onStart[${i}]`,        () => p.onStart!(ctx))),
    onChunk: (chunk, ctx)  => parts.forEach((p, i) => p.onChunk        && safeSync(`onChunk[${i}]`,        () => p.onChunk!(chunk, ctx))),
    onStepFinish: (s, ctx) => parts.forEach((p, i) => p.onStepFinish   && safeSync(`onStepFinish[${i}]`,   () => p.onStepFinish!(s, ctx))),
    // AWAITED: persistence + CRDT cleanup completes before runWithHooks() returns.
    // Promise.all over per-visitor safeAsync wrappers — slow/rejecting visitors
    // never serialize or abort siblings.
    onFinish: async (r, ctx) => { await Promise.all(parts.map((p, i) => p.onFinish ? safeAsync(`onFinish[${i}]`, () => p.onFinish!(r, ctx)) : Promise.resolve())); },
    onError:  async (e, ctx) => { await Promise.all(parts.map((p, i) => p.onError  ? safeAsync(`onError[${i}]`,  () => p.onError!(e, ctx))  : Promise.resolve())); },
  };
}
```

```typescript
// Lifecycle hooks — bound per-execution, delegate to the AgentRuntimeOrchestrator.
private buildLifecycleHooks(onCompletePolicy?): TaskLifecycleHooks {
  return {
    onComplete: async (payload, ctx) => {
      if (onCompletePolicy) {
        const policy = await onCompletePolicy(payload, ctx);
        if (policy?.accepted === false) return policy;
      }
      try {
        await this.orchestrator.onWorkerDone({ /* taskId, role, summary, ... */ });
        return { accepted: true };
      } catch (err) {
        return { accepted: false, reason: err.message };
      }
    },
    onStatusChange: async (payload, ctx) => {
      this.orchestrator.updateLastReportedStatus(ctx.taskId!, payload.status);
    },
    onBounce: async (payload, ctx) => {
      const reason = payload.suggestedRole
        ? `${payload.reason} (suggested role: ${payload.suggestedRole})`
        : payload.reason;
      await this.orchestrator.handleTaskFailure(ctx.taskId!, reason);
    },
    onSubtaskRequest: async (payload, ctx) => {
      let ack;
      try { ack = await this.orchestrator.createSubtask(payload, ctx); }
      catch (err) { return { accepted: false, reason: err.message }; }

      // Planner notification + state broadcast + dispatch — fire-and-forget.
      // Failure here MUST NOT roll back the persisted subtask.
      // notifyTaskCreated is REQUIRED on the orchestrator interface
      // (May 9 2026 — debt patch #10); no optional guard at the call site.
      if (ack.accepted && ack.newTaskId) {
        try {
          await this.orchestrator.notifyTaskCreated({
            taskId: ack.newTaskId,
            createdBy: `agent:${ctx.agentId}`,
            targetRole: payload.assignedRole!,
            relationship: payload.relationship ?? "independent",
            parentTaskId: ctx.taskId!,
          }, ctx);
        } catch (err) { logger.warn(`notifyTaskCreated threw`, err); }
      }
      return ack;
    },
  };
}
```

> **Adapter notes (`GoalManagerOrchestratorAdapter`):**
> - `onWorkerDone` sets `task.completionSource = "tool"` BEFORE delegating to `GoalManager.onWorkerDone()` — matches legacy WorkerPool ordering.
> - `createSubtask` delegates to the shared **`buildSubtask` helper** ([packages/agent-manager/src/orchestrator/buildSubtask.ts](../../../packages/agent-manager/src/orchestrator/buildSubtask.ts)) which owns the goal-scoped sequential id, `taskStore.create`, blocks-me cycle check + rollback, `addPrerequisite`, and `dagResolver.rebuildForGoal` (with `rebuild` fallback). The legacy `request_task` tool branch routes through the SAME helper so the two cannot drift (May 9 2026 — debt patch #4). DAG-rebuild failures roll back the just-created task (May 9 2026 — review fix #2).
> - `notifyTaskCreated` is **required** — wire it at adapter construction time. Tests pass an explicit no-op.

---

## Streaming Visitors (Implemented Once, Shared Across All Agents)

### StreamPublisherVisitor

Replaces `SocketEventBroadcaster` (374 lines deleted). Handles Socket.IO broadcast + message accumulation + persistence. Fixes ChatAgent unicast bug.

### ChannelBVisitor

Replaces WorkerPool Channel B synthesis. Step counting + milestones → ChatAgent + Socket.IO `task_update`.

### CrdtStatusVisitor

Replaces WorkerPool CRDT status calls. Busy on first chunk, idle on finish/error.

**Adding new consumers:**
```typescript
// Cost tracking — zero changes to existing code
class CostTrackingVisitor {
  onStepFinish(result, ctx) {
    db.recordUsage({ goalId: ctx.goalId, tokens: result.usage.totalTokens });
  }
}
// Register: add to buildStreamingHooks()
```

---

## Adapters: Any Agent → IAgent

Users bring any agent. Ping wraps it. Users never see hooks, visitors, or Ping internals.

| Adapter | Wraps | Hooks Called From |
|---------|-------|-------------------|
| `AiSdkAgent` | AI SDK `streamText()` | AI SDK hooks (`onChunk`, `onStepFinish`, etc.) |
| `FunctionAgentAdapter` | `(msg) → string \| AsyncGenerator` | Generator yield / return |
| `HttpAgentAdapter` | HTTP endpoint + SSE | SSE events |
| `PingTeamAdapter` | Child Ping team | Child team streaming events |
| `DockerAgentAdapter` | Container stdin/stdout | stdout lines |

All adapters implement `IAgent`. All get same hooks wired by AgentFactory. Hooks are implemented once — adapters just call them from their own event source.

Only `AiSdkAgent` exists today. Other adapters built when needed (plugin-ecosystem, external-agent-invocation features).

---

## Data Flow: Before vs After

### Worker Stream: 10 Hops → 2 Hops

```
BEFORE: Agent → yield → WorkerPool.onStream → Orch.onStream → AgentMgr.streamCallbacks → Broadcaster → Socket.IO
AFTER:  streamText onChunk → StreamPublisherVisitor → Socket.IO
```

### Lifecycle (complete_task): 9 Hops → 3 Hops

```
BEFORE: Tool → callback closure → WorkerPool.onAgentComplete → OrchestratorService → GoalManager.onWorkerDone
AFTER:  Tool → this.onTaskLifecycle.onComplete → GoalManager.onWorkerDone
```

### ChatAgent: Unicast Bug → Broadcast Fixed

```
BEFORE: socket.emit("stream") — only requesting socket sees response
AFTER:  StreamPublisherVisitor → io.to(goalRoom).emit("stream") — all team members see it
```

### Total: 44 Hops → 22 Hops (50% reduction)

12 pure pass-through callbacks eliminated entirely.

---

## SOLID Compliance

| Principle | How |
|-----------|-----|
| **Single Responsibility** | Tools: validate + call hook. Visitors: observe streaming. Task task lifecycle hooks: handle transitions. Factory: create + wire. |
| **Open/Closed** | New streaming consumer = new visitor. New lifecycle concern = new hook handler. Zero existing code changes. |
| **Liskov Substitution** | Any `IAgent` implementation works. Factory wires same hooks regardless of adapter type. |
| **Interface Segregation** | `StreamingHooks` and `TaskLifecycleHooks` are separate. Agents that don't stream skip `onStreaming`. |
| **Dependency Inversion** | Tools depend on `TaskLifecycleHooks` interface, not GoalManager. Visitors depend on `StreamingHooks`, not Socket.IO. Factory injects concrete implementations. |

---

## What Stays Unchanged

| Component | Why |
|-----------|-----|
| `DispatchManager` | Already clean — SRP, DIP via config. |
| `TaskStore` / `RoleTaskQueue` | Task state machine — separate concern. |
| `DependencyResolver` | DAG logic — isolated. |
| `GoalEventBus` + handlers | Domain events for CRDT projection. |
| Orchestration flow | GoalManager → OrchestratorService → dispatch. |

---

## Worker Execution Modes

Workers operate in two modes. Both use the **same `IAgent` interface, same hooks, same lifecycle**:

| Mode | How `run()` Is Called | Who Drives | Use Case |
|------|----------------------|-----------|----------|
| **Auto** | Called once. Agent runs autonomously to completion. | System (DispatchManager) | Default. Planned tasks from approved plan. |
| **Interactive** | Called multiple times. Agent and user take turns. Conversation state preserved between calls. | User (via ChatAgent UI) | Manual mode. User works WITH the agent on a task (like Claude Code). |

```
Auto mode:
  System dispatches task → agent.run(taskDescription)
    → agent works autonomously (10-200 steps)
    → agent calls onComplete/onBounce → exits

Interactive mode:
  User starts task → agent.run(userMessage)
    → agent responds + uses tools
    → user sends follow-up → agent.run(nextMessage)
    → ... (multiple rounds)
    → agent calls onComplete → task done
```

Both modes:
- Same `IAgent` interface
- Same 4 lifecycle hooks (onComplete, onStatusChange, onBounce, onSubtaskRequest)
- Same streaming hooks (onChunk, onStepFinish, etc.)
- Same task tracking (status, DAG, workspace)
- Agent preserves conversation history between `run()` calls

The agent doesn't know which mode it's in. It just runs when `run()` is called, fires hooks when it makes decisions, and maintains its state.

---

## Research Decisions

| Decision | Outcome | Rationale |
|----------|---------|-----------|
| External bus vs hooks+visitor | **Hooks+Visitor** | AI SDK's native hooks eliminate the 120-line mapping loop. Agent is the bus. |
| AgentEvent wrapper type | **Eliminated** | 20 of 23 yields were `stream_part` wrappers. Use AI SDK `TextStreamPart` directly. |
| Lifecycle callbacks vs injected services vs hooks | **Agent-exposed hooks** | Tools call agent's own hooks. System plugs in. Agent doesn't know who's listening. |
| `experimental_context` for service injection | **Rejected** | Tools shouldn't know about services. Hooks are cleaner — tools call `this.onTaskLifecycle.onComplete()`. |
| `TaskLifecycleManager` (command pattern) | **Rejected** | Tool calling `ctx.lifecycle.transition()` is still the agent reaching OUT. Hooks are the agent firing its OWN events. |
| `onClarificationNeeded` hook | **Rejected** | Workers are autonomous. If blocked → `report_status("blocked", question)` → exit → planner handles. In interactive mode, user just sends another message. |
| Additional lifecycle hooks (8 candidates) | **Keep 4** | `onArtifactProduced`, `onDecisionMade`, `onProgress`, `onHandoff`, `onScopeChange`, `onError`, `onMention` all covered by existing mechanisms (producedDocs at completion, report_status, onSubtaskRequest). |
| Adapter pattern (Paperclip comparison) | **Validated** | Same adapter registry approach, but with real-time hooks (not fire-and-forget process spawning). Auth token pattern useful for Phase 5 Docker workers. |
| Protocol choice (MCP vs HTTP vs CLI) | **Transport is implementation detail** | All adapters implement IAgent. MCP/HTTP/stdio is the adapter's concern, not the interface. |

---

## What Gets Deleted

| File | Lines | Replaced By |
|------|-------|-------------|
| `SocketEventBroadcaster.ts` | 374 | `StreamPublisherVisitor` |
| `WorkerCallbacks` interface | 18 | `IAgent.onStreaming + onTaskLifecycle` |
| `ManagerStreamCallbacks` interface | 17 | Gone — visitors handle directly |
| `AgentEvent` type (12 variants) | 23 | Gone — AI SDK `TextStreamPart` used directly |
| 120-line mapping loop in AiSdkAgent | 120 | Gone — hooks handle events |
| `registerStreamCallbacks()` | 10 | Gone — factory wires hooks |
| 12 pass-through callbacks | ~60 | Gone — no forwarding layers |
