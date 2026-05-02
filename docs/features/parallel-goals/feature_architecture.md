# Parallel Goals — Feature Architecture

**Status:** Planning  
**Scope:** Multiple goals running simultaneously per team, with crash isolation, state persistence, and resume  
**Related Features:**  
- [multi-user](../multi-user/feature_architecture.md) — adds userId, team membership, per-user quotas (built on top of this)  
- [goal-isolation](../goal-isolation/feature_architecture.md) — contamination fixes (prerequisite)  
- [conversation-persistence](../conversation-persistence/) — chat history restore  
- [chat-agent-layer](../chat-agent-layer/) — per-role agents users can query

---

## Problem

Users can only run one goal at a time per team. They can't:

1. **Run multiple goals simultaneously** — Goal B queues behind Goal A
2. **Check on goals freely** — no cross-goal dashboard, no per-goal chat agents
3. **Resume where they left off** — goals are in-memory, lost on restart; no session restore across reconnects

The platform should feel like managing multiple projects — each with its own agents, tasks, and conversations — not a single-threaded job runner.

## What We Want

A user logs in and sees all their active goals across teams. They pick one, chat with its agents for a status update, approve a plan change, then switch to another goal in a different team — all without anything stopping or losing context. When they close the browser and come back tomorrow, every goal is exactly where they left it.

---

## Architecture

### Current State (Single-Goal, In-Memory)

```
User → one team → one executing goal → shared workers → shared TaskStore
                   └─ all other goals queued
                   └─ all state in-memory (lost on restart)
```

**Barriers:**
- Execution mutex in GoalManager — only one goal executes at a time
- All state in-memory (`Map<goalId, GoalContext>`, TaskStore, PlanStore)
- Scalar `currentGoalId` in WorkerPool — last `approvePlan` overwrites for all
- Global `MAX_CONCURRENT_DISPATCHES` — not per-goal
- Shared workspace — two goals writing same files causes conflicts
- Direct `io.emit()` — single-server only

### Target State (Parallel Goals)

```
User
 ├─ Team Alpha
 │   ├─ Goal A (executing) → 2 workers active
 │   ├─ Goal B (executing) → 1 worker active
 │   └─ Goal C (planning)  → planner conversation
 │
 ├─ Team Beta
 │   └─ Goal D (executing) → 2 workers active
 │
 └─ Dashboard: all goals, all teams, real-time status
```

Each goal has:
- Independent state machine (`planning → approved → executing → done`)
- Own planner conversation thread (persisted in MongoDB)
- Own ChatAgents per role (persisted, queryable anytime)
- Own task DAG (no cross-goal dependencies)
- Own concurrency budget (independent dispatch)
- Own workspace branch/clone (no file conflicts)
- **Crash isolation** — one goal failing doesn't affect others

Goals share: team agent definitions, skill definitions, LLM API access.

### Core Design Principle

**Nothing lives in-memory. All state is externalized.**

This is the foundation that makes parallel goals, resume, crash isolation, and multi-user all possible. Every piece of state goes to MongoDB or Redis:

| Data | Current (broken) | Target |
|---|---|---|
| GoalContext | In-memory `Map` | **MongoDB** `goals` collection |
| Tasks | In-memory `Map` + FileTaskStore | **MongoDB** `tasks` collection |
| Plans | JSON files on disk | **MongoDB** `plans` collection |
| Conversations | MongoDB (already done) | MongoDB (no change) |
| Worker state | In-memory agent instances | **Stateless** — recreated per BullMQ job |
| Job dispatch | Direct function call (`WorkerPool.executeTask()`) | **BullMQ** queue (Redis) |
| Real-time streaming | Direct `io.emit()` | **Redis** pub/sub → Socket.IO adapter |

---

## Execution Model

### How It Works

