# Manager Architecture — SOLID Audit & Refactoring Plan

> **Status:** Design review  
> **Date:** April 25, 2026  
> **Scope:** AgentManagerV2, OrchestratorService, GoalManager, AgentManagerRegistry

## Current Architecture

```
AgentManagerRegistry (lazy cache — loads teams on-demand)
  └── AgentManagerV2 (composition root — 850+ lines, 60+ methods)
      ├── OrchestratorService (reactive runtime — 855 lines)
      │   └── GoalManager (goal lifecycle — 750 lines)
      ├── WorkerPool (worker execution)
      ├── TaskStore (task state)
      ├── PlannerAgent (created by AgentManagerV2, should be GoalManager's)
      ├── ChatAgents Map (created by AgentManagerV2, should be GoalManager's)
      ├── PluginRegistry (wired by AgentManagerV2)
      └── FileTaskStore (persistence)
```

## SOLID Violations

### AgentManagerV2 — 8 Responsibilities (should be 1)

AgentManagerV2 is the **composition root** — it wires everything together. That's its proper job. But it also **owns domain logic** that belongs elsewhere:

| # | Responsibility | Where it is | Where it should be | Why |
|---|---------------|-------------|-------------------|-----|
| 1 | **PlannerAgent creation + lifecycle** | `initializeOrchestrator()` line ~320 | **GoalManager** | Planner is per-goal — GoalManager already owns per-goal state |
| 2 | **ChatAgent creation + lifecycle** | `enableChatAgents()`, `getChatAgent()`, `chatAgentMessage()` | **GoalManager** | ChatAgents are per-goal — GoalManager already fires enable/dispose callbacks |
| 3 | **Stream callback wiring** | `registerStreamCallbacks()`, `streamCallbacks` property | Composition root (**keep here**) | Wiring is the composition root's job |
| 4 | **Auto-approve logic** | `tryAutoApproveTask()`, `autoApproveRoles` | **OrchestratorService** or **ApprovalManager** | Workflow concern, not composition |
| 5 | **Legacy task API** | `createPlan()`, `startTask()`, `executeAllTasks()` | **Delete** | V1 API, deprecated, unused |
| 6 | **File persistence** | `filePersistence` calls | **TaskStore** | Persistence is TaskStore's domain |
| 7 | **Plugin registration** | `registerPlugin()`, `pluginRegistry` | Composition root (**keep here**) | DI is the composition root's job |
| 8 | **Worker context queries** | `getWorkerContext()`, `getChatAgentContext()` | **WorkerPool** / **GoalManager** | Context belongs to the agent owner |

### OrchestratorService — 7 Responsibilities (should be 2)

After Phase 3.5, OrchestratorService owns dispatch + planner comms. But dispatch is doing too much:

| # | Responsibility | Where it should be | Why |
|---|---------------|-------------------|-----|
| 1 | **Task dispatch** | ✅ Keep | Core responsibility |
| 2 | **Planner communication** | ✅ Keep | Core responsibility |
| 3 | **Task context enrichment** (~150 lines in `dispatchTask()`) | **TaskContextBuilder** | Builds upstream outputs, CRDT refs, discussion protocols — pure data assembly |
| 4 | **Concurrency management** | ✅ Keep (or **ConcurrencyManager**) | Dispatch concern, but complex |
| 5 | **Retry logic** | **RetryPolicy** | Error classification + backoff is reusable |
| 6 | **Collaboration worker spawning** | **CollaborationPlugin** | Domain logic, not dispatch |
| 7 | **Notification routing** | ✅ Keep | Planner communication path |

### GoalManager — 6 Responsibilities (should be 3)

GoalManager owns goal lifecycle. But `approvePlan()` and `onWorkerDone()` do too much:

| # | Responsibility | Where it should be | Why |
|---|---------------|-------------------|-----|
| 1 | **Goal state management** | ✅ Keep | Core responsibility |
| 2 | **Plan approval + task creation** | ✅ Keep | Core lifecycle event |
| 3 | **Completion detection + auto-advance** | ✅ Keep | Core lifecycle |
| 4 | **CRDT persistence in approvePlan** | Callback to **CRDTAdapter** | GoalManager shouldn't know about CRDT internals |
| 5 | **Discussion CRDT cleanup in onWorkerDone** | Callback to **CollaborationPlugin** | Same — CRDT is plugin domain |
| 6 | **Merge conflict task creation in onWorkerDone** | ✅ Keep (or callback) | Debatable — it's creating tasks which is goal lifecycle |

### The Key Misplacement: Planner + ChatAgent ownership

**Today:**
```
AgentManagerV2 creates PlannerAgent
AgentManagerV2 creates ChatAgents
GoalManager fires callbacks → AgentManagerV2 creates/disposes them
```

**Should be:**
```
GoalManager creates PlannerAgent (per goal)
GoalManager creates ChatAgents (per goal)
GoalManager owns the full goal context: state + planner + agents
```

**Why:** GoalManager already owns `Map<goalId, GoalContext>`. The GoalContext should include the planner and ChatAgents — they're per-goal resources. The current callback pattern (GoalManager → AgentManagerV2 → create ChatAgent) is an unnecessary indirection because we were avoiding GoalManager depending on PlannerAgent/ChatAgent. But that dependency is natural — a goal's lifecycle includes its agents.

## Proposed Architecture

