# Team & Goal Ownership + Hybrid Database — Feature Architecture

**Date:** May 4, 2026
**Status:** In Progress (Steps 1-6 complete, tested)
**Priority:** P1 — Foundation for multi-user access control + production database strategy
**Roadmap phase:** Phase 2 (Hybrid Database + Team Ownership) in PLATFORM-ROADMAP.md
**Depends on:** Auth system (better-auth — existing), ServiceRegistry pattern (existing)
**Related:** [conversation-persistence](../conversation-persistence/feature_architecture.md), [auth-security](../auth-security/), [parallel-goals](../parallel-goals/feature_architecture.md), [multi-user](../multi-user/feature_architecture.md)

---

## Problem

1. **No ownership hierarchy** — teams have no owner/members, goals have no creator/approver
2. **Wrong database for relational data** — teams, goals, tasks, memberships are relational but stored in MongoDB (cloud) or raw SQLite (local)
3. **Three database modes already exist** — MongoDB (cloud), SQLite (local), better-auth (separate auth DB). No PostgreSQL yet.
4. **Schema drift** — SQLite `goals` table missing `goalId`, `repoUrl`, `repoBranch` that Mongo has

---

## Current Database Architecture (Audited May 5, 2026)

**Three modes supported:** `local` (SQLite), `cloud` (MongoDB), `hybrid` (PostgreSQL + MongoDB).

```
ServiceRegistry (packages/backend/services/ServiceRegistry.ts)
├── mode: "cloud" | "local" | "hybrid"
│
├── teams: PluginTeamService          ← NO DATABASE — reads plugin folders
├── chat: IChatService                ← MongoDB (cloud/hybrid) | SQLite (local)
├── goals: IGoalService               ← PostgreSQL (hybrid) | MongoDB (cloud) | SQLite (local)
├── tasks: ITaskPersistence            ← PostgreSQL (hybrid) | MongoDB (cloud) | SQLite (local)
├── teamRegistry: ITeamRegistryService ← PostgreSQL (hybrid) | MongoDB (cloud) | SQLite (local)
│
└── Auth: better-auth
    ├── hybrid: Drizzle adapter (PostgreSQL — same connection as app data)
    ├── cloud: MongoDB adapter (same connection)
    └── local: SQLite (data/auth.db — SEPARATE from ping.db)
```

### Service Interfaces (4 app + 1 auth)

| Interface | Methods | PG Impl (hybrid) | Mongo Impl (cloud) | SQLite Impl (local) |
|-----------|---------|------------------|-----------|------------|
| `IChatService` | addMessage, getMessages, getAgentMessages, getGoalMessages, getSessionMessages | — (stays in MongoDB) | `MongoChatService` | `SqliteChatService` |
| `IGoalService` | addGoal, getGoals, updateGoal | `PgGoalService` | `MongoGoalService` | `SqliteGoalService` |
| `ITaskPersistence` | saveTasks, updateTaskStatus, getTasksByGoal, getTasksByTeam, clearTasksByGoal, clearStaleTasks | `PgTaskService` | `MongoTaskService` | `SqliteTaskService` |
| `ITeamRegistryService` | register, getOwner, canAccess, canMutate, getTeamsForUser | `PgTeamService` | `MongoTeamRegistryService` | `SqliteTeamRegistryService` |
| better-auth | (internal) | Drizzle adapter | `mongodbAdapter` | `bun:sqlite` adapter |

### Storage by Mode

| Domain | Hybrid (production) | Cloud | Local |
|--------|-------------------|-------|-------|
| Chat messages | MongoDB | MongoDB | SQLite |
| Goals | **PostgreSQL** | MongoDB | SQLite |
| Tasks | **PostgreSQL** | MongoDB | SQLite |
| Teams/Orgs/Members | **PostgreSQL** | MongoDB | SQLite |
| Auth (users, sessions) | **PostgreSQL** | MongoDB | SQLite |
| Users (auth) | `user` | `user` | `auth.db` |
| Sessions (auth) | `session` | `session` | `auth.db` |
| Accounts (auth) | `account` | `account` | `auth.db` |
| Teams/Agents | NONE | NONE | Plugin folders |

---

## Target: Hybrid Database Strategy

### Database Assignment

