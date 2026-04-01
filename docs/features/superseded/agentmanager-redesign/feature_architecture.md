# AgentManager Redesign - Feature Architecture

## Overview

Consolidate AgentManagerV2 to use OrchestratorService as the **only** coordination path. Add team agent registry and task control methods for a clean, unified API.

**Goal:** Cleanup and polish - make AgentManagerV2 a thin coordinator with single entry point.

## ⚠️ Critical: User-Worker Communication Must Be Preserved

The current flow supports **direct user-worker communication**:

```typescript
// Current API (MUST KEEP)
startTask(role, message)   → Start conversation with specific worker
continueTask(taskId, message) → Continue conversation with same worker
stopTask(taskId)           → End conversation and dispose worker
```

**This communication pattern WILL NOT CHANGE.** The redesign only affects:
- How tasks get planned/proposed (via Orchestrator)
- How task status is tracked (via MemoryManager)
- Legacy methods like `configureWorkflow()`, `createPlan()`

---

## ⚠️ Critical: Task Completion Investigation

### Current Implementation Analysis

**Finding 1: Direct Chat Mode (startTask/continueTask) - User-Driven ✅**
```typescript
// User starts conversation
const { taskId, response } = await mgr.startTask(role, message);

// User continues conversation (multiple turns)
const result = await mgr.continueTask(taskId, message);

// User explicitly ends when done
await mgr.stopTask(taskId);
```
This mode is **already user-driven**. The e2e test shows interactive loop until user types "exit".

**Finding 2: executeQueuedTask() - Auto-Completes ⚠️**
```typescript
// In AgentManagerV2.executeQueuedTask():
this.workerPool.runTask(task).then((output) => {
  this.taskQueue.completeTask(task.id, output);  // Auto-completes on first response
});
```
Queue-based execution auto-completes when WorkerPool returns.

**Finding 3: OrchestratorService.wakeWorker() - Also Auto-Completes ⚠️**
```typescript
// In OrchestratorService.wakeWorker():
this.workerPool.runTask(taskWithContext).then((output: any) => {
  this.memoryManager.completeTask(taskId, output);  // Auto-completes
});
```
Orchestrator path also auto-completes on first response.

---

### The Two Execution Modes

| Mode | Entry Point | Completion | Multi-Turn Chat |
|------|-------------|------------|-----------------|
| **Direct Chat** | `startTask()` / `continueTask()` | User calls `stopTask()` | ✅ Yes |
| **Queue/Orchestrator** | `approveTask()` → `wakeWorker()` | Auto on first response | ❌ No |

---

### What's Needed: Bridge Queue Tasks to Direct Chat

**Option 1: Queue tasks start direct chat session**
```typescript
approveTask(taskId)
  → Creates taskId in workerPool
  → User uses continueTask(taskId, msg) to chat
  → User calls completeTask(taskId) when satisfied
  → Task marked complete, dependents unlocked
```

**Option 2: Auto-complete but allow feedback loop**
```typescript
approveTask(taskId)
  → Worker executes, produces output
  → Output shown to user for review
  → User: "revise this" → creates new task
  → User: "approved" → task complete
```

**Option 3: Keep as-is, separate concerns**
- Queue mode = automated execution pipeline
- Chat mode = interactive development
- Different use cases, not combined

---

### Comparison: Deprecated RoleManager vs Current

| Aspect | Deprecated RoleManager | Current AgentManagerV2 |
|--------|------------------------|------------------------|
| **Role Discovery** | `suggestRoles()` → ROLE builder → RoleDefinition[] | `configureWorkflow()` → DefinitionBuilder → AgentDefinition[] |
| **Config Generation** | `getRoles()` → CONFIG builder → AgentConfig[] | Included in DefinitionBuilder output |
| **Worker Creation** | `initRoles()` → new AgentWorker(agent, workspace) | `WorkerPool.runTask()` → lazy creates InternalAgent |
| **Worker Storage** | `roleWorkers: Record<string, AgentWorker>` | `WorkerPool.workers: Map<taskId, InternalAgent>` |
| **Worker Key** | By role name (lowercase) | By taskId |
| **Workspace Support** | ✅ AgentWorkspace per worker | ❌ Not implemented |
| **Response Format** | Structured (type: inprogress/result/delegate/etc) | Raw output |

**Key Insight from RoleManager:**
- Workers keyed by **role** allowed persistent workers
- Response format included `type: "result"` for task completion signal
- Workspace support per-worker (git branch per agent)