```
                    ┌────────────────┐
                    │   Web Server   │
                    │   (stateless)  │
                    │  Express       │
                    │  Socket.IO     │
                    │  Auth          │
                    └───────┬────────┘
                            │
                 ┌──────────┴──────────┐
                 │       Redis         │
                 │  BullMQ job queues  │
                 │  Socket.IO adapter  │
                 │  Pub/Sub (streams)  │
                 └──────────┬──────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
    ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
    │   Worker    │  │   Worker    │  │   Worker    │
    │ Process 1   │  │ Process 2   │  │ Process 3   │
    │ (stateless) │  │ (stateless) │  │ (stateless) │
    │ Pulls job   │  │ Pulls job   │  │ Pulls job   │
    │ Runs agent  │  │ Runs agent  │  │ Runs agent  │
    └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
           │                │                │
           └────────────────┼────────────────┘
                            │
                 ┌──────────┴──────────┐
                 │      MongoDB        │
                 │  Goals, Tasks,      │
                 │  Plans, Convos      │
                 └─────────────────────┘
```

**Web Server:** Authenticates users, serves REST API, handles Socket.IO, submits jobs to BullMQ, forwards Redis pub/sub events to Socket.IO rooms.

**Worker Processes:** Pull jobs from BullMQ, create `AiSdkAgent` from task definition + agent YAML, execute, write results to MongoDB, publish stream events to Redis. **Stateless** — can die and restart without affecting anything.

**Per-goal concurrency:**

```
Team "Backend" (agent definitions: backend-dev, devops, qa)
 │
 ├─ Goals in MongoDB:
 │   ├─ { goalId: "g1", state: "executing" }
 │   ├─ { goalId: "g2", state: "planning"  }
 │   └─ { goalId: "g3", state: "executing" }
 │
 ├─ Tasks in BullMQ queue "tasks:team-backend":
 │   ├─ Job: { goalId: "g1", role: "backend-dev", ... }
 │   ├─ Job: { goalId: "g1", role: "devops", ... }
 │   └─ Job: { goalId: "g3", role: "backend-dev", ... }
 │
 └─ Concurrency budget (checked before dispatch):
     Goal g1: 2/2 workers (at limit — new tasks queue)
     Goal g3: 1/2 workers (can dispatch more)
     Team total: 3/6 workers
```

A `backend-dev` worker process can execute Goal A's task, then Goal C's task — agents are defined per-team but workers are stateless and serve any goal's job. Concurrency is budgeted per-goal so one goal can't monopolize the team.

### Planner Cross-Goal Awareness

When multiple goals execute in the same team, the planner needs context about other active goals to avoid conflicts:

```
Planner system prompt injection:
"Other active goals in this team:
 - Goal A: 'Build landing page' (executing, 3/5 tasks done)
 - Goal C: 'Write API docs' (planning)
Avoid creating tasks that conflict with these goals."
```

---

## Three Capabilities

### Capability 1: Multiple Goals Running Simultaneously

**Same team:** BullMQ naturally supports parallel dispatch. Each goal's tasks are independent jobs. Per-goal concurrency limits prevent one goal from starving others.

**Cross-team:** Separate BullMQ queues per team (`tasks:team-backend`, `tasks:team-frontend`). Fully isolated — different agent definitions, different skills.

**Workspace isolation:** Each task gets its own git clone or worktree. Two goals editing the same repo don't conflict — they work on separate branches. Merge conflicts resolved at goal completion.

### Capability 2: User Monitors and Chats with Goal Agents

**Goal dashboard (frontend):**

```
┌─────────────────────────────────────────────────┐
│  MY GOALS                                       │
├─────────────────────────────────────────────────┤
│  Team Alpha                                     │
│    ● Build Landing Page      🟢 executing  3/5  │
│    ● Setup CI Pipeline       🟡 approved   0/4  │
│                                                 │
│  Team Beta                                      │
│    ● Migrate Database        🟢 executing  2/6  │
│    ● Write API Docs          ⚪ planning        │
└─────────────────────────────────────────────────┘
```

**Per-goal agent chat:**
- User selects a goal → sees ChatAgents for each role in that goal
- ChatAgents receive task updates (started, progress, blocked, completed)
- User asks: "How's the API integration going?" → ChatAgent responds with real context
- ChatAgent conversations persisted in MongoDB per `teamId + goalId + role`

