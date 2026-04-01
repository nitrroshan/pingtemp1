# Task Orchestration — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 1 (Core Loop)  
**ID:** A6  
**Depends on:** A5 (Planner as Agent)

---

## Branch
- `feature/planner-as-agent` (shared with A5 — same codebase changes)

## Scope
Replace MemoryManager's flat prerequisite maps with a proper DAG-based task runtime. TaskStore (single writer), WorkerPool with parallel dispatch, and lazy context injection.

## Relationship to A5

A5 and A6 share a branch and heavily overlap. To avoid duplication, **A5 owns** all shared components. A6 contains only what's unique to the execution runtime.

| Component | Owner | A6 Role |
|---|---|---|
| Types (Task, PlanTask, etc.) | **A5** Step 1 | Consumes types from `plannerTypes.ts` + adds `taskTypes.ts` |
| DependencyResolver | **A5** Step 4 | Uses it — doesn't create it |
| Failure detection + reporting | **A5** Step 8 | Uses `WorkerFailureReport` + `cockatiel` retry — doesn't design it |
| Notification system + Socket.IO events | **A5** Step 7 | Uses `emittery`-based events — doesn't design the queue |
| Worker cancellation + watchdog | **A5** Step 9 | Uses `AbortController` pattern — doesn't design it |
| OrchestratorService refactor | **A5** Step 10 | Contributes TaskStore + WorkerPool changes to same refactor |
| **TaskStore** | **A6** Step 1 | ← Unique to A6 |
| **WorkerPool parallel dispatch** | **A6** Step 2 | ← Unique to A6 |
| **Context flow (lazy injection)** | **A6** Step 3 | ← Unique to A6 |
| **MemoryManager migration** | **A6** Step 4 | ← Unique to A6 |

## Package Dependencies
Uses packages from A5's research. No additional packages needed:
- `cockatiel` — retry/circuit breaker (A5 Step 8 installs it)
- `emittery` — typed events replacing EventEmitter spaghetti (A5 Step 7 installs it)

---

## Implementation Steps

### Step 1: TaskStore (Single Writer)
**Deps:** A5 Step 1 (types)
**Files:**
- Create `packages/backend/orchestrator/TaskStore.ts` — Task CRUD, state machine enforcement, single-writer pattern. Only the Orchestrator writes task state.
- Create `packages/backend/orchestrator/types/taskTypes.ts` — `Task`, `TaskStatus`, `TaskDependency`, `DependencyType` (`blocks` | `informs`), `TaskOutput`

**State machine:** `proposed → ready|pending → in_progress → completed|failed|cancelled|skipped`  
**Enforced:** Invalid transitions throw (e.g., `completed → in_progress`). All writes go through `TaskStore.updateStatus()`.  
**Storage:** In-memory `Map<string, Task>` initially. Backed by CRDT doc or MongoDB later.  
**Exit:** TaskStore rejects invalid transitions. CRUD operations work. State machine correct.

### Step 2: WorkerPool Parallel Dispatch
**Deps:** Step 1, A5 Step 4 (DependencyResolver)
**Files:**
- Modify `packages/backend/services/WorkerPool.ts` — Dispatch ALL ready tasks simultaneously. Add concurrency config. Queue overflow by priority.

```typescript
interface WorkerPoolConfig {
  maxConcurrentWorkers: number;    // default: 5 per team
  maxWorkersPerRole: number;       // default: 2 (prevent one role hogging)
}
```

**Prioritization when workers > ready tasks:** Critical path first → most downstream dependents → FIFO  
**Integration:** On task completion → call `DependencyResolver.resolveReady()` → dispatch newly unblocked tasks  
**Exit:** Multiple tasks dispatch in parallel. Concurrency limits enforced. Overflow queued correctly.

### Step 3: Context Flow (Lazy Injection)
**Deps:** Step 1
**Files:**
- Create `packages/backend/orchestrator/ContextBuilder.ts` — Build worker prompts with 1-line upstream summaries
- Create `packages/backend/orchestrator/tools/contextTools.ts` — `get_task_context(taskId)`, `get_task_artifacts(taskId)` worker tools

**Pattern:** Summary in prompt (~500 tokens), full details via tool calls. Agent decides what to load.

```
Prompt includes: "T-001 (Market Research): Found 12 competitors, 3 direct threats"
Agent needs more: calls get_task_context("T-001") → gets full 5KB output
```

**Same pattern for all knowledge sources:**
| Source | In prompt (summary) | Tool for full content |
|---|---|---|
| Prior task outputs | 1-line per task | `get_task_context(taskId)` |
| Task artifacts | Count + names | `get_task_artifacts(taskId)` |
| L2 shared docs | "3 docs available" | `collab` tool |
| Plan context | Goal + strategy | `get_status()` |

**Exit:** Workers get summaries of upstream tasks. Tool calls return full content. Prompt stays < 1K tokens of context.

### Step 4: Migrate from MemoryManager
**Deps:** Steps 1-3, A5 Step 10 (OrchestratorService refactor)
**Files:**
- Modify `packages/backend/memory/MemoryManager.ts` — Deprecate task management methods (`storeTasks`, `getReadyTasks`, `updateStatus`). Keep memory/context/L2 methods.
- Modify `packages/backend/agentManager/AgentManagerV2.ts` — Route task operations to TaskStore instead of MemoryManager

| Before (MemoryManager) | After (TaskStore) |
|---|---|
| `storeTasks()` | `TaskStore.create()` |
| `getReadyTasks()` | `DependencyResolver.resolveReady()` |
| `prerequisites: Map<string, boolean>` | `dependencies: Array<{ taskId, type }>` |
| `updateStatus()` | `TaskStore.updateStatus()` (single writer) |
| `RoleTaskQueue` per-role serial (`poll()`) | `RoleTaskQueue` with `pollN(role, n)` — parallel dispatch per role |

**Exit:** All task operations route through TaskStore. MemoryManager retains only memory/context functions. Feature flag `TASK_STORE=new|legacy` for rollback.

---

## Testing Strategy
**Unit tests:**
- TaskStore: state machine transitions (valid + invalid), CRUD, concurrent writes rejected
- WorkerPool: parallel dispatch, concurrency limits, priority queue ordering
- ContextBuilder: summary generation, tool returns, missing upstream handled

**Integration tests:**
- DAG with parallel branches → verify execution order matches dependency graph
- Task completion → downstream unblocked → auto-dispatch
- Concurrency limit hit → overflow queued → dispatched as workers free up

(Failure detection, notification, watchdog, and cancellation tests are in A5's test plan — they consume TaskStore but A5 owns the test.)

## Rollback Plan
- `TASK_STORE=new|legacy` env var — MemoryManager task methods preserved behind feature flag
- TaskStore and MemoryManager can coexist during transition

## Complexity
Medium — ~1.5 weeks (runs in parallel with A5):
- Step 1 (TaskStore): ~3 days
- Step 2 (WorkerPool): ~3 days
- Step 3 (Context flow): ~2 days
- Step 4 (Migration): ~2 days
