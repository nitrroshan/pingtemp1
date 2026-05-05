# Team & Goal Ownership + Hybrid Database — Implementation Planning

**Date:** May 4, 2026  
**Version:** v1.0 foundation  
**Status:** in progress (Steps 1-6 complete, tested end-to-end)  
**Architecture:** [feature_architecture.md](./feature_architecture.md)

## Branch

- `feature/team-ownership-v1.0`
- Branch from `dev`, not from `main`

## Scope

> **Phase alignment:** This feature is **Phase 2** in the platform roadmap (`docs/PLATFORM-ROADMAP.md`): "Hybrid Database + Team Ownership". It delivers the database foundation and ownership model that later phases (parallel goals, process isolation) build on.

This version delivers the Phase 2 backend foundation:

- PostgreSQL + Drizzle for relational data
- `hybrid` runtime mode in the backend
- PostgreSQL-backed agent team instances, goals, tasks, and organization membership
- better-auth moved onto the PostgreSQL connection in hybrid mode
- migration path from existing MongoDB and SQLite relational data
- organization-level authorization for HTTP and Socket.IO (canAccess + canMutate on all paths)

Out of scope for this version:

- Frontend member management UI (invite, remove, role display) — future iteration
- process isolation, Redis, or queueing (Phase 5)
- CRDT memory/search features (Phases 2 and 6)
- broad frontend workspace redesign

## Schema Cleanup Plan

The PG schema is the **clean, canonical schema** — not a 1:1 copy of old Mongo/SQLite fields. This section covers ALL data models in the system, using PostgreSQL naming conventions (snake_case, explicit FKs, typed enums).

### Design Principle: DB UUIDs as PKs

Every table uses **DB-generated UUIDs** (`gen_random_uuid()`) as primary keys. Business identifiers (goalId, taskId, teamId) are stored as **separate unique-indexed columns** for lookups.

| Concern | Approach |
|---------|----------|
| **Primary key** | `uuid DEFAULT gen_random_uuid()` — DB guarantees uniqueness |
| **Business identifiers** | Unique-indexed text columns (`goal_id`, `task_id`, `team_id`) |
| **Foreign keys** | Reference UUID PKs (stable, never change) |
| **Lookups** | Service layer resolves business ID → UUID via index, then uses UUID for joins |
| **Business code** | Never sees UUIDs — service layer maps to/from Goal/Task interfaces |

Why not use business IDs as PKs:
- Task IDs (`task-1`) are LLM-generated — not guaranteed globally unique
- Team IDs (SHA-256) are deterministic but could collide if hash changes
- FKs should reference immutable values — UUIDs never change, business IDs might

### Naming Conventions

| Convention | Rule | Example |
|-----------|------|---------|
| Table names | Plural snake_case | `goals`, `chat_messages`, `org_members` |
| Column names | Snake_case | `agent_team_id`, `created_by`, `assigned_role` |
| Primary keys | `id` | Every table |
| Foreign keys | `<referenced_table_singular>_id` | `goal_id`, `org_id`, `agent_team_id` |
| Timestamps | `created_at`, `updated_at` | Consistent everywhere |
| Enums | `<domain>_<name>` | `goal_status`, `task_status`, `org_role` |
| Indexes | `idx_<table>_<columns>` | `idx_goals_team`, `idx_tasks_goal_status` |
| Booleans | `is_<adjective>` | `is_active`, `is_archived` |

---

### Table 1: `organizations`

Human teams — companies/orgs that own agent teams.

| Column | Type | Nullable | Default | Notes |
|--------|------|:--------:|---------|-------|
| `id` | uuid PK | ✗ | `gen_random_uuid()` | DB-generated |
| `name` | text | ✗ | — | Display name |
| `plan` | text | ✓ | `'free'` | free / pro / enterprise |
| `created_at` | timestamp | ✓ | `now()` | |

**Old source:** `teamregistries` collection (Mongo) / `team_registry` table (SQLite) → merged into orgs + members

---

### Table 2: `org_members`

Organization membership with role-based access.

| Column | Type | Nullable | Default | Notes |
|--------|------|:--------:|---------|-------|
| `org_id` | uuid FK → organizations | ✗ | — | CASCADE delete |
| `user_id` | text | ✗ | — | FK to better-auth users |
| `role` | org_role enum | ✗ | `'member'` | owner / admin / member / viewer |
| `joined_at` | timestamp | ✓ | `now()` | |

**PK:** Composite `(org_id, user_id)`  
**Index:** `idx_org_members_user` on `user_id`  
**Old source:** `teamregistries.ownerId` → becomes `role: 'owner'` in this table

