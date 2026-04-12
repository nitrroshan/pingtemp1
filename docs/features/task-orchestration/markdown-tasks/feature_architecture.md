# Markdown-Based Tasks & Agent-Initiated Collaboration — Architecture

**Status:** Draft  
**Date:** April 11, 2026  
**Parent:** [Task Orchestration Architecture](../feature_architecture.md)  
**Related:** [Agent ↔ Collab Docs](../../agent-collab-docs/feature_architecture.md), [Team Registry](../../team-registry/feature_architecture.md)

---

## Problem

Three problems converge:

1. **Tasks are opaque JSON** — stored in `Map<string, Task>`, invisible to agents, humans, and tools. No agent can browse past tasks, learn from them, or reference them as context. JSON is a runtime format, not a knowledge format.

2. **Only the Planner can create tasks** — worker agents can't ask each other for help, request reviews, or spawn subtasks. They're trapped in their single-task sandbox. If a researcher discovers the architect's API spec is wrong, it can't create a "fix this" task — it just puts it in `output`.

3. **Collaboration has no structure** — the GroupChatManager is a stub. Agents can't say "I need to discuss X with agent Y using document Z." There's no protocol for initiating collaboration, sharing working documents, or tracking discussion outcomes within the task DAG.

---

## Design: Task.md + Plan.md Files

### Why Markdown Over JSON

| | JSON (current) | Markdown + Frontmatter |
|---|---|---|
| **Human readability** | Need tooling to inspect | Open in any editor, read in PR reviews |
| **Agent readability** | Must deserialize, parse fields | Natural language body — agents treat it as context |
| **Git-friendly** | Diffs are noisy, merge conflicts common | Clean diffs, mergeable, tells a story |
| **Extensible context** | `context: Record<string, any>` — unstructured blob | Body is freeform markdown — acceptance criteria, examples, diagrams |
| **Discoverable** | Only via `getTask(id)` API | `workspace_list_files(".ping/tasks/")` — agents browse freely |
| **Matchable to skills** | Skill.md exists but tasks are JSON — format mismatch | Same format → same parser (`gray-matter`), same loader pattern |
| **Post-mortem value** | Throw-away runtime state | Persistent artifacts — "what did we do and why" |

**JSON still has value for:** runtime state machine (status transitions, prerequisite tracking, queue position). The answer isn't "drop JSON" — it's **Markdown as the source of truth, JSON as the runtime projection**.

```
Task.md (persisted, human/agent-readable)
    │
    │  Frontmatter Parser (gray-matter)
    │
    ▼
Task object (runtime, in TaskStore Map)
    │
    │  On status change
    │
    ▼
Task.md frontmatter updated (status field)
```

### Task.md Format

```yaml
---
id: task-003
title: "Design REST API endpoints"
assignedRole: architect
status: pending          # pending | ready | in_progress | completed | failed
priority: 2              # 1-5 (1=highest)
complexity: medium       # low | medium | high
type: work               # work | review | collaboration | subtask
dependencies:
  - task-001             # blocks: can't start until these complete
  - task-002
softDependencies:        # informs: can start without, output injected if available
  - task-006
createdBy: planner       # planner | agent:{role} | user
parentTask: null         # for subtasks
planId: plan-001
expectedOutput: "API specification document with endpoint definitions"
onDependencyFail: replan # fail | skip | replan
artifacts: []            # paths to output files
---

# Design REST API endpoints

## Context
The product requires a REST API for the B2B SaaS platform. Market research (task-001)
identified 12 competitors. Competitive analysis (task-002) found a gap in self-serve
onboarding.

## Acceptance Criteria
- [ ] All CRUD endpoints defined
- [ ] Authentication flow documented
- [ ] Rate limiting strategy included
- [ ] OpenAPI spec generated

## Notes
Consider the gap in self-serve onboarding found by the researcher ---
this should influence the API's provisioning endpoints.
```

### Goal.md Format

The Goal is the team-level objective --- what the user asked the team to do. It's a first-class `.md` file so every agent in the team can read it for context. The Planner creates it when the user submits a goal, and all agents reference it as their north star.

```yaml
---
id: goal-001
title: "Build a marketing campaign for product X"
teamId: marketing-team
status: planning         # pending | planning | executing | completed | failed
submittedBy: user        # user | system
planId: plan-001         # linked plan (set after planning)
createdAt: 2026-04-11T09:30:00Z
completedAt: null
---

# Build a marketing campaign for product X

## User Intent
Build a comprehensive marketing campaign for product X targeting B2B SaaS mid-market.
Focus on content marketing and SEO. Budget is limited --- prioritize organic channels.

## Success Criteria
- Campaign plan with timeline and channel strategy
- 5 blog post drafts targeting identified keywords
- Landing page copy with A/B test variants
- Social media content calendar for 4 weeks

## Constraints
- No paid advertising in phase 1
- Must align with existing brand guidelines
- Launch within 2 weeks
```

**Why Goal.md matters:**
- Every agent reads `.ping/goals/goal-001.md` as context before starting any task
- Agents can check whether their work aligns with the original intent
- Post-mortem: the goal + its linked plan + tasks tell the complete story
- Multiple goals can be active simultaneously (each gets its own plan)

**Relationship:** Goal.md (what) -> Plan.md (how) -> Task.md files (who does what)

### Plan.md Format

```yaml
---
planId: plan-001
goalId: goal-001         # links back to the Goal.md
goal: "Build a marketing campaign for product X"
teamId: marketing-team
status: executing        # pending | approved | executing | completed | failed
version: 1
parentPlanId: null       # for replan chains
createdAt: 2026-04-11T10:00:00Z
taskCount: 5
---

# Marketing Campaign Plan

## Goal
Build a comprehensive marketing campaign for product X targeting B2B SaaS mid-market.

## Task Graph
```mermaid
graph TD
    T1[task-001: Market Research] --> T3[task-003: Product Positioning]
    T2[task-002: Competitive Analysis] --> T3
    T3 --> T4[task-004: Content Creation]
    T3 --> T5[task-005: Visual Design]
```

## Tasks
1. **task-001** — Market Research (researcher, P2)
2. **task-002** — Competitive Analysis (researcher, P2)  
3. **task-003** — Product Positioning (strategist, P1) — depends on 001, 002
4. **task-004** — Content Creation (writer, P3) — depends on 003
5. **task-005** — Visual Design (designer, P3) — depends on 003

## Strategy Notes
Parallel research phase (001 + 002), then sequential positioning → execution.
Critical path: 001/002 → 003 → 004.
```

### File Layout

```
.ping/
├── goals/
│   ├── goal-001.md              # Active goal (user's top-level request)
│   └── _archive/
│       └── goal-000.md          # Completed/failed goals
├── plans/
│   ├── plan-001.md              # Active plan
│   └── _archive/
│       └── plan-000.md          # Previous plans (never deleted)
├── tasks/
│   ├── task-001.md
│   ├── task-002.md
│   ├── task-003.md
│   ├── task-004.md              # Planner-created tasks
│   ├── task-005.md
│   ├── task-006-subtask.md      # Agent-created subtask
│   └── task-007-collab.md       # Agent-created collaboration task
├── collab/                          # CRDT docs (via Hocuspocus)
│   │   # Runtime: Y.Doc per collab task, stored in data/collab/yjs/
│   │   # Projected to .ping/collaboration/ as readable files:
│   ├── collab-task-007.json         # Y.Map + Y.Array → JSON projection
│   ├── doc-api-spec-collab-007.md   # Y.XmlFragment → markdown projection
│   └── doc-code-review-collab-008.md
└── outputs/
    ├── task-001.json             # Output manifests (existing)
    └── task-002.json
```

---

## Task Lifecycle — End-to-End Event Flow

### Overview Diagram

```mermaid
sequenceDiagram
    actor User
    participant Socket as SocketServerV2
    participant Orch as OrchestratorService
    participant Planner as PlannerAgent
    participant TS as TaskStore (in-mem)
    participant CRDT as CrdtTaskSync
    participant Hocus as Hocuspocus
    participant DAG as DependencyResolver
    participant WP as WorkerPool
    participant Agent as Worker Agent

    User->>Socket: "Build a marketing campaign"
    Socket->>Orch: handleMessage(goal)
    
    Note over Orch,CRDT: 1. GOAL CREATION
    Orch->>CRDT: saveGoal(goalId, title, body)
    CRDT->>Hocus: openDoc("{teamId}/{goalId}/goal") → Y.Map.set(...)
    Hocus-->>Hocus: auto-persist to .bin + project to .md
    
    Orch->>Planner: inject goal as context
    
    Note over Planner,TS: 2. PLANNING
    Planner->>Planner: decompose goal into tasks
    Planner->>Orch: submit_plan({ tasks: [T1, T2, T3] })
    
    Note over Orch,Hocus: 3. PLAN APPROVAL
    Orch->>Socket: onPlanProposed → show in UI
    User->>Socket: approve plan
    Socket->>Orch: approvePlan()
    
    Note over Orch,Hocus: 4. TASK CREATION (per task)
    loop For each task in plan
        Orch->>TS: taskStore.create(task)
        Orch->>CRDT: persistTask(task)
        CRDT->>Hocus: openDoc("{teamId}/{goalId}/{taskId}/task") → Y.Map.set(...)
    end
    Orch->>CRDT: persistPlan(storedPlan)
    CRDT->>Hocus: openDoc("{teamId}/{goalId}/plan") → Y.Map.set(...)
    Orch->>DAG: rebuild(taskStore)
    
    Note over TS,Agent: 5. DISPATCH (zero-dep tasks)
    TS-->>Orch: onTaskReady(T1, researcher)
    Orch->>CRDT: syncStatus(T1, "in_progress")
    Orch->>WP: runTask(T1, researcher, message)
    WP->>Agent: create AiSdkAgent + inject tools
    
    Note over Agent,CRDT: 6. EXECUTION
    Agent->>Agent: execute task (streamText loop)
    Agent-->>Socket: stream_part events → UI
    Agent->>WP: complete_task(output)
    
    Note over WP,DAG: 7. COMPLETION CASCADE
    WP->>Orch: onWorkerDone(T1, output)
    Orch->>TS: completeTask(T1, output)
    Orch->>CRDT: syncStatus(T1, "completed", output)
    CRDT->>Hocus: Y.Map.set("status", "completed")
    Hocus-->>Hocus: auto-persist + project task.md
    TS-->>Orch: onTaskReady(T3, strategist)
    Note right of Orch: T3 was waiting for T1 + T2.<br/>T2 already done → T3 ready
    Orch->>WP: runTask(T3, strategist, message)
```

### Task State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: taskStore.create()
    pending --> ready: all prerequisites met
    ready --> in_progress: dispatched to worker
    in_progress --> completed: worker calls complete_task
    in_progress --> failed: error or timeout
    failed --> ready: retry (planner decision)
    completed --> [*]
    failed --> [*]: abort

    note right of pending: CRDT: status="pending"
    note right of in_progress: CRDT: status="in_progress"
    note right of completed: CRDT: status="completed",<br/>output stored, completedAt set
