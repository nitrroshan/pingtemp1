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

### Two-Tier Team Model

```
organizations (human teams — companies/orgs)
  ├── id, name, plan (free/pro/enterprise)
  ├── members: org_members (userId, role: owner/admin/member)
  │
  └── agent_teams (work units with AI agents)
       ├── id, orgId → organizations
       ├── name, description, pluginName
       ├── agents (from plugin .md files + DB overrides)
       │
       └── goals
            ├── id, agentTeamId → agent_teams
            ├── createdBy → users, approvedBy → users
            └── tasks (id, goalId → goals, ...)
```

**Key insight:** Agent teams don't know about users — they only see goals. Human teams own agent teams and control who can submit goals.

```typescript
// packages/backend/db/schema.ts

import { pgTable, text, timestamp, integer, jsonb, pgEnum, primaryKey } from "drizzle-orm/pg-core";

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
// HUMAN LAYER — organizations and membership
// ═══════════════════════════════════════════════════════════════

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").default("free"),       // free | pro | enterprise
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMembers = pgTable("org_members", {
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),        // FK to better-auth users
  role: orgRoleEnum("role").notNull().default("member"),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.userId] }),
}));

// ═══════════════════════════════════════════════════════════════
// AGENT LAYER — agent teams, goals, tasks
// Agent teams don't know about users — only goals
// ═══════════════════════════════════════════════════════════════

export const agentTeams = pgTable("agent_teams", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  pluginName: text("plugin_name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),              // = goalId (business identifier IS the PK)
  agentTeamId: text("agent_team_id").notNull().references(() => agentTeams.id, { onDelete: "cascade" }),
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
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
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
  id: text("id").primaryKey(),
  agentTeamId: text("agent_team_id").notNull().references(() => agentTeams.id, { onDelete: "cascade" }),
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
organizations (human teams)
  │
  ├──< org_members (userId, role)
  │     └── FK → better-auth users
  │
  └──< agent_teams (pluginName, agents)
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
2. Look up agent team AT → get orgId
3. Check org_members: does userId exist for orgId with role owner/admin/member?
4. If yes → allow. If viewer or not a member → deny.
```

**Agent teams never check users directly.** The authorization boundary is at the organization level. The agent team just executes goals — it doesn't know or care who submitted them.

### What Stays in MongoDB

```
chatmessages collection (unchanged):
  teamId, agentId, userId, goalId?, taskId?
  role, content, streamParts?, contextMessages?, agentLayer?
  timestamp

indexsnapshots collection (unchanged):
  branchId, searchIndex (Buffer), symbols[], fileStates[]
```

---

## Access Control (org_members)

Authorization is at the **organization** level. Agent teams are just execution units.

| Action | owner | admin | member | viewer |
|--------|-------|-------|--------|--------|
| Create agent team | ✅ | ✅ | ❌ | ❌ |
| Delete agent team | ✅ | ❌ | ❌ | ❌ |
| Submit goal | ✅ | ✅ | ✅ | ❌ |
| Approve plan | ✅ | ✅ | ✅ | ❌ |
| Reject/replan | ✅ | ✅ | ✅ | ❌ |
| Start task | ✅ | ✅ | ✅ | ❌ |
| View documents | ✅ | ✅ | ✅ | ✅ |
| View chat | ✅ | ✅ | ✅ | ✅ |
| Manage org settings | ✅ | ✅ | ❌ | ❌ |
| Add/remove members | ✅ | ✅ | ❌ | ❌ |
| Delete org | ✅ | ❌ | ❌ | ❌ |

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