| Data | Database | Reason |
|------|----------|--------|
| **Users, teams, members** | PostgreSQL | Relational: FK constraints, unique emails, role enums, cascading deletes |
| **Goals** | PostgreSQL | Relational: team→goal hierarchy, status enums, `createdBy`/`approvedBy` FK to users |
| **Tasks** | PostgreSQL | Relational: goal→task hierarchy, dependencies, `output` as JSONB |
| **Team registry** | PostgreSQL | Merge into `teams` table — redundant collection |
| **Agent definitions** | PostgreSQL | Relational: team→agent, JSONB for capabilities/config |
| **Chat messages** | MongoDB | Document: variable schema (streamParts, contextMessages as JSON blobs), append-heavy, no joins needed |
| **Code index snapshots** | MongoDB | Document: binary blobs, symbol arrays, no relations |
| **CRDT documents** | Hocuspocus | Y.js binary state, managed by collab-service persistence |
| **Auth (users, sessions)** | PostgreSQL | better-auth has Drizzle adapter — share the same PG connection |

### Hybrid Architecture (Current Implementation)

```
ServiceRegistry
├── mode: "cloud" | "local" | "hybrid"
│
├── teams: PluginTeamService           ← NO DATABASE — reads plugin folders (unchanged in all modes)
├── teamRegistry: PgTeamService        ← PostgreSQL — ownership, access control, FK anchor for goals/tasks
├── chat: MongoChatService             ← MongoDB (stays — document-shaped, append-heavy)
├── goals: PgGoalService               ← PostgreSQL
├── tasks: PgTaskService               ← PostgreSQL
│
├── Auth: better-auth
│   └── adapter: drizzle (PostgreSQL)  ← shares same PG connection
│
└── CRDT: Hocuspocus
    └── S3 blob storage (production)
```

**Note:** `PluginTeamService` remains the source of truth for team discovery (derived from plugin folders). `PgTeamService` provides ownership/membership and the FK target (`agent_teams`) that goals and tasks reference.

### What Changes

| Before | After |
|--------|-------|
| `MongoTeamRegistryService` | Merged into `PgTeamService.teams` + `team_members` tables |
| `MongoGoalService` | `PgGoalService` with FK to teams, `createdBy`/`approvedBy` FK to users |
| `MongoTaskService` | `PgTaskService` with FK to goals, `output` as JSONB, cascading deletes |
| `PluginTeamService` (file-based) | Stays for reading plugin configs; PG stores runtime team data |
| `MongoChatService` | **Stays in MongoDB** — document shape is the right fit |
| SQLite implementations | Deprecated — PostgreSQL replaces both Mongo and SQLite for relational data |
| `auth.db` (separate SQLite) | Drizzle adapter shares same PG connection |

---

## PostgreSQL Schema (Drizzle ORM)

### GitHub-Style Ownership Model

Agent teams use direct user ownership by default, with optional organization assignment for shared teams.

```
users (better-auth)
  │
  ├── agent_teams (created_by → user, org_id NULL)     ← user-owned (default)
  │    └── goals → tasks (cascade)
  │
  └── organizations (explicit creation)
       ├── org_members (userId, role: owner/admin/member/viewer)
       └── agent_teams (created_by → user, org_id → org)  ← org-owned (opt-in)
            └── goals → tasks (cascade)
```

**Key insight:** Agent teams always have a `created_by` user (the creator). `org_id` is nullable — NULL means user-owned, set means org-owned. Organizations are created explicitly when users want shared teams. No phantom "Personal" org.

**Access control (two-path):**
- **User-owned** (org_id NULL): only `created_by` has access
- **Org-owned** (org_id set): check `org_members` table for role-based access
- Transfer: `POST /api/v2/teams/:teamId/transfer` moves team to/from org