**Real-time updates across goals:**
- Socket.IO `goal:stateChange` events broadcast via Redis pub/sub to all subscribed sockets
- Frontend shows notification badge when a background goal changes state
- User doesn't need to be "in" a goal to see it finish

**API endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /api/v2/goals?teamId={id}` | All goals in a team |
| `GET /api/v2/goals?teamId={id}&status=executing` | Active goals in a team |
| `GET /api/v2/goals/{goalId}/state` | Full goal state (tasks, plan, agents) |
| `GET /api/v2/goals/{goalId}/conversations` | All conversations for a goal |
| `POST /api/v2/goals/{goalId}/chat/{role}` | Send message to goal's ChatAgent |

### Capability 3: Resume Goals Where You Left Off

**Every state transition writes to MongoDB.** Nothing is in-memory-only.

```
Resume flow:

User opens browser
  → GET /api/v2/goals?teamId={id}
      → MongoDB returns all goals with current state
  → User clicks a goal
  → GET /api/v2/goals/{goalId}/conversations
      → Returns planner + ChatAgent conversations from MongoDB
  → Frontend replays chat history
  → Socket.IO subscribes to goal rooms
  → Any in-progress tasks continue on worker processes
      → Stalled jobs (crashed workers) auto-retry via BullMQ
  → User is back exactly where they left off
```

**Server restart is invisible:**
```
Server crashes at 3am
  → In-flight BullMQ jobs → marked "stalled" after timeout
  → Server restarts → connects to same Redis + MongoDB
  → BullMQ auto-retries stalled jobs on any available worker
  → All goal state intact in MongoDB
  → Users reconnect → full state restored from database
```

**State persistence:**

| Data | Storage | Survives Restart |
|---|---|---|
| GoalContext | MongoDB `goals` | ✅ |
| Tasks | MongoDB `tasks` | ✅ |
| Plans | MongoDB `plans` | ✅ |
| Planner conversations | MongoDB `conversations` | ✅ |
| ChatAgent conversations | MongoDB `conversations` | ✅ |
| Worker streams (live tokens) | Redis pub/sub (ephemeral) | ❌ — captured as task output on completion |
| Agent definitions | YAML files in container | ✅ |

**What can't resume:** A worker mid-execution. If a worker crashes while running a task, BullMQ marks the job as stalled and retries it on another worker. The agent restarts from scratch for that task (not mid-stream resume).

---

## Data Flow

### Goal Creation

```
User sends goal
  → Web Server receives via Socket.IO
  → Creates GoalContext in MongoDB { goalId, teamId, state: "planning" }
  → Submits BullMQ job: { type: "planner-turn", goalId, message: "Build auth" }
  → Worker pulls job → runs PlannerAgent → writes plan to MongoDB
  → Publishes "plan-ready" to Redis pub/sub
  → Web Server receives → emits to Socket.IO room → user sees plan
```

### Plan Approval

```
User approves plan
  → Web Server updates goal state in MongoDB → "approved"
  → Creates task docs in MongoDB (from plan)
  → Submits BullMQ jobs for each ready task
  → Worker 1 picks up task-A → runs AiSdkAgent → streams to Redis pub/sub
  → Web Server → Socket.IO → user sees live tokens
  → Worker 1 finishes → updates task in MongoDB → checks dependents
  → Dependent tasks become "ready" → new BullMQ jobs submitted
  → Worker 2 picks up next task → repeat
```

### Goal Switching

```
User switches to Goal B
  → Frontend unsubscribes from Goal A Socket.IO room
  → Frontend subscribes to Goal B room
  → GET /api/v2/goals/{goalB}/conversations → replays chat history
  → Goal A continues executing in background (workers unaffected)
```

### Reconnect After Disconnect

```
User reconnects
  → GET /api/v2/goals?teamId={id} → all goals with current state from MongoDB
  → Re-subscribe to Socket.IO rooms for active goals
  → Any goals that completed while disconnected show final state
