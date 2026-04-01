# Orchestrator Agent — Feature Architecture

**Feature:** Replace hardcoded orchestration logic with an LLM-driven Orchestrator Agent that coordinates teams via conversational refinement, delegated planning, and tool-based execution.

**Decision:** Option B (Tools Invoke Agents) + Hybrid Approval Protocol

---

## Overview

The Orchestrator is AgentManager's "brain" — an `InternalAgent` that:
1. **Chats** with the user to understand and refine goals
2. **Calls PlanBuilder** via `create_plan` tool when ready
3. **Presents** the plan and waits for user approval
4. **Coordinates** execution by queuing tasks for workers

**Key Insight:** Orchestrator coordinates + chats. PlanBuilder creates the structured plan.

**Current State:**
```typescript
// AgentManagerV2: Hardcoded orchestration
if (allDepsComplete) this.queuePlannedTask(task); // ← Procedural
```

**Target State:**
```typescript
// Orchestrator: Chat → PlanBuilder → Approval → Execute
User: "Build a blog with comments"
Orchestrator: "Tech stack preference?"
User: "Next.js + MongoDB"
Orchestrator: [calls create_plan tool] → PlanBuilder agent runs
PlanBuilder: Returns TaskPlan JSON
Orchestrator: "Here's the plan: [...]. Approve?"
User: [clicks Approve]
→ Tasks stored in MemoryManager → Workers execute
```

---

## Conversational Planning Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  User ──"I want X"──▶ Orchestrator (chat mode)              │
│                            │                                 │
│                            ▼                                 │
│                    Clarifying questions                      │
│                            │                                 │
│                            ▼                                 │
│              [create_plan tool call]                         │
│                            │                                 │
│                            ▼                                 │
│                    PlanBuilder agent                         │
│                            │                                 │
│                            ▼                                 │
│                    TaskPlan JSON                             │
│                            │                                 │
│                            ▼                                 │
│  Orchestrator: "Here's the plan. Approve?"                  │
│                            │                                 │
│                            ▼                                 │
│  User ◀──────── Plan shown in UI ─────────▶ [Approve/Revise] │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ User Approves
┌─────────────────────────────────────────────────────────────┐
│                   EXECUTION PHASE                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  MemoryManager.storeTasks(plan.tasks)                       │
│                            │                                 │
│                            ▼                                 │
│  Orchestrator: [calls queue_task for ready tasks]           │
│                            │                                 │
│                            ▼                                 │
│  RoleTaskQueue receives tasks                               │
│                            │                                 │
│                            ▼                                 │
│  Workers poll and execute                                    │
│                            │                                 │
│                            ▼                                 │
│  Orchestrator monitors via tools (get_status, get_context)  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Responsibilities

| Agent | Role | Output |
|-------|------|--------|
| **Orchestrator** | Chat + Coordinate | Conversations, tool calls |
| **PlanBuilder** | Create structured plans | TaskPlan JSON (structured output) |
| **Workers** | Execute tasks | Task outputs, artifacts |

---

## Integration Points

| Component | Integration | Status |
|-----------|-------------|--------|
| **InternalAgent** | Orchestrator IS an InternalAgent | ✅ Ready |
| **PlanBuilder** | Called via `create_plan` tool | ✅ Ready |
| **MemoryManager** | Store tasks, outputs, dependencies, context + internal RoleTaskQueue | ⚠️ Exists, needs v1.1 update |
| **WorkerPool** | Workers execute queued tasks | ✅ Ready |
| **AgentFactory** | Creates Orchestrator + PlanBuilder | ✅ Ready |
| **ArtifactStore** | Store agent outputs | ❌ Not implemented |
| **SkillRegistry** | Skill-enhanced tools | ✅ Ready (not integrated) |

---

## Architecture: Hybrid Approval Protocol

### Orchestrator Behavior