```
AgentManagerRegistry (lazy cache — unchanged)
  └── AgentManagerV2 (composition root — THINNER)
      ├── OrchestratorService (dispatch + planner comms)
      │   └── GoalManager (goal lifecycle + agents)
      │       ├── Map<goalId, GoalContext>
      │       │   ├── state, pendingPlan, currentPlanId
      │       │   ├── plannerAgent: PlannerAgent        ← MOVED from AgentManagerV2
      │       │   ├── chatAgents: Map<role, ChatAgent>  ← MOVED from AgentManagerV2
      │       │   └── crdtSync: CrdtTaskSync
      │       └── GoalContext factory (creates full goal with planner + agents)
      ├── WorkerPool (worker execution)
      ├── TaskStore (task state)
      ├── PluginRegistry (wired by composition root)
      └── TaskContextBuilder (extracted from dispatchTask)
```

### What Moves Where

| Component | From | To | Impact |
|-----------|------|----|--------|
| `PlannerAgent` creation | AgentManagerV2.initializeOrchestrator() | GoalManager.getOrCreateGoal() | GoalContext gains `planner` field |
| `ChatAgents` Map | AgentManagerV2.chatAgents | GoalManager.GoalContext.chatAgents | GoalContext gains `chatAgents` field |
| `enableChatAgentsForGoal()` | AgentManagerV2 | GoalManager | Direct method, no callback |
| `disposeChatAgentsForGoal()` | AgentManagerV2 | GoalManager | Direct method, no callback |
| `chatAgentMessage()` | AgentManagerV2 | GoalManager (or stays on AgentManagerV2 delegating) | Needs goalId routing |
| `executePlannerTurn` | AgentManagerV2 closure | GoalManager method | Per-goal planner execution |
| Task context enrichment | OrchestratorService.dispatchTask() | TaskContextBuilder (new) | Pure function, testable |
| `onEnableChatAgentsForGoal` callback | GoalManagerCallbacks | **Remove** — GoalManager does it directly | Simpler |
| `onDisposeChatAgentsForGoal` callback | GoalManagerCallbacks | **Remove** — GoalManager does it directly | Simpler |

### Updated GoalContext Type

```typescript
interface GoalContext {
  goalId: string;
  state: OrchestratorState;
  pendingPlan: any | null;
  currentPlanId: string | null;
  title: string;
  createdAt: number;

  // Per-goal agents (moved from AgentManagerV2)
  planner: PlannerAgent | null;
  chatAgents: Map<string, ChatAgent>;
  crdtSync?: CrdtTaskSync;
}
```

### Updated GoalManager

```typescript
class GoalManager {
  // Existing
  private goals = new Map<string, GoalContext>();

  // New: create full goal with agents
  private async createGoalAgents(goal: GoalContext): Promise<void> {
    // Create per-goal planner
    goal.planner = new PlannerAgent({ agentFactory, teamRoles, teamId });
    await goal.planner.initialize();
    // Wire tools with goal-scoped context
    goal.planner.setTools(createOrchestratorTools({ ...context, currentGoalId: goal.goalId }));

    // Create per-goal ChatAgents
    for (const role of this.teamRoles) {
      goal.chatAgents.set(role, new ChatAgent({
        role, teamId: this.teamId, goalId: goal.goalId,
        taskStore: this.taskStore,
        onDispatchTask: this.callbacks.onDispatchTask,
        onNotifyPlanner: this.callbacks.onNotifyPlanner,
      }));
    }
  }

  // New: execute planner turn for a specific goal
  async executePlannerTurn(goalId: string, message: string): Promise<AsyncGenerator<AgentEvent>> {
    const goal = this.goals.get(goalId);
    if (!goal?.planner) return;
    const agent = goal.planner.getAgent();
    return agent.execute({ message, threadId: `team-${this.teamId}:goal-${goalId}` });
  }

  // New: get ChatAgent for a specific goal + role
  getChatAgent(goalId: string, role: string): ChatAgent | null {
    const goal = this.goals.get(goalId);
    return goal?.chatAgents.get(role.toLowerCase()) ?? null;
  }
}
```

## What to Refactor

All items are addressed in **Phase 4.5** — see `docs/features/parallel-plans/v4.5/feature_implementation_planning.md`.

| Item | Phase 4.5 Step |
|------|----------------|
| Move PlannerAgent + ChatAgents into GoalContext | Step 1 |
| Remove `onEnableChatAgentsForGoal`/`onDisposeChatAgentsForGoal` callbacks | Step 1 |
| Extract TaskContextBuilder from dispatchTask() | Step 6 |
| Extract DispatchManager (concurrency + retry) | Step 7 |
| Remove legacy API from AgentManagerV2 | Step 8 |
| Move auto-approve to OrchestratorService | Step 9 |

## Implementation Order

All items are in Phase 4.5 (`v4.5/feature_implementation_planning.md`):

| Phase 4.5 Step | What | Effort | Unblocks |
|----------------|------|--------|----------|
| Step 1 | Move PlannerAgent + ChatAgents into GoalContext | 1.5d | PP-003, stream isolation |
| Step 6 | Extract TaskContextBuilder from dispatchTask() | 0.5d | Testability |
| Step 7 | Extract DispatchManager (concurrency + retry) | 0.5d | Clean OrchestratorService |
| Step 8 | Delete legacy V1 API from AgentManagerV2 | 0.5d | ~450 lines removed |
| Step 9 | Move auto-approve to OrchestratorService | 0.5d | ~90 lines moved |
