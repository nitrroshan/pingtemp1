# Parallel Plans Architecture

> **Status:** Approved — Versioned Implementation  
> **Decision:** Option C → Option A via 3 incremental versions  
> **Related:** [persistent-agents](../persistent-agents/feature_architecture.md), [frontend-redesign-goal-first](../frontend-redesign-goal-first.md), [MASTER-ARCHITECTURE](../MASTER-ARCHITECTURE.md)

## Problem Statement

Currently, each team can only execute **one plan at a time**. When a new plan is approved, the system destroys all active workers and clears the TaskStore. Users cannot ask a team to work on a second goal while the first is still executing.

---

## Current Architecture: Single-Plan Model

### How It Works Today

```
User message → OrchestratorService._handleMessage()
  → Planner LLM generates plan (setPendingPlan)
  → User approves → approvePlan()
    → workerPool.disposeAll()      ← kills all workers
    → taskStore.clear()            ← wipes all tasks
    → Creates new tasks from plan
    → Dispatches ready tasks (max 2 concurrent)
  → Tasks complete → state → "idle"
```

### Blocking Mechanisms

| Component | What Blocks | Code Location |
|-----------|------------|---------------|
| `OrchestratorService.pendingPlan` | Single `any` field — can't queue multiple plans | `OrchestratorService.ts:68` |
| `OrchestratorService.state` | Single state machine (`idle → executing → idle`) | `OrchestratorService.ts:64` |
| `OrchestratorService.currentGoalId` | Single `string \| null` — tracks one goal | `OrchestratorService.ts:70` |
| `approvePlan()` | Calls `taskStore.clear()` + `workerPool.disposeAll()` | `OrchestratorService.ts:258-260` |
| `TaskStore.tasks` | Flat `Map<string, Task>` — no plan/goal scoping | `TaskStore.ts:40` |
| `MAX_CONCURRENT_DISPATCHES` | Global limit of 2 across ALL tasks | `OrchestratorService.ts:36` |
| `messageChain` | Serializes all user messages to one Promise chain | `OrchestratorService.ts:112` |

### Existing Code Acknowledgment

The codebase already has a comment acknowledging this limitation:

```typescript
// Clear previous state- This needs to update as in future we want 
// to support multiple plans handled in sequence without restarting the service
await this.workerPool.disposeAll();
this.taskStore.clear();
```

### What Already Supports Multi-Plan

| Component | Status | Notes |
|-----------|--------|-------|
| **PlanStore** (disk) | ✅ Ready | Already scoped by `goalId`: `data/plans/{teamId}/{goalId}/{planId}.json` |
| **WorkerPool.runTask()** | ✅ Ready | Takes `TaskWithContext` — no hard coupling to a single plan |
| **Task.context.planId** | ✅ Exists | Plan ID stored in task context (but not used for filtering) |
| **Worker creation** | ✅ Ready | Per-task workers don't inherently know about plan boundaries |

---

## Architecture Options

### Option A: GoalContext Abstraction (Full Parallel)

**Implementation:** Replace single-valued state fields with a `Map<goalId, GoalContext>`. Each GoalContext contains its own state machine, TaskStore partition, planner thread, and dispatch chain.

```
Team (AgentManager)
 ├─ GoalContext "goal-001-build-landing-page"
 │   ├─ State: executing
 │   ├─ TaskStore partition (tasks filtered by goalId)
 │   ├─ Planner conversation thread
 │   ├─ dispatchChain (serialized within this goal)
 │   └─ MAX_CONCURRENT_DISPATCHES = 2 (per goal)
 │
 ├─ GoalContext "goal-002-setup-ci-pipeline"
 │   ├─ State: awaiting_approval
 │   ├─ TaskStore partition
 │   ├─ Planner conversation thread
 │   ├─ dispatchChain (independent)
 │   └─ MAX_CONCURRENT_DISPATCHES = 2 (per goal)
 │
 └─ Workers (shared pool)
     ├─ Backend Dev → works on tasks from ANY goal
     ├─ Frontend Dev → works on tasks from ANY goal
     └─ DevOps → works on tasks from ANY goal
```

**Required changes:**

| Component | Change | Effort |
|-----------|--------|--------|
| **Task type** | Add `goalId` as top-level field | Small |
| **TaskStore** | Add `getByGoal()`, `clearByGoal()`, `isAllCompleteForGoal()` | Medium |
| **OrchestratorService** | Replace scalar fields with `Map<goalId, GoalContext>` | Large |
| **approvePlan()** | Only clear tasks for the current goal, not all | Medium |
| **dispatchChain** | Per-goal chain instead of global | Medium |
| **MAX_CONCURRENT_DISPATCHES** | Per-goal limit (or global budget split across goals) | Small |
| **SocketServerV2** | Route messages by `goalId` parameter | Small |
| **Frontend** | Plan switcher in sidebar, per-goal task lists | Medium |

**Pros:**
- Full independence between goals — one goal failing doesn't affect others
- Clean separation of concerns
- PlanStore already supports this model
- Workers are naturally shared (no duplication)

**Cons:**
- Largest refactor — OrchestratorService is the heart of the system
- Workspace conflicts: two goals writing to the same Git repo causes file conflicts
- Higher resource usage (more concurrent LLM calls)
- Complex planner context — planner needs awareness of other active goals

**Effort:** 2-3 weeks

---

### Option B: Plan Queue (Sequential Multi-Plan)

**Implementation:** Keep single-plan execution but add a plan queue. Users can create and approve multiple plans; they execute one at a time in order. When Plan A completes, Plan B starts automatically.

```
Team (AgentManager)
 ├─ Active Plan: "Build landing page" (executing, 3/5 tasks done)
 ├─ Queued Plans:
 │   ├─ [1] "Setup CI pipeline" (approved, waiting)
 │   └─ [2] "Write API docs" (approved, waiting)
 └─ state: executing (single state machine)
```

