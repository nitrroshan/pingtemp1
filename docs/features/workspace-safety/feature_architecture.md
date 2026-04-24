# Workspace Safety & Parallel Execution — Feature Architecture

> **Status**: Proposal  
> **Last Updated**: 2026-04-24  
> **Goal**: Fix workspace bugs, enable parallel task execution within plans, and lay groundwork for parallel plans.  
> **Related**: [parallel-plans](../parallel-plans/feature_architecture.md), [ROADMAP Phase 4](../ROADMAP.md), [MASTER-ARCHITECTURE](../MASTER-ARCHITECTURE.md)

---

## 1. Current State — What We Have

### Workspace model

One git repo per team at `data/workspaces/{teamId}/`. All tasks share the same working directory, isolated by git branches (`task-{taskId}`). One `GitBranchManager` with a single async mutex serializes git operations.

| Component | Scope | Isolation |
|-----------|-------|-----------|
| Git repo | Per team | One directory, one `.git` |
| Working directory | **Shared** — all tasks, all branches | Branch checkout only |
| File I/O | Direct fs operations | **No lock, no branch check** |
| Git operations | Serialized via `GitMutex` | Lock on commit/merge/checkout only |
| `basePath` | Same for all workspaces | `workspacesRoot` = repo root |

### Orchestration model

| Component | Scope | Limitation |
|-----------|-------|-----------|
| `OrchestratorService.state` | Single scalar | One lifecycle phase at a time |
| `pendingPlan` | Single value | Second plan overwrites first |
| `currentGoalId` | Single string | One goal at a time |
| `TaskStore` | Flat `Map<string, Task>` | No goalId/planId partitioning |
| `approvePlan()` | Nuclear reset | `taskStore.clear()` + `workerPool.disposeAll()` |
| `MAX_CONCURRENT_DISPATCHES` | Global = 2 | Shared across all tasks |

### Existing capabilities (already built, unused)

| Capability | Location | Status |
|-----------|----------|--------|
| `initializeFromRepo(repoUrl)` | AgentWorkspace | ✅ Clones remote repo into basePath |
| `GitBranchManager.clone()` | GitBranchManager | ✅ Full clone with sparse checkout support |
| `GitBranchManager.push()` | GitBranchManager | ✅ Push with `--set-upstream` |
| `WorkspaceConfig.remote` | types/index.ts | ✅ Defined but never used |
| `Task.context.planId` | TaskStore | ✅ Stored but never filtered on |
| `PlanStore` (disk) | FilePlanStore | ✅ Already scoped by `goalId` |

---

## 2. Three Bugs (Immediate)

### Bug A: Merge failure doesn't block dependent dispatch (HIGH)

`OrchestratorService.onWorkerDone()` marks task `completed` even when `pluginRegistry.onTaskComplete()` returns `{ success: false }`. Dependents dispatch against a `main` branch missing predecessor files.

### Bug B: Concurrent checkout race (CRITICAL)

`createFile`/`readFile`/`updateFile` operate on the filesystem without checking out the correct branch. With 2 concurrent tasks, file I/O goes to whichever branch happens to be checked out.

### Bug C: writeIdentityFile calls nonexistent method (MEDIUM)

`workspace.writeFile()` doesn't exist → silent `catch {}` → `whoami` always returns "Identity not configured."

---

## 3. Architecture — Unified Approach

Instead of patching bugs in isolation, we ship a workspace model that solves current bugs AND enables the parallel execution roadmap. Three phases that each independently ship value:

### Phase 1: Merge-Gate + Identity Fix (ship now, ~20 lines)

Fix Bug A and Bug C at their source. No architecture change. Unblocks dependent tasks immediately.

| Fix | Change | Files |
|-----|--------|-------|
| Merge-gate | If `onTaskComplete()` fails → `failTask()`, not `completeTask()` | `OrchestratorService.ts` |
| writeIdentityFile | `workspace.writeFile()` → `workspace.createFile()` | `WorkspacePlugin.ts` |
| Type-safe caller | Remove `(wsPlugin as any)` cast | `WorkerPool.ts` |

