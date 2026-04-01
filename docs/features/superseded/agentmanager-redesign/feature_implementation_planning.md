# AgentManager Redesign - Implementation Planning

**Architecture Reference:** [feature_architecture.md](./feature_architecture.md)

## Branch
`feature/agentmanager-redesign-v1`

## Scope (v1)
- Frontend API for task lifecycle (`approveTask`, `completeTask`)
- `report_status` tool with event emission
- Workspace integration via git branches (per-task isolation)
- New AgentManager methods (parallel operation approach)
- Deprecate legacy methods

**Out of Scope:** Error recovery, role-based worker persistence

---

## Implementation Steps

### Phase 1: Frontend API (Socket + Client)

- [x] **Step 1.1: Add SocketServer handlers** ✅
  - File: `src/worker/api/SocketServer.ts`
  - Added handlers: `task:approve`, `task:complete`, event forwarding for `task:status`, `task:approved`, `task:completed`
  - Entry: SocketServer exists with `agent:message` handler
  - Exit: New handlers respond to frontend events

- [x] **Step 1.2: Add AgentManagerV2 task lifecycle methods** ✅
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Added: `approveTaskForChat(taskId)`, `completeTaskByUser(taskId, output?)`, `getWorkflowStatus()`, `getActiveAgents()`
  - Entry: Methods don't exist
  - Exit: Methods work, TypeScript compiles

- [ ] **Step 1.3: Add Frontend service methods** (deferred - separate repo)
  - File: `src/AgentChat/services/AgentManagerService.ts`
  - Add: `approveTask()`, `completeTask()`, subscribe to `task:status`

### Phase 2: report_status Tool

- [x] **Step 2.1: Create report_status tool** ✅
  - File: `src/worker/agent/internal/tools/reportStatusTool.ts` (new)
  - Schema: `{ status: enum, summary: string, progress?: number }`
  - Tool returns summary, emits event via EventEmitter
  - Entry: Tool doesn't exist
  - Exit: Tool created with Zod schema

- [x] **Step 2.2: Wire tool to InternalAgent** ✅
  - File: `src/worker/services/WorkerPool.ts`
  - Added `report_status` tool during worker creation
  - Pass EventEmitter to tool for status events
  - Entry: InternalAgent has no status tool
  - Exit: Agents can call `report_status`

- [x] **Step 2.3: Emit task:status to Socket** ✅
  - File: `src/worker/api/SocketServer.ts`
  - Added forwarding for `task:status` events from AgentManager
  - Entry: No status events
  - Exit: Frontend receives `task:status` events

### Phase 3: Workspace Integration

- [x] **Step 3.1: Wire WorkspaceManager to WorkerPool** ✅
  - File: `src/worker/services/WorkerPool.ts`
  - Added `WorkspaceManager` instance, `enableWorkspace(repoPath)` method
  - On worker creation: `createAgentBranch(taskId)` if enabled
  - Entry: WorkerPool has no workspace support
  - Exit: Each task gets its own git branch (when enabled)

- [x] **Step 3.2: Create AgentWorkspace per worker** ✅
  - File: `src/worker/services/WorkerPool.ts`
  - Create `AgentWorkspace` with taskId, stored in `workspaces` Map
  - Entry: Workers have no workspace
  - Exit: Each worker has isolated workspace

- [x] **Step 3.3: Add workspace tools to agents** ✅
  - File: `src/worker/agentManager/workspace/mcp/workspace-tools.ts` (existing)
  - Tools: `workspace_read_file`, `workspace_write_file`, `workspace_file_exists`, `workspace_delete_file`, `workspace_commit`, `workspace_info`
  - Added to agent tool list during worker creation
  - Entry: Tools exist but not wired
  - Exit: Agents can read/write files on their branch

- [x] **Step 3.4: Merge on task completion** ✅
  - File: `src/worker/services/WorkerPool.ts` + `AgentManagerV2.ts`
  - Added `mergeAndCleanup(taskId)` to WorkerPool
  - `completeTaskByUser()` now calls merge before completing
  - Returns merge result (success or conflict info)
  - Entry: No merge on completion
  - Exit: Completed tasks merged to main

### Phase 4: New AgentManager Methods

- [x] **Step 4.1: Add discoverRoles method** ✅
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Added `discoverRoles(taskDescription)` - pure role discovery without side effects
  - Returns `AgentDefinition[]` ready for team configuration
  - Entry: Role discovery embedded in configureWorkflow
  - Exit: Clean separation, ready for Team Builder migration

