# Workspace Git Push — Issues & Solutions

## End-to-End Flow

### Phase 1: Frontend → Socket (GoalScreen → AgentServiceV2)

```
GoalScreen.tsx
  ├─ State: repoUrl (RepoPicker), repoBranch (default "main")
  ├─ handleSubmit() → validates all 4 params (teamId, goal, repoUrl, repoBranch)
  └─ onSubmitGoal(teamId, goal, repoUrl, repoBranch)
       ↓
App.tsx handleGoalScreenSubmit()
  ├─ Ensures socket connected to team
  ├─ Creates planId (slug+hash) and goalId
  ├─ Saves plan to localStorage via savePlan()
  ├─ Adds user message to chatStore: key = "{teamId}:goal:{goalId}"
  └─ agentServiceV2.sendToManager(goal, goalId, repoUrl, repoBranch)
       ↓
AgentServiceV2.sendToManager()
  └─ socket.emit("message", {
       teamId, agentId: "manager", sessionId, content: goal,
       goalId, repoUrl, repoBranch        ← INCLUDED
     })
```

**Files:** GoalScreen.tsx (L42-82), App.tsx (L540-568), AgentServiceV2.ts (L340-358)

### Phase 2: Socket → GoalManager (SocketServerV2 → OrchestratorService)

```
SocketServerV2.handleMessage()
  ├─ Validates via MessagePayloadSchema (repoUrl: z.string().url().max(500).optional())
  ├─ Routes agentId === "manager" → handleOrchestratorMessage()
  │
  ├─ handleOrchestratorMessage()
  │   ├─ Wires authTokenResolver if repoUrl present:
  │   │     manager.getWorkerPool().setAuthTokenResolver(async () => {
  │   │       return auth.getOAuthToken(socket.data.userId, "github");
  │   │     })
  │   └─ manager.orchestratorMessage(content, goalId, repoUrl, repoBranch)
       ↓
AgentManagerV2.orchestratorMessage()
  ├─ resolvedGoalId = goalId || crypto.randomUUID()
  ├─ Enriches content: content += "\n\n[Workspace: repo=..., branch=...]"
  └─ orchestrator.handleMessage(enrichedContent, resolvedGoalId, repoUrl, repoBranch)
       ↓
OrchestratorService._handleMessage()
  ├─ goalManager.getOrCreateGoalPublic(goalId, content)
  ├─ goalManager.setGoalRepo(goalId, repoUrl, repoBranch)   ← STORED on GoalContext
  └─ goalManager.executePlannerTurn(goalId, content)
       ↓
GoalManager.executePlannerTurn()
  ├─ Creates PlannerAgent if first turn (with submit_plan tool + plan mutation tools)
  └─ for await (event of planner.execute({message: enrichedContent}))
       → streams events to frontend
```

**Files:** SocketServerV2.ts (L50-60, L922-1040), AgentManagerV2.ts (L538-554), OrchestratorService.ts (L279-305), GoalManager.ts (L164-189)

### Phase 3: Plan Approval → Task Creation (submit_plan → approvePlan)

```
PlannerAgent calls submit_plan tool
  ├─ Schema: { planId, goal, repoUrl, repoBranch, tasks[] }
  ├─ octx.setPendingPlan(plan)   ← plan stored on GoalContext.pendingPlan
  ├─ octx.setState("executing")  ← auto-approves
  └─ Returns "Plan submitted and approved"
       ↓
GoalManager.approvePlan()
  ├─ Finds goal with pendingPlan
  ├─ LOG: [approvePlan] goal.repoUrl=https://...
  ├─ FOR each task in plan:
  │     taskStore.create({
  │       id: task.id,
  │       context: {
  │         repoUrl: goal.repoUrl,         ← INJECTED from GoalContext
  │         repoBranch: goal.repoBranch,    ← INJECTED from GoalContext
  │       }
  │     })
  ├─ DAG resolver builds dependency graph
  ├─ CRDT persistence: crdtSync.persistTask(task) for each task
  └─ Ready tasks (no prereqs) → TaskStore.queueTask()
       → onTaskReady callback fires
```

**Files:** submitPlan.ts (L25-120), GoalManager.ts (L313-475)

### Phase 4: Task Dispatch → Workspace Setup (TaskStore → WorkerPool → WorkspacePlugin)

```
GoalManager.onTaskReady({taskId, role})
  └─ callbacks.onDispatchTask(taskId, role)
       ↓
OrchestratorService.handleReadyTask()
  └─ dispatchManager.dispatch(taskId, role, autoExecute=true)
       ↓
DispatchManager.dispatch()
  ├─ Concurrency gate: max parallel tasks (default 3)
  └─ config.executeTask(taskId, role)
       ↓
OrchestratorService.dispatchTask()
  ├─ enrichedDescription = task description + previous outputs + artifacts
  └─ workerPool.runTask({
       id: taskId, assigned_role: role,
       context: { previousOutputs, artifacts, crdtRefs },
         ← NOTE: This NEW context does NOT have repoUrl (Issue 1 was here)
     })
       ↓
WorkerPool.runTask()
  ├─ ** READS repoUrl FROM TASKSTORE ** (not from dispatch arg):
  │     storedTask = this.taskStore.get(taskId)
  │     taskRepoUrl = storedTask.context.repoUrl      ← FIX for Issue 1
  │     taskRepoBranch = storedTask.context.repoBranch
  │
  ├─ Resolves auth token:
  │     authToken = await this.authTokenResolver()     ← GitHub OAuth via better-auth
  │
  ├─ Builds ToolContext:
  │     { consumer: "worker", role, taskId, goalId, planId,
  │       repoUrl: taskRepoUrl, repoBranch, authToken }
  │
  └─ pluginRegistry.prepareForTask(toolContext)
       ↓
WorkspacePlugin.prepareForTask()
  ├─ Skips if consumer === "planner" or no taskId
  ├─ l1.createWorkspace(role, taskId, {
  │     goalId, planId, repoUrl, repoBranch, authToken
  │   })
  │
  └─ If repoUrl: gitManager.addRemote("origin", authUrl)
       where authUrl = repoUrl.replace("https://", "https://oauth2:{token}@")
       ↓
WorkspaceManager.createWorkspace()
  ├─ ISOLATION CHECK: repoUrl && planId && FF_WORKSPACE_ISOLATION !== "false"
  │
  ├─ IF ISOLATED (repoUrl present):
  │   ├─ planDir = workspacesRoot/plan-{planId}/
  │   ├─ taskDir = planDir/task-{taskId}/
  │   ├─ branchName = goal-{goalId}/task-{taskId}
  │   │
  │   ├─ FIRST TASK for this plan:
  │   │   ├─ repoDir = planDir/repo/
  │   │   ├─ GitBranchManager(repoDir, branch, {skipAutoInit: true})
  │   │   ├─ clone(authUrl, repoDir, {branch})
  │   │   ├─ If empty repo: seedInitialCommit()
  │   │   ├─ planRepos.set(planId, repoDir)  ← cache for subsequent tasks
  │   │   └─ git worktree add taskDir -b branchName
  │   │
  │   ├─ SUBSEQUENT TASKS for same plan:
  │   │   ├─ Uses cached planRepos.get(planId)
  │   │   └─ git worktree add taskDir -b branchName
  │   │
  │   └─ AgentWorkspace({
  │        basePath: taskDir,  ← points to worktree
  │        gitManager: GitBranchManager(taskDir, branch, {skipAutoInit: true}),
  │        skipGitInit: true,  ← prevents checkout in initialize()
  │      })
  │
  └─ IF SHARED (no repoUrl):
      └─ AgentWorkspace({
           basePath: workspacesRoot,
           gitManager: shared gitManager,
         })
```

**Files:** GoalManager.ts (L508-513), OrchestratorService.ts (L399-590), DispatchManager.ts (L60-79), WorkerPool.ts (L215-297), WorkspacePlugin.ts (L132-165), WorkspaceManager.ts (L91-184)

**Disk layout (isolated mode):**
```
data/workspaces/{teamId}/
  └─ plan-{planId}/
      ├─ repo/                    ← primary clone (has .git/ + origin remote)
      │   ├─ .git/
      │   └─ (repo files)
      ├─ task-task-1/             ← worktree (has .git file pointing to repo/.git)
      │   ├─ .git                 ← FILE, not directory
      │   └─ (repo files on branch goal-{goalId}/task-task-1)
      └─ task-task-2/             ← another worktree
          ├─ .git                 ← FILE
          └─ (repo files on branch goal-{goalId}/task-task-2)
```

### Phase 5: Agent Execution → Commit (AiSdkAgent → workspace tools)

```
WorkerPool (continues from Phase 4)
  ├─ Creates AiSdkAgent with workspace tools (write, read, commit, etc.)
  └─ for await (event of agent.execute({message}))
       ├─ stream_part → callbacks.onStream → SocketServerV2 → frontend
       ├─ done → callbacks.onDone
       └─ error → callbacks.onError
       ↓
Agent calls workspace_write_file("src/app.ts", content)
  └─ workspace.createFile() or workspace.updateFile()
       → writes to taskDir (worktree directory)
       ↓
Agent calls workspace_commit("feat: add app")
  └─ workspace.commit(message)
       └─ gitManager.withLock() →
            _commitGitOps(message):
              1. getCurrentBranch()
              2. checkout(branchName) if needed    ← ISSUE 8: fails in worktree
              3. writeWorkspaceMetadata()          ← updates workspace.json
              4. addAll()                          ← git add -A
              5. commit(message, author)           ← git commit
                 → returns {hash, message, author, timestamp}
```

**Files:** workspace-tools.ts (L129-265), AgentWorkspace.ts (L690-735), GitBranchManager.ts (L576-625)

**Issue 8 detail:** `_commitGitOps` calls `checkout(branchName)` but in a worktree, the branch IS the worktree — `git checkout` may fail because the branch is already checked out. Fix: skip checkout when `skipGitInit` is true (worktree mode).

### Phase 6: Task Completion → Push to GitHub

```
Agent finishes (generator yields "done" event)
  ↓
WorkerPool.onDone callback
  ├─ Stores output in taskStore
  └─ callbacks.onTaskUpdate({ taskId, status: "completed" })
       ↓
OrchestratorService (via callbacks)
  └─ pluginRegistry.onTaskComplete(taskId, goalId)
       ↓
WorkspacePlugin.onTaskComplete()
  │
  ├─ STEP 1: workspace.publish(goalId)
  │   ├─ Commits uncommitted changes (under lock)
  │   ├─ Collects all files (excludes .git, .ping, .scratch)
  │   ├─ Builds OutputManifest → writes to .ping/outputs/{taskId}.json
  │   ├─ Commits manifest
  │   └─ Sets workspace.status = "published"
  │
  ├─ STEP 2: workspace.pushToRemote() — IF isolated (worktree)
  │   ├─ Commits any remaining uncommitted changes
  │   └─ gitManager.push("origin", branchName)
  │        → git push --set-upstream origin goal-{goalId}/task-{taskId}
  │        ← pushes TASK BRANCH to GitHub
  │
  ├─ STEP 3: manager.mergeAndCleanup(taskId)
  │   ├─ Removes workspace.json (task-specific metadata)
  │   ├─ gitManager.mergeBranch(branchName)
  │   │   ├─ git checkout main
  │   │   ├─ git merge branchName --no-ff
  │   │   └─ Auto-resolve infrastructure file conflicts if any
  │   ├─ Deletes workspace from registry
  │   └─ Returns { success: true }
  │
  └─ STEP 4: gitManager.push() — IF remote configured
       └─ git push origin main
            ← pushes MAIN BRANCH to GitHub (includes merged task work)
```

**Files:** WorkerPool.ts (L408-500), WorkspacePlugin.ts (L177-221), AgentWorkspace.ts (L762-900, L925-965), GitBranchManager.ts (L288-340, L825-840)

**What lands on GitHub:**
- Branch `goal-{goalId}/task-{taskId}` — the raw task work (pushed in Step 2)
- Branch `main` — merged result of all completed tasks (pushed in Step 4)

### Complete Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                                                                       │
│ GoalScreen → App.tsx → AgentServiceV2.sendToManager()                         │
│   socket.emit("message", {content, goalId, repoUrl, repoBranch})              │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ Socket.IO
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ SOCKET LAYER                                                                   │
│ SocketServerV2.handleMessage → handleOrchestratorMessage                       │
│   ├─ setAuthTokenResolver (GitHub OAuth)                                       │
│   └─ manager.orchestratorMessage(content, goalId, repoUrl, repoBranch)         │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ AGENT MANAGER                                                                  │
│ AgentManagerV2.orchestratorMessage()                                            │
│   └─ orchestrator.handleMessage(enrichedContent, goalId, repoUrl, repoBranch)  │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ ORCHESTRATOR                                                                   │
│ OrchestratorService._handleMessage()                                           │
│   ├─ goalManager.setGoalRepo(goalId, repoUrl, repoBranch) → GoalContext       │
│   └─ goalManager.executePlannerTurn() → PlannerAgent runs                      │
│        └─ submit_plan tool → setPendingPlan → approvePlan()                    │
│             └─ task.context.repoUrl = goal.repoUrl (per task)                  │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ onTaskReady → dispatch
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ WORKER POOL                                                                    │
│ WorkerPool.runTask()                                                           │
│   ├─ taskRepoUrl = taskStore.get(taskId).context.repoUrl                       │
│   ├─ authToken = authTokenResolver()                                           │
│   └─ pluginRegistry.prepareForTask({repoUrl, authToken})                       │
│        └─ WorkspacePlugin → WorkspaceManager.createWorkspace()                 │
│             ├─ git clone repoUrl → plan-{planId}/repo/                         │
│             ├─ git worktree add → plan-{planId}/task-{taskId}/                 │
│             └─ addRemote("origin", authUrl)                                    │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ agent.execute() generator
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ AGENT EXECUTION                                                                │
│ AiSdkAgent executes in worktree directory                                      │
│   ├─ workspace_write_file → writes to task dir                                 │
│   ├─ workspace_commit → git add -A && git commit (on task branch)              │
│   └─ done → onTaskComplete                                                     │
│        ├─ publish() → collect outputs + manifest                               │
│        ├─ pushToRemote() → git push origin task-branch                         │
│        ├─ mergeAndCleanup() → git merge task-branch into main                  │
│        └─ push() → git push origin main                                        │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Confirmed Bug: `repoUrl` Lost in Dispatch

### Evidence (from logs)

```
[SocketServerV2] repoUrl=https://github.com/nitrroshan/pingtemp1.git  ✅ Frontend sends it
[GoalManager]    Repo set for goal ...: https://...                    ✅ Stored on GoalContext
[approvePlan]    goal.repoUrl=https://...                              ✅ Present during task creation
[WorkspacePlugin] prepareForTask: repoUrl=NONE                        ❌ Lost before workspace setup
```

### Root Cause

`OrchestratorService.dispatchTask()` creates a **new context object** that discards the task's original context:

```typescript
// OrchestratorService.ts — dispatchTask (line ~508)
await this.workerPool.runTask({
  id: taskId,
  assigned_role: role,
  description: enrichedDescription,
  priority: task.priority || 0,
  context: { previousOutputs, artifacts, crdtRefs },  // ← NEW object, NO repoUrl
  goalId: task.goalId,
  createdAt: Date.now(),
  status: "in_progress",
});
```

The `context` here has `{ previousOutputs, artifacts, crdtRefs }` — it does NOT include `repoUrl` or `repoBranch` from the original `task.context` that was set during `approvePlan`.

WorkerPool then reads `task.context?.repoUrl` from this stripped object → gets `undefined`.

### Data Flow

```
GoalContext.repoUrl = "https://..."           ✅ Set by setGoalRepo
  ↓
approvePlan → taskStore.create({              ✅ Stored in TaskStore
  context: { repoUrl: goal.repoUrl }
})
  ↓
dispatchTask → workerPool.runTask({           ❌ BREAK — new context object
  context: { previousOutputs, artifacts }     ← repoUrl NOT included
})
  ↓
WorkerPool reads task.context?.repoUrl        ❌ undefined
  ↓
WorkspacePlugin.prepareForTask(repoUrl=NONE)  ❌ No remote configured
  ↓
onTaskComplete → getRemotes() → empty         ❌ No push
```

---

## Solution: Read from TaskStore, Not Dispatch Argument

### The Problem Pattern

`dispatchTask` rebuilds the task object from scratch instead of passing the TaskStore version. This is a fundamental design issue — the dispatch layer **transforms** the task context instead of **forwarding** it.

### Solution: WorkerPool Should Read from TaskStore

WorkerPool already HAS access to TaskStore (`this.taskStore`). It should read the authoritative task (with `context.repoUrl`) from TaskStore instead of relying on the stripped object from `dispatchTask`.

**Current code (WorkerPool.runTask):**
```typescript
// Reads from the passed-in task object (stripped by dispatchTask)
const task = taskIdOrTask;
taskRepoUrl = task.context?.repoUrl;  // ← undefined because dispatchTask stripped it
```

**Fix:**
```typescript
// Always read from TaskStore (authoritative, has full context including repoUrl)
const task = taskIdOrTask;
const storedTask = this.taskStore?.get(task.id);
taskRepoUrl = storedTask?.context?.repoUrl || task.context?.repoUrl;
taskRepoBranch = storedTask?.context?.repoBranch || task.context?.repoBranch;
```

### Why This Is the Right Long-Term Fix

1. **Single source of truth** — TaskStore is where `approvePlan` writes the task. WorkerPool reads from the same place. No transformation layer in between.
2. **No dispatchTask changes needed** — `dispatchTask` can keep its stripped context for the message builder. WorkerPool gets the full context from TaskStore.
3. **Future-proof** — any new fields added to task.context (auth tokens, workspace config, etc.) automatically flow through without touching dispatchTask.
4. **Already the pattern for other fields** — WorkerPool already reads `storedTask?.goalId` from TaskStore (line 151). Just extend to `context.repoUrl`.

### What NOT To Do