```

---

## Implementation Phases

### Phase 1: Goal Isolation (1-2 weeks)

Fix 31 contamination violations. Every function that touches goal state takes `goalId` explicitly. No `activeGoalId` fallbacks. Tools see only their goal's data.

**Key files:** OrchestratorService, GoalManager, WorkerPool, DependencyResolver, TaskStore, NotificationQueue  
**Feature doc:** [goal-isolation/feature_architecture.md](../goal-isolation/feature_architecture.md)

**After Phase 1:** Goals don't contaminate each other. Still in-memory, still serial.

### Phase 2: Externalize State to MongoDB (2 weeks)

Move all goal/task/plan state from in-memory Maps to MongoDB. This is the critical foundation — without it, nothing else works.

- GoalContext → MongoDB `goals` collection
- TaskStore → MongoDB `tasks` collection  
- PlanStore → MongoDB `plans` collection
- GoalManager reads/writes MongoDB instead of in-memory Map
- Conversations already in MongoDB (no change)

**After Phase 2:** Goals survive restarts. Resume works. Still single server, still serial execution.

### Phase 3: Redis + BullMQ (2-3 weeks)

Replace in-process `WorkerPool.executeTask()` with BullMQ job dispatch. Add Redis for Socket.IO adapter and stream pub/sub.

- BullMQ queue per team (`tasks:team-{teamId}`)
- Worker processes: pull job → create AiSdkAgent → execute → write to MongoDB → publish stream events to Redis
- Socket.IO Redis adapter (multi-server support)
- Stalled job detection + auto-retry
- Per-goal concurrency limits (checked before job submission)
- Remove execution mutex — multiple goals dispatch jobs simultaneously
- Planner turns as BullMQ jobs (not just task execution)

**After Phase 3:** True parallel execution. Crash isolation (worker crashes don't affect other goals). Can run multiple web servers behind a load balancer.

### Phase 4: Workspace Isolation (2 weeks)

Per-task git clones or worktrees. Two goals editing the same repo don't conflict.

- Each task gets its own workspace clone
- Worker receives workspace path in job payload
- Push-to-remote on task completion
- Branch-per-task naming (`goal-{goalId}/task-{taskId}`)

**After Phase 4:** File conflict risk eliminated. Full parallel goal safety.

### Phase 5: Frontend Dashboard + Goal UX (1-2 weeks)

Goal-centric frontend: multi-goal list, switching, notifications, ChatAgent conversations.

- Goal list view: all goals across teams with status
- Goal detail view: tasks, plan, chat agents
- Background goal notifications (via Socket.IO `goal:stateChange`)
- ChatAgent per-role conversations
- Subscribe to multiple goal rooms simultaneously

**After Phase 5:** Complete parallel goals experience.

---

## What Comes After: Multi-User

Once parallel goals works, [multi-user](../multi-user/feature_architecture.md) adds:

- `userId` on GoalContext — goal ownership
- TeamMembership (M:N users to teams, roles: owner/admin/member/viewer)
- Authorization checks — users see only their own goals
- Per-user resource quotas (max goals, max workers, LLM token budget)
- User dashboard: all goals across all teams for the logged-in user

The infrastructure is already in place — MongoDB state, BullMQ dispatch, Redis streaming. Multi-user is primarily an authorization and data-scoping layer on top.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| MongoDB write load | High frequency task status updates | Batch writes, write concern `w:1` for status, indexed queries |
| Redis single point of failure | Streaming + job dispatch stops | Redis Sentinel or managed Redis (AWS ElastiCache) |
| BullMQ streaming latency | Token-level events too slow through Redis | Batch stream_parts at 16ms intervals (~60fps). Redis pub/sub adds ~1-2ms |
| Stalled job storms | Server crash → many jobs retry at once | BullMQ exponential backoff with jitter. Max retries = 3 |
| Workspace file conflicts | Two goals edit same file | Workspace isolation (Phase 4) — per-task git clones |
| Task ID collisions across goals | Goal A and B both generate `task-1` | UUID task IDs (not sequential) |
| Complex debugging | Interleaved logs across workers | Per-goal log scoping, goalId in all log entries |
| Worker process OOM | Large LLM response exhausts memory | Container memory limits, BullMQ job timeout |
