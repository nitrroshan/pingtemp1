# v3.0 — Backend Persistence (GoalContext + Tasks to MongoDB)

> **Scope:** Persist GoalContext and Tasks to MongoDB. Server becomes recoverable on restart.  
> **Depends on:** v2.0 (GoalSessionStore — frontend must use server as source of truth before we make it durable)  
> **Architecture:** [../feature_architecture.md](../feature_architecture.md) — Layer 2

## Problem

Backend restart loses ALL runtime state:
- `GoalManager.goals` Map (GoalContext: state, title, repo, planId) — **lost**
- `TaskStore` Map (task status, output, dependencies) — **lost**
- Planner conversation history (per-goal `messages[]`) — **lost**
- `autoExecute` flag — **lost**

Messages and goal metadata survive (SQLite/MongoDB), but task progress and orchestrator state do not. After restart, the user sees their old messages but no tasks, no plan, and a stale state.

## What Gets Persisted (new)

| Collection | Fields | Currently | Write Frequency |
|-----------|--------|-----------|----------------|
| `goal_contexts` | goalId, teamId, userId, state, title, repoUrl, repoBranch, planId, createdAt, updatedAt | In-memory `GoalManager.goals` Map | On state change (~10/goal) |
| `tasks` | id, goalId, teamId, title, description, status, assignedRole, priority, output, prerequisites, dependants, branchName, branchStatus | In-memory `TaskStore` Map | On status change (~5-10/task) |

## What Stays In-Memory (no persistence needed)

| Component | Reason |
|-----------|--------|
| AiSdkAgent (active workers) | LLM streaming session — can't serialize mid-stream |
| PlannerAgent | Active LLM session |
| ChatAgent | Active LLM session |
| DispatchManager queue | Transient concurrency tracking |

On restart: `in_progress` tasks are downgraded to `ready` (workers lost, but tasks are re-dispatchable).

## Implementation Steps

### Step 1: GoalContext MongoDB Schema

Create `packages/backend/services/mongo/schemas/GoalContextSchema.ts`:
```typescript
const GoalContextSchema = new Schema({
  goalId: { type: String, required: true, index: true },
  teamId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  state: { type: String, enum: ['idle','gathering','researching','awaiting_approval','executing','queued','done'], default: 'idle' },
  title: { type: String, default: '' },
  repoUrl: String,
  repoBranch: String,
  planId: String,
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});
GoalContextSchema.index({ teamId: 1, goalId: 1 }, { unique: true });
```

### Step 2: Task MongoDB Schema

Create `packages/backend/services/mongo/schemas/TaskSchema.ts`:
```typescript
const TaskSchema = new Schema({
  id: { type: String, required: true, index: true },
  goalId: { type: String, required: true, index: true },
  teamId: { type: String, required: true },
  title: String,
  description: String,
  status: { type: String, enum: ['ready','pending','in_progress','completed','failed'], default: 'pending' },
  assignedRole: String,
  priority: { type: Number, default: 0 },
  output: Schema.Types.Mixed,
  prerequisites: Schema.Types.Mixed,  // Map<string, boolean> serialized
  dependants: [String],
  branchName: String,
  branchStatus: String,
});
TaskSchema.index({ goalId: 1 });
TaskSchema.index({ teamId: 1, status: 1 });
```

### Step 3: MongoGoalContextService

Create `packages/backend/services/mongo/MongoGoalContextService.ts`:
- `createGoal(ctx: GoalContext): Promise<void>` — insert new goal
- `updateState(goalId: string, state: string): Promise<void>` — update state + updatedAt
- `updateGoal(goalId: string, patch: Partial<GoalContext>): Promise<void>` — generic update
- `getGoal(goalId: string): Promise<GoalContext | null>` — single goal
- `getGoals(teamId: string): Promise<GoalContext[]>` — all goals for team
- `getActiveGoal(teamId: string): Promise<GoalContext | null>` — latest non-done goal

### Step 4: MongoTaskService

Create `packages/backend/services/mongo/MongoTaskService.ts`:
- `createTasks(tasks: Task[]): Promise<void>` — bulk insert (plan approval)
- `updateStatus(taskId: string, status: string, output?: any): Promise<void>`
- `getByGoal(goalId: string): Promise<Task[]>`
- `getByTeam(teamId: string): Promise<Task[]>`
- `clearByGoal(goalId: string): Promise<void>` — for replan

### Step 5: Wire GoalManager to use write-through persistence

Modify `packages/agent-manager/src/orchestrator/GoalManager.ts`:
- Accept `MongoGoalContextService` via constructor injection
- On `getOrCreateGoalPublic()`: after creating GoalContext in Map, also write to MongoDB
- On state transitions (`updateGoalState()`): write to MongoDB
- On `loadFromDb()` (new method): hydrate Map from MongoDB on startup

### Step 6: Wire TaskStore to use write-through persistence

Modify `packages/agent-manager/src/orchestrator/TaskStore.ts`:
- Accept `MongoTaskService` via constructor injection
- On `create(task)`: write to MongoDB after Map update
- On `updateStatus(taskId, status)`: write to MongoDB
- On `loadFromDb(goalId)` (new method): hydrate Map from MongoDB

### Step 7: Startup recovery

