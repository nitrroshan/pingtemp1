# Feature: Frontend Orchestrator Integration

**Status:** `planned`
**Priority:** 🟡 High
**Estimated:** 3-4 hours
**Dependencies:** AgentManager Redesign (Task-004) ✅

## Overview

Integrate the new orchestrator-based workflow into the frontend. Currently, the frontend uses the legacy `agent:message` flow (direct chat with agents). This feature adds support for the orchestrator flow:

1. User chats with Orchestrator → Plan proposed
2. User approves plan → Tasks created
3. User approves/chats with each task → Task execution
4. User marks task complete → Dependents unlocked

## Current State

### Backend (Ready ✅)

| Socket Event | Direction | Handler | Status |
|--------------|-----------|---------|--------|
| `orchestrator:message` | Client→Server | `handleOrchestratorMessage` | ✅ |
| `plan:approve` | Client→Server | `handlePlanApprove` | ✅ |
| `task:approve` | Client→Server | `handleTaskApprove` | ✅ |
| `task:complete` | Client→Server | `handleTaskComplete` | ✅ |
| `plan:proposed` | Server→Client | Event forwarding | ✅ |
| `plan:approved` | Server→Client | Event forwarding | ✅ |
| `task:approved` | Server→Client | Event forwarding | ✅ |
| `task:completed` | Server→Client | Event forwarding | ✅ |
| `task:status` | Server→Client | Event forwarding | ✅ |
| `orchestrator:progress` | Server→Client | Event forwarding | ✅ |

### Frontend (Needs Work ❌)

| Feature | Status |
|---------|--------|
| `sendMessageToAgent` (legacy) | ✅ Working |
| `sendOrchestratorMessage` | ❌ Missing |
| `approvePlan` | ❌ Missing |
| `approveTaskForChat` | ❌ Missing |
| `completeTask` | ❌ Missing |
| Plan approval UI | ❌ Missing |
| Task list panel | ❌ Missing |
| Task chat view | ❌ Missing |

## Architecture

### Two Parallel Flows

```
┌─────────────────────────────────────────────────────────────────┐
│                         LEGACY FLOW                              │
│  (Keep working - don't break)                                   │
├─────────────────────────────────────────────────────────────────┤
│  User → sendMessageToAgent(role, content)                       │
│       → agent:message socket event                              │
│       → startTask/continueTask on backend                       │
│       → agent:message response                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR FLOW (NEW)                     │
├─────────────────────────────────────────────────────────────────┤
│  1. PLANNING PHASE                                              │
│     User → sendOrchestratorMessage(content, teamId, roles)      │
│          → orchestrator:message socket event                    │
│          → orchestrator:message response (with plan)            │
│                                                                  │
│  2. APPROVAL PHASE                                              │
│     User → approvePlan()                                        │
│          → plan:approve socket event                            │
│          → plan:approval:success (tasksQueued count)            │
│          → Tasks appear in MemoryManager                        │
│                                                                  │
│  3. TASK EXECUTION PHASE (per task)                             │
│     User → approveTaskForChat(taskId)                           │
│          → task:approve socket event                            │
│          → task:approved response                               │
│     User → startTaskExecution(taskId) [optional auto]           │
│     User → continueTask(taskId, message) [chat]                 │
│     User → completeTask(taskId)                                 │
│          → task:complete socket event                           │
│          → task:completed response                              │
│          → Dependents unlocked                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Service Layer Changes

```typescript
// AgentManagerService additions:

// Orchestrator methods
async initializeOrchestrator(teamId: string, teamRoles: string[]): Promise<void>
async sendOrchestratorMessage(content: string): Promise<OrchestratorResponse>
async approvePlan(): Promise<{ success: boolean; tasksQueued?: number }>
getOrchestratorState(): OrchestratorState | null
getPendingPlan(): TaskPlan | null

