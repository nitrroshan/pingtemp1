# Multi-User Platform — Feature Architecture

**Status:** Planning  
**Scope:** Multiple users, each with multiple goals across multiple teams, with per-user authorization and quotas  
**Depends on:** [parallel-goals](../parallel-goals/feature_architecture.md) (MongoDB state + BullMQ + Redis — must be built first), [auth-security](../auth-security/feature_architecture.md) (identity)  
**Related Features:**  
- [conversation-persistence](../conversation-persistence/) — per-user chat history  
- [process-isolation](../process-isolation/feature_architecture.md) — worker process design reference

---

## Problem

After parallel goals ships (MongoDB state, BullMQ workers, Redis streaming), the platform supports multiple goals running concurrently with crash isolation and resume. But it's still single-user:

1. **Goals have no owner** — `GoalContext` has no `userId`. Any user can see/control any goal.
2. **Teams are single-owner** — no shared teams, no member roles.
3. **No resource quotas** — one user can monopolize all LLM calls and workers.
4. **No cross-user authorization** — no access control on goals, tasks, or streams.

## What We Want

```
Alice logs in (from her laptop)
 ├─ Team "Backend" (owner)
 │   ├─ Goal: "Build auth system"     [executing, 4/7 tasks]
 │   └─ Goal: "Add rate limiting"     [planning]
 │
 ├─ Team "Frontend" (member)
 │   └─ Goal: "Redesign dashboard"    [executing, 2/5 tasks]
 │
 └─ Dashboard: 3 goals, 2 teams, real-time status

Bob logs in (same time, different continent)
 ├─ Team "Backend" (member — shared with Alice)
 │   └─ Goal: "Write API docs"        [executing, 1/3 tasks]
 │
 ├─ Team "Mobile" (owner)
 │   └─ Goal: "iOS push notifications" [awaiting approval]
 │
 └─ Dashboard: 2 goals, 2 teams

Alice closes her browser. Opens it 3 days later.
 → All 3 goals exactly where she left them.
 → Chat history intact. Tasks that finished show results.
 → Goal that was "planning" still has her planner conversation.

Bob's goal crashes.
 → Alice's goals are unaffected (different worker process).
 → Bob gets notified, goal auto-retries.
```

---

## What Parallel Goals Already Provides

By the time multi-user starts, [parallel-goals](../parallel-goals/feature_architecture.md) has already delivered:

- ✅ All state in MongoDB (goals, tasks, plans) — survives restarts
- ✅ BullMQ worker processes — crash isolation, parallel execution
- ✅ Redis Socket.IO adapter — multi-server support
- ✅ Redis pub/sub — real-time streaming from workers to web servers
- ✅ Per-goal concurrency budgets
- ✅ Goal dashboard and ChatAgent conversations
- ✅ Resume where you left off

Multi-user adds the **authorization and scoping layer** on top: userId on goals, team membership, access control, per-user quotas.

---

## How Users, Teams, and Goals Relate

```
                    ┌──────────────┐
                    │   Platform   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────┴────┐  ┌───┴────┐  ┌───┴────┐
         │  Alice  │  │  Bob   │  │ Carol  │
         └────┬────┘  └───┬────┘  └───┬────┘
              │            │            │
    ┌─────────┼─────┐     │      ┌─────┼──────┐
    │         │     │     │      │     │      │
┌───┴──┐ ┌───┴──┐  │  ┌──┴───┐  │  ┌──┴───┐  │
│ Team │ │ Team │  │  │ Team │  │  │ Team │  │
│  BE  │ │  FE  │  │  │  BE  │  │  │ Mob  │  │
└───┬──┘ └───┬──┘  │  └──┬───┘  │  └──┬───┘  │
    │        │     │     │      │     │      │
  Goals    Goals   │   Goals    │   Goals    │
  (Alice)  (Alice) │   (Bob)    │   (Carol)  │
                   │            │            │
              Shared team "BE": Alice(owner) + Bob(member)
              Each user's goals isolated within the shared team
```

**Key rules:**
1. A user can be a member of multiple teams
2. A team can have multiple members (with roles)
3. A goal belongs to exactly one user AND one team
4. Users see only their own goals (even in shared teams)
5. Team owners/admins can see all goals in their team
6. Goals execute on the team's agents (shared skills, shared agent definitions)

### Execution Model

Within a team, agents are shared but work is dispatched per-user via BullMQ:

```
Team "Backend" (agent definitions: backend-dev, devops, qa)
 │
 ├─ Goals in MongoDB:
 │   ├─ { goalId: "g1", userId: "alice", state: "executing" }
 │   ├─ { goalId: "g2", userId: "alice", state: "planning"  }
 │   └─ { goalId: "g3", userId: "bob",   state: "executing" }
 │
 ├─ Tasks in BullMQ queue "tasks:team-backend":
 │   ├─ Job: { goalId: "g1", userId: "alice", role: "backend-dev", ... }
 │   ├─ Job: { goalId: "g1", userId: "alice", role: "devops", ... }
 │   └─ Job: { goalId: "g3", userId: "bob",   role: "backend-dev", ... }
 │
 └─ Per-user concurrency budget (checked before dispatch):
     alice: 2/2 workers (at limit — new tasks queue)
     bob:   1/2 workers (can dispatch more)
     Team total: 3/6 workers
```

A `backend-dev` worker process can execute Alice's task, then Bob's task — agents are defined per-team but workers are stateless and serve any user's job. Concurrency is budgeted per-user so one user can't monopolize the team's resources.

---

## Production Architecture

The infrastructure (web servers, Redis, BullMQ workers, MongoDB) is set up by [parallel-goals](../parallel-goals/feature_architecture.md). Multi-user adds these layers:

```
                    Web Server (stateless)
                     │
                     ├─ Auth middleware: socket.data.userId from cookie
                     ├─ Authorization middleware: check TeamMembership
                     ├─ Goal CRUD: filter by userId
                     └─ Socket.IO subscribe: check goal ownership
                     
                    BullMQ Jobs
                     │
                     ├─ AgentJob.userId field (inherited from goal)
                     ├─ Per-user concurrency quota check before dispatch
                     └─ Per-user queue option: "tasks:user:{userId}"
                     
                    MongoDB
                     │
                     ├─ goals.userId (NEW — who created this goal)
                     ├─ teamMemberships collection (NEW — M:N users↔teams)
                     └─ userQuotas collection (NEW — per-user limits)
```

---

## Data Model

### Types

```typescript
// Team membership (M:N users to teams)
interface TeamMembership {
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

// GoalContext — persisted to MongoDB
interface GoalContext {
  goalId: string;
  userId: string;          // Who created this goal
  teamId: string;          // Which team's agents execute it
  state: GoalState;        // idle | planning | approved | executing | done | failed
  title: string;
  currentPlanId: string | null;
  repoUrl?: string;
  repoBranch?: string;
  createdAt: string;
  updatedAt: string;
}

// Task — persisted to MongoDB
interface Task {
  taskId: string;
  goalId: string;
  userId: string;          // Inherited from goal
  teamId: string;
  planId: string;
  title: string;
  description: string;
  assignedRole: string;    // lowercase
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
  output: any;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// Per-user resource quota
interface UserQuota {
  userId: string;
  maxConcurrentGoals: number;    // default: 5
  maxWorkersPerGoal: number;     // default: 2
  maxTotalWorkers: number;       // default: 6
  llmTokenBudget: number;        // monthly, default: 1_000_000
  llmTokensUsed: number;
  resetAt: string;               // Monthly reset date
}

// BullMQ job payload
interface AgentJob {
  type: 'planner-turn' | 'task-execution' | 'chat-response';
  goalId: string;
  userId: string;
  teamId: string;
  taskId?: string;               // For task-execution
  role?: string;                 // Agent role
  message?: string;              // For planner-turn / chat
  agentDefinition: string;       // Serialized YAML or reference
  context: Record<string, any>;  // Task context, plan, etc.
}
```

### Relationships

```
User ──M:N──→ TeamMembership ──N:1──→ Team
User ──1:N──→ Goal (via userId)
User ──1:1──→ UserQuota
Team ──1:N──→ Goal (via teamId)
Goal ──1:N──→ Task (via goalId)
Goal ──1:1──→ Plan (via currentPlanId)
Goal ──1:N──→ Conversation (planner + chat agents)
```

---

## What Multi-User Adds

[Parallel-goals](../parallel-goals/feature_architecture.md) already delivers isolation (BullMQ workers), server deployment (stateless + Redis adapter), and resume (MongoDB state). Multi-user adds **user scoping**:

