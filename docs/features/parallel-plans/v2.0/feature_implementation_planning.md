# Parallel Plans v2.0 — Workspace Isolation (Per-Task Clone)

> **Parent:** [feature_architecture.md](../feature_architecture.md) — Workspace-Per-Plan section  
> **Status:** Implemented — April 27, 2026 (Step 5 worktree deferred)  
> **Branch:** `user/nitrroshan/fixplans`  
> **Phase:** 5 in the [cross-feature roadmap](../feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** v1.0 ✅, [GitHub Connect](../../github-connect/feature_architecture.md) (repo browser + auth token)  
> **Blocks:** v3.0 (full parallel execution — this removes the workspace conflict blocker)  
> **FF Flag:** `FF_WORKSPACE_ISOLATION`

## What v1.0 Already Built (Prerequisites ✅)

| Component | Status | File |
|-----------|--------|------|
| `GoalContext Map` + `GoalManager` | ✅ | `packages/agent-manager/src/orchestrator/GoalManager.ts` (687 lines) |
| `goalId` / `planId` on Task type | ✅ | `packages/agent-manager/src/memory/types/Task.types.ts` |
| `goalId` / `planId` on ToolContext | ✅ | `packages/agent-manager/src/plugin/types.ts` |
| `TaskStore.getByGoal()` / `clearByGoal()` / `isAllCompleteForGoal()` | ✅ | `packages/agent-manager/src/orchestrator/TaskStore.ts` |
| `WorkerPool.disposeByGoal()` | ✅ | `packages/agent-manager/src/services/WorkerPool.ts` |
| Goal-scoped branch naming (`goal-{goalId}/task-{taskId}`) | ✅ | `WorkspaceManager.createWorkspace()` |
| `WorkspaceInitOptions` with `repoUrl`, `repoBranch`, `sparse` | ✅ | `packages/workspace/src/types/index.ts` |
| `AgentWorkspace.initializeFromRepo()` | ✅ | Clone mode exists (unused by dispatch pipeline) |
| `GitBranchManager.clone()` | ✅ | Full clone with sparse checkout |
| `GitBranchManager.push()` | ✅ | Push with `--set-upstream` |
| Serial execution mutex + auto-advance | ✅ | `GoalManager.approvePlan()` |

## Scope

Each task gets its own cloned workspace directory. Tasks within a plan share the same repo source but work in isolated directories (worktree optimization). This eliminates the fundamental blocker for v3.0 parallel execution — workspace conflicts from shared checkout.

**Includes:**
- Per-task workspace basePath: `{workspacesRoot}/plan-{planId}/task-{taskId}/`
- `WorkspaceManager.createWorkspace()` — per-task clone via existing `initializeFromRepo()`
- Worktree optimization — first task clones, subsequent tasks use `git worktree add`
- `repoUrl` + `repoBranch` threaded from plan → task context → ToolContext → workspace
- `pushToRemote()` on task completion (uses existing `GitBranchManager.push()`)
- Plan cleanup (`cleanupPlan()`) when all tasks done
- `SubmitPlanSchema` extended with **required** `repoUrl` and optional `repoBranch`
- Frontend: repo URL input on GoalScreen, repo display in PlanList/Sidebar
- Goal model: `repoUrl` persisted with goal

**Excludes:**
- Removing the execution mutex (that's v3.0)
- Container/sandbox isolation (separate feature: worker-sandboxing)
- External agent workspace handoff (separate feature: external-agent-invocation)

---

## Implementation Steps

### Step 1: SubmitPlanSchema — add `repoUrl` fields (0.5 day)

**Files:**
- `packages/agent-manager/src/orchestrator/tools/submitPlan.ts`

**Current:** `SubmitPlanSchema` has `planId`, `goal`, `tasks[]` — no repo association.

**Change:** Add **required** `repoUrl` and optional `repoBranch` fields to the plan schema:

```typescript
// In SubmitPlanSchema (line 26)
export const SubmitPlanSchema = z.object({
  planId: z.string(),
  goal: z.string(),
  repoUrl: z.string()                      // REQUIRED — every plan targets a repo
    .describe("Git repo URL (HTTPS). The workspace for all tasks in this plan."),
  repoBranch: z.string().default("main")   // Optional — defaults to main
    .describe("Base branch to clone from (default: main)"),
  tasks: z.array(/* ...existing... */),
});
```

**Why required, not optional:**
- Every plan produces code output → it needs a repo to write to
- The planner receives the `repoUrl` from the user's goal submission (frontend sends it)
- If the planner omits it, the plan is invalid — there's no workspace to execute in
- The team's default repo is injected into the planner's system prompt context so it always knows what to use

Also update the `submit_plan` tool description template (`orchestrator/prompts/tools/submit_plan.md`) to document the new fields and instruct the planner to use the repo URL provided in the goal context.

**Entry:** Plans have no repo association.  
**Exit:** Every plan has a `repoUrl`. Planner uses the repo from goal context or team default.

---

### Step 2: Thread repoUrl through task creation (0.5 day)

**Files:**
- `packages/agent-manager/src/orchestrator/GoalManager.ts` — `approvePlan()` (line ~305)
- `packages/agent-manager/src/memory/types/Task.types.ts` — Task interface

**Current:** `approvePlan()` creates tasks with `context: { title, planId, goal, priority, ... }` (line ~357). No `repoUrl` stored.

**Change in `approvePlan()`:**

```typescript
// Line ~357 — inside the task creation loop
this.taskStore.create({
  // ...existing fields...
  context: {
    // ...existing context fields...
    repoUrl: planToApprove.repoUrl,         // NEW — from plan
    repoBranch: planToApprove.repoBranch,    // NEW — from plan
  },
});
```

**Change in Task type:** Add optional workspace fields (or use existing `context: Record<string, any>` — `repoUrl`/`repoBranch` already fit as context keys without type changes).

**Entry:** Task context has no repo info.  
**Exit:** `repoUrl`/`repoBranch` from plan stored in each task's context.

---

### Step 3: ToolContext — add workspace fields (0.5 day)

**Files:**
- `packages/agent-manager/src/plugin/types.ts` — `ToolContext` interface (line ~18)
- `packages/agent-manager/src/services/WorkerPool.ts` — ToolContext assembly (line ~285)

**Current ToolContext:**
```typescript
interface ToolContext {
  consumer: "planner" | "worker";
  role?: string;
  taskId?: string;
  goalId?: string;
  planId?: string;
  // No repoUrl or repoBranch
}
```

**Change ToolContext:**
```typescript
interface ToolContext {
  consumer: "planner" | "worker";
  role?: string;
  taskId?: string;
  goalId?: string;
  planId?: string;
  repoUrl?: string;      // NEW — plan's remote repo URL
  repoBranch?: string;    // NEW — branch to clone from
}
```

**Change WorkerPool** (line ~285): Look up task context to populate new fields:

```typescript
const toolContext: ToolContext = {
  consumer: "worker",
  role: roleKey,
  taskId,
  goalId: this.currentGoalId || undefined,
  planId: this.currentPlanId || undefined,
  repoUrl: taskContext?.repoUrl,        // NEW — from task context
  repoBranch: taskContext?.repoBranch,   // NEW — from task context
};
```

The `taskContext` is available from the `TaskWithContext` parameter in queue mode, or by looking up `this.taskStore.get(taskId).context` in chat mode.

**Entry:** ToolContext has no repo info.  
**Exit:** ToolContext carries `repoUrl`/`repoBranch` from task → plugins see it.

---

### Step 4: WorkspaceManager — per-task basePath + clone mode (3 days)

**Files:**
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts` — `createWorkspace()` (line ~91)

This is the core change. Currently `basePath = this.workspacesRoot` (shared repo root). With isolation, each task gets its own directory and its own `GitBranchManager` instance.

**Current flow (line ~91-130):**
```
createWorkspace(agentId, taskId, initOptions?)
  → workspace = new AgentWorkspace({ basePath: this.workspacesRoot, gitManager: this.gitManager })
  → workspace.initialize()  // creates branch in shared repo
```

**New flow when `repoUrl` is provided + `FF_WORKSPACE_ISOLATION`:**
```
createWorkspace(agentId, taskId, initOptions?)
  → IF initOptions.repoUrl AND FF_WORKSPACE_ISOLATION:
      taskDir = path.join(this.workspacesRoot, `plan-${initOptions.planId}`, `task-${taskId}`)
      mkdir(taskDir, { recursive: true })
      taskGitManager = new GitBranchManager(taskDir, initOptions.repoBranch || 'main')
      workspace = new AgentWorkspace({ basePath: taskDir, gitManager: taskGitManager })
      workspace.initializeFromRepo({ repoUrl, repoBranch, sparse })
    ELSE:
      // Existing behavior (shared repo, branch isolation)
      workspace = new AgentWorkspace({ basePath: this.workspacesRoot, gitManager: this.gitManager })
      workspace.initialize()
```

**Key implementation details:**

```typescript
async createWorkspace(
  agentId: string,
  taskId: string,
  initOptions?: WorkspaceInitOptions & { goalId?: string; planId?: string },
): Promise<AgentWorkspace> {
  if (this.workspaces.has(taskId)) {
    return this.workspaces.get(taskId)!;
  }

  const useIsolation = initOptions?.repoUrl && process.env.FF_WORKSPACE_ISOLATION !== "false";
  const workspaceId = generateWorkspaceId(taskId);

  let workspace: AgentWorkspace;

  if (useIsolation && initOptions.planId) {
    // ── ISOLATED MODE: per-task directory with own git ──
    const taskDir = path.join(
      this.workspacesRoot,
      `plan-${initOptions.planId}`,
      `task-${taskId}`,
    );
    await fs.promises.mkdir(taskDir, { recursive: true });

    const taskGitManager = new GitBranchManager(
      taskDir,
      initOptions.repoBranch || "main",
    );

    const branchName = initOptions.goalId
      ? `goal-${initOptions.goalId}/task-${taskId}`
      : `task-${taskId}`;

    workspace = new AgentWorkspace({
      id: workspaceId,
      agentId,
      taskId,
      branchName,
      basePath: taskDir,
      gitManager: taskGitManager,
    });

    await workspace.initializeFromRepo(initOptions);
  } else {
    // ── SHARED MODE: existing behavior (branch isolation in shared repo) ──
    const branchName = initOptions?.goalId
      ? `goal-${initOptions.goalId}/task-${taskId}`
      : `task-${taskId}`;

    workspace = new AgentWorkspace({
      id: workspaceId,
      agentId,
      taskId,
      branchName,
      basePath: this.workspacesRoot,
      gitManager: this.gitManager,
    });

    if (initOptions?.repoUrl || initOptions?.localPath) {
      await workspace.initializeFromRepo(initOptions);
    } else {
      await workspace.initialize();
    }
  }

  this.workspaces.set(taskId, workspace);
  this.forwardEvents(workspace);
  return workspace;
}
```

**`createWorkspace` signature change:** Add `planId?: string` to `initOptions`. This is already a `Record`-style extension (`WorkspaceInitOptions & { goalId?: string }`) — add `planId` alongside `goalId`.

**Entry:** All tasks share `this.workspacesRoot`, single `GitBranchManager`.  
**Exit:** When `repoUrl` + `planId` + FF enabled → task gets isolated dir under `plan-{planId}/task-{taskId}/` with its own `GitBranchManager`. Otherwise, falls back to existing shared behavior.

---

### Step 5: Worktree optimization (2 days)

**Files:**
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts` — new private state + strategy

When multiple tasks in the same plan use the same `repoUrl`, cloning N times is wasteful. First task does a full clone; subsequent tasks use `git worktree add` from the first clone.

**New state on WorkspaceManager:**

```typescript
/** Tracks which plans have a primary clone (for worktree reuse) */
private planRepos = new Map<string, string>();  // planId → primary clone dir
```

**Strategy in `createWorkspace()` isolated mode:**

```typescript
if (useIsolation && initOptions.planId) {
  const planDir = path.join(this.workspacesRoot, `plan-${initOptions.planId}`);
  const primaryClone = this.planRepos.get(initOptions.planId);

  if (!primaryClone) {
    // First task for this plan → full clone
    const repoDir = path.join(planDir, "repo");
    await fs.promises.mkdir(repoDir, { recursive: true });
    const cloneGit = new GitBranchManager(repoDir, initOptions.repoBranch || "main");
    await cloneGit.clone(initOptions.repoUrl!, repoDir, {
      branch: initOptions.repoBranch,
      sparse: initOptions.sparse,
    });
    this.planRepos.set(initOptions.planId, repoDir);

    // Create worktree for this task from the clone
    const taskDir = path.join(planDir, `task-${taskId}`);
    const branchName = `task-${taskId}`;
    const repoGit = simpleGit(repoDir);
    await repoGit.raw(["worktree", "add", taskDir, "-b", branchName]);
    // ... create workspace with taskDir as basePath
  } else {
    // Subsequent task → worktree from primary clone
    const taskDir = path.join(planDir, `task-${taskId}`);
    const branchName = `task-${taskId}`;
    const repoGit = simpleGit(primaryClone);
    await repoGit.raw(["worktree", "add", taskDir, "-b", branchName]);
    // ... create workspace with taskDir as basePath
  }
}
```

**Requires:** git ≥ 2.15 for worktree support. If worktree fails, the error propagates — no silent fallback to full clone (that would hide bugs and waste disk).

**Entry:** Every isolated task would clone the full repo.  
**Exit:** 1 clone + (N-1) worktrees per plan. `planRepos` map tracks primary clones.

---

### Step 6: WorkspacePlugin — wire isolation into task dispatch (1 day)

**Files:**
- `packages/backend/agentManager/plugins/WorkspacePlugin.ts` — `prepareForTask()` (line ~134)

**Current (line ~134-146):**

```typescript
async prepareForTask(context: ToolContext): Promise<void> {
  if (context.consumer === "planner") return;
  if (!context.role || !context.taskId) return;
  if (!this.l1.isReady) return;

  const existing = this.l1.getWorkspace(context.taskId);
  if (!existing) {
    await this.l1.createWorkspace(context.role, context.taskId, {
      goalId: context.goalId,
    });
  }
}
```

**Change:** Pass `repoUrl`, `repoBranch`, `planId` from ToolContext to `createWorkspace`:

```typescript
async prepareForTask(context: ToolContext): Promise<void> {
  if (context.consumer === "planner") return;
  if (!context.role || !context.taskId) return;
  if (!this.l1.isReady) return;

  const existing = this.l1.getWorkspace(context.taskId);
  if (!existing) {
    await this.l1.createWorkspace(context.role, context.taskId, {
      goalId: context.goalId,
      planId: context.planId,             // NEW
      repoUrl: context.repoUrl,           // NEW — triggers clone mode
      repoBranch: context.repoBranch,      // NEW
    });
  }
}
```

**Also update L1WorkspacePlugin** (`packages/workspace/src/L1/L1WorkspacePlugin.ts`) to forward the full `initOptions` (currently only forwards `goalId`).

**Entry:** Plugin creates workspace in shared directory with branch isolation.  
**Exit:** When `context.repoUrl` exists, creates isolated clone/worktree workspace.

---

### Step 7: Push to remote + plan cleanup (2 days)

**Files:**
- `packages/workspace/src/L1/workspace/AgentWorkspace.ts` — new `pushToRemote()` method
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts` — new `cleanupPlan()` method
- `packages/backend/agentManager/plugins/WorkspacePlugin.ts` — `onTaskComplete()` update

**7a. AgentWorkspace.pushToRemote():**

`GitBranchManager.push()` already exists (line ~752). Add a convenience method on AgentWorkspace:

```typescript
async pushToRemote(remote: string = "origin"): Promise<void> {
  if (this._status !== "active" && this._status !== "published") {
    throw new Error(`Cannot push: workspace is ${this._status}`);
  }
  await this.commit("Task complete: final state");
  await this.gitManager.push(remote, this.branchName);
}
```

**7b. WorkspaceManager.cleanupPlan():**

```typescript
async cleanupPlan(planId: string): Promise<void> {
  const planDir = path.join(this.workspacesRoot, `plan-${planId}`);

  // Remove all workspace entries for this plan
  for (const [taskId, ws] of this.workspaces) {
    if (ws.basePath.startsWith(planDir)) {
      this.workspaces.delete(taskId);
    }
  }

  // Remove worktree tracking
  this.planRepos.delete(planId);

  // Remove plan directory from disk
  await fs.promises.rm(planDir, { recursive: true, force: true });
  logger.info(`Cleaned up plan directory: ${planDir}`);
}
```

**7c. WorkspacePlugin.onTaskComplete() update:**

```typescript
async onTaskComplete(taskId: string, goalId?: string) {
  const workspace = this.l1.getWorkspace(taskId);
  if (!workspace) return { success: true };

  if (workspace.status === "active") {
    await workspace.publish(goalId);
  }

  // If isolated workspace (per-task clone), push to remote
  const isIsolated = !workspace.basePath.endsWith(this.l1.manager.workspacesRoot);
  if (isIsolated) {
    try {
      await workspace.pushToRemote();
    } catch (err) {
      logger.warn(`Push to remote failed for task ${taskId}: ${err}`);
      // Non-fatal — local work is preserved
    }
  }

  return this.l1.manager.mergeAndCleanup(taskId);
}
```

**7d. Plan-level cleanup trigger:**

In `GoalManager.onAllGoalTasksComplete()` (when `isAllCompleteForGoal()` returns true):

```typescript
// After goal completion, trigger plan workspace cleanup
const planId = goal.currentPlanId;
if (planId) {
  const wsPlugin = this.pluginRegistry?.get("workspace") as WorkspacePlugin;
  await wsPlugin?.cleanupPlan(planId);
}
```

**Entry:** Task completion doesn't push to remote. No plan cleanup.  
**Exit:** Isolated workspaces push task branch to remote. Plan completion removes `plan-{planId}/` directory.

---

### Step 8: Frontend — repo URL in goal creation + plan display (1.5 days)

**Files:**
- `packages/frontend/components/GoalScreen/GoalScreen.tsx` — add repo URL input
- `packages/frontend/components/GoalScreen/PlanList.tsx` — show repo in plan cards
- `packages/frontend/components/Sidebar/SidebarPlanList.tsx` — show repo badge
- `packages/frontend/App.tsx` — thread `repoUrl` through goal submission
- `packages/frontend/services/AgentServiceV2.ts` — send `repoUrl` in socket event
- `packages/backend/api/SocketServerV2.ts` — accept `repoUrl` in message handler
- `packages/backend/services/types/Goal.ts` — add `repoUrl` to Goal model
- `packages/agent-manager/src/orchestrator/types.ts` — add `repoUrl` to GoalSummary

**8a. Goal model — add `repoUrl` (backend):**

```typescript
// Goal.ts
interface Goal {
  // ...existing fields...
  repoUrl: string;      // NEW — required, every goal targets a repo
  repoBranch?: string;   // NEW — optional, defaults to "main"
}
```

**8b. GoalSummary — add `repoUrl`:**

```typescript
export interface GoalSummary {
  goalId: string;
  title: string;
  state: OrchestratorState;
  taskCount: number;
  completedCount: number;
  planId?: string;
  repoUrl?: string;     // NEW — display in frontend
}
```

**8c. Socket event — thread `repoUrl` from frontend to backend:**

Frontend sends `repoUrl` with the goal message:
```typescript
// AgentServiceV2.sendToManager()
socket.emit("orchestratorMessage", { content: goal, goalId, repoUrl });
```

Backend handler accepts it:
```typescript
// SocketServerV2.handleOrchestratorMessage()
await manager.orchestratorMessage(content, goalId, { repoUrl });
```

GoalManager stores it on the GoalContext:
```typescript
// GoalManager.getOrCreateGoal()
goal.repoUrl = options?.repoUrl || this.defaultRepoUrl;
```

Planner receives it in system prompt context so `submit_plan` always has the repo URL.

**8d. GoalScreen — add repo URL input (frontend):**

See wireframe below.

**Entry:** Frontend has no repo URL awareness. Goal submission sends only text.  
**Exit:** User specifies repo URL when creating a goal. Repo URL stored in Goal model, displayed in plan lists, threaded to planner.

---

## Frontend Wireframe

Two screens, two layouts:
- **GoalScreen** — full-page form, **no sidebar**. Team + repo selection is part of the form. Recent plans shown below.
- **WorkScreen** — three-column layout with sidebar (tasks + agents), chat area, detail panel.

### GoalScreen — Full Page, No Sidebar

GoalScreen is a standalone landing page. No sidebar — team and repo selection are inline in the form. This keeps the layout consistent: sidebar only exists on WorkScreen.

**First use / no plans:**

```
┌─────────────────────────────────────────────────────────────────┐
│  🏠 Ping                                    👤 user ▾  ⚙️     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                 What do you want to build?                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │  Build a REST API for a notes app with authentication   │    │
│  │  and CRUD endpoints...                                  │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────────┐  ┌────────────────────────────┐               │
│  │ 🏢 Alpha  ▾  │  │ 📦 org/my-project ▾ 🌿main│               │
│  │   (team)     │  │   (repo browser)          │               │
│  └──────────────┘  └────────────────────────────┘               │
│                                                                 │
│                    ┌──────────────┐                              │
│                    │ 🚀 Start     │                              │
│                    └──────────────┘                              │
│                                                                 │
│  ── Or try ─────────────────────────────────────────────────    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ 🌐 Landing   │ │ 🔧 REST API  │ │ 📊 Dashboard │            │
│  │    Page      │ │    Backend   │ │    App       │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Returning user / has plans:**

```
┌─────────────────────────────────────────────────────────────────┐
│  🏠 Ping                                    👤 user ▾  ⚙️     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                 What do you want to build?                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │  Build a REST API for a notes app...                    │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────────┐  ┌────────────────────────────┐               │
│  │ 🏢 Alpha  ▾  │  │ 📦 org/my-project ▾ 🌿main│               │
│  └──────────────┘  └────────────────────────────┘               │
│                                                                 │
│                    ┌──────────────┐                              │
│                    │ 🚀 Start     │                              │
│                    └──────────────┘                              │
│                                                                 │
│  ── Recent Plans ───────────────────────────────────────────    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 📋 Build landing page      🟢 executing  3/5 tasks     │    │
│  │    📦 org/landing  🌿 main                              │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ 📋 Setup CI pipeline       ✅ completed  4/4 tasks     │    │
│  │    📦 org/infra  🌿 main                                │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ 📋 Write API docs          ⏳ queued     0/3 tasks     │    │
│  │    📦 org/api-docs  🌿 main                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**GoalScreen design rules:**
1. **No sidebar** — clean full-page form, centered content
2. **Team selector inline** — pill in the form row, next to repo picker
3. **Repo picker inline** — GitHub repo browser dropdown with branch
4. **Recent plans below** — cards showing plan + repo + status. Click → opens WorkScreen
5. **Example goals** — shown when no plans exist (hidden when plans exist to save space)
6. **Changing team** → recent plans refresh for that team, repo picker may filter by team's org

### WorkScreen — Sidebar with Tasks + Agents

When user starts a goal or clicks a plan, the WorkScreen opens with the three-column layout. Sidebar shows tasks and agents for the active plan.

```
┌───────────────────┬─────────────────────────────┬───────────────┐
│                   │  📋 Build landing page       │  DETAIL       │
│  📋 Landing.. ▾   │  📦 org/landing  🌿 main     │  ───────────  │
│  ──────────────   │  🟢 executing  3/5           │               │
│                   ├─────────────────────────────┤  Overview     │
│  TASKS            │                             │  ┌─────────┐  │
│  ─────────────    │  🤖 Planner                  │  │ Task    │  │
│  ☑ T-001 Header   │  ──────────────────────     │  │ T-002   │  │
│  ⏳ T-002 Nav     │  Created plan with 5 tasks.  │  │         │  │
│  ◻ T-003 Footer   │  Assigning to agents...      │  │ Status: │  │
│  ◻ T-004 API      │                             │  │ running │  │
│  ◻ T-005 Tests    │  🤖 Frontend Dev             │  │         │  │
│                   │  ──────────────────────     │  │ Agent:  │  │
│  ──────────────   │  Working on T-002: Nav...    │  │ FE Dev  │  │
│  AGENTS           │  ┌─ tool: workspace_write  │  │         │  │
│  ─────────────    │  │  src/Nav.tsx            │  │ Files:  │  │
│  🤖 Backend Dev   │  └─────────────────────    │  │ Nav.tsx │  │
│     ◻ idle        │                             │  └─────────┘  │
│  🤖 Frontend Dev  │  🤖 Backend Dev              │               │
│     🟢 T-002      │  ──────────────────────     │  Logs         │
│  🤖 Designer      │  Working on T-004: API...    │  Activity     │
│     ◻ idle        │  Setting up Express routes   │               │
│  🤖 DevOps        │                             │               │
│     ◻ idle        │  ┌─────────────────────┐    │               │
│  🤖 QA            │  │ Message planner...   │    │               │
│     ◻ idle        │  └─────────────────────┘    │               │
│  ──────────────   │                             │               │
│  ← Back to goals  │                             │               │
└───────────────────┴─────────────────────────────┴───────────────┘
```

**Plan switcher dropdown** (top of sidebar):

```
┌───────────────────┐
│ 📋 Landing page ▾ │  ← current plan
├───────────────────┤
│ 📋 Landing page   │  🟢 3/5
│ 📋 CI pipeline    │  ✅ done
│ 📋 API docs       │  ⏳ queued
│───────────────────│
│ + New Plan        │
└───────────────────┘
```

**WorkScreen sidebar rules:**
- **Plan dropdown** at top — switch plans without leaving, or "+ New Plan" to go back to GoalScreen
- **TASKS section** — tasks for the active plan with status, role badge, progress
- **AGENTS section** — team agents with live status (idle / 🟢 working on T-xxx)
- Click task → detail in right panel
- Click agent → filters chat to that agent's messages
- `← Back to goals` at bottom → returns to GoalScreen

### Layout Summary

| Screen | Layout | Sidebar | Main Area |
|---|---|---|---|
| **GoalScreen** | Full page, centered | **None** | Goal form + team picker + repo picker + recent plans |
| **WorkScreen** | Three-column | Tasks + Agents | Chat (multi-agent) + Detail Panel |

### Component Hierarchy (Updated)

```
App.tsx
 ├─ TitleBar                    — logo, user menu, settings (always visible)
 │
 ├─ GoalScreen (when no plan active — NO sidebar)
 │   ├─ GoalTextarea            — goal description input
 │   ├─ FormRow
 │   │   ├─ TeamSelector        — inline team picker pill
 │   │   └─ RepoPicker          — GitHub repo browser + branch pill
 │   ├─ SubmitButton            — "Start"
 │   ├─ ExampleGoals            — suggestions (hidden when plans exist)
 │   └─ RecentPlanList          — clickable plan cards with repo + status
 │
 ├─ WorkScreen (when plan active — WITH sidebar)
 │   ├─ WorkSidebar
 │   │   ├─ PlanSwitcher        — dropdown to switch plans
 │   │   ├─ TaskList            — tasks for active plan
 │   │   ├─ AgentList           — agents with live status
 │   │   └─ BackToGoals         — returns to GoalScreen
 │   ├─ PlanHeader              — plan title + repo + branch + status
 │   ├─ ChatArea
 │   │   ├─ MessageList         — multi-agent messages with identity
 │   │   └─ ChatInput           — talks to planner
 │   └─ DetailPanel             — task detail, logs, activity
 │
 └─ NEW/UPDATED Components:
     ├─ TeamSelector            — inline pill (GoalScreen only)
     ├─ RepoPicker              — GitHub repo browser + branch
     ├─ RecentPlanList          — plan cards on GoalScreen (replaces sidebar plans)
     ├─ WorkSidebar             — tasks + agents (WorkScreen only)
     ├─ PlanSwitcher            — dropdown at top of WorkSidebar
     ├─ AgentList               — agents with live status
     ├─ BackToGoals             — link back to GoalScreen
     └─ RepoBadge               — short-form repo display (org/repo)
```

### Navigation Flow

```
GoalScreen                              WorkScreen
┌──────────────┐                       ┌──────────────────┐
│              │   Start goal          │                  │
│  Goal form   │ ─────────────────→    │  Sidebar + Chat  │
│  + team      │   Click plan card     │  + Detail Panel  │
│  + repo      │ ─────────────────→    │                  │
│  + plans     │                       │  Plan switcher   │
│              │   ← Back to goals     │  at sidebar top  │
│              │ ←─────────────────    │                  │
└──────────────┘                       └──────────────────┘
```
```

---

## Data Flow: Full Pipeline (v2.0)

```
User message → PlannerAgent → submit_plan({ repoUrl, tasks })
  → GoalManager.approvePlan()
    → TaskStore.create({ context: { repoUrl, repoBranch } })
  → DispatchManager.dispatch(taskId, role)
    → WorkerPool.runTask(TaskWithContext)
      → toolContext = { role, taskId, goalId, planId, repoUrl, repoBranch }
      → pluginRegistry.prepareForTask(toolContext)
        → WorkspacePlugin.prepareForTask(context)
          → l1.createWorkspace(role, taskId, { planId, repoUrl, repoBranch })
            → WorkspaceManager.createWorkspace()
              → IF repoUrl + FF_WORKSPACE_ISOLATION:
                  mkdir plan-{planId}/task-{taskId}/
                  worktree add (or clone if first)
                  initializeFromRepo()
              → ELSE: existing shared branch mode
      → agent.executeToolMode() with workspace tools bound to isolated dir
  → Task completes
    → workspace.pushToRemote()   // push task branch to remote
    → workspace.publish()        // output manifest
  → All tasks complete for goal
    → WorkspaceManager.cleanupPlan(planId)   // rm -rf plan dir
```

## Testing

- **Unit:** `WorkspaceManager.createWorkspace()` — verify per-task dir creation, worktree vs clone strategy, fallback to shared mode
- **Unit:** `ToolContext` assembly in WorkerPool — verify `repoUrl`/`repoBranch` populated from task context
- **Integration:** Create plan with `repoUrl` → task clones repo → agent works → commits → pushes → cleanup verifies dir removed
- **Integration:** Two tasks in same plan → verify first clones, second uses worktree (shared `.git`)
- **E2E:** Two plans with different repos → verify fully isolated workspaces, independent push targets
- **Regression:** Plans without `repoUrl` → verify existing shared branch behavior unchanged

## Rollback

`FF_WORKSPACE_ISOLATION=false` — when disabled (or when `repoUrl` is not set on a plan), workspace creation falls back to the pre-v2.0 shared directory model. No migration — new behavior only activates when plans specify a `repoUrl` AND the flag is enabled. Existing plans are unaffected.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Disk usage from per-task clones | Worktree optimization (Step 5) — 1 clone + N worktrees. `--single-branch` + sparse checkout for large repos |
| Clone failure (network, auth) | Fallback to shared mode when clone fails. Log warning, don't block task execution |
| Push failure (permissions, network) | Non-fatal. Local work preserved. Warn in logs, let task complete |
| `git worktree` version requirements | Require git ≥ 2.15. Fail fast if not available — documented in setup prerequisites |
| Plan cleanup race with late-finishing tasks | `cleanupPlan()` checks all task workspaces are merged/discarded before deleting |

## Estimated Total: 11 days