```

### Where Data Lives (CRDT vs Runtime)

| What | Runtime (in-memory) | CRDT (Hocuspocus) | Projected (auto) |
|------|--------------------|--------------------|-------------------|
| **Goal** | — | `{teamId}/{goalId}/goal` Y.Map | `.ping/collaboration/goal.md` |
| **Plan** | — | `{teamId}/{goalId}/plan` Y.Map | `.ping/collaboration/plan.md` |
| **Task data** | TaskStore `Map<string, Task>` | `{teamId}/{goalId}/{taskId}/task` Y.Map | `.ping/collaboration/{taskId}/task.md` |
| **Task status** | TaskStore (single writer) | Synced from TaskStore → CRDT | Updated in projected `.md` |
| **Task output** | TaskStore `.output` field | Synced to CRDT on completion | `.ping/outputs/{taskId}.json` |
| **Prerequisites** | TaskStore `Map<string, boolean>` | Not in CRDT (derived from `dependencies[]`) | — |
| **DAG** | DependencyResolver (rebuilt) | Not in CRDT (rebuilt from task docs) | — |
| **Task index** | TaskStore (primary) | `{teamId}/{goalId}/_index` Y.Map (for agent browsing) | `.ping/collaboration/_index.json` |

### How Tasks Are Dispatched

```mermaid
flowchart TD
    A[TaskStore.create] --> B{prerequisites.size === 0?}
    B -->|Yes| C[status = ready]
    B -->|No| D[status = pending]
    C --> E[RoleTaskQueue.enqueue]
    E --> F{concurrency limit?}
    F -->|Under limit| G[OrchestratorService.dispatchTask]
    F -->|At limit| H[deferredDispatches queue]
    G --> I[Inject context.crdtRefs]
    I --> J[WorkerPool.runTask]
    J --> K[AiSdkAgent.execute]
    K --> L{Agent completes?}
    L -->|complete_task| M[TaskStore.completeTask]
    M --> N[CrdtTaskSync.syncStatus]
    N --> O[Update dependants]
    O --> P{Dependant ready?}
    P -->|Yes| C
    P -->|No| Q[Wait for other deps]
    L -->|Error| R[TaskStore.failTask]
    R --> S[CrdtTaskSync.syncStatus failed]
    
    H -.->|slot opens| G

    style C fill:#4CAF50,color:white
    style D fill:#9E9E9E,color:white
    style M fill:#4CAF50,color:white
    style R fill:#f44336,color:white
```

### Agent-Created Tasks — Event Flow

```mermaid
sequenceDiagram
    participant ArchAgent as Architect Agent
    participant RT as request_task tool
    participant CRDT as CrdtTaskSync
    participant TS as TaskStore
    participant DAG as DependencyResolver
    participant Orch as OrchestratorService
    participant FEAgent as Frontend-Dev Agent

    Note over ArchAgent: Working on task-003,<br/>discovers spec gap

    ArchAgent->>RT: request_task({ title, targetRole: "frontend-dev",<br/>relationship: "blocks-me" })
    
    Note over RT: Guard rails check:<br/>count < 5, no self-assign,<br/>priority ≤ 2
    
    RT->>TS: taskStore.create(newTask)
    RT->>CRDT: persistTask(newTask) → {teamId}/{goalId}/task-006/task
    RT->>DAG: add task-006 as prerequisite of task-003
    RT->>TS: task-003.prerequisites.set("task-006", false)
    
    Note over TS: task-003 now BLOCKED<br/>(waiting for task-006)
    
    TS-->>Orch: onTaskReady(task-006, frontend-dev)
    Orch->>FEAgent: dispatch task-006 with context:<br/>crdtRefs.relatedTasks = ["task-003/task"]
    
    FEAgent->>FEAgent: execute task-006
    FEAgent-->>Orch: complete_task(output)
    
    Orch->>TS: completeTask(task-006, output)
    Orch->>CRDT: syncStatus(task-006, "completed")
    TS-->>TS: task-003.prerequisites["task-006"] = true
    
    Note over TS: task-003 all prereqs met → ready
    
    TS-->>Orch: onTaskReady(task-003, architect)
    Note over Orch: Architect resumes task-003<br/>with task-006 output as context
```

### How Agents Access Task Context

When a task is dispatched, the agent receives CRDT references in its prompt:

```typescript
// Injected into task.context by OrchestratorService.dispatchTask()
interface TaskDispatchContext {
  crdtRefs: {
    task: string;              // "task-003/task" — own task doc
    plan: string;              // "plan" — plan doc at goal level
    goal: string;              // "goal" — goal doc at goal level
    dependencies: string[];    // ["task-001/task", "task-002/task"]
    dependants: string[];      // ["task-004/task"]
    relatedTasks: string[];    // agent-created refs, cross-plan refs
  };

  // Existing context (unchanged)
  previousOutputs: Array<{ taskId: string; output: any }>;
  artifacts: string[];
  notes: string[];
  expectedOutput: string;
}
```

The agent's prompt includes:

```markdown
## Your Task
task-003: Design REST API endpoints

## Context Sources (use `collab read` to access full details)
- **Your task:** `collab read task-003/task`
- **Plan:** `collab read plan`
- **Goal:** `collab read goal`
- **Completed dependencies:** task-001/task, task-002/task
- **Downstream (depends on you):** task-004/task

## Context from previous tasks:
- task-001 (researcher): "Found 12 competitors, 3 direct threats..."
- task-002 (researcher): "Top 3 competitors analyzed..."

## Expected output: API specification document with endpoint definitions
```

---

## Pre-Plan Tasks — Planner Research Phase

### The Problem

The planner often receives a goal it can't decompose without more information:

```
User: "Build a payment system for our SaaS"

Planner thinks:
  - What's the current tech stack? (need to ask someone)
  - What compliance requirements apply? (PCI-DSS? SOC2?)
  - What payment providers are already integrated?
  
Currently: Planner either guesses (bad plans) or asks the user (blocks on human response).
```

### The Solution: Pre-Plan Research Tasks

The planner can create tasks **before** creating a plan. These are `type: "research"` tasks that block plan creation — the planner can't submit a plan until all pre-plan tasks complete or are cancelled.

```typescript
// Planner calls submit_research (new tool) INSTEAD of submit_plan
submit_research({
  tasks: [
    {
      id: "pre-001",
      title: "Investigate current tech stack",
      description: "List all backend frameworks, databases, and APIs currently in use",
      assignedRole: "researcher",
      expectedOutput: "Tech stack inventory document",
    },
    {
      id: "pre-002", 
      title: "Identify payment compliance requirements",
      description: "What PCI-DSS and SOC2 requirements apply to our payment processing?",
      assignedRole: "security-reviewer",
      expectedOutput: "Compliance requirements summary",
    },
  ],
  reason: "Need tech stack and compliance context before planning payment system",
})
```

### Lifecycle

```
User sends goal
    │
    ▼
Planner receives goal → decides it needs research first
    │
    ├── Calls submit_research() with 1-N research tasks
    ├── Planner state: "researching" (new state)
    │
    ▼
Research tasks dispatch via normal pipeline:
    │
    ├── Task.md files written to .ping/tasks/pre-001.md, pre-002.md
    ├── createdBy: planner, type: research, planId: null
    ├── Workers execute, stream results
    │
    ▼
Meanwhile, planner is NOT blocked from user interaction:
    │
    ├── ✅ Can chat with user ("I'm researching your tech stack first...")
    ├── ✅ Can answer questions about the goal
    ├── ❌ Cannot call submit_plan (blocked until research completes)
    ├── ❌ Cannot create work tasks (no plan exists yet)
    │
    ▼
Research tasks complete:
    │
    ├── Outputs flow into planner context (via onTaskComplete callback)
    ├── Planner state: "researching" → "planning"
    ├── Planner now has context → creates informed plan
    │
    ▼
