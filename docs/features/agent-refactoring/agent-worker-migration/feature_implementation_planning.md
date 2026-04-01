# Agent/AgentWorker Migration - Implementation Planning

**Parent:** [feature_architecture.md](feature_architecture.md)  
**Date:** January 25, 2026  
**Status:** Planning

---

## Branch
- `feature/agent-worker-migration`

## Scope

Unify two parallel agent systems into single path:
- **WorkerPool**: Simple registry (`Map<taskId, InternalAgent>`)
- **AgentManager**: Owns polling + orchestration + multi-turn
- **RoleService**: Stateless role discovery
- **DefinitionBuilder**: Outputs `AgentDefinition` (replaces ConfigBuilder)

---

## Implementation Steps

### Phase 1: Create WorkerPool (Registry)
**Estimate:** 2-3 hours | **Dependencies:** None

- [ ] **1.1** Create `src/worker/services/WorkerPool.ts`
  - `Map<string, InternalAgent>` (taskId → agent)
  - `Map<string, AgentDefinition>` (role → definition)
  - `registerRole(role, definition)`
  - `createWorker(taskId, role)` - creates agent, injects workspace tools
  - `getWorker(taskId)`
  - `disposeWorker(taskId)`
  - `executeTask(taskId, input)` - AsyncGenerator + EventEmitter bridge
  - `activeTaskCount` getter

- [ ] **1.2** Create `src/worker/services/types.ts`
  - `WorkerPoolConfig` interface
  - `AgentEvent` type (from InternalAgent yields)

- [ ] **1.3** Add tests `src/worker/services/__tests__/WorkerPool.test.ts`
  - Create/get/dispose workers
  - Execute task streams events
  - Workspace tools injection

### Phase 2: Create DefinitionBuilder
**Estimate:** 2-3 hours | **Dependencies:** None (can parallel with Phase 1)

- [ ] **2.1** Create `src/worker/agentBuilder/DefinitionBuilder.ts`
  - Input: `AgentRole` (from RoleBuilder)
  - Output: `AgentDefinition` (for AgentFactory)
  - Map: `systemMessage` → `systemPrompt`
  - Add `mode: 'tool'` for workers
  - Add `id` from role name

- [ ] **2.2** Add prompt for config generation
  - Similar to ConfigBuilder but outputs AgentDefinition schema
  - Uses existing builder agent pattern

- [ ] **2.3** Add tests `src/worker/agentBuilder/__tests__/DefinitionBuilder.test.ts`
  - Generates valid AgentDefinition
  - Mode correctly set
  - All required fields present

### Phase 3: Create RoleService
**Estimate:** 1-2 hours | **Dependencies:** Phase 2

- [ ] **3.1** Create `src/worker/services/RoleService.ts`
  - Stateless service (no worker registry)
  - `suggestRoles(task)` → uses RoleBuilder
  - `generateDefinitions(roles)` → uses DefinitionBuilder
  - Returns `AgentDefinition[]`

- [ ] **3.2** Add tests `src/worker/services/__tests__/RoleService.test.ts`
  - Role suggestion
  - Definition generation
  - Integration with builders

### Phase 4: Add RoleTaskQueue Completion Methods
**Estimate:** 1 hour | **Dependencies:** None (can parallel)

- [ ] **4.1** Add to `src/worker/taskManager/RoleTaskQueue.ts`
  - `completeTask(taskId, result)` - sets status, emits event
  - `failTask(taskId, error)` - sets status, emits event
  - `getTask(taskId)` - lookup by ID

- [ ] **4.2** Update RoleTaskQueue tests
  - Complete task flow
  - Fail task flow
  - Event emissions

### Phase 5: Update AgentManager
**Estimate:** 3-4 hours | **Dependencies:** Phases 1-4

- [ ] **5.1** Add new dependencies to `AgentManager`
  ```typescript
  private taskQueue: RoleTaskQueue;
  private workerPool: WorkerPool;
  private roleService: RoleService;
  public events: EventEmitter;
  ```

- [ ] **5.2** Add polling loop in `start()`
  ```typescript
  this.taskQueue.on('task:available', ({ role, taskId }) => {
    this.processTask(taskId, role);
  });
  ```

- [ ] **5.3** Add multi-turn API
  - `processTask(taskId, role)` - create worker, first turn
  - `continueTask(taskId, message)` - same worker, next turn
  - `executeTurn(taskId, input)` - run turn, emit events
  - `completeTask(taskId, result)` - cleanup, dispose worker
  - `failTask(taskId, error)` - cleanup, dispose worker

- [ ] **5.4** Update role discovery flow
  - Use `roleService.suggestRoles()`
  - Use `roleService.generateDefinitions()`
  - Register definitions with `workerPool.registerRole()`

- [ ] **5.5** Subscribe to WorkerPool events
  - Forward to Socket.IO
  - Logging

- [ ] **5.6** Add AgentManager tests for new flow
  - Task processing
  - Multi-turn conversation
  - Complete/fail task
  - Event emissions

### Phase 6: Deprecate Old Classes
**Estimate:** 1-2 hours | **Dependencies:** Phase 5

- [ ] **6.1** Mark as deprecated with JSDoc
  - `roleManager/RoleManager.ts` - `@deprecated Use RoleService + WorkerPool`
  - `AgentWorker/AgentWorker.ts` - `@deprecated Use WorkerPool`
  - `agentManager/Agent.ts` - `@deprecated Use AgentFactory`
  - `agentBuilder/ConfigBuilder.ts` - `@deprecated Use DefinitionBuilder`

- [ ] **6.2** Update imports in consuming code
  - Find all usages of deprecated classes
  - Update to new services

- [ ] **6.3** Add migration guide to deprecation notices
  - Before/after code examples

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `services/WorkerPool.ts` | CREATE | 1 |
| `services/types.ts` | CREATE | 1 |
| `services/__tests__/WorkerPool.test.ts` | CREATE | 1 |
| `agentBuilder/DefinitionBuilder.ts` | CREATE | 2 |
| `agentBuilder/__tests__/DefinitionBuilder.test.ts` | CREATE | 2 |
| `services/RoleService.ts` | CREATE | 3 |
| `services/__tests__/RoleService.test.ts` | CREATE | 3 |
| `taskManager/RoleTaskQueue.ts` | UPDATE | 4 |
| `agentManager/AgentManager.ts` | UPDATE | 5 |
| `roleManager/RoleManager.ts` | DEPRECATE | 6 |
| `AgentWorker/AgentWorker.ts` | DEPRECATE | 6 |
| `agentManager/Agent.ts` | DEPRECATE | 6 |
| `agentBuilder/ConfigBuilder.ts` | DEPRECATE | 6 |

---

## Testing Strategy

1. **Unit tests** for each new class (WorkerPool, DefinitionBuilder, RoleService)
2. **Integration tests** for AgentManager multi-turn flow
3. **Existing tests** must pass (no breaking changes to public API)
4. **Manual testing** with real LLM for end-to-end validation

---

## Rollback Plan

1. Keep deprecated classes functional (not deleted)
2. Feature flag for new vs old path (if needed)
3. Revert to deprecated classes if issues found
4. Remove deprecated classes only after v1.1 stable

---

## Entry/Exit Criteria

**Entry:**
- Architecture approved ✅
- InternalAgent has `dispose()` and `clearConversation()` ✅

**Exit:**
- All phases complete
- All tests passing
- Old classes deprecated with migration guide
- No breaking changes to existing functionality