```typescript
// packages/backend/db/schema.ts

import { pgTable, text, timestamp, integer, jsonb, pgEnum, primaryKey, uuid, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member", "viewer"]);
export const goalStatusEnum = pgEnum("goal_status", [
  "pending", "planning", "researching", "awaiting_approval", "executing", "completed", "failed"
]);
export const taskStatusEnum = pgEnum("task_status", [
  "ready", "pending", "in_progress", "completed", "failed", "discarded"
]);

// ═══════════════════════════════════════════════════════════════
// Auth tables managed by better-auth Drizzle adapter (auto-created)
// users, sessions, accounts, verifications
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// HUMAN LAYER — organizations and membership (opt-in)
// ═══════════════════════════════════════════════════════════════

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  plan: text("plan").default("free"),       // free | pro | enterprise
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMembers = pgTable("org_members", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),        // FK to better-auth users
  role: orgRoleEnum("role").notNull().default("member"),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.userId] }),
]);

// ═══════════════════════════════════════════════════════════════
// AGENT LAYER — agent teams, goals, tasks
// GitHub-style: created_by for direct ownership, org_id optional
// ═══════════════════════════════════════════════════════════════

export const agentTeams = pgTable("agent_teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),  // nullable
  createdBy: text("created_by").notNull(),   // direct user ownership (always set)
  teamId: text("team_id").notNull(),         // SHA-256 hash of pluginName
  name: text("name").notNull(),
  description: text("description"),
  pluginName: text("plugin_name").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  goalId: text("goal_id").notNull(),         // business identifier (unique-indexed)
  agentTeamId: uuid("agent_team_id").notNull().references(() => agentTeams.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),   // FK to users (who submitted the goal)
  title: text("title").notNull(),
  status: goalStatusEnum("status").notNull().default("pending"),
  repoUrl: text("repo_url"),
  repoBranch: text("repo_branch"),
  planId: text("plan_id"),
  approvedBy: text("approved_by"),           // FK to users (who approved the plan)
  result: text("result"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: text("task_id").notNull(),         // business identifier (unique within goal)
  goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  title: text("title"),
  description: text("description").notNull(),
  status: taskStatusEnum("status").notNull().default("pending"),
  assignedRole: text("assigned_role").notNull(),
  priority: integer("priority").default(3),
  planId: text("plan_id"),
  output: jsonb("output"),                    // { summary, deliverables }
  dependencies: text("dependencies").array(),  // taskId[]
  inputDocs: jsonb("input_docs"),              // DocumentRef[] — context for this task
  producedDocs: jsonb("produced_docs"),         // DocumentRef[] — outputs from this task
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const agentDefinitions = pgTable("agent_definitions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  agentTeamId: uuid("agent_team_id").notNull().references(() => agentTeams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  description: text("description"),
  goal: text("goal"),
  capabilities: jsonb("capabilities"),
  systemPrompt: text("system_prompt"),
  config: jsonb("config"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### Relationship Diagram

```
users (better-auth)
  │
  ├──< agent_teams (created_by → user)           ← direct ownership
  │     ├── org_id: NULL (user-owned)
  │     │   └── access: created_by only
  │     └── org_id: UUID (org-owned)
  │         └── access: org_members role check
  │
  ├──< organizations
  │     └──< org_members (userId, role)
  │
  └──< agent_teams.org_id ──> organizations       ← optional FK
        │
        ├──< agent_definitions (role, capabilities)
        │
        └──< goals (createdBy → users, approvedBy → users)
              │
              └──< tasks (assignedRole, dependencies, output)
```

### Access Control Flow

```
User wants to approve a plan for goal G in agent team AT:

1. Look up goal G → get agentTeamId
2. Look up agent team AT → get org_id and created_by

If org_id IS NULL (user-owned):
  3. Check: userId === created_by? → allow : deny

If org_id IS NOT NULL (org-owned):
  3. Check org_members: does userId exist for orgId?
  4. Check role: owner/admin/member → allow. viewer → deny (read-only).
```

**Two access paths, one boundary.** User-owned teams are simple (creator only). Org-owned teams use role-based access via org_members. Transfer moves a team between the two modes.

### What Stays in MongoDB

```
chatmessages collection:
  teamId, agentId, userId, goalId, taskId?
  role, content, streamParts?, contextMessages?, agentLayer?
  timestamp

  Note: goalId is required on all new messages (enforced at API boundary).
  Legacy messages with goalId: null may exist but no new ones are created.

indexsnapshots collection (unchanged):
  branchId, searchIndex (Buffer), symbols[], fileStates[]