Plan submitted with full context ("Based on research: stack is Node.js + Postgres,
PCI-DSS Level 1 applies, Stripe is already integrated...")
```

### State Machine Extension

```
OrchestratorService states:

  idle → researching → planning → executing → completed
           │                                      │
           │   (user cancels research tasks)       │
           └──────────→ planning ←────────────────┘
                           │                 (replan)
                           │
                           ▼
                       executing
```

The `researching` state is new. In this state:
- Research tasks are dispatched normally via TaskStore
- Planner's `submit_plan` tool returns an error: "Cannot submit plan while research tasks are pending"
- Planner can still process user messages (chat, answer questions, clarify goals)
- User can cancel individual research tasks → if all cancelled/completed, state transitions to `planning`

### User Control

User can intervene during the research phase:

```
┌─────────────────────────────────────────────┐
│  🔬 Researching before planning             │
│                                              │
│  ⏳ pre-001: Investigate tech stack          │
│     researcher · in progress                 │
│     [Cancel]                                 │
│                                              │
│  ✅ pre-002: Payment compliance              │
│     security-reviewer · completed            │
│     → PCI-DSS Level 1, SOC2 Type II needed  │
│                                              │
│  [Skip Research → Plan Now]  [Add Research]  │
└─────────────────────────────────────────────┘
```

- **Cancel** a research task → removed from requirements
- **"Skip Research → Plan Now"** → cancels all pending research, transitions to planning with whatever context is available
- **"Add Research"** → user can add more research tasks (typed in chat)

### Task.md for Research Tasks

```yaml
---
id: pre-001
title: "Investigate current tech stack"
assignedRole: researcher
status: in_progress
priority: 1              # research tasks are high priority — they block planning
type: research           # new type
createdBy: planner
planId: null             # no plan yet — this IS the pre-plan phase
expectedOutput: "Tech stack inventory document"
phase: pre-plan          # distinguishes from plan tasks
---

# Investigate current tech stack

## Context
User wants to build a payment system. Before planning, we need to understand
the existing infrastructure.

## What to investigate
- Backend frameworks and languages
- Database systems
- Existing API integrations
- Authentication/authorization systems
- Current deployment infrastructure
```

---

## Agent-Created Tasks

### The Problem

Currently only the Planner creates tasks via `submit_plan` / `add_tasks`. Worker agents are isolated — they can only:
- Complete their task and put notes in `output.nextSteps`
- Hope the Planner reads those notes and acts

This is like an employee who can only write memos to their boss and hope the boss forwards them. In real teams, people create tickets for each other directly.

### The Mechanism: `request_task` Tool

Give worker agents a `request_task` tool that creates a Task.md file and registers it in the runtime DAG.

```typescript
// New tool available to all worker agents
request_task({
  title: "Fix API auth endpoint — missing OAuth2 PKCE flow",
  description: "The auth endpoint only supports basic OAuth2. Needs PKCE for SPAs.",
  targetRole: "architect",         // who should do it
  type: "work",                    // work | review | collaboration
  priority: 2,
  context: {
    reason: "Discovered during implementation — the spec is incomplete",
    files: [".ping/tasks/task-003.md"],   // reference current task
    artifacts: ["src/api/auth.ts"],       // relevant files
  },
  relationship: "independent",    // independent | subtask | blocks-me
})
```

### Relationship Types

| Relationship | Meaning | DAG effect |
|---|---|---|
| `independent` | "Someone should do this, it doesn't block me" | New task, no dependency edge |
| `subtask` | "I need this done as part of my work" | New task with `parentTask: {my-task-id}` |
| `blocks-me` | "I can't continue until this is done" | New task, my task gets a new prerequisite |

### What happens to the plan?

**Agent-created tasks DO NOT modify the Plan.md.** The plan is the Planner's artifact — it represents the original decomposition. Agent-created tasks are an addendum.

However, the Planner is **notified** via its tooling:
- `get_status` tool reflects agent-created tasks (they appear with `createdBy: agent:{role}`)
- Planner can choose to incorporate them into a replan, or leave them as ad-hoc

```
Original Plan:           Agent additions:
  task-001 ──→ task-003    task-001 ──→ task-003
  task-002 ──→ task-003    task-002 ──→ task-003
                           task-003 .....→ task-006 (subtask created by architect)
                           task-003 .....→ task-007 (collab request by architect)
```

Dotted lines = agent-created edges. They integrate into the DAG but don't rewrite the plan.

### Guard Rails

- **No infinite loops**: `maxAgentCreatedTasks` per agent per plan (default: 5)
- **No self-assignment**: Agents can't assign tasks to their own role (prevents infinite subtask chains)
- **Priority ceiling**: Agent-created tasks can't exceed priority 2 (priorities 1 are reserved, see below)
- **Planner veto**: Planner can cancel agent-created tasks via `cancel_task`
- **Audit trail**: `createdBy: agent:{role}` in Task.md — always traceable

---

## Reserved Priorities & Collaboration Tasks

### Priority System

| Priority | Name | Who Creates | Purpose |
|---|---|---|---|
| **0** | `SYSTEM` | Runtime only | Internal bookkeeping — plan approval, health checks |
| **1** | `CRITICAL` | Planner only | Blocking the entire goal — must execute next |
| **2** | `HIGH` | Planner or Agent | Important work, user-facing deliverables |
| **3** | `NORMAL` | Anyone | Default for most tasks |
| **4** | `LOW` | Anyone | Nice-to-have, non-blocking improvements |
| **5** | `DEFERRED` | Anyone | Backlog — won't execute unless explicitly promoted |

### Reserved Task Types for Collaboration

Beyond `work` tasks, we introduce structured collaboration task types:

| Type | Purpose | Created by |
|---|---|---|
| `work` | Standard task — produce output | Planner / Agent |
| `review` | Review another agent's output | Planner / Agent |
| `collaboration` | Multi-agent discussion + shared doc editing | Agent (primary) |
| `subtask` | Child of another task | Agent |
| `decision` | Needs a decision from planner/user before proceeding | Agent |

### Collaboration Task — The Full Protocol

When Agent A needs to collaborate with Agent B (and optionally Agent C or the Planner):

#### Step 1: Agent A Creates a Collaboration Task

```typescript
request_task({
  title: "Align API spec with frontend requirements",
  type: "collaboration",
  targetRole: "frontend-dev",       // primary collaborator
  priority: 2,
  collaboration: {
    initiator: "architect",          // self
    participants: ["frontend-dev"],  // can include multiple roles
    includePlanner: false,           // true if planner should join
    includeUser: false,              // true if human should participate
    documents: {
      shared: ["api-spec.md"],       // docs both can read/write
      readOnly: ["requirements.md"], // docs participants can read only
    },
    discussionTopic: "The auth endpoints need PKCE — does the frontend SDK support it?",
    expectedOutcome: "Agreed auth flow with updated API spec",
    // Guard rails:
    maxRounds: 10,                   // max discussion blocks per agent (default: 10)
    maxTokens: 50000,                // total token budget across all participants (default: 50k)
    timeoutMinutes: 15,              // auto-escalate if no resolution (default: 15)
    mode: "auto",                    // auto | manual — auto = agents respond immediately
  },
  relationship: "blocks-me",        // architect can't continue until resolved
})
```

---

### Discussion Guard Rails

Without limits, two agents can discuss forever — burning tokens and blocking dependent tasks. Every discussion has hard caps:

| Guard | Default | What happens when hit |
|---|---|---|
| **maxRounds** | 10 per agent | Agent can't post more blocks. If no decision, escalate to planner. |
| **maxTokens** | 50,000 total | Token meter across all participants. At 80% → warn agents ("wrap up"). At 100% → force-close, escalate. |
| **timeoutMinutes** | 15 | No new blocks for N minutes → Decision Escalation triggers (planner → user). |
| **maxParticipants** | 5 | Prevents runaway multi-agent discussions. |

**Token tracking:** Each DiscussionBlock records `tokens: number` (estimated from content length). The `discuss` action sums all blocks' tokens and rejects new posts past the limit.

```typescript
interface DiscussionBlock {
  id: string;
  role: string;
  timestamp: string;
  content: string;
  mentions: string[];
  replyTo?: string;
  type: "message" | "decision" | "question";
  tokens: number;           // estimated token count of this block
}

// Guard rail state stored in Y.Map("config") on the collab doc:
{
  maxRounds: 10,
  maxTokens: 50000,
  timeoutMinutes: 15,
  totalTokensUsed: 12450,   // running sum
  roundsPerAgent: {
    "architect": 3,
    "frontend-dev": 2
  },
  mode: "auto",
  status: "active" | "wrapping-up" | "closed" | "escalated"
}
```

**Auto mode (default for discussions):** When `mode: "auto"`, agents respond to new blocks immediately — no waiting for planner or user to trigger turns. This is the natural mode for agent-to-agent collaboration. Manual mode is for when a human wants to control the pace.

---

### User Participation in Discussions

Humans can participate in any discussion — agent-to-agent, task-level, or plan-level.

**"User" is not one person.** Each agent role has a corresponding human stakeholder — the backend developer who oversees the backend agent, the designer who oversees the design agent. When an agent says `includeUser: true`, it means "invite my human counterpart."

#### User Identity in Discussions

The system currently has `User` (userId, lastActive) but no role-to-user mapping. For discussions, we introduce a lightweight identity:

```typescript
interface DiscussionUser {
  userId: string;         // from auth system
  displayName: string;    // "Roshan" / "Sarah"
  agentRole?: string;     // which agent role this user is associated with (optional)
                          // e.g., "backend-dev" — this user oversees the backend agent
}
```

When a user posts in a discussion, their block includes both identity and role context:

```typescript
{
  id: "block-5",
  role: "user:backend-dev",       // "user:{agentRole}" — identifies which human
  userId: "usr_abc123",           // auth identity
  displayName: "Roshan",
  timestamp: "2026-04-11T11:00:00Z",
  content: "Use JWT with short-lived tokens. Session cookies add CSRF complexity.",
  mentions: ["architect"],
  type: "decision",
  tokens: 42,
}
```

The `role: "user:{agentRole}"` convention means:
- `"user:backend-dev"` — the human who owns the backend agent
- `"user:designer"` — the human who owns the design agent
- `"user"` (no suffix) — a general observer without a specific agent role

Agents parse the role prefix to understand who's talking: an agent peer, their own human, or someone else's human.

#### How Users Join

1. **Explicitly invited:** `includeUser: true` in the collaboration task config — notifies the human(s) associated with participant roles
2. **Self-join:** Any team member clicks "Join Discussion" in the DiscussionThread UI — they choose which role context they're joining as (or "observer")
3. **@mentioned:** Agent tags `mentions: ["user:backend-dev"]` → notification targets that specific user

#### How Users See Discussions — Frontend UX

When a user has active discussions, they see them in three places:

**1. Notification badge (top-level)**
```
┌─────────────────────────────────────────────┐
│  🔔 2 discussions need your input           │
│  • collab/task-007: "API auth flow" (2 new) │
│  • task/task-003: "@you — review needed"    │
└─────────────────────────────────────────────┘
```
Driven by Socket.IO `discussion:mention` events. Badge count = unread blocks where user is mentioned or invited.

**2. DetailPanel → Discussions tab**
```
┌─────────────────────────────────────────────┐
│  Events │ Agents │ Tasks │ Discussions │ ⚙   │
│  ───────────────────────────────────────────│
│  📌 Active                                  │
│  ┌─────────────────────────────────────┐    │
│  │ 🔴 API Auth Flow (collab/task-007)  │    │
│  │    architect ↔ frontend-dev         │    │
│  │    3 blocks · awaiting your input   │    │
│  │    [Open Thread]                    │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ 🟡 DB Schema Review (task/task-003) │    │
│  │    backend-dev · 2 new blocks       │    │
│  │    [Open Thread]                    │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ✅ Resolved (3)                            │
│  └── ...                                    │
└─────────────────────────────────────────────┘
```

**3. Inline DiscussionThread (expanded view)**
```
┌─────────────────────────────────────────────┐
│  API Auth Flow · collab/task-007             │
│  architect ↔ frontend-dev · You: backend-dev │
│  ─────────────────────────────────────────── │
│                                              │
│  🤖 architect · 10:30 AM                    │
│  We need PKCE (RFC 7636) for SPAs.          │
│  Questions:                                  │
│  1. Does the SDK handle code_verifier?       │
│  2. What redirect URI scheme?                │
│                                              │
│  🤖 frontend-dev · 10:31 AM                 │
│  SDK uses @auth0/auth0-spa-js — PKCE native.│
│  Redirect: window.location.origin + /callback│
│                                              │
│  👤 Roshan (backend-dev) · 11:00 AM         │
│  Use JWT with short-lived tokens.            │
│  Session cookies add CSRF complexity.        │
│  ✅ DECISION                                │
│                                              │
│  ─────────────────────────────────────────── │
│  [Message ▾] [@mention ▾] [Type: message ▾] │
│  ┌──────────────────────────────────┐ [Send] │
│  │ Type your response...            │        │
│  └──────────────────────────────────┘        │
│                                              │
│  ⚡ Auto mode · 3/10 rounds · 12k/50k tokens│
└─────────────────────────────────────────────┘
```

Key UI elements:
- **Agent blocks** show 🤖 + role name
- **Human blocks** show 👤 + display name + (role context)
- **Decision blocks** get a ✅ badge
- **Status bar** at bottom shows mode, round count, token usage
- **Composer** has @mention autocomplete (agent roles + team users), type selector (message/question/decision)

#### How Users Post

The `DiscussionComposer` component pushes directly to `Y.Array("discussion")` via HocuspocusProvider:

```typescript
// Frontend — user types in DiscussionComposer, clicks send
const discussion = provider.document.getArray("discussion");
discussion.push([{
  id: crypto.randomUUID(),
  role: `user:${currentUserAgentRole}`,  // "user:backend-dev"
  userId: currentUser.id,
  displayName: currentUser.name,
  timestamp: new Date().toISOString(),
  content: userInput,
  mentions: parseMentions(userInput),  // extract @role from text
  type: selectedType,              // message | decision | question
  tokens: estimateTokens(userInput),
}]);
```

Agents see user blocks just like any other block — via the cursor protocol. The `role: "user:*"` prefix lets them distinguish human input from agent input and identify which human.

#### User Decisions Override

If a user posts a block with `type: "decision"`, it auto-records to `Y.Map("decisions")` and can override quorum requirements — a human decision is final unless the planner explicitly overrides.

#### User as Tiebreaker

Decision Escalation (guard rail #3) has a two-step flow:
1. No response for N minutes → notify Planner
2. Planner doesn't resolve → notify User(s) associated with participant roles
3. User posts a decision block → discussion closes

**Any user participation resets/stops the timeout timer.** When a human posts a block (any type — message, question, or decision), the `timeoutMinutes` timer resets to zero. The discussion is no longer "stalled" — a human is actively engaged. The timer only runs when no one (agent or human) has posted for N minutes.

```typescript
// In discuss action — on new block pushed:
const config = doc.getMap("config");
config.set("lastActivity", new Date().toISOString());  // resets timeout timer

// If the poster is a user, also pause auto-escalation:
if (block.role.startsWith("user:")) {
  config.set("escalationPaused", true);  // user is here, don't escalate
}

// Escalation resumes only when user leaves (no user blocks for 2× timeout)
```

This keeps humans as the last resort, not the bottleneck. Once a human joins, the system trusts them to drive the discussion.

#### Step 2: System Creates CRDT Collaboration Space

When a `collaboration` task is dispatched, the system opens CRDT documents under `{taskId}/` via the existing `CollaborationSpace`:

1. Opens discussion doc `{taskId}/discussion` → initializes `Y.Array("discussion")`
2. Opens decisions doc `{taskId}/decisions` → initializes `Y.Map("decisions")`
3. Opens config doc → initializes `Y.Map("config")` with guard rail defaults
4. Opens shared working documents as `{taskId}/doc-{name}` → `Y.XmlFragment("content")` for BlockNote
5. Assigns the task to `targetRole` (frontend-dev picks it up)

All of this uses the existing Hocuspocus server already running on port 1234.

### Discussion Event Flow — CRDT, Calls, Events

How an agent-initiated collaboration task works end-to-end, showing every CRDT write, Socket.IO event, and UI update:

```mermaid
sequenceDiagram
    actor User
    participant UI as Frontend
    participant Socket as SocketServerV2
    participant Orch as OrchestratorService
    participant TS as TaskStore
    participant CRDT as CrdtTaskSync
    participant Hocus as Hocuspocus
    participant ColShared as Y.Array / Y.Map
    participant ArchAgent as Architect Agent
    participant FEAgent as Frontend-Dev Agent

    Note over ArchAgent: Working on task-003,<br/>needs frontend input

    rect rgb(240, 248, 255)
    Note over ArchAgent,CRDT: PHASE 1: Create Collaboration Task
    ArchAgent->>Orch: request_task({ type: "collaboration",<br/>targetRole: "frontend-dev",<br/>relationship: "blocks-me" })
    Orch->>TS: taskStore.create(task-007)
    Orch->>CRDT: persistTask(task-007) → {goalId}/task-007/task
    Orch->>TS: task-003.prerequisites.set("task-007", false)
    Note over TS: task-003 now BLOCKED
    end

    rect rgb(255, 248, 240)
    Note over Orch,ColShared: PHASE 2: Initialize Discussion CRDT Docs
    Orch->>Hocus: openDoc("{teamId}/{goalId}/task-007/discussion")
    Hocus->>ColShared: Y.Array("discussion") = []
    Orch->>Hocus: openDoc("{teamId}/{goalId}/task-007/decisions")
    Hocus->>ColShared: Y.Map("decisions") = {}
    Hocus->>ColShared: Y.Map("config") = { maxRounds:10, maxTokens:50k, status:"active" }
    Hocus->>ColShared: Y.Map("cursors") = {}
    end

    rect rgb(240, 255, 240)
    Note over ArchAgent,FEAgent: PHASE 3: Discussion (Agent ↔ Agent via CRDT)
    TS-->>Orch: onTaskReady(task-007, frontend-dev)
    Orch->>FEAgent: dispatch task-007 with context

    ArchAgent->>Hocus: collab discuss post → Y.Array.push(block-1)
    Note right of Hocus: Y.Array("discussion") = [block-1]
    Hocus-->>Hocus: onChange fires
    Hocus->>Socket: discussion:activity { taskId, role, blockCount:1 }
    Socket->>UI: badge update + notification
    Hocus-->>Hocus: auto-persist to .bin
    Hocus-->>Hocus: projectToFilesystem → .ping/.../task-007/discussion.json

    Note over FEAgent: Notified via @mention
    FEAgent->>Hocus: collab discuss read → cursor filter → sees [block-1]
    FEAgent->>Hocus: collab discuss post → Y.Array.push(block-2)
    Note right of Hocus: Y.Array("discussion") = [block-1, block-2]
    Hocus->>Socket: discussion:activity { blockCount:2 }
    FEAgent->>Hocus: cursors.set("frontend-dev", timestamp)
    end

    rect rgb(255, 240, 255)
    Note over User,ColShared: PHASE 4: User Joins Discussion
    UI->>UI: User clicks "Open Thread" for task-007
    UI->>Hocus: HocuspocusProvider.connect("{teamId}/{goalId}/task-007/discussion")
    Hocus-->>UI: Y.Array("discussion").observe() → renders [block-1, block-2]
    UI->>UI: User types response in DiscussionComposer
    UI->>ColShared: Y.Array.push(block-3: { role:"user:backend-dev", type:"decision" })
    Note right of ColShared: block-3 has type="decision"<br/>→ auto-record to Y.Map("decisions")
    ColShared->>Hocus: onChange → discussion:activity + discussion:mention
    Hocus-->>Hocus: auto-persist + project
    end

    rect rgb(248, 248, 240)
    Note over ArchAgent,TS: PHASE 5: Decision → Task Completes
    ArchAgent->>Hocus: collab discuss read → sees [block-2, block-3]
    Note over ArchAgent: Sees user decision block → task resolved
    ArchAgent->>Orch: complete_task(task-007, { decision: "Use PKCE with S256" })
    Orch->>TS: completeTask(task-007, output)
    Orch->>CRDT: syncStatus(task-007, "completed")
    TS-->>TS: task-003.prerequisites["task-007"] = true → ready
    TS-->>Orch: onTaskReady(task-003, architect)
    Note over Orch: Architect resumes task-003<br/>with decision + full discussion as context
    end
```

### Discussion Communication Channels — Who Talks to What

```mermaid
flowchart LR
    subgraph Agents [Backend Agents]
        A1[Architect Agent]
        A2[Frontend-Dev Agent]
    end

    subgraph CRDT [Hocuspocus CRDT Layer]
        YArr["Y.Array('discussion')<br/>append-only blocks"]
        YMap["Y.Map('decisions')<br/>agreed outcomes"]
        YCur["Y.Map('cursors')<br/>per-agent read position"]
        YCfg["Y.Map('config')<br/>guard rails + status"]
    end

    subgraph Backend [Backend Services]
        Hoc[Hocuspocus Server]
        Sock[SocketServerV2]
        Proj[projectToFilesystem]
    end

    subgraph Frontend [React Frontend]
        DT[DiscussionThread<br/>yarray.observe]
        DP[DecisionPanel<br/>ymap.observe]
        DC[DiscussionComposer<br/>yarray.push]
        Toast[Notification Toast]
    end

    A1 -->|"collab discuss post"| YArr
    A2 -->|"collab discuss post"| YArr
    A1 -->|"collab discuss read<br/>(cursor filter)"| YArr
    A2 -->|"collab discuss read"| YArr
    A1 & A2 -->|"cursor update"| YCur

    YArr -->|"onChange"| Hoc
    Hoc -->|"discussion:activity"| Sock
    Hoc -->|"discussion:mention"| Sock
    Hoc -->|"auto-persist"| Hoc
    Hoc -->|"onChange"| Proj
    Proj -->|".json / .md files"| Proj

    Sock -->|"Socket.IO event"| Toast
    Sock -->|"Socket.IO event"| DT

    DC -->|"Y.Array.push<br/>(via HocuspocusProvider)"| YArr
    YArr -->|"yarray.observe()"| DT
    YMap -->|"ymap.observe()"| DP
```

**Key separation of concerns:**
- **CRDT (Hocuspocus)** — all discussion content. Agents read/write via `collab discuss`. Frontend reads via `yarray.observe()`, writes via `Y.Array.push()`. Both use the same CRDT doc.
- **Socket.IO** — notifications only. `discussion:activity` (badge counts), `discussion:mention` (@mention alerts). Does NOT carry discussion content.
- **projectToFilesystem** — read-only file projections. Discussion blocks → `discussion.json`. Decisions → `decisions.json`. For human browsing and post-mortem.

### Guard Rail Enforcement Flow

```mermaid
flowchart TD
    A[Agent calls collab discuss post] --> B{Check Y.Map config}
    B --> C{totalTokensUsed < maxTokens?}
    C -->|No| D[Reject: Token limit hit]
    D --> E[Escalate to planner]
    C -->|Yes| F{roundsPerAgent[role] < maxRounds?}
    F -->|No| G[Reject: Round limit hit]
    G --> E
    F -->|Yes| H{config.status === 'active'?}
    H -->|No| I[Reject: Discussion closed]
    H -->|Yes| J[Push block to Y.Array]
    J --> K[Update config.totalTokensUsed]
    J --> L[Update config.roundsPerAgent]
    J --> M[Reset timeout timer]
    
    N[Timeout timer fires] --> O{Any blocks in last N min?}
    O -->|No| P{escalationPaused?}
    P -->|No| E
    P -->|Yes user active| Q[Wait 2× timeout]
    O -->|Yes| R[Timer reset]

    style D fill:#f44336,color:white
    style G fill:#f44336,color:white
    style I fill:#9E9E9E,color:white
    style J fill:#4CAF50,color:white
    style E fill:#FF9800,color:white
```

---

### Y.js + BlockNote Primer — How The Pieces Fit

Before diving into the discussion protocol, here's how Y.js types relate to what you see in BlockNote.

#### What is a Y.Doc?

A `Y.Doc` is a container — like a database with named "tables." Each "table" is a **shared type** that automatically syncs between everyone connected.

```
Y.Doc (one per document)
├── getMap("my-data")       → Y.Map    (key-value, like a JS Map)
├── getArray("my-list")     → Y.Array  (ordered list, like a JS Array)
├── getText("my-text")      → Y.Text   (collaborative plain text)
└── getXmlFragment("content") → Y.XmlFragment (collaborative rich text / BlockNote)
```

You get a shared type by name. Same name = same data everywhere. Two agents calling `doc.getArray("discussion")` both see and modify the **same** array.

#### Y.js Shared Types — When to Use What

| Type | What it's like | Use for | Concurrent writes? |
|---|---|---|---|
| **Y.Map** | `new Map()` / JS object | Structured data: `{status: "busy", role: "architect"}` | Auto-merged per key. Two agents set different keys → both appear. Same key → last-write-wins. |
| **Y.Array** | `[]` / JS array | Ordered lists: discussion blocks, chat messages, action items | Auto-merged. Two agents push at same time → both items appear in order. Never lose a write. |
| **Y.Text** | `""` / string | Plain collaborative text (like Google Docs but plain text) | Character-level merge. Two agents type in different places → both edits appear. |
| **Y.XmlFragment** | DOM tree | **This is what BlockNote uses.** Rich text with blocks, headings, paragraphs. | Block-level merge. Two agents insert blocks → both appear. |

#### How BlockNote Uses Y.XmlFragment

BlockNote doesn't store text as a string. It stores a tree of XML elements:

```
Y.XmlFragment("content")
└── blockGroup
    ├── blockContainer (id="abc123")
    │   └── heading (level=2)
    │       └── Y.XmlText("API Design Notes")
    ├── blockContainer (id="def456")
    │   └── paragraph
    │       └── Y.XmlText("We need PKCE for SPAs...")
    └── blockContainer (id="ghi789")
        └── bulletListItem
            └── Y.XmlText("Support S256 method")
```

When an agent calls `collab({ action: "write-block", docName: "doc-api-spec", value: "# API Design\nWe need PKCE..." })`:
1. The `write-block` handler parses the markdown
2. Creates `Y.XmlElement("heading")` + `Y.XmlElement("paragraph")` nodes
3. Inserts them into the `Y.XmlFragment("content")`
4. Hocuspocus syncs the change to all connected clients
5. The human sees new blocks appear in their BlockNote editor
6. Other agents calling `read-block` see the text immediately

**The key insight: BlockNote pages ARE Y.XmlFragments. Blocks ARE Y.XmlElements. It's not "blocks create pages and that's it" — blocks are the individual CRDT-synced nodes inside the fragment tree.**

#### Why CRDT Handles Concurrency

Two agents writing to the same Y.Array at the same time:

```
Agent A pushes: { role: "architect", text: "We need PKCE" }     ← at T=100ms
Agent B pushes: { role: "frontend-dev", text: "SDK supports it" } ← at T=105ms

Without CRDT:
  Agent A reads file, appends, writes file → File has A's message
  Agent B reads file, appends, writes file → File has only B's message (A's lost!)

