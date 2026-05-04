# Team & Goal Ownership Model — Feature Architecture

**Date:** May 4, 2026
**Status:** Architecture design
**Priority:** P1 — Foundation for multi-user access control + database strategy
**Depends on:** Auth system (better-auth — existing), MongoDB (existing)
**Related:** [conversation-persistence](../conversation-persistence/feature_architecture.md), [auth-security](../auth-security/)

---

## Problem

1. **No ownership hierarchy** — teams have no owner/members, goals have no creator/approver
2. **Wrong database for relational data** — teams, users, memberships, and permissions are relational by nature but stored in MongoDB (document DB)
3. **Schema inconsistency** — `teamId` duplicated on tasks/messages for query performance, but no foreign key enforcement

---

## Database Strategy: Hybrid (PostgreSQL + MongoDB)

Use each database for its natural strength:

```
PostgreSQL (relational, enforced integrity)          MongoDB (document, flexible schema)
═══════════════════════════════════════              ═══════════════════════════════════
users                                                chatmessages
  id, email, name, avatar                              goalId, agentId, userId
                                                       role, content, streamParts
teams                                                  contextMessages, agentLayer
  id, name, description, pluginName
                                                     indexsnapshots
team_members                                           branchId, searchIndex, symbols
  teamId → teams, userId → users, role

goals
  id, teamId → teams, createdBy → users
  title, status, repoUrl, approvedBy → users

tasks
  id, goalId → goals, assignedRole
  title, description, status, priority
  planId, dependencies[]
  output (JSONB)

agentregistries
  id, teamId → teams, name, role
  description, capabilities (JSONB)
```

**Why this split:**

| Data Type | PostgreSQL | MongoDB | Reason |
|-----------|-----------|---------|--------|
| Users, teams, members | ✅ | | Relational: FK constraints, unique emails, role enums |
| Goals, tasks | ✅ | | Relational: team→goal→task hierarchy, status enums, cascading deletes |
| Chat messages | | ✅ | Document: variable schema (streamParts, contextMessages as JSON blobs), append-heavy, no joins |
| Code index snapshots | | ✅ | Document: binary blobs, symbol arrays, no relations |
| CRDT documents | | ✅ (Hocuspocus) | Y.js binary state, managed by Hocuspocus persistence layer |
| Agent registries | ✅ | | Relational: team-scoped, capabilities as JSONB |

**Key principle:** Relational data (who owns what, who can do what) → PostgreSQL. Content data (messages, streams, indexes) → MongoDB. CRDT state → Hocuspocus blob storage.

---

## Migration Path

### Phase 1: Add PostgreSQL for Teams/Goals/Tasks (this feature)

**No MongoDB removal yet.** Add PostgreSQL alongside MongoDB. Migrate relational collections.

```
Step 1: Add PostgreSQL connection + Drizzle ORM
  - packages/backend/db/schema.ts — Drizzle schema definitions
  - packages/backend/db/connection.ts — pg pool
  - .env: DATABASE_URL=postgresql://...

Step 2: Create PostgreSQL schemas
  - users (id, email, name, avatarUrl, createdAt)
  - teams (id, name, description, pluginName, createdAt)
  - team_members (teamId FK, userId FK, role, joinedAt)
  - goals (id, teamId FK, createdBy FK, title, status, repoUrl, repoBranch, planId, approvedBy, createdAt, updatedAt)
  - tasks (id, goalId FK, title, description, status, assignedRole, priority, planId, output JSONB, dependencies TEXT[], createdAt, updatedAt)
  - agent_definitions (id, teamId FK, name, role, description, capabilities JSONB, systemPrompt TEXT)

Step 3: New service implementations
  - PgTeamService implements ITeamService
  - PgGoalService implements IGoalService
  - PgTaskService implements ITaskPersistence
  - Wire via ServiceRegistry based on DATABASE_URL env var

Step 4: Migration script
  - Read from MongoDB collections
  - Write to PostgreSQL tables
  - Verify counts match
  - Switch ServiceRegistry to use Pg implementations

Step 5: Remove MongoDB for migrated collections
  - Drop: teamregistries, goals, tasks collections
  - Keep: chatmessages, indexsnapshots
```

