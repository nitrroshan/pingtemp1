# Unified Orchestrator Model

**Status:** Proposed  
**Replaces:** Two-mode AgentManager (chatWithAgent/handleGoal)  
**Last Updated:** January 24, 2026  
**Version:** 2.2 (with RoleManager flow + MVP scope + A2A readiness)

---

## Executive Summary

The Orchestrator acts as a **Project Manager Agent** - a single entry point for all user interactions during **execution mode**. Instead of separate "chat mode" and "goal mode", everything flows through the Orchestrator which:

- Routes messages using **tiered approach** (instant vs approval)
- Creates and manages task plans (via `create_plan` tool)
- Waits for user approval before execution (tasks AND artifacts)
- Accepts task modifications, additions, and context updates
- Provides status updates on request
- Handles worker-to-worker collaboration via **time-boxed group chats**
- Manages **git branches** per task for safe execution and rollback

**Important Distinction:**
- **Design Mode (Team Builder):** RoleManager creates agents → Team is published
- **Execution Mode (Orchestrator):** Works with pre-configured, published team

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                          │
│                   (Project Manager Agent)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│   USER ◄──────────────────────────────────────────► WORKERS  │
│                                                               │
│   • Send messages                    • Execute in git branch  │
│   • Add/modify tasks                 • Report progress        │
│   • Update task context              • Request collaboration  │
│   • Ask for status                   • Produce artifacts      │
│   • Approve tasks & artifacts        • Request merge          │
│   • Set auto-approval modes          • Group chat if needed   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Creation & Team Flow

**Important:** The Orchestrator does NOT create agents. Agents are created during **Design Mode** via Team Builder + RoleManager, then published as a team.

```
┌─────────────────────────────────────────────────────────────┐
│                    DESIGN MODE                               │
│                  (Team Builder)                              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  User: "I need a team to build a marketing campaign"         │
│         ↓                                                    │
│  RoleManager (meta-agent):                                   │
│    • Analyzes goal                                           │
│    • Suggests roles: Writer, Editor, Researcher              │
│    • Creates agent configs                                   │
│         ↓                                                    │
│  Team Builder:                                               │
│    • Refines agents conversationally                         │
│    • User approves team composition                          │
│    • PUBLISHES TEAM                                          │
│         ↓                                                    │
│  Published Team Config                                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Team published
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXECUTION MODE                             │
│                   (Ping Runtime)                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  AgentManager:                                               │
│    • Loads published team config                             │
│    • Instantiates workers from config                        │
│    • Registers workers in WorkerRegistry                     │
│         ↓                                                    │
│  Orchestrator:                                               │
│    • Receives user messages                                  │
│    • Uses pre-configured workers                             │
│    • Does NOT create/modify agents                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
- **RoleManager** = Design-time meta-agent (part of Team Builder)
- **Orchestrator** = Execution-time coordinator (part of Ping Runtime)
- **Team Config** = Bridge between design and execution
- **Workers** = Instantiated from published team config

```typescript
interface PublishedTeam {
  teamId: string;
  name: string;
  agents: AgentConfig[];  // Created by RoleManager
  createdAt: Date;
  publishedBy: string;    // User who designed the team
}

interface AgentConfig {
  role: string;           // e.g., "writer"
  name: string;           // e.g., "Content Writer"
  systemPrompt: string;
  tools: string[];        // Tool names this agent can use
  capabilities: string[];
}

// At runtime:
class AgentManager {
  async loadTeam(teamId: string): Promise<void> {
    const team = await teamService.getPublishedTeam(teamId);
    
    for (const config of team.agents) {
      const worker = await WorkerAgent.create(config);
      this.workerRegistry.register(config.role, worker);
    }
  }
}
```

---

## Why Single Entry Point?

### ❌ Previous Design (Two Modes)

```
User Message
     ↓
┌────────────────────────────────────────┐
│ AgentManager decides mode:             │
│                                        │
│  "Hey writer, review this" → chatMode  │
│  "Build a campaign" → goalMode         │
└────────────────────────────────────────┘
```

**Problems:**
- Forces user to think about modes
- System must classify intent
- Awkward handoffs between modes
- Two separate code paths

### ✅ New Design (Unified)

```
User Message (any)
     ↓
