# Task 001: TeamService Method-by-Method Audit

**Status:** `not-started`  
**Estimated:** 2-3 hours  
**Branch:** `feature/service-audit`

## Description
Review all 19 TeamService methods. For each method, determine: who calls it, whether the product needs it, and whether the implementation is correct. Fill in the verdict table from the implementation plan.

## Acceptance Criteria
- [ ] Every method has a caller identified (or confirmed unused)
- [ ] Every method has a product-need verdict (keep/remove/refactor)
- [ ] Callers verified via grep (not assumed)
- [ ] Unused routes identified
- [ ] Results documented in `feature_implementation.md`

## Implementation Notes
- File: `packages/backend/team/TeamService.ts` (19 public methods)
- File: `packages/backend/team/types/index.ts` (type definitions)
- File: `packages/backend/api/HttpServer.ts` (routes that call TeamService)
- Check: `packages/backend/agentManager/AgentManagerV2.ts` (runtime usage)
- Check: `packages/backend/services/WorkerPool.ts` (runtime usage)

## Audit Checklist

**Team CRUD:**
- [ ] `createTeam` — callers? schema correct? auto-planner creation needed?
- [ ] `getTeam` — returns `TeamWithAgents` — does Runtime need all of this?
- [ ] `listTeams` — filters useful? pagination needed?
- [ ] `updateTeam` — what fields are updateable? missing any?
- [ ] `deleteTeam` — cascading deletes correct? (agents, members, skills)

**Agent Management:**
- [ ] `addAgent` — `agentYaml` field — is YAML the right config format?
- [ ] `getTeamAgents` — used by Runtime to load team
- [ ] `removeAgent` — prevents removing planner — correct?
- [ ] `updateAgentStatus` — is this called from Runtime? Or dead?

**Delegation:**
- [ ] `delegateAgent` — does agent sharing between teams make sense for our product?
- [ ] `reclaimAgent` — paired with delegate — same question

**Skills:**
- [ ] `assignSkillToAgent` — duplicates SkillRegistryService. Which is canonical?
- [ ] `removeSkillFromAgent` — same duplication
- [ ] `getAgentSkills` — called by WorkerPool? Which model does it use?
- [ ] `setSkillEnabled` — used by SkillSelector UI

**Members:**
- [ ] `addMember` — is team membership used by any UI?
- [ ] `removeMember` — paired with addMember
- [ ] `getTeamMembers` — any consumer?

**Other:**
- [ ] `getWorkspace` — returns `WorkspaceInfo` — does frontend use this?
- [ ] `createPlannerAgent` (private) — hardcoded YAML — should this be configurable?

## Testing
- No code changes in this task — audit only
- Results feed into tasks 003-006