Modify `packages/agent-manager/src/AgentManagerV2.ts`:
- On team initialization: call `GoalManager.loadFromDb()` to hydrate goals
- For each goal with `in_progress` tasks: downgrade to `ready`
- Emit `state` event so frontend picks up recovered state

### Step 8: Update restore endpoint

Modify `packages/backend/api/HttpServer.ts` restore endpoint:
- Prefer MongoDB goal data over in-memory (in-memory may not have recovered yet)
- If GoalManager has no goals (fresh start) but MongoDB does, hydrate first

## Files Changed

| File | Change | New? |
|------|--------|------|
| `backend/services/mongo/schemas/GoalContextSchema.ts` | MongoDB schema | **New** |
| `backend/services/mongo/schemas/TaskSchema.ts` | MongoDB schema | **New** |
| `backend/services/mongo/MongoGoalContextService.ts` | CRUD service | **New** |
| `backend/services/mongo/MongoTaskService.ts` | CRUD service | **New** |
| `agent-manager/src/orchestrator/GoalManager.ts` | Write-through persistence | Modify |
| `agent-manager/src/orchestrator/TaskStore.ts` | Write-through persistence | Modify |
| `agent-manager/src/AgentManagerV2.ts` | Startup recovery | Modify |
| `backend/api/HttpServer.ts` | Restore uses MongoDB | Modify |

## Testing

1. Submit goal → tasks created → restart backend → goals + tasks recovered from MongoDB
2. Task completes → restart → task shows completed (not re-dispatched)
3. `in_progress` task → restart → task shows `ready` (re-dispatchable)
4. Multiple goals → restart → all goals recoverable (not just latest)
5. Plan approved → restart → plan structure recovered
6. Planner mid-stream → restart → planner conversation lost (expected) but goal/tasks survive

## Rollback

Remove MongoDB service injections from GoalManager/TaskStore constructors. Goals/tasks revert to in-memory only. No schema migrations to revert (collections are additive).
  - `OrchestratorService.messages[]` → per-goal `Map<goalId, OrchestratorMessage[]>`
  - Save planner messages to MongoDB on each turn (not just final)

### API Endpoints

- [ ] **Step 6**: New endpoint `GET /api/v2/goals/{goalId}/session`
  - Returns complete GoalSession: messages, tasks, state, plan, agents
  - Replaces the current `restore` endpoint (which mixes in-memory + MongoDB)

- [ ] **Step 7**: New endpoint `GET /api/v2/teams/{teamId}/goals`
  - Already exists partially — enhance to return full goal list with status + taskCount
  - Used by GoalScreen PlanList

- [ ] **Step 8**: `GoalManager.loadActivePlan()` reads from MongoDB instead of JSON files
  - `FilePlanStore` becomes optional backup, MongoDB is primary
  - All goals recoverable (not just the latest)

### Frontend Simplification

- [ ] **Step 9**: `goalSessionStore.goalLoaded()` populates from server response only
  - Remove sessionStorage for plans
  - Remove localStorage for chatHistories
  - Server is sole source of truth

- [ ] **Step 10**: GoalCoordinator.switchGoal() becomes thin:
  ```typescript
  async switchGoal(goalId: string) {
    const session = await api.getGoalSession(goalId);
    goalSessionStore.getState().goalLoaded(session);
    agentServiceV2.subscribeToGoal(teamId, goalId);
  }
  ```

- [ ] **Step 11**: Remove `savePlan()` / sessionStorage dependency entirely
  - PlanList reads from server goals or orchestrationStore.plans
  - No local persistence needed

## Files Changed

| File | Change | New? |
|------|--------|------|
| `backend/services/mongo/schemas/GoalContextSchema.ts` | GoalContext persistence | **New** |
| `backend/services/mongo/schemas/TaskSchema.ts` | Task persistence | **New** |
| `backend/services/mongo/MongoGoalContextService.ts` | CRUD for GoalContext | **New** |
| `backend/services/mongo/MongoTaskService.ts` | CRUD for Tasks | **New** |
| `backend/api/HttpServer.ts` | New session endpoint | Modify |
| `agent-manager/src/orchestrator/GoalManager.ts` | MongoDB persistence hooks | Modify |
| `agent-manager/src/orchestrator/TaskStore.ts` | MongoDB persistence hooks | Modify |
| `agent-manager/src/orchestrator/OrchestratorService.ts` | Per-goal message scoping | Modify |
| `frontend/stores/goalSessionStore.ts` | Server-only data source | Modify |
| `frontend/lib/GoalCoordinator.ts` | Simplified switchGoal | Modify |
| `frontend/components/GoalScreen/PlanList.tsx` | Remove sessionStorage | Modify |

## Testing

1. Backend restart → all goals recoverable from MongoDB
2. Close browser, reopen next day → full state restored
3. Two tabs open same goal → both see same state via Socket.IO
4. New device → login → see all previous goals with full history
5. `start.sh` clean → drops MongoDB collections → fresh start
6. 10+ goals per team → all listed, switchable, no state leaks

## Rollback

Revert MongoDB schema additions. GoalSessionStore falls back to in-memory + sessionStorage (v2.0 behavior). Backend GoalManager/TaskStore revert to in-memory only.