┌────────────────────────────────────────┐
│ Orchestrator (always)                  │
│                                        │
│  • Routes to agent if direct question  │
│  • Creates plan if goal detected       │
│  • ALWAYS waits for approval           │
│  • User can modify/add/discard tasks   │
└────────────────────────────────────────┘
```

**Benefits:**
- Single entry point
- Natural conversation flow
- Human-in-the-loop by default
- Full user control

---

## Tiered Routing (Instant vs Approval)

Not everything needs approval. The Orchestrator classifies intent and routes accordingly:

```
┌─────────────────────────────────────────────────────────────┐
│                    ROUTING TIERS                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  INSTANT (no approval needed):                               │
│  • Questions: "What did researcher find?"                    │
│  • Status: "What's the progress?"                            │
│  • Direct @ mentions for conversation: "@writer clarify X"   │
│  • Follow-ups in active session                              │
│                                                               │
│  APPROVAL REQUIRED:                                          │
│  • New goals: "Build a campaign"                             │
│  • New tasks: "Also add SEO analysis"                        │
│  • Worker-requested tasks: "Writer needs editor review"      │
│  • Artifacts/outputs: Any deliverable from workers           │
│  • Branch merges: Worker completed, wants to merge           │
│  • Actions with cost: API calls, file writes, long compute   │
│                                                               │
│  AUTO-APPROVAL (user-configured):                            │
│  • Specific workers: "Always approve writer tasks"           │
│  • Specific task types: "Auto-approve research tasks"        │
│  • Auto-mode workers: Work independently until done          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Intent Classification:**
```typescript
type IntentType = 
  | 'question'      // instant → route to context/agent
  | 'status'        // instant → check MemoryManager
  | 'conversation'  // instant → route to active session
  | 'new_goal'      // approval → create plan
  | 'add_task'      // approval → add to plan
  | 'action'        // approval (or auto if configured)
```

---

## Conversation Sessions (Worker-Owned)

Sessions live in the **Worker**, not Orchestrator. This allows natural multi-turn conversations:

```
┌─────────────────────────────────────────────────────────────┐
│                 CONVERSATION MODEL                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  User: "@writer review this paragraph"                       │
│         ↓                                                    │
│  Orchestrator: Routes to Writer, Worker opens SESSION        │
│         ↓                                                    │
│  Writer: "Here's my review..."                               │
│         ↓                                                    │
│  [Session Active: Writer owns it]                            │
│         ↓                                                    │
│  User: "Can you make it shorter?"  ← Direct to Writer        │
│  User: "Also more formal"          ← Direct to Writer        │
│         ↓                                                    │
│  User: "Thanks, done"                                        │
│         ↓                                                    │
│  Worker: Closes session, requests Orchestrator approval      │
│         ↓                                                    │
│  Orchestrator: "Writer session complete. Approve artifact?"  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Rules:**
- **Worker owns session** - manages conversation state
- **Session closes** when: worker marks done, user explicitly ends, or timeout
- **Orchestrator approves** session completion and any artifacts produced
- **New session** starts when: user mentions another agent, or gives new goal

```typescript
interface WorkerSession {
  sessionId: string;
  workerId: string;
  userId: string;
  threadId: string;
  status: 'active' | 'pending_approval' | 'closed';
  startedAt: Date;
  artifacts: Artifact[];  // Outputs produced during session
}
```

---

## Git Branching Model

Every task executes in its own **git branch**. This provides:
- **Isolation** - changes don't affect main until approved
- **Rollback** - delete branch if user cancels
- **Recovery** - retry in same branch or create new one

```
┌─────────────────────────────────────────────────────────────┐
│                    BRANCHING MODEL                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  main ──────────────────────────────────────────────────────│
│    │                                                         │
│    ├── task-001-research ──► Worker executes ──► Request merge
│    │       │                                         │        │
│    │       │ (fail? retry here or...)                ▼        │
│    │       └── task-001-research-v2 ──► Retry               │
│    │                                                         │
│    ├── task-002-writing ──► Worker executes ──► Request merge│
│    │                                                         │
│    └── task-003-editing ──► Worker executes ──► Request merge│
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Branch Lifecycle:**
```
Branch Created ──► Worker Executes ──► Task Complete ──► Request Merge
       │                  │                                    │
       │           (on failure)                         (user approves)
       │                  │                                    │
       │           Retry in branch                       Merge to main
       │           OR create new branch                        │
       │                                                       │
       └──────── (user cancels) ──► Delete branch ◄────────────┘
                                                      (rejected)
```

```typescript
interface TaskBranch {
  taskId: string;
  branchName: string;  // e.g., "task-001-research"
  status: 'active' | 'merge_requested' | 'merged' | 'deleted';
  version: number;     // Increments on retry with new branch
  parentBranch: string;  // Usually 'main'
}
```

---

## Worker-to-Worker Collaboration

### MVP: Task Requests (via Orchestrator)

For MVP, workers collaborate by **requesting tasks for other workers**. All requests go through Orchestrator for user approval:

```
Writer: "I need editor to review my draft"
       ↓
Orchestrator → User:
  "Writer requests: 'Review draft' for Editor
   [✓ Approve] [✕ Reject]"
       ↓ (approved)
Task queued for Editor
```

This is simple, safe, and gives users full visibility.

### Future: Group Chat (Post-MVP)

For complex collaboration requiring real-time discussion, workers can request a **time-boxed group chat**:

```
┌─────────────────────────────────────────────────────────────┐
│              WORKER COLLABORATION MODEL                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Writer: "I need to discuss with Editor before proceeding"   │
│         ↓                                                    │
│  Orchestrator → User:                                        │
│    "Writer requests collaboration with Editor.               │
│     Topic: Clarify tone and style for draft                  │
│     Duration: 15 minutes                                     │
│     [✓ Approve] [✕ Reject]"                                  │
│         ↓ (approved)                                         │
│  GROUP CHAT CREATED                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Participants: Writer, Editor, User (optional observer)  │ │
│  │ Time limit: 15 minutes                                   │ │
│  │ Goal: Decide context and task breakdown                  │ │
│  │                                                          │ │
│  │ Writer: "I'm thinking formal tone for intro..."         │ │
│  │ Editor: "Yes, but casual for examples..."               │ │
│  │ Writer: "Agreed. I'll draft, you review sections 2-3"   │ │
│  │ Editor: "Confirmed."                                     │ │
│  │                                                          │ │
│  │ [Session auto-closes in 15 min or when both confirm]    │ │
│  └─────────────────────────────────────────────────────────┘ │
│         ↓                                                    │
│  Orchestrator: Creates agreed tasks, adds to plan            │
│         ↓                                                    │
│  User: Approves new tasks                                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Rules:**
- **Time-boxed** - Max 15 minutes (configurable)
- **Outcome required** - Must produce agreed tasks/context
- **User visibility** - Can observe or participate
- **No loops** - Discussion ends, tasks are created, move on
- **Limit depth** - Max 2 workers in a collaboration session

```typescript
interface GroupChatSession {
  sessionId: string;
  participants: string[];  // Worker IDs
  userCanJoin: boolean;
  topic: string;
  maxDurationMinutes: number;
  status: 'active' | 'concluded' | 'timeout';
  outcome: {
    agreedTasks: TaskDefinition[];
    sharedContext: any;
  };
}
```

---

## Artifact Approval Workflow

**All artifacts require user approval** before they can be used by other workers or finalized:

```
Worker produces artifact
       ↓
Artifact stored (pending)
       ↓
Orchestrator → User:
  "Writer produced: Draft Copy v1
   [View] [✓ Approve] [✎ Request Changes] [✕ Reject]"
       ↓
┌──────────┬─────────────────┬──────────────────┐
│ Approve  │ Request Changes │ Reject           │
├──────────┼─────────────────┼──────────────────┤
│ Artifact │ Worker gets     │ Artifact         │
│ available│ feedback,       │ discarded,       │
│ for next │ revises in      │ task may be      │
│ task     │ same branch     │ reassigned       │
└──────────┴─────────────────┴──────────────────┘
```

```typescript
interface Artifact {
  id: string;
  taskId: string;
  workerId: string;
  type: 'document' | 'code' | 'data' | 'analysis' | 'other';
  content: any;
  status: 'pending_review' | 'approved' | 'changes_requested' | 'rejected';
  version: number;
  feedback?: string;  // User feedback if changes requested
}
```

---

## Auto-Approval Configuration

Users can configure automatic approval to reduce friction:

```typescript
interface AutoApprovalConfig {
  // Worker-level auto-approval
  workers: {
    [workerId: string]: {
      autoApproveTasks: boolean;     // Auto-approve task proposals
      autoApproveArtifacts: boolean; // Auto-approve outputs
      autoApproveMerges: boolean;    // Auto-approve branch merges
    };
  };
  
  // Task-type level
  taskTypes: {
    [type: string]: {
      autoApprove: boolean;  // e.g., 'research': true
    };
  };
  
  // Global
  autoApproveAll: boolean;  // Dangerous, but available
}
```

**UI Example:**
```
Agent Settings:
┌─────────────────────────────────────────────────────────────┐
│ Writer                                                       │
│ [x] Auto-approve task assignments                           │
│ [ ] Auto-approve artifacts (require review)                 │
│ [ ] Auto-approve merges (require review)                    │
├─────────────────────────────────────────────────────────────┤
│ Researcher                                                   │
│ [x] Auto-approve task assignments                           │
│ [x] Auto-approve artifacts                                  │
│ [x] Auto-approve merges                                     │
│ └─ "Researcher works fully autonomously"                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Task Lifecycle (Complete)