```

---

## Access Control

Access control uses two paths depending on team ownership:

**User-owned teams** (org_id NULL): only the `created_by` user has full access.

**Org-owned teams** (org_id set): authorization is role-based via `org_members`.

| Action | creator (user-owned) | owner | admin | member | viewer |
|--------|---------------------|-------|-------|--------|--------|
| Submit goal | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve plan | ✅ | ✅ | ✅ | ✅ | ❌ |
| Reject/replan | ✅ | ✅ | ✅ | ✅ | ❌ |
| Start task | ✅ | ✅ | ✅ | ✅ | ❌ |
| View documents | ✅ | ✅ | ✅ | ✅ | ✅ |
| View chat | ✅ | ✅ | ✅ | ✅ | ✅ |
| Transfer team | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage org settings | — | ✅ | ✅ | ❌ | ❌ |
| Add/remove members | — | ✅ | ✅ | ❌ | ❌ |
| Delete org | — | ✅ | ❌ | ❌ | ❌ |

---

## Migration Path

### Phase 1: Add PostgreSQL + Drizzle (1 day)

```
Step 1: bun add drizzle-orm @neondatabase/serverless (or pg)
Step 2: packages/backend/db/schema.ts — Drizzle schema
Step 3: packages/backend/db/connection.ts — pg pool from DATABASE_URL env
Step 4: drizzle-kit generate + migrate
Step 5: Wire better-auth to use Drizzle adapter (same PG)
```

### Phase 2: PostgreSQL Service Implementations (2 days)

```
Step 6: packages/backend/services/postgres/PgGoalService.ts
Step 7: packages/backend/services/postgres/PgTaskService.ts  
Step 8: packages/backend/services/postgres/PgTeamService.ts
        (merges PluginTeamService read + TeamRegistryService write)
Step 9: Update ServiceRegistry — add "hybrid" mode:
        PostgreSQL for teams/goals/tasks, MongoDB for chat/indexes
```

### Phase 3: Data Migration Script (1 day)

```
Step 10: scripts/migrate-to-pg.ts
  - Read teams from teamregistries → insert into PG teams
  - Read goals from goals → insert into PG goals
  - Read tasks from tasks → insert into PG tasks
  - Verify counts
  - chatmessages stays in MongoDB (no migration)
```

### Phase 4: Ownership + Access Control (2 days)

```
Step 11: team_members table with roles
Step 12: Middleware: check membership on Socket.IO + HTTP
Step 13: Frontend: manage members, role badges
```

### Phase 5: Cleanup (0.5 day)

```
Step 14: Remove MongoGoalService, MongoTaskService, MongoTeamRegistryService
Step 15: Remove SqliteGoalService, SqliteTaskService, SqliteTeamRegistryService
Step 16: Keep: MongoChatService, auth.db (or migrate auth to PG too)
Step 17: Update config: DATABASE_URL required for production
```

---

## Environment Configuration

```bash
# Current (cloud mode)
MONGODB_URI=mongodb://localhost:27017/ping
PING_MODE=cloud

# After migration (hybrid mode)
DATABASE_URL=postgresql://user:pass@localhost:5432/ping    # NEW
MONGODB_URI=mongodb://localhost:27017/ping                 # Kept for chat
PING_MODE=hybrid                                           # NEW mode
```

---

## Effort Estimate

| Phase | What | Effort |
|-------|------|--------|
| 1 | PostgreSQL + Drizzle setup | 1 day |
| 2 | 3 PG service implementations | 2 days |
| 3 | Migration script | 1 day |
| 4 | Ownership + access control | 2 days |
| 5 | Cleanup | 0.5 day |
| **Total** | | **~6.5 days** |

---

## CRDT Document Scoping (Goal Isolation)

### How It Works Today

Hocuspocus has no concept of "folders." Every CRDT document is a flat key — a string name. Goal isolation is achieved through a **naming convention** enforced by `CollaborationSpace`:

```
Document naming: {teamId}/{goalId}/{docType}

Examples:
  team-abc/goal-123/plan           → plan doc for goal-123
  team-abc/goal-123/task-1/task    → task doc for task-1 in goal-123
  team-abc/goal-123/task-1/report  → completion report for task-1
  team-abc/goal-123/goal           → goal metadata doc
  team-abc/goal-123/agent-statuses → agent status tracker
  team-abc/goal-456/plan           → completely separate plan for goal-456