---

### Recommendation: Hybrid Approach with Status Tool ✅ SELECTED

Agent has a `report_status` tool to signal progress. User always has final say.

```typescript
// Tool added to all workers
const report_status = tool({
  name: "report_status",
  description: "Report task status to user. Call when you need input or are done.",
  schema: z.object({
    status: z.enum(["in_progress", "need_clarification", "ready_for_review"]),
    summary: z.string().describe("Brief summary of progress or what you need"),
  }),
});
```

**Flow:**
```
approveTask(taskId)
     ↓
Agent starts working
     ↓
Agent: *calls report_status({ status: "in_progress", summary: "..." })*
     ↓
User: "Add validation"
     ↓
Agent: *works, calls report_status({ status: "ready_for_review", summary: "Added validation" })*
     ↓
UI: Shows "Agent ready for review" notification
     ↓
User: Reviews output
     ↓
User: "Approved" → completeTask(taskId) → Dependents unlocked
  OR
User: "Change X" → continues conversation
```

**Why this works:**
- No response schema enforcement needed
- Agent naturally signals when done
- User sees status in UI, decides when to approve
- Tool call emits event: `task:status` → UI updates
- Works with existing InternalAgent (just add tool)

---

**Current role initialization has two paths:**

### Legacy Path (configureWorkflow)
```typescript
configureWorkflow(taskDescription)
  → DefinitionBuilder (LLM) discovers roles
  → Creates AgentDefinition[]
  → Registers with WorkerPool
```
✅ **Auto-discovers** roles based on task description

### Orchestrator Path (initializeOrchestrator)
```typescript
initializeOrchestrator(teamId, teamRoles)
  → Creates definitions from provided roles
  → Registers with WorkerPool
  → Creates OrchestratorService
```
❌ **Requires explicit roles** - doesn't auto-discover

---

### Options for Role Initialization

**Option R1: Keep configureWorkflow for discovery** ✅ SELECTED
```typescript
// Step 1: Discover roles (uses DefinitionBuilder LLM)
const roles = await agentManager.discoverRoles(taskDescription);

// Step 2: Initialize orchestrator with discovered roles
await agentManager.initializeOrchestrator(teamId, roles);

// Step 3: Send messages
await agentManager.handleMessage("Build a login page", threadId);
```
Pros: Preserves LLM-based role discovery, clean separation
Cons: Two-step initialization

**Why R1?**
- **Future-proof**: `discoverRoles()` can migrate to Team Builder later
- **Team Builder alignment**: Role Manager (meta-agent) will handle role synthesis
- **AgentManager stays thin**: Just coordinates, doesn't design teams

**Migration path to Team Builder:**
```
Current:
  AgentManager.discoverRoles(task) → RoleManager → roles[]
  AgentManager.initializeOrchestrator(teamId, roles)

Future (Team Builder):
  TeamBuilder.createTeam(task) → RoleManager → TeamConfig
  AgentManager.loadTeam(TeamConfig)  // Just loads, no discovery
```

See: [Team Builder Architecture](../../../ping/team-builder.md)

---

## Current State

```
┌─────────────────────────────────────────────────────────────┐
│                      AgentManagerV2                          │
├─────────────────────────────────────────────────────────────┤
│  USE_ORCHESTRATOR=true         USE_ORCHESTRATOR=false       │
│  ┌─────────────────────┐       ┌─────────────────────┐      │
│  │ handleMessage()     │       │ configureWorkflow() │      │
│  │ → OrchestratorSvc   │       │ createPlan()        │      │
│  │ → approvePlan()     │       │ planTasksForRoles() │      │
│  └─────────────────────┘       └─────────────────────┘      │
│            ↓                              ↓                  │
│     MemoryManager              MemoryManager                 │
│     WorkerPool                 AgentWorkers (direct)         │
└─────────────────────────────────────────────────────────────┘
```

**Problem:** Two parallel code paths, legacy methods still exist, no clean API for team management or task control.

---

## Architecture Options

### Option A: Parallel Operation (Safe)

**Implementation:** Keep both paths working, add new methods alongside existing ones. Only remove legacy code after full validation.

