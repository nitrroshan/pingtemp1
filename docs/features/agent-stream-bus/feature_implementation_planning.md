# Unified Implementation Plan — Parallel Goals + Clean Streaming

**Date:** May 8, 2026
**Status:** Ready to implement

**Implementation Log + Debt Register:** [feature_implementation.md](./feature_implementation.md) — what actually shipped vs the plan, technical debt taken on, cleanup sequencing.

**Source Documents (all reconciled):**
- [agent-stream-bus architecture](./feature_architecture.md) — IAgent, StreamingHooks, TaskLifecycleHooks
- [goal-sessions plan](../goal-sessions/feature_implementation_planning.md) — "architecture is right, fix scalars + add streaming + lifecycle"
- [goal-isolation plan](../goal-isolation/feature_implementation_planning.md) — 31 violations fixed (Phase 1 ✅, Phase 2 ✅)
- [parallel-goals architecture](../parallel-goals/feature_architecture.md) — externalize state, BullMQ, Redis Streams
- [multi-user architecture](../multi-user/feature_architecture.md) — auth + scoping layer
- [goal-isolation research](../process-isolation/goal-isolation-research.md) — Virtual Actor model, industry precedents
- [diagrams](./diagrams.md) — class diagrams, sequence diagrams, gap analysis

---

## What's Already Done (This Session — May 7-8)

| Fix | Status |
|-----|--------|
| B1: `FF_PARALLEL_PLANS` gate removed | ✅ |
| B2: `activeGoalId` fallbacks → task-scoped with deprecation warnings | ✅ |
| B3+B4: `DispatchManager` → per-goal `goalDispatchCounts` + per-goal deferred | ✅ |
| B5: `messageChain` → `Map<goalId, Promise>` | ✅ |
| Lifecycle callbacks awaited (`complete_task`, `bounce_task`) | ✅ |
| `handleTaskFailure` recursive cascade awaited | ✅ |
| Socket action contract aligned (reject-plan, modify-task) | ✅ |
| `ITeamRegistryService` extended (no `as any`) | ✅ |
| Backend compile fixes (ES2023, structured logging, auth) | ✅ scope: agent-manager only — `packages/backend` has unrelated pre-existing failures (PgGoalService row narrowing, missing CollabDocument.transact, missing workspace/knowledge type modules) tracked separately |
| Chat persistence userId (`socket.data.userId`) | ✅ |
| SQLite user filter parity | ✅ |
| CRDT batched writes (`doc.transact()`) | ✅ |
| CollaborativeEditor error boundaries | ✅ |
| `start.sh clean` doesn't kill server | ✅ |

**5 of 7 scalar bugs fixed.** Remaining: B6 (WorkerPool `currentGoalId`) and B7 (WorkerPool `crdtTaskSync`) — resolved when IAgent hooks replace WorkerPool callbacks.

---

## Architecture Principle

**Keep GoalManager + OrchestratorService.** They're correct. Fix them, don't dissolve them:

| Class | Role | What Changes |
|-------|------|-------------|
| **GoalManager** | Session/persistence layer | Owns `Map<goalId, GoalContext>`. Gets `activateGoal()`/`deactivateGoal()` lifecycle. Per-goal TaskStore + DAG in GoalContext. |
| **OrchestratorService** | Goal orchestrator | Handles message → planner → plan → dispatch → worker. Gets `IStreamPublisher` (replaces callback chain). |
| **AgentManagerV2** | Team composition root | Owns WorkerPool + PluginRegistry. Thin facade. Gets idle timer management. |
| **WorkerPool** | Agent factory | Stripped to: `getDefinition()`, `executeAgent()`, `dispose()`. No callbacks, no tool assembly. |
| **DispatchManager** | Concurrency | Already clean ✅. Per-goal budget ✅. |

---

## Phases

### Phase 1: IAgent + Hooks + Visitors (2 weeks)