**Required changes:**

| Component | Change | Effort |
|-----------|--------|--------|
| **OrchestratorService** | Replace `pendingPlan` with `planQueue: Plan[]` | Small |
| **approvePlan()** | If executing, enqueue instead of clearing | Small |
| **onAllTasksComplete()** | Dequeue next plan and start execution | Medium |
| **Task type** | Add `planId` as top-level field (for history) | Small |
| **Frontend** | Show queue in sidebar, allow reordering | Medium |

**Pros:**
- Minimal backend refactor — keep single state machine
- No workspace conflicts (only one plan writes at a time)
- Simple mental model for users
- Easy to implement and test

**Cons:**
- No actual parallelism — plans wait in line
- Slower overall throughput
- Can't urgently start a new plan without pausing/cancelling current one

**Effort:** 3-5 days

---

### Option C: Hybrid — Parallel Management, Serialized Execution

**Implementation:** Allow creating, discussing, and approving multiple plans in parallel, but serialize actual task execution. Users can have multiple goals in various stages (planning, awaiting approval) while one executes.

```
Team (AgentManager)
 ├─ GoalContext "goal-001" → State: executing (tasks running)
 ├─ GoalContext "goal-002" → State: awaiting_approval (plan ready)
 ├─ GoalContext "goal-003" → State: gathering (planner thinking)
 └─ Execution Lock: goal-001 holds the lock
     → When goal-001 completes, goal-002 auto-starts
```

**Required changes:**

| Component | Change | Effort |
|-----------|--------|--------|
| **OrchestratorService** | `Map<goalId, GoalContext>` but with execution mutex | Medium |
| **GoalContext** | Own state machine, own planner thread | Medium |
| **Execution lock** | Only one goal in `executing` state at a time | Small |
| **Task type** | Add `goalId` top-level field | Small |
| **TaskStore** | Scoped queries by goalId | Medium |
| **Frontend** | Goal switcher, per-goal chat threads | Medium |

**Pros:**
- Users can prepare multiple plans while one executes (no idle waiting)
- No workspace conflicts (execution is serial)
- Planner parallelism reduces total wait time
- Natural upgrade path to full parallel (Option A) — just remove the execution lock

**Cons:**
- More complex than Option B (GoalContext abstraction)
- Still no parallel execution
- Users might expect parallel execution when they see multiple goals

**Effort:** 1-2 weeks

---

## Recommendation

**All three options, as incremental versions:**

| Version | Option | What | Effort | Cumulative |
|---------|--------|------|--------|------------|
| **v1.0** | C (Hybrid) | GoalContext Map in GoalManager, serial execution mutex, per-goal ChatAgents, frontend goal switcher | 8 days | 8 days |
| **v2.0** | — (Workspace) | Per-task clone, worktree optimization, repoUrl in plans, push-to-remote | 11 days | 19 days |
| **v3.0** | A (Full Parallel) | Remove execution mutex, per-goal dispatch tracking, per-goal planners, cross-goal awareness | 14 days | 33 days |

Each version is independently deployable behind feature flags:
- `FF_PARALLEL_PLANS` — enables v1.0 (GoalContext, serial queue)
- `FF_WORKSPACE_ISOLATION` — enables v2.0 (per-task clone)
- `FF_PARALLEL_EXECUTION` — enables v3.0 (concurrent goals)

See versioned implementation plans:
- [v1.0 Plan](v1.0/feature_implementation_planning.md) — GoalContext + serial execution
- [v2.0 Plan](v2.0/feature_implementation_planning.md) — workspace isolation
- [v3.0 Plan](v3.0/feature_implementation_planning.md) — full parallel execution

**Decision:** Approved. Build v1.0 → v2.0 → v3.0 in sequence.

---

## Cross-Feature Dependency Map

Parallel Plans doesn't exist in isolation. Several features must be coordinated:

```
PHASE 0 — Quick Wins (no dependencies, do anytime)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Plugin Taxonomy refactor ── clean IPlugin, scope field
  Task type prep ── add goalId/planId as top-level fields

PHASE 1 — Chat Agent Layer (2-3 weeks)     ← THE KEY BLOCKER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  No blockers. Unlocks everything else.
  Steps: ChatAgent class → read-only chat → Channel B task updates
       → ChatAgent dispatch → create_agent_task tool
  Feature: chat-agent-layer/

PHASE 2 — Conversation Persistence (1 week)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Depends on: Phase 1 (ChatAgent owns conversations)
  Per-agent conversation storage (JSONL/MongoDB)
  Session restore on reconnect
  Feature: conversation-persistence/

PHASE 3 — Git Task Context (1-2 weeks) ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Depends on: Phase 1 (ChatAgent), workspace-lifecycle ✅
  Workspace repo branch-per-task, goalId/planId on Task type
  Feature: git-task-context/

PHASE 3.5 — GoalManager Extraction (2-3 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Depends on: Phase 3
  Extract goal lifecycle from OrchestratorService into GoalManager (SRP)
  Single-goal refactor — same behavior, cleaner code
  Prerequisite for Phase 4 (GoalManager gains Map)
  Feature: goal-manager/

PHASE 4 — Parallel Plans v1.0 (2 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Depends on: Phase 3.5 (GoalManager), Phase 3 (goalId on tasks)
  GoalContext Map, per-goal planner + ChatAgents, serial execution, goal sidebar
  Feature: parallel-plans/v1.0/

PHASE 5 — Parallel Plans v2.0 (2 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Depends on: Phase 4, Phase 3 (workspace isolation)
  Per-task clone, worktree optimization, repoUrl
  Feature: parallel-plans/v2.0/

PHASE 6 — Parallel Plans v3.0 (2 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Depends on: Phase 5 (workspace isolation eliminates conflicts)
  Remove execution mutex → FULL PARALLEL EXECUTION
  Feature: parallel-plans/v3.0/
```

### Feature × Phase Matrix

