# Workspace Safety & Parallel Execution — Implementation Planning

> **Architecture:** [feature_architecture.md](./feature_architecture.md)  
> **Branch:** `fix/workspace-safety`

---

## Scope

Three phases that each independently ship value:
- **Phase 1 (immediate):** Bug A (merge-gate) + Bug C (writeIdentityFile) — ~20 lines
- **Phase 2 (architectural):** Per-task clone directories — enables safe concurrent tasks
- **Phase 3 (orchestration):** GoalId scoping in OrchestratorService — enables parallel plans

---

## Phase 1 — Merge-Gate + Identity Fix

**Branch:** `fix/workspace-safety-p1`  
**Risk:** None — both fixes are additive, backward compatible.

### Step 1: Fix Bug A — Fail task on merge failure

**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts`  
**Method:** `onWorkerDone()` (~line 880)

**Change:** When `pluginRegistry.onTaskComplete()` returns `{ success: false }`, mark the task as `failed` instead of `completed`. Dependents won't dispatch.

```typescript
// BEFORE:
let mergeWarning = "";
const result = await this.pluginRegistry.onTaskComplete(data.taskId, ...);
if (!result.success) {
  mergeWarning = "Warning: ...";
}
this.taskStore.completeTask(data.taskId, { summary: data.summary + mergeWarning, ... });

// AFTER:
const result = await this.pluginRegistry.onTaskComplete(data.taskId, ...);
if (!result.success) {
  log.error(`Merge failed for task ${data.taskId}: ${result.error}`);
  this.taskStore.failTask(data.taskId, {
    error: `Workspace merge failed: ${result.error}`,
    completedBy: "system",
    timestamp: data.timestamp,
  });
  this.callbacks?.onTaskFailed?.(data.taskId, result.error || "merge failed");
  return; // ← don't dispatch dependents
}
this.taskStore.completeTask(data.taskId, { summary: data.summary, ... });
```

**Verify:** `taskStore.failTask()` exists. If not, use the existing failure mechanism (check TaskStore API).

**Entry criteria:** Understand current `onWorkerDone` flow.  
**Exit criteria:** A failed merge → task marked `failed` → dependents stay `pending`. Successful merge → unchanged behavior.

---

### Step 2: Fix Bug C — writeIdentityFile

**File:** `packages/backend/agentManager/plugins/WorkspacePlugin.ts`  
**Method:** `writeIdentityFile()` (~line 188)

**Change:** Replace `workspace.writeFile()` with `workspace.createFile()`. Add proper error logging.

```typescript
// BEFORE:
try {
  await workspace.writeFile(".ping/identity.json", JSON.stringify(identity, null, 2));
} catch {
  // Non-fatal
}

// AFTER:
try {
  await workspace.createFile(".ping/identity.json", JSON.stringify(identity, null, 2));
} catch (err) {
  logger.debug(`Identity file write failed for task ${params.taskId}: ${err}`);
}
```

**Edge case:** `createFile()` calls `assertActive()` — workspace must be in `"active"` status. Since `writeIdentityFile` is called after `prepareForTask()` creates the workspace, it should always be active. If not, the `catch` handles it gracefully.

**Edge case:** `.ping/` directory may not exist. `createFile()` calls `mkdir -p` for the parent directory, so this is handled.

**Entry criteria:** None.  
**Exit criteria:** `whoami` tool returns valid JSON identity. Agents know their role, team, and goal.

---

### Step 3: Fix type-unsafe writeIdentityFile caller

**File:** `packages/agent-manager/src/services/WorkerPool.ts` (~line 310)

**Change:** Use typed plugin access instead of `(wsPlugin as any).writeIdentityFile`.

```typescript
// BEFORE:
const wsPlugin = this.pluginRegistry.get("workspace");
if (wsPlugin && typeof (wsPlugin as any).writeIdentityFile === "function") {
  await (wsPlugin as any).writeIdentityFile({ ... });
}