---

### Table 3: `agent_teams`

AI agent teams — work units with agents loaded from plugins.

| Column | Type | Nullable | Default | Notes |
|--------|------|:--------:|---------|-------|
| `id` | uuid PK | ✗ | `gen_random_uuid()` | DB-generated |
| `team_id` | text UNIQUE | ✗ | — | Business ID (SHA-256 hash of pluginName) — lookup key |
| `org_id` | uuid FK → organizations | ✗ | — | CASCADE delete |
| `name` | text | ✗ | — | Display name (derived from pluginName) |
| `description` | text | ✓ | — | |
| `plugin_name` | text | ✗ | — | Plugin folder name |
| `is_active` | boolean | ✓ | `true` | Soft disable |
| `created_at` | timestamp | ✓ | `now()` | |

**Indexes:** `idx_agent_teams_team_id` (unique), `idx_agent_teams_org`, `idx_agent_teams_plugin`  
**Old source:** `teamregistries.teamId` + `pluginName` → merged here

---

### Table 4: `goals`

User goals — the top-level work unit.

| Column | Type | Nullable | Default | Notes |
|--------|------|:--------:|---------|-------|
| `id` | uuid PK | ✗ | `gen_random_uuid()` | DB-generated — internal only |
| `goal_id` | text UNIQUE | ✗ | — | Business identifier — used by rooms, frontend, orchestrator |
| `agent_team_id` | uuid FK → agent_teams | ✗ | — | CASCADE delete |
| `created_by` | text | ✗ | — | User who submitted the goal |
| `title` | text | ✗ | — | Goal text (was `goal` in old schema) |
| `status` | goal_status enum | ✗ | `'pending'` | pending / planning / researching / awaiting_approval / executing / completed / failed |
| `repo_url` | text | ✓ | — | Git repo URL for workspace |
| `repo_branch` | text | ✓ | — | Base branch |
| `plan_id` | text | ✓ | — | Current plan identifier |
| `approved_by` | text | ✓ | — | User who approved the plan |
| `result` | text | ✓ | — | Goal outcome summary |
| `created_at` | timestamp | ✓ | `now()` | |
| `updated_at` | timestamp | ✓ | `now()` | |

**Indexes:** `idx_goals_goal_id` (unique), `idx_goals_team`, `idx_goals_created_by`, `idx_goals_status`

**Old → New mapping:**

| Old (Mongo/SQLite) | New (PG) | Change |
|---------------------|----------|--------|
| `_id` (ObjectId) | `id` (uuid) | **DB-generated UUID PK** — stable for FKs, never exposed to business logic |
| `goalId` (slug) | `goal_id` (text) | **Unique-indexed column** — business identifier, used for all lookups |
| `teamId` | `agent_team_id` | Renamed — FK to agent_teams (references UUID PK) |
| `userId` | `created_by` | Renamed — clearer intent |
| `goal` | `title` | Renamed — `goal` confusing as column name |
| `status` (string) | `status` (enum) | Typed as PG enum |
| — | `approved_by` | **New** — tracks plan approver |

**PgGoalService.addGoal():** DB generates UUID PK (`gen_random_uuid()`). Business `goal_id` stored as a separate unique-indexed column. Service resolves `teamId` → UUID via `resolveTeamUuid()` for the FK.

---

### Table 5: `tasks`

Plan tasks — assigned to agents, executed in dependency order.

| Column | Type | Nullable | Default | Notes |
|--------|------|:--------:|---------|-------|
| `id` | uuid PK | ✗ | `gen_random_uuid()` | DB-generated — internal only |
| `task_id` | text | ✗ | — | Business identifier (e.g., "task-1") — unique within a goal |
| `goal_id` | uuid FK → goals | ✗ | — | CASCADE delete |
| `title` | text | ✓ | — | Short title |
| `description` | text | ✗ | — | Full task description |
| `status` | task_status enum | ✗ | `'pending'` | ready / pending / in_progress / completed / failed / discarded |
| `assigned_role` | text | ✗ | — | Lowercase role key |
| `priority` | integer | ✓ | `3` | 1=highest, 5=lowest |
| `plan_id` | text | ✓ | — | Which plan version |
| `output` | jsonb | ✓ | — | `{ summary, deliverables }` |
| `dependencies` | text[] | ✓ | — | Business task_id[] (not UUIDs) |
| `input_docs` | jsonb | ✓ | — | `DocumentRef[]` — context from upstream |
| `produced_docs` | jsonb | ✓ | — | `DocumentRef[]` — outputs |
| `decisions` | jsonb | ✓ | — | `Array<{ decision, rationale? }>` |
| `created_at` | timestamp | ✓ | `now()` | |
| `updated_at` | timestamp | ✓ | `now()` | |