| Feature | Phase | Depends On | Effort | FF Flag |
|---------|-------|------------|--------|---------|
| Plugin Taxonomy | 0 | nothing | 1 week | — |
| Chat Agent Layer | 1 | nothing | 2-3 weeks | `ENABLE_CHAT_AGENTS` |
| Conversation Persistence | 2 | Phase 1 | 1 week | `ENABLE_CONV_PERSISTENCE` |
| Git Task Context | 3 | Phase 1, workspace-lifecycle ✅ | 1-2 weeks | `GIT_MODEL=dual` |
| Parallel Plans v1.0 | 4 | Phases 1, 3 | 2 weeks | `FF_PARALLEL_PLANS` |
| Parallel Plans v2.0 | 5 | Phase 4 | 2 weeks | `FF_WORKSPACE_ISOLATION` |
| Parallel Plans v3.0 | 6 | Phase 5 | 2 weeks | `FF_PARALLEL_EXECUTION` |

**Total to full parallel execution: ~10-13 weeks**

### What Runs In Parallel (Development Phases)

```
Week 1-2:  Plugin Taxonomy ────────┐
Week 1-3:  Chat Agent Layer ───────┤ (independent, parallel dev)
                                   │
Week 3-4:  Conversation Persistence ← needs Chat Agents
Week 3-5:  Git Task Context ──────── needs Chat Agents
                                   │
Week 5-7:  Parallel Plans v1.0 ───── needs Git Task Context
Week 7-9:  Parallel Plans v2.0 ───── needs v1.0
Week 9-11: Parallel Plans v3.0 ───── needs v2.0 → FULL PARALLEL
```

### What NOT to Build Until Parallel Plans v3.0 Ships

| Feature | Why Defer |
|---------|-----------|
| External Agent Invocation (A7) | Needs Tools-as-MCP (A3). IWorker interface is ready — implement McpWorker when connecting external agents |
| Tools as MCP (A3) | Large refactor, no user-facing value yet |
| Worker Sandboxing | Security nice-to-have, not blocking parallel plans |
| Team Stacking (B3) | Needs A7 + parallel plans. Build after v3.0 |

---

## The Workspace Conflict Problem

Regardless of which option is chosen, **full parallel execution** is blocked by a fundamental constraint: all agents in a team share one Git workspace. Two goals writing to the same files causes conflicts.

### Resolution paths

| Roadmap Phase | Solution | Description |
|---------------|----------|-------------|
| Phase 4 (Parallel Plans v1.0) | Parallel plan *management* only | Create, review, approve multiple plans. Execute one at a time. |
| Phase 5 (Parallel Plans v2.0) | Per-goal workspace isolation | Each goal gets its own git worktree or repo clone. Enables parallel execution. |
| Phase 6+ (Worker Sandboxing) | Per-agent filesystem isolation | Each sub-agent gets its own container. Complete conflict elimination. |

---

## Data Model Changes (All Options)

### Task type — add goalId

```typescript
// packages/agent-manager/src/memory/types/Task.types.ts
interface Task {
  id: string;
  goalId: string;        // NEW — links task to a specific goal/plan
  planId: string;        // PROMOTE from context to top-level
  status: TaskStatus;
  assigned_role: string;
  prerequisites: Map<string, boolean>;
  dependants: string[];
  context: TaskContext;
  // ...existing fields
}
```

### GoalContext type (Options A & C)

```typescript
interface GoalContext {
  goalId: string;
  state: OrchestratorState;   // idle | gathering | awaiting_approval | executing
  pendingPlan: any | null;
  plannerMessages: Message[];
  dispatchChain: Promise<void>;
  activeDispatches: Set<string>;
  deferredDispatches: Array<{ taskId: string; role: string }>;
  currentPlanId: string | null;
}
```

### TaskStore changes

```typescript
// New methods needed
getByGoal(goalId: string): Task[]
clearByGoal(goalId: string): void
isAllCompleteForGoal(goalId: string): boolean
getReadyTasksForGoal(goalId: string): Task[]
```

---

## Frontend Impact

### Sidebar changes

```
GOALS
──────────────────────────────────
📋 Build Landing Page    🟢 3/5 tasks  [executing]
📋 Setup CI Pipeline     ⏳ 0/4 tasks  [awaiting approval]
📋 Write API Docs        📝 planning...
──────────────────────────────────
```

### New interactions
- Click a goal → shows its tasks, plan, and chat thread
- Goal status badges (planning / awaiting approval / executing / done)
- Per-goal chat (planner conversations are scoped)

### Socket.IO changes
- `sendMessage` payload needs `goalId` field
- `stream` events need `goalId` for routing to correct goal panel
- New event: `goal:stateChange` for sidebar updates

---

## Workspace-Per-Plan: Each Plan Has Its Own Remote Repo

### The Problem

All agents in a team share one git repository. Today, tasks create branches in that shared repo. If two plans modify the same files, merges will conflict.

### Current Workspace Architecture

**Default mode** — tasks create branches in a shared repo (no clone):

```
{repoPath}/                              # Single repo, ALL plans share this
├── .git/
├── main branch                          # All approved work merges here
└── task-{taskId} branches               # Branch-per-task in shared repo
    ├── .ping/outputs/{taskId}.json
    └── .scratch/
```

**Clone mode** — already exists but unused by orchestration:

`AgentWorkspace.initializeFromRepo({ repoUrl, repoBranch, sparse })` clones a remote repo into the workspace basePath. Called only when `WorkspaceInitOptions.repoUrl` is provided. Currently never called by the plan/task dispatch pipeline.

**Key code:** [AgentWorkspace.ts](../../packages/workspace/src/L1/workspace/AgentWorkspace.ts) `initializeFromRepo()` → calls `GitBranchManager.clone()` → `simpleGit().clone(repoUrl, targetDir)`.

### Proposed Model: Plan → Remote Repo → Task Clones