// Task lifecycle methods
async approveTaskForChat(taskId: string): Promise<{ taskId: string; role: string }>
async startTaskExecution(taskId: string): Promise<{ taskId: string; response: string }>
async completeTask(taskId: string, output?: any): Promise<{ success: boolean }>
async getTaskStatus(taskId: string): Promise<TaskStatus>
async modifyTask(taskId: string, changes: TaskChanges): Promise<void>
async discardTask(taskId: string): Promise<void>

// Auto-approve config
async setAutoApproveForRole(role: string, enabled: boolean): Promise<void>
async setAutoApproveAllRoles(enabled: boolean): Promise<void>
```

## Implementation Plan

### Phase 1: Service Layer (~1 hour)

**Files:**
- `src/AgentChat/services/SocketService.ts` - Add emit methods
- `src/AgentChat/services/AgentManagerService.ts` - Add orchestrator methods
- `src/AgentChat/types.ts` - Add types

**Tasks:**
1. Add `OrchestratorState`, `TaskPlan`, `TaskStatus` types
2. Add `sendOrchestratorMessage()` method
3. Add `approvePlan()` method
4. Add task lifecycle methods
5. Add event subscription helpers

### Phase 2: State Management (~30 min)

**Files:**
- `src/AgentChat/hooks/useOrchestrator.ts` (new)
- `src/AgentChat/hooks/useTasks.ts` (new)

**Tasks:**
1. Create `useOrchestrator` hook for planning state
2. Create `useTasks` hook for task list state
3. Handle event subscriptions with cleanup

### Phase 3: UI Components (~1.5 hours)

**Files:**
- `src/AgentChat/components/PlanApproval.tsx` (new)
- `src/AgentChat/components/TaskList.tsx` (new)
- `src/AgentChat/components/TaskPanel.tsx` (new or modify ChatArea)

**Tasks:**
1. Plan approval modal/panel showing tasks
2. Task list in sidebar or panel
3. Task-specific chat view
4. Task completion button

### Phase 4: Integration (~30 min)

**Files:**
- `src/AgentChat/App.tsx` - Wire up new components

**Tasks:**
1. Add orchestrator mode toggle
2. Show plan when proposed
3. Switch chat context between orchestrator and task
4. Handle task completion flow

## UI Layout

### Three-Panel Layout with Dynamic Center

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ┌─ TOOLBAR ──────────────────────────────────────────────────────────────────────┐  │
│  │ [💾 Save] [📋 Copy] [✓ Approve] [✎ Modify] [✕ Discard] │ [⚡Auto] [🔄] [📋Plan] │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  LEFT SIDEBAR (240px)       │  CENTER (flex)              │  RIGHT PANEL (toggle)    │
│  ┌────────────────────────┐ │  ┌────────────────────────┐ │  ┌────────────────────┐  │
│  │ [Teams] [Projects]     │ │  │                        │ │  │                    │  │
│  │ (tab toggle)           │ │  │  DYNAMIC CONTENT       │ │  │  CHAT PANEL        │  │
│  ├────────────────────────┤ │  │                        │ │  │  (when output mode)│  │
│  │                        │ │  │  Default: Chat Area    │ │  │                    │  │
│  │  TEAMS VIEW            │ │  │                        │ │  │  Shows conversation│  │
│  │  ─────────────         │ │  │  When Agent Output:    │ │  │  while reviewing   │  │
│  │  ▼ Dev Team            │ │  │  Shows output for      │ │  │  output in center  │  │
│  │    ├─ Architect        │ │  │  review/refinement     │ │  │                    │  │
│  │    ├─ Developer        │ │  │                        │ │  │  [Toggle ◀]        │  │
│  │    └─ Tester           │ │  │                        │ │  │                    │  │
│  │  ▶ Marketing Team      │ │  │                        │ │  └────────────────────┘  │
│  │                        │ │  │                        │ │                          │
│  ├────────────────────────┤ │  │                        │ │                          │
│  │  ACTIVE TASKS          │ │  │                        │ │                          │
│  │  ─────────────         │ │  │                        │ │                          │
│  │  ● Design API (Arch)   │ │  │                        │ │                          │
│  │  ○ Implement (Dev)     │ │  │                        │ │                          │
│  │  ○ Write tests (Test)  │ │  │                        │ │                          │
│  └────────────────────────┘ │  └────────────────────────┘ │                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─ STATUS BAR ───────────────────────────────────────────────────────────────────┐  │
│  │ Status: Planning │ Team: Dev Team │ Task: Design API │ Agent: Architect        │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Center Area Modes

| Mode | Trigger | Center Shows | Right Panel |
|------|---------|--------------|-------------|
| **Chat Mode** | Default | Chat conversation | Hidden |
| **Output Mode** | Agent produces output | Agent Output (large, editable) | Chat (toggleable) |
| **Plan Mode** | Plan proposed | Plan details + approval | Hidden |
| **Artifact Mode** | Click artifact | File viewer/editor | Chat (toggleable) |

### Task Execution Flow

```
1. User approves task or agent starts working → Layout shifts immediately
   ┌─────────────────────────────┬─────────────────────┐
   │  CENTER: Task Output        │  RIGHT: Chat        │
   │  ┌───────────────────────┐  │  (toggleable)       │
   │  │                       │  │  ┌───────────────┐  │
   │  │  🔄 Agent working...  │  │  │ User: Build.. │  │
   │  │                       │  │  │               │  │
   │  │  (streaming output    │  │  │               │  │
   │  │   appears here as     │  │  │ [Send msg]    │  │
   │  │   agent generates)    │  │  └───────────────┘  │
   │  │                       │  │                     │
   │  └───────────────────────┘  │  [◀ Hide Chat]      │
   │                             │                     │
   └─────────────────────────────┴─────────────────────┘
   
   TOOLBAR: [⏸ Pause] [✕ Cancel] (during execution)

