# Workspace System — Architecture Redesign

## Current State Assessment

### What Exists

```
packages/workspace/          ← L1: git-backed workspace library (standalone)
  └── L1WorkspacePlugin
      └── WorkspaceManager
          ├── AgentWorkspace    (per-task workspace with file/git ops)
          └── GitBranchManager  (low-level git wrapper with mutex)

packages/backend/
  └── WorkspacePlugin          (IPlugin adapter — bridges L1 into agent system)
```

### Current Problems

| # | Problem | Impact | Root Cause |
|---|---------|--------|------------|
| 1 | **Two modes (shared/isolated) with different behaviors** | Push works in one, not the other. Auth needed for one, not the other. | Feature grew organically — shared mode first, isolated added later |
| 2 | **repoUrl lost in dispatch** | Tasks don't know their repo | OrchestratorService.dispatchTask rebuilds context, discards workspace fields |
| 3 | **Auth token coupling** | SocketServerV2 queries MongoDB for GitHub token | Transport layer handles auth (SRP violation) |
| 4 | **Clone fails silently** | Broken workspace, no tools for agent | PluginRegistry.prepareForTask swallows errors |
| 5 | **No push verification** | User doesn't know if code reached GitHub | console.warn on failure, no Socket.IO event |
| 6 | **Workspace CWD depends on server startup** | `./data/workspaces` resolves differently based on CWD | Relative path, not absolute |
| 7 | **State lost on restart** | WorkspaceManager.workspaces Map is in-memory only | No persistence layer for workspace registry |
| 8 | **No testability** | Can't unit test — no interfaces, concrete dependencies everywhere | Missing ISP, DIP |
| 9 | **Parent repo detection is a patch** | Constructor runs `execSync git init` as defense | Root issue: workspace dir must never share .git with project |

---

## Design Principles for Redesign

| Principle | What it means for workspace |
|-----------|---------------------------|
| **Single Mode** | One workspace model, not two. Configurable, not branching code paths. |
| **Fail Loud** | If workspace setup fails, task MUST fail — not run without tools. |
| **Auth at Setup** | Token resolved ONCE during workspace creation, stored in workspace config. |
| **Absolute Paths** | Workspace root is absolute, not relative to CWD. |
| **Interface-First** | IWorkspaceProvider, ITokenProvider — mockable, testable. |
| **State Recovery** | Workspace registry persisted. Survives restart. |
| **Push as Event** | Push result emitted via callbacks — frontend shows status. |

---

## Proposed Architecture

### Single Workspace Model

Remove shared/isolated split. One model:

```
data/workspaces/{teamId}/{goalId}/
  ├── .git/                    ← initialized once per goal
  ├── .workspace.json          ← workspace metadata (repoUrl, auth, status)
  ├── task-{taskId}/           ← per-task working directory (git worktree OR subdirectory)
  └── main                     ← merged results
```

- **Per-goal workspace** (not per-team, not per-task)
- If `repoUrl` provided: `git clone` → workspace has `origin`
- If no `repoUrl`: `git init` → workspace is local-only
- Each task gets a **git worktree** (parallel-safe) OR **branch** (serial mode)
- `FF_WORKSPACE_ISOLATION` removed — single code path

### Interface Definitions

```typescript
// IWorkspaceProvider — what WorkerPool depends on
interface IWorkspaceProvider {
  createForTask(taskId: string, config: WorkspaceConfig): Promise<ITaskWorkspace>;
  getForTask(taskId: string): ITaskWorkspace | null;
  completeTask(taskId: string): Promise<PushResult>;
}

// ITaskWorkspace — what agent tools operate on
interface ITaskWorkspace {
  readonly taskId: string;
  readonly basePath: string;
  readonly status: WorkspaceStatus;
  
  createFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  commit(message: string): Promise<string>;
  publish(): Promise<OutputManifest>;
}

// ITokenProvider — auth abstraction
interface ITokenProvider {
  getGitToken(userId: string, provider: 'github'): Promise<string | null>;
}

// WorkspaceConfig — everything needed to set up a workspace
interface WorkspaceConfig {
  teamId: string;
  goalId: string;
  taskId: string;
  role: string;
  repoUrl?: string;
  repoBranch?: string;
  userId: string;        // for token resolution
}

// PushResult — what comes back after task completion
interface PushResult {
  merged: boolean;
  pushed: boolean;
  branch: string;
  remote?: string;
  error?: string;
}
```

### Data Flow (Redesigned)