// AFTER:
import type { WorkspacePlugin } from "path/to/WorkspacePlugin.js";
const wsPlugin = this.pluginRegistry.get("workspace") as WorkspacePlugin | undefined;
if (wsPlugin?.writeIdentityFile) {
  await wsPlugin.writeIdentityFile({ ... });
}
```

**Note:** This depends on Plugin Taxonomy Phase 2 (`getTyped<T>`) being available. If not, the `as WorkspacePlugin` cast is acceptable as an interim fix — it's still safer than `as any`.

**Entry criteria:** Step 2 complete (writeIdentityFile actually works now).  
**Exit criteria:** No `as any` casts in writeIdentityFile call site.

---

### Step 4: Verify Phase 1

- [ ] Build: `bun run build:backend` compiles
- [ ] Start backend, create a plan, run tasks
- [ ] Verify `whoami` returns identity JSON (not "Identity not configured")
- [ ] Simulate merge failure (e.g., git conflict) → verify task is marked `failed`, dependents stay `pending`
- [ ] Verify normal task completion flow unchanged

---

## Phase 2 — Per-Task Clone Directories

**Branch:** `fix/workspace-safety-p2`  
**Risk:** Medium — changes workspace directory model.  
**Prerequisite:** Phase 1 merged.

### Step 5: Restructure workspace directory layout

**File:** `packages/workspace/src/L1/workspace/WorkspaceManager.ts`

**Change:** Team repo lives in `{workspacesRoot}/repo/`. Task clones go to `{workspacesRoot}/tasks/task-{id}/`.

```typescript
// In initializeWorkspace() — ensure team repo exists at repo/ subdirectory
async initializeWorkspace(): Promise<void> {
  const repoPath = path.join(this.workspacesRoot, "repo");
  await fs.promises.mkdir(repoPath, { recursive: true });
  this.gitManager = new GitBranchManager(repoPath, this.config.defaultBranch || "main");
  await this.gitManager.withLock(() => this.gitManager.initRepo());
}
```

**Entry criteria:** Understand current `initializeWorkspace()` flow.  
**Exit criteria:** Team repo at `{teamId}/repo/`. Backward compat: if `repo/` doesn't exist, treat `workspacesRoot` as the repo (migration path).

---

### Step 6: Clone team repo per task

**File:** `packages/workspace/src/L1/workspace/WorkspaceManager.ts`

**Change `createWorkspace()`:** Clone `repo/` into `tasks/task-{id}/` instead of sharing `workspacesRoot`.

```typescript
async createWorkspace(agentId, taskId, initOptions?): Promise<AgentWorkspace> {
  if (this.workspaces.has(taskId)) return this.workspaces.get(taskId)!;

  const taskDir = path.join(this.workspacesRoot, "tasks", `task-${taskId}`);
  await fs.promises.mkdir(taskDir, { recursive: true });
  
  const repoPath = path.join(this.workspacesRoot, "repo");
  const taskGitManager = new GitBranchManager(taskDir, "main");

  const workspace = new AgentWorkspace({
    id: generateWorkspaceId(taskId),
    agentId, taskId,
    branchName: `task-${taskId}`,
    basePath: taskDir,                // ← own directory
    gitManager: taskGitManager,       // ← own git instance
  });

  // Clone team repo into task directory
  await workspace.initializeFromRepo({ localPath: repoPath });
  
  this.workspaces.set(taskId, workspace);
  return workspace;
}
```

**Entry criteria:** Step 5 complete.  
**Exit criteria:** Each task has its own directory under `tasks/`. File I/O is completely isolated.

---

### Step 7: Push-and-merge completion flow

**File:** `packages/workspace/src/L1/workspace/AgentWorkspace.ts`  
**File:** `packages/workspace/src/L1/workspace/WorkspaceManager.ts`

**Change `mergeAndCleanup()`:** After publish, push the task branch back to team repo, merge there.

```typescript
async mergeAndCleanup(taskId): Promise<{ success: boolean; error?: string }> {
  const workspace = this.workspaces.get(taskId);
  if (!workspace) return { success: true };

  if (workspace.status === "active") await workspace.publish();

  // Push task branch to team repo
  const repoPath = path.join(this.workspacesRoot, "repo");
  await workspace.gitManager.addRemote("team-repo", repoPath);
  await workspace.gitManager.push("team-repo", workspace.branchName);

  // Merge in team repo
  const teamGit = this.gitManager; // points at repo/
  const result = await teamGit.withLock(() => teamGit.mergeBranch(workspace.branchName));

  if (result.success) {
    this.workspaces.delete(taskId);
    // Cleanup task directory
    await fs.promises.rm(workspace.basePath, { recursive: true, force: true });
    return { success: true };
  }
  return { success: false, error: result.conflicts?.join(", ") };
}
```

**Entry criteria:** Step 6 complete.  
**Exit criteria:** Task branches merge into team repo's main. Task directories cleaned up after merge.

---

### Step 8: Verify Phase 2

- [ ] Build: `bun run build:backend` compiles
- [ ] Start backend, create plan with dependent tasks
- [ ] Verify: each task has its own directory under `tasks/`
- [ ] Verify: 2 concurrent tasks don't interfere with each other
- [ ] Verify: completed task's files visible to dependent tasks (via clone from updated main)
- [ ] Verify: task directories cleaned up after merge
- [ ] Verify: `workspace_read_file` and `workspace_write_file` work correctly in cloned dir

---

## Phase 3 — GoalId Scoping (Parallel Plans)

**Branch:** `feature/parallel-plans-v1`  
**Risk:** Medium-High — changes OrchestratorService state model.  
**Prerequisite:** Phase 2 merged.  
**Detail:** See [parallel-plans/feature_architecture.md](../parallel-plans/feature_architecture.md)

### Step 9: Add goalId to Task type + TaskStore scoping

**File:** `packages/agent-manager/src/orchestrator/TaskStore.ts`  
**File:** `packages/agent-manager/src/memory/types/Task.types.ts`

**Changes:**
- Add `goalId: string` as required field on Task
- Add `getByGoal(goalId)`, `clearByGoal(goalId)`, `isAllCompleteForGoal(goalId)`
- `completeTask()` only scans same-goal tasks for dependency updates

### Step 10: GoalContext abstraction in OrchestratorService

**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts`