Each plan is associated with a **remote repository URL**. When a task starts, it **clones that repo** into an isolated directory. Tasks within the same plan all clone the same repo but work in separate directories.

```
Plan "Build Landing Page"
  └─ repoUrl: "https://github.com/org/landing-page.git"
     ├─ Task T-001 (frontend) → clones into data/workspaces/{planId}/task-T-001/
     ├─ Task T-002 (backend)  → clones into data/workspaces/{planId}/task-T-002/
     └─ Task T-003 (tests)    → clones into data/workspaces/{planId}/task-T-003/

Plan "Setup CI Pipeline"
  └─ repoUrl: "https://github.com/org/infra.git"
     ├─ Task T-004 (devops)   → clones into data/workspaces/{planId}/task-T-004/
     └─ Task T-005 (devops)   → clones into data/workspaces/{planId}/task-T-005/
```

### How It Works

```
1. User creates plan → specifies repoUrl (or plan inherits team default repo)
2. Plan approved → tasks created with planId + repoUrl in context
3. Task dispatched → WorkspacePlugin calls:
     workspace.initializeFromRepo({ repoUrl: plan.repoUrl })
   This clones the repo into a task-specific directory
4. Agent works on cloned repo → commits to task branch
5. Task completes → push branch to remote → create PR (or merge)
6. All tasks done → cleanup cloned directories
```

### Filesystem Layout

```
data/workspaces/
├── plan-{planId-1}/                     # Plan A
│   ├── task-T-001/                      # Full clone for task 1
│   │   ├── .git/
│   │   ├── .ping/workspace.json
│   │   ├── src/, docs/                  # Cloned repo content
│   │   └── .scratch/
│   ├── task-T-002/                      # Full clone for task 2
│   │   ├── .git/
│   │   └── ...
│   └── task-T-003/
│
├── plan-{planId-2}/                     # Plan B (different repo!)
│   ├── task-T-004/
│   │   ├── .git/                        # Cloned from different remote
│   │   └── ...
│   └── task-T-005/
```

### What Already Exists

| Component | Status | What It Does |
|-----------|--------|-------------|
| `AgentWorkspace.initializeFromRepo()` | ✅ Exists | Clones `repoUrl` into basePath, creates task branch, sets up `.ping/` metadata |
| `GitBranchManager.clone()` | ✅ Exists | Calls `simpleGit().clone(repoUrl, targetDir)`, supports sparse checkout |
| `WorkspaceManager.createWorkspace()` | ⚠️ Needs change | Currently passes shared `this.workspacesRoot` as basePath. Needs per-task basePath |
| `WorkspaceInitOptions` | ✅ Exists | Already has `repoUrl`, `repoBranch`, `sparse` fields |
| `OutputManifest.goalId` | ✅ Exists | Already captures goalId on publish |

### What Needs to Change

#### 1. Plan type — add `repoUrl`

```typescript
// In PlannedTask / PlanConfig
interface PlanConfig {
  planId: string;
  goal: string;
  repoUrl: string;              // NEW — remote repo for this plan
  repoBranch?: string;          // optional — default branch to clone
  tasks: PlannedTask[];
}
```

#### 2. WorkspaceManager — per-task basePath

Currently `createWorkspace()` uses `this.workspacesRoot` (shared) as basePath. Change to create a unique directory per task under the plan:

```typescript
async createWorkspace(
  agentId: string,
  taskId: string,
  initOptions?: WorkspaceInitOptions & { planId?: string },
): Promise<AgentWorkspace> {
  // Per-task isolated directory under the plan
  const taskDir = initOptions?.planId
    ? path.join(this.workspacesRoot, `plan-${initOptions.planId}`, `task-${taskId}`)
    : path.join(this.workspacesRoot, `task-${taskId}`);

  await fs.promises.mkdir(taskDir, { recursive: true });

  const workspace = new AgentWorkspace({
    id: generateWorkspaceId(taskId),
    agentId,
    taskId,
    branchName: `task-${taskId}`,
    basePath: taskDir,              // ← Each task gets its own directory
    gitManager: new GitBranchManager(taskDir, 'main'),  // ← Own git instance
  });

  if (initOptions?.repoUrl) {
    await workspace.initializeFromRepo(initOptions);  // ← Clone the plan's repo
  } else {
    await workspace.initialize();
  }

  this.workspaces.set(taskId, workspace);
  return workspace;
}
```

#### 3. WorkspacePlugin — pass repoUrl from plan context

```typescript
async prepareForTask(context: ToolContext): Promise<void> {
  if (!context.role || !context.taskId) return;

  const existing = this.l1.getWorkspace(context.taskId);
  if (existing) return;

  await this.l1.createWorkspace(context.role, context.taskId, {
    planId: context.planId,
    repoUrl: context.repoUrl,         // ← From plan config
    repoBranch: context.repoBranch,
  });
}
```

#### 4. ToolContext — add plan fields

```typescript
interface ToolContext {
  role: string;
  taskId: string;
  planId?: string;
  goalId?: string;
  repoUrl?: string;           // NEW — plan's remote repo
  repoBranch?: string;        // NEW — branch to clone
}
```

#### 5. OrchestratorService — thread repoUrl through dispatch

When `approvePlan()` creates tasks, store `repoUrl` in task context:

```typescript
// In approvePlan()
for (const task of planToApprove.tasks) {
  this.taskStore.create({
    id: task.id,
    context: {
      planId,
      goalId,
      repoUrl: planToApprove.repoUrl,    // ← Thread through
      repoBranch: planToApprove.repoBranch,
    },
    // ...
  });
}
```

### Task Completion: Push to Remote

When a task finishes, its changes should be pushed back to the remote:

```typescript
// AgentWorkspace — new method
async pushToRemote(remoteName = 'origin'): Promise<void> {
  await this.gitManager.push(remoteName, this.branchName);
}

// WorkspacePlugin.onTaskComplete()
async onTaskComplete(taskId: string, goalId?: string) {
  const workspace = this.l1.getWorkspace(taskId);
  if (workspace.status === 'active') {
    await workspace.commit('Task complete: final state');
    await workspace.pushToRemote();            // Push task branch to remote
    await workspace.publish(goalId);
  }
}
```

### Plan Completion: Merge or PR

When all tasks in a plan complete, the system can:

1. **Create PRs** — each task branch becomes a PR against the plan's repo default branch
2. **Auto-merge** — sequentially merge task branches into `main` on the remote
3. **Cleanup** — delete `data/workspaces/plan-{planId}/` directory

```typescript
// WorkspaceManager — plan cleanup
async cleanupPlan(planId: string): Promise<void> {
  const planDir = path.join(this.workspacesRoot, `plan-${planId}`);
  // Remove all task clones for this plan
  await fs.promises.rm(planDir, { recursive: true, force: true });
  // Remove workspace entries from map
  for (const [taskId, ws] of this.workspaces) {
    if (ws.basePath.includes(`plan-${planId}`)) {
      this.workspaces.delete(taskId);
    }
  }
}
```

### Why Per-Task Clone (Not Shared Clone + Branches)

| Approach | Parallel Safe? | Why |
|----------|---------------|-----|
| Shared repo + branches | ❌ | `git checkout` switches the working tree — two tasks can't be on different branches simultaneously |
| Shared clone + branches | ❌ | Same problem — one `.git` = one checked-out working tree |
| **Per-task clone** | ✅ | Each task has its own `.git` and working tree — fully independent |
| Git worktrees | ✅ | Shared `.git` with multiple working trees — lightweight alternative |

**Per-task clone is the simplest model** because:
- Each task is completely independent — no locks, no mutex, no branch switching
- `initializeFromRepo()` already does this — just unused by the dispatch pipeline
- Tasks can run truly in parallel with zero coordination
- Cleanup is trivial: `rm -rf` the task directory

**Trade-off:** Disk usage — each clone copies the full repo. Mitigated by:
- `--single-branch` (already used in `GitBranchManager.clone()`)
- `--depth 1` shallow clones for large repos
- Sparse checkout for monorepos (already supported via `sparse` option)
- Cleanup after plan completion

### Workspace Isolation Options Comparison

| Option | Plan Isolation | Task Isolation | Disk Cost | Effort | Remote Repo Support |
|--------|---------------|----------------|-----------|--------|-------------------|
| **W1: Git Worktrees** | ✅ per-goal dir | ✅ per-task worktree | Low (shared .git) | 3-5 days | Single repo only |
| **W2: Per-task clone** | ✅ per-plan dir | ✅ per-task clone | Medium-High | 3-5 days | ✅ Different repo per plan |
| **W3: Namespace branches** | ❌ | ❌ | Lowest | 1 day | ❌ |

### Recommendation

**W2 (Per-task clone)** when plans need different remote repos — which is the primary use case (Plan A works on `landing-page` repo, Plan B works on `infra` repo).

**W1 (Git worktrees)** when multiple plans share the same repo — worktrees are lighter weight.

Both can coexist: use W2 when `plan.repoUrl` differs from team default, W1 when plans share the same repo.

### Changes Required for Full Stack

| Layer | Change | Effort |
|-------|--------|--------|
| **PlanConfig type** | Add `repoUrl`, `repoBranch` fields | Trivial |
| **ToolContext type** | Add `repoUrl`, `repoBranch`, `planId` fields | Trivial |
| **WorkspaceManager** | Per-task basePath under `plan-{planId}/task-{taskId}/` | Small |
| **WorkspacePlugin** | Pass `repoUrl` from task context to `createWorkspace()` | Small |
| **OrchestratorService** | Thread `repoUrl` from plan into task context | Small |
| **AgentWorkspace** | Add `pushToRemote()` method | Small |
| **GitBranchManager** | `clone()` already exists ✅, add `push()` if missing | Small |
| **WorkspaceManager** | Add `cleanupPlan(planId)` for post-completion cleanup | Small |
| **Frontend** | Plan creation UI with repo URL input | Medium |

---

## Deployment Topology: Local vs Remote Agents

### The Two Worlds

Not all agents run in the same place. The workspace strategy must account for this:

```
┌─────────────────────────────────────────────────────┐
│  SAME CONTAINER (Ping Backend Process)              │
│                                                     │
│  Planner Agent (Layer 1) ─ persistent, in-process   │
│  Chat Agents (Layer 2)   ─ persistent, in-process   │
│  Task Sub-Agents (Layer 3) ─ transient, in-process  │
│                                                     │
│  Workspace tools → direct function calls (0.1ms)    │
│  Filesystem → local disk (same machine)             │
└───────────┬─────────────────────────────────────────┘
            │
            │ MCP (Streamable HTTP)
            │
┌───────────▼─────────────────────────────────────────┐
│  REMOTE (Different machine/container/cloud)         │
│                                                     │
│  Claude Code ─ has its OWN workspace tools          │
│  Cursor / Windsurf ─ has its OWN workspace tools    │
│  Child Ping Team ─ another Ping instance            │
│  E2B / Microsandbox ─ sandboxed container           │
│                                                     │
│  Workspace → needs its OWN clone or mounted volume  │
│  Tools → served via Ping MCP server                 │
└─────────────────────────────────────────────────────┘
```

### Why NOT One Container Per Agent

It's tempting to isolate each agent (Planner, Chat Agents, Sub-Agents) into its own container. **Don't.** The cost-benefit doesn't justify it:

**What an agent actually is in-process:**
- ~50 lines of state (system prompt + conversation history + tool references)
- One `streamText()` call to a remote LLM API — the heavy compute happens at OpenAI/Anthropic, not locally
- Tool execution = direct function calls to `AgentWorkspace` methods (~0.1ms each)

**What containerizing each agent would cost:**