- [x] **Step 4.2: Add team management methods** ✅
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Added: `registerAgent(definition)`, `unregisterAgent(agentId)`, `getStatus()`
  - Also added: `setAutoExecute()`, `getAutoExecute()`, `startTaskExecution()`
  - Entry: No team registry API
  - Exit: Methods return active agents and workflow status

- [x] **Step 4.3: Add task modification methods** ✅
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Added: `modifyTask(taskId, changes)`, `discardTask(taskId)`
  - Entry: Tasks immutable after creation
  - Exit: Users can modify pending tasks

### Phase 5: Deprecation & Cleanup

- [x] **Step 5.1: Mark legacy methods deprecated** ✅
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Added `@deprecated` JSDoc to: `configureWorkflow()`, `createPlan()`, `executeAllTasks()`, `run()`, `configureNewWorkflow()`
  - Added `console.warn()` when these methods are called
  - Entry: Methods used without warning
  - Exit: Console warns on legacy usage

- [x] **Step 5.2: Default USE_ORCHESTRATOR to true** ✅
  - File: `src/worker/agentManager/AgentManagerV2.ts`
  - Changed: `USE_ORCHESTRATOR = process.env.USE_ORCHESTRATOR !== "false"` (defaults to true)
  - Added deprecation warning when explicitly set to `false`
  - Updated test file comments to reflect default behavior
  - Entry: Flag defaults to false
  - Exit: Orchestrator mode is default, legacy opt-out deprecated

- [x] **Step 5.3: Update test file headers** ✅
  - Files: `agentManagerV2.test.ts`, `agentManagerV2.queue.test.ts`
  - Added deprecation notices pointing to orchestrator test
  - Tests still work but show deprecation warnings
  - Entry: Tests use old API without notices
  - Exit: Tests marked as legacy, users directed to new flow

---

## ✅ Implementation Complete

All phases of the AgentManager Redesign have been completed:

| Phase | Status | Summary |
|-------|--------|---------|
| Phase 1 | ✅ | Frontend API - SocketServer handlers + lifecycle methods |
| Phase 2 | ✅ | report_status tool with event emission |
| Phase 3 | ✅ | Workspace integration (git branches per task) |
| Phase 4 | ✅ | New methods: discoverRoles, registerAgent, modifyTask, etc. |
| Phase 5 | ✅ | Deprecation + USE_ORCHESTRATOR defaults to true |
| Phase 6 | ✅ | API Layer Redesign - V2 API parallel to V1 |
| Phase 7 | ✅ | Frontend V2 Integration - All components use V2 API |

### Key Outcomes

1. **Orchestrator is now default** - No flag needed, just run `npx tsx ...`
2. **Legacy methods warn** - `configureWorkflow()`, `createPlan()`, `run()` show deprecation
3. **New flow fully functional**: `initializeOrchestrator()` → `handleUserMessage()` → `approvePlan()` → task lifecycle
4. **Manual task control**: `approveTaskForChat()` → `startTaskExecution()` → `completeTaskByUser()`

### Breaking Changes (v2)

- `USE_ORCHESTRATOR=false` is deprecated
- Legacy methods (`configureWorkflow`, `createPlan`, `executeAllTasks`) show console warnings
- Old tests still work but are marked as legacy

---

## Dependencies

```
Phase 1 (Frontend API)
    ↓
Phase 2 (report_status) ←── requires Socket handlers
    ↓
Phase 3 (Workspace) ←── can run parallel with Phase 2
    ↓
Phase 4 (New Methods) ←── requires workspace for some features
    ↓
Phase 5 (Cleanup) ←── requires all above complete
```

---

## Phase 6: API Layer Redesign (NEW)

**Reference:** [docs/architecture/api-redesign.md](../../architecture/api-redesign.md)

**Strategy:** Create all components as v2, run parallel to v1, deprecate v1 later.

### Step 6.1: AgentManagerRegistry
- [x] File: `src/worker/agentManager/AgentManagerRegistry.ts` (new) ✅
- Created `AgentManagerRegistry` class with `getForTeam()`, `remove()`, `has()`, `getStats()`
- Export singleton `agentManagerRegistry`
- Lazy loads team from MongoDB, caches AgentManager in memory
- Handles race conditions with `loadingPromises` Map