| Phase | Mode | Tools Available |
|-------|------|-----------------|
| **Requirements** | Chat + Tool | `ask_user` |
| **Planning** | Tool Call | `create_plan` (invokes PlanBuilder) |
| **Awaiting Approval** | Paused | (waiting for user) |
| **Execution** | Tool Calling | `queue_task`, `get_status`, `get_context`, `replan` |

### Key Tools

| Tool | Purpose | When Used |
|------|---------|-----------|
| `create_plan` | Call PlanBuilder agent to create structured TaskPlan | When Orchestrator has enough info |
| `ask_user` | Request clarification | During planning conversation |
| `queue_task` | Add approved task to RoleTaskQueue | After approval |
| `get_status` | Check task/worker status | During execution |
| `get_context` | Get outputs from completed tasks | For dependent tasks |
| `replan` | Re-enter planning mode with failure context | On task failure |

### Approval Flow

```typescript
// 1. User chats with Orchestrator
orchestrator.handleMessage("Build a blog with Next.js");

// 2. Orchestrator asks questions, gathers requirements...

// 3. Orchestrator decides ready → calls create_plan tool
// create_plan tool invokes PlanBuilder agent internally:
const createPlanTool = tool(
  async (requirements: PlanRequirements) => {
    // Invoke PlanBuilder agent (structured output mode)
    const plan = await planBuilder.invoke({
      goal: requirements.goal,
      context: requirements.context,
      roles: context.teamRoles
    });
    
    // Emit for UI approval
    context.events.emit('plan:proposed', plan);
    return { status: 'awaiting_approval', taskCount: plan.tasks.length };
  },
  { name: 'create_plan', schema: PlanRequirementsSchema }
);

// 4. UI shows plan with Approve/Revise buttons

// 5. User clicks Approve → system calls:
await orchestrator.approvePlan();
// → memoryManager.storeTasks(plan.tasks)
// → taskQueue.queueTask(readyTasks)

// 6. User clicks Revise → continues conversation:
orchestrator.handleMessage("Add an SEO optimization task");
// → Orchestrator refines requirements, calls create_plan again
```

---

## Orchestrator Tools (Revised)

### Phase 1: Core Orchestration (MVP - v1.0)
| Tool | Purpose | Invokes Agent? |
|------|---------|----------------|
| `create_plan` | Call PlanBuilder agent to create TaskPlan | ✅ PlanBuilder |
| `get_status` | Check task/plan status | No |
| `get_context` | Get dependency outputs | No |

**v1.1 Note:** Execution is event-driven. After approval, tasks auto-queue via MemoryManager's internal RoleTaskQueue. No `queue_task` tool needed.

### Phase 2: Execution Control
| Tool | Purpose |
|------|---------|
| `replan` | Re-enter planning with failure context |
| `pause_execution` | Stop queuing new tasks |
| `resume_execution` | Continue execution |

### Phase 3: Worker Collaboration
| Tool | Purpose |
|------|---------|
| `ask_user` | Request user clarification |
| `notify_user` | Send status update |
| `request_approval` | Request approval for artifact |

---

## Tool Context Injection

**Pattern: Closure Context** (chosen approach)

```typescript
interface OrchestratorContext {
  memoryManager: MemoryManager;  // Now includes internal RoleTaskQueue (v1.1)
  workerPool: WorkerPool;        // For task dispatch (v1.1)
  events: EventEmitter;
  teamRoles: string[];
  planBuilder: InternalAgent;    // PlanBuilder agent instance
}

function createOrchestratorTools(context: OrchestratorContext) {
  const createPlanTool = tool(
    async (requirements: PlanRequirements) => {
      // Call PlanBuilder agent (structured output mode)
      const plan = await context.planBuilder.invoke({
        messages: [{
          role: 'user',
          content: `Goal: ${requirements.goal}\nContext: ${requirements.context}\nAvailable roles: ${context.teamRoles.join(', ')}`
        }]
      });
      
      context.events.emit('plan:proposed', plan);
      return { status: 'awaiting_approval', taskCount: plan.tasks.length };
    },
    {
      name: 'create_plan',
      description: 'Create a task plan when you have enough information from the user',
      schema: PlanRequirementsSchema
    }
  );

  const getStatusTool = tool(
    async ({ taskId }) => {
      const task = context.memoryManager.getTask(taskId);
      return { 
        status: task?.status, 
        output: task?.output,
        queueMetrics: context.memoryManager.getMetrics() // v1.1: queue performance
      };
    },
    {
      name: 'get_status',
      schema: z.object({ taskId: z.string().optional() })
    }
  );

  return [createPlanTool, getStatusTool, ...];
}
```