```typescript
class AgentManagerV2 {
  // ROLE DISCOVERY (will migrate to Team Builder)
  discoverRoles(taskDescription): Promise<AgentDefinition[]>;  // renamed from configureWorkflow
  
  // PRIMARY: Orchestrator path
  initializeOrchestrator(teamId, roles): Promise<void>;
  handleMessage(message, threadId): Promise<OrchestratorResponse>;
  approvePlan(planId): Promise<void>;
  
  // TASK LIFECYCLE (bridging queue and chat modes)
  approveTask(taskId): string;           // Starts task, returns taskId for chatting
  continueTask(taskId, message): any;    // Continue conversation with worker
  completeTask(taskId, output?): void;   // User marks task done → unlocks dependents
  
  // DIRECT WORKER CHAT (for ad-hoc work, not queue-based)
  startTask(role, message): Promise<{ taskId, response }>;
  stopTask(taskId): Promise<void>;
  
  // NEW: Team registry and task control
  registerAgent(agent: IAgent): void;
  getActiveAgents(): IAgent[];
  modifyTask(taskId, changes): Promise<void>;
  discardTask(taskId): Promise<void>;
  getStatus(): Promise<WorkflowStatus>;
  
  // FUTURE: Team Builder integration
  loadTeam(teamConfig: TeamConfig): Promise<void>;
  
  // LEGACY (deprecate after validation)
  configureWorkflow(): Promise<void>;    // → renamed to discoverRoles
  createPlan(): Promise<void>;           // → moved to Orchestrator
  executeAllTasks(): Promise<void>;      // → REMOVE (auto-completes, no chat)
}
```

**Pros:**
- Zero risk of breaking existing functionality
- Can validate new path completely before removing old
- Easy rollback if issues discovered
- Tests continue passing throughout

**Cons:**
- Temporary code bloat
- Two ways to do things (potential confusion)
- Need to maintain both paths briefly

**Effort:** ~4 hours

---

### Option B: Immediate Replacement (Fast)

**Implementation:** Remove legacy methods immediately, force all usage through orchestrator path.

**Pros:**
- Clean code immediately
- No confusion about which path to use
- Less code to maintain

**Cons:**
- Risk of breaking unknown usages
- If something breaks, harder to debug
- Tests may need significant updates

**Effort:** ~3 hours (but risk of hidden issues)

---

### Option C: Feature Flag Transition (Safest)

**Implementation:** Keep USE_ORCHESTRATOR flag but default to `true`. Add deprecation warnings. Remove flag in next version.

**Pros:**
- Escape hatch if production issues
- Can roll back per-environment
- Gradual transition

**Cons:**
- Flag logic remains
- Delayed cleanup
- Still two code paths

**Effort:** ~2 hours

---

## Recommendation

**Option A: Parallel Operation** because:

1. **Safety first** - We're consolidating, not rebuilding
2. **Tests stay green** - Add new functionality, verify, then deprecate
3. **Clear deprecation path** - Mark old methods, remove next sprint
4. **User confidence** - Can demo new flow while old still works

---

## Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        AgentManagerV2                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ORCHESTRATION PATH           │  DIRECT WORKER CHAT (PRESERVED)  │
│  (planning & coordination)    │  (user-worker conversation)      │
│  ┌─────────────────────┐      │  ┌─────────────────────────┐     │
│  │ handleMessage()     │      │  │ startTask(role, msg)    │     │
│  │ → OrchestratorSvc   │      │  │ continueTask(id, msg)   │     │
│  │ → approvePlan()     │      │  │ stopTask(id)            │     │
│  └─────────────────────┘      │  └─────────────────────────┘     │
│            ↓                  │              ↓                    │
│     MemoryManager             │       WorkerPool                  │
│     RoleTaskQueue             │       (direct execution)          │
│                               │                                   │
└───────────────────────────────┴───────────────────────────────────┘
```

**Two separate concerns:**
1. **Orchestration** - Planning, approval, task queuing (Orchestrator path)
2. **Execution** - Direct user-worker chat (startTask/continueTask - UNCHANGED)

---

## New Types

```typescript
interface TaskChanges {
  description?: string;
  context?: Record<string, unknown>;
  priority?: number;
}

interface WorkflowStatus {
  state: 'idle' | 'planning' | 'awaiting_approval' | 'executing';
  pendingTasks: number;
  activeTasks: number;
  completedTasks: number;
  currentPlan?: string;
}