```
                    User modifies
                         │
                         ▼
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌───────────┐
│ proposed │───▶│ approved │───▶│ executing │───▶│ artifact   │───▶│ merging   │
└──────────┘    └──────────┘    └───────────┘    │ review     │    └───────────┘
     │               │                │          └────────────┘          │
     │ discard       │ discard        │ cancel         │                 │
     ▼               ▼                ▼                ▼                 ▼
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌───────────┐
│discarded │    │discarded │    │ cancelled │    │ rejected   │    │ completed │
└──────────┘    └──────────┘    │(branch del)│    │(revision)  │    │(merged)   │
                                └───────────┘    └────────────┘    └───────────┘
```

**States:**

| State | Description | Branch Status |
|-------|-------------|---------------|
| `proposed` | Awaiting user approval | Not created yet |
| `approved` | Ready for execution | Created |
| `executing` | Worker actively working | Active |
| `artifact_review` | Output produced, awaiting approval | Active |
| `merging` | Merge approved, in progress | Merging |
| `completed` | Successfully done | Merged & deleted |
| `cancelled` | User cancelled | Deleted |
| `rejected` | Artifact rejected | Active (for revision) |
| `discarded` | Task removed from plan | Deleted (if created) |

**Modification during execution:**

| Action | Allowed? | Behavior |
|--------|----------|----------|
| **Update context** | ✅ Yes | Worker sees on next iteration |
| **Modify task details** | ⚠️ Partial | Creates revision, worker notified |
| **Add new task** | ✅ Yes | Goes to proposed → approval |
| **Cancel executing task** | ✅ Yes | Worker stops, branch deleted |
| **Reorder queue** | ✅ Yes | Priority respected (v2 feature) |

---

## Priority & Ordering (v2)

_Planned for next version - design now, implement later._

```typescript
interface TaskPriority {
  taskId: string;
  priority: number;  // Higher = more urgent
  position: number;  // Explicit queue position
}

// User can say: "Do editor review first, it's urgent"
// Or drag-and-drop reorder in UI
```

---

## Error Handling & Recovery

Since workers use **git branches**, error handling is straightforward:

| Scenario | Behavior |
|----------|----------|
| **Worker fails mid-task** | Retry in same branch, or create new branch version |
| **User cancels during execution** | Delete branch, changes discarded |
| **Network disconnects** | Worker resumes from branch state on reconnect |
| **Artifact rejected** | Worker revises in same branch |
| **Merge conflict** | Orchestrator notifies user, manual resolution |

```typescript
interface TaskRecovery {
  taskId: string;
  failureCount: number;
  maxRetries: number;  // Default: 3
  recoveryStrategy: 'retry_same_branch' | 'new_branch' | 'manual';
  lastError?: string;
}
```

---

## Example Flow

```
User: "Build a marketing campaign for Product X"
          ↓
Orchestrator: (LLM reasons)
  "This is a goal. I'll create a plan."
          ↓
Orchestrator → User:
  ┌─────────────────────────────────────────────┐
  │ 📋 Proposed Plan:                           │
  │                                             │
  │ 1. [ ] Research competitors (researcher)   │
  │ 2. [ ] Write copy (writer)                 │
  │ 3. [ ] Review copy (editor)                │
  │                                             │
  │ [✓ Approve] [✎ Modify] [+ Add Task] [✕ Cancel] │
  └─────────────────────────────────────────────┘
          ↓
User: "Add SEO analysis before writing"
          ↓
Orchestrator: Updates plan, presents again
          ↓
User: "Approved"
          ↓
Orchestrator: Queues tasks → Agents execute
```

---

## Task Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                     TASK LIFECYCLE                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [proposed] ──approve──► [queued] ──agent picks──► [running] │
│      │                       │                         │      │
│      │ modify                │ update context          │      │
│      ▼                       ▼                         ▼      │
│  [proposed]              [queued]                   [running] │
│      │                                                 │      │
│      │ discard                                         │      │
│      ▼                                                 ▼      │
│  [discarded]                                     [completed]  │
│                                                    or [failed]│
│                                                               │
│  User can ADD NEW TASK at any point → goes to [proposed]     │
│  Worker can CREATE TASK → goes to [proposed] for approval    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Task States

| State | Description |
|-------|-------------|
| `proposed` | Created but awaiting user approval |
| `queued` | Approved, in TaskQueue waiting for agent |
| `running` | Agent actively working on it |
| `completed` | Successfully finished |
| `failed` | Failed with error |
| `discarded` | User rejected/cancelled |

---

## Worker-to-Worker Task Creation

Workers cannot directly communicate. All cross-worker coordination goes through Orchestrator:

```
Writer Agent: "I've drafted the copy. Need editor review."
       │
       ▼
Orchestrator receives: { type: 'request_task', for: 'editor', context: {...} }
       │
       ▼
Orchestrator → User:
  ┌─────────────────────────────────────────────┐
  │ 📋 Writer requests new task:                │
  │                                             │
  │ "Review draft copy" (for: editor)           │
  │ Context: [draft attached]                   │
  │                                             │
  │ [✓ Approve] [✎ Modify] [✕ Reject]          │
  └─────────────────────────────────────────────┘
       │
       ▼ (user approves)
       │
Task queued → Editor polls → Editor executes
```

---

## Status Updates

Users can always ask for status. Orchestrator provides real-time visibility:

```
User: "What's going on?"
       │
       ▼
Orchestrator: Checks MemoryManager + TaskQueue
       │
       ▼
┌─────────────────────────────────────────────┐
│ 📊 Current Status:                          │
│                                             │
│ ✅ Research competitors (researcher) - DONE │
│ 🔄 Write copy (writer) - IN PROGRESS        │
│    └─ 60% complete, working on benefits     │
│ ⏳ Review copy (editor) - WAITING           │
│ 📋 SEO analysis (researcher) - PROPOSED     │
│                                             │
│ Recent: Writer asked for brand guidelines   │
└─────────────────────────────────────────────┘
```

---

## AgentManager API (Updated)

```typescript
class AgentManager {
  private orchestrator: IAgent;
  private teamAgents: Map<string, IAgent>;
  private autoApprovalConfig: AutoApprovalConfig;
  
  // ═══════════════════════════════════════════════════════════
  // SINGLE ENTRY POINT - All user messages go here
  // ═══════════════════════════════════════════════════════════
  async handleMessage(message: string, threadId: string): Promise<OrchestratorResponse>;
  
  // ═══════════════════════════════════════════════════════════
  // USER ACTIONS ON PROPOSALS/TASKS
  // ═══════════════════════════════════════════════════════════
  async approveTask(taskId: string): Promise<void>;
  async modifyTask(taskId: string, changes: TaskChanges): Promise<void>;
  async updateTaskContext(taskId: string, context: any): Promise<void>;
  async addTask(task: TaskDefinition): Promise<void>;
  async discardTask(taskId: string): Promise<void>;
  
  // ═══════════════════════════════════════════════════════════
  // ARTIFACT APPROVAL
  // ═══════════════════════════════════════════════════════════
  async approveArtifact(artifactId: string): Promise<void>;
  async requestArtifactChanges(artifactId: string, feedback: string): Promise<void>;
  async rejectArtifact(artifactId: string): Promise<void>;
  
  // ═══════════════════════════════════════════════════════════
  // BRANCH/MERGE OPERATIONS
  // ═══════════════════════════════════════════════════════════
  async approveMerge(taskId: string): Promise<void>;
  async rejectMerge(taskId: string): Promise<void>;
  async cancelTask(taskId: string): Promise<void>;  // Deletes branch
  
  // ═══════════════════════════════════════════════════════════
  // STATUS - User can always ask
  // ═══════════════════════════════════════════════════════════
  async getStatus(): Promise<WorkflowStatus>;
  async getTaskStatus(taskId: string): Promise<TaskStatus>;
  
  // ═══════════════════════════════════════════════════════════
  // AUTO-APPROVAL CONFIGURATION
  // ═══════════════════════════════════════════════════════════
  async setWorkerAutoApproval(workerId: string, config: WorkerAutoApproval): Promise<void>;
  async setTaskTypeAutoApproval(taskType: string, autoApprove: boolean): Promise<void>;
  
  // ═══════════════════════════════════════════════════════════
  // TEAM MANAGEMENT
  // ═══════════════════════════════════════════════════════════
  registerAgent(agent: IAgent): void;
  getActiveAgents(): IAgent[];
  
  get isAvailable(): boolean;
}
```

---

## Orchestrator Tools (Updated)

### For Orchestrator Use

| Tool | Purpose |
|------|---------|
| `create_plan` | Create task plan from goal (LLM + structured output) |
| `queue_task` | Queue approved task, create branch |
| `get_status` | Check current workflow state |
| `sync_artifacts` | Store outputs (pending approval) |
| `replan` | Adjust plan after failure (LLM + structured output) |
| `create_branch` | Create git branch for task |
| `merge_branch` | Merge completed task branch |
| `delete_branch` | Delete branch (cancelled/rejected) |

### For Worker Use

