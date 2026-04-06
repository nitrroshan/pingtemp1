# Task 005: Dead Code Removal

**Status:** `in-progress`  
**Depends on:** task-001, task-002, task-003  
**Estimated:** 2-4 hours  
**Branch:** `feature/service-audit`

## Description
Based on audit results, remove methods, routes, models, and types that have no callers and no product justification. Clean up unused imports and dead branches.

## Acceptance Criteria
- [ ] Every removed method confirmed uncalled via grep
- [ ] Every removed route confirmed unused by frontend
- [ ] No runtime errors after removal
- [ ] No broken imports
- [ ] Golden path smoke test passes
- [ ] Removed items documented in `feature_implementation.md`

## Implementation Notes

**Likely candidates from audit (to be confirmed):**

TeamService:
- `delegateAgent` / `reclaimAgent` — if agent sharing isn't needed
- `addMember` / `removeMember` / `getTeamMembers` — if user-per-team membership is future scope
- `getWorkspace` — if not used by frontend

SkillRegistryService:
- `getAgentsWithSkill` — reverse lookup, likely unused
- `findSkillForTask` — if planner doesn't use it yet (keep if wiring planned for Phase 3)
- `incrementInstallCount` — if install count isn't meaningful
- `getStats` — if no dashboard UI exists

**Files to check for dead code:**
- `packages/backend/team/TeamService.ts` — methods
- `packages/backend/team/models.ts` — unused model fields
- `packages/backend/team/types/index.ts` — unused types
- `packages/backend/team/errors.ts` — unused error classes (if methods removed)
- `packages/backend/skills/services/SkillRegistryService.ts` — methods
- `packages/backend/skills/api/skillsRouter.ts` — unused routes
- `packages/backend/skills/types/` — unused types
- `packages/backend/api/HttpServer.ts` — unused route handlers

**Approach:**
1. Grep each candidate method/route for callers
2. If 0 callers AND audit verdict is "remove" → delete
3. If only test files call it → delete method + test
4. Run full test suite after each batch of removals
5. Verify frontend still works (no 404s on removed routes)

## Testing
- Run `TeamService.test.ts` after each removal batch
- Run skill tests after each removal batch
- Golden path smoke test: goal → plan → approve → execute → done
- Frontend: navigate all pages, verify no console errors