### Phase 2: Per-Task Directory Isolation (solves Bug B, enables concurrency)

**The fundamental shift:** Each task gets its own filesystem directory. No shared working tree. This is the single change that enables everything downstream.

**Two strategies considered:**

| Strategy | Mechanism | Pros | Cons |
|----------|-----------|------|------|
| Git worktrees | `git worktree add` per task | Deduped storage, native git, fast | Only one repo's files visible per worktree |
| Per-task clones | Clone team repo per task | Full isolation, supports multi-repo | More disk, slower init, more git instances |

**Decision: Per-task clones** — because:

1. **Worktrees can't support multi-repo plans** (Phase 3). A worktree is tied to one repo. If parallel plans target different repos, worktrees don't help.
2. **`initializeFromRepo()` already exists** — AgentWorkspace already has a full clone path that creates metadata in `.ping/` and keeps the source repo clean. We just need to wire it.
3. **MASTER-ARCHITECTURE already specifies clones** — the Storage Model section shows `workspaces/{teamId}-clones/task-{taskId}/` as the target model.
4. **Simpler mental model** — each task = one directory = one git instance. No shared state to reason about.

**Layout:**

```
data/workspaces/{teamId}/
├── repo/                    ← team's "golden" repo (main branch = merged deliverables)
│   ├── .git/
│   └── src/, docs/, ...     ← accumulated output from all completed tasks
│
└── tasks/                   ← one clone per active task
    ├── task-1/              ← clone of repo/ on branch task-1
    │   ├── .git/
    │   ├── .ping/           ← workspace metadata (gitignored)
    │   ├── .scratch/        ← ephemeral scratchpad (gitignored)
    │   └── src/, docs/      ← agent works here
    ├── task-5/              ← independent clone
    │   └── ...
    └── task-11/
        └── ...
```

**How it works:**

```
Task created:
  1. WorkspacePlugin.prepareForTask({ taskId, role })
  2. Clone team repo:  git clone repo/ tasks/task-{id}/ --branch main
  3. Create task branch: git checkout -b task-{id}
  4. Agent gets basePath = tasks/task-{id}/  (isolated directory)
  5. Agent works — createFile/readFile/updateFile on its own directory
  6. No locks needed for file I/O (own .git, own working tree)

Task completes:
  1. workspace.publish() — commits all changes on task branch
  2. Push branch back to team repo:  git push ../repo/ task-{id}:task-{id}
  3. Merge in team repo:  cd repo/ && git merge task-{id} --no-ff
  4. If merge succeeds → taskStore.completeTask() → dependents dispatch
  5. If merge fails → taskStore.failTask() → dependents blocked
  6. Cleanup: rm -rf tasks/task-{id}/

Dependent task starts:
  1. Clone team repo (which now includes predecessor's merged work)
  2. Predecessor's files are on main → visible in new clone ✓
```

**Changes needed:**

| Component | Change |
|-----------|--------|
| `WorkspaceManager.createWorkspace()` | Clone `repo/` into `tasks/task-{id}/` instead of sharing `workspacesRoot` |
| `AgentWorkspace` constructor | Each gets own `basePath` + own `GitBranchManager` instance |
| `AgentWorkspace.merge()` | Push branch to team repo, merge there (not in-place) |
| `WorkspacePlugin.onTaskComplete()` | Cleanup task directory after successful merge |
| `GitBranchManager` | No changes — each clone gets its own instance |
| File I/O methods | No changes — they already use `this.basePath` |

### Phase 3: GoalId Scoping in OrchestratorService (enables parallel plans)

With per-task directory isolation (Phase 2), workspace conflicts are eliminated. Now the orchestration layer can support multiple concurrent goals.