interface TaskStatusResponse {
  id: string;
  status: TaskStatus;
  role: string;
  progress?: number;
  error?: string;
}
```

---

## Integration Points

| Component | Integration |
|-----------|-------------|
| OrchestratorService | Primary coordinator, LLM-based planning |
| MemoryManager | Task storage, status tracking |
| RoleTaskQueue | Event-driven task dispatch |
| WorkerPool | Task execution |
| RoleManager | Dynamic agent registration |

---

## Files Affected

| File | Changes |
|------|---------|
| `AgentManagerV2.ts` | Add new methods, remove flag later |
| `types/AgentManager.types.ts` | Add TaskChanges, WorkflowStatus |
| `AgentManagerV2.test.ts` | Tests for new methods |

---

**Decision Required:** Proceed with Option A (Parallel Operation)?

---

## Identified Gaps

### Gap 1: Frontend Has No `completeTask` / `approveTask` API ❌
**Current:** Frontend uses `sendMessageToAgent()` which calls `startTask`/`continueTask`.
**Missing:** No way for frontend to:
- Approve a queued task
- Mark a task complete
- See task status (ready_for_review)

**Needed:**
- SocketServer: Add `task:approve`, `task:complete` handlers
- Frontend: Add `approveTask()`, `completeTask()` methods
- Event: `task:status` for UI updates

---

### Gap 2: `report_status` Tool Not Wired to Events ❌
**Proposed:** Agent calls `report_status` tool
**Missing:** Tool execution doesn't emit events to Socket.IO

**Needed:**
- Create `report_status` tool with event emission
- WorkerPool/InternalAgent: Capture tool calls → emit `task:status`
- SocketServer: Forward `task:status` to subscribed clients

---

### Gap 3: Workspace/Git Branch Support ✅ DECIDED

**Deprecated RoleManager had:** AgentWorkspace per worker (git branch per agent)
**Current WorkerPool:** No workspace support

**Files exist and are ready to use:**
- `workspace/AgentWorkspace.ts` - per-agent branch management, file ops, commit
- `workspace/WorkspaceManager.ts` - repo init, branch creation, merge, delete
- `workspace/mcp/` - workspace tools for agents

**Decision:** ✅ Use Git branches via existing `AgentWorkspace` infrastructure

---

### Gap 4: Worker Keyed by TaskId vs Role ⚠️
**Current:** `WorkerPool.workers: Map<taskId, InternalAgent>`
- Each task gets new worker instance
- No persistence across tasks for same role

**Deprecated RoleManager:** `roleWorkers: Record<role, AgentWorker>`
- Same worker handles all tasks for a role
- Maintains context across tasks

**Decision:** Keep taskId-based for now. Role-based persistence is future work.

---

### Gap 5: No Error Recovery for Long-Running Tasks ⚠️
**Current:** If socket disconnects mid-task, no recovery
**Needed for production:**
- Task state persistence
- Reconnection handling
- Resume capability

**Decision:** Out of scope for v1, document for future.

---

### Gap 6: `approveTask` vs `startTask` Flow ✅ DECIDED
**Decision:** Option A - Two-step process

```typescript
// Step 1: Approve unlocks the task (moves from proposed → ready)
approveTask(taskId);

// Step 2: User starts conversation with role
const { taskId: chatId, response } = await startTask(role, message);

// Step 3: Continue conversation
await continueTask(chatId, "add validation");

// Step 4: User marks complete when satisfied
completeTask(taskId);  // Original task ID, unlocks dependents
```

**Note:** `approveTask` and `startTask` use different IDs:
- `approveTask(taskId)` - Plan task ID from MemoryManager
- `startTask(role, msg)` - Creates new chat taskId in WorkerPool

---

### Gap 3: Workspace/Parallel Work - Implementation Plan

**Decision: ✅ Option A - Git Branches with Existing Infrastructure**

**Why Git Branches (not artifacts):**
1. **Infrastructure already built** - `WorkspaceManager` + `AgentWorkspace` exist
2. **True parallel isolation** - each agent works on own branch, no conflicts
3. **Real file operations** - agents can use file tools (read, write, search)
4. **Review before merge** - user approves, then merge to main
5. **Rollback support** - discard branch if task fails
6. **Audit trail** - git history shows exactly what each agent did

**Existing Capabilities (already in AgentWorkspace):**

```typescript
// Per-agent branch management
const workspace = new AgentWorkspace(config, taskId);
await workspace.checkoutBranch();  // Creates agent/<taskId> branch

// File operations
await workspace.writeFile("src/Login.tsx", content);
await workspace.readFile("src/config.ts");
await workspace.createFile("src/new.ts", content);
await workspace.deleteFile("src/old.ts");

