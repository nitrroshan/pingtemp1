# Task 004: Resolve Skill Duplication

**Status:** `not-started`  
**Depends on:** task-001, task-002  
**Estimated:** 3-4 hours  
**Branch:** `feature/service-audit`

## Description
Both TeamService and SkillRegistryService have agent-skill binding methods (`assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`) using DIFFERENT Mongoose models. Consolidate to a single source of truth.

## Acceptance Criteria
- [ ] Single canonical location for agent-skill assignments identified
- [ ] Duplicate model/schema removed
- [ ] All callers updated to use the canonical source
- [ ] No runtime errors (existing tests pass)
- [ ] API routes still work (SkillSelector UI functional)

## Implementation Notes

**Current duplication:**
- `packages/backend/team/models.ts` → `AgentSkillModel` (Mongoose schema: `agentId`, `skillId`, `enabled`, `config`)
- `packages/backend/skills/schema/agentSkillSchema.ts` → `AgentSkillModel` (Mongoose schema: `agentId`, `skillId`, `assignedAt`)
- TeamService methods: `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`, `setSkillEnabled`
- SkillRegistryService methods: `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`, `getAgentsWithSkill`

**Callers to check:**
- `packages/backend/services/WorkerPool.ts` → which `getAgentSkills` does it call?
- `packages/backend/skills/SkillResolver.ts` → which skill loading path?
- `packages/backend/api/HttpServer.ts` → team routes vs skill routes
- `packages/backend/skills/api/skillsRouter.ts` → skill-specific routes
- Frontend SkillSelector → which API endpoint?

**Options:**
- A) TeamService owns bindings (it owns agents, skill assignment is per-agent-in-team)
- B) SkillRegistryService owns bindings (it owns skills, binding is skill-centric)
- C) Merge schemas, pick one service as canonical, other delegates

## Code TODOs
- `packages/backend/team/models.ts` — TODO(task-004): Resolve AgentSkillModel duplication
- `packages/backend/skills/schema/agentSkillSchema.ts` — TODO(task-004): Resolve AgentSkillModel duplication

## Testing
- Run existing `TeamService.test.ts` after changes
- Run `packages/backend/skills/scripts/skills.test.ts` after changes
- Verify SkillSelector UI still toggles skills correctly
- Verify WorkerPool loads correct skills at runtime