**Changes:**
- Replace scalar `state`/`pendingPlan`/`currentGoalId` with `Map<goalId, GoalContext>`
- `approvePlan()` creates tasks for this goal only — no `clear()`/`disposeAll()`
- Per-goal `activeDispatches` + `deferredDispatches`
- Per-goal `MAX_CONCURRENT_DISPATCHES` (2 per goal, 4 global)

### Step 11: Frontend goal switcher

**File:** `packages/frontend/` (multiple components)

**Changes:**
- Goal list in sidebar with status badges
- Per-goal task views
- Socket.IO events include `goalId` for routing

### Step 12: Verify Phase 3

- [ ] Create Plan A, approve, tasks start executing
- [ ] While Plan A executes, submit Plan B, approve
- [ ] Verify: Plan A tasks continue uninterrupted
- [ ] Verify: Plan B tasks execute when slots available
- [ ] Verify: each plan's tasks are isolated in TaskStore
- [ ] Verify: completion of one plan doesn't affect the other

---

## Testing Strategy

| Scenario | Phase | How |
|----------|-------|-----|
| Merge failure → task fails | P1 | Force git conflict |
| `whoami` returns identity | P1 | Check `.ping/identity.json` |
| Tasks have isolated directories | P2 | `ls tasks/` during execution |
| Concurrent tasks don't corrupt | P2 | Run 2 tasks simultaneously |
| Dependent task sees predecessor files | P2 | A→B dependency, B reads A's file |
| Two plans run simultaneously | P3 | Approve Plan B while Plan A executes |

---

## Rollback Plan

**Phase 1:** Revert 3 file changes. No data migration.  
**Phase 2:** Revert clone changes. Existing `data/workspaces/{teamId}/` repos still work (backward compat check in Step 5).  
**Phase 3:** Revert GoalContext changes. Single-plan mode restored.