- ❌ Don't modify `dispatchTask` to pass repoUrl — it would couple the dispatch layer to workspace concerns
- ❌ Don't store repoUrl as a separate field on WorkerPool — it should come from the task
- ❌ Don't rely on the LLM planner to include repoUrl in submit_plan — unreliable

---

## Secondary Issues Found

### Issue 2: Auth Token — SOLID Violations

**Current design:**
```
SocketServerV2 (transport layer)
  → hardcodes MongoDB query for GitHub OAuth token
  → creates closure over userId + db connection
  → injects closure into WorkerPool
```

**Violations:**
- **SRP:** SocketServerV2 (transport) handles token resolution (auth concern)
- **DIP:** WorkerPool depends on a concrete closure, not an interface
- **Tight coupling:** MongoDB query hardcoded in socket handler — SQLite/local mode can't work
- **Lifecycle mismatch:** Closure captures userId from socket. If socket reconnects (different user), stale token
- **Not testable:** Can't mock token resolver without mocking entire socket handler

**Proper design (SOLID):**
```typescript
// Interface (DIP — depend on abstraction)
interface ITokenProvider {
  getGitToken(userId: string, provider: 'github'): Promise<string | null>;
}

// Implementation (SRP — one class, one job)
class AuthTokenService implements ITokenProvider {
  constructor(private serviceRegistry: ServiceRegistry) {}
  
  async getGitToken(userId: string, provider: 'github'): Promise<string | null> {
    // Works with MongoDB, SQLite, or any storage — abstracted via ServiceRegistry
    return this.serviceRegistry.getAccountToken(userId, provider);
  }
}

// Injection (OCP — extend without modifying WorkerPool)
// Injected via PluginRegistry or AgentManager config — not socket handler
workerPool.setTokenProvider(authTokenService);

// Usage in WorkerPool (LSP — any ITokenProvider works)
const token = await this.tokenProvider?.getGitToken(task.userId, 'github');
```

**Implementation plan:**
1. Add `ITokenProvider` interface to `packages/agent-manager/src/plugin/types.ts`
2. Add `AuthTokenService` to `packages/backend/services/AuthTokenService.ts` — reads from ServiceRegistry (works for both MongoDB and SQLite)
3. Inject via AgentManagerRegistry when creating AgentManager — `workerPool.setTokenProvider(authTokenService)`
4. Remove closure from SocketServerV2 — transport layer no longer touches auth
5. Store `userId` on GoalContext (alongside repoUrl) so WorkerPool knows whose token to fetch

**When to do this:** During GitHub App integration (replaces OAuth tokens with installation tokens). Current closure works for cloud mode MVP.

### Issue 3: Shared Mode vs Isolated Mode Confusion

Two workspace modes exist but the push behavior is different:
- **Isolated mode** (git clone): remote auto-created by clone ✅
- **Shared mode** (git init): remote must be manually added ❌

