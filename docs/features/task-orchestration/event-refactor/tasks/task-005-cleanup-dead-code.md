# Task 005: Dead Code Cleanup + Verification

**Status:** `not-started`  
**Depends on:** task-001, task-002, task-003, task-004  
**Estimated:** 2-3 hours  
**Branch:** `feature/event-refactor`

## Description
Remove all EventEmitters, aliases, route maps, and dead event-related code from the codebase. Verify 0 EventEmitters remain in backend code (Socket.IO is the only event system). Run grep to confirm.

## Acceptance Criteria
- [ ] `AgentManager.events` alias removed
- [ ] `ensureTeamEventsBroadcast()` removed
- [ ] `attachedTeams` Set removed
- [ ] `WORKER_EVENT_ROUTES` map removed (if no longer needed after generator chain)
- [ ] `AiSdkAgent._emitter` removed (if it exists)
- [ ] All `import { EventEmitter }` removed from backend (except Socket.IO internals)
- [ ] `grep -r "new EventEmitter" packages/backend/` returns 0 results
- [ ] `grep -r "events.emit" packages/backend/` returns 0 results (except Socket.IO `io.emit`)
- [ ] Golden path passes end-to-end
- [ ] All streaming works (text, tool calls, reasoning, notifications)

## Implementation Notes

**Files to clean:**
- `packages/backend/agentManager/AgentManagerV2.ts` — remove `.events` alias, `ensureTeamEventsBroadcast()`, `attachedTeams`
- `packages/backend/services/WorkerPool.ts` — remove `events` property (already done in task-001)
- `packages/backend/util/RoleTaskQueue.ts` — remove `events` property (already done in task-003)
- `packages/backend/orchestrator/OrchestratorService.ts` — remove any event-related imports
- `packages/backend/api/SocketServerV2.ts` — remove `WORKER_EVENT_ROUTES` if no longer routing EventEmitter events. Keep `io.emit()` calls (these stay — Socket.IO is correct for network boundary).
- `packages/backend/agent/internal/AiSdkAgent.ts` — remove `_emitter` if present

**Verification steps:**
```bash
# Must return 0 matches (excluding node_modules, test files referencing old patterns)
grep -rn "new EventEmitter" packages/backend/src/
grep -rn "\.events\.emit\(" packages/backend/src/
grep -rn "\.events\.on\(" packages/backend/src/
grep -rn "\.removeListener\(" packages/backend/src/
grep -rn "\.removeAllListeners\(" packages/backend/src/
```

## Code TODOs
- `packages/backend/agentManager/AgentManagerV2.ts` — TODO(task-005): Remove event aliases and broadcast helpers
- `packages/backend/api/SocketServerV2.ts` — TODO(task-005): Remove WORKER_EVENT_ROUTES if unused

## Testing
- Full golden path: goal → plan → approve → tasks execute → stream to frontend → done
- Verify grep confirms 0 internal EventEmitters
- Verify streaming: text-delta, tool-call, reasoning, notification chips all render
- Verify task lifecycle: ready → in_progress → completed, dependency chains work
- Check for memory leaks: start/stop team multiple times, no listener accumulation