2. Agent produces output → Output fills center (streaming)
   ┌─────────────────────────────┬─────────────────────┐
   │  CENTER: Agent Output       │  RIGHT: Chat        │
   │  ┌───────────────────────┐  │  (toggleable)       │
   │  │ ```json               │  │  ┌───────────────┐  │
   │  │ {                     │  │  │ User: Build.. │  │
   │  │   "users": {          │  │  │ Agent: Here's │  │
   │  │     "id": "uuid",     │  │  │ the schema... │  │
   │  │     "email": "str"    │  │  │               │  │
   │  │   }                   │  │  │ [Send msg]    │  │
   │  │ }                     │  │  └───────────────┘  │
   │  │ ```                   │  │                     │
   │  └───────────────────────┘  │  [◀ Hide Chat]      │
   │                             │                     │
   │  [Edit] [Validate] [Copy]   │                     │
   └─────────────────────────────┴─────────────────────┘
   
   TOOLBAR: [✓ Approve Output] [✎ Request Changes] [✕ Reject]

3. User refines via chat (right panel)
   - "Add a posts table too"
   - Agent updates output in center (streaming)
   
4. User approves → Output saved, back to chat mode or next task
```

### Toolbar (Top - Like Word/VS Code)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  FILE          │  ACTIONS              │  VIEW           │  SETTINGS          │
│  [💾 Save]     │  [✓ Approve]          │  [📋 Plan]      │  [⚡ Auto-approve] │
│  [📋 Copy]     │  [✎ Modify]           │  [🔄 Refresh]   │  [⚙️ Settings]     │
│  [📤 Export]   │  [✕ Discard/Reject]   │  [◀▶ Toggle]    │                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

Or simplified single row:
```
┌────────────────────────────────────────────────────────────────────────────────┐
│ [💾] [📋] [📤] │ [✓ Approve] [✎ Modify] [✕ Discard] │ [📋Plan] [🔄] [⚡Auto] [⚙️] │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Left Sidebar Structure