| Tool | Purpose |
|------|---------|
| `request_task` | Request task for another worker → proposed |
| `report_progress` | Send status update |
| `report_blocker` | Report issue needing attention |
| `ask_user` | Forward question to user |
| `get_context` | Get context from dependencies |
| `submit_artifact` | Submit output for approval |
| `request_merge` | Request branch merge on completion |
| `close_session` | End conversation session |

---

## MVP Scope & Future Phases

**What's IN for MVP:**

| Feature | MVP Scope |
|---------|-----------|
| **Team Service** | Single team with `teamId` context (multi-team ready) |
| **Orchestrator** | Unified entry, tiered routing, approvals |
| **TaskQueue** | Role-based queue with polling |
| **Git Branching** | Branch per task, merge/rollback |
| **Worker Sessions** | Worker-owned conversations |
| **Artifact Approval** | All artifacts require approval |
| **Planning** | `create_plan` tool with structured output (Orchestrator owns planning) |
| **Worker Task Requests** | Workers request tasks for others → user approval |
| **Auto-Approval** | Configurable per worker |
| **IAgentComm** | Abstraction layer (relay impl only) - A2A ready |

**What's OUT (Post-MVP):**

| Feature | Phase | Notes |
|---------|-------|-------|
| **Hybrid Artifact Store** | Stable | Object storage for binaries, LFS |
| **Progress Checkpoints** | Stable | Partial outputs, % complete |
| **External Agent Adapters** | Stable | HTTP/MCP adapters for BYOA |
| **Group Chat** | Stable | Time-boxed worker collaboration sessions |
| **Real-Time Collaboration (OT/CRDT)** | Incremental 2+ | Multi-agent doc co-editing |
| **Cross-Team Orchestration** | Incremental 1 | Multi-team dependencies |
| **Agent Performance Analytics** | Incremental 2 | Utilization, success rates |
| **Semantic Diffs** | Incremental 2 | Content-aware artifact diffs |
| **Direct Agent Comm** | Stable | Bypass relay for trusted internal agents |
| **A2A Protocol Support** | Incremental 2 | External agent integration via A2A |

**MVP Artifact Handling:**
- Git-only storage (code + documents as files)
- Simple file-based artifacts
- PR workflow for merges
- No binary/object storage (files in repo)

---

## Design Decisions (Updated)

| Question | Answer |
|----------|--------|
| **Routing** | Tiered: instant (questions/status) vs approval (tasks/artifacts) |
| **Conversation sessions** | Worker-owned, closed on done + orchestrator approval |
| **Worker creates task** | Goes to `proposed` → needs user approval |
| **Artifact approval** | Always required (unless auto-approved) |
| **Worker-to-worker** | Group chat (15 min time-boxed), no infinite loops |
| **Execution isolation** | Git branch per task |
| **Rollback/undo** | Delete branch |
| **Error recovery** | Retry in branch or create new branch version |
| **Auto-approval** | Configurable per worker/task type |
| **Priority** | Planned for v2, design ready |

---

## Implementation Impact (Updated)

### Task-001: InternalAgent
No change - still needed as foundation.

### Task-002: TaskQueue
**Minor update:**
- Add branch reference to queued tasks
- Track task state transitions

### Task-003: Orchestrator Agent
**Major update:**
- Add worker-facing tools: `request_task`, `submit_artifact`, `request_merge`
- Add branch management tools: `create_branch`, `merge_branch`, `delete_branch`
- Tiered routing logic (instant vs approval)
- Worker task request handling
- Auto-approval checking

### Task-004: AgentManager Redesign
**Major update:**
- Single `handleMessage()` entry point
- Artifact approval methods
- Branch/merge operations
- Auto-approval configuration
- Group chat management

### Task-005: UI Integration
**Major update:**
- Proposal approval UI
- Artifact review/approve/reject UI
- Group chat UI (observe/participate)
- Auto-approval settings panel
- Branch status visualization

### New: Task-006: Git Branch Manager
**New task needed:**
- Create/delete/merge branches per task
- Handle merge conflicts
- Integrate with WorkspaceManager

---

## Implementation Summary

### Feature Overview

| Feature | Implementation |
|---------|----------------|
| **Tiered Routing** | Instant (questions/status/@mentions) vs Approval (tasks/artifacts/merges) |
| **Conversation Sessions** | Worker-owned, closed on done + Orchestrator approval |
| **Git Branching** | Each task gets a branch → rollback = delete branch |
| **Artifact Approval** | All outputs require approval before next worker gets them |
| **Group Chat** | 15-min time-boxed collaboration between workers + user |
| **Auto-Approval** | Configurable per worker/task type |
| **Error Recovery** | Retry in branch or create new version |
| **Priority** | Designed for v2, documented now |

### Task Dependency Graph