| Overhead | In-Process | Per-Agent Container |
|----------|-----------|-------------------|
| Memory per agent | ~5-10MB (JS objects) | ~50-100MB (Node.js runtime) |
| Tool call latency | 0.1ms (function call) | 5-50ms (network RPC) |
| Startup time | <1ms (new object) | 200ms-5s (microVM/Docker) |
| Agents per team (5 roles) | 1 Planner + 5 Chat + N Sub = 7-15 objects | 7-15 containers |
| Shared state access | Direct (same memory) | Inter-container RPC (TaskStore, PlanStore) |
| Scaling to 10 teams | 70-150 lightweight objects | 70-150 containers |

**The agent is just an API client.** The expensive work (inference) runs on Azure/Anthropic. Locally, agents are thin orchestrators that:
1. Send messages to an LLM API
2. Receive tool calls back
3. Execute tools (mostly filesystem ops)
4. Loop until done

There's nothing in steps 1-2-4 that benefits from container isolation. Only step 3 (tool execution) touches the filesystem and could benefit from sandboxing.

### What Actually Needs Isolation: The Tools, Not the Brain

The correct split is **sandbox the hands, not the brain:**

```
┌──────────────────────────────────────────────────┐
│  PING PROCESS (Orchestration — no isolation)     │
│                                                  │
│  Planner ──streamText()──→ Azure OpenAI          │
│  Chat Agent ──streamText()──→ Azure OpenAI       │
│  Sub-Agent ──streamText()──→ Azure OpenAI        │
│       │                                          │
│       │ tool call: workspace_write_file(...)      │
│       ▼                                          │
│  ┌──────────────────────────────────────┐        │
│  │  SandboxProvider (Phase 6)           │        │
│  │  Executes file ops in container      │        │
│  │  microsandbox.exec('write', args)    │        │
│  └──────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
```

This is exactly what **Worker Sandboxing (Phase 6)** plans — the `SandboxProvider` abstraction wraps workspace tools so file I/O, git, and shell commands execute inside a Microsandbox/Docker container, while the agent's LLM loop stays in-process.

**When per-agent containers DO make sense:**
- **External agents** (Claude Code, child Ping) — they're already on different machines
- **Untrusted plugins** — third-party agent code you don't control
- **Multi-tenant SaaS** — different customers need hard isolation
- **Horizontal scaling** — spreading across machines when one can't handle all teams

For a single-team or self-hosted deployment, in-process is the right default.

### How Each Agent Type Accesses the Workspace

| Agent Type | Where It Runs | Workspace Access | Git Strategy |
|------------|--------------|------------------|--------------|
| **Internal Sub-Agent** (AiSdkAgent) | Same process | `AgentWorkspace.readFile()` — direct function call | Per-task clone on local disk |
| **Sandboxed Internal** (Phase 6) | Microsandbox / Docker on same host | Volume mount: `-v /data/workspaces/{taskId}:/workspace` | Per-task clone, mounted into container |
| **Claude Code** (external) | Remote machine / cloud | **Clones repo itself** — has superior git/fs tools | Clone via `repoUrl` + task branch |
| **Child Ping Team** (external) | Another Ping instance | **Clones repo itself** — its own WorkspaceManager | Clone via `repoUrl` + task branch |
| **E2B Cloud Sandbox** | E2B cloud VM | E2B `Sandbox.files.write()` API or git clone inside VM | Clone inside sandbox |

### Key Insight: Clone Is the Universal Interface

The per-task clone model works for **all** agent types because:

1. **Internal agents** → clone to local disk, access via `AgentWorkspace`
2. **Sandboxed agents** → clone to local disk, mount into container
3. **External agents (Claude, child Ping)** → receive `repoUrl` + branch name, clone themselves
4. **Cloud sandboxes (E2B)** → clone inside the sandbox VM

**Git remote + branch is the universal handoff protocol.** You don't need to share filesystems, mount volumes, or sync directories. Each worker clones, works, pushes.

```
Orchestrator assigns task:
  {
    taskId: "T-003",
    repoUrl: "https://github.com/org/landing-page.git",
    branch: "task-T-003",
    instructions: "Implement header component..."
  }

Internal agent:    git clone → local disk → AgentWorkspace tools
Claude Code:       git clone → its own workspace → its own tools
Child Ping:        git clone → its own WorkspaceManager → its own tools
E2B sandbox:       git clone inside VM → sandbox tools
```

### Worktree vs Clone vs Clone — Decision Matrix

| Factor | Worktree | Per-Task Clone | Remote Clone (external agent) |
|--------|----------|---------------|------------------------------|
| **Same machine** | ✅ Lightweight, shared `.git` | ✅ Works, more disk | N/A |
| **Different machine** | ❌ Can't share worktrees across hosts | ❌ Can't share local clones | ✅ Only option |
| **Container mount** | ⚠️ Complex (must mount parent `.git` too) | ✅ Self-contained directory | ✅ Clone inside container |
| **External agent (Claude)** | ❌ Not possible | ❌ Not possible | ✅ Agent clones via URL |
| **Parallel tasks** | ✅ Each worktree = separate checkout | ✅ Each clone = fully independent | ✅ Fully independent |
| **Disk usage** | Low (shared objects) | Medium (full clone each) | Zero (on remote host) |
| **Cleanup** | `git worktree remove` | `rm -rf` | Agent cleans up itself |
| **Offline / network down** | ✅ Already local | ✅ Already local | ❌ Needs network |

### The Hybrid Strategy

Different strategies for different agent locations:

```
Task Dispatch Decision:
  │
  ├─ Internal agent (same process)?
  │   ├─ Same repo as another active task?
  │   │   └─ Use WORKTREE (shared .git, lightweight)
  │   └─ Different repo or first task?
  │       └─ Use CLONE (per-task directory)
  │
  ├─ Sandboxed agent (container on same host)?
  │   └─ CLONE to host disk → mount into container
  │       /data/workspaces/plan-{id}/task-{id}/ → /workspace
  │
  └─ External agent (Claude, child Ping, E2B)?
      └─ Send REPO URL + BRANCH NAME via MCP
          Agent clones and manages its own workspace
```

