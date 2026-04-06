# Phase 3A: TeamService & SkillService Audit — Implementation Log

**Parent:** [Implementation Plan](feature_implementation_planning.md)  
**Branch:** `copilot/complete-roadmap-3-frontend-backend`

---

## Progress

| Step | Task | Status |
|---|---|---|
| 1 | TeamService method-by-method audit | completed |
| 2 | SkillRegistryService method-by-method audit | completed |
| 3 | Product alignment check | completed |
| 4 | Resolve skill duplication | completed |
| 5 | Dead code removal | completed (partial — see notes) |
| 6 | Execute modifications | completed (maxConcurrency wired) |

---

## Key Findings (Tasks 001-003)

### TeamService — All Methods KEEP

All 19 methods have active callers. No dead code found.

| Method | Verdict | Caller |
|---|---|---|
| `createTeam` | ✅ Keep | HttpServer, seed script |
| `getTeam` | ✅ Keep | HttpServer, AgentManagerV2 |
| `listTeams` | ✅ Keep | HttpServer, frontend |
| `updateTeam` | ✅ Keep | HttpServer |
| `deleteTeam` | ✅ Keep | HttpServer |
| `addAgent` | ✅ Keep | HttpServer, seed script |
| `getTeamAgents` | ✅ Keep | HttpServer, AgentManagerV2 |
| `removeAgent` | ✅ Keep | HttpServer |
| `updateAgentStatus` | ✅ Keep | WorkerPool (calls `this.updateAgentStatus` private) + API route |
| `delegateAgent` | ✅ Keep | `packages/backend/api/routes/teams.ts:394` |
| `reclaimAgent` | ✅ Keep | `packages/backend/api/routes/teams.ts:423` |
| `assignSkillToAgent` | ✅ Keep (canonical) | agentManagerHandlerV2, teams route |
| `removeSkillFromAgent` | ✅ Keep (canonical) | teams route |
| `getAgentSkills` | ✅ Keep (canonical) | WorkerPool.refreshSkillTools() |
| `setSkillEnabled` | ✅ Keep | teams route (SkillSelector UI) |
| `addMember` | ✅ Keep | teams route, called internally in createTeam |
| `removeMember` | ✅ Keep | teams route |
| `getTeamMembers` | ✅ Keep | teams route, used in getTeam |
| `getWorkspace` | ✅ Keep | teams route |

### SkillRegistryService — Dead Methods Found

| Method | Verdict | Notes |
|---|---|---|
| `createSkill` | ✅ Keep | seedOfficialSkills, skillsRouter |
| `getSkill` | ✅ Keep | skillsRouter, SkillResolver |
| `getAllSkills` | ✅ Keep | skillsRouter, frontend |
| `updateSkill` | ✅ Keep | skillsRouter |
| `deleteSkill` | ✅ Keep | skillsRouter |
| `incrementInstallCount` | ✅ Keep | skillsRouter on assign |
| `searchSkills` | ✅ Keep | skillsRouter |
| `findSimilarSkills` | ✅ Keep | skillsRouter |
| `assignSkillToAgent` | ⚠️ Duplicate | Fixed — now uses canonical AgentSkillModel |
| `removeSkillFromAgent` | ⚠️ Duplicate | Fixed — now uses canonical AgentSkillModel |
| `getAgentSkills` | ⚠️ Duplicate | Fixed — now uses canonical AgentSkillModel |
| `getAgentsWithSkill` | ⚠️ Dead (mostly) | Only in registry test; kept for completeness |
| `findSkillForTask` | ⚠️ Not wired | Only in test; tracked as future Orchestrator integration |
| `getStats` | ✅ Keep | skillsRouter stats endpoint, agentManagerHandlerV2 |

---

## Key Changes

### Task 004: Skill Duplication Fixed

**Root cause**: Two competing `AgentSkillModel` mongoose registrations:
- `packages/backend/skills/schema/agentSkillSchema.ts` → `agentId: String` (no `enabled` field)
- `packages/backend/team/models.ts` → `agentId: ObjectId`, `enabled: boolean` (canonical)

Whichever module loaded first "won" the Mongoose model registry — causing silent data corruption.

**Fix**: `agentSkillSchema.ts` now re-exports from `team/models.ts` instead of defining its own schema. SkillRegistryService's agent-skill methods updated to handle ObjectId conversion (`Types.ObjectId.isValid(agentId)` guard).

### Task 006: TeamSettings.maxConcurrency wired into WorkerPool

- `WorkerPool.setMaxConcurrency(n)` added
- `AgentManagerV2.initializeOrchestrator()` accepts optional `teamSettings` parameter
- Concurrency limit enforced (warning log) when `workers.size >= maxConcurrency`
- `AgentManagerRegistry.loadTeam()` can now pass `teamSettings` when wiring

---

## Deviations from Plan

**Task 005 (Dead code)**: All TeamService methods have callers — no removal needed there. For SkillRegistryService, `getAgentsWithSkill` and `findSkillForTask` have no production callers but were kept (removal is low priority; they're useful for future planner integration).

## Decisions Made

- **TeamService owns agent-skill bindings** (Option A) — it owns agents, has `enabled` flag for SkillSelector UI
- `findSkillForTask()` deferred to Phase 4 planner integration — tracked in task-002
- `getWorkspace()` on TeamService still has a TODO for real Git integration (out of scope)

