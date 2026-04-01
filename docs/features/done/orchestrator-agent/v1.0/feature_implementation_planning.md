# Orchestrator Agent — Implementation Planning (v1.0 MVP)

**Parent:** [feature_architecture.md](../feature_architecture.md)

## Branch
`feature/orchestrator-agent-v1.0`

---

## Two-Iteration Approach

**Strategy:** Build Orchestrator with minimal MemoryManager first, validate core orchestration, then enhance memory.

| Iteration | Focus | Memory Usage |
|-----------|-------|--------------|
| **v1.0** | Core Orchestrator + PlanBuilder | Existing MemoryManager methods only |
| **v1.1** | Enhanced Memory | Add new methods + FilePlanStore + ArtifactRegistry |

---

## v1.0 Scope (This Document)

Core Orchestrator with conversational planning, PlanBuilder integration, and basic execution.

**Included:**
- Orchestrator agent (chat mode + tools)
- PlanBuilder agent (structured output)
- `create_plan`, `approve_plan`, `get_status` tools (simplified)
- Plan approval flow (events)
- AgentManagerV2 integration
- In-memory plan storage (no file persistence)

**Uses Only Existing MemoryManager:**
```typescript
addTask(task)           // ✅ Add tasks after plan approval
getTasks(role)          // ✅ Get ready tasks for workers  
updateTaskStatus(id, s) // ✅ Track progress
completeTask(id, out)   // ✅ Mark done + propagate deps
isComplete()            // ✅ Check all done
```

**Excluded (v1.1):**
- FilePlanStore (plan file persistence)
- ArtifactRegistry (file tracking)
- Plan revision history
- `getTask(id)`, `storeTasks()`, `getReadyTasks()` helpers
- `get_context` tool (simplified for v1.0)

**Excluded (v2):**
- Dynamic plan revision mid-execution
- `pause_execution`, `resume_execution`
- Worker interruption signals

---

## Design Decisions (v1.0 Simplified)

### 1. State Management
```typescript
type OrchestratorState = 'idle' | 'gathering' | 'awaiting_approval' | 'executing';

class OrchestratorService {
  private state: OrchestratorState = 'idle';
  private sessionId: string;      // Thread ID for LangGraph checkpointing
  private pendingPlan: TaskPlan | null = null;  // In-memory only (v1.0)
}
```
- State transitions: `idle → gathering → awaiting_approval → executing → idle`
- **v1.0**: Plan kept in memory (lost on restart)
- **v1.1**: Plan persisted to file for durability

### 2. Error Handling
| Error | Handler | Action |
|-------|---------|--------|
| PlanBuilder fails | `create_plan` tool catches | Return error message to Orchestrator, it informs user |
| PlanBuilder invalid JSON | Zod validation | Return validation error, Orchestrator asks user to clarify |
| Worker failure | `task:failed` event | Orchestrator receives event, informs user (no auto-replan in v1.0) |
| Orchestrator crash | Not handled in v1.0 | Session lost, user restarts |

### 3. Thread/Session Management
- **Single session per team**: One Orchestrator instance per team
- **Thread ID**: `team-{teamId}` passed to LangGraph for checkpointing
- **Conversation context**: LangGraph MemorySaver handles message history
- **Multi-user**: v1.0 assumes single user per team; v2 adds user-scoped sessions

### 4. Plan Approval Mechanics (Simplified)
```
1. Orchestrator calls create_plan tool
2. Tool invokes PlanBuilder, gets TaskPlan
3. Tool stores plan in OrchestratorService.pendingPlan (in-memory)
4. Tool emits 'plan:proposed' event with plan JSON
5. SocketServer forwards to client: socket.emit('plan:proposed', plan)
6. UI renders plan with Approve/Revise buttons
7a. User clicks Approve → socket.emit('plan:approve')
    → SocketServer calls orchestrator.approvePlan()
    → Loops addTask() for each task in plan
7b. User clicks Revise + message → socket.emit('message', text)
    → continues conversation, create_plan replaces pendingPlan
```

### 5. Task Queuing Logic
- **After approval**: `approvePlan()` adds ALL tasks to MemoryManager via `addTask()` loop
- **Auto-queue on completion**: MemoryManager's existing dependency tracking handles this
- **Worker pulls**: Workers call `getTasks(role)` to get ready tasks
- **No explicit TaskQueue in v1.0**: Use MemoryManager's built-in ready-task detection

### 6. Schema Strategy: Extend Existing

**Existing schemas (use as-is):**
- `AgentPlanSchema` → `src/worker/agent/internal/schemas/AgentPlanSchema.ts`
- `TaskItemSchema` → Same file (has `priority`, `expectedOutput`, `onDependencyFail`, `context`)
- `plan-builder.yaml` → `src/worker/agent/agents/plan-builder.yaml`