**Indexes:** `idx_tasks_goal_task` (unique composite on `goal_id, task_id`), `idx_tasks_goal`, `idx_tasks_status`, `idx_tasks_role`

**Task ID uniqueness:** `task_id` is unique per goal via compound unique index `(goal_id, task_id)`. No prefixing hacks — the DB enforces uniqueness.

**Old → New mapping:**

| Old (Mongo/SQLite) | New (PG) | Change |
|---------------------|----------|--------|
| `_id` (ObjectId) | `id` (uuid) | **DB-generated UUID** replaces ObjectId |
| `taskId` | `task_id` | Business identifier as unique-indexed column |
| `goalId` | `goal_id` | UUID FK to goals.id (lookup via goals.goal_id index) |
| `teamId` | — | **Dropped** — derivable via goal → agent_team |
| — | `input_docs` | **New** — DocumentRef[] |
| — | `produced_docs` | **New** — DocumentRef[] |
| — | `decisions` | **New** — `[{ decision, rationale? }]` |

---

### Table 6: `agent_definitions`

Agent definitions — cached from plugin .md files + DB overrides.

| Column | Type | Nullable | Default | Notes |
|--------|------|:--------:|---------|-------|
| `id` | uuid PK | ✗ | `gen_random_uuid()` | DB-generated |
| `agent_team_id` | uuid FK → agent_teams | ✗ | — | CASCADE delete |
| `name` | text | ✗ | — | Display name |
| `role` | text | ✗ | — | Lowercase role key |
| `description` | text | ✓ | — | |
| `goal` | text | ✓ | — | Agent's objective |
| `capabilities` | jsonb | ✓ | — | Tools, skills, etc. |
| `system_prompt` | text | ✓ | — | Full system prompt |
| `config` | jsonb | ✓ | — | Model, settings, etc. |
| `created_at` | timestamp | ✓ | `now()` | |

**Index:** `idx_agent_defs_team`

---

### Chat Messages — STAYS IN MONGODB

Chat messages are document-shaped (variable JSON blobs, no joins, append-heavy). They stay in MongoDB, not PostgreSQL.

| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | MongoDB auto-generated |
| `teamId` | string | Index |
| `agentId` | string | Index |
| `userId` | string | Who sent |
| `goalId` | string? | Goal scope |
| `taskId` | string? | Task scope |
| `role` | "user" / "assistant" / "system" | Message role |
| `content` | string | Message text |
| `streamParts` | string? | JSON: tool calls, reasoning, etc. |
| `agentLayer` | "planner" / "chat-agent" / "worker" | Scopes session restore |
| `contextMessages` | string? | JSON: full AI SDK ModelMessage[] for LLM context restoration |
| `timestamp` | Date | |

**Indexes (MongoDB):**
- `{ teamId, timestamp }` — team-wide history
- `{ teamId, agentId, timestamp }` — per-agent conversation
- `{ teamId, goalId, timestamp }` — per-goal messages

**Why MongoDB:** `streamParts` and `contextMessages` are large, variable JSON blobs (tool call chains, reasoning traces). Append-only, no joins. Document DB is the right fit.

---

### Enums

```sql
CREATE TYPE goal_status AS ENUM (
  'pending', 'planning', 'researching', 'awaiting_approval',
  'executing', 'completed', 'failed'
);

CREATE TYPE task_status AS ENUM (
  'ready', 'pending', 'in_progress', 'completed', 'failed', 'discarded'
);

CREATE TYPE org_role AS ENUM (
  'owner', 'admin', 'member', 'viewer'
);
```

---

### JSONB Column Schemas

For reference — these are the shapes stored in JSONB columns:

**`tasks.output`:**
```json
{ "summary": "string", "deliverables": ["string"], "producedDocs": [DocumentRef] }
```

**`tasks.input_docs` / `tasks.produced_docs`:**
```json
[{ "uri": "workspace:src/api.ts", "name": "api-spec", "description": "...", "hint": "..." }]
```

**`tasks.decisions`:**
```json
[{ "decision": "Use PostgreSQL for relational data", "rationale": "FK constraints needed" }]
```

**`agent_definitions.config`:**
```json
{ "model": { "provider": "azure-openai", "deployment": "gpt-4o-2" }, "tools": [...], "skills": [...] }
```