| Component | Change |
|-----------|--------|
| `TaskStore` | Add `getByGoal()`, `clearByGoal()`, `isAllCompleteForGoal()` |
| `Task` type | Promote `goalId` to required top-level field |
| `OrchestratorService` | Replace scalar `state`/`currentGoalId`/`pendingPlan` with `Map<goalId, GoalContext>` |
| `approvePlan()` | Only create tasks for this goal — no `clear()` or `disposeAll()` |
| `MAX_CONCURRENT_DISPATCHES` | Per-goal budget (e.g., 2 per goal, 4 global max) |
| `dispatchTask()` | Scoped by goalId — only considers same-goal dependencies |
| Frontend | Plan switcher, per-goal task lists, goal status badges |

This is the [parallel-plans Option C (Hybrid)](../parallel-plans/feature_architecture.md) — parallel management, serialized execution initially, with the execution lock removable since workspaces are now isolated.

---

## 4. Why Per-Task Clones Over Worktrees

| Concern | Worktrees | Per-task Clones |
|---------|-----------|-----------------|
| Multi-repo plans | ❌ Tied to one repo | ✅ Each task clones any repo |
| Parallel plans | ❌ All worktrees share one repo | ✅ Each task is independent |
| External repos | ❌ Can't worktree a remote | ✅ `git clone` any URL |
| Existing code | Needs new `addWorktree()` methods | `initializeFromRepo()` already exists |
| MASTER-ARCHITECTURE alignment | Not mentioned | ✅ Matches `{teamId}-clones/task-{id}/` model |
| Merge model | In-place (checkout main, merge) | Push branch to team repo, merge there |
| Disk usage | Deduped via git objects | Full copy per task (more disk) |
| Init speed | Fast (shares objects) | Slower (full clone, but local so still fast) |
| Cleanup | `git worktree remove` | `rm -rf tasks/task-{id}/` |

The disk/speed tradeoff is acceptable because:
- Clones are local (same machine) → fast
- Tasks are short-lived → directories cleaned up after merge
- Disk is cheap compared to debugging concurrency races

---

## 5. Migration Path — Summary

```
Phase 1 (now):     Fix merge-gate + identity. Zero architecture change.
                   Result: dependent tasks stop failing on merge errors.

Phase 2 (next):    Per-task clone directories.
                   Result: concurrent tasks work safely.
                   Removes: shared working directory, checkout races.
                   Enables: parallel task execution within a plan.

Phase 3 (after):   GoalId scoping in OrchestratorService.
                   Result: multiple plans run simultaneously.
                   Removes: nuclear approvePlan() reset.
                   Enables: parallel plans (management + execution).
```

Each phase is independently shippable and testable. Phase 1 can ship today. Phase 2 doesn't require Phase 3. Phase 3 requires Phase 2 for safe concurrent execution.

---

## 6. Key Files

| File | Role |
|------|------|
| [AgentWorkspace.ts](../../../packages/workspace/src/L1/workspace/AgentWorkspace.ts) | File I/O, branch management, publish/merge |
| [WorkspaceManager.ts](../../../packages/workspace/src/L1/workspace/WorkspaceManager.ts) | Creates workspaces, mergeAndCleanup |
| [GitBranchManager.ts](../../../packages/workspace/src/L1/workspace/GitBranchManager.ts) | Git operations, locking, branch CRUD |
| [WorkspacePlugin.ts](../../../packages/backend/agentManager/plugins/WorkspacePlugin.ts) | Plugin lifecycle hooks, writeIdentityFile |
| [OrchestratorService.ts](../../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) | onWorkerDone, task completion, dispatch |
| [WorkerPool.ts](../../../packages/agent-manager/src/services/WorkerPool.ts) | runTask, writeIdentityFile caller |
| [TaskStore.ts](../../../packages/agent-manager/src/orchestrator/TaskStore.ts) | Task lifecycle, dependency cascade |