// Commit changes
await workspace.commit("Implement login component");

// Check for changes
const files = await workspace.getChangedFiles();
```

**Existing Capabilities (already in WorkspaceManager):**

```typescript
// Initialize repo
const manager = new WorkspaceManager({ repoPath: "./workspace" });
await manager.initializeWorkspace();

// Create agent branch
await manager.createAgentBranch(taskId); // Creates agent/<taskId>

// Merge when approved
await manager.mergeAgentBranch(`agent/${taskId}`, "main");

// Cleanup
await manager.deleteAgentBranch(`agent/${taskId}`);
```

**Integration with WorkerPool:**

```typescript
// Modified WorkerPool to include workspace
class WorkerPool {
  private workspaceManager: WorkspaceManager;
  
  async createWorker(taskId: string): Promise<void> {
    // Create agent's branch
    await this.workspaceManager.createAgentBranch(taskId);
    
    // Create workspace for agent's file operations
    const workspace = new AgentWorkspace(config, taskId);
    
    // Create agent with workspace tools
    const agent = new InternalAgent({
      ...agentConfig,
      tools: [...agentConfig.tools, ...createWorkspaceTools(workspace)]
    });
    
    this.workers.set(taskId, { agent, workspace });
  }
}
```

**Parallel Work Flow:**

```
Task A (agent/task-001)          Task B (agent/task-002)
──────────────────────          ──────────────────────
Create branch                    Create branch
    ↓                               ↓
Edit src/Login.tsx              Edit src/Signup.tsx
    ↓                               ↓
Commit changes                   Commit changes
    ↓                               ↓
User approves                    User approves
    ↓                               ↓
Merge to main ─────────────────→ Merge to main
                                  (sequential merges, auto-resolve usually)
```

**Conflict Handling:**

```typescript
// On task completion
async completeTask(taskId: string): Promise<MergeResult> {
  try {
    await this.workspaceManager.mergeAgentBranch(`agent/${taskId}`);
    await this.workspaceManager.deleteAgentBranch(`agent/${taskId}`);
    return { success: true };
  } catch (error) {
    // Merge conflict - user must resolve
    return { 
      success: false, 
      conflict: true,
      files: await this.getConflictedFiles()
    };
  }
}
```

**Why This Works for Parallel:**
- Agent A on `agent/task-001` can freely edit any file
- Agent B on `agent/task-002` can freely edit any file  
- They never see each other's changes during work
- Conflicts only possible at merge time
- Good task decomposition minimizes conflicts (different files per task)

---

### Summary: Decisions Made

| Gap | Decision | Status |
|-----|----------|--------|
| 1. Frontend API | Add `approveTask`, `completeTask` to Socket/Frontend | ✅ In Scope |
| 2. report_status tool | Create tool, wire to events | ✅ In Scope |
| 3. Workspace/Git | **Git branches** via existing `AgentWorkspace` infrastructure | ✅ In Scope |
| 4. Worker keying | Keep taskId-based. Role-based = future | ✅ Decided |
| 5. Error recovery | Out of scope for v1 | ⏸️ Deferred |
| 6. API flow | `approveTask` unlocks → `startTask` begins chat → `completeTask` ends | ✅ Decided |

---

## API Layer Redesign

**Full Design:** See [docs/architecture/api-redesign.md](../../architecture/api-redesign.md)

### Problem Summary

Current API has 15+ socket events, two parallel flows (legacy + orchestrator), and AgentManager is passed everywhere creating tight coupling.

### Solution: Agent-Centric Model

Everything is an **Agent** to the frontend:
- **Orchestrator Agent** - Plans work, creates tasks
- **Worker Agents** - Execute tasks (Architect, Developer, etc.)

User chats with agents, all communication through unified events.

### Simplified Events (15+ → 5)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `message` | Bidirectional | Chat with any agent |
| `action` | Client→Server | approve-plan, start-task, complete-task, cancel |
| `state` | Server→Client | Session/task state changes |
| `output` | Server→Client | Agent produced structured output |
| `error` | Server→Client | Error occurred |

### Registry Pattern

**Problem:** AgentManager passed to SocketServer, HttpServer, Team - tight coupling.

**Solution:** AgentManagerRegistry with lazy loading:

```typescript
class AgentManagerRegistry {
  private managers: Map<string, AgentManager> = new Map()