| Capability | Parallel Goals | Multi-User Adds |
|---|---|---|
| Isolation | Per-goal (crashing job doesn't affect other goals) | Per-user (Alice's crash doesn't affect Bob) + per-user BullMQ queues |
| Resume | All goals resume from MongoDB | Per-user goal list (`GET /users/me/goals`) |
| Server deployment | Stateless web servers + Redis adapter | No change — already works |
| Authorization | None — any authenticated user sees all goals | Goal ownership + team roles + access control |
| Resource limits | Per-goal concurrency budget | Per-**user** quota (max goals, max workers, token budget) |
| Dashboard | Goal list per team | Goal list across **all teams** for logged-in user |

---

## Socket.IO Routing

```
Alice connects (socket.data.userId = "alice")
 ├─ Subscribes to goal "g1" → server checks ownership → joins room "goal:g1"
 ├─ Subscribes to goal "g2" → server checks ownership → joins room "goal:g2"
 └─ Cannot subscribe to "g3" (Bob's goal) → 403

Worker Process executes a task for goal "g1"
 → Publishes stream_part to Redis pub/sub: channel "stream:g1"
 → All web servers subscribed to "stream:g1" via Redis adapter
 → Server 1 (where Alice is connected) receives it
 → Emits to Socket.IO room "goal:g1" → Alice receives

Bob connects to Server 3 → same pattern, different rooms
```

**Authorization on subscribe:**
```typescript
socket.on('subscribeToGoal', async ({ teamId, goalId }) => {
  const userId = socket.data.userId;  // From auth middleware, server-verified
  const goal = await db.goals.findOne({ goalId });

  if (!goal) return socket.emit('error', { message: 'Goal not found' });

  // Owner or team admin can subscribe
  const membership = await db.teamMemberships.findOne({ teamId, userId });
  const canAccess = goal.userId === userId
    || membership?.role === 'owner'
    || membership?.role === 'admin';

  if (!canAccess) return socket.emit('error', { message: 'Not authorized' });

  socket.join(`goal:${goalId}`);
});
```

---

## Team Membership

### Roles

| Role | Create goals | View own goals | View all goals | Manage members | Delete team |
|---|---|---|---|---|---|
| **Owner** | Yes | Yes | Yes | Yes | Yes |
| **Admin** | Yes | Yes | Yes | Yes | No |
| **Member** | Yes | Yes | No | No | No |
| **Viewer** | No | Yes | No | No | No |

### APIs

| Endpoint | Purpose |
|---|---|
| `POST /api/v2/teams` | Create team (caller becomes owner) |
| `POST /api/v2/teams/:id/members` | Invite user (owner/admin only) |
| `DELETE /api/v2/teams/:id/members/:userId` | Remove member |
| `PUT /api/v2/teams/:id/members/:userId/role` | Change role |
| `GET /api/v2/teams/:id/members` | List members |
| `GET /api/v2/users/me/teams` | All teams for current user |

### Migration

Existing `TeamRegistration.ownerId` → create `TeamMembership { userId: ownerId, role: 'owner' }`.

---

## Resource Quotas

Per-user quotas prevent one user from starving others:

```typescript
// Enforced at goal creation
async function createGoal(userId: string, teamId: string, content: string) {
  const quota = await db.quotas.findOne({ userId });
  const activeGoals = await db.goals.countDocuments({
    userId, state: { $nin: ['done', 'failed'] }
  });

  if (activeGoals >= quota.maxConcurrentGoals) {
    throw new Error(`Goal limit reached (${quota.maxConcurrentGoals})`);
  }

  // Create goal in MongoDB
  const goal = await db.goals.insertOne({
    goalId: generateId(), userId, teamId, state: 'planning',
    title: content, createdAt: new Date().toISOString(),
  });

  // Submit planner job to BullMQ
  await taskQueue.add('planner-turn', {
    type: 'planner-turn', goalId: goal.goalId,
    userId, teamId, message: content,
  });
}

// Enforced at task dispatch (in worker process)
async function beforeDispatch(job: AgentJob) {
  const quota = await db.quotas.findOne({ userId: job.userId });
  const activeWorkers = await db.tasks.countDocuments({
    userId: job.userId, status: 'in_progress',
  });

  if (activeWorkers >= quota.maxTotalWorkers) {
    // Re-queue with delay — try again in 30s
    throw new DelayedError('Worker quota exceeded', 30_000);
  }
}
```

---

## Data Flow: What Changes With Users

The [parallel-goals data flow](../parallel-goals/feature_architecture.md#data-flow) stays the same. Multi-user adds authorization checks at each step:

```
Alice sends goal
  → Web Server: socket.data.userId = "alice" (from auth cookie)
  → Check: alice is member of team-backend? (TeamMembership lookup) → Yes
  → Check: alice under goal quota? (UserQuota lookup) → Yes (2/5)
  → MongoDB: create goal { goalId, userId: "alice", teamId, state: "planning" }
  → BullMQ: submit planner job with userId: "alice"
  → ...rest is identical to parallel-goals flow...

Bob tries to subscribe to Alice's goal
  → socket.data.userId = "bob"
  → MongoDB: goal.userId === "alice", bob is not team admin → 403 Denied

Alice reconnects next day
  → GET /api/v2/users/me/goals → MongoDB: { userId: "alice" } → returns only Alice's goals
  → Bob's goals in same team are NOT returned
```

---

## Frontend

### User Dashboard

```
┌───────────────────────────────────────────────────┐
│  MY GOALS                              [+ New Goal]│
├───────────────────────────────────────────────────┤
│                                                    │
│  Team: Backend  (owner)                            │
│    ● Build auth system        🟢 executing   6/7   │
│    ● Add rate limiting        ⚪ planning          │
│                                                    │
│  Team: Frontend  (member)                          │
│    ● Redesign dashboard       🟢 executing   2/5   │
│                                                    │
│  ────────────────────────────────────────────────  │
│  Resources: 4/6 workers | 3/5 goals | 850K tokens  │
└───────────────────────────────────────────────────┘
```

### Socket.IO Subscription Model

Frontend connects once, subscribes to all active goals across all teams:

```typescript
// On login, subscribe to all active goals
const goals = await api.get('/users/me/goals');
for (const goal of goals.filter(g => g.state !== 'done')) {
  socket.emit('subscribeToGoal', { teamId: goal.teamId, goalId: goal.goalId });
}

// Receive events for all goals, route by goalId
socket.on('stream', ({ goalId, part }) => {
  chatStore.processStreamPart(goalId, part);
});
socket.on('state', ({ goalId, state }) => {
  goalStore.updateGoalState(goalId, state);
});
```

---

## Implementation Phases

**Prerequisite:** [parallel-goals](../parallel-goals/feature_architecture.md) Phases 1-5 must be complete. This gives us MongoDB state, BullMQ workers, Redis streaming, workspace isolation, and the goal dashboard. Multi-user adds the user-scoping layer on top.

### Phase 1: User Identity on Goals (1 week)

Thread `userId` through goal creation and storage. Every goal has an owner.

- Add `userId` field to GoalContext in MongoDB
- `GoalManager.createGoal()` — accept `userId` from socket connection
- Tasks inherit `userId` from their goal
- BullMQ job payload gets `userId` field (`AgentJob.userId`)
- Conversations already store `userId` (no change)

**After Phase 1:** Goals have owners. No enforcement yet — any user can still see any goal.

### Phase 2: Team Membership (1 week)

Replace single-owner `TeamRegistration` with multi-member `TeamMembership`.

- `TeamMembership` collection in MongoDB (userId, teamId, role)
- Roles: `owner | admin | member | viewer`
- `ITeamRegistryService` — add `addMember()`, `removeMember()`, `getMembers()`, `getMemberRole()`
- `GET /api/v2/users/me/teams` — returns all teams where user is a member
- Migration: existing `TeamRegistration.ownerId` → `TeamMembership { role: 'owner' }`

**After Phase 2:** Teams have members with roles. No goal-level enforcement yet.

### Phase 3: Goal Authorization (1 week)

Users can only see and control their own goals. Team admins can see all goals.

- `subscribeToGoal` — check `goal.userId === socket.data.userId || isTeamAdmin()`
- `sendMessage` — check goal ownership before forwarding
- `approvePlan` — only goal owner or team admin
- `GET /api/v2/goals` — filter by `userId` (enforced server-side)
- `GET /api/v2/users/me/goals` — cross-team goal list for current user

**After Phase 3:** Full user isolation. Alice can't see Bob's goals.

### Phase 4: Per-User Resource Quotas (1 week)

Prevent one user from monopolizing team resources.

- `UserQuota` MongoDB collection
- Quota check at goal creation (`maxConcurrentGoals`)
- Quota check before BullMQ job dispatch (`maxTotalWorkers`)
- Concurrency budget per-user within shared team queue
- Admin endpoint: `PUT /api/v2/users/:id/quota`

**After Phase 4:** Resource fairness. One user can't starve others.

### Phase 5: User Dashboard (1 week)

Frontend shows all goals across all teams for the logged-in user.

- `GET /api/v2/users/me/goals` drives the dashboard
- Resource usage display (workers, goals, token budget)
- Team membership badges (owner/admin/member/viewer)
- Subscribe to all active goal rooms on login

**After Phase 5:** Production-ready multi-user platform.

---

## Risks

Infrastructure risks (MongoDB, Redis, BullMQ) are covered in [parallel-goals](../parallel-goals/feature_architecture.md#risks). Multi-user-specific risks:

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-user data leak | User sees another user's goals | Server-verified `userId` from auth cookie on every operation. Never trust client. |
| Role escalation | Member acts as admin | Server-side role check on every mutation. Frontend role display is cosmetic only. |
| Quota gaming | User creates multiple accounts to bypass limits | Rate limit account creation. Admin review for quota increases. |
| Shared team contention | 5 users × 3 goals = 15 goals on one team queue | Per-user concurrency budgets within team's global budget |
| Team membership sprawl | User joins 100 teams | Max teams per user (configurable, default: 20) |
| Goal ownership disputes | Who can modify a goal? | Clear role matrix. Only goal owner + team admin can approve/cancel. |