With CRDT (Y.Array):
  Agent A's push sent as Y.js update → merged into shared state
  Agent B's push sent as Y.js update → merged into shared state
  Result: Array has BOTH messages. Order determined by Y.js CRDT algorithm.
  No data loss. No locks. No file I/O race conditions.
```

This is possible because Y.js uses a CRDT algorithm (YATA) that can merge any two concurrent operations without conflicts. The merge happens at the data structure level, not the file level.

---

#### Step 3: CRDT-Based Discussion Protocol

The discussion uses a `Y.Array("discussion")` — an append-only ordered list of message blocks.

Each block is a plain object pushed to the array:

```typescript
interface DiscussionBlock {
  id: string;              // unique block ID
  role: string;            // "architect", "frontend-dev"
  timestamp: string;       // ISO 8601
  content: string;         // markdown text (can include @role inline mentions)
  mentions: string[];      // ["frontend-dev", "planner"] — machine-parseable tags
  replyTo?: string;        // optional: ID of block being replied to
  type: "message" | "decision" | "question";
}
```

**Agent tagging:** The `mentions` array is the machine-readable tag. When a block with `mentions: ["frontend-dev"]` is pushed, Hocuspocus `onChange` fires → backend routes a notification to that agent's worker via Socket.IO `progress` channel. The `@role` text in content is just human-readable sugar.

**Agent writes a discussion block:**
```typescript
collab({
  action: "write",
  docName: "collab/task-007/discussion",    // scoped to collaboration task
  key: "discussion",
  value: {
    id: "block-3",
    role: "architect",
    timestamp: "2026-04-11T10:32:45Z",
    content: "Updated the spec:\n- `/authorize` now accepts `code_challenge`\n- No `client_secret` for public clients with PKCE\n\n**Decision:** Use PKCE with S256.",
    mentions: [],
    type: "decision"
  }
})
```

Under the hood, this pushes to the `Y.Array("discussion")`. Hocuspocus syncs instantly.

#### How "Read From Last Write" Works — The Cursor

Each agent needs to know: "what have I already read?" This is the **cursor**.

The cursor is stored in a `Y.Map("cursors")` on the same CRDT doc. We use **timestamps** (not array indices) because timestamps are robust even if the array ever gets compacted:

```typescript
// Y.Map("cursors") in the collab doc:
{
  "architect": "2026-04-11T10:32:45Z",    // last read timestamp
  "frontend-dev": "2026-04-11T10:31:15Z"   // last read timestamp
}
```

When an agent enters the discussion:

```typescript
// 1. Read my cursor (timestamp-based)
const cursors = doc.getMap("cursors");
const myLastRead = cursors.get(agentRole) ?? "1970-01-01T00:00:00Z";