  async getForTeam(teamId: string): Promise<AgentManager> {
    if (this.managers.has(teamId)) return this.managers.get(teamId)!
    
    const team = await TeamModel.findById(teamId).populate('members')
    const manager = new AgentManager({
      teamId: team.id,
      teamName: team.name,
      roles: team.members.map(m => ({ role: m.role, goal: m.goal }))
    })
    this.managers.set(teamId, manager)
    return manager
  }
}

export const agentManagerRegistry = new AgentManagerRegistry()
```

**Benefits:**
- Team data in MongoDB, runtime in memory
- Lazy loading - create when needed
- Teams isolated
- Server restart = reload from DB
- No more passing AgentManager everywhere

### HTTP vs Socket Separation

| Socket (real-time) | HTTP (CRUD) |
|-------------------|-------------|
| Chat with agents | Create/list teams |
| Actions (approve, complete) | Get agents for team |
| State updates | Initial data loading |
| Output streaming | Session queries |

### Frontend: Simplified Service

```typescript
class AgentService {
  // Send
  sendToOrchestrator(content: string): void
  sendToWorker(agentId: string, taskId: string, content: string): void
  
  // Actions
  approvePlan(): void
  startTask(taskId: string): void
  completeTask(taskId: string, output?: any): void
  
  // Receive
  onMessage(callback): () => void
  onState(callback): () => void
  onOutput(callback): () => void
  onError(callback): () => void
}
```

### Migration Path

1. **Phase 1:** Add new API alongside old
2. **Phase 2:** Migrate frontend to new events
3. **Phase 3:** Remove deprecated code
---

## Frontend Architecture (Current State)

**Based on code analysis of `src/AgentChat/`**

### Current Component Structure

```
App.tsx (Main State Container)
├── Sidebar.tsx (Workflow/Agent List)
│   └── Renders Agent[] hierarchy with collapse/expand
├── ChatArea/ (Chat + Tasks)
│   ├── Header.tsx (Agent info, Chat/Tasks toggle, delete)
│   ├── MessageList.tsx (Renders messages)
│   ├── ChatInput.tsx (User input)
│   └── TaskList.tsx (Tasks view - currently unused)
├── AgentModal/ (Create Workflow/Agent Modal)
└── AgentManagerPanel/ (Orchestration logs - debug panel)
```

### Current Data Model

```typescript
// Agent hierarchy (displayed in sidebar)
interface Agent {
  id: string;           // teamId from backend (MongoDB _id)
  name: string;         // Team/Workflow name
  role: string;         // Role identifier
  description: string;  // Goal/Description
  icon: string;         // Lucide icon name
  parentId?: string;    // teamId for sub-agents
  subAgents?: Agent[];  // Worker agents under team
  collapsed?: boolean;  // UI state
}

// Tasks (LOCAL only - not connected to backend)
interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}
```

### Current Workflow Creation Flow

```
[+ New Workflow button] → [AgentModal opens]
        ↓
User fills: name, description, goal
        ↓
handleAddAgent() → agentManagerService.createTeam({...})
        ↓
Backend: POST /api/createnewteam
  → DefinitionBuilder discovers roles
  → Saves to MongoDB
  → Returns team + agents
        ↓
Frontend: agentManagerService.getRolesByTeam(teamId)
        ↓
Creates Agent hierarchy in state:
  - Parent: Team (role="Manager")
  - Children: Worker agents (Architect, Developer, etc.)
```

### Current Chat Flow (V1)

```
User types message in ChatArea
        ↓
handleSubmit() → agentManagerService.sendMessageToAgent(role, content)
        ↓
V1 Socket: emit('sendMessage', { agentRole, content, taskId? })
        ↓
Backend: SocketServer receives, routes to AgentManagerV2.startTask()
        ↓
Worker executes, returns response
        ↓
V1 Socket: emit('agent:message', { agentRole, content })
        ↓
ChatArea: useEffect subscribes to 'agent:message' events
        ↓