**New: Extend TaskItemSchema with `complexity`:**
```typescript
// src/worker/agent/internal/schemas/AgentPlanSchema.ts
// ADD to existing TaskItemSchema:
complexity: z
  .enum(['low', 'medium', 'high'])
  .default('medium')
  .describe('Estimated effort: low=quick, medium=normal, high=complex'),
```

**New: PlanRequirementsSchema (Orchestrator input):**
```typescript
// src/worker/orchestrator/schemas.ts
const PlanRequirementsSchema = z.object({
  goal: z.string().describe("User's high-level goal"),
  context: z.string().describe("Conversation context and clarifications"),
  constraints: z.array(z.string()).default([]).describe("Tech stack, timeline, etc."),
  roles: z.array(z.string()).describe("Available team roles")
});

// Re-export existing
export { AgentPlanSchema, TaskItemSchema } from '../agent/internal/schemas/AgentPlanSchema.js';
```

### 7. MemoryManager Usage (v1.0 - Existing Only)

**What we use (already exists):**
```typescript
addTask(task)           // Loop to add each approved task
getTasks(role)          // Workers pull ready tasks
updateTaskStatus(id, s) // Track in_progress
completeTask(id, out)   // Mark done, propagate to dependants
isComplete()            // Check all done
```

**What we defer to v1.1:**
| Method | v1.0 Workaround |
|--------|-----------------|
| `storeTasks(tasks[])` | Loop over `addTask()` |
| `getTask(id)` | Filter `getTasks()` result |
| `getReadyTasks()` | Call `getTasks()` per role, combine |
| `getTaskContext(id)` | Skip context injection in v1.0 |

---

## Implementation Steps (v1.0)

### Phase 1: Schema & Agent Setup (~1 hour) ✅ COMPLETE

- [x] **Step 1: Extend TaskItemSchema with complexity** 
  - File: `src/worker/agent/internal/schemas/AgentPlanSchema.ts`
  - Add `complexity: z.enum(['low', 'medium', 'high']).default('medium')`
  - Entry: Existing schema works
  - Exit: Schema includes complexity field

- [x] **Step 2: Update plan-builder.yaml prompt**
  - File: `src/worker/agent/agents/plan-builder.yaml`
  - Add complexity to system prompt example JSON
  - Entry: Schema updated
  - Exit: PlanBuilder outputs complexity in plans

- [x] **Step 3: Create Orchestrator YAML**
  - File: `src/worker/agent/agents/orchestrator.yaml`
  - Tool mode with system prompt from architecture
  - Entry: PlanBuilder exists
  - Exit: Orchestrator can chat and call tools

### Phase 2: Core Types & Tools (~2 hours) ✅ COMPLETE

- [x] **Step 4: Create orchestrator schemas**
  - File: `src/worker/orchestrator/schemas.ts`
  - `PlanRequirementsSchema` (goal, context, constraints, roles)
  - Re-export `AgentPlanSchema`, `TaskItemSchema` from existing

- [x] **Step 5: create_plan tool**
  - File: `src/worker/orchestrator/tools/createPlan.ts`
  - Invoke PlanBuilder agent (existing `plan-builder` definition)
  - Store result in OrchestratorService.pendingPlan
  - Emit `plan:proposed` event
  - Return awaiting_approval status

- [x] **Step 6: approve_plan tool**
  - File: `src/worker/orchestrator/tools/approvePlan.ts`
  - Loop `addTask()` for each task in pendingPlan
  - Clear pendingPlan
  - Return execution_started status

- [x] **Step 7: get_status tool**
  - File: `src/worker/orchestrator/tools/getStatus.ts`
  - Call `getTasks(role)` for each role
  - Count by status (ready, in_progress, completed, failed)
  - Return summary object

### Phase 3: Orchestrator Service (~2 hours) ✅ COMPLETE

- [x] **Step 8: OrchestratorContext types**
  - File: `src/worker/orchestrator/types.ts`
  - `OrchestratorState`, `OrchestratorContext`
  - Re-export `AgentPlanOutput` as `TaskPlan` type alias

- [x] **Step 9: createOrchestratorTools factory**
  - File: `src/worker/orchestrator/tools/index.ts`
  - Closure pattern with context injection
  - Export all tools as array

- [x] **Step 10: OrchestratorService class**
  - File: `src/worker/orchestrator/OrchestratorService.ts`
  - Initialize Orchestrator + PlanBuilder via AgentFactory
  - `handleMessage(msg)` → invoke Orchestrator
  - `approvePlan()` → add tasks to MemoryManager
  - State: `idle | gathering | awaiting_approval | executing`
  - `pendingPlan: AgentPlanOutput | null` stored in memory

### Phase 4: Integration (~2 hours) ✅ COMPLETE

- [x] **Step 11: AgentManagerV2 integration**
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Replace hardcoded orchestration with OrchestratorService
  - Wire events: `plan:proposed`, `task:completed`, `task:failed`
  - Feature flag: `USE_ORCHESTRATOR` env var