### What Ping Sends to External Agents

When dispatching to an external agent via MCP, the task payload includes:

```typescript
interface ExternalTaskAssignment {
  taskId: string;
  planId: string;
  instructions: string;
  
  // Workspace info — external agent decides how to use it
  workspace: {
    repoUrl: string;           // "https://github.com/org/repo.git"
    branch: string;            // "task-T-003" (pre-created or agent creates)
    baseBranch: string;        // "main"
    authToken?: string;        // For private repos (scoped, short-lived)
  };

  // Coordination endpoints — Ping MCP server
  coordination: {
    mcpUrl: string;            // "http://ping-host:3002/mcp"
    tools: string[];           // ["report_status", "complete_task", "collab_read"]
  };

  // Context from dependencies
  dependencyOutputs: Array<{
    taskId: string;
    summary: string;
    artifacts: string[];       // File paths in the repo
  }>;
}
```

The external agent:
1. Clones `repoUrl` (or uses its own workspace tools to do so)
2. Creates/checks out `branch`
3. Does the work using its own tools (Claude has superior file/git tools)
4. Commits and pushes to remote
5. Calls `report_status` / `complete_task` via Ping's MCP endpoint

### Internal Agent: Clone Flow

```
WorkerPool.runTask(task)
  → WorkspacePlugin.prepareForTask({ taskId, planId, repoUrl })
    → WorkspaceManager.createWorkspace(agentId, taskId, { planId, repoUrl })
      → mkdir data/workspaces/plan-{planId}/task-{taskId}/
      → AgentWorkspace.initializeFromRepo({ repoUrl })
        → GitBranchManager.clone(repoUrl, taskDir)   // git clone --single-branch
        → git checkout -b task-{taskId}
      → return workspace (with tools bound to taskDir)
  → AiSdkAgent.setTools(workspaceTools)  // tools read/write to cloned dir
  → agent.executeToolMode(instructions)
  → ... agent works ...
  → workspace.pushToRemote()  // git push origin task-{taskId}
  → cleanup taskDir
```

### Worktree Optimization (Same-Repo Tasks)

When multiple tasks in the same plan share the same repo, cloning N times is wasteful. Use worktrees instead:

```
Plan "Build Landing Page" → repoUrl: github.com/org/app.git
  First task:  git clone → data/workspaces/plan-{id}/repo/
  Second task: git worktree add → data/workspaces/plan-{id}/task-T-002/
  Third task:  git worktree add → data/workspaces/plan-{id}/task-T-003/
```

```typescript
// WorkspaceManager — smart strategy selection
async createWorkspace(agentId: string, taskId: string, opts: CreateOpts) {
  const planDir = path.join(this.workspacesRoot, `plan-${opts.planId}`);
  const repoDir = path.join(planDir, 'repo');

  if (opts.repoUrl) {
    const repoExists = await this.hasCloneForPlan(opts.planId, opts.repoUrl);
    
    if (!repoExists) {
      // First task for this plan+repo → full clone
      await this.gitManager.clone(opts.repoUrl, repoDir);
      this.planRepos.set(opts.planId, repoDir);
    }

    // Subsequent tasks → worktree from the clone
    const taskDir = path.join(planDir, `task-${taskId}`);
    const git = simpleGit(repoDir);
    await git.raw(['worktree', 'add', taskDir, '-b', `task-${taskId}`]);

    return new AgentWorkspace({
      basePath: taskDir,   // Isolated working tree
      taskId, agentId,
      branchName: `task-${taskId}`,
      gitManager: new GitBranchManager(taskDir, 'main'),
    });
  }
}
```

**Result:** 1 clone + N-1 worktrees per plan. Best of both worlds.

### Summary: Workspace Strategy by Agent Location

| Where Agent Runs | Strategy | Who Clones | Workspace Owner |
|-----------------|----------|-----------|-----------------|
| **Same process** (internal) | Clone first task, worktree rest | WorkspaceManager | Ping |
| **Same host container** (sandbox) | Clone + volume mount | WorkspaceManager | Ping (mounted) |
| **Remote** (Claude, child Ping) | Send repoUrl + branch | External agent | External agent |
| **Cloud sandbox** (E2B) | Clone inside sandbox | E2B SDK | Sandbox VM |

---

## Execution Strategy: What to Build First

### Platform Status (April 2026)

**Built and working (Phases 1-3):**

| Component | Status | LOC |
|-----------|--------|-----|
| PlannerAgent (A5) | ✅ Shipped | ~1,200 |
| OrchestratorService | ✅ Shipped | ~800 |
| WorkerPool | ✅ Shipped | ~600 |
| AiSdkAgent (AI SDK v6) | ✅ Shipped | ~1,500 |
| TaskStore + DependencyResolver | ✅ Shipped | ~700 |
| Workspace tools (L1) | ✅ Shipped | ~2,000+ |
| CRDT Collaboration (L2) | ✅ Shipped | ~1,500+ |
| Frontend (React 19 + streaming) | ✅ Shipped | ~5,000+ |
| PluginRegistry (interfaces) | ✅ Defined | ~400 |

**Designed but unbuilt (0% code):**
- Chat Agent Layer (L2 persistent agents)
- Parallel Plans (this feature)
- External Agent Invocation (A7)
- Ping MCP Server
- Tools as MCP
- Worker Sandboxing
- Conversation Persistence

### Dependency Analysis