Matches by role, appends to messages[]
```

### What's Not Working / Unused

1. **TaskList.tsx** - Shows tasks but not connected to backend
   - Current tasks are local dummy data (`DUMMY_TASKS`)
   - No integration with MemoryManager/OrchestratorService

2. **Plan Approval Flow** - Not implemented in UI
   - Backend has `approvePlan()` but no UI button
   - No plan display component

3. **Task Lifecycle** - Not implemented in UI
   - No startTask/completeTask buttons
   - No task status indicators

4. **Direct worker chat vs Orchestrator** - Confused
   - All messages go to `sendMessageToAgent(role)` 
   - No distinction between planning chat and task chat

---

## Frontend V2 Integration Plan

### Mapping: V1 → V2

| Current (V1) | V2 Equivalent |
|--------------|---------------|
| `agentManagerService.connect()` | `agentServiceV2.connect(teamId)` |
| `agentManagerService.createTeam()` | `agentServiceV2.createTeam()` |
| `agentManagerService.getTeams()` | `agentServiceV2.getTeams()` |
| `agentManagerService.getRolesByTeam()` | `agentServiceV2.getAgents(teamId)` |
| `agentManagerService.sendMessageToAgent(role)` | `agentServiceV2.sendToWorker(agentId)` or `sendToManager()` |
| Listen to `agent:message` | `agentServiceV2.onMessage()` |
| Not implemented | `agentServiceV2.onState()` (plan/task updates) |
| Not implemented | `agentServiceV2.approvePlan()` |
| Not implemented | `agentServiceV2.startTask()` / `completeTask()` |

### Key UI Changes Needed

**1. Deferred Socket Connection**
- HTTP calls work **without socket** (fetch teams, agents)
- Socket connects **when user clicks a team** in sidebar
- Can reconnect when switching between teams

```tsx
// Current flow (CORRECT for team list)
useEffect(() => {
  // HTTP - works without socket
  const teams = await agentServiceV2.getTeams();  // No socket needed
  setAgents(teams);
}, []);

// V2 flow - connect socket when team selected
useEffect(() => {
  if (!activeAgentId) return;
  
  // Find if this is a team (parent agent)
  const team = agents.find(a => a.id === activeAgentId && !a.parentId);
  if (team) {
    // Connect socket for this team
    agentServiceV2.connect(team.id);
  }
  
  return () => agentServiceV2.disconnect();
}, [activeAgentId]);
```

**Summary:**
| Operation | Needs Socket? | When |
|-----------|---------------|------|
| Fetch teams | ❌ HTTP | App mount |
| Fetch agents for team | ❌ HTTP | Team selected |
| Chat with agents | ✅ Socket | After team selected |
| Actions (approve, complete) | ✅ Socket | After team selected |

**2. Manager vs Worker Chat**
```tsx
// Current: Single send method
agentManagerService.sendMessageToAgent(agent.role, content);

// V2: Distinguish planning vs task chat
if (isOrchestratorAgent) {
  agentServiceV2.sendToManager(content);  // Planning conversation
} else {
  agentServiceV2.sendToWorker(agentId, content, taskId);  // Task execution
}
```

**3. Plan Approval UI**
- Listen to `state` events for `sessionState: "awaiting_approval"`
- Show plan with task list
- "Approve" button calls `agentServiceV2.approvePlan()`

**4. Task Lifecycle UI**
- TaskList.tsx needs to show real tasks from `getTasks(teamId)`
- Task status badges (pending, in_progress, completed)
- "Start" button → `startTask(taskId)` → opens worker chat
- "Complete" button → `completeTask(taskId)`

### State Management Changes

```typescript
// Current state in App.tsx
const [agents, setAgents] = useState<Agent[]>([]);
const [tasks, setTasks] = useState<Record<string, Task[]>>({}); // LOCAL ONLY

// V2 additions
const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
const [sessionState, setSessionState] = useState<SessionState | null>(null);
const [pendingPlan, setPendingPlan] = useState<Task[] | null>(null);
```

### Event Wiring

```tsx
useEffect(() => {
  if (!selectedTeamId) return;
  
  agentServiceV2.connect(selectedTeamId);
  
  const unsubMessage = agentServiceV2.onMessage((msg) => {
    // Update chat for appropriate agent
  });
  
  const unsubState = agentServiceV2.onState((state) => {
    setSessionState(state.sessionState);
    if (state.plan) setPendingPlan(state.plan);
    if (state.tasks) updateTaskStatuses(state.tasks);
  });
  
  const unsubOutput = agentServiceV2.onOutput((output) => {
    // Handle agent artifacts (files, code, etc.)
  });
  
  const unsubError = agentServiceV2.onError((error) => {
    // Show error toast
  });
  
  return () => {
    unsubMessage();
    unsubState();
    unsubOutput();
    unsubError();
    agentServiceV2.disconnect();
  };
}, [selectedTeamId]);
```