The `addRemote` in `prepareForTask` handles both, but only if `repoUrl` arrives (which it doesn't due to Issue 1).

**Solution:** Issue 1's fix resolves this — once repoUrl flows through, `addRemote` in `prepareForTask` works for both modes.

### Issue 4: No Push Verification

After `onTaskComplete` calls `push()`, there's no verification or user notification that the push succeeded or failed. The `console.warn` on failure is silent to the user.

**Solution:** Emit a `workspace:pushed` or `workspace:push-failed` event via Socket.IO so the frontend can show a toast notification.

---

## Issue 5: Workspace Tools Not Callable After Issue 1 Fix

### Symptom

After the Issue 1 fix (read repoUrl from TaskStore), the LLM agent's workspace tools (read_file, write_file, etc.) are **listed** in the tool manifest but **fail when called**.

### Investigation Status

The Issue 1 fix changes how `taskGoalId`, `taskRepoUrl`, `taskRepoBranch` are read in the queue mode path of `WorkerPool.runTask`:

```typescript
// Before (reads dispatch arg — has previousOutputs but no repoUrl):
taskGoalId = task.goalId;
taskRepoUrl = task.context?.repoUrl;     // undefined (stripped by dispatchTask)

// After (reads TaskStore — has repoUrl but different context shape):
const storedTask = this.taskStore?.get(task.id);
taskGoalId = storedTask?.goalId || task.goalId;
taskRepoUrl = storedTask?.context?.repoUrl;   // correct from approvePlan
```

### Possible Causes

1. **TaskStore context vs dispatch context shape mismatch** — `storedTask.context` has `{ title, planId, goal, repoUrl, ... }` while dispatch `task.context` has `{ previousOutputs, artifacts, crdtRefs }`. The toolContext uses `taskRepoUrl` from storedTask but other parts of WorkerPool may still reference dispatch `task.context`.

2. **createWorkspace with repoUrl triggers isolated mode** — When `repoUrl` + `planId` are present, `WorkspaceManager.createWorkspace` activates isolated mode (git clone + worktrees). This changes the workspace directory structure. If the clone fails (auth, network), workspace tools have no working directory.

3. **Isolated mode workspace path mismatch** — Workspace tools resolve files relative to `workspace.basePath`. In isolated mode, `basePath` is `plan-{planId}/task-{taskId}/` (worktree), not the shared repo root. If the worktree creation fails silently, tools can't find the directory.

4. **Auth token missing for clone** — Isolated mode does `git clone repoUrl`. If `authToken` is undefined (resolver fails), the clone of a private repo fails → no workspace → tools fail.

### Diagnostic Steps Needed

1. Check backend logs for `[WorkspacePlugin] prepareForTask:` — does repoUrl now show the URL?
2. Check for `Plugin workspace prepareForTask failed:` error in logs
3. Check if `plan-{planId}/` directory was created under workspaces
4. Check if worktree was created: `plan-{planId}/task-{taskId}/`
5. If clone failed, check for git error in logs

### Potential Solutions

**Option A: Don't activate isolated mode for now**
Set `FF_WORKSPACE_ISOLATION=false` in `.env`. This forces shared mode even with repoUrl. WorkerPool reads repoUrl from TaskStore → passes to prepareForTask → addRemote on shared repo → push works. No clone, no worktree, no auth needed for workspace creation.

**Option B: Fix auth flow for clone**  
The authTokenResolver is wired but may not resolve correctly. Add logging to verify the token is fetched before clone.

**Option C: Revert to dispatch arg for non-repoUrl fields, read only repoUrl from TaskStore**
```typescript
// Minimal fix — only read workspace fields from TaskStore
const task = taskIdOrTask;
taskId = task.id;
roleKey = task.assigned_role.toLowerCase();
finalMessage = this.buildMessageWithContext(task);
taskGoalId = (task as any).goalId;  // back to dispatch arg
// ONLY repoUrl from TaskStore (the fix)
const storedTask = this.taskStore?.get(task.id);
taskRepoUrl = storedTask?.context?.repoUrl;
taskRepoBranch = storedTask?.context?.repoBranch;
```
This preserves the original behavior for everything except repoUrl.

**Recommended: Option A (immediate) + Option C (code fix)**
Disable isolated mode via env var to unblock. Then apply Option C — minimal change, only reads what's needed from TaskStore.

---

## Issue 6: Clone Fails on Empty Repos — Breaks Workspace Completely

### Root Cause

When a user selects a **new/empty GitHub repo** (no commits), the isolated mode clone path breaks:

```
1. git clone https://github.com/user/empty-repo.git → succeeds
   ⚠️ "warning: You appear to have cloned an empty repository"
   Result: .git exists but no commits, no HEAD, no branches

2. git worktree add task-dir -b task-branch → FAILS
   Error: "fatal: invalid reference: HEAD"
   Reason: worktree requires at least one commit to create a branch from

3. PluginRegistry.prepareForTask catches error silently
   → workspace partially created (directory exists, no .git in worktree)
   → agent gets tools but they operate on a broken directory
   → tools fail at runtime
```

### Evidence

```bash
$ cd /tmp && git clone https://github.com/nitrroshan/pingtemp1.git test
# "warning: You appear to have cloned an empty repository."

$ cd test && git worktree add ../task1 -b task-branch
# fatal: invalid reference: HEAD
```

Workspace directory found at runtime:
```
data/workspaces/1efcca47.../
  └── src/              ← partial directory, no .git, no workspace metadata
```

### Solutions

**Solution A: Seed initial commit after empty clone (simplest)**

After clone, check if the repo has any commits. If not, create one:

```typescript
// WorkspaceManager.createWorkspace — after clone:
await cloneGitManager.clone(repoUrl, repoDir, options);

// Seed empty repo with initial commit so worktrees can be created
const log = await cloneGitManager.getGit().log().catch(() => null);
if (!log || log.total === 0) {
  await cloneGitManager.seedInitialCommit(); // README + .gitignore + commit
  logger.info("Seeded empty repo with initial commit");
}

// Now worktree works
await repoGit.raw(["worktree", "add", taskDir, "-b", branchName]);
```

**Pros:** Simple, 5 lines of code, handles the edge case
**Cons:** Pushes an initial commit to the user's empty repo (might surprise them)

**Solution B: Use `--orphan` for empty repos**

Git docs say `git worktree add --orphan` creates a worktree with an unborn branch — works without any commits:

```typescript
// Check if repo has commits
const hasCommits = await repoGit.raw(["rev-parse", "HEAD"]).catch(() => null);
if (hasCommits) {
  await repoGit.raw(["worktree", "add", taskDir, "-b", branchName]);
} else {
  await repoGit.raw(["worktree", "add", "--orphan", "-b", branchName, taskDir]);
}
```

**Pros:** No initial commit pushed, no side effects on user's repo
**Cons:** `--orphan` worktree is completely empty (no files from clone). Agent starts from scratch.
**Note:** `--orphan` requires Git 2.42+ (released Aug 2023)

**Solution C: Skip clone for empty repos — use shared mode fallback**

If the cloned repo is empty, fall back to shared mode (git init + addRemote):

```typescript
await cloneGitManager.clone(repoUrl, repoDir, options);

const log = await cloneGitManager.getGit().log().catch(() => null);
if (!log || log.total === 0) {
  logger.warn("Cloned repo is empty — falling back to shared mode with remote");
  // Don't use worktrees — use shared mode but still set remote
  // Agent creates files from scratch, pushes to the remote
  return this.createSharedWorkspace(agentId, taskId, initOptions);
}
```

**Pros:** No empty repo handling complexity, shared mode is proven
**Cons:** Loses parallel worktree benefit for empty repos (serial tasks only)

**Solution D: Validate repo before workspace creation (fail-fast)**

Before creating workspace, check if the repo has content:

```typescript
// In prepareForTask or earlier:
const repoInfo = await git.listRemote(["--heads", repoUrl]);
if (!repoInfo.trim()) {
  // Empty repo — warn user, skip clone
  logger.warn(`Repo ${repoUrl} is empty — workspace will be local-only`);
  // Fall back to shared mode + addRemote for eventual push
}
```

**Pros:** Fails fast with clear message, user knows what happened
**Cons:** Extra network call (latency), race condition (repo might get commits between check and clone)

### Recommended: Solution A (seed initial commit)

Why:
1. **Simplest** — 5 lines of code, handles the edge case
2. **User expects it** — if they selected an empty repo, they want the agent to put code there. An initial commit (README + .gitignore) is standard practice.
3. **Worktrees work** — after seeding, all subsequent tasks can use worktrees normally
4. **Push works** — origin remote exists from clone, initial commit + agent's work all push together
5. **Matches `git init` behavior** — the shared mode `initRepo()` already does exactly this
6. **No Git version dependency** — unlike `--orphan` which needs Git 2.42+

---

## Issue 7: Worktree Creation Broken by Auto-Init + Branch Creation

### Evidence (from runtime logs)

```
[22:58:48.774] Seeded empty cloned repo with initial commit               ✅ 
[22:58:48.796] Created primary clone + worktree for task 'task-1'         ✅
[22:58:48.808] Auto-initialized isolated git repo at: .../task-task-1     ❌ DESTROYS WORKTREE
[22:58:48.942] Plugin workspace prepareForTask failed: 
               fatal: 'main' is not a commit and a branch cannot be created  ❌
```

### Root Cause (two bugs in sequence)

**Bug A: GitBranchManager constructor runs `git init` inside worktree directory**

After `git worktree add` creates the task directory with a `.git` **file** (linking back to clone), `new GitBranchManager(taskDir)` runs the constructor which calls `execSync('git init')`. This creates a new `.git` **directory** — overwriting the worktree's `.git` file and destroying the link to the parent clone.

Worktree `.git` is a FILE: `gitdir: /path/to/clone/.git/worktrees/task-1`
After `git init`: `.git` becomes a DIRECTORY with an independent empty repo.

**Bug B: AgentWorkspace.initialize() tries to create a branch from 'main'**

After the worktree is destroyed by Bug A, `initialize()` calls `createBranch(branchName)` which tries to branch from `main`. But the destroyed worktree's new empty repo has no `main` ref → fatal error.

Even WITHOUT Bug A, this is wrong: `git worktree add -b branchName` already puts the worktree on the correct branch. `initialize()` shouldn't touch branches for worktree workspaces.

### Solution

**Fix 1: `skipAutoInit` for worktree GitBranchManager**

```typescript
// WorkspaceManager.createWorkspace — after worktree is created:
const taskGitManager = new GitBranchManager(
  taskDir,
  initOptions.repoBranch || "main",
  { skipAutoInit: true }  // worktree has .git file — don't run git init
);
```

**Fix 2: `skipGitInit` for worktree AgentWorkspace**

```typescript
// AgentWorkspace constructor — new option:
workspace = new AgentWorkspace({
  id, agentId, taskId, branchName, basePath: taskDir,
  gitManager: taskGitManager,
  skipGitInit: true,  // worktree already on correct branch
});

// AgentWorkspace.initialize() — skip branch ops when flag set:
if (!this.skipGitInit) {
  const branchExists = await this.gitManager.branchExists(this.branchName);
  if (!branchExists) await this.gitManager.createBranch(this.branchName);
  else await this.gitManager.checkout(this.branchName);
}
// Rest of initialize() still runs: directory creation, workspace.json, .gitignore
```

### Why This Is Correct

1. `git worktree add -b branchName` handles branch creation internally — AgentWorkspace shouldn't repeat it
2. Worktree `.git` is a file, not a directory — `git init` would destroy it
3. The fix cleanly separates: WorkspaceManager owns git topology (clone, worktree), AgentWorkspace owns file operations
4. `skipGitInit` doesn't skip directory structure creation — just branch operations

### Files Changed
1. `WorkspaceManager.ts` — pass `{ skipAutoInit: true }` + `skipGitInit: true` for worktree workspaces
2. `AgentWorkspace.ts` — add `skipGitInit` field + guard branch ops in `initialize()`
3. `GitBranchManager.ts` — `skipAutoInit` option (already exists)

---

## Issue 8: Git Commit Fails in Worktree — Pathspec Error

### Evidence (from UI screenshot)

```
workspace_commit({message: "feat: Add database schema migrations..."})

OUTPUT:
Error committing: error: pathspec 'goal-build-a-rest-api-for-a-notes-app-with-auth-and-sea-vmftj8/task-task-1' 
did not match any file(s) known to git
```

Also: `uncommittedChanges: ["plan-plan-notes-api/repo"]` — the worktree sees the clone's `repo/` sibling directory.

### Root Cause

The worktree's `GitBranchManager` was created with `simpleGit(taskDir)` — pointing at the worktree directory. But the worktree's `.git` **file** links back to the parent clone's `.git/worktrees/` directory. 

When `_commitGitOps` runs:
1. `getCurrentBranch()` → may return unexpected value in worktree context
2. `checkout(this.branchName)` → tries to checkout a branch that's already checked out in the worktree → pathspec error
3. `addAll()` → runs `git add -A` which may pick up files from outside the worktree

The pathspec error `'goal-.../task-task-1' did not match any file(s)` suggests git is interpreting the branch name as a file path — this happens when `git checkout` receives an invalid branch ref in the worktree context.

### Likely Fix

The `_commitGitOps` method should NOT attempt `checkout` in a worktree — the worktree is permanently on its branch. The checkout attempt is what causes the pathspec error.

**Option A: Skip checkout in commit if workspace has `skipGitInit` flag**

```typescript
private async _commitGitOps(message: string): Promise<CommitInfo> {
  // Skip branch checkout for worktree workspaces — already on correct branch
  if (!this.skipGitInit) {
    const currentBranch = await this.gitManager.getCurrentBranch();
    if (currentBranch !== this.branchName) {
      await this.gitManager.checkout(this.branchName);
    }
  }
  
  await this.writeWorkspaceMetadata();
  await this.gitManager.addAll();
  return this.gitManager.commit(message, `${this.agentId} <${this.agentId}@agent.local>`);
}
```

**Option B: Use worktree-aware checkout that handles the branch already checked out case**

The error may also come from `checkout()` in GitBranchManager which runs `git checkout branchName` — but in a worktree, the branch IS checked out. `git checkout` on an already checked-out branch in a worktree doesn't fail normally, so the error might be from a deeper issue with the `.git` file vs directory confusion.

### Investigation Needed

1. What does `git rev-parse --abbrev-ref HEAD` return inside the worktree directory?
2. What does `git status` show inside the worktree?
3. Is the `.git` file intact after the `skipAutoInit` fix, or was it overwritten?
4. Does `git add -A` work manually inside the worktree directory?

---

## How Industry Tools Handle Workspace Isolation

### SWE-agent (Princeton, 19K stars)
- **Each task = Docker container** with repo cloned inside
- No git worktrees — full clone per container
- Agent operates in the clone's root directory (not a subdirectory)
- `git diff` captures output → submitted as patch
- No multi-task parallel — one agent, one repo, one container

### Devin (Cognition Labs)
- **Each session = full VM snapshot** with repos pre-cloned
- "Snapshot" = frozen bootable image, every session boots from it
- No git worktrees — each session is a fresh VM copy
- Agent has full Linux environment (shell, IDE, browser)
- Session changes don't persist back to snapshot

### OpenHands (All-Hands-AI)
- **Each task = Docker sandbox** with repo mounted
- Agent operates in the mounted directory
- Full OS-level isolation (filesystem, network)
- No git worktrees — Docker provides isolation

### Common Pattern
**None of these tools use git worktrees.** They all use **container/VM-level isolation** — each agent gets its own filesystem. Git is used for output (diff/patch/push), not for workspace isolation.

**Why no worktrees?**
- Worktrees share `.git/objects` — a bug in one worktree can corrupt all
- Worktrees require careful branch management (can't checkout same branch twice)
- Worktrees have subtle behaviors (`.git` file vs directory, HEAD per worktree)
- Container isolation is simpler, more robust, zero git edge cases

---

## Plan: Long-term Fixes for Push + Merge Flow

### Design Decision

**Push task branch + merge locally to main + push main.** All git-native, works with any remote. PR-based merging deferred to future (GitHub-specific).

**Current flow (broken):**
```
Agent done → publish → pushToRemote(task branch) → mergeAndCleanup(merge to main) → push main
                              ↑ Issue 11                    ↑ Issue 12                ↑ Issue 12
```

**Fixed flow:**
```
Agent done → mark completed → resolve dependents → publish → push task branch → merge to main (in primary clone) → push main
                 ↑ Issue 13                            ↑ Issue 11       ↑ Issue 12
```

### Issues to fix

| Issue | Patch (rejected) | Long-term Fix |
|-------|-----------------|---------------|
| 8 | `if (!skipGitInit)` flag guard | `IWorkspaceGitOps` interface — two implementations |
| 9 | `TaskStore.setGoalDefaults()` dict merge | `GoalConfig` as structured type, looked up by goalId |
| 10 | — | Auto-resolves with Issue 9 |
| 11 | Call `_commitGitOps` directly | Fix status machine — `assertWritable()` accepts active + published |
| 12 | `if (isIsolated)` branch in mergeAndCleanup | `IWorkspaceMerger` strategy — two implementations |
| 13 | — | Separate completion from infrastructure (this IS the long-term fix) |

### Issue 8: `IWorkspaceGitOps` — Polymorphism over Boolean Flags

**Problem:** `_commitGitOps`, `initialize`, `initializeFromRepo`, `revertToCommit` all check `skipGitInit` to decide branch operations. Any new method touching branches needs the same flag check.

**Current (flag guards in 4 locations):**
- `initialize()` L167: `if (!this.skipGitInit) { createBranch or checkout }`
- `_commitGitOps()` L719: `if (!this.skipGitInit) { checkout(branchName) }`
- `initializeFromRepo()`: same pattern
- `revertToCommit()`: has checkout call

**Long-term fix — Strategy pattern:**

```typescript
// New file: packages/workspace/src/L1/workspace/IWorkspaceGitOps.ts

interface IWorkspaceGitOps {
  prepareBranch(branchName: string): Promise<void>;
  ensureBranch(branchName: string): Promise<void>;
  revert(branchName: string, commitHash: string): Promise<void>;
}

/** Standard mode: workspace owns its branch lifecycle */
class SharedGitOps implements IWorkspaceGitOps {
  constructor(private gitManager: GitBranchManager) {}
  
  async prepareBranch(branchName: string): Promise<void> {
    const exists = await this.gitManager.branchExists(branchName);
    if (!exists) await this.gitManager.createBranch(branchName);
    else await this.gitManager.checkout(branchName);
  }
  
  async ensureBranch(branchName: string): Promise<void> {
    const current = await this.gitManager.getCurrentBranch();
    if (current !== branchName) await this.gitManager.checkout(branchName);
  }
  
  async revert(branchName: string, commitHash: string): Promise<void> {
    await this.gitManager.checkout(branchName);
    await this.gitManager.revertToCommit(commitHash);
  }
}

/** Worktree mode: branch IS the worktree — no checkout needed */
class WorktreeGitOps implements IWorkspaceGitOps {
  async prepareBranch(): Promise<void> { /* noop — worktree already on branch */ }
  async ensureBranch(): Promise<void> { /* noop — worktree IS the branch */ }
  async revert(): Promise<void> {
    throw new Error("revertToCommit not supported in worktree mode");
  }
}
```

**AgentWorkspace changes:**
```typescript
class AgentWorkspace {
  private gitOps: IWorkspaceGitOps;
  
  constructor(opts: { ..., gitOps?: IWorkspaceGitOps }) {
    this.gitOps = opts.gitOps || new SharedGitOps(opts.gitManager);
  }
  
  async initialize() {
    await this.gitOps.prepareBranch(this.branchName);  // delegates
    // ... directory setup unchanged
  }
  
  private async _commitGitOps(message: string) {
    await this.gitOps.ensureBranch(this.branchName);  // no-op for worktree
    // ... rest unchanged
  }
}
```

**Removes:** `skipGitInit` property, all `if (!this.skipGitInit)` checks.
**Files:** new IWorkspaceGitOps.ts, AgentWorkspace.ts, WorkspaceManager.ts
```

### Issue 9: `GoalConfig` — Structured Type Instead of Dict Merge

**Problem:** Flat `Record<string, any>` dict merge has no type safety, easy to overwrite.

**Long-term fix — `GoalConfig` type + lookup by goalId:**

```typescript
// types.ts
interface GoalConfig {
  goalId: string;
  repoUrl?: string;
  repoBranch?: string;
}

// TaskStore
class TaskStore {
  private goalConfigs = new Map<string, GoalConfig>();
  
  setGoalConfig(config: GoalConfig): void {
    this.goalConfigs.set(config.goalId, config);
  }
  
  create(task: Task): void {
    if (task.goalId) {
      const gc = this.goalConfigs.get(task.goalId);
      if (gc) {
        task.context = { repoUrl: gc.repoUrl, repoBranch: gc.repoBranch, ...task.context };
      }
    }
    // ... rest of create
  }
}
```

**What's better:** Type-safe, lookup by goalId (multi-goal safe), extensible.
**Files:** TaskStore.ts, GoalManager.ts, types.ts

### Issue 10: Auto-resolves with Issue 9

### Issue 11: Fix Status Machine — `assertWritable()`

**Problem:** `pushToRemote()` needs to commit, but `commit()` calls `assertActive()` which only accepts `active`. After `publish()`, status is `published` → commit fails.

**Current:** `assertActive()` guards 7 methods (createFile, updateFile, deleteFile, commit, revertToCommit, pushToRemote, storeBinary). Only checks `active`.

**Analysis:** "published" means outputs collected — workspace files still valid, no reason to block writes until `merged` or `discarded`.

**Long-term fix:**

```typescript
// Rename assertActive → assertWritable, accept active + published
private assertWritable(): void {
  if (this._status !== "active" && this._status !== "published") {
    throw new Error(`Workspace ${this.id} is not writable (status: ${this._status})`);
  }
}
```

Replace all 7 call sites. `pushToRemote` simplifies — can call `commit()` normally again.

**Removes:** The need to bypass `commit()` with `_commitGitOps()` directly.
**Files:** AgentWorkspace.ts (only)
```

### Issue 12: `IWorkspaceMerger` — Strategy Pattern for Merge Topology

**Problem:** `mergeAndCleanup()` needs to branch on workspace type. `if (isIsolated)` mixes concerns.

**Long-term fix — `IWorkspaceMerger` strategy:**

```typescript
// New file: packages/workspace/src/L1/workspace/IWorkspaceMerger.ts

interface IWorkspaceMerger {
  merge(workspace: AgentWorkspace): Promise<MergeResult>;
  cleanup(workspace: AgentWorkspace): Promise<void>;
}

/** Shared mode: merge task branch into main in same repo */
class SharedMerger implements IWorkspaceMerger {
  async merge(workspace: AgentWorkspace): Promise<MergeResult> {
    return workspace.merge();
  }
  async cleanup(): Promise<void> { /* branch deleted by merge */ }
}

/** Worktree mode: merge in PRIMARY CLONE, then remove worktree */
class WorktreeMerger implements IWorkspaceMerger {
  constructor(private primaryClonePath: string) {}
  
  async merge(workspace: AgentWorkspace): Promise<MergeResult> {
    const primaryGit = simpleGit(this.primaryClonePath);
    await primaryGit.merge([workspace.branchName, "--no-ff"]);
    return { success: true, mergeCommit: (await primaryGit.log({ maxCount: 1 })).latest?.hash };
  }
  
  async cleanup(workspace: AgentWorkspace): Promise<void> {
    const primaryGit = simpleGit(this.primaryClonePath);
    await primaryGit.raw(["worktree", "remove", workspace.basePath, "--force"]);
  }
}
```

**WorkspaceManager changes:**
```typescript
private mergers = new Map<string, IWorkspaceMerger>();

createWorkspace(...) {
  if (useIsolation) {
    this.mergers.set(taskId, new WorktreeMerger(primaryClonePath));
  } else {
    this.mergers.set(taskId, new SharedMerger());
  }
}

async mergeAndCleanup(taskId: string) {
  const merger = this.mergers.get(taskId) || new SharedMerger();
  const result = await merger.merge(workspace);
  if (result.success) await merger.cleanup(workspace);
  return result;
}
```

**Removes:** `if (isIsolated)` branch in mergeAndCleanup.
**Files:** new IWorkspaceMerger.ts, WorkspaceManager.ts
```

### Issue 13: Separate Agent Completion from Infrastructure

**Problem:** `onWorkerDone` calls `pluginRegistry.onTaskComplete()` (publish + push + merge) BEFORE `taskStore.completeTask()`. If infrastructure fails → task never marked complete → dependents blocked → planner replans → wasted tokens.

**Current flow (GoalManager.onWorkerDone, L750-830):**
```
1. pluginRegistry.onTaskComplete()  ← CAN FAIL (push/merge)
2. taskStore.completeTask()         ← never reached if step 1 fails
```

**Long-term fix — invert the order:**
```typescript
async onWorkerDone(data) {
  // 1. Mark completed FIRST — agent work succeeded
  const newlyReady = this.taskStore.completeTask(taskId, output);
  // completeTask() resolves dependents internally → returns newly ready tasks
  
  // 2. Notify frontend
  this.callbacks.onTaskUpdate?.({ taskId, status: "completed" });
  
  // 3. Infrastructure — async, non-blocking
  this.pluginRegistry.onTaskComplete(taskId, goalId)
    .then(result => {
      if (!result.success) {
        log.warn(`Infrastructure failed for ${taskId}: ${result.error}`);
        // Future: emit workspace:warning Socket.IO event
      }
    })
    .catch(err => log.warn(`Infrastructure error: ${err.message}`));
  
  // 4. Check if all tasks done → goal complete
  this.checkGoalCompletion(goalId);
}
```

**What changes:**
- `taskStore.completeTask()` runs FIRST — always succeeds (no I/O)
- Dependents unblocked immediately (inside `completeTask()`)
- Infrastructure runs async, failures don't change task status
- Planner never sees infrastructure failures → no unnecessary replans

**Files:** GoalManager.ts (only)
```

### What lands on GitHub

```
origin/main                                         ← merged result of all tasks
origin/goal-{goalId}/task-task-1                    ← task 1 branch (pre-merge snapshot)
origin/goal-{goalId}/task-task-2                    ← task 2 branch
```

### Future (GitHub-specific): Auto-create PRs

> Pull requests are a GitHub feature, not git. The core push + merge flow is git-native
> and works with any remote. PR creation is an optional enhancement.

When PR flow replaces local merge: push branch only (no local merge), let PR + CI handle merging.

---

### Implementation Plan

**Phase 1: Unblock the flow (Issues 13, 11) — Ship first**

| Step | File | Change | Risk |
|------|------|--------|------|
| 1a | GoalManager.ts | Invert `onWorkerDone`: completeTask BEFORE onTaskComplete | Low — only changes call order |
| 1b | AgentWorkspace.ts | Rename `assertActive` → `assertWritable`, accept active + published | Low — broadens guard, no behavior removed |

Phase 1 unblocks push + merge without any structural changes. Can ship and test immediately.

**Phase 2: Worktree abstraction (Issues 8, 12) — Ship together**

| Step | File | Change | Risk |
|------|------|--------|------|
| 2a | New IWorkspaceGitOps.ts | Create interface + SharedGitOps + WorktreeGitOps | None — new file |
| 2b | AgentWorkspace.ts | Replace `skipGitInit` with `gitOps: IWorkspaceGitOps` delegation | Medium — touches initialize, _commitGitOps, revertToCommit |
| 2c | New IWorkspaceMerger.ts | Create interface + SharedMerger + WorktreeMerger | None — new file |
| 2d | WorkspaceManager.ts | Store merger per task, delegate in mergeAndCleanup | Medium — changes createWorkspace + mergeAndCleanup |

Phase 2 is structural. Test with: empty repo + non-empty repo, shared mode + isolated mode, single task + multi-task plan.

**Phase 3: Data integrity (Issues 9, 10) — Independent**

| Step | File | Change | Risk |
|------|------|--------|------|
| 3a | types.ts | Add `GoalConfig` interface | None — new type |
| 3b | TaskStore.ts | Replace `goalDefaults: Record` with `goalConfigs: Map<string, GoalConfig>` | Low — internal refactor |
| 3c | GoalManager.ts | Call `setGoalConfig()` instead of `setGoalDefaults()` | Low — same call site |

Phase 3 ensures all tasks inherit repoUrl via goalId lookup. Issue 10 auto-resolves.

**Dependency graph:**
```
Phase 1 (unblock)  ←  no dependencies, ship first
Phase 2 (abstraction)  ←  independent of Phase 1
Phase 3 (data)  ←  independent of Phase 1 and 2
```

All phases are independent — can be implemented and shipped in any order. Phase 1 is highest priority because it unblocks the runtime flow.

---

## Alternative Considered: Per-Task Clone (Rejected)

Researched how industry tools handle workspace isolation:

| Tool | Approach | Isolation |
|------|----------|-----------|
| **SWE-agent** (Princeton) | Docker container per task, full clone inside | Container-level |
| **Devin** (Cognition Labs) | Full VM snapshot per session | VM-level |
| **OpenHands** (All-Hands-AI) | Docker sandbox per task | Container-level |

None use worktrees — they all use container/VM isolation with full clones.

**Per-task `git clone --local`** was considered as an alternative: each task gets a full clone (fast via hardlinks), independent `.git` directory, simpler code. Would remove all `skipAutoInit`/`skipGitInit` flags.

**Why we're keeping worktrees:**
- Disk efficiency matters for local development (no Docker/VM overhead)
- The 3 remaining bugs are targeted fixes, not architectural rewrites
- Worktrees are already implemented and working for the main path
- Industry tools use containers because they're cloud-hosted — we're local-first
- The `skipAutoInit`/`skipGitInit` flags are small, well-understood workarounds

---

## Issue 9: Replanned Tasks Lose repoUrl

### Evidence

```
[WorkspacePlugin] prepareForTask: taskId=task-8, repoUrl=NONE, authToken=NONE
```

Task-8 was created by the planner's `replan` tool after task-1 failed. It falls back to shared mode (branch isolation, no worktree, no clone, no remote, no push).

### Root Cause

`replan` tool creates new tasks via `TaskStore.create()` directly — it does NOT go through `GoalManager.approvePlan()`. The `approvePlan` method injects `goal.repoUrl` into `task.context`, but `replan` doesn't.

**approvePlan path (works):**
```
GoalManager.approvePlan()
  → task.context.repoUrl = goal.repoUrl    ← injected from GoalContext
```

**replan path (broken):**
```
planMutationTools.replan()
  → TaskStore.create(newTask)              ← no repoUrl injection
  → task.context.repoUrl = undefined       ← lost
```

### Solution

The `replan` tool (and `add_tasks`, `reassign_task`) must inject `goal.repoUrl` into new tasks' context. Two options:

**Option A: Inject in the mutation tool itself**
Each plan mutation tool reads `goal.repoUrl` from GoalContext and includes it in new task context.

**Option B: Inject at TaskStore level**
`TaskStore.create()` accepts a default context that includes `repoUrl` — set once during `approvePlan`, applied to all future creates.

**Option B is better** — single place, covers all task creation paths (approvePlan, replan, add_tasks, reassign_task).

---

## Issue 10: Mixed Workspace Modes Within Same Goal

### Evidence

```
task-1: worktree mode (plan-plan-notes-api/task-task-1/)   ← clone + worktree
task-8: shared mode (branch in team repo)                   ← git init + branch
task-6: shared mode but sees clone dir as files             ← path confusion
```

### Root Cause

When task-1 has repoUrl → isolated mode (worktree). When task-8 has no repoUrl (from replan) → shared mode. Both coexist in the same team workspace, causing:
- Two different git repos for the same goal
- Files from clone visible to shared-mode tasks
- Push behavior differs per task

### Solution

Fix Issue 9 (inject repoUrl in all task creation paths) → all tasks in a goal use the same workspace mode. No mixing.

---

## Issue 11: `pushToRemote` Fails on Published Workspace

### Evidence (runtime logs)

```
[WorkspacePlugin] Push to remote failed for task task-1: 
  Workspace ws-task-1-moiypo9i is not active (status: published). 
  Use reactivate() or the workspace_reactivate tool to unlock it for further work.
```

### Root Cause

The `onTaskComplete` flow calls `pushToRemote()` AFTER `publish()`. The publish step sets `workspace.status = "published"`. Then `pushToRemote()` tries to commit remaining changes via `this.commit()`, but `commit()` calls `assertActive()` which rejects "published" status.

```
onTaskComplete()
  ├─ workspace.publish()        → status becomes "published"    ✅
  └─ workspace.pushToRemote()
       └─ this.commit()         → assertActive() rejects "published"  ❌
```

### Call chain

```
WorkspacePlugin.onTaskComplete (L177)
  → workspace.publish(goalId)           → status = "published"
  → workspace.pushToRemote()            → calls commit() → assertActive() → THROWS
```

`assertActive()` (L1245):
```typescript
if (this._status !== "active") {
  throw new Error(`Workspace ${this.id} is not active (status: ${this._status})...`);
}
```

`pushToRemote()` (L765) calls `this.commit("Task complete: final state")` which goes through `assertActive()`.

### Long-term Solution

**The workspace status machine needs a `completing` or `pushing` state.** The current states (`active → published → merged`) don't account for the push step between publish and merge.

**Proposed state machine:**
```
active → published → pushing → merged
                         ↓
                       failed
```

**Implementation:**

1. Add `pushing` to `WorkspaceStatus` type
2. `pushToRemote()` sets `status = "pushing"` before operations
3. `pushToRemote()` uses `_commitGitOps()` directly (bypasses `assertActive()`) for any remaining uncommitted changes
4. On success: status stays "pushing" (merge step follows)
5. On failure: status = "failed" or stays "published" (push is optional)

**Alternative (simpler):** Allow `commit()` to work in "published" status too — update `assertActive()` to accept both `active` and `published`. This is less clean but simpler:

```typescript
private assertWritable(): void {
  if (this._status !== "active" && this._status !== "published") {
    throw new Error(`Workspace ${this.id} is not writable (status: ${this._status})`);
  }
}
```

**Recommended:** The simpler alternative — rename `assertActive` to `assertWritable` and accept both `active` and `published`. The full state machine redesign is overkill for now.

---

## Issue 12: Worktree Merge Fails — Can't Checkout Main

### Evidence (runtime logs)

```
[00:01:41.268] ERROR: Merge failed for task task-1:
    module: "WorkspaceManager"
[00:01:41.269] ERROR: [GoalManager] Workspace merge failed: 
  workspace: merge: goal-build-a-rest-api-for-a-notes-app-with-auth-and-sea-vmftj8/task-task-1 
  - not something we can merge
```

### Root Cause

`mergeAndCleanup()` calls `workspace.merge()` which calls `gitManager.mergeBranch(branchName)`. `mergeBranch` starts with `this.checkout(targetBranch)` — checking out `main`. But in a worktree:

1. The worktree IS the task branch — it can't switch to main
2. Main is checked out in the **primary clone** (`plan-{planId}/repo/`)
3. Git prevents checking out a branch that's already checked out elsewhere

```
AgentWorkspace.merge() (L925)
  → gitManager.mergeBranch(branchName) 
    → checkout("main")                  ← FAILS: main is checked out in primary clone
    → git merge branchName --no-ff      ← never reached
```

### Long-term Solution

**Worktree merges must happen in the primary clone, not in the worktree.**

The merge flow for worktree workspaces should be:

```
Primary clone (plan-{planId}/repo/):
  $ git merge goal-{goalId}/task-{taskId} --no-ff    ← merge task branch into main
  $ git worktree remove plan-{planId}/task-{taskId}  ← clean up worktree
  $ git push origin main                              ← push merged result
```

**Implementation:**

1. `WorkspaceManager.mergeAndCleanup()` needs to detect worktree workspaces
2. For worktrees: use `simpleGit(primaryClonePath)` to do the merge from the primary clone
3. After merge: `git worktree remove <taskDir>` to clean up
4. For shared workspaces: existing `workspace.merge()` path unchanged

**Design:**
```typescript
// WorkspaceManager.mergeAndCleanup — detect workspace type
const isIsolated = workspace.basePath !== this.workspacesRoot;

if (isIsolated) {
  // Merge from primary clone (has main checked out)
  const planDir = path.dirname(workspace.basePath);
  const primaryClonePath = path.join(planDir, "repo");
  const primaryGit = simpleGit(primaryClonePath);
  
  await primaryGit.merge([workspace.branchName, "--no-ff"]);
  await primaryGit.raw(["worktree", "remove", workspace.basePath, "--force"]);
} else {
  // Standard shared merge
  await workspace.merge();
}
```

**Key decisions:**
- Merge happens in primary clone (where main is checked out)
- Worktree removed after merge (cleanup)
- Primary clone's push handles pushing main to remote
- `workspace.merge()` left unchanged (only used for shared mode)

---

## Issue 13: Infrastructure Failures Mark Agent Work as Failed

### Evidence (runtime logs)

```
[00:01:41.045] AiSdkAgent backend-task-1 stream complete: 617 parts, 797 chars    ← AGENT WORK SUCCEEDED
[WorkspacePlugin] Push to remote failed for task task-1: ...                        ← PUSH FAILED (Issue 11)
[00:01:41.268] ERROR: Merge failed for task task-1                                  ← MERGE FAILED (Issue 12)
[00:01:41.269] WARN: Task task-1 failed: Workspace merge failed                    ← TASK MARKED FAILED
[00:01:41.269] INFO: [DependencyFail] Awaiting planner decision for task-2          ← DEPENDENTS BLOCKED
[00:01:41.269] INFO: [DependencyFail] Awaiting planner decision for task-3
[00:01:41.269] INFO: [DependencyFail] Awaiting planner decision for task-4
...
[00:02:15.820] AiSdkAgent planner tool call: replan(...)                            ← PLANNER REPLANS
[00:02:15.823] onTaskReady: task-6 (backend)                                        ← NEW TASK DISPATCHED
[00:02:15.827] Initializing AiSdkAgent: backend-task-6                              ← AGENT RUNS AGAIN
```

### What Happened

1. Agent task-1 completed its work successfully (wrote SQL migrations, published 3 files)
2. `onTaskComplete` → `pushToRemote` failed (Issue 11: published status blocks commit)
3. `onTaskComplete` → `mergeAndCleanup` failed (Issue 12: can't checkout main in worktree)
4. GoalManager marks task-1 as **failed** because merge failed
5. Tasks 2, 3, 4 depend on task-1 → blocked
6. Planner detects failure → calls `replan` → discards tasks 2-5, creates tasks 6-10
7. Agent restarts from scratch on task-6, **redoing the same work** that task-1 already completed

### The Cost

- **Wasted LLM tokens**: task-1 used 10,476 tokens, agent work was successful
- **Wasted time**: ~30 seconds of agent execution thrown away
- **Duplicated effort**: task-6 does the same database schema work
- **No recovery**: task-1's output (SQL migrations) is lost because merge failed — files stay in the worktree but are inaccessible

### Root Cause

`onTaskComplete` in `GoalManager` treats ALL errors (including infrastructure failures) as task failures:

```typescript
// GoalManager — onTaskComplete
try {
  const result = await this.pluginRegistry.onTaskComplete(taskId, goalId);
  if (!result.success) {
    // Marks task as FAILED even though agent work succeeded
    this.taskStore.updateTaskStatus(taskId, "failed");
  }
} catch { ... }
```

Infrastructure operations (push, merge) are NOT part of the agent's work. They should not determine task success.

### Long-term Solution

**Separate agent completion from infrastructure operations.** Task status should reflect the agent's work, not git operations.

**Proposed completion flow:**
```
Agent done (complete_task called)
  ├─ Mark task "completed"                         ← agent work succeeded
  ├─ Resolve dependents                            ← unblock downstream tasks
  │
  └─ Infrastructure (async, best-effort):
      ├─ publish() → collect outputs
      ├─ pushToRemote() → push task branch
      ├─ mergeAndCleanup() → merge to main + push
      └─ On failure: log warning, emit Socket.IO event
           (task stays "completed", work is preserved)
```

**Implementation:**

1. **GoalManager.onWorkerDone**: Mark task "completed" BEFORE calling `pluginRegistry.onTaskComplete()`:
   ```typescript
   onWorkerDone(taskId: string, output: string): void {
     // 1. Mark completed FIRST — agent work succeeded
     this.taskStore.updateTaskStatus(taskId, "completed");
     this.taskStore.setOutput(taskId, output);
     
     // 2. Infrastructure operations (async, non-blocking)
     this.pluginRegistry.onTaskComplete(taskId, goalId)
       .then(result => {
         if (!result.success) {
           log.warn(`Infrastructure failed for ${taskId}: ${result.error}`);
           // Emit event to frontend: "push failed" notification
           this.callbacks.onTaskUpdate?.({
             taskId, status: "completed", 
             warning: `Git push/merge failed: ${result.error}`
           });
         }
       })
       .catch(err => log.warn(`Infrastructure error for ${taskId}: ${err.message}`));
     
     // 3. Resolve dependents immediately
     this.resolveDependents(taskId);
   }
   ```

2. **Socket.IO event for infrastructure failures**: New `workspace:warning` event so frontend can show "Task completed but push failed" notification.

3. **Retry mechanism**: Failed pushes/merges can be retried independently without re-running the agent.

**Why this is better:**
- Agent work is never thrown away
- Dependents unblock immediately (no cascade failure)
- Planner doesn't waste tokens replanning for infrastructure bugs
- Push/merge can be retried without agent re-execution
- Frontend shows accurate status: "completed" with optional warning

---

## Issue 14: 429 Rate Limiting Cascade — No Global Concurrency Control

### Evidence (from runtime logs)

```
[01:21:14] Created worker: task-2 (backend)   ← 2 workers running
[01:21:24] Created worker: task-3 (backend)   ← 3 workers running (+ planner = 4 LLM calls)
[01:22:24] AI_RetryError: Failed after 6 attempts. Last error: Too Many Requests  ← task-3
[01:22:44] add_tasks → task-6 dispatched          ← planner adds MORE tasks
[01:22:57] replan → task-7 dispatched             ← planner replans, MORE tasks
[01:23:11] AI_RetryError: Too Many Requests       ← task-3 retry also 429
[01:23:37] AI_RetryError: Too Many Requests       ← planner itself 429
... spiral continues from 5 tasks → 39+ tasks
```

### Root Cause

**Three compounding failures:**

1. **No global concurrency control** — 3 workers + planner = 4+ concurrent LLM calls against a single Azure OpenAI deployment with TPM/RPM limits.

2. **AI SDK retry thundering herd** — AI SDK `maxRetries: 2` (default) retries with exponential backoff per-request. But when ALL agents retry simultaneously, backoff is useless — they all hit the same rate window.

3. **Planner death spiral** — Planner sees 429 as task failure → calls `replan` → creates NEW tasks → more LLM calls → more 429s → more replans → 5 tasks became 39.

### Research: How Azure OpenAI Rate Limiting Works

From [Azure docs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/quota):

- Rate limits are **TPM (Tokens Per Minute)** and **RPM (Requests Per Minute)**
- RPM is evaluated over **1 or 10 second windows** — not full minutes
- For most models: 6 RPM per 1,000 TPM (e.g., 60K TPM = 360 RPM = 6 RPS)
- 429 response includes `Retry-After` header with seconds to wait
- Rate limiting uses **estimated** max tokens (includes `max_tokens` parameter), not actual usage

### Research: How AI SDK Handles Retries

From [AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/settings):

- `maxRetries: 2` (default) — total 3 attempts per `streamText`/`generateText` call
- Uses exponential backoff internally (1s, 2s, 4s...)
- Does NOT read `Retry-After` header
- Does NOT coordinate across multiple concurrent calls
- Each `streamText` call retries independently — no global awareness

### Long-term Solution

**Three-layer approach:**

**Layer 1: AI SDK Middleware — rate-aware retry**

AI SDK v6 supports `Language Model Middleware` — wrap the model to read `Retry-After` headers and coordinate retries:

```typescript
import { wrapLanguageModel } from "ai";

function rateLimitedModel(model: LanguageModel, throttle: LlmThrottle) {
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => {
        await throttle.acquire();
        return params;
      },
      wrapGenerate: async ({ doGenerate }) => {
        try {
          return await doGenerate();
        } catch (err) {
          if (err.statusCode === 429) {
            const retryAfter = parseInt(err.responseHeaders?.["retry-after"] || "10");
            throttle.onRateLimited(retryAfter);
          }
          throw err;
        } finally {
          throttle.release();
        }
      },
    },
  });
}
```

**Layer 2: Global semaphore — limit concurrent LLM calls**

```typescript
class LlmThrottle {
  private queue: Array<{ resolve: () => void }> = [];
  private active = 0;
  private retryAfter = 0;

  constructor(private maxConcurrent = 2) {}

  async acquire(): Promise<void> {
    // Respect Retry-After from ANY previous 429
    const wait = this.retryAfter - Date.now();
    if (wait > 0) await delay(wait);

    if (this.active >= this.maxConcurrent) {
      await new Promise<void>(r => this.queue.push({ resolve: r }));
    }
    this.active++;
  }

  release(): void {
    this.active--;
    this.queue.shift()?.resolve();
  }

  onRateLimited(retryAfterSeconds: number): void {
    this.retryAfter = Date.now() + retryAfterSeconds * 1000;
  }
}
```

**Layer 3: Don't tell planner about rate limit failures**

The codebase already has error classification in `classifyError()` (workerTypes.ts L51-99):
```typescript
// Already exists — detects rate_limit
if (lowerMsg.includes("rate limit") || lowerMsg.includes("429") || lowerMsg.includes("too many requests")) {
  errorCategory = "rate_limit";
  retriable = true;
}
```

And DispatchManager already retries with exponential backoff (L136-177):
```typescript
// Already exists — 10s → 20s → 40s → 60s backoff
const backoffMs = Math.min(10_000 * Math.pow(2, attempt - 1), 60_000);
```

**What's missing:** When all 3 retry attempts fail (rate_limit), `GoalManager.onTaskFailed()` notifies the planner via `onNotifyPlanner()`. The planner sees "task failed" and replans — creating MORE tasks that also hit 429.

**Fix: Don't notify planner for rate_limit failures. Instead, keep retrying with longer backoff or pause all dispatches:**

```typescript
// GoalManager.onTaskFailed — check error category
onTaskFailed({ taskId, error, errorCategory }: TaskFailure): void {
  if (errorCategory === "rate_limit") {
    // Don't tell planner — this is infrastructure, not a task problem
    log.warn(`Task ${taskId} rate limited after all retries — will retry when rate clears`);
    // Re-queue for later dispatch (after global cooldown)
    this.taskStore.updateStatus(taskId, "ready"); // back to ready
    return;
  }
  
  // Only notify planner for real task failures
  this.callbacks.onNotifyPlanner(/* failure template */);
}
```

**Also: DispatchManager should reduce `maxConcurrent` on sustained 429s:**
```typescript
// DispatchManager — adaptive concurrency
if (consecutiveRateLimitFailures >= 2) {
  this.maxConcurrent = Math.max(1, this.maxConcurrent - 1);
  log.warn(`Reducing concurrency to ${this.maxConcurrent} due to rate limiting`);
}
```

**Existing infrastructure to leverage:**
- `classifyError()` in workerTypes.ts — already classifies 429
- `DispatchManager.handleError()` — already has retry with backoff
- `MAX_CONCURRENT_DISPATCHES = 2` in OrchestratorService — already limits dispatch

**Files:** GoalManager.ts (skip planner notification for rate_limit), DispatchManager.ts (adaptive concurrency), optionally ModelProvider.ts (wrap model with semaphore)

---

## Issue 15: goalId Missing on Replanned/Added Tasks → repoUrl=NONE

### Evidence

```
[01:13:33] Goal config set for build-a-...: repoUrl=https://github.com/nitrroshan/pingtemp1.git  ✅
[01:22:44] add_tasks → task-6
[WorkspacePlugin] prepareForTask: taskId=task-6, repoUrl=NONE   ❌
   WARN: No ChatAgent for role 'backend' goal 'undefined', dispatching directly  ❌
[01:22:57] replan → task-7
[WorkspacePlugin] prepareForTask: taskId=task-7, repoUrl=NONE   ❌
   WARN: No ChatAgent for role 'backend' goal 'undefined', dispatching directly  ❌
```

### Root Cause (researched — full trace)

The goalId chain breaks between planner tools and plan mutation tools:

```
✅ GoalManager.executePlannerTurn(goalId)
  → creates PlannerAgent with OrchestratorContext { currentGoalId: goalId }
    → tools/index.ts: passes octx to createSubmitPlanTool ✅ (uses octx.currentGoalId)
    → tools/index.ts: creates PlanMutationContext for mutation tools
       ❌ PlanMutationContext does NOT include currentGoalId
         → normalizeAndAddTasks creates tasks WITHOUT goalId
```

**Exact break point — tools/index.ts L54-59:**
```typescript
// Plan mutation context — goalId NOT passed
const mutCtx: PlanMutationContext = {
  tasks: octx.taskStore,
  dagResolver: octx.dagResolver,
  availableRoles: octx.teamRoles,
  // currentGoalId: ← MISSING
};
```

**Cascade of failures from missing goalId:**
1. `TaskStore.create()` → `GoalConfig` lookup by `task.goalId` returns nothing → no repoUrl
2. `WorkspacePlugin.prepareForTask()` → `repoUrl=NONE` → shared mode instead of worktree
3. `AgentManagerV2.chatAgentDispatch()` → `task?.goalId` is undefined → `getChatAgent()` returns null → `directDispatchTask()` bypasses ChatAgent → no concurrency control, no user approval
4. `SocketServerV2.onStream` → `streamGoalId` undefined → message save may fail → stream parts lost on reload

**This single missing field causes Issues 15, 19, and 20.**

### Long-term Solution

**Thread goalId through PlanMutationContext — 3 files, 3 changes:**

**1. Add `currentGoalId` to PlanMutationContext interface (non-nullable):**
```typescript
// planMutationTools.ts L97
export interface PlanMutationContext {
  tasks: ITaskProvider;
  dagResolver: DependencyResolver;
  availableRoles: string[];
  currentGoalId: string;  // ← ADD (not nullable — planner always has a goal)
  onMutation?: (event: { type: string; data: any }) => void;
}
```

**2. Pass goalId when creating mutation context:**
```typescript
// tools/index.ts L54-59 — pass octx.currentGoalId
const mutCtx: PlanMutationContext = {
  tasks: octx.taskStore,
  dagResolver: octx.dagResolver,
  availableRoles: octx.teamRoles,
  currentGoalId: octx.currentGoalId!,  // ← ADD (non-null: planner only runs with a goal)
};
```

**3. Inject goalId into every task created by normalizeAndAddTasks:**
```typescript
// planMutationTools.ts L185 — inside normalizeAndAddTasks
ctx.tasks.addTask({
  id: normalizedId,
  title: task.title,
  // ...
  goalId: ctx.currentGoalId,  // ← ADD (always a string, never null/undefined)
  // ...
});
```

**Why this is a proper fix (not a patch):**
- `goalId` flows through the same typed context as other planner state (roles, DAG resolver, task store)
- Every tool that creates tasks has access to `currentGoalId` — no implicit global state
- `GoalConfig` lookup works because `task.goalId` is always set
- ChatAgent dispatch works because `task?.goalId` is always set
- Stream persistence works because `goalId` propagates to message accumulator

**Files:** planMutationTools.ts (interface + injection), tools/index.ts (pass through)

---

## Issue 16: Auth Token Not Resolved → Push Unauthenticated

### Evidence

```
[WorkspacePlugin] prepareForTask: taskId=task-1, repoUrl=https://..., authToken=NONE
```

GitHub push requires authentication, but `authToken=NONE`.

### Root Cause

`authTokenResolver` queries MongoDB for the user's GitHub OAuth `accessToken`:

```typescript
// SocketServerV2.ts L1026-1035
const account = await mongoose.connection.db
  ?.collection("account")
  .findOne({ userId, providerId: "github" });
return (account as any)?.accessToken || null;
```

Returns `null` if:
1. User hasn't linked GitHub via OAuth (no account record)
2. `accessToken` field is named differently in better-auth schema
3. MongoDB connection lost during lookup
4. Token expired and not refreshed

### Long-term Solution

1. **Verify the better-auth schema** — check what field better-auth stores the GitHub OAuth token in. It might be `access_token` not `accessToken`:
   ```bash
   # Check the actual schema
   mongosh --eval 'db.account.findOne({providerId: "github"})'
   ```

2. **Frontend validation** — before showing the repo picker, verify the user has a valid GitHub OAuth connection. Show "Connect GitHub" prompt if not.

3. **Fail fast on missing token** — if `authTokenResolver` returns null and `repoUrl` is set, warn the user immediately instead of silently proceeding:
   ```typescript
   if (taskRepoUrl && !authToken) {
     log.warn(`No GitHub auth token for task ${taskId} — push will fail`);
     // Emit Socket.IO warning to frontend
   }
   ```

**Files:** SocketServerV2.ts (check field name), frontend RepoPicker (validate auth), WorkerPool.ts (fail-fast warning)

---

## Issue 17: No Log Files for Debugging

### Evidence

All logs go to stdout. When issues occur, the only way to debug is to copy from terminal. No structured log files, no session separation, no persistent history.

### Current Logging Architecture

All 3 packages use identical pino setup:
- `packages/backend/logging/index.ts` — rootLogger for backend
- `packages/agent-manager/src/logging.ts` — rootLogger for agent-manager
- `packages/workspace/src/logging.ts` — rootLogger for workspace

Configuration:
- Dev: `pino-pretty` to stdout (colorized, `HH:MM:ss.l` timestamps)
- Production: JSON to stdout (no file transport)
- Level: `process.env.LOG_LEVEL || "info"`
- Child loggers: `rootLogger.child({ module: "ModuleName" })`
- No file output, no session grouping, no goal/task context

### Long-term Solution: Two Log Streams (Startup + Session)

**Startup logs** — server lifecycle, plugin registration, configuration. Written at startup, rarely changes.

**Session logs** — per-goal execution, grouped by goalId. Each goal gets its own log file for easy debugging.

**Implementation using pino multi-transport:**

```typescript
// packages/backend/logging/index.ts (updated)
import pino from "pino";
import path from "path";

const LOG_DIR = process.env.LOG_DIR || "./data/logs";

const transports = pino.transport({
  targets: [
    // 1. Console (existing — pretty in dev, JSON in prod)
    {
      target: process.env.NODE_ENV === "production" ? "pino/file" : "pino-pretty",
      options: process.env.NODE_ENV === "production"
        ? { destination: 1 }  // stdout
        : { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
      level: process.env.LOG_LEVEL || "info",
    },
    // 2. Startup log file (new — all logs, append mode)
    {
      target: "pino/file",
      options: { destination: path.join(LOG_DIR, "startup.log"), mkdir: true },
      level: "info",
    },
  ],
});

export const rootLogger = pino(transports);
```

**Per-goal session logger:**

```typescript
// Create when goal starts, close when goal completes
function createSessionLogger(goalId: string): pino.Logger {
  const sessionFile = path.join(LOG_DIR, "sessions", `${goalId}.log`);
  const dest = pino.destination({ dest: sessionFile, mkdir: true, sync: false });
  return pino({ level: "debug" }, dest);  // debug level for full context
}

// GoalManager.executePlannerTurn — create session logger
const sessionLogger = createSessionLogger(goalId);
sessionLogger.info({ goalId, teamId }, "Goal session started");

// Attach to all child operations
const workerLogger = sessionLogger.child({ taskId, role });
workerLogger.info("Worker dispatched");
```

**Log structure:**
```
data/logs/
  ├── startup.log                              ← server lifecycle, always appended
  └── sessions/
      ├── build-a-rest-api-vmftj8.log          ← all events for this goal
      ├── fix-login-bug-abc123.log             ← another goal
      └── ...
```

**Session log format (JSON, one per line):**
```json
{"level":"info","time":1714360399000,"goalId":"build-...","taskId":"task-1","module":"AiSdkAgent","msg":"tool call: workspace_create_file"}
{"level":"info","time":1714360400000,"goalId":"build-...","taskId":"task-1","module":"WorkspaceManager","msg":"Created worktree at ..."}
{"level":"warn","time":1714360401000,"goalId":"build-...","taskId":"task-2","module":"DispatchManager","msg":"Rate limited, retrying in 10s"}
```

**Debugging workflow:**
```bash
# View all events for a specific goal
cat data/logs/sessions/build-a-rest-api-vmftj8.log | jq .

# Filter by task
cat data/logs/sessions/build-a-rest-api-vmftj8.log | jq 'select(.taskId == "task-1")'

# Filter errors only
cat data/logs/sessions/build-a-rest-api-vmftj8.log | jq 'select(.level >= 40)'

# View startup issues
cat data/logs/startup.log | jq 'select(.module == "PluginRegistry")'
```

**Key decisions:**
- `startup.log` — info level, always appended, survives restarts
- `sessions/{goalId}.log` — debug level, one file per goal, full execution trace
- JSON format for both (searchable with `jq`)
- `pino.destination({ sync: false })` — non-blocking writes (performance)
- Session logger is a separate pino instance (not transport) to avoid mixing with startup

**Files:** `packages/backend/logging/index.ts` (add file transport), GoalManager.ts (create session logger), WorkerPool.ts (pass logger to workers)

---

## Issue 18: Worktree Created at Wrong Path — Root Cause of All Post-Task-1 Failures

### Evidence (from disk inspection)

```bash
# Primary clone's git worktree list shows NESTED paths inside repo/:
$ git worktree list (from repo/)
.../plan-plan-notes-api/repo                                        [main]
.../plan-plan-notes-api/repo/data/workspaces/.../task-task-2         [task-task-2]  ← WRONG
.../plan-plan-notes-api/repo/data/workspaces/.../task-task-3         [task-task-3]  ← WRONG

# The actual task directories are NOT worktrees — no .git file:
$ file .../plan-plan-notes-api/task-task-1/.git
cannot open (No such file or directory)   ← NOT A WORKTREE

# task-task-1 commits went to the team workspace repo (parent .git), not the clone:
$ cd task-task-1 && git log --oneline -3
9aad5d9 (HEAD -> .../task-task-53) Initialize workspace for task task-53  ← SHARED REPO
de73159 (main) Auto-commit: clean working tree before branch switch

# Primary clone shows NO merges — all branches at seed commit:
$ cd repo && git branch -v
* main        1372770 Initial commit   ← NO MERGES EVER HAPPENED
  task-task-1 1372770 Initial commit   ← SAME COMMIT AS MAIN
```

### Root Cause: Complete Path Trace

The path chain from config to `git worktree add`:

```
1. AgentManagerRegistry.ts L126-129:
   workspaceDir = process.env.WORKSPACE_BASE_DIR || "./data/workspaces"
   teamRepoPath = `${workspaceDir}/${teamId}`
   → "./data/workspaces/1efcca47..."  (RELATIVE)

2. WorkspacePlugin.ts L100:
   new L1WorkspacePlugin({ repoPath: teamRepoPath })

3. L1WorkspacePlugin.ts L25:
   new WorkspaceManager(config)

4. WorkspaceManager.ts L63:
   this.workspacesRoot = config.repoPath   ← NO path.resolve()
   → "./data/workspaces/1efcca47..."  (STILL RELATIVE)

5. WorkspaceManager.ts L118-119:
   planDir = path.join(this.workspacesRoot, "plan-plan-notes-api")
   taskDir = path.join(planDir, "task-task-1")
   → "data/workspaces/1efcca47.../plan-plan-notes-api/task-task-1"  (RELATIVE)

6. WorkspaceManager.ts L155:
   repoGit.raw(["worktree", "add", taskDir, "-b", branchName])
   → git worktree add "data/workspaces/.../task-task-1" -b task-1
```

**The break point:** `git worktree add` at step 6 receives a **relative path**. Git resolves relative paths from the **repository root** (which is `plan-plan-notes-api/repo/`), NOT from the process working directory. So git creates the worktree at:

```
repo/data/workspaces/.../plan-plan-notes-api/task-task-1/    ← DEEPLY NESTED INSIDE REPO
```

Instead of:
```
plan-plan-notes-api/task-task-1/                              ← INTENDED SIBLING
```

**Consequence cascade:**
1. Worktree created at wrong path (nested inside `repo/`)
2. `task-task-1/` directory exists but has NO `.git` file — not a worktree
3. `GitBranchManager(taskDir, ..., {skipAutoInit: true})` correctly skips `git init`
4. Without `.git` file or directory, git walks UP to find the nearest `.git` → team workspace
5. Agent commits go to the **team workspace repo**, not the primary clone
6. Primary clone's task branch has no commits → merge is "Already up to date"
7. Subsequent worktrees branch from unchanged `main` → no upstream files
8. task-2, task-3 can't find task-1's files → report blocked → fail

**This single bug caused ALL downstream task failures.**

### Research: How `git worktree add` Resolves Paths

From [git-worktree docs](https://git-scm.com/docs/git-worktree):
> If `<path>` is a relative path, the worktree is stored relative to the repository root, not the current working directory.

Verified locally:
```bash
$ cd /tmp && mkdir test && cd test && git init repo && cd repo
$ echo "test" > file.txt && git add -A && git commit -m "init"

# Relative path → resolved from repo root
$ git worktree add relative/path -b test1
# Creates: repo/relative/path/  ← INSIDE repo

# Absolute path → resolved correctly
$ git worktree add /tmp/test/sibling -b test2
# Creates: /tmp/test/sibling/   ← SIBLING of repo ✅
```

### Why `WorkspaceConfig.repoPath` Is Documented as "Absolute" But Isn't

The type definition says:
```typescript
export interface WorkspaceConfig {
  /** Absolute path to the repository/workspace root */
  repoPath: string;  // ← JSDoc says "Absolute" but no enforcement
}
```

But `AgentManagerRegistry.ts` passes `"./data/workspaces/{teamId}"` — a relative path. No validation, no error.

### Long-term Solution

**Resolve `workspacesRoot` to absolute at the constructor boundary.** This is the standard Node.js pattern (Express `static()`, webpack `resolve.root`, Vite `root`).

```typescript
// WorkspaceManager.ts constructor
constructor(config: WorkspaceConfig) {
  this.config = config;
  this.workspacesRoot = path.resolve(config.repoPath);  // ← ONE LINE CHANGE
  this.gitManager = new GitBranchManager(this.workspacesRoot, config.defaultBranch || "main");
  logger.info(`WorkspaceManager created at: ${this.workspacesRoot}`);
}
```

**Why this is the correct fix:**

1. `path.resolve("./data/workspaces/team-123")` → `/Users/.../refer-backendjs/packages/backend/data/workspaces/team-123`
2. All `path.join(this.workspacesRoot, ...)` calls automatically produce absolute paths
3. `git worktree add /absolute/path/task-task-1 -b branch` → creates worktree at correct location
4. No changes needed anywhere else — all downstream code uses `path.join(this.workspacesRoot, ...)`
5. The `GitBranchManager` constructor and `AgentWorkspace.basePath` also get absolute paths automatically

**Also resolve at the config source:**
```typescript
// AgentManagerRegistry.ts L126
const workspaceDir = path.resolve(process.env.WORKSPACE_BASE_DIR || "./data/workspaces");
```

**Test plan:**
1. Clean old workspace data: `rm -rf packages/backend/data/workspaces/*/plan-*`
2. Start backend, submit goal with repo
3. Verify: `file .../task-task-1/.git` shows "ASCII text" (worktree link file)
4. Verify: `cat .../task-task-1/.git` shows `gitdir: .../repo/.git/worktrees/...`
5. Verify: `cd task-task-1 && git log` shows commits on the task branch (not shared repo)
6. Verify: after task-1 complete + merge, task-2's worktree has task-1's files

**Files changed:** WorkspaceManager.ts constructor (1 line), optionally AgentManagerRegistry.ts (1 line)

---

## Issue 19: Tasks Run Autonomously in Background — Frontend Has No Visibility

### Evidence (from runtime logs)

```
[01:13:49] onTaskReady: task-1 (backend)                              ← plan approved, task ready
... 2 minutes pass, user must manually click dispatch ...
[01:15:40] [backend] Dispatching worker for task-1 (1/2 active)       ← user clicked dispatch
[01:16:37] Worker done: task-1, onTaskReady: task-2, task-3           ← dependents unblocked
... 5 minutes pass, user clicks again ...
[01:21:14] [backend] Dispatching worker for task-2 (1/2 active)       ← user clicked

THEN — planner creates new tasks that bypass ChatAgent entirely:
[01:22:44] add_tasks → task-6
   WARN: No ChatAgent for role 'backend' goal 'undefined', dispatching directly  ← NO USER CONTROL
[01:22:57] replan → task-7
   WARN: No ChatAgent for role 'backend' goal 'undefined', dispatching directly  ← NO USER CONTROL
[01:29:20] add_tasks → task-13
   WARN: No ChatAgent for role 'backend' goal 'undefined', dispatching directly
[01:31:43] replan → task-14, task-15
   WARN: No ChatAgent for role 'backend' goal 'undefined', dispatching directly
... continued to task-40+ all running autonomously
```

### Root Cause: Two Separate Issues

**Issue 19a: Tasks from `add_tasks`/`replan` have no goalId → bypass ChatAgent**

The ChatAgent dispatch lookup:
```typescript
// AgentManagerV2.ts L435-440
const task = this.taskStoreInstance?.get(taskId);
const gid = task?.goalId;
const chatAgent = gid ? this.getChatAgent(role, gid) : null;
if (chatAgent) {
  await chatAgent.handleTask(taskId, role);  // ← ChatAgent controls dispatch
} else {
  // goalId undefined → falls through here
  await this.orchestrator!.directDispatchTask(taskId, role);  // ← runs immediately, no user control
}
```

`task.goalId` is `undefined` for tasks created by `add_tasks`/`replan` (Issue 15). So `getChatAgent()` returns `null` → `directDispatchTask` runs the agent immediately → no concurrency limit, no user approval, no frontend notification.

This is the same root cause as Issue 15 (missing goalId), but the consequence is different: instead of wrong workspace mode, it causes loss of user control over execution.

**Issue 19b: No frontend events for background task lifecycle**

When tasks run via `directDispatchTask`:
- No `task:dispatched` event to frontend
- No `task:started` event
- No stream routing to any chat panel (agent has no ChatAgent)
- Task appears in the plan sidebar but status updates may not arrive
- If the task fails, the frontend learns only when the planner calls `get_status`

### What the User Sees

1. Submit goal → plan appears with 5 tasks
2. Task-1 shows "ready" → user clicks to start → watches agent work → completes ✅
3. Tasks 2-3 become ready → user clicks one
4. **Meanwhile, planner silently creates tasks 6-40 in the background**
5. Tasks 6-40 run, fail (429), get retried, fail again — **user sees nothing**
6. Eventually frontend shows a mess of failed tasks in the sidebar with no context

### Long-term Solution (researched — based on actual code)

**Primary fix: Issue 15 (goalId) solves 19a automatically.**

When `goalId` is present on tasks from `add_tasks`/`replan`, the ChatAgent dispatch path at AgentManagerV2.ts L435-440 works:
```typescript
const gid = task?.goalId;           // Now has value from Issue 15 fix
const chatAgent = gid ? this.getChatAgent(role, gid) : null;  // Finds ChatAgent
if (chatAgent) {
  await chatAgent.handleTask(taskId, role);  // ← ChatAgent controls dispatch
}
```

ChatAgent (ChatAgent.ts L338+) provides:
- Per-role concurrency: `maxConcurrentWorkers = 2` (L49)
- Queue for excess tasks (L52): `private queue: Array<{taskId, role}>`
- Mode support: `'auto' | 'review' | 'manual'` (L53)
- Worker lifecycle tracking (L55): `private active = new Set<string>()`

**What ChatAgent does vs directDispatch:**

| Feature | ChatAgent.handleTask() | directDispatchTask() |
|---------|----------------------|------------------|
| Concurrency | ✅ maxConcurrentWorkers=2 | ❌ unlimited |
| Queue | ✅ defers excess tasks | ❌ runs immediately |
| User approval | ✅ manual mode waits | ❌ none |
| Frontend events | ✅ managed dispatch | ❌ silent |

**Additional fixes needed for 19b (frontend visibility):**

**1. `directDispatchTask` should be removed or made ChatAgent-only.**

If goalId is always present (Issue 15 fix), `directDispatchTask` is never called for goal tasks. Make it explicit:

```typescript
// AgentManagerV2.ts L435-440 — fail instead of fallback
const chatAgent = gid ? this.getChatAgent(role, gid) : null;
if (chatAgent) {
  await chatAgent.handleTask(taskId, role);
} else {
  // Instead of silent fallback:
  log.error(`No ChatAgent for task ${taskId} (goalId=${gid}) — cannot dispatch`);
  throw new Error(`Task ${taskId} has no goalId — cannot route to ChatAgent`);
}
```

**2. Socket.IO events for task lifecycle — use existing `onTaskUpdate` callback:**

The `callbacks.onTaskUpdate` already exists in GoalManager. Wire it to emit more granular events:
```typescript
// SocketServerV2 — extend existing task update handler
callbacks.onTaskUpdate = ({ taskId, status, ...rest }) => {
  socket.to(goalRoom).emit("task:update", { taskId, status, ...rest });
};
```

Frontend already listens to task updates via orchestration store. Adding `source: "replan"` to the event payload tells the UI where the task came from.

**Files:** planMutationTools.ts (goalId — Issue 15), AgentManagerV2.ts (remove directDispatch fallback), SocketServerV2.ts (extend task events)

---

## Issue 20: Tool Usage Logs Lost on Page Reload

### Evidence

1. Agent runs, user sees tool cards (workspace_create_file, collab, workspace_commit, etc.)
2. User refreshes browser
3. Tool cards disappear — only text content survives
4. Log shows: `[01:16:37.235] WARN: [SocketServerV2] Failed to save assistant message:` — stream parts not persisted

### How Stream Parts Flow

```
1. Agent calls tool → AiSdkAgent yields stream_part events
2. SocketServerV2 accumulates parts in messageAccumulator Map:
   - text-delta → acc.text
   - tool-call, tool-result, tool-input, tool-output → acc.parts[]
   - reasoning-delta → acc.parts[]
3. On "finish" event → saves to MongoDB:
   { content: acc.text, streamParts: JSON.stringify(acc.parts) }
4. Frontend chatStore caches to localStorage with streamParts

5. On reload:
   - localStorage: has messages WITH streamParts (if persist ran before reload)
   - restoreFromServer: fetches from MongoDB WITH streamParts (if save succeeded)
   - StreamMessage component renders tool cards from streamParts
```

### Root Cause (researched — 3 failure points)

**20a: Backend save fails — likely caused by Issue 15 (missing goalId)**

The `addMessage` call in SocketServerV2.ts L500-520 uses:
```typescript
goalId: streamGoalId || manager.getCurrentGoalId() || undefined,
```

For tasks dispatched via `directDispatchTask` (no ChatAgent, no goalId), `streamGoalId` and `getCurrentGoalId()` may both be undefined. The save itself doesn't fail on missing goalId (it's optional in the schema), but the log shows it IS failing. Most likely cause: `userId` from `getOwner(teamId)` returns null (async resolution race), or `agentId` is undefined for background-dispatched tasks.

The MongoDB schema (ChatMessageSchema.ts) requires:
- `teamId`: string (required)
- `agentId`: string (required)
- `userId`: string (required)
- `role`: enum ["user", "assistant", "system"] (required)
- `content`: string (required)
- `streamParts`: string (optional, stored as JSON)

**20b: localStorage 500ms debounce**

Reload within 500ms window loses unsaved messages. Standard browser problem.

**20c: 50-message cap drops old tool-heavy messages**

`capHistories` keeps last 50 messages per chat key. Agents with many tool calls fill this quickly.

### Long-term Solution (researched — based on actual persistence chain)

**Primary fix: Issue 15 (goalId) makes backend save reliable.**

With goalId present:
1. Tasks route through ChatAgent → `agentId` always set correctly
2. Stream events have `streamGoalId` → messages save with proper context
3. `restoreFromServer` queries by goalId → returns messages WITH streamParts

**The restore chain already works** (chatStore.ts L502-570):
```typescript
// restoreFromServer already parses streamParts
streamParts: m.streamParts ? JSON.parse(m.streamParts) : undefined,
```

And the backend restore endpoint (HttpServer.ts L423-500) already returns messages with `streamParts` from MongoDB. The pipeline is complete — the only break is the save failure.

**Additional fix: `beforeunload` flush for localStorage safety:**

```typescript
// chatStore.ts — register alongside the debounced persist
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const capped = capHistories(useChatStore.getState().chatHistories, 50);
    localStorage.setItem('ping:chatHistories', JSON.stringify(capped));
    localStorage.setItem('ping:chatHistories:ts', String(Date.now()));
  });
}
```

**Additional fix: Make backend save more resilient:**

```typescript
// SocketServerV2.ts — on "finish" event (L500-520)
// Change from .catch(warn) to await + retry
try {
  await this.services.chat.addMessage({
    teamId,
    userId: await this.services.teamRegistry?.getOwner(teamId) ?? "system",
    role: "assistant",
    agentId: acc.agentId || "unknown",  // never undefined
    goalId: streamGoalId || manager.getCurrentGoalId() || undefined,
    content: acc.text || " ",  // never empty
    streamParts: acc.parts.length > 0 ? JSON.stringify(acc.parts) : undefined,
    timestamp: new Date().toISOString(),
  });
} catch (err) {
  logger.error({ err, taskId, agentId: acc.agentId }, "Failed to save message — retrying");
  // Single retry after 500ms
  setTimeout(() => {
    this.services.chat.addMessage({ /* same params */ }).catch(() => {});
  }, 500);
}
```

**Files:** chatStore.ts (beforeunload flush), SocketServerV2.ts (resilient save), planMutationTools.ts (goalId — Issue 15)

---

## Issue 21: Stale Team ID in localStorage → "Team not found" on Load

### Evidence

```
[Error] [AgentServiceV2] Error: "Team meta-agent not found — no plugin maps to this ID"
```

After clearing `localStorage.removeItem('ping:ui')`, the error persists because there's a SEPARATE `ping:activeTeamId` key that wasn't cleared.

### Root Cause

Team selection is persisted in TWO places:
1. `ping:ui` — uiStore Zustand persist (only stores `theme` and `viewMode`, NOT `selectedTeamId`)
2. `ping:activeTeamId` — raw `localStorage.setItem` in App.tsx L232

On startup, App.tsx L102 reads `ping:activeTeamId` → gets stale team ID → connects to non-existent team → error.

### Long-term Solution

**Move team persistence to uiStore's Zustand persist middleware** — single source of truth:

```typescript
// uiStore.ts — add selectedTeamId to partialize
partialize: (state) => ({
  theme: state.theme,
  viewMode: state.viewMode,
  selectedTeamId: state.selectedTeamId,  // ← ADD
}),
```

Remove raw `localStorage.getItem/setItem('ping:activeTeamId')` calls from App.tsx (L102, L232, L266).

**Also needed:** Auto-select first team when no team is selected:
```typescript
// App.tsx — after loadTeams
if (!selectedTeamId && teams.length > 0) {
  setSelectedTeamId(teams[0].id);
}
```

**Files:** uiStore.ts (add selectedTeamId to persist), App.tsx (remove raw localStorage, add auto-select)

---

## Issue 22: Frontend Storage Architecture — localStorage vs sessionStorage

### Evidence

1. Clearing `localStorage.removeItem('ping:ui')` doesn't fix stale team ID (stored in separate `ping:activeTeamId`)
2. Clearing ALL localStorage requires re-login and loses all session state
3. 24h TTL on `ping:chatHistories` is arbitrary — no expiry for `ping:activeTeamId`, `ping:plans`
4. Tool cards disappear on reload even though localStorage has them

### Root Cause: Destructive Merge Destroys Tool Cards

```typescript
// chatStore.ts L563 — ARRAY REPLACEMENT (not deep merge)
set(prev => ({ chatHistories: { ...prev.chatHistories, ...restored } }));
```

1. Page loads → localStorage has messages WITH `streamParts: [{tool-card...}]` ✅
2. `restoreFromServer` fetches from MongoDB → returns messages (may have `streamParts` if save succeeded)
3. Spread replaces **entire array per chat key** → localStorage version destroyed
4. If MongoDB save failed (Issue 20a), server messages have `streamParts: undefined` → tool cards lost

### Current State: 11 localStorage Keys, No sessionStorage

| Key | Type | Should Be |
|-----|------|-----------|
| `ping:ui` | User pref (theme, viewMode) | ✅ localStorage |
| `ping:theme` | Duplicate of ping:ui | ❌ Remove |
| `ping:planviewer:view` | User pref | ✅ localStorage |
| `ping:activeTeamId` | Session state | ❌ sessionStorage |
| `ping:chatHistories` | Session cache | ❌ sessionStorage |
| `ping:chatHistories:ts` | Cache TTL | ❌ Remove (sessionStorage handles expiry) |
| `ping:lastUserId` | Session state | ❌ sessionStorage |
| `ping:plans:{teamId}` | Session cache | ❌ sessionStorage |

### Long-term Solution

**1. Fix the destructive merge — deep merge by message ID:**

```typescript
// chatStore.ts restoreFromServer — preserve local streamParts
set(prev => {
  const merged = { ...prev.chatHistories };
  for (const [key, msgs] of Object.entries(restored)) {
    if (!merged[key]) {
      merged[key] = msgs;
    } else {
      const msgMap = new Map(merged[key].map(m => [m.id, m]));
      for (const serverMsg of msgs) {
        const local = msgMap.get(serverMsg.id);
        msgMap.set(serverMsg.id, {
          ...local,
          ...serverMsg,
          streamParts: serverMsg.streamParts ?? local?.streamParts,
        });
      }
      merged[key] = Array.from(msgMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    }
  }
  return { chatHistories: merged };
});
```

**2. Move session data to sessionStorage:**

```
localStorage (user preferences — survives browser close):
  ping:ui → { theme, viewMode, selectedTeamId }

sessionStorage (session data — clears on tab close):
  ping:session:chatHistories → fast cache
  ping:session:plans:{teamId} → plan summaries

MongoDB (authoritative — survives everything):
  ChatMessage → messages WITH streamParts
```

**Industry pattern:** ChatGPT/Slack use server-side storage for conversations, localStorage only for UI preferences.

**Files:** chatStore.ts (deep merge), App.tsx (sessionStorage), uiStore.ts (persist selectedTeamId)

---

## Issue 23: `meta-agent` Connects to Backend — INITIAL_AGENTS Contaminates Team Selection

### Evidence

```
[AgentServiceV2] Error: "Team meta-agent not found — no plugin maps to this ID"
```

Happens on every load. Persists across localStorage clears, version bumps, and teamsValidated gates.

### Root Cause (researched — complete audit)

**Three compounding problems:**

**1. `INITIAL_AGENTS` includes `meta-agent` at index 0:**
```typescript
// dummyData/constants.ts
export const INITIAL_AGENTS: Agent[] = [
  { id: "meta-agent", name: "Ping Assistant", ... },  // ← index 0
];
```

**2. `agentStore.loadTeams()` APPENDS to INITIAL_AGENTS, doesn't replace:**
```typescript
// agentStore.ts L135
set(prev => {
  const existingIds = new Set(prev.agents.map(a => a.id));
  const newAgents = teamAgents.filter(ta => !existingIds.has(ta.id));
  const nextAgents = [...prev.agents, ...newAgents];  // [meta-agent, ...backendTeams]
  return { agents: nextAgents };
});
```

After loadTeams: `agents = [meta-agent, Engineering Team, Marketing Team, ...]`

**3. Auto-select picks `agents[0]` which is `meta-agent`:**
```typescript
// App.tsx loadTeams validation
const teams = useAgentStore.getState().agents;  // [meta-agent, ...]
if (!isValid && teams.length > 0) {
  setSelectedTeamId(teams[0].id);  // "meta-agent" ← BUG
}
```

**Result:** `agentServiceV2.connect("meta-agent")` → backend error.

### Why Previous Fixes Failed

| Fix Attempted | Why It Failed |
|--------------|---------------|
| Remove `selectedTeamId` from persist | `meta-agent` comes from INITIAL_AGENTS, not persist |
| `version: 1` on persist | Same — not a persist issue |
| `teamsValidated` gate | Gate opens after loadTeams → but agents[0] is still meta-agent |
| Remove `getState()` from route effect | Doesn't matter — loadTeams auto-select still picks meta-agent |

### Long-term Solution

**The real fix has two parts:**

**Part 1: Filter INITIAL_AGENTS out of team selection — they're UI placeholders, not backend teams.**

`loadTeams()` returns `teamAgents` (only backend teams). Use that for auto-select, not `agents` (which includes meta-agent):

```typescript
// App.tsx — auto-select from backend teams only, not INITIAL_AGENTS
useEffect(() => {
  useAgentStore.getState().loadTeams().then((backendTeams) => {
    // backendTeams = only teams from API (no meta-agent)
    if (!selectedTeamId && backendTeams.length > 0) {
      setSelectedTeamId(backendTeams[0].id);
    }
    setTeamsValidated(true);
  });
}, []);
```

Key: `loadTeams()` already returns `teamAgents` (backend-only). Use the return value, not `getState().agents`.

**Part 2: Socket connect effect validates against backend teams, not all agents:**

```typescript
// App.tsx — validate selectedTeamId is a real backend team
useEffect(() => {
  if (!teamsValidated) return;
  if (!selectedTeamId) return;

  // Don't connect to INITIAL_AGENTS (meta-agent, etc.)
  const backendTeams = agents.filter(a => a.role === 'Manager' && a.id !== 'meta-agent');
  if (!backendTeams.some(t => t.id === selectedTeamId)) return;  // Not a real team

  agentServiceV2.connect(selectedTeamId);
}, [selectedTeamId, teamsValidated]);
```

**Or simpler — mark meta-agent as non-connectable:**

```typescript
// dummyData/constants.ts — add a flag
export const INITIAL_AGENTS: Agent[] = [
  { id: "meta-agent", name: "Ping Assistant", isBuiltIn: true, ... },
];

// App.tsx — skip built-in agents
if (!selectedTeamId && backendTeams.length > 0) {
  const connectableTeams = backendTeams.filter(t => !t.isBuiltIn);
  if (connectableTeams.length > 0) setSelectedTeamId(connectableTeams[0].id);
}
```

**Cleanest approach — separate team agents from assistant agents:**

```typescript
// agentStore.ts — separate state
interface AgentState {
  assistants: Agent[];  // meta-agent, help bot (never connect to backend)
  teams: Agent[];       // backend teams (connectable)
  agents: Agent[];      // all (for sidebar rendering)
}
```

**Files:** agentStore.ts (separate teams from assistants), App.tsx (auto-select from backend teams only), dummyData/constants.ts (mark as built-in)

**Complete solution — `teamsValidated` gate:**

```typescript
// App.tsx — gate socket connection until teams are loaded and validated
const [teamsValidated, setTeamsValidated] = useState(false);

// loadTeams validates persisted team ID
useEffect(() => {
  useAgentStore.getState().loadTeams().then(() => {
    const teams = useAgentStore.getState().agents;
    const currentTeam = selectedTeamId;
    const isValid = currentTeam && teams.some(t => t.id === currentTeam);
    if (!isValid && teams.length > 0) {
      setSelectedTeamId(teams[0].id);  // Replace stale ID with first valid team
    }
    setTeamsValidated(true);  // Open the gate
  });
}, []);

// Socket connect — gated, won't fire until teams validated
useEffect(() => {
  if (!teamsValidated) return;  // Wait for loadTeams validation
  if (!selectedTeamId) { disconnect; return; }
  // ... connect to validated team
}, [selectedTeamId, teamsValidated, ...]);
```

**Why `teamsValidated` gate is the correct pattern:**
1. Persist hydrates stale ID → connect effect fires → `teamsValidated` is false → **returns early**
2. `loadTeams()` fetches real teams → validates → replaces stale ID → sets gate
3. Connect effect re-fires → `teamsValidated` is true → connects with valid ID
4. On subsequent loads with valid persisted ID → `loadTeams` validates → no change → gate opens → connects

**This solves Issue 24 simultaneously** — fresh users get auto-selected to first team.

**Files:** App.tsx (teamsValidated state + gate + loadTeams validation)

---

## Issue 24: No Auto-Select First Team for Fresh Users

### Evidence

Fresh install (no `ping:ui` in localStorage) or cleared storage:
1. `loadTeams()` fetches teams from API → returns `[Engineering Team, ...]`
2. `selectedTeamId` stays `null` (persist has nothing to hydrate)
3. Sidebar shows "Select team..." dropdown but nothing is selected
4. No socket connection → no chat data → empty UI

### Root Cause

No fallback to auto-select when `selectedTeamId` is null after both persist hydration and team loading complete. The app waits for manual user click on the dropdown.

### Long-term Solution

**Auto-select first team after loadTeams if no team is persisted:**

```typescript
// App.tsx — after loadTeams
useEffect(() => {
  useAgentStore.getState().loadTeams().then(() => {
    // After teams loaded: if no team selected (fresh install), auto-select first
    const currentTeam = useUiStore.getState().selectedTeamId;
    if (!currentTeam) {
      const teams = useAgentStore.getState().agents;
      if (teams.length > 0) {
        setSelectedTeamId(teams[0].id);
      }
    }
  });
}, []);
```

**Why `useUiStore.getState()` is safe here (unlike Issue 23):**
- `loadTeams()` is async (HTTP fetch) — by the time `.then()` fires, Zustand persist has already hydrated (it's synchronous localStorage read, completes in <1ms)
- So `getState().selectedTeamId` correctly reflects the persisted value at this point
- If it's still null after hydration, the user genuinely has no team → auto-select

**Recommended:** Issue 23's `teamsValidated` gate solves Issue 24 simultaneously — the `loadTeams().then()` validates AND auto-selects in one step. No separate fix needed.

**Files:** App.tsx (same gate as Issue 23)

---

## Issue 25: Team Dropdown Clipped by Sidebar — Cannot Select Team

### Evidence

Team dropdown opens but is hidden/clipped — the dropdown menu extends below the team switcher section but gets cut off by the sidebar's constrained layout. User cannot click on any team.

### Root Cause

Sidebar.tsx L381 has a `relative` container for the dropdown. The dropdown at L398 uses `absolute top-full z-50`:

```html
<!-- Sidebar structure -->
<aside class="h-full flex flex-col">           ← constrained height
  <div class="relative border-b shrink-0">     ← dropdown anchor
    <button>Select team...</button>
    <div class="absolute top-full z-50">        ← dropdown tries to render below
      <!-- team list -->                         ← CLIPPED by parent
    </div>
  </div>
  <div class="flex-1 overflow-y-auto">          ← this section clips the dropdown
    <!-- plan list, agents -->
  </div>
</aside>
```

The dropdown renders inside the sidebar's `relative` container. The `z-50` works for z-index stacking, but the sidebar's flex layout with `overflow-y-auto` on the next section clips the absolutely positioned dropdown.

### Long-term Solution

**React `createPortal` to `document.body` — industry standard for dropdown menus.**

No Radix UI or Headless UI installed in the project — use React's built-in `createPortal`.

```typescript
// Sidebar.tsx
import { createPortal } from 'react-dom';

// Two refs: one for the button (positioning), one for the portal (click-outside)
const dropdownRef = useRef<HTMLDivElement>(null);
const dropdownMenuRef = useRef<HTMLDivElement>(null);

// Click-outside handles both refs (button in sidebar + menu in portal)
useEffect(() => {
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (dropdownRef.current?.contains(target)) return;     // Click on button
    if (dropdownMenuRef.current?.contains(target)) return;  // Click inside menu
    setIsTeamDropdownOpen(false);
  };
  if (isTeamDropdownOpen) document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [isTeamDropdownOpen]);

// Render dropdown via portal at document.body level
{isTeamDropdownOpen && createPortal(
  <div
    ref={dropdownMenuRef}
    className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
    style={{
      top: (dropdownRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
      left: dropdownRef.current?.getBoundingClientRect().left ?? 0,
      width: dropdownRef.current?.getBoundingClientRect().width ?? 200,
    }}
  >
    <div className="max-h-48 overflow-y-auto p-1">
      {teams.map(team => (
        <button key={team.id} onClick={() => { onSelectTeam?.(team); setIsTeamDropdownOpen(false); }}>
          {team.name}
        </button>
      ))}
    </div>
  </div>,
  document.body,
)}
```

**Why this is the correct fix (not a patch):**
- `createPortal` is React's official API for rendering outside the component tree
- Radix UI, shadcn/ui, Headless UI all use portals internally for dropdowns
- `fixed` positioning with `getBoundingClientRect()` keeps the menu visually anchored to the button
- `z-[9999]` ensures it renders above everything (modals, overlays)
- Two refs (button + menu) for click-outside prevents the portal from closing on its own click
- No CSS hacks on parent containers needed

**Edge cases handled:**
- Window resize: re-render re-calculates `getBoundingClientRect()`
- Scroll: `fixed` positioning isn't affected by parent scroll
- Theme: portal inherits CSS variables from `<html>` (dark/light mode works)

**Files:** Sidebar.tsx (createPortal import + dual ref + portal rendering)

**Files:** Sidebar.tsx (portal for dropdown)

---

## Master Status & Implementation Plan

### Issue Status (as of 2026-04-29)

| # | Issue | Code | Tested | Blocker |
|---|-------|------|--------|---------|
| 1 | repoUrl lost in dispatch | ✅ | ✅ | — |
| 2 | Auth token SOLID violations | Documented | — | Future |
| 3 | Shared vs isolated mode | Documented | — | — |
| 4 | No push verification | Documented | — | Future |
| 5 | Workspace tools broken | ✅ | ✅ | — |
| 6 | Empty repo clone | ✅ | ✅ | — |
| 7 | Worktree auto-init | ✅ | ✅ | — |
| 8 | Commit in worktree (IWorkspaceGitOps) | ✅ | ❌ Blocked by 18 | 18 |
| 9 | GoalConfig type | ✅ | ❌ Blocked by 15 | 15 |
| 10 | Mixed workspace modes | Auto-resolves | — | 9 |
| 11 | assertWritable | ✅ | ❌ Blocked by 18 | 18 |
| 12 | IWorkspaceMerger | ✅ | ❌ Blocked by 18 | 18 |
| 13 | Merge before complete | ✅ | ✅ | — |
| **14** | **429 rate limit cascade** | **✅** | — | — |
| **15** | **goalId missing on mutations** | **✅** | — | — |
| 16 | Auth token not resolved | Documented | — | Future |
| 17 | Logging (startup + session) | ✅ | — | Independent |
| **18** | **Worktree wrong path (ROOT)** | **✅** | — | — |
| 19 | Autonomous dispatch | Unblocked by 15 | — | — |
| 20 | Stream persist on reload | Partial (beforeunload + retry) | — | 22 |
| 21 | Stale team ID in localStorage | ✅ (uiStore persist) | — | — |
| **22** | **Destructive merge + storage arch** | **✅ (deep merge + sessionStorage)** | — | — |
| **23** | **Zustand persist hydration race** | **Documented** | — | — |
| **24** | **No auto-select first team** | **Documented** | — | Solved by 23 |
| **25** | **Team dropdown clipped by sidebar** | **✅ Implemented** | — | — |
| **26** | **Duplicate goals collide (deterministic goalId)** | **✅ Implemented** | — | — |
| **27** | **Refresh mid-task loses streams + chats** | **Partial (Phase 1)** | — | **Critical** |
| **28** | **Every follow-up creates new goal** | **Documented** | — | **Critical — ROOT** |
| **29** | **Tasks show "No tasks yet" in plans** | **Documented** | — | Medium |
| **30** | **Empty chat after reload (goalId mismatch)** | **✅ Implemented** | — | Critical (caused by 28) |
| **31** | **Start button fails: "task not ready (in_progress)"** | **Documented** | — | Medium (pre-existing) |
| **32** | **Worker chats not loading to frontend** | **Documented** | — | **Critical (multi-factor)** |

**Also pending (from goal-scoped sessions):**
- GS-8: Remove `activePlanGoalIdRef` — ✅ Done
- GS-9: Per-goal `sessionState` — ✅ Done

### Implementation Phases

**Phase A: Unblock worktrees (Issue 18)** — 1 file, 1 line

| File | Change |
|------|--------|
| WorkspaceManager.ts L64 | `this.workspacesRoot = path.resolve(config.repoPath)` |

Test: clean `plan-*` dirs, submit goal, verify `.git` file (not dir) in task dir.
Unblocks: Issues 8, 11, 12 become testable.

**Phase B: Unblock goal routing (Issue 15)** — 3 files, 3 changes

| File | Change |
|------|--------|
| planMutationTools.ts L97 | Add `currentGoalId: string` to `PlanMutationContext` |
| tools/index.ts L54-59 | Pass `currentGoalId: octx.currentGoalId!` to mutation context |
| planMutationTools.ts L185 | Add `goalId: ctx.currentGoalId` to `addTask()` call |

Test: `replan`/`add_tasks` → verify `task.goalId` is set, `repoUrl` injected, ChatAgent routes.
Unblocks: Issues 9, 19, 20, reduces 14.

**Phase C: Rate limit protection (Issue 14)** — 2 files

| File | Change |
|------|--------|
| GoalManager.ts `onTaskFailed` | Don't notify planner for `rate_limit` errors — set task back to `ready` |
| DispatchManager.ts | Adaptive: reduce `maxConcurrent` after 2+ consecutive 429s |

Test: trigger 429 → verify planner doesn't replan, task retries after cooldown.

**Phase D: Frontend cleanup (GS-8, GS-9)** — 2 files
See [goal-scoped-sessions impl plan](../goal-scoped-sessions/feature_implementation_planning.md) Steps 8-9.

| File | Change |
|------|--------|
| App.tsx | Remove `activePlanGoalIdRef` and client-side goal filter |
| orchestrationStore.ts | `sessionState` → `goalStates: Record<goalId, {sessionState, tasks}>` |

**Phase E: Observability (Issues 17, 20)** — 3 files

| File | Change |
|------|--------|
| backend/logging/index.ts | Add pino file transport for `data/logs/startup.log` |
| GoalManager.ts | Create per-goal session logger: `data/logs/sessions/{goalId}.log` |
| chatStore.ts | Add `beforeunload` handler for localStorage flush |
| SocketServerV2.ts | Resilient message save: await + retry on failure |

**Phase F: Auth (Issue 16)** — Independent, future

Verify `better-auth` schema field name for GitHub OAuth token.

### Dependency Graph

```
Phase A (Issue 18: path.resolve)
  ↓ unblocks testing of Issues 8, 11, 12

Phase B (Issue 15: goalId)
  ↓ unblocks GoalConfig (9), ChatAgent routing (19), stream persist (20)
  ↓ reduces 429 cascade (14) — tasks through ChatAgent = concurrency control

Phase C (Issue 14: rate limiting)
  ← partially helped by Phase B (fewer concurrent dispatches)

Phase D (GS-8, GS-9: frontend)
  ← independent, can ship anytime

Phase E (Issues 17, 20: observability)
  ← partially helped by Phase B (goalId in messages)

Phase F (Issue 16: auth)
  ← fully independent
```

---

## Issue 26: Duplicate Goals Collide — Deterministic `toGoalId()` Causes Chat/Task Merge

**Severity**: Critical — data corruption (messages merge, tasks overwrite, streams cross-wire)

### Symptom

User submits two goals with the same prompt text (e.g., "Build a REST API") to the same team. Both goals appear as separate plans in the PlanList (different `planId`), but:
- Clicking either plan shows the **same merged chat** (messages from both goals interleaved)
- Tasks from both goals appear together
- Stream events from one goal appear in the other goal's view
- Backend reuses the first goal's GoalManager instead of creating a new one

### Root Cause

`toGoalId()` in `packages/frontend/lib/planId.ts` is **purely deterministic** — same input text always produces the same goalId:

```ts
export function toGoalId(goal: string): string {
  const slug = goal.toLowerCase().trim().replace(...).substring(0, 50);
  let hash = 0;
  for (let i = 0; i < goal.length; i++) {
    hash = ((hash << 5) - hash + goal.charCodeAt(i)) | 0;
  }
  return `${slug}-${Math.abs(hash).toString(36).substring(0, 8)}`;
}
```

Meanwhile, `makePlanId()` uses a timestamp — always unique. So two identical prompts get **different `planId`** but **same `goalId`**. The `planId` is used for the URL; the `goalId` is used for everything else.

### Impact Map — Every Place `goalId` is Used as a Key

| Layer | File | Usage | Collision Effect |
|-------|------|-------|-----------------|
| **Frontend chat key** | `App.tsx` L540, L574 | `addMessage(\`${teamId}:goal:${goalId}\`, ...)` | Messages from both goals merge into one chat |
| **Frontend stream routing** | `App.tsx` L398 | `chatKey = \`${teamId}:goal:${streamGoalId}\`` | Stream parts from Goal A appear in Goal B's view |
| **Frontend goal subscription** | `App.tsx` L229 | `subscribeToGoal(teamId, activePlanGoalId)` | Both plans join the same Socket.IO room |
| **Frontend task filter** | `App.tsx` L612 | `allTasks.filter(t => t.goalId === activePlanGoalId)` | Tasks from both goals shown together |
| **Frontend active chat derivation** | `App.tsx` L636 | `chatKey = \`${selectedTeamId}:goal:${activePlanGoalId}\`` | Both plans resolve to same chatKey |
| **Frontend plan storage** | `PlanList.tsx` L46 | Dedup by `planId` (not goalId) | Two plans exist but both have same goalId field |
| **Backend GoalManager** | `GoalManager.ts` L104 | `goals.get(goalId)` Map lookup | Second goal reuses first's GoalContext (planner, agents, state) |
| **Backend OrchestratorService** | `OrchestratorService.ts` L293 | `getGoalId()` guard | Second goal's content fed to first goal's planner session |
| **Backend TaskStore** | `TaskStore.ts` L179 | `getByGoal(goalId)` filter | Tasks from both goals merge |
| **Backend Socket.IO room** | `SocketServerV2.ts` L399 | `team:${teamId}:goal:${goalId}` room | Both goals broadcast to same room |
| **Backend stream broadcast** | `SocketServerV2.ts` L536 | `io.to(goalRoom(streamGoalId)).emit(...)` | Cross-wired stream events |
| **Backend MongoDB chat** | `MongoChatService.ts` L62 | `find({teamId, goalId})` | Both goals' messages returned from DB |
| **Backend session log** | `logging/index.ts` L73 | `${goalId}.log` file | Logs merge into one file |
| **Backend workspace dir** | `WorkspacePlugin.ts` L141 | Workspace scoped by goalId | Same workspace directory |

### Long-Term Solution

**Option A (Recommended): Make `toGoalId()` non-deterministic**

Include a timestamp or short UUID suffix:

```ts
export function toGoalId(goal: string): string {
  const slug = goal.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-")
    .substring(0, 50);
  const ts = Date.now().toString(36); // unique per-millisecond
  return `${slug}-${ts}`;
}
```

**Pros**: Minimal change (1 file, 1 function). Every goal submission gets a unique goalId.
**Cons**: Can't recover goalId from text alone (but nothing relies on this — the goalId is always passed explicitly from frontend to backend).

**Option B: Unify on `planId` as the correlation key**

Replace `goalId` with `planId` everywhere — chat keys, Socket.IO rooms, GoalManager map, TaskStore filter, etc. The `planId` is already unique (timestamp-based).

**Pros**: Single unique identifier across the stack. No "planId vs goalId" confusion.
**Cons**: Much larger change — every file in the Impact Map above needs updating. Backend GoalManager, OrchestratorService, TaskStore, SocketServerV2 all need to switch from goalId to planId. Frontend chat keys, stream routing, subscriptions all change.

**Option C: Detect duplicate and generate suffix**

Keep `toGoalId()` deterministic but detect collision at submission time and append `-2`, `-3`, etc.

**Pros**: Preserves slug readability.
**Cons**: Requires checking existing goals on both frontend (sessionStorage) and backend (GoalManager map) — complex synchronization.

### Recommendation

**Option A** — simplest, most reliable. One function change, no coordination needed. The comment in `planId.ts` says "backend receives goalId from the frontend and never derives its own" — so making it non-deterministic is safe.

**UPDATE**: Issue 26 implemented via server-generated UUID (Option A from `docs/features/server-goalid/`). `toGoalId()` removed from goal submission paths. Backend generates `crypto.randomUUID()`, emits `goal:created`, frontend awaits it.

---

## Issue 27: Page Refresh Mid-Task Loses Streams and Chats

**Severity**: Critical — user loses visibility into running tasks after refresh

### Symptom

When tasks are actively running and the user refreshes the page:
1. Stream events stop — no more tool calls, reasoning, or text visible
2. Chat history appears empty — previously visible messages gone
3. Task status shows but task output is blank

If the user is connected BEFORE tasks start (or tasks have completed), refresh works fine — chats restore correctly.

### Root Cause: `activeGoalId` Not Recovered on Refresh

The reconnection flow has a fatal gap — `activeGoalId` is never restored after page refresh, which breaks the entire goal-scoped event pipeline.

**Refresh timeline:**

```
1. Page refreshes → all Zustand stores reinitialize
2. uiStore.partialize only persists {theme, viewMode, isSidebarExpanded}
   → selectedTeamId = null
   → activePlanId = null
   → activeGoalId = null (NOT PERSISTED)
   
3. URL parsed: /teams/{teamId}/p/{planId}
   → selectedTeamId recovered ✅
   → activePlanId recovered ✅
   
4. activePlanGoalId derived (useMemo):
   → looks up plans[] (backend plans — empty on fresh load)
   → looks up sessionStorage ping:plans:{teamId}
   → finds plan with matching planId → goalId recovered ✅
   
5. Socket connects to team ✅

6. subscribeToGoal effect fires:
   if (selectedTeamId && activePlanGoalId) {
     agentServiceV2.subscribeToGoal(...)
   }
   → IF activePlanGoalId is derived in time, this works
   → IF the useMemo hasn't computed yet, this is null → SKIPPED ❌

7. restoreFromServer called:
   → uses activePlanGoalId which may still be null
   → messages keyed to wrong chatKey ❌
```

### Sub-Issues

#### 27a: Goal room subscription timing race

**File:** `App.tsx` L212-215

The `subscribeToGoal` effect depends on `activePlanGoalId` which is derived via `useMemo` from `plans` + `sessionStorage`. On refresh, the `useMemo` may not have computed yet when the socket connects → the effect runs with `activePlanGoalId = undefined` → no goal room subscription → all stream events lost.

**Impact:** Backend continues emitting to `team:{teamId}:goal:{goalId}` room. Nobody is listening. Events are permanently lost.

#### 27b: Socket.IO auto-reconnect doesn't re-subscribe to goal room

**File:** `AgentServiceV2.ts` L207-209

Socket.IO has `reconnection: true`. On auto-reconnect (network blip), the `connect` handler only does `register`, never `subscribeToGoal`. The React effect at App.tsx L212 only fires when deps change — not on socket reconnect.

**File:** `SocketServerV2.ts` L1505 — "Socket.IO automatically removes socket from all rooms on disconnect"

**Impact:** After any socket reconnect (not just refresh), goal room is lost.

#### 27c: `restoreFromServer` called without goalId → wrong chat key

**File:** `chatStore.ts` L537-540

```ts
key = goalId ? `${teamId}:goal:${goalId}` : teamId;
```

Without goalId, planner messages are stored under plain `teamId` key. But the chat view looks for `{teamId}:goal:{goalId}` → empty chat.

#### 27d: No catch-up for missed stream events

**File:** `SocketServerV2.ts` L438-470

Backend streams broadcast immediately with no buffering or replay. Events emitted during the ~1-3 second refresh window are permanently lost. No replay mechanism exists.

`restoreFromServer` gets persisted messages from MongoDB, but stream parts (tool calls, reasoning blocks) are only saved to MongoDB on stream `finish` event — in-flight stream parts at disconnect time are never received.

#### 27e: `get-state` returns all tasks, not goal-filtered

**File:** `SocketServerV2.ts` L1434-1475

`handleGetState` → `buildStateResponse` → `getAllTasks()` returns tasks from ALL goals. The frontend `planTasks` filter requires `activePlanGoalId` which is null → shows mixed-goal tasks or all tasks unfiltered.

### Impact Map

| What breaks | Why | File |
|------------|-----|------|
| Stream events lost | Not subscribed to goal room | App.tsx L212, SocketServerV2.ts L467 |
| Chat empty | restoreFromServer keyed without goalId | chatStore.ts L537 |
| Socket reconnect loses room | No re-subscribe on reconnect | AgentServiceV2.ts L207 |
| Missed events unrecoverable | No buffering or replay | SocketServerV2.ts L438 |
| Tasks mixed across goals | get-state not goal-filtered | SocketServerV2.ts L1434 |

### Long-Term Solution

**Phase 1 — Fix recovery (frontend, 3 changes):**

1. **Recover goalId from sessionStorage immediately.** The `activePlanGoalId` useMemo already does this — ensure it runs before the `subscribeToGoal` effect. If there's a race, add an explicit `useEffect` that reads sessionStorage on mount and calls `subscribeToGoal` directly.

2. **Re-subscribe on socket reconnect.** In `AgentServiceV2.connect()` handler (or via a React effect on socket state), call `subscribeToGoal` whenever the socket reconnects. Store the current `{teamId, goalId}` and re-subscribe automatically.

3. **Pass goalId to restoreFromServer.** Ensure `activePlanGoalId` is available when restore fires. If it's derived from sessionStorage (sync), it should be available on first render — verify the timing.

**Phase 2 — Catch-up mechanism (backend, medium effort):**

4. **Goal-scoped `get-state`.** Pass `goalId` in `get-state` request. Backend filters tasks by goalId. Frontend receives only relevant tasks.

5. **Event replay buffer.** On reconnect, backend replays recent events for the goal room (last N seconds or since last ack). This requires:
   - Server-side event buffer per goal (circular buffer, ~60s)
   - Client sends `lastEventTimestamp` on reconnect
   - Server replays missed events

Phase 2 is significant effort. Phase 1 alone fixes the 90% case — the only gap would be events during the ~1-3s refresh window, which is acceptable for now.

#### 27f: Follow-up messages fail with "Expected string, received null"

After reload, typing in the chat (e.g., "yes") triggers `sendToManager(content, goalId)` where `goalId` is `null` (from `activeGoalId` uiStore state). The backend Zod schema `z.string().max(200).optional()` rejects `null` — it only accepts `string | undefined`.

**Files:**
- `SocketServerV2.ts` L55 — `goalId: z.string().max(200).optional()` → change to `.nullish()` to accept `null`
- `AgentServiceV2.ts` `sendToManager()` — convert `null` → `undefined` via `goalId ?? undefined`
- `ChatArea.tsx` L186 — passes `goalId` prop which is `string | null` from `activeGoalId`

**Fix:** Schema accepts `nullish`, frontend converts `null` → `undefined`. Both applied.

---

## Issue 28: Every Follow-Up Message Creates a New Goal (Server-GoalId Regression)

**Severity**: Critical — destroys active goals, creates phantom plans

### Symptom

Follow-up messages like "ok", "yes", "are the tasks complete?" appear as separate goals in RECENT PLANS. Each message creates a brand-new backend GoalContext. In single-goal mode (`FF_PARALLEL_PLANS` off), this **clears the existing goal** — destroying in-progress tasks.

### Root Cause

Three failures combine:

**1. `activeGoalId` is null when follow-up is sent**

`handleGoalScreenSubmit` sets `activeGoalId` only AFTER `sendToManagerAsync` resolves (~1-5s). But `setActivePlanId` + `pushRoute` happen immediately, showing the ChatArea. If the user types before the server responds, `activeGoalId` is still `null`.

```
handleGoalScreenSubmit:
  1. setSelectedTeamId(teamId)     ← immediate
  2. await sendToManagerAsync(goal) ← 1-5 seconds
     ... user can type "yes" here, activeGoalId is still null ...
  3. setActiveGoalId(serverGoalId)  ← too late
```

Also after page reload, the mount effect recovery (Fix 27a) may fail if sessionStorage doesn't have the goalId.

**2. Backend creates new UUID for every message without goalId**

`AgentManagerV2.orchestratorMessage()`:
```ts
const resolvedGoalId = goalId || crypto.randomUUID(); // NEW UUID every time
```

Every `sendToManager(content, null)` → backend generates a fresh UUID → `GoalManager.getOrCreateGoal(newUUID)` → creates new GoalContext.

**3. Single-goal mode destroys existing goal**

`GoalManager.getOrCreateGoal()`:
```ts
if (!process.env.FF_PARALLEL_PLANS && this.goals.size >= 1) {
  this.goals.clear(); // DESTROYS running tasks
}
```

The new random goalId doesn't match the existing goal, so GoalManager clears everything and starts fresh. Active workers, planners, and tasks are lost.

**4. `goal:created` fires for EVERY message**

`SocketServerV2.handleOrchestratorMessage` always emits `goal:created` after `orchestratorMessage()`. But the frontend `onGoalCreated` handler only subscribes to the room — it never updates `activeGoalId` or saves the plan. So the cycle repeats.

### Impact

| What happens | Why |
|-------------|-----|
| "ok" appears as a plan in RECENT PLANS | New goalId → new savePlan via restore |
| Active tasks destroyed | Single-goal mode clears goals map |
| Planner loses context | New GoalContext has empty planner session |
| Chat becomes empty | Chat keyed by old goalId, new goal has no messages |

### Long-Term Solution

**Principle**: goalId is REQUIRED for all follow-up messages. Only the initial GoalScreen submission omits goalId (server generates UUID). Every subsequent message must include it.

**Fix A (Frontend — ROOT FIX): Don't navigate until goalId is set**

Move `setActivePlanId` + `pushRoute` to AFTER `sendToManagerAsync` resolves. The user sees the GoalScreen (with a loading/submitting state) until the server responds with the goalId:

```ts
// handleGoalScreenSubmit — AFTER
const result = await sendToManagerAsync(goal, repoUrl, repoBranch);
const serverGoalId = result.goalId;
setActiveGoalId(serverGoalId);         // ← set FIRST
savePlan(teamId, { planId, goal, goalId: serverGoalId, ... });
setActivePlanId(planId);               // ← THEN navigate
pushRoute(`/teams/.../p/${planId}`);
```

This eliminates the race window. ChatArea is never visible without `activeGoalId`. Follow-up messages always have goalId.

**Fix B (Backend): Only emit `goal:created` for new goals**

`handleOrchestratorMessage` should only emit `goal:created` when a NEW goal was actually created, not on every message:

```ts
const goalExisted = !!manager.getOrchestratorCurrentGoalId();
const result = await manager.orchestratorMessage(content, goalId);
if (!goalExisted) {
  socket.emit("goal:created", { goalId: result.goalId, nonce });
}
```

**Fix C (Backend): Reject follow-ups without goalId**

`AgentManagerV2.orchestratorMessage()` should NOT silently create a new goal. If there's already an active goal and no goalId is provided, the message is malformed:

```ts
const resolvedGoalId = goalId || crypto.randomUUID();
// If there's already a goal, a missing goalId means a frontend bug
if (!goalId && this.orchestrator?.getCurrentGoalId()) {
  logger.warn('Follow-up message missing goalId — frontend bug');
}
```

This surfaces the bug instead of silently creating orphan goals. Fix A prevents it from happening.

---

## Issue 29: Tasks Show "No tasks yet" in RECENT PLANS

**Severity**: Medium — cosmetic but confusing
**Verified**: YES — confirmed in code at 3 `savePlan()` call sites

### Symptom

Plan cards in GoalScreen show "No tasks yet" even for goals that have running tasks with 3/8 progress.

### Root Cause (verified)

**Two separate data sources, never synced:**

1. **GoalScreen PlanList** reads from `sessionStorage` via `getStoredPlans()` ([PlanList.tsx L37-42](packages/frontend/components/GoalScreen/PlanList.tsx#L37-L42))
2. **Sidebar SidebarPlanList** reads from `orchestrationStore.plans` (live from `goal:stateChange`)

The `savePlan()` calls at submit time ([App.tsx L547](packages/frontend/App.tsx#L547), [App.tsx L584](packages/frontend/App.tsx#L584)) omit `taskCount`:

```ts
savePlan(teamId, { planId, goal, goalId, createdAt, status: 'active' });
// ← no taskCount → PlanList shows "No tasks yet"
```

When `goal:stateChange` fires, `orchestrationStore.handleGoalStateChange` updates the Zustand `plans` array, but **never calls `savePlan()`** to update sessionStorage. The GoalScreen PlanList never gets task counts.

The only path that includes `taskCount` is `restoreFromServer` ([App.tsx L463-L471](packages/frontend/App.tsx#L463-L471)) — but that only runs on team reconnect/reload.

### Long-Term Solution

**Unify plan data source.** GoalScreen's PlanList should read from `orchestrationStore.plans` (which gets live updates from `goal:stateChange`) instead of sessionStorage. SessionStorage is for persistence across hard reloads — not for live UI state.

```tsx
// GoalScreen PlanList — read from orchestrationStore instead of sessionStorage
const plans = useOrchestrationStore(s => s.plans);
```

This eliminates the two-source problem entirely. SessionStorage plans remain as a persistence layer for restore, but the live UI always reads from the Zustand store.

---

## Issue 30: Frontend Doesn't Load Messages After Reload (goalId Mismatch)

**Severity**: Critical — empty chat on reload
**Verified**: YES — cascade from Issue 28. Also has independent timing issue.

### Symptom

After page refresh, the chat area is empty even though messages were sent before the refresh.

### Root Cause (verified)

**Primary (cascade from Issue 28):**

1. User submits goal → `savePlan()` stores `goalId: "uuid-A"` in sessionStorage
2. User types follow-up during the race window → `activeGoalId` is null → backend creates `goalId: "uuid-B"`
3. Single-goal mode destroys `uuid-A`'s GoalContext
4. Backend messages are now under `uuid-B`
5. User refreshes → mount effect recovers `goalId: "uuid-A"` from sessionStorage
6. `restoreFromServer(teamId, agents, "uuid-A")` → backend has no messages for `uuid-A` → empty chat

**Independent issue: server `activeGoalId` is ignored**

The restore endpoint (`GET /api/v2/teams/:teamId/session`) returns `activeGoalId` in the response ([HttpServer.ts L479-L481](packages/backend/api/HttpServer.ts#L479-L481)):
```ts
activeGoalId = manager.getCurrentGoalId();
```

But the frontend's restore handler ([App.tsx L459-L486](packages/frontend/App.tsx#L459-L486)) never reads `result.activeGoalId` to update the store. It relies entirely on sessionStorage for goalId recovery.

### Long-Term Solution

**Fixing Issue 28 (Fix A) eliminates the primary cause.** If `activeGoalId` is always set before ChatArea is visible, follow-ups always include goalId, and the goalId in sessionStorage always matches the backend.

**Additionally:**

1. **Use server's `activeGoalId` from restore response.** When `restoreFromServer` returns, check if the server knows the active goalId and use it:

```ts
restoreFromServer(...).then((result) => {
  if (result?.activeGoalId && !useUiStore.getState().activeGoalId) {
    setActiveGoalId(result.activeGoalId);
  }
  // ... rest of restore logic
});
```

2. **Persist `activeGoalId` in uiStore.** Add `activeGoalId` to `partialize` so it survives hard reloads without depending on sessionStorage lookup:

```ts
partialize: (s) => ({
  theme: s.theme,
  viewMode: s.viewMode,
  isSidebarExpanded: s.isSidebarExpanded,
  activeGoalId: s.activeGoalId,  // ← add
}),
```

---

## Issue 31: Start Button Fails — "Task not ready (status: in_progress)"

**Severity**: Medium — workaround exists (auto-execute)
**Pre-existing**: YES — not caused by server-goalId changes

### Symptom

Clicking the "Start" button on a task in the DetailPanel throws:
```
Task task-1 is not ready (status: in_progress)
```
Auto-execute works fine.

### Root Cause (verified)

**`onPlanMutation` auto-dispatches ALL ready tasks regardless of `autoExecute` setting.**

The flow:

1. Plan is approved → `plan:tasks_added` event fires
2. `OrchestratorService.onPlanMutation()` ([OrchestratorService.ts L434-443](packages/agent-manager/src/orchestrator/OrchestratorService.ts#L434-L443)) iterates ready tasks and calls `this.manualDispatch(tid)` for each one — **without checking `autoExecute`**
3. Tasks transition to `in_progress` immediately
4. User clicks "Start" → `DispatchManager.manualDispatch()` ([DispatchManager.ts L107-113](packages/agent-manager/src/orchestrator/DispatchManager.ts#L107-L113)) checks `task.status !== "ready" && task.status !== "pending"` → rejects with error

The normal `dispatch()` path correctly checks `if (!autoExecute) return;` ([DispatchManager.ts L68-69](packages/agent-manager/src/orchestrator/DispatchManager.ts#L68-L69)), but `onPlanMutation` bypasses it by calling `manualDispatch()` directly.

### Long-Term Solution

**`onPlanMutation` should respect `autoExecute`.** Only auto-dispatch ready tasks if `autoExecute` is enabled:

```ts
// OrchestratorService.onPlanMutation()
const readyTasks = tasks.filter(t => t.status === 'ready');
if (this.autoExecute) {
  for (const tid of readyTasks.map(t => t.id)) {
    this.manualDispatch(tid);
  }
}
// If autoExecute is off, tasks stay 'ready' for manual Start button
```

Also, `DispatchManager.manualDispatch()` should handle `in_progress` gracefully — instead of throwing, return a "task already running" message:

```ts
if (task.status === 'in_progress') {
  logger.info(`Task ${taskId} already in progress`);
  return; // not an error
}
```

---

## Issue 32: Worker Chats Not Loading to Frontend

**Severity**: Critical — worker output is invisible
**Mixed**: Pre-existing issues + worsened by server-goalId changes

### Symptom

Workers execute tasks (visible in backend logs), but no tool calls, reasoning, or text appears in the frontend chat area.

### Root Causes (verified — 4 factors)

#### 32a: `findAgentByRole()` silently drops unknown roles

**File:** [App.tsx L383-385](packages/frontend/App.tsx#L383-L385)

```ts
const resolved = findAgentByRole(streamAgentId);
if (!isOrchestrator && !resolved) return; // ← SILENTLY DROPS
```

Worker stream events have `agentId` set to the role key (e.g., `"researcher"`). `findAgentByRole` looks up `agentStore.roleMap`. If:
- The agent tree hasn't loaded yet (timing)
- The role key has a case mismatch (e.g., `"Backend"` vs `"backend"`)
- The sub-agent wasn't discovered by the backend

...`resolved` is null and the **entire stream event is silently dropped**.

**Long-term fix:** Log dropped events as warnings instead of silent return. Add case-insensitive matching in `findAgentByRole`. Queue events that arrive before agents are loaded and replay when the agent tree is populated.

#### 32b: Goal room subscription mismatch

**File:** [SocketServerV2.ts L539](packages/backend/api/SocketServerV2.ts#L539)

Workers broadcast to `team:{teamId}:goal:{goalId}`. The frontend subscribes via `subscribeToGoal(teamId, activeGoalId)`. If `activeGoalId` on the frontend doesn't match the task's `goalId` on the backend (e.g., due to Issue 28 creating orphan goals), worker streams go to a room nobody is listening to.

**Long-term fix:** Fixing Issue 28 eliminates the goalId mismatch. Workers use the task's `goalId` which comes from the plan — once the plan's goalId is correct, workers stream to the right room.

#### 32c: Chat key mismatch between write and read

**File:** [App.tsx L396](packages/frontend/App.tsx#L396) (write), [App.tsx L643-645](packages/frontend/App.tsx#L643-L645) (read)

Stream writes to: `${targetAgentId}:task:${streamTaskId}`
Display reads from: `${activeAgentId}:task:${selectedTaskId}`

If the user hasn't clicked a specific task in the sidebar, `selectedTaskId` is null. The display key falls back to `chat:{agentId}` or plain `agentId` — neither matches the task-scoped key where worker messages were stored.

**Long-term fix:** When a task starts executing, auto-select it (`setSelectedTaskId(taskId)`). Or: show worker messages at the agent level (aggregate all task outputs for that agent) when no specific task is selected.

#### 32d: Restore uses wrong chat keys for worker messages

**File:** [chatStore.ts restoreFromServer](packages/frontend/stores/chatStore.ts)

Worker messages from the backend are keyed by raw `agentId` (e.g., `"researcher"`) instead of `agentId:task:taskId`. On restore, worker messages go to a key that the task-scoped ChatArea doesn't read from.

**Long-term fix:** `restoreFromServer` should construct task-scoped keys for worker messages: `${resolvedAgentId}:task:${msg.taskId}`. The backend already includes `taskId` on worker messages.

### Impact Flow

```
Worker executes task
  → emits stream_part to goal room          (32b: room mismatch?)
  → frontend receives stream event           (if subscribed)
  → findAgentByRole(roleKey)                 (32a: drops if no match)
  → writes to agentId:task:taskId key        (32c: user hasn't selected task)
  → user sees empty chat                     (32d: restore also wrong key)
```

### Priority

Fix **32b** by fixing Issue 28 (goalId alignment) — this is already done.
Fix **32a** (silent drops) — highest impact, easiest fix (add logging + case-insensitive match).
Fix **32c** (auto-select task) — UX improvement.
Fix **32d** (restore keys) — correctness for reload scenarios.
