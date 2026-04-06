# Task 006: Execute Modifications (Gap Fixes)

**Status:** `not-started`  
**Depends on:** task-003 (gap analysis), task-004 (duplication fix), task-005 (dead code removal)  
**Estimated:** 4-8 hours (depends on gap severity)  
**Branch:** `feature/service-audit`

## Description
Based on the product alignment check (task-003), implement any modifications needed to make TeamService and SkillRegistryService fit the product vision. This may be minimal (schema tweaks) or significant (new methods, model changes).

## Acceptance Criteria
- [ ] All gaps identified in task-003 either fixed or explicitly deferred with rationale
- [ ] Schema migrations (if any) documented and reversible
- [ ] Updated tests covering new/changed methods
- [ ] Golden path smoke test passes
- [ ] API documentation (Swagger) updated if routes changed
- [ ] Written confirmation in `feature_implementation.md` that services match product needs

## Implementation Notes

**Potential modifications (from gap analysis — to be confirmed):**

If Design Mode gaps:
- Add `createFromTemplate(templateId)` to TeamService
- Add `cloneTeam(teamId)` to TeamService
- Make planner agent configurable (not hardcoded YAML)

If Execution Mode gaps:
- Wire `TeamSettings.executionMode` into WorkerPool/OrchestratorService
- Wire `TeamSettings.maxConcurrency` into WorkerPool
- Wire `findSkillForTask()` into Orchestrator for auto-skill assignment
- Add runtime status tracking (`updateAgentStatus` called from WorkerPool)

If schema changes:
- Add migration script in `packages/backend/scripts/`
- Test migration against seed data
- Document rollback procedure

**Decision:** If modifications are large (>1 day), split into separate tasks and update the implementation plan.

## Testing
- Unit tests for any new/changed methods
- Integration test: create team → add agents → assign skills → run goal → verify skills loaded
- Golden path: goal → plan → approve → execute → done
- Frontend: team creation, agent management, skill selector all work