// 2. Read discussion array
const discussion = doc.getArray("discussion");
const allBlocks = discussion.toJSON();

// 3. Get only NEW blocks (after my last read timestamp)
const newBlocks = allBlocks.filter(b => b.timestamp > myLastRead);

// 4. After reading, update my cursor to now
cursors.set(agentRole, new Date().toISOString());
```

**Why timestamps over indices:**
- Index-based breaks if items are ever deleted/compacted. Timestamps never break.
- Agents can be offline for hours — timestamp still correctly filters to unread.

**This is fully concurrent-safe because:**
- Reading `Y.Array.toJSON()` returns a snapshot — non-blocking
- Writing to `Y.Map("cursors")` only touches MY key — no conflict with other agents
- Pushing to `Y.Array("discussion")` appends — never overwrites
- Two agents reading simultaneously both get consistent snapshots
- Two agents writing simultaneously both succeed — Y.Array merges both pushes

**Frontend vs Backend patterns:**

| Consumer | Pattern | Why |
|---|---|---|
| **Agents (backend)** | Cursor + `filter()` on each entry | Agents are request-response — they enter, read new stuff, respond, leave |
| **Frontend (React)** | `yarray.observe()` event-driven | Frontend is always connected — `.observe()` fires a React state update on every new block, no polling |

#### Example Discussion Flow

```
T=0    Collaboration task created for "collab/task-007/discussion"
       Y.Array("discussion") = []
       Y.Map("cursors") = {}

T=1    Architect enters discussion:
       cursors.get("architect") = undefined → defaults to epoch
       discussion is empty → nothing new to read
       Architect writes block:
         discussion.push([{ id: "b1", role: "architect", mentions: ["frontend-dev"],
           timestamp: "2026-04-11T10:30:00Z", content: "We need PKCE..." }])
       cursors.set("architect", "2026-04-11T10:30:01Z")
       
       State: discussion = [b1], cursors = { architect: "...T10:30:01Z" }

T=2    Frontend-dev enters (notified via mentions):
       cursors.get("frontend-dev") = undefined → defaults to epoch
       allBlocks.filter(b => b.timestamp > epoch) → [b1]  ← sees architect's message
       Frontend-dev writes:
         discussion.push([{ id: "b2", role: "frontend-dev",
           timestamp: "2026-04-11T10:31:15Z", content: "SDK supports PKCE..." }])
       cursors.set("frontend-dev", "2026-04-11T10:31:16Z")

       State: discussion = [b1, b2], cursors = { architect: "...T10:30:01Z", frontend-dev: "...T10:31:16Z" }

T=3    Architect re-enters:
       cursors.get("architect") = "...T10:30:01Z"
       allBlocks.filter(b => b.timestamp > "...T10:30:01Z") → [b2]  ← sees ONLY new message
       Architect writes decision:
         discussion.push([{ id: "b3", role: "architect", type: "decision",
           timestamp: "2026-04-11T10:32:45Z", content: "Use PKCE with S256" }])
       cursors.set("architect", "2026-04-11T10:32:46Z")

       State: discussion = [b1, b2, b3], cursors = { architect: "...T10:32:46Z", frontend-dev: "...T10:31:16Z" }
```

**T=2 and T=3 could happen simultaneously** — Y.Array handles it. Both blocks appear.

#### Shared Working Documents — BlockNote Editors

For actual co-editing (API specs, diagrams, code reviews), the collaboration task opens `doc-*` documents:

```typescript
// Architect creates shared API spec as a BlockNote doc
collab({
  action: "write-block",
  docName: "task/task-003/doc-api-spec",   // scoped to task, doc- prefix = BlockNote
  key: "Auth Endpoints",
  value: "# Auth Endpoints\n## /authorize\n- Accepts code_challenge param\n- Supports S256 method"
})
```

This creates blocks in a `Y.XmlFragment("content")` — which renders as a rich text editor in the frontend via `CollaborativeEditor.tsx`. Both agents and humans can edit it simultaneously.

The difference from discussion:
- **Discussion (Y.Array):** Append-only log. Each entry is immutable once written. Like a chat thread.
- **Shared doc (Y.XmlFragment):** Mutable rich text. Agents and humans co-edit blocks. Like Google Docs.

---

### How to VIEW Each Y.js Type

Y.Map, Y.Array, and Y.XmlFragment are **data structures, not visual documents**. Each needs a different rendering approach:

| Y.js Type | Example | Frontend renders with | How to subscribe |
|---|---|---|---|
| `Y.XmlFragment` | Shared API spec docs | **BlockNote editor** (already built — `CollaborativeEditor.tsx`) | BlockNote handles it automatically |
| `Y.Array` | Discussion threads | **Custom `DiscussionThread` component** — renders blocks as a chat timeline | `yarray.observe(callback)` — fires on every push, drives React state |
| `Y.Map` | Decisions, agent statuses, cursors | **Custom `DecisionPanel` / status component** — renders key-value cards | `ymap.observe(callback)` — fires on set/delete, drives React state |

**You do NOT need Y.XmlFragment to view Y.Array/Y.Map.** They are separate rendering concerns:

```tsx
// Discussion thread (Y.Array → chat-like UI)
function DiscussionThread({ provider, docName }: Props) {
  const [blocks, setBlocks] = useState<DiscussionBlock[]>([]);

  useEffect(() => {
    const discussion = provider.document.getArray<DiscussionBlock>("discussion");

    const update = () => setBlocks(discussion.toJSON());
    discussion.observe(update);       // real-time — fires on every push
    provider.on("synced", update);    // initial sync from server
    update();

    return () => discussion.unobserve(update);
  }, [provider, docName]);

  return (
    <div className="discussion-thread">
      {blocks.map(block => (
        <div key={block.id} className={`block block-${block.type}`}>
          <span className="role-badge">{block.role}</span>
          <time>{block.timestamp}</time>
          {block.mentions?.length > 0 && (
            <span className="mentions">@{block.mentions.join(", @")}</span>
          )}
          <Markdown>{block.content}</Markdown>
        </div>
      ))}
    </div>
  );
}

// Decisions panel (Y.Map → card UI)
function DecisionPanel({ provider }: Props) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  useEffect(() => {
    const decMap = provider.document.getMap<Decision>("decisions");
    const update = () => {
      const { _meta, ...rest } = decMap.toJSON();
      setDecisions(rest);
    };
    decMap.observe(update);
    return () => decMap.unobserve(update);
  }, [provider]);

  return (
    <div>{Object.entries(decisions).map(([key, d]) => (
      <div key={key}>✅ {d.decision} — by {d.decidedBy}</div>
    ))}</div>
  );
}
```

**Summary: each Y.js type has its own component. `.observe()` is the subscription mechanism — it replaces `doc.on("update")` + polling that `CollaborativeEditor.tsx` currently uses.**

---

### CRDT Document Scoping — Proper Hierarchy

**Problem:** Flat doc naming (`collab-task-007`, `doc-api-spec-collab-007`) becomes a mess with many plans and tasks. Need natural grouping for:
- Listing all docs for a task
- Cleaning up when a plan/task completes
- Filesystem projection that makes sense

**Solution:** Hierarchical naming that mirrors the ownership model: Team → Goal → Plan → Task → Discussion.

Hocuspocus doc names are just strings — slashes are allowed. The naming convention follows real ownership:

```
{teamId}/                                              ← TEAM scope
├── agent-statuses                                      (well-known, existing)
├── chat-outcomes                                       (well-known, existing)
│
├── {goalId}/                                          ← GOAL scope
│   ├── goal                                            ← Goal Y.Map (goal metadata + body)
│   ├── plan                                            ← Plan Y.Map (active plan for this goal)
│   │
│   ├── {taskId}/                                      ← TASK scope
│   │   ├── task                                        ← Task Y.Map (task metadata + body)
│   │   ├── discussion                                  ← Task discussion (Y.Array)
│   │   ├── decisions                                   ← Task decisions (Y.Map)
│   │   └── doc-{name}                                  ← Shared working doc (Y.XmlFragment)
│   │
│   └── _index                                          ← Task index Y.Map (byRole, byStatus)
```

**Full Hocuspocus doc name examples:**
```
team-1/build-app/goal                              ← Goal doc
│        │         │
teamId  goalId   docType

team-1/build-app/plan                              ← Plan doc
team-1/build-app/task-003/task                     ← Task doc
team-1/build-app/task-003/discussion               ← Task discussion
team-1/build-app/task-003/doc-api-spec             ← Shared working doc
team-1/agent-statuses                              ← Team-level (no goal scope)
```

**Why this hierarchy:**

| Path | Scope | Why |
|------|-------|-----|
| `{teamId}/agent-statuses` | Team | Agent statuses are team-wide, not goal-specific |
| `{teamId}/{goalId}/goal` | Goal | One goal doc per goal — everything below belongs to this goal |
| `{teamId}/{goalId}/plan` | Goal | One active plan per goal (archived plans stay in PlanStore JSON) |
| `{teamId}/{goalId}/{taskId}/task` | Task | Task data lives under its goal, scoped by taskId |
| `{teamId}/{goalId}/{taskId}/discussion` | Task | Discussion is part of the task, not a separate entity |
| `{teamId}/{goalId}/{taskId}/doc-{name}` | Task | Shared docs belong to the task that created them |

**Note:** `CollaborationSpace` currently prefixes with `{teamId}/{goalId}/`. For team-level docs like `agent-statuses`, the server accesses them directly without the goal prefix.

**Agent usage:**
```typescript
// Agent reads its own task
space.openDoc("task-003/task")
// Full name: team-1/build-app/task-003/task

// Agent reads the goal
space.openDoc("goal")
// Full name: team-1/build-app/goal

// Agent reads the plan
space.openDoc("plan")
// Full name: team-1/build-app/plan

// Agent opens task discussion
space.openDoc("task-003/discussion")
// Full name: team-1/build-app/task-003/discussion

// Agent opens shared working doc
space.openDoc("task-007/doc-api-spec")
// Full name: team-1/build-app/task-007/doc-api-spec