```

**On disk** (Hocuspocus blob storage): slashes are flattened to underscores for safe filenames.
```
yjs/team-abc_goal-123_plan.bin
yjs/team-abc_goal-123_task-1_task.bin
yjs/team-abc_goal-456_plan.bin
```

### Isolation Guarantees

| Guarantee | How | Code |
|-----------|-----|------|
| **Goal A can't see Goal B's docs** | `CollaborationSpace` prefixes every `openDoc()` call with `{teamId}/{goalId}/` | `CollaborationSpace.ts` constructor |
| **Agents only access their goal** | Each worker gets a `CollaborationSpace` scoped to its task's `goalId` | `L2CollaborationPlugin.getOrCreateSpace(goalId)` |
| **Discovery is goal-scoped** | `collab discover` only shows docs within the agent's `CollaborationSpace` prefix | `tools/index.ts` discover action |
| **Archival disconnects cleanly** | `archiveSpace(goalId)` disconnects all docs for that goal prefix | `L2CollaborationPlugin.archiveSpace()` |
| **Only team owner can access docs** | ⚠️ NOT YET ENFORCED — `onAuthenticate` must validate session, extract `teamId` from doc name, call `PgTeamService.canAccess(userId, teamId)`. User-owned teams: only `created_by`. Org-owned teams: only `org_members`. | See [task-002](tasks/task-002-crdt-access-control.md) |

### Full CRDT Lifecycle for a Goal

```
1. USER SENDS GOAL
   └─ GoalManager.getOrCreateGoal(goalId)
   └─ No CRDT docs created yet

2. PLANNER STARTS
   └─ CollaborationPlugin.setGoalId(goalId)
   └─ L2CollaborationPlugin.getOrCreateSpace(goalId)
       └─ Creates CollaborationSpace with prefix "{teamId}/{goalId}/"
   └─ Planner gets collab tool scoped to this space
   └─ Planner writes plan doc: {teamId}/{goalId}/plan

3. USER APPROVES PLAN
   └─ GoalManager.approvePlan(goalId)
   └─ CrdtTaskSync.persistTask() for each task
       └─ Creates: {teamId}/{goalId}/{taskId}/task
   └─ CrdtTaskSync.persistPlan() updates plan doc status

4. WORKERS EXECUTE TASKS
   └─ Each worker gets collab tool scoped to SAME CollaborationSpace
   └─ Workers read: {teamId}/{goalId}/{taskId}/task (their own task)
   └─ Workers read: {teamId}/{goalId}/plan (shared plan)
   └─ Workers read: {teamId}/{goalId}/{otherTaskId}/task (upstream tasks)
   └─ Workers write: {teamId}/{goalId}/{taskId}/report (completion report)
   └─ Worker agent-statuses: {teamId}/{goalId}/agent-statuses

5. GOAL COMPLETES
   └─ GoalManager disposes agents
   └─ archiveSpace(goalId) disconnects in-memory refs
   └─ Blob files remain on disk (see Goal Document Archival below)
   └─ Frontend can still view docs read-only via Hocuspocus WebSocket
```

**What agents within a goal CAN see:**
- The plan doc (shared — all agents read it)
- All task docs in the goal (agents read upstream outputs for context)
- Agent status tracker (who is busy/idle)
- Discussion threads per task
- Completion reports from other tasks (for downstream context via `inputDocs`)

**What agents within a goal CANNOT see:**
- Any doc from another goal (`CollaborationSpace` prefix prevents it)
- Any doc from another team (different `teamId` prefix)

### How Each Component Connects to CRDT

| Component | Connection type | Gets space from | Auth |
|-----------|----------------|-----------------|------|
| **Planner agent** | In-process `openDirectConnection` | `CollabMcpServer.getTools(context)` → `l2.getOrCreateSpace(goalId)` | Trusted (same process) |
| **Worker agents** | In-process `openDirectConnection` | Same as planner — `getTools` resolves goal from `context.goalId` | Trusted (same process) |
| **Frontend editor** | WebSocket `HocuspocusProvider` | `docId` prop passed from React component | ⚠️ No auth — see task-002 |
| **Remote agents** (future) | WebSocket `RemoteCollabClient` | Constructor with `serverUrl` + `token` | ⚠️ No auth — see task-002 |

**Key insight:** Backend agents use in-process connections (no WebSocket, no auth needed — they're the same Node.js process). The auth gap only matters for frontend WebSocket connections and future remote agent connections.

### What This Means for Parallel Goals

**Each goal gets its own exclusive CRDT workspace.** The team does not have a shared CRDT space — all coordination happens within a single goal's namespace. When agents need to collaborate, they do so through the goal's `CollaborationSpace`, not through any team-level documents.

Two goals running simultaneously in the same team get fully separate doc namespaces:

```
Goal A (executing):                Goal B (planning):
  team-abc/goal-A/plan              team-abc/goal-B/plan
  team-abc/goal-A/task-1/task       team-abc/goal-B/goal
  team-abc/goal-A/task-1/report     (no tasks yet)
  team-abc/goal-A/task-2/task