### Step 6.2: SocketServerV2
- [x] File: `src/worker/api/SocketServerV2.ts` (new) ✅
- 5 events only: `message`, `action`, `state`, `output`, `error`
- `message` bidirectional (same event name both ways)
- `action` with `type` field: `approve-plan`, `start-task`, `complete-task`, `cancel-task`
- Uses `agentManagerRegistry.getForTeam(teamId)` - no passed AgentManager
- Mounted at `/socket.io/v2` path

### Step 6.3: HTTP Routes V2
- [x] File: `src/worker/api/agentManagerHandlerV2.ts` (new) ✅
- Mount at `/api/v2/...`
- Routes: `/teams`, `/teams/:id`, `/teams/:id/agents`, `/sessions/:teamId`, `/sessions/:teamId/tasks`
- Uses `agentManagerRegistry` instead of passed AgentManager
- Added `/registry/stats` debug endpoint

### Step 6.4: Frontend AgentServiceV2
- [x] File: `src/AgentChat/services/AgentServiceV2.ts` (new) ✅
- Connects to SocketServerV2 at `/socket.io/v2` path
- Send methods: `sendToOrchestrator`, `sendToWorker`
- Action methods: `approvePlan`, `startTask`, `completeTask`, `cancelTask`
- Subscription methods: `onMessage`, `onState`, `onOutput`, `onError` (return unsubscribe fn)
- TeamId required for connection (registry pattern)
- Singleton exported as `agentServiceV2`

### Step 6.5: Server Entry Point
- [x] File: `src/worker/api/HttpServer.ts` ✅
- Mounted both v1 and v2 routes
- Added feature flag `USE_API_V2` (defaults to true)
- V1: `/api/*`, V2: `/api/v2/*`

### Step 6.6: Deprecation (Later)
- [ ] Add `@deprecated` to SocketServer.ts, agentManagerHandler.ts
- [ ] Add console warnings when v1 events used
- [ ] Remove v1 after migration confirmed

---

## Phase 7: Frontend V2 Integration ✅ COMPLETE

**Goal:** Update frontend to use V2 API exclusively and verify end-to-end flow.

**Status:** All steps complete. Frontend now uses V2 API exclusively.

**Connection Strategy:**
| Operation | Protocol | When |
|-----------|----------|------|
| Fetch teams | HTTP | App mount |
| Create team | HTTP | Modal submit |
| Get agents | HTTP | Team selected |
| Chat | Socket | After team selected |
| Actions | Socket | After team selected |

### Step 7.1: App.tsx - Service Swap ✅ DONE
- [x] Import `agentServiceV2` instead of `agentManagerService`
- [x] Replace `agentManagerService.getTeams()` → `agentServiceV2.getTeams()`
- [x] Replace `agentManagerService.createTeam()` → `agentServiceV2.createTeam()`
- [x] Replace `agentManagerService.getRolesByTeam()` → `agentServiceV2.getAgents()`
- [x] Remove global socket connection on mount (defer to team selection)

### Step 7.2: App.tsx - Deferred Socket Connection ✅ DONE
- [x] Add `selectedTeamId` state (set when team clicked in sidebar)
- [x] Connect socket when team selected: `agentServiceV2.connect(selectedTeamId)`
- [x] Disconnect when switching teams or unmounting
- [x] Wire V2 event subscriptions in useEffect with cleanup:
  - `onMessage()` → update chat messages
  - `onState()` → update session/task state
  - `onOutput()` → handle agent artifacts
  - `onError()` → show error toast

### Step 7.3: ChatArea - Message Handling ✅ DONE
- [x] Import V2 service, add teamId prop
- [x] Use V2 sendToWorker for chat
- [x] Update message listener for V2 `AgentMessage` format
- [x] Replace V1 event subscriptions with V2 (`onMessage`, `onOutput`, `onError`)
- [x] Proper cleanup with unsubscribe functions
- [x] Remove V1 imports from both App.tsx and ChatArea.tsx

### Step 7.4: TaskList - Connect to Backend ✅ DONE
- [x] Fetch real tasks: `agentServiceV2.getTasks(teamId)`
- [x] Listen for `state` events to update task statuses
- [x] Replace dummy `DUMMY_TASKS` with backend data
- [x] Add task status badges (ready, pending, in_progress, completed)

