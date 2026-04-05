# Live Skill Refresh — Feature Architecture

**Status:** Planned  
**Date:** April 4, 2026  
**Parent:** Skills Integration (C3)  
**Depends on:** Skills Integration v1 (done), AI SDK Migration (done)

---

## Overview

When a user toggles a skill in the SkillSelector UI, the change should take effect on the agent's **very next message** — without restarting the server or creating a new task. Today, skills are loaded once at worker creation time and never updated.

### Current State (v1)
- SkillSelector UI saves skill assignments to MongoDB via REST API
- WorkerPool loads skills on first `runTask()` call per worker
- Subsequent messages reuse the same tool set — DB changes are ignored
- `refreshSkillTools()` exists but queries the full DB on every `runTask()` call (wasteful, currently in code)

### Target State
- Skill toggle in UI → incremental update pushed to WorkerPool in-memory
- Only the changed skill is resolved/removed — no full DB query
- Next agent `execute()` call uses the updated tool set
- No server restart, no new task creation needed

---

## Architecture Options

### Option A: Event-Driven Push via API → WorkerPool (Recommended)

**Implementation:**
1. API route handler (POST/DELETE skill) calls `workerPool.addSkill(role, skillId)` / `workerPool.removeSkill(role, skillId)` directly after DB write
2. WorkerPool maintains a `skillCache: Map<role, { skillIds: Set<string>, tools: Map<string, Tool> }>`
3. `addSkill()` resolves the single skill via SkillResolver, adds tool to cache + updates all active workers for that role
4. `removeSkill()` removes tool from cache + updates all active workers for that role
5. `runTask()` reads from cache (zero DB queries)

**Data flow:**
```
SkillSelector toggle
  → POST /api/v2/teams/:id/agents/:agentId/skills { skillId }
  → teamService.assignSkillToAgent(agentId, skillId)     ← 1. DB write (source of truth)
  → if DB write succeeds:
    → registry.getForTeam(teamId)                        ← 2. get AgentManager
    → manager.workerPool.addSkill(role, skillId)          ← 3. in-memory cache update
      → skillResolver.resolve([skillId])                  ← resolve single skill
      → skillCache[role].tools[skillId] = tool            ← cache update
      → for each active worker with this role:
          agent.setTools([...baseTools, ...skillCache[role].tools.values()])

On server restart:
  → first runTask() → load ALL skills from DB → populate cache (cold start)
  → subsequent requests → read from cache (zero DB queries)
```

**Pros:**
- Zero DB queries during `runTask()` — all reads from cache
- Incremental — only resolves the changed skill, not all skills
- Immediate effect — next message uses new tool set
- Simple mental model — API handler is the single source of truth

**Cons:**
- Tight coupling between API route and WorkerPool
- Cache can drift from DB if events are lost (edge case)
- Requires access to AgentManager from API route handler

**Effort:** 1-2 days

---

### Option B: Cache + TTL with Dirty Flag

**Implementation:**
1. WorkerPool caches resolved skills per role with a "dirty" flag
2. When API writes to DB, it sets the dirty flag on the skill cache
3. `runTask()` checks the dirty flag — if dirty, re-fetches ALL skills from DB
4. If not dirty, uses cached tools (zero DB query)

**Data flow:**
```
SkillSelector toggle
  → POST /api/v2/teams/:id/agents/:agentId/skills
  → teamService.assignSkillToAgent(agentId, skillId)     ← DB write
  → workerPool.markSkillsDirty(role)                     ← set flag

runTask(taskId, role, message)
  → if skillCache[role].dirty:
      → teamService.getAgentSkills(agentMongoId)          ← DB read (all skills)
      → skillResolver.resolve(allSkillIds)                ← resolve all
      → update cache, clear dirty flag
  → else: use cached tools
```

**Pros:**
- Simple implementation — just a boolean flag per role
- Consistent with DB — always re-verifies on next use
- No tight coupling between API and WorkerPool

**Cons:**
- Still does a full DB query + resolve-all when dirty (not incremental)
- Slight delay on first message after toggle (resolve latency)
- Dirty flag requires shared state between API and WorkerPool

**Effort:** 0.5-1 day

---

### Option C: EventEmitter on TeamService

**Implementation:**
1. TeamService extends EventEmitter
2. On skill assign/remove, emits `skill:changed` event with `{ teamId, agentId, role, skillId, action: 'add'|'remove' }`
3. WorkerPool subscribes to TeamService events
4. On event, incrementally resolves/removes the single skill

**Pros:**
- Clean separation of concerns — TeamService doesn't know about WorkerPool
- Reusable — other systems can subscribe to skill changes
- Incremental — only resolves the changed skill

**Cons:**
- TeamService doesn't currently know the agent's `role` — only has `agentId`
- Requires mapping agentId → role at event time
- More infrastructure than needed for a single subscriber

**Effort:** 1-2 days

---

## Recommendation

**Option A (Event-Driven Push via API → WorkerPool)** — simplest path to incremental updates with zero runtime DB queries. The API route already has access to teamId (for AgentManagerRegistry lookup) and the response includes the role. One subscriber (WorkerPool) doesn't justify a full EventEmitter system.

Option B is the fallback if Option A proves too tightly coupled — it's simpler but not incremental.

---

## Integration Points

| Component | Change |
|---|---|
| `packages/backend/api/routes/teams.ts` | After DB write, call `workerPool.addSkill()` / `removeSkill()` |
| `packages/backend/services/WorkerPool.ts` | Add `skillCache`, `addSkill()`, `removeSkill()` methods |
| `packages/backend/agentManager/AgentManagerRegistry.ts` | Expose `getForTeam()` to API routes (already exists) |
| `packages/backend/api/HttpServer.ts` | Pass `agentManagerRegistry` to team routes |

## Types

```typescript
interface SkillCacheEntry {
  skillIds: Set<string>;
  tools: Map<string, Tool>;  // skillId → resolved AI SDK tool
}

// WorkerPool additions
class WorkerPool {
  private skillCache: Map<string, SkillCacheEntry>;  // role → cache
  
  addSkill(role: string, skillId: string): Promise<void>;
  removeSkill(role: string, skillId: string): Promise<void>;
}
```

## Migration

1. Remove per-request `refreshSkillTools()` from `runTask()`
2. Initial load on first `runTask()` populates the cache (same as today)
3. Subsequent changes go through `addSkill()`/`removeSkill()` (incremental)