```

- Each goal's planner writes to its own plan doc
- Each goal's workers read/write their own task docs
- **No cross-goal coordination** — agents on Goal A cannot read or write Goal B's docs
- **No team-level CRDT docs** — there is no `{teamId}/team/*` namespace. All CRDT docs belong to a specific goal.
- Both served by the same Hocuspocus server instance (shared infrastructure, isolated data)
- `CollaborationSpace` always requires a `goalId` — there is no team-scoped space

**Design rationale:** The CRDT workspace is the coordination surface for agents working on a goal. If agents could see other goals' docs, it would create confusion and cross-contamination. Each goal is a self-contained unit with its own plan, tasks, reports, and discussions.

### File Workspace Scoping

The git file workspace is team-scoped with per-goal branching:

```
data/workspaces/{teamId}/              → shared repo clone
  .ping/collaboration/                  → CRDT projections (auto-written)
  src/...                               → agent working files

Per-goal isolation via git branches:
  goal-{goalId}/task-{taskId}           → worktree branch per task
```

Each task gets its own git worktree/branch off the team repo. Two goals editing the same repo don't conflict because they work on separate branches. The `WorkspacePlugin` creates branches scoped by `goalId` and `taskId`.

### Goal Document Archival

**Problem:** Completed goals leave behind CRDT blob files (`yjs/{teamId}_{goalId}_*.bin`) forever. Over many goals, storage grows unbounded. The current `archiveSpace(goalId)` only disconnects in-memory references — it does NOT delete files from disk or S3.

**Current behavior on goal completion:**
1. `GoalManager.onTaskComplete()` detects all tasks done → emits `goal_status_changed: "completed"`
2. `disposeGoalAgents(goal)` is called → planners and chat agents disposed
3. `archiveSpace(goalId)` is NOT called — nothing touches CRDT docs
4. Blob files remain on disk indefinitely

**What exists for archival (building blocks):**

| Component | Method | What it does | What's missing |
|-----------|--------|-------------|----------------|
| `BlobStorageProvider` | `delete?(key)` | Deletes a single blob file | Optional — not always implemented |
| `BlobStorageProvider` | `list?(prefix)` | Lists blobs by prefix | Optional — not always implemented |
| `FsBlobStorage` | `delete(key)` | `fs.unlink(path)` | ✅ Implemented |
| `FsBlobStorage` | `list(prefix)` | `fs.readdir(dir)` | ✅ Implemented |
| `HocuspocusServer` | `getDocNames()` | Lists all loaded + persisted doc names | Can filter by `{teamId}/{goalId}/` prefix |
| `Hocuspocus` | `closeConnections(docName)` | Disconnects all clients from a doc | Server-side eviction from memory |
| `Hocuspocus` | `unloadDocument(doc)` | Removes doc from in-memory Map | Frees memory |
| `L2CollaborationPlugin` | `archiveSpace(goalId)` | Disconnects client-side refs | Does NOT touch server/storage |

**Archival strategy (not yet implemented):**

```
Goal completes:
  1. GoalManager emits "completed"
  2. Collect all doc names matching prefix {teamId}/{goalId}/*
     → getDocNames().filter(name => name.startsWith(prefix))
  3. For each doc:
     a. closeConnections(docName)     — kick any connected clients
     b. unloadDocument(doc)           — free server memory
     c. blobStorage.delete(key)       — remove persisted blob
  4. archiveSpace(goalId)             — clean up client-side refs
  5. Delete .ping/collaboration/ projections from workspace dir
```

**Questions to decide later:**
- Should completed goal docs be kept for N days before deletion? (audit trail)
- Should we snapshot to a cold archive (separate S3 prefix) before deleting?
- Should the frontend be able to view completed goal docs read-only? (if yes, don't delete immediately)
- Should workspace git branches for completed goals be pruned?

**For now:** CRDT docs for completed goals stay on disk. This is acceptable for early usage. Archival/cleanup is a future optimization tracked in the roadmap under Phase 3 (CRDT Team Workspace) / Phase 6 (CRDT Intelligence).