- [x] **Step 12: Socket events for approval**
  - File: `src/worker/api/SocketServer.ts`
  - `plan:proposed` → emit to client
  - `plan:approve` → call orchestrator.approvePlan()
  - `plan:revise` → continue conversation

### Phase 5: Testing (~2 hours) ✅ COMPLETE

- [x] **Step 13: Unit tests**
  - File: `src/worker/orchestrator/__tests__/tools.test.ts`
  - Test each tool in isolation with mocked MemoryManager

- [x] **Step 14: Integration test**
  - File: `src/worker/orchestrator/__tests__/orchestrator.integration.test.ts`
  - Full flow: chat → plan → approve → tasks added → workers execute

---

## Implementation Status: ✅ v1.0 COMPLETE

All 14 steps implemented. Ready for testing with `npx vitest run src/worker/orchestrator`.

---

## Files Summary (v1.0)

**Create:**
```
src/worker/orchestrator/
├── types.ts              # OrchestratorState, context types
├── schemas.ts            # PlanRequirementsSchema + re-exports
├── OrchestratorService.ts
├── tools/
│   ├── index.ts          # Tool factory
│   ├── createPlan.ts
│   ├── approvePlan.ts
│   └── getStatus.ts
└── __tests__/
    ├── tools.test.ts
    └── orchestrator.integration.test.ts

src/worker/agent/agents/
└── orchestrator.yaml     # NEW
```

**Modify:**
- `src/worker/agent/internal/schemas/AgentPlanSchema.ts` (add `complexity` field)
- `src/worker/agent/agents/plan-builder.yaml` (update prompt for complexity)
- `src/worker/agentManager/AgentManagerV2.ts` (add OrchestratorService, feature flag)
- `src/worker/api/SocketServer.ts` (approval events)

---

## Testing Strategy

| Level | What | How |
|-------|------|-----|
| Unit | Individual tools | Mock MemoryManager, verify task additions |
| Unit | OrchestratorService state | Test state transitions |
| Integration | Full planning flow | Real agents, mock workers |
| E2E | UI approval | Frontend + backend (deferred) |

---

## Rollback Plan

1. OrchestratorService is opt-in via `USE_ORCHESTRATOR` env flag
2. AgentManagerV2 keeps old code path when flag is false
3. If issues: set flag to false, redeploy

---

## Dependencies (v1.0)

| Step | Depends On |
|------|------------|
| 2 | 1 (schema updated before prompt update) |
| 3 | 2 (PlanBuilder must exist for Orchestrator) |
| 5-7 | 4 (schemas) |
| 9 | 5-7 (all tools) |
| 10 | 8, 9 (types + tools) |
| 11 | 10 (OrchestratorService) |
| 12 | 11 (integration) |
| 13-14 | 10 (service exists) |

---

## Estimated Effort (v1.0)

| Phase | Steps | Estimate |
|-------|-------|----------|
| Schema & Agent Setup | 1-3 | 1 hour |
| Core Types & Tools | 4-7 | 2 hours |
| Orchestrator Service | 8-10 | 2 hours |
| Integration | 11-12 | 2 hours |
| Testing | 13-14 | 2 hours |
| **Total v1.0** | | **~9 hours** |

---

## v1.1 Preview (Enhanced Memory)

**After v1.0 is validated**, add:

| Enhancement | File | Effort |
|-------------|------|--------|
| `storeTasks(tasks[])` | MemoryManager.ts | 15 min |
| `getTask(id)` | MemoryManager.ts | 10 min |
| `getReadyTasks()` | MemoryManager.ts | 15 min |
| `getTaskContext(id)` | MemoryManager.ts | 20 min |
| `getAllTasks()` | MemoryManager.ts | 10 min |
| FilePlanStore | orchestrator/PlanStore.ts | 1 hour |
| ArtifactRegistry | orchestrator/ArtifactRegistry.ts | 1 hour |
| `get_context` tool | tools/getContext.ts | 30 min |
| Plan file persistence | OrchestratorService.ts | 30 min |
| **Total v1.1** | | **~4 hours** |

**v1.1 Triggers:**
- v1.0 working end-to-end
- Need plan persistence (restart durability)
- Need context injection for smarter workers
- Need artifact tracking for rollback

---

## Quick Start

**Step 1:** Add `complexity` to `src/worker/agent/internal/schemas/AgentPlanSchema.ts`  
**Step 2:** Update `src/worker/agent/agents/plan-builder.yaml` prompt  
**Step 3:** Create `src/worker/agent/agents/orchestrator.yaml`  
**Step 4:** Create `src/worker/orchestrator/schemas.ts` (re-export + PlanRequirementsSchema)  
**Step 5:** Build out tools and OrchestratorService
