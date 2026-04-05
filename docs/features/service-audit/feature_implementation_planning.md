# Phase 3A: TeamService & SkillService Audit — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 3A  
**Branch:** `feature/service-audit`

---

## Scope

Audit TeamService (19 methods) and SkillRegistryService (15 methods) against product vision. Fix gaps, remove dead code, consolidate duplicates. Cross-reference with `docs/ping/architecture.md` (Design Mode + Execution Mode).

---

## Implementation Steps

### Step 1: TeamService Method-by-Method Audit
**Tag: AUDIT**

Review each of the 19 TeamService methods:

| Method | Used By | Product Need | Verdict |
|---|---|---|---|
| `createTeam` | HttpServer, seed script | ✅ Core — Team Builder output | Keep |
| `getTeam` | HttpServer, AgentManagerV2 | ✅ Core — Runtime loads team | Keep |
| `listTeams` | HttpServer, frontend | ✅ Core — Team switcher | Keep |
| `updateTeam` | HttpServer | ✅ Core — Team settings | Keep |
| `deleteTeam` | HttpServer | ✅ Core — Team cleanup | Keep |
| `addAgent` | HttpServer, seed script | ✅ Core — Team Builder adds agents | Keep |
| `getTeamAgents` | HttpServer, AgentManagerV2 | ✅ Core — Runtime loads agents | Keep |
| `removeAgent` | HttpServer | ✅ Core — Remove from team | Keep |
| `updateAgentStatus` | WorkerPool? | ❓ Check — is Runtime updating status? | Audit |
| `delegateAgent` | HttpServer | ❓ Check — is agent sharing needed? | Audit |
| `reclaimAgent` | HttpServer | ❓ Check — paired with delegate | Audit |
| `assignSkillToAgent` | HttpServer | ❓ Check — duplicates SkillRegistry? | Audit |
| `removeSkillFromAgent` | HttpServer | ❓ Check — duplicates SkillRegistry? | Audit |
| `getAgentSkills` | WorkerPool | ✅ Core — Runtime loads skills | Keep (resolve duplication) |
| `setSkillEnabled` | HttpServer | ✅ Core — SkillSelector UI | Keep |
| `addMember` | HttpServer | ❓ Check — is member model used? | Audit |
| `removeMember` | HttpServer | ❓ Check — paired with addMember | Audit |
| `getTeamMembers` | HttpServer | ❓ Check — paired with addMember | Audit |
| `getWorkspace` | HttpServer | ❓ Check — used by frontend? | Audit |

**Deliverable:** Filled verdict column. List of methods to remove/refactor.

### Step 2: SkillRegistryService Method-by-Method Audit
**Tag: AUDIT**

Review each of the 15 SkillRegistryService methods:

| Method | Used By | Product Need | Verdict |
|---|---|---|---|
| `createSkill` | seedOfficialSkills, skillsRouter | ✅ Core — Skill registration | Keep |
| `getSkill` | skillsRouter, SkillResolver | ✅ Core — Skill lookup | Keep |
| `getAllSkills` | skillsRouter, frontend | ✅ Core — Skill browser | Keep |
| `updateSkill` | skillsRouter | ✅ Core — Skill editing | Keep |
| `deleteSkill` | skillsRouter | ✅ Core — Skill removal | Keep |
| `incrementInstallCount` | assignSkillToAgent | ❓ Check — is install count meaningful for internal skills? | Audit |
| `searchSkills` | skillsRouter | ❓ Check — is semantic search used by frontend? | Audit |
| `findSimilarSkills` | skillsRouter | ❓ Check — when would frontend use this? | Audit |
| `assignSkillToAgent` | skillsRouter | ❓ Check — duplicates TeamService? | Audit |
| `removeSkillFromAgent` | skillsRouter | ❓ Check — duplicates TeamService? | Audit |
| `getAgentSkills` | skillsRouter | ❓ Check — duplicates TeamService? | Audit |
| `getAgentsWithSkill` | skillsRouter | ❓ Check — is this needed? | Audit |
| `findSkillForTask` | None? | ❓ Check — should planner use this? | Audit |
| `getStats` | skillsRouter | ❓ Check — is dashboard needed? | Audit |

**Deliverable:** Filled verdict column. Identify duplication with TeamService.

### Step 3: Product Alignment Check
**Tag: AUDIT**

Cross-reference with `docs/ping/architecture.md`:

- **Design Mode (Team Builder):** Does TeamService support RoleManager → agent synthesis → team config export? Check: can the Team Builder create a team, add synthesized agents, export config?
- **Execution Mode (Runtime):** Does TeamService support AgentManager → Orchestrator → Workers flow? Check: does `getTeam()` return everything AgentManagerV2 needs? Does agent status tracking work?
- **Missing concepts:** Team templates? Team cloning? Team versioning? Agent config versioning?
- **Wrong concepts:** Is `delegateAgent`/`reclaimAgent` from a different product model?

**Deliverable:** Written alignment report. List of gaps and misalignments.

### Step 4: Resolve Skill Duplication
**Tag: REFACTOR**

**The problem:** Both TeamService and SkillRegistryService have `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`. They use DIFFERENT Mongoose models (`team/models.ts` AgentSkillModel vs `skills/schema/agentSkillSchema.ts` AgentSkillModel).

**Decision:** Pick one source of truth. Options:
- A) TeamService owns agent-skill bindings (it owns agents)
- B) SkillRegistryService owns agent-skill bindings (it owns skills)
- C) Separate AgentSkillService (join table service)

**Deliverable:** Single source of truth for agent-skill assignments. Dead model removed.

### Step 5: Dead Code Removal
**Tag: CLEANUP**

Based on audit results:
- Remove methods that nothing calls and no product need justifies
- Remove unused Mongoose models and schemas
- Remove unused API routes that serve no UI
- Remove unused imports and types
- Remove speculative features that don't match product vision

**Deliverable:** Cleaner codebase. Every remaining method has a caller or clear product justification.

### Step 6: Execute Modifications
**Tag: REFACTOR**

Based on gap analysis from Step 3:
- Add missing methods/fields if product needs them
- Refactor wrong abstractions
- Update schema if model changes needed
- Update tests to reflect changes
- Verify golden path still works

**Deliverable:** Services match product vision. Golden path passes.

---

## Exit Criteria

- [ ] Every TeamService method has a verdict (keep/remove/refactor)
- [ ] Every SkillRegistryService method has a verdict
- [ ] Skill duplication resolved (single source of truth)
- [ ] Dead code removed
- [ ] Product alignment verified OR modifications completed
- [ ] Golden path smoke test passes
- [ ] Written report documenting decisions

---

## Testing Strategy

- After Step 4 (duplication fix): Run existing TeamService + SkillRegistryService tests
- After Step 5 (dead code removal): Verify no runtime errors, no broken imports
- After Step 6 (modifications): Run full test suite + golden path smoke test
