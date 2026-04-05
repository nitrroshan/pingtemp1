# Phase 3A: TeamService & SkillService Audit — Architecture

**Status:** Planned  
**Phase:** 3A  
**ID:** Phase 3A  
**Parent:** [ROADMAP Phase 3](../ROADMAP.md)

---

## Overview

Verify that TeamService (19 methods) and SkillRegistryService (15 methods) match the product's actual needs before Phase 3C packages them. Fix gaps, remove unnecessary code, ensure alignment with Design Mode (Team Builder) + Execution Mode (Runtime) from `docs/ping/architecture.md`.

**Why now:** These services were scaffolded during Phase 1/2. Before package extraction (3C), the foundation must be verified. Fixing after extraction is 10x harder.

---

## Audit Scope

### TeamService (19 methods)

| Category | Methods | Check Against |
|---|---|---|
| **Team CRUD** | `createTeam`, `getTeam`, `listTeams`, `updateTeam`, `deleteTeam` | Does the Team model support templates, cloning, versioning? Is `ownerId`/manager model correct? |
| **Agent Management** | `addAgent`, `getTeamAgents`, `removeAgent`, `updateAgentStatus` | Does this support Runtime agent lifecycle (idle/working/failed)? Is `agentYaml` the right config format? |
| **Delegation** | `delegateAgent`, `reclaimAgent` | Does this make sense for our execution model? Is agent sharing between teams needed? |
| **Skills** | `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`, `setSkillEnabled` | Duplication with SkillRegistryService? Which is the source of truth? |
| **Members** | `addMember`, `removeMember`, `getTeamMembers` | Is the member/role model (`manager`/`member`/`viewer`) sufficient? |
| **Workspace** | `getWorkspace` | Does this integrate with L1 workspace layer? Is workspace per-team correct? |
| **Planner** | `createPlannerAgent` (private) | Is the hardcoded YAML template appropriate? Should planner be configurable? |

### SkillRegistryService (15 methods)

| Category | Methods | Check Against |
|---|---|---|
| **Skill CRUD** | `createSkill`, `getSkill`, `getAllSkills`, `updateSkill`, `deleteSkill` | Is the Skill schema complete? Does it support all tool types (AI SDK, LangChain, MCP)? |
| **Search** | `searchSkills`, `findSimilarSkills`, `findSkillForTask` | Does semantic search work? Is `findSkillForTask()` used by the planner? Should it be? |
| **Agent-Skill Binding** | `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`, `getAgentsWithSkill` | Overlaps with TeamService skill methods — which owns this? |
| **Stats** | `getStats`, `incrementInstallCount` | Is install count meaningful for internal skills? |

### Cross-Cutting Concerns

| Concern | Question |
|---|---|
| **Duplicate models** | TeamService has its own `AgentSkillModel` AND SkillRegistryService has `AgentSkillModel` (different schemas). Which is canonical? |
| **Design Mode support** | Does TeamService support the Team Builder flow (RoleManager → agent synthesis → config export)? |
| **Execution Mode support** | Does TeamService support Runtime flow (AgentManager coordinates team, workers execute tasks)? |
| **Dead code** | Are there methods that nothing calls? Routes that serve no UI? Models with unused fields? |

---

## Decision Framework

For each method/concept:

1. **Used by product?** → Keep, possibly refine
2. **Will be used soon (Phase 3-4)?** → Keep, mark for enhancement
3. **Premature/speculative?** → Remove (YAGNI)
4. **Wrong abstraction?** → Refactor with clear migration
5. **Duplicated?** → Consolidate to single source of truth

---

## Expected Outcomes

- **Best case:** Services are ~80% correct. Minor additions, remove dead code. 1-2 days of changes.
- **Moderate case:** Significant gaps in team model (missing template support, wrong delegation model). 3-4 days of refactoring.
- **Worst case:** Schema redesign needed. Would add a migration step before 3C. Plan accordingly.

---

## References

- [Product Architecture](../../ping/architecture.md) — Design Mode + Execution Mode
- [TeamService](../../../packages/backend/team/TeamService.ts)
- [SkillRegistryService](../../../packages/backend/skills/services/SkillRegistryService.ts)
- [ROADMAP Phase 3](../ROADMAP.md)