**Goal:** Replace 22-callback, 4-hop streaming chain. Universal agent interface. ChatAgent unicast fix.

**This is the [agent-stream-bus](./feature_architecture.md) refactor.**

**Approach: Strangler migration, not cliff-edge rewrite.** New visitors run IN PARALLEL with existing callbacks. Old code deleted only after parity tests pass.

| Step | What | Days |
|------|------|------|
| 1.1 | `IAgent` interface + `StreamingHooks` + `TaskLifecycleHooks` + `AgentContext` types. **`goalId` required** (not optional) for all streaming paths. | 0.5 |
| 1.2 | `StreamPublisherVisitor` — port `SocketEventBroadcaster` accumulator logic exactly (all 6 part types: `text-delta`, `tool-call`, `tool-result`, `tool-input-available`, `tool-output-available`, `reasoning-delta`). **Must emit exact same frontend `StreamPart` protocol.** | 1.5 |
| 1.3 | `SocketStatePublisher` — port non-stream state events from `SocketEventBroadcaster` (`onTaskUpdate` → `state`, `onPlanUpdate` → `state` + goal DB, `onGoalStatusChange` → `goal:stateChange` + goal DB, `wireDiscussionEvents`). **Separate from stream publisher.** | 1 |
| 1.4 | `ChannelBVisitor` + `CrdtStatusVisitor` | 0.5 |
| 1.5 | `AiSdkAgent` implements `IStreamingAgent.runWithHooks()` — drives the existing `execute()` generator and translates AgentEvents into hook calls. Native AI SDK hooks (`onChunk`, `onStepFinish`, `experimental_onToolCallStart`) stay inside `executeToolMode()` for logging only and are NOT yet exposed as visitor hooks. Structured-output mode is rejected by `runWithHooks()` (use legacy `run(prompt)` for builders until Phase 1.7). See "Phase 1.5 Bridge State" callout in [feature_architecture.md](./feature_architecture.md). | 1.5 |
| 1.6 | Lifecycle hook adapters — extend the four lifecycle tools (`report_status`, `complete_task`, `bounce_task`, `request_task`) to optionally call `onTaskLifecycle.{onStatusChange, onComplete, onBounce, onSubtaskRequest}`. Originally added `executionMode: "legacy" \| "hooks"` to `assembleLifecycleTools` so each tool call had exactly **one** orchestration owner. **POST-CLEANUP (May 9 2026 — patch #5):** the `executionMode` flag was removed; hooks is the only mode. The `assembleLifecycleTools` throws if `lifecycleHooks` is missing. | 1 |
| 1.7 | `AgentRuntimeFactory` ([packages/agent-manager/src/agent/runtime/AgentRuntimeFactory.ts](../../../packages/agent-manager/src/agent/runtime/AgentRuntimeFactory.ts)) — the one wiring point. **Single entry point** `wire(config)` (collapsed May 9 2026 — review fix #4 / debt patch #7): when `context.taskId` is present, assembles lifecycle tools (hooks-only since patch #5); when absent, returns stream-only wiring (`{ lifecycleTools: [], agentState: undefined }`) for planner/ChatAgent. `wireStreamingOnly()` kept as deprecated 1-line alias. Composes per-team default visitors with per-execution extras; per-visitor try/catch isolation including async-rejection isolation for fire-and-forget hooks (May 9 review fix); `Promise.all` over wrapped per-visitor promises for awaited finish/error. | 2 |
| 1.8a | `GoalManagerOrchestratorAdapter` ([packages/agent-manager/src/orchestrator/GoalManagerOrchestratorAdapter.ts](../../../packages/agent-manager/src/orchestrator/GoalManagerOrchestratorAdapter.ts)) — satisfies `AgentRuntimeOrchestrator` by delegating to existing GoalManager + TaskStore + DependencyResolver. `onWorkerDone` sets `completionSource='tool'` first; `createSubtask` delegates to the shared `buildSubtask` helper (May 9 2026 — debt patch #4: legacy `request_task` tool branch routes through the SAME helper so they cannot drift; rolls back on cycle OR DAG-rebuild failure per review fix #2); `notifyTaskCreated` is **required** on the orchestrator interface (May 9 2026 — debt patch #10) and bridges to `OrchestratorCallbacks.onTaskCreated` (planner notification + state broadcast + dispatchReadyTasks). **WIRED in production** by `OrchestratorService.installAgentRuntimeFactory()`; injected into WorkerPool, planner, and ChatAgent via `factory.wire()`. | 0.5 |
| 1.8b | Originally a feature flag (`PING_AGENT_RUNTIME_HOOKS`) + per-call branch inside `WorkerPool.runTask()` to `AgentRuntimeFactory.wire(...)` + `agent.runWithHooks(...)`. **POST-CLEANUP (May 9 2026 — patch #2 + #6):** the flag, the per-call branch, the `setRuntimeHooksEnabled()` / `isRuntimeHooksActive()` / `getWorkerMode()` API, and the `workerWiring` mode-tracking map are all deleted. Workers always go through `factory.wire()` + `runWithHooks()`; `runTask()` throws if no factory was injected. Cached workers are still invalidated on factory swap via a simpler `runtimeGeneration` counter. | 0.5 |
| 1.8c | Wire `AgentRuntimeFactory` + `GoalManagerOrchestratorAdapter` + the production visitors (StreamPublisher, ChannelB, Crdt, ErrorChannel) inside `OrchestratorService.initialize()` via `installAgentRuntimeFactory()`; that helper calls `workerPool.setRuntimeFactory(factory)`. **POST-CLEANUP (May 9 2026):** there is no env flag to toggle — the factory is required for any worker run. Without it, `WorkerPool.runTask` throws. | 1 |
| 1.9 | Fix ChatAgent: visitors broadcast to goal room + **fix ChatAgent task queries to filter by `goalId`** (isolation, not just unicast) | 0.5 |
| 1.10 | Planner streaming via visitors — ensure `goalId` is in planner `AgentInput`, verify planner messages persist under correct goal | 0.5 |
| 1.11 | **Parity tests pass** (see below) → THEN strip `WorkerPool` + delete `SocketEventBroadcaster` + clean Socket modules | 1 |

**Files deleted:** `SocketEventBroadcaster.ts` (374 lines) — only after parity tests pass
**Net:** ~-1,000 lines. 44 hops → 22 hops. AgentEvent simplified.

**Must-have parity tests before deletion:**
- Worker stream reaches only `team:{teamId}:goal:{goalId}`
- Streamed assistant message persists after `finish` (text + tool cards + reasoning)
- Tool cards render and persist after refresh
- `complete_task` completes task, merges workspace, updates MongoDB/CRDT, unblocks dependents
- `bounce_task` marks failure, cascades blocked dependents, notifies planner
- `request_task` creates task with same `goalId` and valid dependencies
- `report_status("blocked")` → `complete_task` rejected → auto-complete marks failed
- ChatAgent sees only tasks for its own `goalId`
- Two goals streaming concurrently don't share message state or dispatch counts
- Planner stream persisted under correct goal
- Collab worker streams are goal-scoped

**Exit:** All agents stream via visitors. Lifecycle tools call agent hooks (which call same orchestration handlers). ChatAgent broadcasts + goal-filtered.

### Phase 2: Per-Goal State + IStreamPublisher (2 weeks)

**Goal:** GoalManager becomes session layer. Per-goal TaskStore + DAG. IStreamPublisher replaces remaining callback paths.

**This is the [goal-sessions](../goal-sessions/feature_implementation_planning.md) Phase 2 + 3.**

**Approach:** Introduce `GoalTaskStore` behind a compatibility facade. Keep team-level query service for dashboard/API reads.

| Step | What | Days |
|------|------|------|
| 2.1 | `GoalTaskStore` — per-goal task store in GoalContext. **Keep team-level `TaskStore` as a facade** that delegates to per-goal stores for reads. Dashboard/API queries go through facade. | 2 |
| 2.2 | Per-goal `DependencyResolver` in GoalContext. Fix all callers that use global `rebuild()` to use `rebuildForGoal()`. | 1 |
| 2.3 | `IStreamPublisher` interface + `SocketStreamPublisher` — **same event contract as visitors** | 1 |
| 2.4 | Wire IStreamPublisher for plan/goal state events (`onPlanUpdate`, `onGoalStatusChange`, `onPlanProposed`) | 2 |
| 2.5 | `GoalManager.activateGoal()` — load from PG + MongoDB. Verify role listeners + queue callbacks are goal-scoped. | 2 |
| 2.6 | `GoalManager.deactivateGoal()` — flush + dispose. Verify `clearByGoal` doesn't leave queue/listener state inconsistent. | 1 |
| 2.7 | Idle timers (30 min → dispose agents, 2 hours → unload from memory) | 1 |

**Exit:** Each goal owns its state. Sessions survive restarts. Idle sessions unload. Team-level queries still work via facade.

### Phase 3: Multi-User Authorization (1 week)

**Goal:** Users see only their own goals. Team admins see all. Per-user concurrency.

**This is the [goal-sessions](../goal-sessions/feature_implementation_planning.md) Phase 4.**

| Step | What | Days |
|------|------|------|
| 3.1 | Goal ownership check in SocketMessageHandler (before routing) | 1 |
| 3.2 | Goal ownership check in SocketActionHandler (before actions) | 0.5 |
| 3.3 | `GET /api/v2/goals?teamId=X` filtered by user | 1 |
| 3.4 | Per-user concurrency budget | 1 |
| 3.5 | Frontend: goal list filtered by user, cross-team dashboard | 1.5 |

**Exit:** Multiple users share teams. Each user's goals are isolated.

### Phase 4: Redis Streams (2 weeks)

**Goal:** Decouple token delivery from in-process Socket.IO. Swap `IStreamPublisher` implementation.

**This is the [goal-sessions](../goal-sessions/feature_implementation_planning.md) Phase 5.**

| Step | What | Days |
|------|------|------|
| 4.1 | `RedisStreamPublisher` implements `IStreamPublisher` — `XADD` per-agent stream keys | 3 |
| 4.2 | `StreamMux` — single `XREAD BLOCK` subscriber → routes to Socket.IO rooms | 3 |
| 4.3 | Message persistence moves to StreamMux (finish sentinel) | 2 |
| 4.4 | Config: `STREAM_TRANSPORT=socket\|redis` env var | 1 |
| 4.5 | Socket.IO Redis adapter for multi-server broadcast | 1 |

**Exit:** Agents publish to `IStreamPublisher`. Swap via config. Per-agent stream keys. Ready for process isolation.

### Phase 5: Process Isolation (3 weeks)

**Goal:** Each GoalSession in a child process. Crash isolation.

**This is the [parallel-goals](../parallel-goals/feature_architecture.md) + [goal-isolation-research](../process-isolation/goal-isolation-research.md) Phase 5.**

| Step | What | Days |
|------|------|------|
| 5.1 | `ForkRuntime` — `getSession(goalId)` returns IPC proxy for child processes | 5 |
| 5.2 | Goal session worker process entry point | 3 |
| 5.3 | Crash recovery + health checks (heartbeat, auto-restart) | 3 |
| 5.4 | Running tasks reset to `ready` on crash (retry on reload) | 2 |
| 5.5 | Config: `RUNTIME=local\|fork` | 2 |

**Exit:** One goal crashing doesn't affect others. Same `IGoalSession` interface. `RUNTIME=fork`.

### Phase 6: Multi-Server Distribution (3 weeks)

**Goal:** Goals distributed across machines. Gateway routes transparently.

| Step | What | Days |
|------|------|------|
| 6.1 | Session directory in Redis (`goal:{goalId} → serverId`) | 3 |
| 6.2 | `DistributedRuntime` — `getSession()` returns Redis proxy for cross-server | 5 |
| 6.3 | BullMQ for reliable cross-server commands | 3 |
| 6.4 | Config: `RUNTIME=distributed` | 2 |
| 6.5 | Load balancing + session migration | 2 |

**Exit:** Adding servers increases capacity. `RUNTIME=distributed`.

---

## Dependency Graph

```
Phase 1: IAgent + Hooks (clean streaming)
  │
  └── Phase 2: Per-Goal State + IStreamPublisher (GoalManager = session layer)
        │
        ├── Phase 3: Multi-User Auth (users see only their goals)
        │
        └── Phase 4: Redis Streams (decouple delivery)
              │
              └── Phase 5: Process Isolation (crash isolation)
                    │
                    └── Phase 6: Multi-Server (horizontal scaling)
```

### Timeline

| Milestone | Phases | Effort | What It Enables |
|-----------|--------|--------|-----------------|
| **Clean streaming** | 1 | 2 weeks | No callbacks. IAgent interface. ChatAgent fixed. |
| **Parallel goals MVP** | 1 + 2 | 4 weeks | Independent goals. Session lifecycle. Survive restarts. |
| **Multi-user** | 1 + 2 + 3 | 5 weeks | Multiple users. Goal ownership. |
| **Scaling ready** | 1-4 | 7 weeks | Redis Streams. Decouple delivery. |
| **Production** | 1-5 | 10 weeks | Crash isolation. Process-per-goal. |
| **Horizontal** | 1-6 | 13 weeks | Multi-server. Distributed goals. |

---

## Runtime Config (Same Code, Different Scale)

```bash
RUNTIME=local           # Phase 1-3: all in-process (dev)
STREAM_TRANSPORT=socket # Phase 1-3: direct Socket.IO
STREAM_TRANSPORT=redis  # Phase 4+: Redis Streams
RUNTIME=fork            # Phase 5: child_process per session
RUNTIME=distributed     # Phase 6: cross-server via Redis
```

GoalManager + OrchestratorService code never changes. Only the runtime + stream transport changes.

---

## What Gets Deleted (Cumulative)

| Phase | Deleted | Replaced By |
|-------|---------|-------------|
| 1 | `SocketEventBroadcaster.ts` (374 lines) | StreamPublisherVisitor |
| 1 | 12 pass-through callbacks (~60 lines) | Gone — visitors handle directly |
| 1 | 120-line mapping loop in AiSdkAgent | streamText hooks |
| 1 | 8 WorkerPool setter methods | AgentFactory injection |
| 2 | Global TaskStore | Per-goal GoalTaskStore in GoalContext |
| 2 | `streamCallbacks` + `registerStreamCallbacks()` | IStreamPublisher |

---

## What Stays (Confirmed Per Doc)

| Component | From Doc | Why |
|-----------|----------|-----|
| GoalManager | goal-sessions: "architecture is right" | Session layer + lifecycle. Enhanced, not replaced. |
| OrchestratorService | goal-sessions: "handles message → planner → plan → dispatch" | Orchestrator. Gets IStreamPublisher. |
| DispatchManager | Already clean ✅ | Per-goal budget. No changes. |
| TaskStore interface | Stays — GoalTaskStore implements it per-goal | Same API, scoped to one goal. |
| DependencyResolver | Stays — moved into GoalContext | Same API, scoped to one goal. |
| GoalEventBus | goal-sessions: events carry goalId ✅ | CRDT projection. No changes. |
| NotificationQueue | goal-sessions: per-goal buckets ✅ | Planner batching. No changes. |
| PluginRegistry | Team-scoped, shared across goals | No changes. |
| WorkerPool definitions | Team-scoped, shared across goals | No changes. |
