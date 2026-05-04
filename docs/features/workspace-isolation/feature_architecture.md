# Workspace Isolation — Architecture

## Problem

Parallel goals can override each other's workspaces. Two root causes:

1. **WorkerPool.currentPlanId is a scalar.** When Goal B approves, `setTaskServices({ planId })` overwrites Goal A's planId. Goal A's workers then build `ToolContext` with Goal B's planId → wrong workspace directory.

2. **WorkspaceManager keys directories on LLM-generated `planId`.** The LLM picks `planId` freely (e.g. "plan-react-dashboard"). Two similar goals can produce the same planId → same `plan-{planId}/` directory → shared clone, merge conflicts, data corruption.

**Data flow (current):**
```
LLM → planId ("plan-notes-api")
→ GoalContext.currentPlanId
→ WorkerPool.setTaskServices({ planId })   ← SCALAR, last-write-wins
→ WorkerPool.currentPlanId
→ ToolContext { planId }
→ WorkspacePlugin.prepareForTask(ctx)
→ WorkspaceManager.createWorkspace(agentId, taskId, { planId, goalId, ... })
    → planDir = `plan-${planId}/`            ← LLM-generated, not unique
    → planRepos.get(planId)                  ← shared cache key
```

## Design Principle

`planId` is a **display concept** (LLM-generated name). `goalId` is the **infrastructure identity** (server-generated UUID, guaranteed unique). All file system paths, cache keys, and per-goal state must use `goalId`.

---

## Architecture Options

### Option A: Replace planId with goalId at the WorkspaceManager boundary

**Implementation:** WorkspaceManager switches from `planId` to `goalId` for directory naming and `planRepos` key. The rest of the chain (GoalContext, WorkerPool, ToolContext) keeps `planId` for display/plan-store purposes, but WorkspaceManager ignores it for infrastructure.

- `createWorkspace`: `dirKey = goalId || planId` (fallback for legacy)
- `planRepos` map keyed by `goalId`
- Directories: `goal-{goalId}/task-{taskId}/`
- `cleanupPlan(planId, goalId?)`: uses `goalId` when available

**Pros:**
- Smallest change surface — only WorkspaceManager touched
- No API changes to ToolContext or WorkerPool
- Backward compatible — falls back to planId if goalId missing

**Cons:**
- WorkerPool.currentPlanId scalar bug still exists (wrong planId in ToolContext for Goal A workers after Goal B approves)
- `planId` still flows through ToolContext unnecessarily
- Doesn't fix the root cause — just works around it at the leaf

**Effort:** Low (1 file, ~20 lines)

### Option B: Make WorkerPool read planId per-task, not per-pool

**Implementation:** Remove `WorkerPool.currentPlanId` scalar. Instead, read `planId` from each task's record in TaskStore (where `task.planId` is already set during `approvePlan`). WorkspaceManager keys on goalId.

- `WorkerPool`: remove `currentPlanId` field. In `runTask()`, read `taskStore.get(taskId)?.planId` (same pattern as existing `taskGoalId`)
- `GoalManager.approvePlan`: stop passing `planId` to `setTaskServices`
- `WorkspaceManager`: key directories on goalId, `planRepos` keyed by goalId
- ToolContext: `planId` comes from task, `goalId` comes from task — both per-task, not per-pool

**Pros:**
- Fixes both bugs — no scalar overwrite, no LLM-generated directory key
- Consistent with how `goalId` already works (per-task from TaskStore)
- WorkerPool becomes stateless w.r.t. plan identity — each task carries its own context
- No new types or interfaces needed

**Cons:**
- Touches WorkerPool, GoalManager, WorkspaceManager (3 packages)
- Must verify all `currentPlanId` consumers work with per-task lookup

**Effort:** Medium (3 files across 2 packages, ~40 lines)

### Option C: Introduce WorkspaceKey abstraction

**Implementation:** Create a `WorkspaceKey` type (`{ goalId: string; planId?: string }`) that replaces raw `planId` strings everywhere. WorkspaceManager uses `goalId` from the key for directories. PlanStore uses `planId` from the key for display. Single source of truth.

**Pros:**
- Type-safe — impossible to accidentally use planId for infrastructure
- Clear separation of concerns at the type level

**Cons:**
- Over-engineered for the problem — adds a new type flowing through 6+ files
- Larger change surface than needed
- Doesn't solve the WorkerPool scalar issue unless also combined with Option B

**Effort:** High (new type + 6 files)

---

## Recommendation

**Option B.** It fixes both root causes with minimal abstraction. The pattern (per-task lookup from TaskStore) is already proven for `goalId` in WorkerPool. `planId` stays on the task record for display/plan-store but stops driving infrastructure. No new types needed.

---

## Future Improvement: Bare Clone + Worktrees

**Current:** `goal-{goalId}/repo/` is a full non-bare clone. Workers create worktrees as siblings. The primary clone has a working tree on `main` that gets polluted with workspace metadata (`.ping/`, `workspace.json`), and task completions merge back into it. If the `goal-{goalId}/` directory is ever pushed or archived as a whole, the worktree `.git` files and metadata are included.

**Standard practice** (from git docs): use a **bare clone** as the object store, with worktrees as siblings. The bare clone has no working tree, so no pollution or merge-back confusion.

```
# Current (non-bare clone)
goal-{goalId}/
├── repo/              ← full clone with working tree on main
│   ├── .git/          ← full git directory
│   ├── .ping/         ← workspace metadata (polluted)
│   └── workspace.json ← workspace metadata (polluted)
├── task-{id-1}/       ← worktree (.git file → repo/.git)
└── task-{id-2}/       ← worktree

# Improved (bare clone)
goal-{goalId}/
├── .bare/             ← bare clone (objects + refs only, no working tree)
├── task-{id-1}/       ← worktree (.git file → .bare/)
└── task-{id-2}/       ← worktree
```

**Benefits:**
- No working tree pollution — `.bare/` has no files to accidentally modify
- No merge-back into primary clone — worktrees merge directly via `git merge` in the worktree
- Standard git pattern — `git clone --bare` + `git worktree add`
- Cleaner push — only worktree branches get pushed, no primary-clone artifacts

**Changes required:**
- `WorkspaceManager.createWorkspace`: `git clone --bare` into `.bare/` instead of regular clone into `repo/`
- Worktree add: `git -C .bare worktree add ../task-{id} -b branchName`
- `WorktreeMerger`: merge between worktrees directly, not via primary clone
- `seedInitialCommit`: works with bare repos (commit to bare, then worktree)

**Effort:** Medium — single file (`WorkspaceManager.ts`), but must verify worktree operations work correctly with bare repos.