### Phase 2: Ownership + Access Control (after migration)

```
Step 6: team_members table with roles
  - owner: full control
  - member: create goals, approve plans
  - viewer: read-only

Step 7: Middleware enforcement
  - SocketActionHandler: check membership before approve/reject/start
  - SocketMessageHandler: check membership before sendMessage
  - HTTP routes: check ownership for team management

Step 8: Frontend
  - Team settings page: manage members
  - Role badges in UI
  - Disable actions for viewers
```

### Phase 3: Clean up MongoDB (after Phase 2 stable)

```
Step 9: chatmessages stays in MongoDB (good fit)
Step 10: indexsnapshots stays in MongoDB (good fit)
Step 11: Remove old Mongoose schemas for migrated collections
Step 12: Update ServiceRegistry to not initialize unused Mongo models
```

---

## Schema Design (PostgreSQL — Drizzle ORM)

```typescript
// packages/backend/db/schema.ts

import { pgTable, text, timestamp, integer, jsonb, pgEnum, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";

export const teamRoleEnum = pgEnum("team_role", ["owner", "member", "viewer"]);
export const goalStatusEnum = pgEnum("goal_status", ["pending", "planning", "researching", "awaiting_approval", "executing", "completed", "failed"]);
export const taskStatusEnum = pgEnum("task_status", ["ready", "pending", "in_progress", "completed", "failed", "discarded"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),              // from better-auth
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  pluginName: text("plugin_name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: teamRoleEnum("role").notNull().default("member"),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.teamId, t.userId] }),
}));

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: goalStatusEnum("status").notNull().default("pending"),
  repoUrl: text("repo_url"),
  repoBranch: text("repo_branch"),
  planId: text("plan_id"),
  approvedBy: text("approved_by").references(() => users.id),
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
  output: jsonb("output"),
  dependencies: text("dependencies").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  goalIdx: uniqueIndex("tasks_goal_id_idx").on(t.goalId, t.id),
}));

export const agentDefinitions = pgTable("agent_definitions", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  description: text("description"),
  capabilities: jsonb("capabilities"),
  systemPrompt: text("system_prompt"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### What stays in MongoDB

```typescript
// chatmessages — append-heavy, variable schema, no relational needs
interface ChatMessage {
  teamId: string;       // denormalized for query perf (no PG join needed)
  agentId: string;
  userId: string;
  goalId?: string;
  taskId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  streamParts?: string;     // large JSON blob
  contextMessages?: string; // large JSON blob
  agentLayer?: string;
  timestamp: Date;
}

// indexsnapshots — binary blobs, no relations
interface IndexSnapshot {
  branchId: string;
  searchIndex: Buffer;   // gzipped binary
  symbols: any[];
  fileStates: any[];
}
```

---

## Pros/Cons of Hybrid

**Pros:**
- Foreign key enforcement prevents orphaned tasks/goals
- Cascading deletes: delete team → all goals + tasks gone
- Proper enum types for status fields
- Team membership is a real join table, not embedded array
- Chat messages stay document-shaped (right fit for MongoDB)
- Each DB used for its strength

**Cons:**
- Two database connections to manage
- Deployment complexity: need both PostgreSQL and MongoDB
- Cross-DB queries impossible (task → its messages requires two queries)
- More infrastructure to maintain

**Mitigation:** ServiceRegistry already abstracts database access. Adding a second connection is a config change, not an architectural one.

---

## What NOT to Migrate

| Stay in MongoDB | Reason |
|----------------|--------|
| `chatmessages` | Append-heavy, variable schema, large JSON blobs, no relational needs |
| `indexsnapshots` | Binary data, no relations |
| Hocuspocus CRDT blobs | Managed by Hocuspocus persistence, not our schema |

---

## Effort Estimate

| Phase | What | Effort |
|-------|------|--------|
| 1a | PostgreSQL + Drizzle setup, schema | 1 day |
| 1b | PgTeamService, PgGoalService, PgTaskService | 2 days |
| 1c | Migration script + ServiceRegistry wiring | 1 day |
| 2 | Membership, access control, middleware | 2 days |
| 3 | MongoDB cleanup | 0.5 day |
| **Total** | | **~6.5 days** |