```
Frontend GoalScreen
  → repoUrl stored on GoalContext (existing)
  → userId stored on GoalContext (NEW)

GoalManager.approvePlan
  → task.context gets { repoUrl, repoBranch, userId } from GoalContext

WorkerPool.runTask
  → reads { repoUrl, repoBranch, userId } from TaskStore (authoritative)
  → passes to IWorkspaceProvider.createForTask(taskId, config)

WorkspaceProvider.createForTask
  → resolves auth token via ITokenProvider.getGitToken(userId, 'github')
  → creates workspace (clone or init based on repoUrl presence)
  → configures remote with auth token embedded
  → returns ITaskWorkspace

Agent executes
  → uses ITaskWorkspace methods (file ops, commit)

WorkspaceProvider.completeTask
  → publishes outputs
  → merges to main
  → pushes to remote (if configured)
  → returns PushResult
  → PushResult emitted via callback → Socket.IO → frontend toast
```

### Auth Flow (Redesigned)

```
1. User logs in via GitHub OAuth (better-auth) — token stored in account table
2. GoalContext stores userId (not token — token resolved lazily)
3. ITokenProvider injected into WorkspaceProvider at construction time
4. On workspace creation: provider.getGitToken(userId, 'github') → token
5. Token embedded in clone URL: https://oauth2:{token}@github.com/...
6. Token stored in workspace config (.workspace.json) — available for push
7. On push: read token from workspace config, inject into push URL
```

**Why store token in workspace config?**
- Available after restart (persisted)
- No runtime dependency on MongoDB during push
- Token is per-workspace, not per-session
- Can be refreshed independently

### Error Handling (Redesigned)

```
prepareForTask:
  try:
    workspace = provider.createForTask(taskId, config)
  catch (err):
    // FAIL LOUD — task cannot run without workspace
    throw new Error(`Workspace creation failed: ${err.message}`)
    // PluginRegistry propagates → WorkerPool catches → task fails
    // NOT silently swallowed

onTaskComplete:
  result = provider.completeTask(taskId)
  if (!result.pushed && result.error):
    // Emit push failure event — frontend shows toast
    callbacks.onPushFailed({ taskId, error: result.error })
  if (result.pushed):
    callbacks.onPushSuccess({ taskId, branch: result.branch, remote: result.remote })
```

### Restart Recovery

```
WorkspaceProvider.initialize():
  // Scan data/workspaces/{teamId}/ for existing workspaces
  // Read .workspace.json from each
  // Rebuild workspaces Map
  // Verify .git exists (re-init if missing)
```

`.workspace.json` stored per workspace:
```json
{
  "teamId": "1efcca47-...",
  "goalId": "build-a-rest-api-...",
  "taskId": "task-1",
  "role": "backend",
  "repoUrl": "https://github.com/nitrroshan/pingtemp1.git",
  "repoBranch": "main",
  "status": "active",
  "createdAt": "2026-04-28T...",
  "branch": "goal-.../task-task-1",
  "authToken": "gho_..."
}
```

### Absolute Paths

```typescript
// Current (breaks based on CWD):
const workspaceDir = process.env.WORKSPACE_BASE_DIR || "./data/workspaces";

// Fixed:
const workspaceDir = process.env.WORKSPACE_BASE_DIR 
  || path.resolve(__dirname, "../../../data/workspaces");
```

---

## Implementation Priority

| Step | What | Why First |
|------|------|-----------|
| 1 | Fix Issue 1 (TaskStore read for repoUrl) | Unblocks push in shared mode |
| 2 | Add `FF_WORKSPACE_ISOLATION=false` default | Prevents broken workspace until isolated mode is fixed |
| 3 | Add `ITokenProvider` interface + `AuthTokenService` | Decouples auth from transport |
| 4 | Add push result callbacks → Socket.IO events | User knows if push worked |
| 5 | Unify shared/isolated into single model | Removes branching code, one behavior |
| 6 | Persist workspace config (.workspace.json) | Survives restart |
| 7 | Absolute workspace paths | Removes CWD dependency |
| 8 | Fail-loud error handling | No more silent broken workspaces |

---

## What NOT To Change

- **L1 library stays standalone** — `packages/workspace/` has no backend dependencies
- **MCP server pattern stays** — workspace tools exposed via MCP
- **Git-backed design stays** — branches, commits, merge are correct primitives
- **Plugin adapter pattern stays** — WorkspacePlugin bridges L1 into agent system
