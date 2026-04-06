# Task 002: SkillRegistryService Method-by-Method Audit

**Status:** `completed`  
**Estimated:** 2-3 hours  
**Branch:** `feature/service-audit`

## Description
Review all 15 SkillRegistryService methods. For each method, determine: who calls it, whether the product needs it, and whether the implementation is correct. Identify overlaps with TeamService skill methods.

## Acceptance Criteria
- [ ] Every method has a caller identified (or confirmed unused)
- [ ] Every method has a product-need verdict (keep/remove/refactor)
- [ ] Duplication with TeamService skill methods cataloged
- [ ] Semantic search pipeline (embeddings) verified working or flagged
- [ ] Results documented in `feature_implementation.md`

## Implementation Notes
- File: `packages/backend/skills/services/SkillRegistryService.ts` (15 public methods)
- File: `packages/backend/skills/types/Skill.ts` (Skill type)
- File: `packages/backend/skills/types/AgentSkill.ts` (AgentSkill type)
- File: `packages/backend/skills/api/skillsRouter.ts` (routes)
- File: `packages/backend/skills/SkillResolver.ts` (runtime resolution)
- File: `packages/backend/skills/SkillIntegration.ts` (integration layer)

## Audit Checklist

**Skill CRUD:**
- [ ] `createSkill` — schema complete? supports AI SDK + LangChain + MCP tool types?
- [ ] `getSkill` — lookup by `skillId` (string, not ObjectId) — consistent?
- [ ] `getAllSkills` — pagination? filtering? used by frontend skill browser?
- [ ] `updateSkill` — what fields updateable? re-embeds on update?
- [ ] `deleteSkill` — cascading delete of agent assignments?

**Search:**
- [ ] `searchSkills` — vector search + fallback. Does Atlas Vector Search work in dev? Is embedding generation reliable?
- [ ] `findSimilarSkills` — who calls this? frontend or backend?
- [ ] `findSkillForTask` — is Orchestrator/Planner using this for automatic skill assignment? If not, should it?

**Agent-Skill Binding (DUPLICATION CHECK):**
- [ ] `assignSkillToAgent` — uses `AgentSkillModel` from `skills/schema/`. TeamService uses `AgentSkillModel` from `team/models.ts`. DIFFERENT SCHEMAS.
- [ ] `removeSkillFromAgent` — same duplication
- [ ] `getAgentSkills` — returns `Skill[]` (full skill objects). TeamService returns `AgentSkill[]` (binding records). Which does WorkerPool/SkillResolver actually need?
- [ ] `getAgentsWithSkill` — reverse lookup. Any consumer?

**Stats:**
- [ ] `incrementInstallCount` — called when skill assigned. Meaningful for internal skills?
- [ ] `getStats` — total skills, by source, by tag. Dashboard UI exists?

## Key Questions
1. Is the `Skill` schema complete for Phase 5 (MCP tools)?
2. Does `SkillResolver.resolve()` handle all tool types correctly?
3. Should `findSkillForTask()` be wired into the planner for auto-skill assignment?
4. Is the embedding pipeline (`EmbeddingService`) actually working or stubbed?

## Testing
- No code changes in this task — audit only
- Results feed into tasks 003-006