---

## Orchestrator System Prompt

```
You are an orchestration agent that helps users accomplish goals by coordinating a team of AI agents.

AVAILABLE ROLES: {{roles}}

YOUR WORKFLOW:
1. UNDERSTAND: Chat with the user to understand their goal
2. CLARIFY: Ask questions if requirements are unclear
3. PLAN: When ready, call create_plan to generate a detailed task breakdown
4. ITERATE: If user requests changes, refine requirements and create_plan again
5. EXECUTE: After approval, tasks execute automatically (v1.1: event-driven)

WHEN TO CALL create_plan:
- You understand the user's goal
- You know the tech stack / approach  
- You have enough detail to describe tasks for roles

If unsure, ask ONE clarifying question at a time.

You do NOT create plans directly. You call the create_plan tool which invokes a specialized planning agent.
```

---

## Implementation Order

### v1.0 (Complete)
1. **PlanBuilder YAML definition** with structured output schema
2. **Orchestrator YAML definition** with system prompt
3. **`create_plan` tool** (invokes PlanBuilder agent)
4. **Plan approval flow** (events + state machine)
5. **Integration with AgentManagerV2**
6. **UI: Plan approval component**
7. **Testing: Conversational planning E2E**

### v1.1 (In Progress - See [feature_implementation_planning.md](v1.1/feature_implementation_planning.md))
1. **Integrate RoleTaskQueue into MemoryManager** (~1.5h)
2. **Update OrchestratorService** to use event-driven execution (~1h)
3. **Plan Persistence** (FilePlanStore) (~1.5h)
4. **Artifact Registry** for context injection (~1.5h)
5. **Progress Monitoring** (real-time events) (~1h)
6. **Testing** (~2h)

**Total:** ~8 hours  
**Performance:** 15x faster (0ms dispatch latency vs 1000ms polling)

---

## Future Enhancements

### v2: Dynamic Plan Revision
Tasks can be revised mid-execution:
- **In-queue updates**: Modify task before worker picks it up
- **In-progress interruption**: Signal worker to stop, update task, restart
- **Dependency recalculation**: Propagate changes to dependent tasks
- **Partial rollback**: Undo completed tasks if plan fundamentally changes

Flow:
```
User: "Actually, use PostgreSQL instead of MongoDB"
Orchestrator: [calls revise_plan tool]
→ Update pending tasks in MemoryManager
→ Signal in-progress workers to pause
→ Present revised plan for approval
→ Resume with updated tasks
```

### Option C: Agent Pool (Performance)
Pre-warm Orchestrator for faster response times.

### Shadow Workspaces (Delegation)
Git worktrees for human delegation of workers.
- Library: `simple-git` with worktree support
- Each delegatee gets isolated workspace
- Clean merge on completion

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Orchestrator = Planner? | ❌ No. Orchestrator calls PlanBuilder agent via `create_plan` tool |
| Chat before planning? | ✅ Yes, conversational requirements gathering |
| How to trigger plan? | ✅ LLM decides when ready → calls `create_plan` tool |
| Approval flow? | ✅ Explicit (Approve/Revise buttons) |
| Context injection? | ✅ Closure pattern with PlanBuilder agent instance |
