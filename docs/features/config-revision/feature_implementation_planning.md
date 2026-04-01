# Config Revision + Rollback — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Unphased (after Data Persistence)  
**ID:** A9  
**Approach:** Option A — Revision Collection (Append-Only Snapshots)

---

## Branch
- `feature/config-revision`

## Scope (v1.0)
`ConfigRevisionModel` + middleware on TeamService CRUD. Revision history per entity. Rollback API.

## Implementation Steps

### Step 1: Create ConfigRevision Model
**Files to create:**
- `packages/backend/db/models/ConfigRevision.ts` — Mongoose model:
  ```
  { entityType, entityId, revision (auto-increment per entity), data (full snapshot), changedBy, reason, createdAt }
  ```
  Indexes: `{ entityType, entityId, revision }` (unique), `{ entityType, entityId, createdAt }`

**Exit criteria:** Model compiles, indexes created

### Step 2: Create Revision Middleware
**Files to create:**
- `packages/backend/services/ConfigRevisionService.ts` — `captureRevision(entityType, entityId, currentData, changedBy, reason?)` — reads current state, appends to revisions, returns new revision number. `rollback(entityType, entityId, targetRevision)` — read revision, overwrite main collection, append rollback as new revision.

**Exit criteria:** Capturing and rolling back revisions works

### Step 3: Wire into TeamService
**Files to modify:**
- `packages/backend/team/TeamService.ts` — Before every `updateTeam()`, `updateAgent()`, call `captureRevision()`. Pass `changedBy` from request context.

**Exit criteria:** Team/agent config changes auto-snapshot before overwrite

### Step 4: Add API Endpoints
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add:
  - `GET /api/v2/teams/:teamId/revisions` — list revision history
  - `GET /api/v2/teams/:teamId/revisions/:revision` — get specific revision
  - `POST /api/v2/teams/:teamId/rollback/:revision` — rollback to revision
  - `GET /api/v2/agents/:agentId/revisions` — agent revision history
  - `POST /api/v2/agents/:agentId/rollback/:revision` — rollback agent config

**Exit criteria:** Full API for viewing and restoring config revisions

### Step 5: Add Frontend Revision History (v1.1)
**Files to create:**
- `packages/frontend/components/RevisionHistory.tsx` — Panel in Team Settings showing: revision list with timestamps, changedBy, diff summary. "Restore" button per revision.

**Exit criteria:** Users can view and restore config revisions from UI

## Testing Strategy
- Test: update team → revision created with old state
- Test: rollback → main collection restored, new revision recorded
- Test: multiple updates → revision numbers increment correctly
- Test: rollback to non-existent revision → clear error

## Complexity
Low — 1-2 weeks.
