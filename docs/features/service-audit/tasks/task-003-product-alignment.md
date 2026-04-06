# Task 003: Product Alignment Check

**Status:** `not-started`  
**Depends on:** task-001, task-002  
**Estimated:** 2-3 hours  
**Branch:** `feature/service-audit`

## Description
Cross-reference TeamService and SkillRegistryService with the product architecture (`docs/ping/architecture.md`). Verify both Design Mode (Team Builder) and Execution Mode (Runtime) are properly supported. Identify gaps and misalignments.

## Acceptance Criteria
- [ ] Design Mode flow verified: RoleManager → agent synthesis → TeamService → team config
- [ ] Execution Mode flow verified: TeamService → AgentManagerV2 → Orchestrator → Workers
- [ ] Missing concepts identified (templates, cloning, versioning, etc.)
- [ ] Wrong abstractions identified (delegation model, member model, etc.)
- [ ] Gap analysis documented in `feature_implementation.md`

## Implementation Notes
- Reference: `docs/ping/architecture.md` — System Overview, Component Interaction
- Reference: `docs/ping/agent.md` — Agent model
- Check: AgentManagerV2 → what does it need from TeamService on startup?
- Check: WorkerPool → what does it need from TeamService per task?
- Check: OrchestratorService → does it query TeamService at all?

## Alignment Checklist

**Design Mode (Team Builder):**
- [ ] Can RoleManager create a team via TeamService?
- [ ] Can synthesized agents be added to a team?
- [ ] Is `agentYaml` the right config format for agent definitions?
- [ ] Can the Team Builder export a team config?
- [ ] Can a team be created from a template?
- [ ] Can a team be cloned/versioned?

**Execution Mode (Runtime):**
- [ ] Does `getTeam()` return everything AgentManagerV2 needs to bootstrap?
- [ ] Does agent status (`idle`/`working`/`failed`) get tracked during execution?
- [ ] Does the skill loading pipeline work: `getAgentSkills()` → `SkillResolver` → AI SDK tools?
- [ ] Does the planner use `findSkillForTask()` for automatic skill assignment?
- [ ] Is `TeamSettings.executionMode` (`parallel`/`sequential`) actually used by the orchestrator?
- [ ] Is `TeamSettings.maxConcurrency` enforced by WorkerPool?

**Missing Concepts (from product vision):**
- [ ] Team templates (pre-configured teams for common use cases)
- [ ] Team cloning (duplicate a working team config)
- [ ] Agent config versioning (track changes to agent definitions)
- [ ] Team-level workspace config (currently `getWorkspace()` returns basic info)
- [ ] Team-level cost tracking hooks

**Wrong Concepts (possibly doesn't fit product):**
- [ ] `delegateAgent`/`reclaimAgent` — Is agent sharing between teams actually needed? Or was this speculative?
- [ ] `TeamMember` with roles (`manager`/`member`/`viewer`) — Is user management per-team needed now or is it future scope?
- [ ] `installCount` on skills — meaningful for internal skills or marketplace-only?

## Deliverable
A written alignment report in `feature_implementation.md` with:
- List of gaps (product needs X, services don't provide it)
- List of misalignments (services provide X, product doesn't need it)
- Recommendations: add, remove, defer to later phase

## Testing
- No code changes in this task — analysis only
- Results feed into tasks 004-006