```
┌──────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION ORDER                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐                                         │
│  │ Task-001        │ ◀─── START HERE                         │
│  │ InternalAgent   │                                         │
│  └────────┬────────┘                                         │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                         │
│  │ Task-002        │                                         │
│  │ TaskQueue       │                                         │
│  └────────┬────────┘                                         │
│           │                                                   │
│     ┌─────┴─────┐                                            │
│     ▼           ▼                                            │
│  ┌─────────┐ ┌─────────┐                                     │
│  │Task-003 │ │Task-006 │  ◀─── Can be parallel               │
│  │Orchestr.│ │Git Brch │                                     │
│  └────┬────┘ └────┬────┘                                     │
│       │           │                                           │
│       └─────┬─────┘                                          │
│             ▼                                                 │
│  ┌─────────────────┐                                         │
│  │ Task-004        │                                         │
│  │ AgentManager    │                                         │
│  └────────┬────────┘                                         │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                         │
│  │ Task-005        │                                         │
│  │ UI Integration  │                                         │
│  └─────────────────┘                                         │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Task Summary Table

| ID | Task | Priority | Estimate | Key Deliverables |
|----|------|----------|----------|------------------|
| 001 | InternalAgent | 🔴 Critical | 2-3 days | LangGraph agent, tool calling, events |
| 002 | TaskQueue | 🟠 High | 1-2 days | Role-based queue, polling, events |
| 003 | Orchestrator Agent | 🟡 Medium-High | 2-3 days | All tools, tiered routing, group chat |
| 004 | AgentManager Redesign | 🟢 Medium | 1-2 days | Single entry, approvals, branch ops |
| 005 | UI Integration | 🔵 Normal | 2 days | Approval UI, status dashboard |
| 006 | Git Branch Manager | 🟠 High | 2-3 days | Branch per task, merge, rollback |

**Total Estimated Time:** 10-15 days

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Tiered routing** | Reduce friction for simple queries, approval for consequential actions |
| **Sessions in Workers** | Workers own conversation state, natural multi-turn flow |
| **Artifacts always approved** | Safe default - user controls what propagates to next task |
| **Worker task requests** | Workers request tasks for others, user approves (Group Chat post-MVP) |
| **Git branches for tasks** | Isolation + easy rollback (delete branch = undo) |
| **Auto-approval configurable** | Start safe, reduce friction as trust builds |
| **A2A-ready abstraction** | Build interface now, swap implementations later |

---

## Future: A2A Readiness

The current relay-based design (Orchestrator mediates all communication) works for MVP but doesn't scale to external agents or A2A protocols. We adopt a **hybrid architecture** with abstraction to enable future migration.

### Current vs Future Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   HYBRID ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│                    ┌─────────────────┐                       │
│                    │  IAgentComm     │  ◄── Abstraction      │
│                    │  (Interface)    │                       │
│                    └────────┬────────┘                       │
│                             │                                │
│            ┌────────────────┼────────────────┐               │
│            ▼                ▼                ▼               │
│    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│    │   Relay     │  │   Direct    │  │    A2A      │        │
│    │  (MVP)      │  │  (Stable)   │  │ (Incremental)│        │
│    └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                               │
│  MVP: Relay only (current design)                            │
│  Stable: Add Direct for internal high-trust agents           │
│  Incremental: Add A2A for external/cross-org agents          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Communication Abstraction (Build Now)

```typescript
// Define this interface NOW - costs nothing, enables future
interface IAgentComm {
  /**
   * Send message to another agent
   */
  send(to: AgentIdentity, message: AgentMessage): Promise<AgentResponse>;
  
  /**
   * Broadcast to multiple agents
   */
  broadcast(to: AgentIdentity[], message: AgentMessage): Promise<AgentResponse[]>;
  
  /**
   * Subscribe to messages from an agent
   */
  onMessage(handler: (from: AgentIdentity, msg: AgentMessage) => void): Unsubscribe;
  
  /**
   * Discover agent capabilities (A2A pattern)
   */
  getCapabilities(agent: AgentIdentity): Promise<Capability[]>;
}

// MVP: Relay implementation
class OrchestratorRelay implements IAgentComm {
  constructor(private orchestrator: Orchestrator) {}
  
  async send(to: AgentIdentity, message: AgentMessage): Promise<AgentResponse> {
    // All messages go through Orchestrator (current design)
    return this.orchestrator.relay(to, message);
  }
  
  async getCapabilities(agent: AgentIdentity): Promise<Capability[]> {
    // For internal agents, read from registry
    const config = this.registry.get(agent.id);
    return config.capabilities;
  }
}