// List all docs for a specific task
const docs = await space.listDocs();
const taskDocs = docs.filter(d => d.startsWith("task-003/"));
// → ["task-003/task", "task-003/discussion", "task-003/decisions", "task-003/doc-api-spec"]
```

**Benefits:**
- **Natural ownership:** `task-003/discussion` is clearly part of task-003.
- **Scoped cleanup:** Complete a goal → archive all `{goalId}/*` docs. Task done → snapshot `{taskId}/*`.
- **Scoped listing:** `docs.filter(d => d.startsWith("task-003/"))` = all docs for one task.
- **No naming collisions:** Each task is its own namespace. Two tasks can both have `discussion` without conflict.
- **Filesystem projection follows the hierarchy:** `.ping/collaboration/task-003/task.json`, `.ping/collaboration/task-003/discussion.json`
- **Frontend routing:** URL `/team/team-1/goal/build-app/task/task-003` → subscribe to `task-003/*` docs.

#### Persistence & Projection — Including Task.md/Plan.md/Goal.md

Everything persists automatically through the existing infrastructure:

1. **Binary persistence:** Hocuspocus `Database` extension saves Y.Doc state to `data/collab/yjs/{docName}.bin`
2. **Filesystem projection:** Hocuspocus `onChange` callback projects to readable files
3. **Crash recovery:** On restart, Hocuspocus loads `.bin` files → full state restored

**We still get Task.md, Plan.md, Goal.md** — as read-only projections from CRDT, not as source of truth. `projectToFilesystem` can be extended to output YAML frontmatter + markdown body for task/plan/goal docs:

```
projectToFilesystem detects doc type:
  - {teamId}/{goalId}/goal          → .ping/collaboration/goal.md
  - {teamId}/{goalId}/plan          → .ping/collaboration/plan.md  
  - {teamId}/{goalId}/{taskId}/task → .ping/collaboration/{taskId}/task.md
  - everything else                 → .json (existing behavior)
```

**Projected Task.md example** (auto-generated from CRDT Y.Map):
```yaml
---
id: task-003
title: "Design REST API endpoints"
assignedRole: architect
status: in_progress
priority: 2
complexity: medium
type: work
dependencies:
  - task-001
  - task-002
createdBy: planner
planId: plan-001
expectedOutput: "API specification document"
createdAt: 2026-04-13T10:00:00Z
---

# Design REST API endpoints

## Context
The product requires a REST API for the B2B SaaS platform. Market research (task-001)
identified 12 competitors.

## Acceptance Criteria
- [ ] All CRUD endpoints defined
- [ ] Authentication flow documented
- [ ] Rate limiting strategy included
```

**This looks identical to the original Task.md format** — same YAML frontmatter, same markdown body. The difference is the source of truth is CRDT, not the file. The file is a read-only projection that updates whenever the CRDT changes.

**Why projections still matter:**
- **Post-mortem:** After a goal completes, the projected `.md` files tell the story
- **Human browsing:** Open `.ping/collaboration/task-003/task.md` in any editor
- **Git-friendly:** Projected files can be committed as snapshots (optional)
- **Agent fallback:** If `collab` tool is unavailable, agents can `workspace_read_file` the projections

So you get the best of both worlds: **CRDT for real-time concurrent access and persistence, projected `.md`/`.json` for human readability.**

#### Step 4: Completion

The collaboration task completes when:
- All participants have posted at least one block (check `Y.Array("discussion")`)
- A decision block exists with `type: "decision"` in the discussion array
- OR: a key is set in `Y.Map("decisions")` with the agreed outcome
- OR: a guard rail is hit (maxRounds/maxTokens/timeout) → auto-escalate
- The initiator marks the task complete (or the Planner does, or a user decision closes it)

Decisions map:
```typescript
// Y.Map("decisions") in the collab doc:
{
  "auth-flow": {
    decision: "Use PKCE with S256",
    decidedBy: "architect",
    agreedBy: ["frontend-dev"],
    timestamp: "2026-04-11T10:32:45Z"
  }
}
```

Output goes to the task's `output` field and downstream dependants get it via normal context flow. The projected `.json`/`.md` files in `.ping/collaboration/` remain as persistent artifacts.

---

## Architecture Options — Storage Layer

### Why Not `.ping/` Filesystem?

The original design put Task.md/Plan.md/Goal.md in `.ping/` within the workspace repo. Research revealed this conflicts with the MASTER-ARCHITECTURE:

1. **Worker cloning breaks it** — each worker gets a workspace clone on a task branch. `.ping/tasks/task-003.md` gets cloned too. Worker updates status in its clone → out of sync with the real TaskStore. Status updates aren't deliverables — they shouldn't be in git.

2. **Workspace = deliverables** — the MASTER-ARCHITECTURE separates concerns: workspace repo for code/docs, CRDT for coordination/knowledge, MongoDB for conversations. Plans/Goals/Tasks are coordination state, not deliverables.

3. **File I/O for state machine** — every `ready → in_progress → completed` means parse frontmatter → update field → serialize → write file. The runtime state machine (TaskStore) needs in-memory speed, not file I/O.

### Option A: `.ping/` Filesystem Tasks  
**Storage:** Markdown files in workspace git repo  
❌ Rejected — conflicts with worker clone model, mixes deliverables with coordination state.

### Option B: Markdown Source + Runtime Projection  
**Storage:** `.md` files as source of truth, in-memory Map as runtime  
❌ Rejected — same L1 conflict. `.md` files in repo = cloned per worker = stale reads.

### Option C: JSON Runtime + Markdown Snapshots  
**Storage:** Current JSON TaskStore, periodic markdown snapshots  
❌ Rejected — two sources of truth, stale snapshots, agents can't write tasks.

### Option D: CRDT Persistence + Runtime Projection (Recommended)  

**Storage:** CRDT documents (Hocuspocus Y.Map) as persistence layer, in-memory TaskStore as runtime engine.

```
                    ┌──────────────────┐
   Plan approved    │  CRDT Y.Map      │  Persistence layer
        │           │  (Hocuspocus)    │  (concurrent-safe, auto-persisted)
        │           └──────┬───────────┘
        │                  │ read Y.Map → Task object
        ▼                  ▼
   ┌──────────┐     ┌─────────────┐
   │ TaskStore │◄────│ CrdtTaskSync │  Hydrates runtime from CRDT on startup
   │ (in-mem)  │     └─────────────┘
   └─────┬────┘
         │ status change (single writer)
         ▼
   ┌─────────────┐      ┌─────────────────────┐
   │ CrdtTaskSync │ ──→  │ projectToFilesystem  │
   │ (writes back)│      │ (auto JSON/MD proj.) │
   └─────────────┘      └─────────────────────┘
```

**How it works:**
- **TaskStore** remains the single-writer runtime engine (state machine, DAG, RoleTaskQueue)
- **CRDT Y.Map** per task is the durable persistence layer — replaces FileTaskStore
- **CrdtTaskSync** syncs TaskStore ↔ CRDT: writes on status change, loads on startup
- **projectToFilesystem** (already exists) auto-projects CRDT data to `.ping/collaboration/` as readable JSON/MD — agents browse via `collab` tool
- **Hocuspocus Database extension** (already exists) auto-persists to `.bin` files — crash recovery is free
- **IPluginStorage.taskStore** (already defined) provides the injection point — same pattern as PlanStore

---

## Recommended: Option D (CRDT Persistence + Runtime Projection)

### Why CRDT Is The Right Layer

| Concern | Filesystem (`.ping/`) | CRDT (Hocuspocus) | Database (MongoDB) |
|---------|----------------------|--------------------|--------------------|
| **Concurrent safety** | File locking needed | Conflict-free by design | Transactions needed |
| **Real-time sync** | Poll or watch | Built-in (Y.Map.observe) | Change streams |
| **Agent access** | `workspace_read_file` | `collab` tool (already exists) | Need new API tools |
| **Persistence** | File write per change | Auto-persisted to `.bin` | Write per change |
| **Crash recovery** | Re-read files | Hocuspocus loads `.bin` | Query DB |
| **Worker clone conflict** | ❌ Yes | ✅ No (not in workspace) | ✅ No |
| **Infrastructure** | Filesystem only | ✅ Already running | Need to add MongoDB collections |
| **Co-location with discussions** | Separate systems | ✅ Same infra | Separate from CRDT |
| **Human readability** | Native (.md files) | Via projection (auto JSON/MD) | Need export |

**Key advantages:**

1. **Same infra as everything collaborative.** Discussions, decisions, shared docs, agent statuses — all CRDT. Tasks/Plans/Goals join the same system. One protocol, one set of tools.

2. **TaskStore stays as the query engine.** No MongoDB indexing needed — TaskStore's in-memory Map already handles `getReadyTasks(role)`, DAG traversal, status transitions. CRDT just durably stores what TaskStore decides.

3. **Single-writer eliminates CRDT's weakness.** Y.Map is last-write-wins per key — but TaskStore is the ONLY status writer. All transitions go through `TaskStore.updateStatus()` which enforces `VALID_TRANSITIONS`. CRDT is the durable store, not a concurrent editor.

4. **Proven pattern: PlanStore already does this.** PlanStore is wired via `IPluginStorage` from `L2CollaborationPlugin.getStorage()`. CrdtTaskSync follows the identical pattern — implement `ITaskStore`, register via plugin storage, OrchestratorService receives it.

5. **Agent browsability.** Agents already use the `collab` tool. `collab({ action: "read", docName: "tasks/task-003" })` gives them the same data as `workspace_read_file(".ping/tasks/task-003.md")` — using a tool they already have.

6. **No L1 conflict.** Workspace repo = pure deliverables. CRDT = coordination state + team knowledge + collaboration. Clean separation per MASTER-ARCHITECTURE.

### CRDT Document Layout

```
{teamId}/                                              ← TEAM scope (no CollaborationSpace prefix)
├── agent-statuses                                      (well-known, existing)
├── chat-outcomes                                       (well-known, existing)

{teamId}/{goalId}/                                     ← GOAL scope (= CollaborationSpace prefix)
├── goal                                                ← Goal Y.Map
│     { id, title, teamId, status, submittedBy, planId, createdAt, body }
│
├── plan                                                ← Plan Y.Map (active plan)
│     { planId, goalId, goal, status, version, tasks[], body }
│
├── {taskId}/                                           ← TASK scope
│   ├── task                                            ← Task Y.Map
│   │     { id, title, assignedRole, status, priority, complexity, type,
│   │       dependencies[], createdBy, planId, expectedOutput, output, body }
│   ├── discussion                                      ← Discussion Y.Array
│   ├── decisions                                       ← Decisions Y.Map
│   └── doc-{name}                                      ← Shared BlockNote docs
│
└── _index                                              ← Task index Y.Map
      { byRole: { architect: ["task-003"], ... },
        byStatus: { ready: ["task-001"], ... } }
```

**One Y.Map per task** (not all tasks in one doc). Why:
- Each task is a small document (~500 bytes) — efficient for Hocuspocus
- `projectToFilesystem` creates one `.md` file per task — browseable
- No contention — different agents writing to different task docs
- Scoped cleanup — archive a task = archive all `{taskId}/*` docs
- Discussion/decisions co-located with their task — natural grouping

**Task index (Y.Map):** A lightweight index for queries like "all tasks for role X." Updated by CrdtTaskSync whenever a task is created/completed. TaskStore's in-memory Map is still the primary query engine — the index is for agents who browse via collab tool.

### CrdtTaskSync — The Bridge

```typescript
class CrdtTaskSync {
  constructor(
    private space: CollaborationSpace,
    private taskStore: TaskStore,
  ) {}

  // Write task to CRDT (after TaskStore.create)
  async persistTask(task: Task): Promise<void> {
    const doc = await this.space.openDoc(`${task.id}/task`);
    const map = doc.getMap("task");
    map.set("id", task.id);
    map.set("title", task.context?.title || task.description);
    map.set("assignedRole", task.assigned_role);
    map.set("status", task.status);
    map.set("priority", task.priority || 3);
    map.set("dependencies", Array.from(task.prerequisites.keys()));
    map.set("createdBy", task.context?.createdBy || "planner");
    map.set("planId", task.context?.planId);
    map.set("expectedOutput", task.context?.expectedOutput || "");
    // body = rich markdown description for agents to read
    map.set("body", task.description);
  }

  // Update status in CRDT (after TaskStore.updateStatus)
  async syncStatus(taskId: string, newStatus: TaskStatus, output?: any): Promise<void> {
    const doc = await this.space.openDoc(`${taskId}/task`);
    const map = doc.getMap("task");
    map.set("status", newStatus);
    if (newStatus === "completed") {
      map.set("completedAt", new Date().toISOString());
      if (output) map.set("output", output);
    }
  }

  // Load all tasks from CRDT (on startup / crash recovery)
  async loadAllTasks(): Promise<Task[]> {
    const docs = await this.space.listDocs();
    // Task docs match pattern: {taskId}/task (not {taskId}/discussion, etc.)
    const taskDocs = docs.filter(d => d.endsWith("/task") && d !== "goal" && d !== "plan");
    const tasks: Task[] = [];
    for (const docName of taskDocs) {
      const doc = await this.space.openDoc(docName);
      const map = doc.getMap("task");
      tasks.push(this.mapToTask(map.toJSON()));
    }
    return tasks;
  }

  private mapToTask(data: Record<string, any>): Task {
    return {
      id: data.id,
      description: data.body || data.title,
      assigned_role: data.assignedRole?.toLowerCase(),
      status: data.status,
      priority: data.priority,
      prerequisites: new Map(
        (data.dependencies || []).map((d: string) => [d, false])
      ),
      dependants: [],  // rebuilt by DependencyResolver
      context: {
        title: data.title,
        planId: data.planId,
        expectedOutput: data.expectedOutput,
        createdBy: data.createdBy,
      },
    };
  }
}
```

### How Agents Access Task Data

Agents use the existing `collab` tool — no new tools needed:

```typescript
// Agent reads its own task
collab({ action: "read", docName: "task-003/task" })
// → Returns: { id, title, assignedRole, status, dependencies, body, ... }

// Agent lists all tasks (via index)
collab({ action: "list", docName: "tasks" })
// → Returns: task-001 [completed] — Market Research (researcher)
//            task-002 [completed] — Competitive Analysis (researcher)
//            task-003 [in_progress] — Product Positioning (strategist)

// Agent reads the goal
collab({ action: "read", docName: "goal" })
// → Returns: { title, status, body (with user intent + success criteria) }

// Agent reads the plan
collab({ action: "read", docName: "plan" })
// → Returns: { planId, goal, status, tasks[], body (with strategy notes) }

// Agent reads task discussion
collab({ action: "read", docName: "task-003/discussion" })
// → Returns: discussion blocks array

// Agent lists all docs for a task
collab({ action: "list", docName: "task-003" })
// → Returns: task, discussion, decisions, doc-api-spec
```

**projectToFilesystem** (already exists) auto-creates readable files:
```
.ping/collaboration/
├── goal.md                            ← projected from CRDT goal doc
├── plan.md                            ← projected from CRDT plan doc
├── task-001/
│   └── task.md                        ← projected task (YAML frontmatter + body)
├── task-002/
│   └── task.md
├── task-003/
│   ├── task.md
│   ├── discussion.json                ← projected discussion blocks
│   └── doc-api-spec.md                ← projected BlockNote doc
└── _index.json                        ← projected task index
```

These projections are read-only artifacts — the CRDT is the source of truth.

### When You'd Add MongoDB

CRDT-only works until you need:
- **Cross-team queries** ("all tasks across all teams") — CRDT is team-scoped
- **Analytics/reporting** ("average completion time over 30 days") — no aggregation in CRDT
- **Full-text search** ("find tasks mentioning 'auth'") — no search in CRDT
- **Access control** — MongoDB has field-level security; CRDT doesn't

At that point, add MongoDB as a **read replica** — CRDT writes trigger event → store in MongoDB for queries. CRDT remains source of truth. MongoDB is the analytics layer. This is a v2+ concern.

---

## Integration Points

### Existing Components

| Component | Change |
|---|---|
| **TaskStore** | Add `CrdtTaskSync` — persist to CRDT, load from CRDT on startup |
| **OrchestratorService** | `approvePlan()` persists tasks/plans/goals to CRDT via CrdtTaskSync after hydrating TaskStore |
| **WorkerPool** | Inject `request_task` tool into all worker agents |
| **RoleTaskQueue** | No change — still handles runtime dispatch |
| **DependencyResolver** | Handle agent-created task edges (dynamic DAG mutation) |
| **Collab Tool** | Agents read tasks/plans/goals via existing `read`/`list` actions. Add `discuss` action for Y.Array discussion + cursor protocol. |
| **CollaborationSpace** | No change — already scopes docs by `{teamId}/{goalId}/` |
| **L2CollaborationPlugin** | Return `CrdtTaskSync` via `getStorage().taskStore` (same pattern as PlanStore) |
| **projectToFilesystem** | No change — auto-projects CRDT docs to `.ping/collaboration/` as JSON/MD |

### New Components

| Component | Purpose |
|---|---|
| **CrdtTaskSync** | Bidirectional TaskStore ↔ CRDT persistence (implements ITaskStore) |
| **CrdtGoalStore** | Goal lifecycle in CRDT (create, update status, archive) |
| **`request_task` tool** | AI SDK tool for agents to create tasks |
| **`discuss` collab action** | New action in existing `collab` tool — read/write discussion Y.Array with cursor tracking |
| **CollabTaskDispatcher** | Specialized dispatch for `collaboration` type tasks — opens CRDT doc, initializes Y.Array/Y.Map |

### Frontend Impact

#### New Components

| Component | Location | What it renders | Data source |
|---|---|---|---|
| **`DiscussionThread`** | Main content area (full view) + DetailPanel inline (compact) | Chat-like timeline of discussion blocks — role badge, timestamp, markdown content, @mention chips | `Y.Array("discussion")` via `yarray.observe()` — real-time |
| **`DecisionPanel`** | Inline within DiscussionThread + Plan view sidebar | Decision cards with ✅ status, decided-by, agreed-by list, quorum progress | `Y.Map("decisions")` via `ymap.observe()` — real-time |
| **`DiscussionComposer`** | Bottom of DiscussionThread | Text input + @mention autocomplete + decision/question type selector. For humans to participate in agent discussions. | Pushes to `Y.Array("discussion")` via HocuspocusProvider |
| **`AgentStatusBar`** | DetailPanel "Agents" tab (SwarmView extension) | Per-agent row: role, current task, discussion status (reading block N, writing response, idle) | `Y.Map("agent-statuses")` — extend with `discussionState` field |
| **`DiscussionListPanel`** | DetailPanel "Discussions" tab (5th tab) | Active/resolved thread list with badges, participants, unread counts | Hocuspocus doc listing + Socket.IO `discussion:activity` events |

#### Layout — Two Viewing Modes

Discussions support both **full view** (main content area) and **side-by-side** (split pane). The user chooses based on context.

**Mode A: Full View (Discussion replaces main content)**

"Discussions" is a 4th nav item in the sidebar (alongside Chat / Tasks / Collaborate). Clicking a thread from the DetailPanel's Discussions tab — or clicking the sidebar nav — switches the main content column to the full DiscussionThread.

```
┌─────────┬──────────────────────────┬──────────────┐
│SIDEBAR  │   DISCUSSION THREAD      │ DETAIL PANEL │
│         │   (full width, flex-1)   │ (w-80)       │
│Nav:     │                          │              │
│ Chat    │   API Auth Flow          │ Discussions  │
│ Tasks   │   architect ↔ fe-dev     │ tab: other   │
│ Collab  │   You: backend-dev       │ active       │
│🆕Discuss│                          │ threads      │
│         │   🤖 architect · 10:30   │              │
│         │   We need PKCE...        │ 🔴 API Auth  │
│Agents   │                          │ 🟡 DB Schema │
│list     │   🤖 frontend-dev · 10:31│ ✅ Resolved  │
│         │   SDK supports PKCE      │              │
│         │                          │              │
│         │   👤 Roshan · 11:00      │              │
│         │   Use JWT. ✅ DECISION   │              │
│         │                          │              │
│         │   ────────────────────   │              │
│         │   [Composer + @mention]  │              │
│         │   ⚡3/10 rounds · 12k/50k│              │
└─────────┴──────────────────────────┴──────────────┘
```

Best for: focused discussion, long threads, when you're actively participating.

**Mode B: Split Pane (Discussion alongside Chat)**

When a discussion is active and the user is in Chat view, a "pin thread" button opens the thread as a split pane alongside the chat. Same pattern as IDE terminal panels.

```
┌─────────┬───────────────┬──────────┬──────────────┐
│SIDEBAR  │ CHAT AREA     │ THREAD   │ DETAIL PANEL │
│         │ (flex-1)      │ (w-96,   │ (w-80)       │
│Nav:     │               │ resizable│              │
│ Chat ← │ Messages...   │ 🤖 arch  │ Discussions  │
│ Tasks   │               │ 🤖 fe-dev│ tab          │
│ Collab  │               │ 👤 Roshan│              │
│ Discuss │ [Chat input]  │ [compose]│              │
└─────────┴───────────────┴──────────┴──────────────┘
```

Best for: monitoring a discussion while continuing to chat, quick check-ins, observer mode.

**How to switch between modes:**
- **DetailPanel → Discussions tab → "Open Thread"** → Mode A (full view)
- **DetailPanel → Discussions tab → "Pin Thread"** (📌 icon) → Mode B (split pane alongside current view)
- **Sidebar → Discussions nav** → Mode A (shows thread list, click to open)
- **Chat message badge → click** → Mode B (split pane from chat context)
- Thread panel in Mode B has a **"↗ Full View"** button to switch to Mode A
- Mode A has a **"⇐ Split"** button to switch to Mode B (if coming from Chat)

#### Integration Points

| Existing Component | Change |
|---|---|
| **Sidebar** | Add 4th nav item: **"Discussions"** with unread badge count |
| **DetailPanel** | Add 5th tab: **"Discussions"** — compact thread list with status badges. "Open Thread" → Mode A. "📌 Pin Thread" → Mode B. |
| **App.tsx (view switching)** | Add `discussions` to the `activeView` state. Renders `DiscussionThread` in main content column (Mode A). Add split-pane state for Mode B. |
| **Tasks tab (DetailPanel)** | Add 💬 badge per task showing discussion count. Click opens thread in Mode A. |
| **PlanApproval** | Add 📝 discussion icon per task. Pre-execution discussions happen here — user can comment on tasks before approving. |
| **SwarmView (Agents tab)** | Extend agent cards with discussion status: "discussing with frontend-dev", "reading collab/task-007 block 3", "waiting for response" |
| **Task panel** | Show `createdBy` (planner vs agent), task type badges (work/review/collaboration/decision) |
| **Plan view** | Show agent-created tasks as dotted-edge additions to DAG |

#### Agent Status — What They're Reading

Extend the existing `agent-statuses` CRDT doc with discussion state:

```typescript
// Y.Map("agent-statuses") — extended
{
  "architect": {
    role: "architect",
    status: "busy",                    // existing
    lastUpdated: "2026-04-11T10:32:45Z",
    // New fields:
    discussionState: {
      activeDoc: "collab/task-007/discussion",   // which discussion they're in
      action: "reading" | "writing" | "idle",    // what they're doing
      lastBlock: "b2",                            // last block they read
      with: ["frontend-dev"],                     // who they're discussing with
    }
  }
}
```

Frontend `SwarmView` subscribes to this Y.Map and shows live status like:
- 🟢 **architect** — working on task-003
- 💬 **architect** — discussing with frontend-dev (reading response...)
- ⏳ **frontend-dev** — writing response in collab/task-007
- ✅ **researcher** — idle

#### Socket.IO Events (New)

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `discussion:activity` | server → client | `{ taskId, docName, role, action, blockCount }` | Lightweight ping when any discussion has new activity — drives badge counts |
| `discussion:mention` | server → client | `{ fromRole, toRole, taskId, blockId }` | Notification when user is @mentioned in a discussion |

Note: the actual discussion content syncs via Hocuspocus WebSocket (CRDT), NOT Socket.IO. Socket.IO only delivers notifications/badges. This keeps the two concerns separate — CRDT for data, Socket.IO for presence/notifications.

---

## Builder/Hacker Ideas — Alignment Analysis

Each idea evaluated against: (a) does infrastructure already exist? (b) is it a low-hanging fruit? (c) does it align with the vision of non-blocking parallel work + agent-initiated collaboration?

### ✅ Include in v1 — Low-Hanging Fruit

#### 1. Agent Tagging (@ Mentions) — INCLUDE

**Effort:** Low — add `mentions[]` to DiscussionBlock, hook into existing NotificationQueue.  
**Infra exists:** NotificationQueue already debounces/routes task events. Just add `onChange` listener that reads `mentions` from new Y.Array entries.  
**Vision alignment:** Core to collaboration — agents must be able to page each other. Without this, discussions are passive.

```typescript
// Agent pushes a discussion block with tags
collab({
  action: "discuss",
  docName: "collab/task-007/discussion",
  value: {
    content: "@architect I found conflicting requirements. See market-data.md §4.",
    mentions: ["architect"],     // machine-parseable — triggers notification
    type: "question"
  }
})
```

**Notification flow:** Y.Array push → Hocuspocus `onChange` → backend reads `mentions` array → routes notification:
- If mentioned agent is currently executing a task → queued as interrupt context
- If mentioned agent is idle → micro-task created for response
- Planner always sees all mentions via `get_status` tool
- Frontend receives via Socket.IO `progress` channel → shows notification badge

#### 2. Decision Escalation — INCLUDE

**Effort:** Low — timer on collaboration tasks, existing NotificationQueue handles routing.  
**Infra exists:** NotificationQueue has debounce/batching. Planner already has `get_status` + `get_blocked` tools.  
**Vision alignment:** Directly prevents discussions from stalling. Aligns with "unknowns resolved in parallel" — if agents can't resolve, escalate to planner/human rather than blocking forever.

If a collaboration task stalls (no new blocks for N minutes), auto-escalate:
- First: notify Planner → Planner can inject a decision or reframe the question
- Then: notify user → human breaks the tie

#### 3. "Help Wanted" / Decision Tasks — INCLUDE

**Effort:** Low — it's just a `request_task` with `type: "decision"` and `targetRole: "planner"`. No new infrastructure.  
**Infra exists:** `request_task` tool (this feature), priority queue, planner tools.  
**Vision alignment:** Core to "agents start doing known things immediately" — the agent works on what it knows and raises a decision task for what it doesn't. Non-blocking by design.

```typescript
request_task({
  title: "Need clarification: should auth use JWT or session cookies?",
  type: "decision",
  targetRole: "planner",    // escalate to planner
  priority: 1,              // CRITICAL — planner handles next
  relationship: "blocks-me",
})
```

This is how an agent "raises its hand" without stopping work on other non-blocked parts.

#### 4. Task Bouncing — INCLUDE

**Effort:** Low — `reassign_task` tool already exists in planMutationTools. Just expose a simplified `bounce_task` wrapper to worker agents.  
**Infra exists:** `createReassignTaskTool()` in planMutationTools.ts handles role reassignment with reason.  
**Vision alignment:** Prevents wasted LLM calls on misassigned tasks. Agent discovers it lacks expertise → bounces immediately instead of producing poor output.

```typescript
bounce_task({
  taskId: "task-006",
  reason: "This requires database expertise I don't have",
  suggestedRole: "dba",
})
```

The task goes back to the queue with a note. Planner can reassign or create a new role.

#### 5. Cross-Plan Task References — INCLUDE

**Effort:** Low — PlanStore.listAllPlans() already queries across all goals. Just add a `references` field to Task.md frontmatter and inject referenced task outputs as context.  
**Infra exists:** PlanStore has cross-goal queries. Output manifests at `.ping/outputs/` provide task results.  
**Vision alignment:** Enables learning across goals. Agents don't repeat work that was done in a previous plan.

```yaml
# In Task.md frontmatter
references:
  - plan-000/task-003    # "We did something similar last time"
```

On dispatch, TaskSyncer loads the referenced task output and injects it as `context.references[]`.

#### 6. Collaboration Quorum — INCLUDE

**Effort:** Low — add `quorumRequired` to collaboration task config. Completion check: count unique roles in `decisions` Y.Map's `agreedBy[]` arrays.  
**Infra exists:** Y.Map("decisions") already stores `agreedBy: string[]`. Just add a guard in completion logic.  
**Vision alignment:** Multi-agent decisions need a clear "done" signal. Without quorum, one agent can force a decision over others.

```yaml
collaboration:
  participants: [architect, frontend-dev, security-reviewer]
  quorumRequired: 2    # at least 2 must agree
```

#### 7. Micro-Collaborations (Quick Ask) — INCLUDE

**Effort:** Medium-low — uses existing CRDT discussion pattern but with a timeout wrapper. No new infra, just a lightweight tool that creates a scoped discussion doc, waits for a response, and falls back.  
**Infra exists:** Collab tool with Y.Array discussion + cursor protocol. Just needs timeout logic.  
**Vision alignment:** Critical for "unknowns resolved in parallel" without the overhead of a full collaboration task. Quick questions shouldn't require plan-level coordination.

```typescript
quick_ask({
  targetRole: "frontend-dev",
  question: "What's the max payload size your client handles?",
  timeout: 60,  // seconds — if no response, continue with default
  default: "10MB",
})
```

Implemented as: create `task/{myTaskId}/quick-ask-{uuid}` discussion doc → push question → start timer → poll for response → timeout returns default. The quick-ask doc is scoped to the current task.

### ⏳ Defer — Higher Effort or Future Vision

#### 8. Task Inheritance via Templates — DEFER to v2

**Effort:** Medium — need template directory, loader, template resolution in TaskSyncer.  
**Infra exists:** ❌ None. No template system in the codebase.  
**Why defer:** Useful but not critical. Agents can describe acceptance criteria inline. Templates add value when you have many recurring task patterns — premature until enough tasks exist to identify patterns.

#### 9. Workspace Merging After Collaboration — DEFER to collab-docs feature

**Effort:** High — git branch merging, conflict resolution, multi-branch coordination.  
**Infra exists:** Workspace L1 has git ops, but no multi-branch merge orchestration.  
**Why defer:** This is squarely in the agent-collab-docs feature scope (L1 workspace coordination). Collaboration tasks from this feature write to CRDT docs, not git branches. The merge problem exists only when collab docs produce code changes — which requires the full dual-agent architecture.

#### 10. Agent Reputation — DEFER to v2+

**Effort:** Medium — need tracking, aggregation, persistence, planner integration.  
**Infra exists:** ⚠️ Partial — RoleTaskQueue tracks `tasksCompleted`, `tasksFailed`, `avgCompletionTime` per role. But no per-agent tracking or usefulness scoring.  
**Why defer:** Useful for mature systems with many plans executed. Premature until agent-created tasks are frequent enough to measure signal vs noise. Can be retrofitted from existing task history without upfront design.

---

### Summary: What's In vs Out

| Idea | Verdict | Effort | Key Reason |
|---|---|---|---|
| Agent Tagging (@mentions) | ✅ v1 | Low | Core to collaboration — already built into DiscussionBlock |
| Decision Escalation | ✅ v1 | Low | Prevents stalls — uses existing NotificationQueue |
| Help Wanted / Decision Tasks | ✅ v1 | Low | Just a `request_task` type — zero new infra |
| Task Bouncing | ✅ v1 | Low | `reassign_task` already exists — just expose to workers |
| Cross-Plan References | ✅ v1 | Low | PlanStore + output manifests already support this |
| Collaboration Quorum | ✅ v1 | Low | Field on task config + completion guard |
| Quick Ask (Micro-Collab) | ✅ v1 | Med-Low | Uses existing CRDT pattern + timeout |
| Task Templates | ⏳ v2 | Medium | No template infra exists, premature |
| Workspace Merging | ⏳ collab-docs | High | Belongs in agent-collab-docs dual-agent feature |
| Agent Reputation | ⏳ v2+ | Medium | Need enough history to be useful |

---

## Summary

| Decision | Choice | Rationale |
|---|---|---|
| Task data format | Structured Y.Map (JSON-like) with rich `body` field | Agent-readable via collab tool, human-readable via auto-projection |
| Runtime engine | TaskStore (in-memory Map) — single writer for state machine | Performance + DAG queries + status transitions. CRDT is persistence, not runtime. |
| Persistence layer | CRDT (Hocuspocus Y.Map per task/plan/goal) | Concurrent-safe, auto-persisted to `.bin`, crash recovery, same infra as discussions |
| Storage location | CRDT docs: `{teamId}/{goalId}/{taskId}/task` hierarchy | Team→Goal→Task ownership, clean scoping, no workspace conflicts |
| Agent access | Existing `collab` tool (`read`/`list` actions) | No new tools needed — agents already use collab for team knowledge |
| Human readability | `projectToFilesystem` → `.ping/collaboration/{taskId}/task.md` | Auto-projected as YAML frontmatter + markdown body — same format as original design |
| Agent task creation | `request_task` tool with guard rails | Autonomous but bounded — max 5, no self-assign, priority ceiling |
| Pre-plan research | `submit_research` tool — blocks plan creation until tasks complete | Planner gets informed context before decomposing; user can skip/cancel |
| Collaboration protocol | CRDT — Y.Array for discussion, Y.Map for decisions, Y.XmlFragment for shared docs | Concurrent-safe by math, uses existing Hocuspocus + collab tool, real-time sync, no file locking |
| Read tracking | Timestamp cursor in Y.Map("cursors") per agent | Robust to compaction, agents filter by `timestamp > lastRead` |
| Agent tagging | `mentions[]` array in DiscussionBlock + `@role` in content | Machine-parseable for notifications, human-readable in projections |
| CRDT scoping | `{teamId}/{goalId}/{taskId}/` hierarchy | Natural ownership (team→goal→task), scoped listing/cleanup, discussion co-located with task |
| Frontend UI | DiscussionThread + DecisionPanel + DiscussionComposer + AgentStatusBar | 5th DetailPanel tab + 4th sidebar nav + split-pane Mode B |
| Discussion guard rails | maxRounds (10), maxTokens (50k), timeout (15min) | Prevents infinite discussions, auto-escalates on cap hit |
| Discussion mode | Auto by default | Agents respond immediately without waiting for turn management |
| User participation | Users join as `user:{agentRole}`, post blocks, make decisions | Human as tiebreaker, not bottleneck — any user activity stops escalation timer |
| Plan relationship | Agent tasks don't modify Plan CRDT doc | Plan is Planner's artifact; agent tasks are addenda to the DAG |
| Priority system | 0-5 with reserved levels | 0=system, 1=critical/planner-only, 2-5=general use |
| Future DB layer | MongoDB as read-replica when analytics/search needed | CRDT remains source of truth; MongoDB for cross-team queries, v2+ |