### Step 7.5: Plan Approval UI ✅ DONE
- [x] Add `pendingPlan` state in App.tsx (as `currentPlan`)
- [x] When `state.sessionState === "awaiting_approval"`:
  - Show plan modal/banner with task list
  - "Approve Plan" button → `agentServiceV2.approvePlan()`
  - "Modify" option (future)

### Step 7.6: Task Lifecycle Buttons ✅ DONE
- [x] In TaskList, add action buttons per task:
  - "Start" (when ready) → `agentServiceV2.startTask(taskId)`
  - "Complete" (when in_progress) → `agentServiceV2.completeTask(taskId)`
  - "Cancel" → `agentServiceV2.cancelTask(taskId)`
- [x] Starting task should switch to Chat view for that worker

### Step 7.7: Cleanup ✅ DONE
- [x] Remove V1 imports: `AgentManagerService`, `SocketService`, `HttpService`
- [x] Remove V1 event handlers from ChatArea useEffect
- [x] Update types if needed

---

### V2 API Quick Reference

**HTTP Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v2/teams` | Create team with role discovery |
| GET | `/api/v2/teams` | List all teams |
| GET | `/api/v2/teams/:id` | Get team by ID |
| DELETE | `/api/v2/teams/:id` | Delete team |
| GET | `/api/v2/teams/:id/agents` | Get agents for team |
| GET | `/api/v2/sessions/:teamId` | Get session state |
| GET | `/api/v2/sessions/:teamId/tasks` | Get tasks for session |

**Socket Events (5 only):**
| Event | Direction | Purpose |
|-------|-----------|---------|
| `message` | ↔️ Both | Chat with agents |
| `action` | → Server | approve-plan, start-task, complete-task, cancel-task |
| `state` | ← Client | Session/task state changes |
| `output` | ← Client | Agent produced artifact |
| `error` | ← Client | Error occurred |

**Frontend Service Methods:**
```typescript
// Connection
agentServiceV2.connect(teamId)
agentServiceV2.disconnect()

// HTTP - Teams
agentServiceV2.createTeam(name, goal, description?)
agentServiceV2.getTeams()
agentServiceV2.getTeam(teamId)
agentServiceV2.deleteTeam(teamId)
agentServiceV2.getAgents(teamId)
agentServiceV2.getSession(teamId)
agentServiceV2.getTasks(teamId)

// Socket - Send
agentServiceV2.sendToManager(content)
agentServiceV2.sendToWorker(agentId, content, taskId?)

// Socket - Actions
agentServiceV2.approvePlan()
agentServiceV2.startTask(taskId)
agentServiceV2.completeTask(taskId, output?)
agentServiceV2.cancelTask(taskId)

// Socket - Subscribe (returns unsubscribe fn)
agentServiceV2.onMessage(callback)
agentServiceV2.onState(callback)
agentServiceV2.onOutput(callback)
agentServiceV2.onError(callback)
```

---

## Testing Strategy

| Phase | Tests |
|-------|-------|
| 1 | Socket handler unit tests, integration with frontend mock |
| 2 | Tool invocation test, event emission test |
| 3 | Git branch creation/merge tests, file isolation tests |
| 4 | Method unit tests |
| 5 | Full e2e: approve → chat → complete → merge flow |

---

## Rollback Plan

1. **Phase 1-4**: Parallel operation - old methods still work
2. **Phase 5**: If issues, revert deprecation commit, re-enable flag
3. **Workspace**: Can disable workspace creation, agents work without files

---

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1 | 2 hours | Low |
| Phase 2 | 1.5 hours | Low |
| Phase 3 | 3 hours | Medium (git edge cases) |
| Phase 4 | 2 hours | Low |
| Phase 5 | 1.5 hours | Medium (unknown usages) |
| Phase 6 | 4 hours | Medium (migration) |
| Phase 7 | 3 hours | Low (UI wiring) |
| **Total** | **~17 hours** | |

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `api/SocketServer.ts` | +3 handlers, +1 event forward |
| `agentManager/AgentManagerV2.ts` | +8 methods, deprecate 3 |
| `agentManager/WorkerPool.ts` | +workspace integration |
| `agentManager/tools/reportStatusTool.ts` | New file |
| `agentManager/InternalAgent.ts` | +tool wiring |
| `AgentChat/services/AgentManagerService.ts` | +3 methods |
| Tests | Multiple updates |