**`agent_definitions.capabilities`:**
```json
{ "tools": ["Read", "Write", "Bash"], "skills": ["api-design"], "maxSteps": 200 }
```

---

### What Gets Dropped (Complete List)

| Old Data | Where | Why Drop |
|----------|-------|----------|
| MongoDB `_id` / SQLite `rowid` | Goals, Tasks | Database artifacts, never referenced |
| `goals.goalId` (separate column) | PG schema | Redundant — id IS goalId now |
| `tasks.teamId` | Tasks | Derivable via `goal_id → goals.agent_team_id` |
| `teamregistries` collection | MongoDB | Replaced by organizations + org_members + agent_teams |
| `team_registry` table | SQLite | Same — replaced by PG tables |
| `auth.db` (SQLite) | File system | Auth moves to PG via Drizzle adapter |

### Schema Migrations

| # | SQL | Status |
|---|-----|--------|
| 0000 | CREATE all 6 tables (uuid PKs + `gen_random_uuid()`) + 3 enums + unique indexes on business IDs | ✅ Generated (clean, replaces old migrations) |

---

## Implementation Steps

### 1. Add PostgreSQL and Drizzle foundation

**Files:** `packages/backend/package.json`, `packages/backend/db/schema.ts`, `packages/backend/db/connection.ts`, `packages/backend/drizzle.config.ts`, `packages/backend/.env.example`

**Work:**

1. Add `drizzle-orm` plus either `pg` or `@neondatabase/serverless` and `drizzle-kit`.
2. Create the base PostgreSQL connection helper using `DATABASE_URL`.
3. Define the Drizzle schema for `organizations`, `org_members`, `agent_teams`, `goals`, `tasks`, and `agent_definitions`.
4. Add migration generation and migration run commands.
5. Extend env documentation with `DATABASE_URL` and `PING_MODE=hybrid`.

**Exit criteria:** Backend can create the Phase 2 schema in an empty PostgreSQL database.

### 2. Move auth to the PostgreSQL adapter in hybrid mode

**Files:** `packages/backend/auth/index.ts`, `packages/backend/config/index.ts`

**Work:**

1. Extend config mode support from `local | cloud` to `local | cloud | hybrid`.
2. Keep local mode on SQLite.
3. Keep cloud mode behavior unchanged for now.
4. In hybrid mode, use the PostgreSQL-backed better-auth adapter on the shared connection.
5. Preserve existing cookie and provider behavior so auth remains a transport concern, not a feature rewrite.

**Exit criteria:** Sign-in, session restore, and socket auth still work when `PING_MODE=hybrid`.

### 3. Implement PostgreSQL persistence services

**Files:** `packages/backend/services/postgres/PgGoalService.ts`, `packages/backend/services/postgres/PgTaskService.ts`, `packages/backend/services/postgres/PgTeamService.ts`, `packages/backend/services/contracts/ITeamRegistryService.ts`, `packages/backend/services/contracts/index.ts`

**Work:**

1. Implement `PgGoalService` as the drop-in `IGoalService` replacement.
2. Implement `PgTaskService` as the drop-in `ITaskPersistence` replacement.
3. Implement `PgTeamService` to own organization, membership, and agent team records.
4. Replace single-owner semantics in `ITeamRegistryService` with membership-aware methods.
5. Preserve current service method shapes where possible so the rest of the app changes minimally.

**Exit criteria:** Goals, tasks, and team membership can be created, queried, and updated entirely through PostgreSQL-backed services.

### 4. Wire hybrid mode into the runtime

**Files:** `packages/backend/services/ServiceRegistry.ts`, `packages/backend/api/AgentManagerAPI.ts`, `packages/backend/api/HttpServer.ts`

**Work:**

1. Update `ServiceRegistry` to select PostgreSQL services for relational data in hybrid mode.
2. Keep `MongoChatService` for chat and index collections in hybrid mode.
3. Keep plugin-derived team definitions for discovery, but persist runtime ownership and team metadata in PostgreSQL.
4. Ensure service creation fails fast when `PING_MODE=hybrid` is set without `DATABASE_URL`.

**Exit criteria:** Starting the backend in hybrid mode produces a consistent service graph with PostgreSQL for relational state and MongoDB for chat.

### 5. Add migration tooling from MongoDB and SQLite

**Files:** `scripts/migrate-to-pg.ts` or `packages/backend/scripts/migrate-to-pg.ts`, `packages/backend/package.json`

**Work:**