```
┌────────────────────────┐
│  [Teams] [Projects]    │  ← Tab toggle
├────────────────────────┤
│                        │
│  NAVIGATION VIEW       │  ← Upper section (scrollable)
│  (Teams or Projects)   │
│                        │
│  Height: ~60%          │
│                        │
├────────────────────────┤
│  ACTIVE TASKS          │  ← Lower section (fixed)
│                        │
│  Shows all in-progress │
│  tasks across teams    │
│                        │
│  Height: ~40%          │
│                        │
└────────────────────────┘
```

### Right Panel (Toggleable)

Only appears when:
- Output mode (shows chat for refinement)
- Artifact mode (shows related info)
- User explicitly toggles it

| Section | Content |
|---------|---------|
| **Chat** | Conversation for refining output |
| **Task Info** | ID, role, status, dependencies (collapsible) |
| **Artifacts** | Files created/modified (collapsible) |

### View States

**1. Default (Chat Mode)**
```
┌─────────────────────────────────────────────────────────────────┐
│  TOOLBAR: [💾] [📋] │ [context-sensitive actions] │ [⚡] [⚙️]   │
├─────────────────────────────────────────────────────────────────┤
│  SIDEBAR          │  CENTER: Chat Area           │  (hidden)   │
└─────────────────────────────────────────────────────────────────┘
```

**2. Output Mode (Agent produced output)**
```
┌─────────────────────────────────────────────────────────────────┐
│  TOOLBAR: [✓ Approve] [✎ Request Changes] [✕ Reject] │ [⚡] [⚙️]│
├─────────────────────────────────────────────────────────────────┤
│  SIDEBAR          │  CENTER: Output Review       │ RIGHT: Chat │
│                   │  (large, editable)           │ (toggle)    │
└─────────────────────────────────────────────────────────────────┘
```

**3. Plan Mode (Plan proposed)**
```
┌─────────────────────────────────────────────────────────────────┐
│  TOOLBAR: [✓ Approve Plan] [✎ Modify Plan] │ [📋] [⚡] [⚙️]     │
├─────────────────────────────────────────────────────────────────┤
│  SIDEBAR          │  CENTER: Plan Details        │  (hidden)   │
│                   │  Task list, dependencies     │             │
└─────────────────────────────────────────────────────────────────┘
```

### Status Bar (Bottom)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ 🟢 Connected │ Team: Dev Team │ Task: Design API │ Agent: Architect │ ● Active │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| Desktop (>1200px) | Full 3-panel when output mode |
| Tablet (768-1200px) | 2 columns, right panel as overlay/drawer |
| Mobile (<768px) | Single column, swipe between views |

## Types to Add

```typescript
// types.ts

interface OrchestratorState {
  state: 'idle' | 'planning' | 'awaiting_approval' | 'executing';
  teamId: string;
  pendingPlan?: TaskPlan;
}

interface TaskPlan {
  planId: string;
  tasks: PlannedTask[];
  rationale?: string;
  createdAt: number;
}

interface PlannedTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: number;
  dependencies: string[];
}

interface TaskStatus {
  id: string;
  description: string;
  assigned_role: string;
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed';
  dependencies?: string[];
  output?: any;
}

interface OrchestratorResponse {
  content: string;
  state: string;
  pendingPlan?: TaskPlan;
  timestamp: number;
}
```

## Migration Strategy

1. **Keep legacy flow working** - Don't touch existing `sendMessageToAgent`
2. **Add orchestrator as opt-in** - New projects use orchestrator, existing keep legacy
3. **Feature flag** - `useOrchestrator` boolean on project/team level
4. **Gradual rollout** - Test orchestrator flow, then make default

## Testing

- Unit tests for new service methods
- Integration test: full orchestrator → plan → task flow
- UI tests: plan approval, task list, task completion
- Regression: ensure legacy flow still works

## Notes

- This builds on Task-004 (AgentManager Redesign) which is complete
- Backend is ready, this is purely frontend work
- Keep both flows working in parallel during transition
