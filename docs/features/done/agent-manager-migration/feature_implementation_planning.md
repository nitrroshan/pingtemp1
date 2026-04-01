# AgentManager Migration - Implementation Plan

**Parent:** [feature_architecture.md](feature_architecture.md)  
**Date:** January 26, 2026  
**Status:** ✅ Complete

---

## Branch
- `user/nitrroshan/migrateagentworker`

---

## Phase 1: WorkerPool (Registry)
**Estimate:** 2-3 hours | **Status:** ✅ Complete

### 1.1 Create Types
- [x] `services/types.ts` - WorkerPoolConfig, WorkerEntry, event types

### 1.2 Create WorkerPool
- [x] `services/WorkerPool.ts` (~145 lines, simplified)
  - `Map<taskId, InternalAgent>` for active workers
  - `Map<role, AgentDefinition>` for cached definitions
  - `registerDefinitions(definitions[])` - batch register
  - `runTask(taskId, role, message)` - creates worker on-demand, executes
  - `dispose(taskId)` - cleanup single worker
  - `disposeAll()` - cleanup all workers
  - `workerCount` getter
  - `events: EventEmitter` - forwards from InternalAgent
  - `DEFAULT_MODEL_CONFIG` - overrides LLM-generated deployments with env var

### 1.3 Tests
- [ ] `services/__tests__/WorkerPool.test.ts` (deferred)

---

## Phase 2: DefinitionBuilder
**Estimate:** 2-3 hours | **Status:** ✅ Complete

### 2.1 Implementation
- [x] Uses AgentFactory.getDefinitionBuilder() (YAML-based InternalAgent)
- [x] Returns structured output with `definitions[]` and `teamGoal`
- [x] One-shot LLM call via InternalAgent structured mode

### 2.2 Schema
- [x] Defined in YAML: `agent/internal/agents/definition-builder.yaml`
- [x] Output schema enforces `AgentDefinition[]` structure

### 2.3 Tests
- [ ] `services/__tests__/DefinitionBuilder.test.ts` (deferred)

---

## Phase 3: Update AgentManager
**Estimate:** 3-4 hours | **Status:** ✅ Complete

### 3.1 AgentManagerV2 Created
- [x] `agentManager/AgentManagerV2.ts` - New clean orchestrator
- [x] Uses WorkerPool + DefinitionBuilder (via AgentFactory)
- [x] Exposes `events` from WorkerPool for Socket.IO

### 3.2 Main API
```typescript
// Step 1: Configure workflow (discover roles)
configureWorkflow(task: string): Promise<AgentDefinition[]>

// Step 2: Create plan (optional)
createPlan(task: string): Promise<TaskPlan>

// Step 3: Execute tasks
startTask(role, message): Promise<{ taskId, response }>
continueTask(taskId, message): Promise<response>
stopTask(taskId): Promise<void>

// Full workflow
run(task): Promise<Map<taskId, result>>
```

### 3.3 Compatibility Methods (for existing API)
- [x] `configureNewWorkflow()` → calls configureWorkflow + createPlan
- [x] `getRoles()` → returns cached definitions
- [x] `createTask()` → calls run()

### 3.4 SocketServer Updated
- [x] `api/SocketServer.ts` uses startTask/continueTask
- [x] Frontend sends `{ agentRole, taskId?, content }`
- [x] No taskId → startTask (returns taskId in response)
- [x] With taskId → continueTask

### 3.5 Frontend Updated
- [x] `AgentManagerService.ts` - tracks taskId per agent role
- [x] `SocketService.ts` - sendMessageToAgent accepts optional taskId
- [x] `ChatArea.tsx` - uses agent.role (not agent.name)

---

## Phase 4: Deprecation
**Estimate:** 1 hour | **Status:** ✅ Complete

### 4.1 Marked @deprecated
- [x] `roleManager/RoleManager.ts` → use AgentManager.configureWorkflow()
- [x] `AgentWorker/AgentWorker.ts` → use WorkerPool.runTask()
- [x] `agentManager/Agent.ts` → use AgentFactory.createInternalAgent()

---

## Current Progress

| Phase | Status | Files |
|-------|--------|-------|
| 1. WorkerPool | ✅ Complete | `services/types.ts`, `services/WorkerPool.ts` |
| 2. DefinitionBuilder | ✅ Complete | Via AgentFactory (YAML-based) |
| 3. AgentManager | ✅ Complete | `agentManager/AgentManagerV2.ts`, API updates |
| 4. Deprecation | ✅ Complete | JSDoc @deprecated added |

---

## Remaining Tasks (Low Priority)

| Task | Priority | Notes |
|------|----------|-------|
| WorkerPool.test.ts | Low | Unit tests for WorkerPool |
| DefinitionBuilder.test.ts | Low | Test YAML-based builder |
| Remove old HTTP endpoints | Low | `/api/workers` unused |
| Delete .orig files | Low | Cleanup backup files |

---

## API Comparison

| Old API | New API | Notes |
|---------|---------|-------|
| `configureNewWorkflow(task)` | `configureNewWorkflow(task)` | Same signature, uses DefinitionBuilder |
| `createTask(task)` | `createPlan(task)` + `startTask()` | Split: plan first, then execute |
| `roleManager.getRoles()` | `definitionBuilder.generateDefinitions()` | One-shot, no separate role step |
| `roleManager.getRoleWorkers()` | `workerPool.createWorker()` | Per-task, from cached definitions |
| N/A | `processTask()`, `continueTask()` | NEW: Multi-turn support |

**Typical Usage:**
```typescript
const mgr = new AgentManager();

// Step 1: Configure (generates agent definitions)
const definitions = await mgr.configureNewWorkflow("Build a login page");

// Step 2: Create plan (can review before executing)
const plan = await mgr.createPlan("Build a login page");
console.log(plan.tasks); // Review tasks

// Step 3: Execute
await mgr.startTask();
```