// Future: Direct implementation (for internal trusted agents)
class DirectComm implements IAgentComm {
  async send(to: AgentIdentity, message: AgentMessage): Promise<AgentResponse> {
    // Bypass orchestrator for trusted internal agents
    const agent = this.registry.get(to.id);
    return agent.invoke(message);
  }
}

// Future: A2A implementation (for external agents)
class A2AComm implements IAgentComm {
  async send(to: AgentIdentity, message: AgentMessage): Promise<AgentResponse> {
    // A2A protocol - discover endpoint, negotiate, send
    const endpoint = await this.discover(to);
    return this.a2aClient.send(endpoint, message);
  }
  
  async getCapabilities(agent: AgentIdentity): Promise<Capability[]> {
    // A2A capability discovery
    return this.a2aClient.getCapabilities(agent.endpoint);
  }
}
```

### Agent Identity (A2A Compatible)

```typescript
// Use A2A-compatible identity structure now
interface AgentIdentity {
  id: string;              // Unique identifier
  role: string;            // e.g., "writer"
  name: string;            // Display name
  capabilities: string[];  // What can it do?
  protocol: 'internal' | 'direct' | 'a2a';  // How to communicate
  endpoint?: string;       // For A2A: external URL
  teamId: string;          // Team scope
}
```

### Message Format (A2A Compatible)

```typescript
// Use A2A-compatible message structure now
interface AgentMessage {
  id: string;
  from: AgentIdentity;
  to: AgentIdentity;
  type: 'request' | 'response' | 'stream' | 'error';
  content: {
    action: string;       // What to do
    payload: any;         // Action-specific data
  };
  metadata: {
    threadId: string;     // Conversation thread
    timestamp: Date;
    correlationId?: string;  // For request-response matching
    ttl?: number;         // Time-to-live in ms
  };
}
```

### Migration Path

| Phase | Communication Mode | Agents | Control |
|-------|-------------------|--------|---------|
| **MVP** | Relay only | Internal only | Full (Orchestrator sees all) |
| **Stable** | Relay + Direct | Internal (trusted can go direct) | Configurable per agent |
| **Incremental** | Relay + Direct + A2A | Internal + External | Policy-based |

### Configuration

```typescript
interface CommConfig {
  // Default mode for all agents
  defaultMode: 'relay' | 'direct' | 'a2a';
  
  // Per-agent overrides
  agents: {
    [agentId: string]: {
      mode: 'relay' | 'direct' | 'a2a';
      endpoint?: string;  // For A2A
      trustLevel: 'low' | 'medium' | 'high';
    };
  };
  
  // Policy: when to require relay (approval)
  requireRelayFor: {
    externalAgents: boolean;      // Always relay external
    crossTeamComm: boolean;       // Relay cross-team messages
    costlyActions: boolean;       // Relay actions with cost
  };
}

// MVP config (safe default)
const mvpConfig: CommConfig = {
  defaultMode: 'relay',
  agents: {},
  requireRelayFor: {
    externalAgents: true,
    crossTeamComm: true,
    costlyActions: true,
  },
};

// Future config (more autonomy)
const futureConfig: CommConfig = {
  defaultMode: 'direct',
  agents: {
    'external-agent-1': { mode: 'a2a', endpoint: 'https://...', trustLevel: 'low' },
  },
  requireRelayFor: {
    externalAgents: true,   // Still relay external
    crossTeamComm: true,    // Still relay cross-team
    costlyActions: false,   // Direct for trusted agents
  },
};
```

### What to Build Now (MVP)

1. **Define `IAgentComm` interface** - abstraction layer
2. **Define `AgentIdentity`** with protocol field
3. **Define `AgentMessage`** with A2A-compatible structure
4. **Implement `OrchestratorRelay`** - current relay pattern
5. **Workers use interface, not implementation**

### What to Build Later

| Phase | Add |
|-------|-----|
| **Stable** | `DirectComm` for trusted internal agents |
| **Incremental** | `A2AComm` for external agents |
| **Incremental** | Agent discovery service |
| **Incremental** | Capability negotiation |

### Benefits of This Approach

| Benefit | Description |
|---------|-------------|
| **No refactor** | Same worker code works with relay, direct, or A2A |
| **Gradual migration** | Enable direct/A2A per-agent, not all-or-nothing |
| **Control preserved** | Relay still available for sensitive operations |
| **External ready** | A2A adapter slots in without architecture change |

---

## Related Documents

- [Architecture](architecture.md) - Overall system architecture
- [Agent](agent.md) - Unified agent system
- [Group Chat Architecture](group-chat-architecture.md) - Detailed design for worker collaboration
- [Orchestrator Module](../developer-guide/modules/orchestrator.md) - Implementation details