1. Read team ownership from `teamregistries` or `team_registry`.
2. Create default organizations for existing single-owner teams.
3. Migrate goal records with `createdBy`, `approvedBy`, `planId`, repo fields, and status.
4. Migrate tasks with dependencies, priority, plan IDs, and output payloads.
5. Add dry-run, count verification, and idempotent upsert behavior.

**Exit criteria:** Migration can be run safely more than once and reports matching source and destination counts.

### 6. Enforce organization membership and role-based access

**Files:** `packages/backend/api/agentManagerHandlerV2.ts`, `packages/backend/api/SocketServerV2.ts`, `packages/backend/api/HttpServer.ts`, `packages/backend/services/postgres/PgTeamService.ts`

**Work:**

1. Replace owner-only checks with role-aware membership checks.
2. Authorize team creation, deletion, goal submission, plan approval, and room subscription based on org role.
3. Deny mutating actions for `viewer` users while preserving read access where the architecture allows it.
4. Centralize authorization helpers so HTTP and socket paths cannot drift.

**Exit criteria:** Membership role, not legacy ownership, controls access for all Phase 2 endpoints and socket actions.

### 7. Frontend: role-aware action gating (deferred — future iteration)

**Status:** Deferred to a follow-up PR. Backend enforcement (canAccess + canMutate) is complete. Frontend member management UI (invite, remove, role display, member list) requires new API endpoints and components that are out of scope for this foundational version.

**What IS enforced now (backend):**
- `GET /teams` — filters by membership (fail-closed on errors)
- `GET /teams/:id` — membership required
- `DELETE /teams/:id` — canMutate required (viewers denied)
- Socket actions (approve-plan, start-task, etc.) — canMutate required

**What's NOT built yet (frontend):**
- Member list display in team settings
- Role badges / current user's role display
- Invite / remove member UI
- Disable actions based on role (frontend relies on backend 403s for now)

### 8. Cleanup and cutover

**Files:** `packages/backend/services/mongo/MongoGoalService.ts`, `packages/backend/services/mongo/MongoTaskService.ts`, `packages/backend/services/mongo/MongoTeamRegistryService.ts`, `packages/backend/services/sqlite/SqliteGoalService.ts`, `packages/backend/services/sqlite/SqliteTaskService.ts`, `packages/backend/services/sqlite/SqliteTeamRegistryService.ts`

**Work:**

1. Keep legacy implementations during migration and verification.
2. Remove or deprecate them only after hybrid mode passes validation.
3. Update docs and config references so PostgreSQL is the required production path for relational data.

**Exit criteria:** No active relational write path remains on MongoDB or SQLite in the supported production configuration.

## Task Breakdown and Dependencies

1. Foundation and auth wiring must land before service implementations can be exercised.
2. Service implementations must land before migration and authorization cutover.
3. Migration should run before cleanup so rollback remains cheap.
4. Frontend changes should start after authorization rules are stable.

## Testing Strategy

- Unit tests for `PgGoalService`, `PgTaskService`, and `PgTeamService`
- Migration tests covering MongoDB source, SQLite source, dry-run mode, and repeated runs
- Integration tests for team creation, goal creation, plan approval, and task persistence in hybrid mode
- Auth regression tests for login, session restoration, and Socket.IO registration in hybrid mode
- Authorization tests for `owner`, `admin`, `member`, and `viewer` on HTTP and socket actions
- Manual verification with a seeded local stack: PostgreSQL + MongoDB + backend + frontend

## Rollback Plan

1. Keep `local` and `cloud` modes working during rollout.
2. Guard hybrid behavior strictly behind `PING_MODE=hybrid`.
3. Do not remove MongoDB or SQLite relational services until migration and hybrid tests pass.
4. If hybrid mode fails in staging, switch back to `cloud` or `local`, restore the previous auth adapter path, and rerun from the preserved source data.

## Estimated Effort

| Step | Effort |
|------|--------|
| PostgreSQL + Drizzle foundation | 1 day |
| Auth + runtime wiring | 0.5 day |
| PostgreSQL service implementations | 2 days |
| Migration tooling | 1 day |
| Authorization + frontend minimum | 2 days |
| Cleanup and cutover | 0.5 day |

**Total:** ~7 days

## Deliverable Definition

Phase 2 is complete when the backend can run in `hybrid` mode, persist relational state in PostgreSQL, keep chat in MongoDB, enforce organization membership roles (canAccess + canMutate) across HTTP and Socket.IO, and migrate existing relational records. Frontend member management UI (invite, role display, member list) is deferred to a follow-up iteration — the backend enforces access control, and the frontend relies on 403 responses for now.