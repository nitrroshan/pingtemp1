# Live Skill Refresh — Implementation Plan

**Approach:** Option A (Event-Driven Push via API → WorkerPool)  
**Date:** April 4, 2026

---

## Prerequisites
- [x] Skills Integration v1 — SkillSelector UI, DB assigns, WorkerPool loads on first `runTask()`
- [x] AI SDK Migration — `toAiSdkTool()` converter, `agent.setTools()` works

---

## Steps

### Step 1: Add `SkillCache` and `addSkill()`/`removeSkill()` to WorkerPool
**File:** `packages/backend/services/WorkerPool.ts`

1. Add `skillCache: Map<string, SkillCacheEntry>` (role → `{ skillIds: Set, tools: Map<string, Tool> }`)
2. Add `addSkill(role: string, skillId: string)`: resolves single skill → adds to cache → calls `rebuildToolsForRole(role)`
3. Add `removeSkill(role: string, skillId: string)`: removes from cache → calls `rebuildToolsForRole(role)`
4. Add `rebuildToolsForRole(role)`: for each active worker with matching role, calls `agent.setTools([...baseTools, ...skillCache[role].tools.values()])`
5. Modify first-run path in `runTask()`: populate `skillCache` from DB on cold start (existing `refreshSkillTools` logic), then read from cache
6. Remove per-request `refreshSkillTools()` call — replace with `getSkillToolsFromCache(role)` read

**Test:** Unit test that `addSkill()` adds tool to cache and `removeSkill()` removes it.

### Step 2: Pass `agentManagerRegistry` to team routes
**Files:** `packages/backend/api/HttpServer.ts`, `packages/backend/api/routes/teams.ts`

1. Update `createTeamRoutes(teamService, options?)` signature to accept optional `{ onSkillAssigned, onSkillRemoved }` callbacks
2. In HttpServer, create callbacks that resolve `agentManagerRegistry.getForTeam(teamId)` → `manager.workerPool.addSkill(role, skillId)` / `removeSkill()`
3. Pass callbacks to `createTeamRoutes()`

**Why callbacks instead of direct import:** The team routes already use `teamService` for DB ops. Adding callbacks keeps them decoupled from AgentManager internals. HttpServer already dynamically imports `agentManagerRegistry` (line 98-99) — the callbacks follow the same pattern.

### Step 3: Wire callbacks into skill assign/remove API routes
**File:** `packages/backend/api/routes/teams.ts`

1. After `teamService.assignSkillToAgent()` succeeds → call `onSkillAssigned?.(teamId, agentId, skillId)`
2. After `teamService.removeSkillFromAgent()` succeeds → call `onSkillRemoved?.(teamId, agentId, skillId)`
3. The callback resolves the agent's role using `teamService.getTeam(teamId)` agent list, then calls `workerPool.addSkill(role, skillId)` / `removeSkill()`
4. Callback failures are non-fatal — DB write already succeeded, log a warning

**Note:** The callback needs `teamId` (from `req.params.id`) and the agent's `role` (from DB or the existing agent data). The role can be fetched from the team's agent list.

### Step 4: Populate cache on cold start
**File:** `packages/backend/services/WorkerPool.ts`

1. In the first `runTask()` for a role, if `skillCache` has no entry for that role:
   - Fetch all skills from DB (existing code path)
   - Resolve all skills via SkillResolver
   - Populate `skillCache[role]` = `{ skillIds, tools }`
2. Subsequent `runTask()` calls read from cache (zero DB queries)
3. `addSkill()`/`removeSkill()` incrementally update the cache after cold start

### Step 5: Remove `refreshSkillTools()` per-request call
**File:** `packages/backend/services/WorkerPool.ts`

1. Remove the `refreshSkillTools()` call from `runTask()` (both new worker and existing worker paths)
2. Replace with `getSkillToolsFromCache(role)` which returns `[...skillCache[role].tools.values()]`
3. Keep `refreshSkillTools()` as private method for cold-start population only

---

## Verification

1. **Assign skill via UI** → backend logs `[WorkerPool] addSkill: code-review for role devops`
2. **Send message to agent** → `my_tools` tool shows the new skill in the tool list (no restart)
3. **Remove skill via UI** → next message no longer has the tool
4. **Restart server** → first message triggers cold-start DB load → subsequent messages use cache
5. **No DB queries** in WorkerPool after cold start (verify via MongoDB profiler or log absence)

---

## Files Changed

| File | Change |
|---|---|
| `packages/backend/services/WorkerPool.ts` | Add `skillCache`, `addSkill()`, `removeSkill()`, `rebuildToolsForRole()`, `getSkillToolsFromCache()`. Remove per-request `refreshSkillTools()` |
| `packages/backend/api/routes/teams.ts` | Accept `onSkillAssigned`/`onSkillRemoved` callbacks, call after DB write |
| `packages/backend/api/HttpServer.ts` | Create callbacks wiring `agentManagerRegistry` → `workerPool.addSkill()`/`removeSkill()`, pass to `createTeamRoutes()` |

---

## Edge Cases

- **Multiple workers for same role** (e.g., parallel tasks): `rebuildToolsForRole()` updates ALL workers, not just one
- **Skill assigned before any worker created**: Cache stores the entry, first `runTask()` picks it up from cache
- **Skill assigned to agent not in active team**: Callback silently no-ops (team not loaded in registry)
- **SkillResolver fails for a skill**: Log error, skip that skill, don't break the assign flow
- **Race condition — assign during execution**: Tool set updates between `execute()` calls, not mid-execution. Safe.