```
DONE ──────────────────────────────────
  A5 Planner ✅ → A6 Task Orch ✅

NEXT (no blockers) ────────────────────
  Chat Agent Layer ← needs only A5 ✅
    ├→ unlocks: user-to-role chat
    ├→ unlocks: task threads in UI
    ├→ unlocks: per-role memory/identity
    └→ enables: worker dispatch through Chat Agents

  Plugin Taxonomy ← refactoring only, no blockers

BLOCKED (needs Chat Agents) ───────────
  Parallel Plans ← needs Chat Agent Layer
  Conversation Persistence ← needs Chat Agent Layer
  External Agents (A7) ← needs Tools as MCP (A3)
  Git Task Context (A8) ← needs persistent agents
```

**Key blocker:** A8 (Git Task Context) ↔ A10 (Persistent Agents) have a circular dependency. Chat Agent Layer IS A10 without parallelism — building it first breaks the circle.

### Recommended Order

```
PHASE A — Foundation (2-3 weeks)
  1. Chat Agent Layer Steps 1-3
     - ChatAgent class, read-only chat, task threads
     - Each step behind feature flag, zero risk
  
  2. Plugin Taxonomy refactor (parallel, 1 week)
     - Clean IPlugin, capability mixins, scope separation

PHASE B — Dispatch Rewiring (1-2 weeks)
  3. Chat Agent Layer Step 4
     - Chat Agents dispatch workers (flag-gated, kill-switch)

  4. Chat Agent Layer Step 5
     - Agents create their own tasks

PHASE C — Enabled by Chat Agents (pick order)
  5. Conversation Persistence
  6. Parallel Plans (this feature — serial execution first)
  7. Git Task Context (A8)
  8. External Agents via IWorker + McpWorker
```

### Why Chat Agent Layer First

1. **Zero blockers** — everything it needs is shipped (A5, TaskStore, WorkerPool)
2. **Unlocks the most** — parallel plans, persistence, external agents, task threads all need it
3. **Fully planned** — 5 incremental steps, each flag-gated
4. **Breaks A8↔A10 circular dependency** — unblocks Phases 4-5

### What NOT to Build Next

| Feature | Why Defer |
|---------|-----------|
| Tools as MCP (A3) | Large refactor, no user-facing value yet |
| Worker Sandboxing (A4) | Security nice-to-have, not blocking anything |
| Knowledge Base wiring (L3) | Small effort (~3 days) but low impact, squeeze in anytime |
| Parallel Plans implementation | Architecture done (this doc), wait for Phase C |

---

## Worker Abstraction: IWorker Interface

### The Problem

Today all workers are in-process `AiSdkAgent` instances. To add Claude Code, OpenClaw, or child Ping teams as workers, we need a common interface without over-engineering.

### The Design: One Interface, Two Methods

```typescript
interface IWorker {
  run(task: TaskWithContext): AsyncGenerator<WorkerEvent>;
  cancel(): Promise<void>;
}
```

Every agent type — internal or external — implements this. The orchestrator, Chat Agents, and frontend never know or care which implementation is running.

### WorkerEvent (Unified)

```typescript
type WorkerEvent =
  | { type: 'stream_part'; part: StreamPart }   // text/tool rendering
  | { type: 'progress'; message: string }        // status update
  | { type: 'ask_user'; question: string }       // needs input
  | { type: 'complete'; result: TaskResult }     // done
  | { type: 'error'; error: string };            // failed
```

### Two Implementations

```typescript
// What exists today — wraps AiSdkAgent
class InternalWorker implements IWorker {
  constructor(private agent: AiSdkAgent) {}

  async *run(task: TaskWithContext): AsyncGenerator<WorkerEvent> {
    const stream = this.agent.executeToolMode(task.input);
    for await (const event of stream) {
      yield event; // Already yields WorkerEvent-compatible events
    }
  }

  async cancel() { this.agent.abort(); }
}

// Future — wraps MCP client for external agents
class McpWorker implements IWorker {
  constructor(private mcpUrl: string, private authToken?: string) {}

  async *run(task: TaskWithContext): AsyncGenerator<WorkerEvent> {
    const client = await this.connect(this.mcpUrl);
    await client.callTool('accept_task', task);
    // Translate MCP events → WorkerEvent
    for await (const event of client.events()) {
      yield this.translate(event);
    }
  }

  async cancel() { await this.client.callTool('cancel_task'); }
}
```

### How WorkerPool Uses It

```
WorkerPool.dispatch(task, role)
  │
  ├─ role has internal agent definition?
  │   └─ new InternalWorker(aiSdkAgent)
  │       └─ in-process, yields WorkerEvent
  │
  └─ role has external config (mcpUrl)?
      └─ new McpWorker(mcpUrl)
          └─ MCP transport, yields same WorkerEvent
```

The orchestrator calls `WorkerPool.dispatch()`. WorkerPool picks the right `IWorker` implementation. Everything downstream sees the same `WorkerEvent` stream.

### Why NOT a Separate Agent Abstraction Layer

The agents are **already decoupled** from the orchestrator. The orchestrator dispatches tasks through WorkerPool, which yields events. Adding another layer creates indirection with no benefit:

```
❌ Orchestrator → AgentManager → AgentPool → AgentAdapter → Worker
✅ Orchestrator → WorkerPool → IWorker (internal or external)
```

### Why MCP Alone Isn't Enough

MCP is a **transport protocol**, not a worker abstraction. `McpWorker` wraps MCP to handle:
- Connection lifecycle (connect, reconnect, timeout)
- Event translation (`report_status` MCP call → `WorkerEvent.progress`)
- Auth token management for private repos
- Error handling and retry logic

MCP is how external agents communicate. `IWorker` is how the system reasons about workers.

### Build Timeline

| When | What | Effort |
|------|------|--------|
| **Now** | Extract `IWorker` from existing WorkerPool code | 30 min |
| **Chat Agent Layer** | WorkerPool routes through Chat Agents | Included in Step 4 |
| **When adding Claude/OpenClaw** | Implement `McpWorker` | 1-2 weeks |

Don't build `McpWorker` until you actually connect an external agent. The interface is ready — the implementation waits.
