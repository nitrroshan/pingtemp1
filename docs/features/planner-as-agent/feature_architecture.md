# Planner as Agent — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** A5  
**Priority:** **CRITICAL** — The planner is the most important component in the system.

---

## Why the Planner Is Everything

A leader leads the organization. **The planner IS that leader.** Every decision flows from the plan — what to build, who builds it, what risks to watch, when to pivot. A bad executor with a great plan can still deliver. A great executor with a bad plan is just efficiently building the wrong thing.

The planner must be **powerful enough to:**
- Decompose ambiguous goals into concrete work
- Assess risks before committing resources
- Set the course for every worker agent (the "employees")
- Detect when a plan is failing and adapt — replan, reprioritize, escalate
- Balance speed vs. quality vs. risk for each decision

This is not just a task list generator. This is the **strategic brain** of every team.

---

## Overview

The **Planner is the top-level agent** — the brain that receives goals, reasons about them, creates plans, and drives execution. The **Orchestrator becomes a tool** the planner calls to dispatch tasks, check status, and coordinate workers. This inverts the current relationship where OrchestratorService owns planning.

### Current State
- `OrchestratorService` owns both planning AND orchestration
- `PlanBuilder` is a sub-agent called by the orchestrator
- Planning and execution tightly coupled in one service
- Can't swap planning strategy without modifying orchestrator

### Target State
- **Planner Agent** = top-level agent that receives the user's goal
- Planner reasons, breaks down the goal, decides strategy
- Planner calls `orchestrate(plan)` tool to hand off execution
- Orchestrator is a **tool/service** that manages workers, tracks tasks, reports status
- Multiple planner agents possible: simple-list, DAG, iterative, human-in-the-loop
- Orchestrator is pluggable — planner doesn't care how tasks are dispatched

```
User Goal
  │
  ▼
Planner Agent (the brain / leader)
  ├── instructions: "You are a project planner. Research before you plan..."
  ├── model: configurable (gpt-4o, claude, etc.)
  └── tools:
        │
        │  USER INTERACTION TOOLS (talk with the user):
        ├── ask_user(question)       → Human: ask clarifying question, block until answer
        ├── tell_user(message)       → Human: send update/finding (fire-and-forget)
        ├── discuss_approach(options) → Human: present trade-offs, get user's choice
        │
        │  KNOWLEDGE TOOLS (research before planning):
        ├── research_domain(topic)   → LLM/RAG: deep-dive on architecture, patterns, pitfalls
        ├── analyze_requirements(goal)→ LLM: decompose into components, risks, unknowns
        ├── get_team_capabilities()  → Registry: what each role can actually do
        ├── get_context(query)       → L2: fetch relevant prior work, past failures
        │
        │  EXECUTION TOOLS (drive the orchestrator):
        ├── submit_plan(plan)        → Orchestrator: accept plan, start execution
        ├── get_status(filter?)      → Orchestrator: query task states, progress
        ├── get_blocked()            → Orchestrator: what's stuck and why
        ├── get_critical_path()      → Orchestrator: longest dependency chain
        ├── cancel_task(taskId)      → Orchestrator: stop a running task
        ├── request_approval(plan)   → Human: pause for approval
        ├── search_agents(capability)→ Registry: find available agents/roles
        │
        │  PLAN MUTATION TOOLS (update plans mid-flight):
        ├── update_task(taskId, patch)→ Orchestrator: modify task description, role, priority, deps
        ├── add_tasks(tasks[])       → Orchestrator: inject new tasks into active plan (with deps)
        ├── remove_task(taskId)       → Orchestrator: remove pending task + cascade dep updates
        ├── reprioritize(taskId, pri) → Orchestrator: change task priority (affects dispatch order)
        ├── reassign_task(taskId,role)→ Orchestrator: move task to different worker role
        └── replan(reason, newPlan)   → Orchestrator: replace remaining plan (cancel pending, submit new)

Orchestrator (the task master / execution engine)
  ├── IS the task master — owns task lifecycle end-to-end
  ├── Receives plan → stores tasks → resolves deps → dispatches to workers
  ├── Single authority for task state (single writer, many readers)
  ├── Exposes query tools for planner (status, blocked, critical path)
  ├── Reports progress/failures back to planner
  └── Doesn't decide WHAT to do — only HOW to execute
  │
  │  INTERNALLY contains:
  │  ├── TaskStore        — task CRUD, deps, status lifecycle (the "guts")
  │  ├── DependencyResolver — DAG resolution, ready-task detection
  │  ├── WorkerPool       — dispatch tasks to worker agents by role
  │  └── EventBus         — progress/failure events → planner + frontend
  │
  │  Task data stored in shared store (MongoDB)
  │  → Planner queries via orchestrator tools (authoritative)
  │  → Frontend/CLI reads from DB directly (read-only, dashboards)
  │  → Workers report back through orchestrator
```

---

## Planner Intelligence: Research-First Planning

### The Problem with Structured Output Planners

A structured-output planner is an LLM call with a JSON schema. It receives a goal, generates a plan, done. No research, no domain analysis, no reasoning about trade-offs. It's like asking someone to architect a building without visiting the site, studying the soil, or checking local building codes.

**What a structured-output planner does:**
```
Goal → LLM(systemPrompt, schema) → JSON plan
```
One shot. No tools. No iteration. The plan quality is entirely bounded by whatever the model already knows, filtered through a rigid schema.

**What an agentic planner does:**
```
Goal → Clarify with user → Research domain → Analyse requirements
     → Assess team capabilities → Discuss findings with user
     → Reason about trade-offs → Build dependency graph → Submit plan
     → Monitor execution → Update user → Replan when needed
```
Multiple LLM calls with tools in between. The planner gathers real knowledge AND user intent before committing to a plan.

### The Planner's Cognitive Workflow

The planner follows a mandatory multi-step workflow. It MUST NOT skip straight to plan generation.

```
┌─────────────────────────────────────────────────────────┐
│                PLANNER COGNITIVE LOOP                    │
│                                                         │
│  1. CLARIFY                                             │
│     │  Talk to the user. Ask about scope, constraints,  │
│     │  preferences, priorities. Don't assume — ask.     │
│     │  Can ask multiple rounds until goal is clear.     │
│     ▼                                                   │
│  2. RESEARCH                                            │
│     │  Call research tools to understand the domain.    │
│     │  Topics: architecture patterns, tech stack,       │
│     │  common pitfalls, prior art, best practices.      │
│     │  Can call multiple times for different angles.    │
│     ▼                                                   │
│  3. ANALYSE                                             │
│     │  Decompose the goal into components.              │
│     │  Identify hard vs soft constraints.               │
│     │  Surface risks, unknowns, assumptions.            │
│     ▼                                                   │
│  4. DISCUSS                                             │
│     │  Present findings and analysis to the user.       │
│     │  Share trade-offs, risks, proposed approach.      │
│     │  Get feedback before committing to a plan.        │
│     ▼                                                   │
│  5. ASSESS TEAM                                         │
│     │  Query available roles and their capabilities.    │
│     │  Match task types to roles. Identify gaps.        │
│     ▼                                                   │
│  6. REASON                                              │
│     │  Weigh trade-offs (speed vs quality vs risk).     │
│     │  Choose an approach with explicit rationale.      │
│     │  The planner's chain-of-thought is visible in L2. │
│     ▼                                                   │
│  7. PLAN                                                │
│     │  Call submit_plan with a dependency-aware DAG.    │
│     │  Inject research findings into task context.notes │
│     │  so workers get domain knowledge for free.        │
│     ▼                                                   │
│  8. MONITOR & ADAPT                                     │
│     │  Read execution progress via orchestrator tools.  │
│     │  Update user on progress, ask for input on blocks.│
│     │  Replan if tasks fail or scope changes.           │
│     │                                                   │
│     │  USER UPDATES (proactive, during execution):      │
│     │  • tell_user(progress) — share milestones, task   │
│     │    completions, interesting findings from workers  │
│     │  • tell_user(warning) — flag risks, delays, cost  │
│     │  • ask_user(decision) — when planner needs input: │
│     │    task failed (retry/skip/replan?), scope creep   │
│     │    detected, multiple valid approaches, budget     │
│     │    concerns, quality vs speed trade-offs           │
│     │                                                   │
│     │  PLAN MUTATIONS (mid-flight adjustments):         │
│     │  • update_task — fix description, change criteria │
│     │  • add_tasks — discovered new work needed         │
│     │  • remove_task — no longer relevant               │
│     │  • reprioritize — shift urgency based on findings │
│     │  • reassign_task — wrong role, move to better fit │
│     │  • replan — major pivot, replace remaining plan   │
│     └──────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────────┘
```

### Planner Tools: Three Categories

The planner's tools fall into three groups:

**User Interaction Tools** — how the planner talks with the user:

| Tool | Purpose | When Used |
|---|---|---|
| `ask_user` | Ask the user a clarifying question. Returns user's response. Can ask about scope, constraints, preferences, priorities, ambiguities. Blocks until user responds. | Step 1 — before research, whenever ambiguous |
| `tell_user` | Send the user an informational message (progress update, findings summary, status report). Does NOT block — fire-and-forget. | Any step — share findings, report progress |
| `discuss_approach` | Present the user with trade-offs or options and ask them to choose. Returns user's choice + rationale. Use when multiple valid approaches exist. | Step 4 — after research, before committing to plan |

**Knowledge Tools** — how the planner learns before planning:

| Tool | Purpose | When Used |
|---|---|---|
| `research_domain` | Query an LLM/knowledge source for domain expertise. Architecture patterns, tech stack analysis, best practices, pitfalls. Can be called multiple times with different topics. | Step 2 — always before planning |
| `analyze_requirements` | Decompose a goal into components, constraints, risks, and unknowns. Returns structured analysis. | Step 3 — after initial research |
| `get_team_capabilities` | Query available roles and what each can do. Maps role → skills/tools/limitations. | Step 5 — before assigning tasks to roles |
| `get_context` | Search L2 shared memory for prior work, past plans, prior failures, related outputs. | Steps 1-5 — whenever prior context exists |

**Execution Tools** — how the planner drives the orchestrator:

| Tool | Purpose | When Used |
|---|---|---|
| `submit_plan` | Submit a complete task plan to the orchestrator for approval and execution. | Step 7 — only after research, discussion, and analysis |
| `get_status` | Query current task states, progress, completions, failures. | Step 8 — during monitoring |
| `get_blocked` | Get blocked tasks and their reasons. | Step 8 — when tasks stall |
| `get_critical_path` | Get the longest dependency chain (bottleneck). | Steps 6-8 — for scheduling reasoning |
| `cancel_task` | Cancel a running or pending task. | Step 8 — during replanning |
| `request_approval` | Pause and request human approval before proceeding. | Any step — when stakes are high |
| `search_agents` | Look up agent registry for available capabilities/roles. | Step 5 — team assessment |

**Plan Mutation Tools** — how the planner updates plans mid-execution:

| Tool | Purpose | When Used |
|---|---|---|
| `update_task` | Modify a task's description, acceptance criteria, assigned role, priority, or dependencies. Only works on `pending` or `ready` tasks (not `in_progress` — use `cancel_task` + re-add for those). | Step 8 — when monitoring reveals a task needs adjustment |
| `add_tasks` | Inject new tasks into the active plan. New tasks can depend on existing tasks and vice versa (existing pending tasks can be updated to depend on new ones). Orchestrator resolves the new DAG. | Step 8 — when execution reveals missing work ("we also need a migration script") |
| `remove_task` | Remove a `pending` or `ready` task from the plan. Cascades: any task depending on the removed task has that dependency dropped. If a downstream task's only dependency was the removed one, it becomes ready. | Step 8 — when a task is no longer needed (scope reduction, duplicate, superseded) |
| `reprioritize` | Change a task's priority. Re-sorts the dispatch overflow queue immediately via `PriorityQueue.updatePriority()` — higher priority tasks jump ahead. **Only the planner can reprioritize** — user can only start ready tasks, not reorder them. **No preemption:** in-progress tasks are not interrupted for higher-priority work; the new priority takes effect at next dispatch. | Step 8 — when urgency shifts ("do the API first, frontend can wait") |
| `reassign_task` | Move a pending/ready task to a different worker role. Updates the Orchestrator's dispatch routing. | Step 8 — when the planner realizes a task fits a different role better |
| `replan` | Nuclear option: cancel all `pending`/`ready` tasks, submit a new plan for the remaining work. In-progress tasks continue unless explicitly cancelled first. Takes a `reason` string logged to L2. | Step 8 — major pivot after failure, scope change, or user decision |

### Plan Mutation Guard Rails

Plan mutations are powerful but dangerous. Every mutation tool enforces guard rails:

| Rule | Why | Tool Affected |
|---|---|---|
| Cannot mutate `in_progress` tasks | Worker is actively executing — changing the task under it causes chaos. Use `cancel_task` first, then re-create. | `update_task`, `remove_task`, `reassign_task` |
| Cannot mutate `completed` tasks | Completed work is done. If the output is wrong, create a new task. | All mutation tools |
| Cannot create dependency cycles | Circular deps deadlock the plan — nothing becomes `ready`. DAG validator rejects and returns the cycle path to the planner. | `add_tasks`, `update_task` (when modifying deps) |
| Cannot assign to nonexistent roles | Role must exist in the registry. Error response includes available roles. | `reassign_task` |
| `replan` requires reason | Every replan decision is logged to L2 for auditability. Why did the plan change? What failed? | `replan` |
| `replan` may require approval | If `plan.metadata.requiresApproval`, replan pauses for human approval before cancelling + re-submitting. | `replan` |
| All mutations emit Socket.IO events | Frontend must stay in sync with plan state. Every mutation fires a typed event (`plan:task_updated`, `plan:tasks_added`, etc.). | All mutation tools |

### MONITOR Phase: User Updates + Plan Adaptation

The planner doesn't go quiet during execution. But it also doesn't **poll**. Polling burns LLM tokens on empty `get_status()` calls while workers are still working. Instead, the planner **suspends** after dispatching tasks and the orchestrator **wakes** it when something happens.

```
MONITOR (suspend/resume — NOT a polling loop):

  1. Planner submits plan → orchestrator dispatches tasks
     │
  2. Planner SUSPENDS (returns, no LLM running, zero tokens)
     │  Orchestrator resolves plannerWakeSignal when:
     │  - Task completes
     │  - Task fails
     │  - Worker stalls/dies
     │  - User sends message
     │  - All tasks done
     │
  3. Planner WAKES (orchestrator injects notifications as system message)
     │  Planner sees: "[SYSTEM] T-001 completed. T-003 failed: API timeout."
     │
  4. ASSESS:
     │  ├── Completions? → tell_user(progress, "Task X done: <summary>")
     │  ├── Failures? → tell_user(warning, "Task X failed: <reason>")
     │  ├── Blocked tasks? → analyze root cause
     │  └── Cost/time? → tell_user(warning, "Budget 70% spent")
     │
  5. DECIDE (does the plan need changing?):
     │  ├── MINOR → update_task / reprioritize / reassign_task
     │  ├── MEDIUM → add_tasks / remove_task
     │  └── MAJOR → ask_user / replan
     │
  6. EXECUTE mutation → DAG re-resolves → dispatch continues
     │
  7. Still tasks running? → SUSPEND again (back to step 2)
     All done? → proceed to completion
```

**Why suspend/resume, not polling:**

| | Polling MONITOR loop | Suspend/Resume |
|---|---|---|
| **Token cost** | Every `get_status()` call costs tokens even when nothing changed | Zero tokens while suspended — only runs when woken |
| **Latency** | Notification lag = poll interval (5-30s) | Instant — orchestrator wakes planner immediately |
| **Implementation** | Planner needs a loop in its prompt (fragile — LLMs drift) | Orchestrator controls wake signal (reliable, code-level) |
| **Scaling** | N plans = N polling loops burning tokens | N plans = N sleeping promises, near-zero resource cost |

### User Interaction Patterns During MONITOR

| Situation | Planner Action | Tool Used | Blocking? |
|---|---|---|---|
| Task completed successfully | Share summary with user | `tell_user(progress)` | No |
| Task failed | Notify user, explain failure | `tell_user(warning)` | No |
| Task failed + multiple recovery options | Ask user to choose: retry/skip/replan | `ask_user` | Yes |
| Execution reveals new work needed | Inform user, add tasks | `tell_user(finding)` + `add_tasks` | No |
| Scope creep detected | Ask user if extra work is in scope | `ask_user` | Yes |
| Budget/cost threshold hit | Warn user, ask if should continue | `tell_user(warning)` + `ask_user` | Yes for ask |
| Worker stalled (watchdog report) | Inform user, decide action | `tell_user(warning)` → `ask_user` if needed | Depends |
| All tasks done | Share completion summary | `tell_user(status)` | No |

### How Domain Knowledge Gets Acquired

The planner is NOT limited to what the base LLM knows. It can acquire domain knowledge through multiple channels:

#### Channel 1: Research Tool (LLM-powered reasoning)

The `research_domain` tool uses a separate focused LLM call to deeply research a specific topic. Unlike the planner's main loop which juggles planning concerns, research calls are narrowly scoped:

```
Planner: research_domain("Next.js App Router architecture patterns for multi-tenant SaaS")

Research Agent (internal LLM call):
  → Returns: routing patterns, middleware auth, data isolation strategies,
     common mistakes (shared state leaks), recommended folder structure,
     performance considerations for server components

Planner absorbs this, then:
  research_domain("PostgreSQL row-level security for multi-tenant data isolation")
  → Returns: RLS patterns, policy examples, migration strategies,
     performance impact, alternatives (schema-per-tenant)
```

This is NOT the same as the planner "thinking harder." It's a dedicated research step that can be backed by different models (cheaper/faster for research, smarter for planning), RAG over documentation, or MCP-connected knowledge bases.

#### Channel 2: MCP Servers (External Knowledge)

MCP servers can provide domain-specific knowledge to the planner:

| MCP Server | Knowledge Domain | Example Queries |
|---|---|---|
| Documentation server | Project/framework docs | "What are the Prisma conventions for this codebase?" |
| Codebase search server | Existing code patterns | "How is authentication handled in this project?" |
| Architecture knowledge server | Domain patterns | "What are the trade-offs of event sourcing vs CRUD?" |
| Stack Overflow / web research | Community knowledge | "Common issues with Next.js ISR and dynamic routes" |
| Internal wiki server | Company-specific practices | "What's our standard API versioning strategy?" |

MCP servers are configured per team or per planner type. A team building financial software gets different knowledge servers than one building a game.

#### Channel 3: L2 Search (Team Memory)

The planner searches L2 for what this team (or past teams) have already learned:

```
l2_search("authentication implementation")
→ Prior task: "Implemented JWT auth with refresh tokens" (from 3 weeks ago)
→ Prior risk: "Rate limiting was flagged but not implemented" (from prior plan)
→ Prior failure: "Worker failed on OAuth integration — missing env vars" (from prior run)
```

This is how the planner gets smarter over time. L2 is cumulative team memory.

#### Channel 4: Agent Registry (Capability Discovery)

The planner queries what agents/roles are available and what they can actually do:

```
search_agents({ capability: "database-migration" })
→ Role: "devops" — has database migration tools, Prisma CLI access
→ Role: "backend" — can write migration code but can't run Prisma CLI

Planner now knows: assign migration EXECUTION to devops, migration CODE to backend
```

### Why Research-First Changes Everything

Without research, a plan is a hallucination structured as JSON. With research, the planner:

| Without Research | With Research |
|---|---|
| Guesses at architecture patterns | Knows which patterns fit the domain |
| Assigns tasks to wrong roles | Matches tasks to actual role capabilities |
| Misses dependencies | Understands technology interdependencies |
| Ignores risks | Identifies risks from domain knowledge + prior failures |
| Generic task descriptions | Tasks include domain context workers can use |
| Workers figure it out alone | Workers get research findings in `context.notes` |

The last row matters most: **research flows into tasks**. When the planner discovers that "Next.js App Router requires server components for data fetching," it writes that into the relevant task's `context.notes`. The worker doesn't start from zero — it starts with curated domain knowledge.

```
Task: "Implement API routes for user management"
context.notes: |
  Research findings:
  - Use Next.js Route Handlers (app/api/) not Pages API routes
  - RLS on PostgreSQL recommended for multi-tenant isolation
  - Prior team hit rate limiting issues — implement from day one
  - Auth middleware pattern: middleware.ts at app root, not per-route
```

### Planner ≠ Single Model

The planner's cognitive steps don't all need the same model:

| Step | Model Choice | Rationale |
|---|---|---|
| Research | Fast/cheap model (gpt-4o-mini, haiku) | High volume queries, breadth over depth |
| Analysis | Smart model (gpt-4o, sonnet) | Needs decomposition reasoning |
| Team assessment | Cheap lookup (no LLM needed) | Registry query, pure data |
| Plan generation | Smartest model available (o1, opus) | Critical decision, highest quality needed |
| Monitoring | Fast model or rule-based | Frequent checks, pattern matching |

This is configurable per planner type. A simple list planner might use gpt-4o-mini throughout. A high-stakes planner might use o1 for planning and haiku for monitoring.

---

## Why Orchestrator IS the Task Master (Not Separate)

### The False Separation

The previous design had TaskMaster (state) + Orchestrator (routing) as two things. But look at what happens in practice:

```
❌ Old: Two things always used together
   Orchestrator receives plan → calls TaskMaster.create_task()
   Orchestrator polls TaskMaster.get_ready_tasks() → dispatches
   Worker completes → calls TaskMaster.set_output() → Orchestrator dispatches next
   Planner queries → TaskMaster.get_status()
   
   Every operation touches BOTH. They're one thing pretending to be two.
```

```
✅ New: One thing with clean internal structure
   Orchestrator receives plan → stores tasks internally → dispatches
   Worker completes → reports to Orchestrator → it updates state + dispatches next
   Planner queries → asks Orchestrator (the authority on task state)
   
   One service. One authority. Clean.
```

### The Architectural Principle

This is the **"single writer, multiple readers"** pattern:

| Role | Writes Task State | Reads Task State |
|---|---|---|
| **Orchestrator** | ✅ Yes — the ONLY writer | ✅ (it's the owner) |
| **Planner** | ❌ Never writes directly | ✅ Via orchestrator tools |
| **Workers** | ❌ Report completion TO orchestrator | ✅ Read own assigned task |
| **Frontend/CLI** | ❌ Never | ✅ Read from DB (dashboards) |

Why single writer matters:
- **No race conditions** — only orchestrator transitions task status
- **Consistent state** — no two things updating the same task
- **Clear authority** — "who changed this task?" → always the orchestrator
- **Simpler debugging** — one place to log all state transitions

### What the Orchestrator Manages (Internally)

The orchestrator's internal `TaskStore` is NOT exposed as a separate tool. It's an implementation detail, like a database repository inside a service:

```typescript
class Orchestrator {
  // Internal — not exposed
  private taskStore: TaskStore;       // MongoDB collection for tasks
  private depResolver: DependencyResolver;
  private workerPool: WorkerPool;
  
  // Exposed as tools to the planner
  async orchestrate(plan: Plan): Promise<void> {
    // Store tasks, resolve deps, start dispatching
    for (const task of plan.tasks) {
      await this.taskStore.create(task);
    }
    this.depResolver.resolveReady();
    this.dispatchReadyTasks();
  }
  
  async getStatus(filter?: TaskFilter): Promise<TaskStatus[]> {
    return this.taskStore.query(filter);
  }
  
  async getBlocked(): Promise<BlockedTask[]> {
    return this.depResolver.getBlocked();
  }
  
  async getCriticalPath(): Promise<string[]> {
    return this.depResolver.getCriticalPath();
  }
  
  // Called by workers (not by planner)
  async reportCompletion(taskId: string, output: TaskOutput): Promise<void> {
    await this.taskStore.complete(taskId, output);
    this.depResolver.resolveReady();  // may unblock downstream tasks
    this.dispatchReadyTasks();
    this.notifyPlanner({ type: 'task_complete', taskId, output });
  }
  
  async reportFailure(taskId: string, report: WorkerFailureReport): Promise<void> {
    // See "Worker Failure Reporting" section for full implementation
    // Includes: error classification, auto-retry for transients, structured 
    // planner notification, downstream blocking, retry-from-scratch
    await this.onTaskFailed(report);
  }

  // --- Plan Mutation Tools (called by planner mid-execution) ---
  
  async updateTask(taskId: string, patch: TaskPatch): Promise<void> {
    const task = await this.taskStore.get(taskId);
    if (task.status === 'in_progress' || task.status === 'completed')
      throw new Error(`Cannot update ${task.status} task. Cancel first.`);
    await this.taskStore.update(taskId, patch);
    if (patch.dependencies) this.depResolver.resolveReady(); // deps changed → re-resolve
    this.events.emit('plan:task_updated', { taskId, patch });
  }

  async addTasks(tasks: PlanTask[], newDepsOnExisting?: Map<string, string[]>): Promise<void> {
    for (const task of tasks) {
      await this.taskStore.create(task);
    }
    if (newDepsOnExisting) {
      for (const [existingId, newDeps] of newDepsOnExisting) {
        await this.taskStore.addDependencies(existingId, newDeps);
      }
    }
    this.depResolver.validateDAG(); // throws on cycle
    this.depResolver.resolveReady();
    await this.dispatchReadyTasks();
    this.events.emit('plan:tasks_added', { taskIds: tasks.map(t => t.id) });
  }

  async removeTask(taskId: string): Promise<void> {
    const task = await this.taskStore.get(taskId);
    if (task.status === 'in_progress')
      throw new Error('Cannot remove in_progress task. Cancel first.');
    // Cascade: drop from all downstream dependency lists
    await this.taskStore.removeDependencyFromAll(taskId);
    await this.taskStore.delete(taskId);
    this.depResolver.resolveReady(); // may unblock downstream tasks
    await this.dispatchReadyTasks();
    this.events.emit('plan:task_removed', { taskId });
  }

  async reprioritize(taskId: string, priority: TaskPriority): Promise<void> {
    await this.taskStore.update(taskId, { priority });
    // PriorityQueue.updatePriority() re-heapifies in place — no separate resortOverflowQueue() needed
    this.workerPool.overflowQueue.updatePriority(taskId, priority);
    this.events.emit('plan:task_reprioritized', { taskId, priority });
  }

  // Design decision: NO PREEMPTION
  // When a critical task becomes ready but all worker slots are full, it waits in the
  // overflow queue (sorted by priority). We do NOT cancel a running lower-priority task
  // to make room. Reasons:
  // 1. Cancelling mid-execution wastes all work done so far (retry from scratch)
  // 2. The running task may be close to completion
  // 3. Preemption logic is complex and error-prone
  // 4. maxConcurrentWorkers is configurable — increase it if bottlenecked
  // If truly urgent: user/planner can cancel_task the low-priority work explicitly.

  async reassignTask(taskId: string, newRole: string): Promise<void> {
    if (!this.workerPool.hasRole(newRole))
      throw new Error(`Role "${newRole}" not found. Available: ${this.workerPool.getRoles().join(', ')}`);
    const task = await this.taskStore.get(taskId);
    if (task.status === 'in_progress')
      throw new Error('Cannot reassign in_progress task. Cancel first.');
    await this.taskStore.update(taskId, { assignedRole: newRole });
    this.events.emit('plan:task_reassigned', { taskId, newRole });
  }

  async replan(reason: string, newPlan: Plan): Promise<void> {
    // Cancel all pending/ready tasks (in_progress continue unless cancelled separately)
    const pending = await this.taskStore.query({ status: ['pending', 'ready'] });
    for (const task of pending) {
      await this.taskStore.cancel(task.id);
    }
    // Log replan decision to L2
    await this.l2.write({ type: 'replan_decision', reason, oldTasksCancelled: pending.length });
    // Submit new plan
    await this.orchestrate(newPlan);
    this.events.emit('plan:replanned', { reason, newPlanId: newPlan.id, cancelledCount: pending.length });
  }
}
```

### Analogy

Think of a **construction site**:
- **Planner** = the architect. Designs the building, decides what gets built in what order.
- **Orchestrator** = the site foreman / task master. Receives blueprints. Knows every task, who's assigned, what's blocked, what's done. Dispatches workers. Tracks everything. Reports progress to the architect.
- **Workers** = the tradespeople. Do the actual work. Report back to the foreman.

You'd never have a separate "TaskTracker" person standing between the foreman and his clipboard. The foreman IS the task tracker. The tracking is part of his job.

---

## Architecture Options

### Option A: Orchestrator as Event-Driven Runtime (Recommended)

**The key insight:** The Orchestrator is not just a "tool" — it's the **runtime that hosts everything**. It's always alive, reactive, event-driven. It spawns the planner, spawns workers, and exposes its capabilities as tools to the agents it hosts.

**Implementation:** Orchestrator is a persistent service (event loop). When a goal arrives, it spawns a planner agent, giving it orchestrator-backed tools. When the planner produces a plan, the orchestrator stores tasks, spawns workers, and feeds events back to the planner.

```
                         ┌─────────────────────────────────────────────┐
                         │         ORCHESTRATOR (the runtime)          │
                         │         Always alive. Event-driven.         │
                         │                                             │
  User Goal ───────────▶ │  on(goal:received)                         │
                         │    └── spawn Planner Agent                  │
                         │         └── inject tools: orchestrate,     │
                         │             get_status, get_blocked, etc.   │
                         │                                             │
  Planner calls ───────▶ │  on(plan:submitted)                        │
  orchestrate(plan)      │    ├── store tasks in TaskStore             │
                         │    ├── resolve dependencies                 │
                         │    └── dispatch ready tasks → spawn Workers │
                         │                                             │
  Worker reports ──────▶ │  on(task:completed)                        │
  completion             │    ├── update TaskStore                     │
                         │    ├── resolve downstream deps              │
                         │    ├── dispatch newly ready tasks           │
                         │    └── notify Planner (event or tool return)│
                         │                                             │
  Worker reports ──────▶ │  on(task:failed)                           │
  failure                │    ├── update TaskStore                     │
                         │    └── notify Planner → planner decides:   │
                         │         replan / retry / escalate / abort   │
                         │                                             │
  Planner calls ───────▶ │  on(replan:submitted)                      │
  orchestrate(newPlan)   │    ├── cancel affected tasks               │
                         │    ├── store new tasks                      │
                         │    └── dispatch ready tasks                 │
                         │                                             │
  All tasks done ──────▶ │  on(execution:complete)                    │
                         │    └── notify Planner → planner confirms   │
                         │         goal met or requests more work      │
                         └─────────────────────────────────────────────┘
```

**The chicken-and-egg resolved:**
- Orchestrator **spawns** the planner (gives it life)
- Planner **calls** orchestrator tools (uses its capabilities)
- This is like Express **spawning** a route handler, and the handler **calling** `res.send()`. Express is the host, but the handler drives the logic.

```typescript
class Orchestrator {
  // Internal components
  private taskStore: TaskStore;
  private depResolver: DependencyResolver;
  private workerPool: WorkerPool;
  private events: EventBus;

  // --- Lifecycle: Orchestrator brings agents to life ---

  async handleGoal(goal: string, teamConfig: TeamConfig): Promise<void> {
    // 1. Orchestrator spawns the planner — gives it tools into itself
    const planner = new Agent({
      id: `planner-${teamConfig.id}`,
      model: teamConfig.plannerModel || 'azure/gpt-4o',
      instructions: teamConfig.plannerPrompt || defaultPlannerPrompt,
      tools: {
        orchestrate:     this.createOrchestrateTool(),
        get_status:      this.createStatusTool(),
        get_blocked:     this.createBlockedTool(),
        get_critical_path: this.createCriticalPathTool(),
        cancel_task:     this.createCancelTool(),
        request_approval: this.createApprovalTool(),
        search_agents:   this.createAgentSearchTool(),
        // L2 tools injected separately
        ...this.l2Tools,
      },
    });

    // 2. Start the planner — it now drives everything
    await planner.generate(`Goal: ${goal}`);
    // Planner will call orchestrate() when it has a plan
    // Orchestrator reacts to each tool call
  }

  // --- Reactive: Orchestrator responds to events ---

  private async onPlanSubmitted(plan: Plan): Promise<void> {
    for (const task of plan.tasks) {
      await this.taskStore.create(task);
    }
    this.depResolver.resolveReady();
    await this.dispatchReadyTasks();
  }

  private async dispatchReadyTasks(): Promise<void> {
    const ready = await this.taskStore.getReady();
    for (const task of ready) {
      // Orchestrator spawns worker — gives it life
      const worker = await this.workerPool.spawn(task.assignedRole, {
        tools: [...this.coreWorkerTools, ...task.roleTools],
        workspace: this.createWorkspace(task.id),  // L1 per task
      });
      
      await this.taskStore.updateStatus(task.id, 'in_progress');
      
      // Worker executes, orchestrator listens
      worker.on('complete', (output) => this.onTaskCompleted(task.id, output));
      worker.on('failure', (report: WorkerFailureReport) => this.onTaskFailed(report));
      
      worker.execute(task);
    }
  }

  private async onTaskCompleted(taskId: string, output: TaskOutput): Promise<void> {
    await this.taskStore.complete(taskId, output);
    this.depResolver.resolveReady();  // may unblock downstream
    await this.dispatchReadyTasks();  // dispatch newly ready tasks
    
    // Check if all tasks done
    if (await this.taskStore.allComplete()) {
      this.events.emit('execution:complete');
    }
  }

  private async onTaskFailed(report: WorkerFailureReport): Promise<void> {
    // Full implementation in "Worker Failure Reporting" section:
    // 1. Update TaskStore with structured failure report
    // 2. Block downstream dependent tasks
    // 3. Auto-retry transient errors (rate_limit, external_service)
    // 4. Escalate non-transient errors to planner via NotificationQueue
    // 5. Notify users via Socket.IO
    // 6. Cleanup worker sandbox and pool slot
  }
}
```

**Pros:**
- Clean lifecycle: Orchestrator hosts everything, agents call back into it
- Fully reactive — no polling, event-driven execution
- Planner has full agency via tools, but orchestrator controls agent lifecycle
- Workers are ephemeral — spawned per task, cleaned up after
- Single process, but ready for distribution (swap events for MCP/HTTP later)

**Cons:**
- Orchestrator class has more responsibility (runtime + task state + dispatch)
- Must be careful about circular tool calls (planner calls tool → tool spawns work → work completes → need to notify planner)

**Effort:** Medium (2-3 weeks)

### Option B: Orchestrator as MCP Server (Future)

**Implementation:** Same event-driven model, but Orchestrator exposes its tools via MCP protocol. External planners can drive it.

**Pros:**
- Any planner (internal, external, human-driven) can connect
- Runs in separate process for isolation

**Cons:**
- Unnecessary complexity for v1
- MCP protocol overhead

**Effort:** Medium (2-3 weeks on top of Option A)

**Recommendation:** Start with Option A. Add MCP interface (Option B) later when we need external planners or cross-process isolation.

## Recommendation

**Option A** — Event-driven runtime. Orchestrator is the host, planner is the brain it spawns, workers are the hands it dispatches. Everything is reactive. No polling.

**Decision Required:** Please choose Option A or B (Option C removed — workflow model doesn't fit).

---

## The Reactive Model: How the Orchestrator Brings Agents to Life

### Who starts whom?

```
System Startup
  │
  ▼
Orchestrator (always alive — singleton per team)
  │
  ├── User sends goal via API/CLI
  │     └── Orchestrator spawns Planner Agent
  │           └── Planner reasons, calls orchestrate(plan) tool
  │                 └── Orchestrator stores tasks, spawns Workers
  │                       └── Workers execute, report completion
  │                             └── Orchestrator updates state
  │                                   └── Orchestrator notifies Planner
  │                                         └── Planner assesses: continue/replan/done
  │
  ├── User sends message to specific agent via API/CLI  
  │     └── Orchestrator routes to correct worker (direct chat mode)
  │
  └── User queries status via API/CLI
        └── Orchestrator returns from TaskStore (no agent needed)
```

### Three Agent Lifecycle Patterns

| Agent | Spawned By | Lives For | Dies When |
|---|---|---|---|
| **Planner** | Orchestrator (on goal received) | Duration of the goal | Goal completed or abandoned |
| **Worker** | Orchestrator (on task dispatched) | Duration of one task | Task completed or failed |
| **Chat Agent** | Orchestrator (on direct message) | Duration of conversation | User ends chat |

### Why Reactive, Not Proactive

The orchestrator doesn't make decisions. It **reacts**:

| Event | Orchestrator Reaction |
|---|---|
| Goal received | Spawn planner, inject tools |
| Plan submitted (via tool call) | Store tasks, resolve deps, spawn workers |
| Task completed | Update state, unblock deps, spawn more workers |
| Task failed | Update state, notify planner (planner decides) |
| Replan submitted | Cancel old tasks, store new tasks, dispatch |
| All tasks complete | Notify planner for final assessment |
| User message | Route to appropriate agent |

What it never does:
- ❌ Decide what tasks to create (planner's job)
- ❌ Decide whether to replan after failure (planner's job)
- ❌ Decide task priority or ordering (planner's job via plan structure)
- ❌ Decide which model or instructions an agent uses (config's job)

---

## Reactive + Proactive: The Orchestrator Needs Both

### Why Pure Reactive Breaks

A purely reactive orchestrator has a critical blind spot: **silence is indistinguishable from death.**

```
❌ Pure Reactive — What Can Go Wrong:

  Orchestrator dispatches task to Worker → Worker starts executing
  ...
  Worker hangs (infinite loop, OOM, container crash, network partition)
  ...
  No event emitted. No failure reported. No completion.
  ...
  Orchestrator waits forever. Planner never gets notified.
  Task is stuck. Downstream tasks never unblock. Goal never completes.
```

Real production systems ALWAYS combine both patterns:

| Pattern | What It Catches | Example |
|---|---|---|
| **Reactive** (events) | Normal completions, explicit failures, results | Worker finishes → emits `task:complete` |
| **Proactive** (scheduled checks) | Silent deaths, stuck tasks, SLA breaches, zombie processes | Worker hasn't reported in 5 minutes → something's wrong |

### The Watchdog Pattern

Every serious distributed system has watchdogs. Temporal has activity heartbeats + timeouts. Kubernetes has liveness/readiness probes. Databases have connection pool sweepers. The orchestrator needs the same.

```
Orchestrator Internal Loops:

1. EVENT LOOP (reactive — the fast path)
   └── Responds to: goal:received, plan:submitted, task:completed, 
       task:failed, message:received
   └── Instant response, event-driven

2. WATCHDOG TIMER (proactive — the safety net)
   └── Runs every N seconds (configurable, e.g., 30s)
   └── Checks:
       ├── Stuck tasks: in_progress for > task.timeout? → mark failed, notify planner
       ├── Dead workers: no heartbeat in > threshold? → kill, reassign task
       ├── Stale plans: plan approved but no tasks dispatched? → alert planner
       ├── Zombie sandboxes: container running but task completed? → cleanup
       └── SLA breach: total elapsed > goal deadline? → notify planner

3. HEARTBEAT LISTENER (worker liveness)
   └── Workers send heartbeat every M seconds while executing
   └── Orchestrator tracks last_heartbeat_at per worker
   └── Watchdog checks: now - last_heartbeat > dead_threshold? → worker is dead
```

### Implementation Design

```typescript
class Orchestrator {
  private watchdogInterval: NodeJS.Timer | null = null;

  // --- Proactive: Watchdog ---
  
  startWatchdog(intervalMs: number = 30_000): void {
    this.watchdogInterval = setInterval(() => this.runWatchdog(), intervalMs);
  }

  private async runWatchdog(): Promise<void> {
    await this.checkStuckWorkers();   // dead + stalled (heartbeat-based)
    await this.checkStalePlans();
    await this.cleanupZombies();
  }

  private async checkStuckWorkers(): Promise<void> {
    // See "Stuck Detection" section below for full implementation
    // Uses heartbeat liveness, NOT fixed timeouts
    const workers = this.workerPool.getActive();
    const now = Date.now();
    
    for (const worker of workers) {
      // Dead: no heartbeat at all
      if (now - worker.lastHeartbeat > this.config.deadThresholdMs) {
        const taskId = worker.currentTaskId;
        this.workerPool.kill(worker.id);
        if (taskId) {
          await this.taskStore.fail(taskId, `Worker died (no heartbeat for ${now - worker.lastHeartbeat}ms)`);
          this.notifyPlanner({
            type: 'worker_died',
            taskId,
            workerId: worker.id,
            suggestion: 'Worker stopped responding. Retry on fresh worker.'
          });
        }
      }
      // Stalled: alive but no progress — handled in checkStuckWorkers (full version)
    }
  }

  // --- Reactive: Event handlers (unchanged) ---
  // on(task:completed), on(task:failed), etc.
  
  // --- Worker heartbeat ---
  
  onWorkerHeartbeat(workerId: string, status: HeartbeatStatus): void {
    this.workerPool.updateHeartbeat(workerId, {
      lastHeartbeat: Date.now(),
      progress: status.progress,        // e.g., "Analyzing file 3 of 10"
      tokensUsed: status.tokensUsed,
    });
  }
}
```

### Worker Heartbeat Contract

Workers MUST send heartbeats while executing. This is non-negotiable for production:

```typescript
class Worker {
  private heartbeatTimer: NodeJS.Timer | null = null;

  async execute(task: Task): Promise<TaskOutput> {
    // Start heartbeating
    this.heartbeatTimer = setInterval(() => {
      this.orchestrator.heartbeat(this.id, {
        progress: this.currentProgress,
        tokensUsed: this.tokenCounter,
      });
    }, 15_000); // every 15 seconds

    try {
      const result = await this.agent.generate(task.description);
      return result;
    } finally {
      clearInterval(this.heartbeatTimer);
    }
  }
}
```

### What Gets Checked (Watchdog Matrix)

**Important:** Agents are NOT request/response. There is no "correct" time for a task to complete. A researcher may take 2 minutes or 30 minutes depending on what it discovers. A developer implementing a feature could take 5 minutes or an hour. **Fixed timeouts are wrong for agent work.**

Instead, we use **heartbeat-based liveness** (is the worker still alive and making progress?) rather than **duration-based timeouts** (has it taken too long?).

| Check | Signal | How It Works | Action | Who Decides |
|---|---|---|---|---|
| **Dead worker** | No heartbeat > threshold | Worker stopped sending heartbeats entirely — process crashed, OOM, container died | Kill sandbox, mark task failed | Planner (retry/replan) |
| **Idle worker** | Heartbeats arriving but `progress` unchanged for N cycles | Worker is alive but stuck in a loop — not making forward progress | Notify planner with context | Planner (intervene/abort/help) |
| **Runaway tokens** | Heartbeat reports cumulative tokens > budget | Worker is burning tokens without converging | Warn planner | Planner (optimize/abort) |
| **Stale plans** | Plan approved, 0 tasks dispatched for > 2min | Orchestrator bug or config issue | Alert planner | Planner (investigate) |
| **Zombie sandboxes** | Container running, task completed/failed | Leftover infrastructure | Cleanup sandbox | Automatic |
| **SLA advisory** | Total goal elapsed > soft deadline | Not a kill signal — just advisory | Inform planner | Planner (cut scope/escalate) |

### Heartbeat = Liveness, Not Timeout

The distinction:

```
❌ WRONG: Fixed timeout
   "Task has been running for 10 minutes → kill it"
   Problem: Maybe the agent is making great progress. 
   You'd kill a developer halfway through implementing a feature.

✅ RIGHT: Heartbeat-based liveness
   "Worker hasn't sent a heartbeat in 60 seconds → it's dead"
   "Worker is heartbeating but progress hasn't changed in 5 heartbeat cycles → it's stuck"
   
   These detect ACTUAL problems, not just slow work.
```

A heartbeat says: "I'm alive and here's what I'm doing." As long as heartbeats arrive and progress changes, the task runs as long as it needs. The watchdog only intervenes when the signal **stops** or the progress **stalls**.

```typescript
interface Heartbeat {
  workerId: string;
  taskId: string;
  timestamp: number;
  
  // Progress indicators — what changed since last heartbeat?
  progress: {
    description: string;         // "Analyzing file 7 of 23"
    stepCount: number;           // LLM steps completed so far
    toolCallsSinceLastBeat: number; // tool calls since last heartbeat
    lastToolName?: string;       // "read_file", "search_workspace"
  };
  
  // Resource usage — for budgeting, not timeouts
  usage: {
    tokensUsed: number;
    wallClockMs: number;
  };
}
```

### Stall Detection Algorithm: Research & Decision

We need an algorithm to decide "how patient should we be with this worker?" Here are the candidates:

| Algorithm | How It Works | Fit for Agent Monitoring |
|---|---|---|
| **Exponential Backoff** | Check intervals double: 30s, 1m, 2m, 4m, 8m | ⚠️ Decent. But grows too fast — after 3 checks you're waiting 4 minutes. Agents can stall for shorter, meaningful periods that get missed. |
| **AIMD (Additive Increase / Multiplicative Decrease)** | Patience grows linearly while agent is healthy (+30s each heartbeat cycle). Drops sharply (÷2) when stall detected. | ✅ **Best fit.** Agent builds trust over time (linear patience growth). Stall detection is fast (multiplicative drop). Mirrors how a human PM would behave — "you've been productive, I'll give you more rope; you stalled, I'm checking sooner." |
| **Jittered Backoff** (AWS pattern) | Exponential backoff + random jitter | ⚠️ Jitter matters for multi-client contention (retries). We have one watchdog per orchestrator — no contention. Jitter adds no value here. |
| **Fixed Window** | Check every N seconds regardless | ❌ Too noisy for productive agents, too slow for dead ones. |
| **Sliding Window Average** | Average progress rate over last N beats, alert when below threshold | ⚠️ Interesting but requires defining "normal" rate per task type. Too complex for v1. |

#### AIMD for Agent Monitoring

**Additive Increase:** While the worker is making progress, patience grows linearly. Each productive heartbeat cycle adds time to the grace period. An agent that's been working for 10 minutes has earned more patience than one that just started.

**Multiplicative Decrease:** When a stall is detected, patience drops sharply (halved). The watchdog checks more frequently. If progress resumes, patience rebuilds linearly.

```
AIMD Stall Detection:

  patience = basePatience (30s)

  On each heartbeat:
    if progress changed:
      patience = min(patience + increment, maxPatience)   ← additive increase
      stallCount = 0                                       ← reset
    if progress stalled:
      patience = max(patience / 2, minPatience)            ← multiplicative decrease
      stallCount++
      
  Check schedule:
    next_check = now + patience
    
  Escalation:
    stallCount >= 3  → notify planner (warning)
    stallCount >= 5  → notify planner (urgent)

  Example timeline (agent working well, then stalls):
    Beat 1:  progress ✅  patience = 30s + 15s = 45s
    Beat 2:  progress ✅  patience = 45s + 15s = 60s
    Beat 3:  progress ✅  patience = 60s + 15s = 75s
    Beat 4:  progress ✅  patience = 75s + 15s = 90s    ← agent has earned trust
    Beat 5:  STALLED  ⚠️  patience = 90s / 2 = 45s      ← halve immediately
    Beat 6:  STALLED  ⚠️  patience = 45s / 2 = 22s      ← checking faster
    Beat 7:  STALLED  ⚠️  patience = 22s / 2 = 15s (min)← notify planner (warning)
    Beat 8:  progress ✅  patience = 15s + 15s = 30s     ← trust rebuilds linearly
```

```typescript
interface StallTracker {
  taskId: string;
  workerId: string;
  patienceMs: number;                  // current patience (AIMD-controlled)
  stallCount: number;                  // consecutive stall detections
  nextCheckAt: number;                 // when to check again
  lastProgressStepCount: number;       // stepCount at last progress
  lastProgressToolCalls: number;       // cumulative tools at last progress
  escalationLevel: 'monitoring' | 'warning' | 'urgent';
  workerMode: 'autonomous' | 'manual'; // manual = human-in-the-loop
}

// AIMD constants
const AIMD = {
  basePatience: 30_000,       // 30s starting patience
  increment: 15_000,          // +15s per productive beat (additive increase)
  decreaseFactor: 0.5,        // halve on stall (multiplicative decrease)
  minPatience: 15_000,        // floor: never check less than 15s
  maxPatience: 300_000,       // cap: never wait more than 5 minutes
  warningThreshold: 3,        // notify planner after 3 stalls
  urgentThreshold: 5,         // escalate after 5 stalls
};

private async checkStuckWorkers(): Promise<void> {
  const workers = this.workerPool.getActive();
  const now = Date.now();
  
  for (const worker of workers) {
    // --- Check 1: Dead worker (no heartbeat at all) ---
    if (now - worker.lastHeartbeat > this.config.deadThresholdMs) {
      await this.handleDeadWorker(worker);
      this.stallTrackers.delete(worker.id);
      continue;
    }
    
    // --- Check 2: Manual or Waiting mode — skip stall detection ---
    const tracker = this.getOrCreateTracker(worker);
    if (tracker.workerMode === 'manual' || tracker.workerMode === 'waiting') {
      // Worker is human-controlled or paused for human input
      // Only dead worker check applies (heartbeats must still arrive)
      // Stall detection: SUSPENDED — no patience decay
      continue;
    }
    
    // --- Check 3: Is it time to check this worker? ---
    if (now < tracker.nextCheckAt) continue;
    
    // --- Check 4: Has progress changed? ---
    const latest = worker.latestHeartbeat;
    const progressed = latest.progress.stepCount > tracker.lastProgressStepCount
                    || latest.progress.toolCallsSinceLastBeat > 0;
    
    if (progressed) {
      // AIMD: Additive increase — agent earns more patience
      tracker.patienceMs = Math.min(
        tracker.patienceMs + AIMD.increment,
        AIMD.maxPatience
      );
      tracker.stallCount = 0;
      tracker.escalationLevel = 'monitoring';
      tracker.lastProgressStepCount = latest.progress.stepCount;
      tracker.lastProgressToolCalls = latest.usage?.totalToolCalls || 0;
      tracker.nextCheckAt = now + tracker.patienceMs;
    } else {
      // AIMD: Multiplicative decrease — check more frequently
      tracker.patienceMs = Math.max(
        tracker.patienceMs * AIMD.decreaseFactor,
        AIMD.minPatience
      );
      tracker.stallCount++;
      tracker.nextCheckAt = now + tracker.patienceMs;
      
      // Escalate at thresholds
      if (tracker.stallCount >= AIMD.urgentThreshold) {
        tracker.escalationLevel = 'urgent';
        this.notifyPlanner({
          type: 'worker_stalled',
          severity: 'urgent',
          taskId: tracker.taskId,
          workerId: tracker.workerId,
          stallCount: tracker.stallCount,
          currentPatience: tracker.patienceMs,
          lastProgress: latest.progress.description,
          suggestion: 'Worker unresponsive for extended period. Consider aborting or reassigning.',
        });
      } else if (tracker.stallCount >= AIMD.warningThreshold) {
        tracker.escalationLevel = 'warning';
        this.notifyPlanner({
          type: 'worker_stalled',
          severity: 'warning',
          taskId: tracker.taskId,
          workerId: tracker.workerId,
          stallCount: tracker.stallCount,
          currentPatience: tracker.patienceMs,
          lastProgress: latest.progress.description,
          suggestion: 'Worker may be stuck. Still heartbeating but no progress.',
        });
      }
      // stallCount 1-2: just monitoring, no notification
    }
  }
}
```

### Manual Mode: Workers Waiting for Humans

When a worker is in **manual mode** (waiting for human input, approval, file upload, etc.), silence is expected. The watchdog must know to back off — treating a human-waiting pause as a "stall" would be a false alarm.

```
Worker Modes:

  AUTONOMOUS (default):
    Agent is executing independently. 
    Watchdog: ACTIVE — AIMD stall detection applies.
    
  MANUAL:
    Agent is under human control (human drives the conversation).
    Watchdog: REACTIVE ONLY — only dead worker detection applies.
    Stall detection: SUSPENDED.
    
  WAITING (human intervention pause):
    Agent was running (in any mode) and hit a point needing human input.
    Watchdog: REACTIVE ONLY — silence is expected.
    Resumes to PREVIOUS mode when human responds.

  Transitions (mode is preserved across human interventions):

    auto → needs human input → WAITING (previousMode=auto) → human responds → auto
    man  → needs human input → WAITING (previousMode=man)  → human responds → man

    auto → user switches to manual control → man
    man  → user switches to autonomous     → auto

  State machine:
  
    ┌──────────┐   request_input()   ┌──────────┐   human responds   ┌──────────┐
    │AUTONOMOUS├─────────────────────►│ WAITING  ├──────────────────►│AUTONOMOUS│
    └────┬─────┘  (previousMode=auto)└──────────┘  (restore previous)└──────────┘
         │                                                          
         │ user: "switch to manual"                                 
         ▼                                                          
    ┌──────────┐   request_input()   ┌──────────┐   human responds   ┌──────────┐
    │  MANUAL  ├─────────────────────►│ WAITING  ├──────────────────►│  MANUAL  │
    └──────────┘  (previousMode=man) └──────────┘  (restore previous)└──────────┘
```

Workers signal their mode via heartbeats:

```typescript
interface Heartbeat {
  workerId: string;
  taskId: string;
  timestamp: number;
  
  mode: 'autonomous' | 'manual' | 'waiting';  // ← three states
  previousMode?: 'autonomous' | 'manual';      // ← set when mode='waiting'
  waitingFor?: {                                // only present when mode='waiting'
    type: 'human_input' | 'approval' | 'file_upload' | 'external_api';
    since: number;
    description: string;
  };
  
  progress: {
    description: string;
    stepCount: number;
    toolCallsSinceLastBeat: number;
  };
  
  usage: {
    tokensUsed: number;
    wallClockMs: number;
  };
}
```

Watchdog behavior per mode:

| Mode | Dead Worker Check | Stall Detection (AIMD) | Human Wait Limit |
|---|---|---|---|
| **autonomous** | ✅ Active | ✅ Active | N/A |
| **manual** | ✅ Active | ❌ Suspended | ❌ No limit — human takes as long as they need |
| **waiting** | ✅ Active | ❌ Suspended | ❌ No limit — human takes as long as they need |

Humans are not machines. There is no timeout on human response. A person might step away for lunch, sleep, or take a week to think. The system waits. Period.

### Why AIMD Beats Exponential Backoff

| Property | Exponential Backoff | AIMD |
|---|---|---|
| **Growth when healthy** | Doesn't grow (only triggers on stall) | Grows linearly — agent earns trust over time |
| **Response to stall** | Doubles wait each check (slower escalation) | Halves patience (faster escalation) |
| **Recovery** | Full reset or restart from base | Rebuilds linearly from reduced level |
| **Behavior** | "Check less often over time" | "Trust more when productive, check harder when stuck" |
| **Analogy** | Retry a failing server less often | PM gives productive employees more autonomy, reins in unproductive ones |

AIMD is how a good manager works: build trust with results, lose it fast when things stop.

### Configuration

```typescript
interface WatchdogConfig {
  enabled: boolean;                    // true in prod, configurable in dev
  intervalMs: number;                  // 30_000 (check every 30 seconds)
  
  // Liveness (heartbeat-based — NOT duration-based)
  heartbeatIntervalMs: number;         // 15_000 (workers report every 15s)
  deadThresholdMs: number;             // 60_000 (no heartbeat = dead worker)
  
  // Stall detection (exponential backoff)
  stallBackoffBaseMs: number;          // 30_000 (first recheck 30s after stall detected)
  stallBackoffMaxMs: number;           // 480_000 (cap at 8 minutes between checks)
  stallWarningAfterChecks: number;     // 3 (notify planner as warning after 3 backoff checks)
  stallUrgentAfterChecks: number;      // 5 (escalate to urgent after 5 checks)
  
  // Advisory (not kill signals — just notify planner)
  tokenBudgetWarning?: number;         // warn planner when tokens exceed this
  goalDeadlineMs?: number;             // soft deadline — advisory, not enforced
  
  // Cleanup (automatic, no planner needed)
  stalePlanThresholdMs: number;        // 120_000 (plan approved but nothing dispatched)
  zombieCleanupIntervalMs: number;     // 300_000 (cleanup orphaned containers)
}
```

### Proactive ≠ Decision-Making

Critical distinction: the watchdog is proactive but **still doesn't make decisions**. It detects problems and **reports to the planner**. The planner decides what to do.

```
Watchdog detects stuck task
  │
  ├── Watchdog action (automatic): Kill worker, mark task failed, cleanup
  │
  └── Watchdog notification → Planner (decision required):
       └── Planner decides:
            ├── Retry same task with same worker type
            ├── Retry with different approach (smaller scope, different tools)
            ├── Skip task and adjust plan
            ├── Escalate to human
            └── Abort goal
```

The watchdog handles the **janitorial work** (killing zombies, cleaning up). The **strategic response** is always the planner's call.

### How Other Systems Handle This

| System | Proactive Mechanism | What It Does |
|---|---|---|
| **Temporal** | Activity heartbeats + 4 timeout types (schedule-to-start, start-to-close, schedule-to-close, heartbeat) | Detects stuck activities, retries with backoff |
| **Kubernetes** | Liveness probes (every N seconds) | Kills unresponsive pods, reschedules |
| **Celery** | Task time limits + worker heartbeats | Kills stuck tasks, marks for retry |
| **Inngest** | Step timeouts + function deadlines | Cancels stuck functions, triggers failure handlers |
| **Airflow** | Task SLAs + scheduler heartbeat | Alerts on SLA miss, kills zombie processes |
| **Our Orchestrator** | Watchdog timer + worker heartbeats | Detects stuck/dead, notifies planner, cleans up |

### Summary: Reactive + Proactive

```
ORCHESTRATOR = Event Loop + Watchdog

Event Loop (reactive):
  "When something happens → respond immediately"
  Speed: instant (<1ms)
  Handles: completions, failures, new goals, messages

Watchdog (proactive):  
  "When nothing happens → investigate" 
  Speed: periodic (every 30s)
  Handles: stuck tasks, dead workers, SLA breaches, zombies

Both feed into the same principle:
  Orchestrator DETECTS and REPORTS.
  Planner DECIDES and ACTS.
```

---

## Notification System: How the Orchestrator Talks to Everyone

### The Gap

The architecture describes `notifyPlanner()`, `tell_user()`, worker events — but never defines the **notification system** that makes all of this work. How does the orchestrator actually notify the planner when a task completes? How does it notify workers when context changes? How does it notify users in real-time? And how do we avoid the 7-emitter spaghetti we already have (see [EVENT_ARCHITECTURE_ANALYSIS.md](../../architecture/EVENT_ARCHITECTURE_ANALYSIS.md))?

### Research: How Other Multi-Agent Systems Handle This

| System | Notification Mechanism | Strengths | Weaknesses |
|---|---|---|---|
| **AutoGen (Microsoft)** | Topic-based pub/sub. Agents subscribe to topics (type + source). Group chat manager publishes `RequestToSpeak` to direct agents. Uses `TypeSubscription` for routing by agent type. Multi-tenant via topic source. | Clean separation. Agents don't know each other. Extensible — add subscribers without modifying publishers. Multi-tenant ready. | Over-engineered for single-process use. Topic indirection adds complexity when you have 3-5 agents. |
| **CrewAI** | Direct delegation + callbacks. Manager agent calls crew members directly. Callbacks for `on_task_start`, `on_task_complete`, `on_task_error`. Synchronous orchestration loop. | Simple. Easy to debug. Callbacks are typed. | No async fan-out. Manager blocks on each task. No way to broadcast to all agents simultaneously. |
| **Mastra** | Supervisor pattern with tool calls. Supervisor agent has subagents registered as tools. Calls them directly via `generate()`/`stream()`. Workflow steps for fixed sequences. | Natural for LLM agents — tool calls are the communication primitive. Streaming built-in. | Supervisor is the bottleneck. No event-driven reactivity — everything is request/response through the supervisor. |
| **LangGraph** | State graph with conditional edges. Shared state object passed between nodes. "Interrupts" for human-in-the-loop (pause graph, resume on input). Streaming via callbacks/events on graph execution. | State is first-class. Interrupts solve human notification neatly. Graph structure makes flow visible. | State graph is sequential by default. Parallel fan-out requires explicit design. No built-in pub/sub for agent-to-agent. |
| **Temporal** | Activity heartbeats + signals + queries. Workflows send signals to each other. Activities heartbeat to the orchestrator. Queries return current state synchronously. 4 timeout types for liveness detection. | Battle-tested in production. Signals are typed. Heartbeats solve liveness detection. Durable execution survives crashes. | Heavy infrastructure (Temporal server). Overkill for in-process agent orchestration. |

### Key Takeaways

1. **Tool calls ARE the notification for LLM agents** (Mastra, LangGraph) — the planner calls `get_status()` and learns what happened. This is pull-based notification.
2. **Events/pub-sub for fire-and-forget broadcasts** (AutoGen) — UI updates, logging, metrics. Multiple listeners, no response needed.
3. **Callbacks for tightly-coupled 1:1 notifications** (CrewAI, Temporal signals) — orchestrator → planner when a specific thing happens.
4. **Heartbeats for liveness** (Temporal) — already designed in our watchdog section.
5. **No system uses ONLY one pattern** — they all combine 2-3 mechanisms.

### Three Notification Channels

Our orchestrator needs three different notification mechanisms for three different audiences. Using one mechanism for all three is the mistake the current codebase makes (EventEmitter for everything).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION SYSTEM                                   │
│                                                                         │
│  Channel 1: ORCHESTRATOR → PLANNER (Message Injection)                 │
│  ─────────────────────────────────────────────────────                  │
│  Mechanism: Inject system messages into planner's LLM message stream.  │
│  Why: Planner is an LLM agent. The only way to "notify" it is to      │
│       add a message to its conversation that it will see and reason    │
│       about on its next turn.                                          │
│  Pattern: Async message queue → planner processes on next iteration.   │
│                                                                         │
│  Channel 2: ORCHESTRATOR → USERS (NotificationTransport)               │
│  ─────────────────────────────────────────────────────                  │
│  Mechanism: Transport interface — V1: Socket.IO, future: OpenClaw      │
│             Gateway (WhatsApp, Telegram, Slack, etc.)                  │
│  Why: Users are on different channels. Transport abstraction lets us   │
│       start with Socket.IO and extend to chat platforms later.         │
│  Pattern: Fire-and-forget broadcast. ask/discuss for response.         │
│                                                                         │
│  Channel 3: ORCHESTRATOR → WORKERS (Context + CancellationToken)       │
│  ─────────────────────────────────────────────────────                  │
│  Mechanism: Workers get context when spawned. Ongoing notifications    │
│             via L2 shared docs (workers read when they need to).       │
│             ERRORS/CANCELLATION: CancellationToken checked between     │
│             LLM turns. Orchestrator sets token → worker aborts on      │
│             next tool boundary. No waiting for L2 poll.                │
│  Why: Workers are spawned per-task. Normal notifications are pull.     │
│       But errors + cancellation can't wait — token mechanism gives     │
│       the orchestrator a kill switch without mid-LLM interruption.     │
│  Pattern: Pull for context, CancellationToken for errors/abort.        │
│                                                                         │
│  Bonus: PLANNER → USER (already designed as user tools)               │
│  ─────────────────────────────────────────────────────                  │
│  Mechanism: tell_user(), ask_user(), discuss_approach()                │
│  Why: These are planner tools, not orchestrator notifications.         │
│       Planner decides when/what to tell the user.                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Channel 1: Orchestrator → Planner (Message Injection)

This is the hardest channel because the planner is an LLM agent — it doesn't have an event listener. It processes messages in a conversation.

**The problem:** When a worker completes a task, the orchestrator can't just `emit('task:complete')` and have the planner react. The planner is either (a) mid-LLM-call or (b) waiting for events via a monitoring tool.

**Solution: Notification Queue + Suspend/Resume**

The orchestrator maintains a per-planner notification queue. When the planner has no work to do (tasks dispatched, waiting for results), it **suspends** — the LLM is not running, zero tokens consumed. The orchestrator **wakes** the planner by resolving a wake signal and injecting queued notifications as system messages.

```typescript
interface PlannerNotification {
  id: string;
  type: 'task_completed' | 'task_failed' | 'worker_stalled' | 'worker_died'
      | 'plan_blocked' | 'execution_complete' | 'sla_warning';
  severity: 'info' | 'warning' | 'urgent';
  timestamp: number;
  payload: Record<string, any>;   // type-specific data
  acknowledged: boolean;           // planner has seen this
}

class NotificationQueue {
  private queue: PlannerNotification[] = [];

  /** Orchestrator pushes notifications */
  push(notification: Omit<PlannerNotification, 'id' | 'acknowledged'>): void {
    this.queue.push({ ...notification, id: randomUUID(), acknowledged: false });
  }

  /** Planner pulls unacknowledged notifications (via tool call) */
  drain(): PlannerNotification[] {
    const pending = this.queue.filter(n => !n.acknowledged);
    pending.forEach(n => n.acknowledged = true);
    return pending;
  }

  /** Check if there are urgent unacknowledged notifications */
  hasUrgent(): boolean {
    return this.queue.some(n => !n.acknowledged && n.severity === 'urgent');
  }
}
```

**Delivery model: Push-only (no polling)**

| Trigger | Orchestrator Action |
|---|---|
| Task completes | Queue notification → batch with others → wake planner |
| Task fails | Queue notification → wake planner immediately |
| Worker dies/stalls | Queue notification → wake planner immediately |
| All tasks done | Queue notification → wake planner immediately |
| SLA warning | Queue notification → wake planner (next batch) |

Notifications are **batched** by default: the orchestrator waits a short debounce window (100ms) before waking the planner, so multiple near-simultaneous events (e.g., 3 tasks completing at once) arrive as one batch rather than 3 separate wake-ups.

**User messages are NOT notifications.** They are conversation. See [User Message Handling](#user-message-handling) below.

```typescript
// Push mode: inject urgent notification into planner's message stream
class Orchestrator {
  private plannerNotifications = new NotificationQueue();
  private plannerAgent: Agent | null = null;

  private async notifyPlanner(notification: PlannerNotification): Promise<void> {
    // Always queue the notification (planner will see it on next pull)
    this.plannerNotifications.push(notification);

    // Wake the planner — it's suspended, waiting for this signal
    if (this.plannerAgent) {
      // Debounce: wait 100ms to batch near-simultaneous notifications
      this.scheduleWake();
    }

    // Always emit to Socket.IO as well (users see everything)
    this.emitToUsers('orchestrator:notification', notification);
  }

  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleWake(): void {
    // Batch: if multiple notifications arrive within 100ms, only wake once
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(async () => {
      this.wakeTimer = null;
      const notifications = this.plannerNotifications.drain();
      if (notifications.length === 0) return;
      // Inject all pending notifications as a single system message
      const message = notifications.map(n => this.formatNotificationAsMessage(n)).join('\n');
      await this.plannerAgent!.addSystemMessage(message);
      // Wake the planner — it's awaiting this promise
      this.plannerWakeSignal?.resolve();
    }, 100);
  }

  private formatNotificationAsMessage(n: PlannerNotification): string {
    switch (n.type) {
      case 'task_completed':
        return `[SYSTEM] Task ${n.payload.taskId} completed by ${n.payload.role}. Summary: ${n.payload.summary}`;
      case 'task_failed':
        return `[SYSTEM] Task ${n.payload.taskId} FAILED. Error: ${n.payload.error}. Review and decide: retry, skip, or replan.`;
      case 'worker_died':
        return `[SYSTEM] URGENT: Worker for task ${n.payload.taskId} died (no heartbeat). Task marked failed. Decide next action.`;
      case 'execution_complete':
        return `[SYSTEM] All tasks complete. Review results and confirm goal is met.`;
      default:
        return `[SYSTEM] ${n.type}: ${JSON.stringify(n.payload)}`;
    }
  }
}
```

### User Message Handling (Separate from Notifications)

User messages are **conversation**, not system notifications. They go into the planner's message stream as human messages — not `[SYSTEM]` prefixed, not through NotificationQueue.

**Why separate?**
- Notifications are system events (task completed, worker died). The planner processes them and returns to its current phase.
- User messages are **directives** — the human is changing or adding to the goal. They take priority over queued notifications.
- Mixing them into the same queue means the planner can't distinguish "system tells me a task finished" from "human says change direction."

**Behavior by planner state:**

| Planner State | User Message Arrives | What Happens |
|---|---|---|
| **Suspended** (waiting for events) | User sends message | Wake planner immediately. Inject as human message (not system). Planner resumes, sees user message, responds. Pending notifications are blocked until planner finishes with user. |
| **Mid-LLM-call** (generating response) | User sends message | Queue the message. When current LLM turn finishes, inject as human message on next turn. Do NOT interrupt mid-generation. |
| **Processing notifications** (just woke from system events) | User sends message | **User takes priority.** Pause notification processing, inject user message as human message, let planner handle it first. Remaining notifications stay queued. |

**Priority: User > Notifications**

When the planner wakes from suspension, it checks for pending user messages first, then notifications. If both exist, user messages are injected as human messages and notifications wait. This prevents the planner from spending tokens on system bookkeeping while a human is trying to redirect.

```typescript
class Orchestrator {
  private pendingUserMessages: Array<{ content: string; timestamp: number }> = [];

  /** Called by SocketServerV2 when user sends a message */
  async onUserMessage(content: string): Promise<void> {
    this.pendingUserMessages.push({ content, timestamp: Date.now() });

    if (this.plannerSuspended) {
      // Wake planner with user message (NOT as notification)
      this.plannerWakeSignal?.resolve('user_message');
    }
    // If planner is mid-LLM-call, message waits. Planner sees it on next turn.
  }

  /** Called when planner wakes up */
  private async onPlannerWake(reason: 'notification' | 'user_message'): Promise<void> {
    // User messages first — always
    if (this.pendingUserMessages.length > 0) {
      const messages = this.pendingUserMessages.splice(0);
      for (const msg of messages) {
        await this.plannerAgent!.addHumanMessage(msg.content);
      }
      // Let planner process user messages before notifications
      return;
    }

    // Then notifications
    const notifications = this.plannerNotifications.drain();
    if (notifications.length > 0) {
      const message = notifications.map(n => this.formatNotificationAsMessage(n)).join('\n');
      await this.plannerAgent!.addSystemMessage(message);
    }
  }
}
```

### Channel 2: Orchestrator → Users (Transport-Agnostic)

The notification system must not hardcode Socket.IO. Today users are in a browser; tomorrow they're on WhatsApp, Telegram, or Slack via OpenClaw Gateway. The orchestrator emits **typed notification objects** to a `NotificationTransport` interface. Transports decide how to deliver.

#### NotificationTransport Interface

```typescript
interface NotificationTransport {
  /** Fire-and-forget: send a notification to all users in a team */
  send(teamId: string, notification: UserNotification): void;
  /** Request-response: ask a user a question, return their answer */
  ask(teamId: string, question: UserQuestion): Promise<string>;
  /** Bidirectional: present options, return selection */
  discuss(teamId: string, choices: UserChoice): Promise<string>;
}

type UserNotification = {
  type: string;      // 'task:started', 'plan:proposed', etc.
  severity: 'info' | 'warning' | 'urgent';
  payload: Record<string, any>;
  timestamp: number;
};
```

#### V1 Transport: Socket.IO (Browser)

```typescript
class SocketIOTransport implements NotificationTransport {
  constructor(private io: Server) {}

  send(teamId: string, notification: UserNotification): void {
    this.io.to(teamId).emit(notification.type, notification);
  }

  async ask(teamId: string, question: UserQuestion): Promise<string> {
    // Uses the Map<id, resolver> bridge pattern (see Step 2)
    const { promise, resolve } = Promise.withResolvers<string>();
    pendingQuestions.set(question.id, { resolve });
    this.io.to(teamId).emit('planner:ask', question);
    return promise;
  }

  async discuss(teamId: string, choices: UserChoice): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    pendingQuestions.set(choices.id, { resolve });
    this.io.to(teamId).emit('planner:discuss', choices);
    return promise;
  }
}
```

#### Future Transport: OpenClaw Gateway (Chat Channels)

The OpenClaw Gateway already uses WebSocket EventFrames for push notifications. When we integrate it (see [OpenClaw feature](../../features/openclaw-integration/feature_architecture.md)), it becomes another transport:

```typescript
class OpenClawTransport implements NotificationTransport {
  constructor(private gateway: OpenClawGatewayClient) {}

  send(teamId: string, notification: UserNotification): void {
    // Route to WhatsApp/Telegram/Slack via Gateway's `send` RPC
    this.gateway.request('send', {
      channel: this.resolveChannel(teamId),
      message: this.formatForChat(notification),
    });
  }

  async ask(teamId: string, question: UserQuestion): Promise<string> {
    // Gateway's `agent` RPC supports streaming EventFrames
    // Use the same Map<id, resolver> pattern — Gateway EventFrame
    // carries the response back via the same WebSocket
    return this.gateway.request('agent', {
      message: question.text,
      waitForResponse: true,
    });
  }
  // ...
}
```

#### Composite Transport (Fan-Out)

In production, notifications go to ALL connected transports simultaneously:

```typescript
class CompositeTransport implements NotificationTransport {
  constructor(private transports: NotificationTransport[]) {}

  send(teamId: string, notification: UserNotification): void {
    for (const t of this.transports) t.send(teamId, notification);
  }

  // ask/discuss: route to whichever transport the user is currently on
  async ask(teamId: string, question: UserQuestion): Promise<string> {
    // Race: first transport to get a user response wins
    return Promise.any(
      this.transports.map(t => t.ask(teamId, question))
    );
  }
}
```

#### What Gets Notified

| Event | When | Severity |
|---|---|---|
| `task:started` | Worker begins executing a task | info |
| `task:completed` | Task finished successfully | info |
| `task:failed` | Task failed (error or worker death) | warning |
| `task:blocked` | Task waiting on unmet dependencies | info |
| `plan:proposed` | Planner submits plan for approval | info |
| `plan:approved` | Plan approved (by user or auto-approve) | info |
| `plan:mutated` | Planner changed plan mid-flight | info |
| `plan:replanned` | Planner replaced the entire plan | warning |
| `worker:progress` | Worker reports progress | info |
| `planner:tell` | Planner uses tell_user() | info |
| `planner:ask` | Planner uses ask_user() — needs response | urgent |
| `planner:discuss` | Planner uses discuss_approach() — needs choice | urgent |
| `orchestrator:watchdog` | Watchdog detected issue | warning |

### Channel 3: Orchestrator → Workers (Context + Error Notification)

Workers are task-focused agents. For **normal context**, pull-based is fine:

1. **Receive full context at spawn time** — task description, dependency outputs, research findings in `context.notes`
2. **Query L2 when they need shared state** — via `collab` tool (read other agents' outputs, shared docs)
3. **Report back to orchestrator** — via `report_status` and `complete_task` tools

But **errors can't wait for the next L2 poll.** Several scenarios require the orchestrator to push information to a running worker:

| Error Scenario | Why Pull Is Too Slow | Impact of Delay |
|---|---|---|
| **Upstream dependency failed** | Worker is building on output that's now invalid | Wasted tokens + wrong output |
| **Planner cancelled/reassigned task** | Worker keeps executing a cancelled task | Wasted compute, output discarded anyway |
| **Shared resource down** (DB, API) | Worker retries uselessly instead of stopping | Token burn + cascading timeouts |
| **Budget exceeded** | Worker doesn't know to stop | Cost overrun |
| **Planner replanned** | Worker's task is no longer in the plan | Entire effort wasted |

**Solution: CancellationToken + Error Context**

Borrowed from .NET/Go cancellation patterns. The orchestrator gives each worker a `CancellationToken` at spawn time. The token is checked **between LLM turns** (at every tool call boundary). This means:

- No mid-LLM interruption (which would corrupt the conversation)
- Worker aborts cleanly at the next tool boundary (~seconds, not minutes)
- Error context is attached to the token so the worker can log/report why it stopped

```typescript
interface CancellationToken {
  cancelled: boolean;
  reason?: CancellationReason;
}

interface CancellationReason {
  type: 'task_cancelled' | 'dependency_failed' | 'budget_exceeded'
      | 'resource_down' | 'plan_replaced';
  message: string;           // human-readable explanation
  initiatedBy: 'planner' | 'orchestrator' | 'watchdog';
  timestamp: number;
}

// Orchestrator side: cancel a running worker
class Orchestrator {
  private workerTokens = new Map<string, CancellationToken>();

  async spawnWorker(task: PlanTask): Promise<void> {
    const token: CancellationToken = { cancelled: false };
    this.workerTokens.set(task.id, token);

    const worker = await this.workerPool.spawn(task.assignedRole, {
      task,
      cancellationToken: token,  // shared reference
      tools: [...this.coreWorkerTools, ...task.roleTools],
    });

    worker.on('complete', (output) => this.onTaskCompleted(task.id, output));
    worker.on('failure', (error) => this.onTaskFailed(task.id, error));
  }

  // Called when planner cancels a task, upstream fails, etc.
  cancelWorker(taskId: string, reason: CancellationReason): void {
    const token = this.workerTokens.get(taskId);
    if (token) {
      token.cancelled = true;
      token.reason = reason;
      // Worker sees this on its next tool boundary — no event needed
    }
  }
}

// Worker side: check token between LLM turns
class Worker {
  private cancellationToken: CancellationToken;

  // Called by the agent framework BEFORE each tool execution
  private checkCancellation(): void {
    if (this.cancellationToken.cancelled) {
      const reason = this.cancellationToken.reason;
      // Save partial work to L2 before aborting
      this.savePartialProgress();
      throw new TaskCancelledException(
        `Task cancelled: ${reason?.type} — ${reason?.message}`
      );
    }
  }

  async execute(task: Task): Promise<TaskOutput> {
    // LangGraph middleware: check cancellation at every tool boundary
    const agent = createAgent({
      tools: this.tools.map(tool => wrapWithCancellationCheck(tool, () => this.checkCancellation())),
      // ... other config
    });
    return agent.generate(task.description);
  }
}

// Tool wrapper: check cancellation before executing any tool
function wrapWithCancellationCheck(
  tool: Tool,
  checkFn: () => void
): Tool {
  return {
    ...tool,
    async call(input: any) {
      checkFn();  // throws TaskCancelledException if cancelled
      return tool.call(input);
    }
  };
}
```

**When the orchestrator cancels workers:**

| Trigger | Orchestrator Action | CancellationReason.type |
|---|---|---|
| Planner calls `cancel_task(id)` | `cancelWorker(id, { type: 'task_cancelled' })` | `task_cancelled` |
| Upstream task fails | `cancelWorker(downstreamId, { type: 'dependency_failed' })` | `dependency_failed` |
| Planner calls `replan()` | Cancel all pending workers | `plan_replaced` |
| Watchdog: budget exceeded | `cancelWorker(id, { type: 'budget_exceeded' })` | `budget_exceeded` |
| Shared resource down (detected by watchdog) | Cancel affected workers | `resource_down` |

**What the worker does on cancellation:**
1. Stops executing (checks token at next tool boundary)
2. Reports cancellation reason back to orchestrator
3. Dies cleanly — orchestrator cleans up the sandbox
4. Retry (if any) starts from scratch — no partial state to manage

**Why CancellationToken and not EventEmitter?**
- Workers are LLM agents — they can't subscribe to events mid-LLM-call
- Token is a **shared reference** (same object in memory) — no IPC, no serialization, instant
- Checked at natural boundaries (tool calls) — no risk of corrupting LLM state
- Same pattern used by .NET (`CancellationToken`), Go (`context.Context`), and Python (`asyncio.CancelledError`) for cooperative cancellation
- When we move to multi-process workers, token becomes a flag in shared memory or a lightweight HTTP poll

### Notification Flow Diagram

```
                              ┌─────────────┐
                              │   PLANNER    │
                              │  (LLM Agent) │
                              └──────┬───────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
    │  tell_user()    │   │  get_status()   │   │  submit_plan()  │
    │  ask_user()     │   │  (pulls         │   │  (orchestrator  │
    │  (Socket.IO     │   │   notification  │   │   stores tasks) │
    │   to frontend)  │   │   queue)        │   │                 │
    └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
             │                     │                      │
             ▼                     ▼                      ▼
    ┌────────────────────────────────────────────────────────────────┐
    │                    ORCHESTRATOR (Runtime)                       │
    │                                                                │
    │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐│
    │  │ NotificationQueue│  │    TaskStore      │  │  WorkerPool  ││
    │  │ (planner inbox)  │  │ (task state CRUD) │  │ (spawn/kill) ││
    │  └────────┬─────────┘  └──────────────────┘  └──────┬───────┘│
    │           │                                          │        │
    │           │ push(notification)      spawn(role,ctx)  │        │
    │           │                                          │        │
    │  ┌────────┴─────────────────────────────────────────┘        │
    │  │                                                            │
    │  │  Event Sources:                                            │
    │  │  ├── Worker completes/fails → push to NotificationQueue   │
    │  │  ├── Watchdog detects stuck → push to NotificationQueue   │
    │  │  ├── All tasks done → push urgent to NotificationQueue    │
    │  │  └── Every event → also transport.send() (all channels)   │
    │  │                                                            │
    │  └── transport.send() ───────────────────────────────────┐   │
    └────────────────────────────────────────────────────────── │ ──┘
                                                               │
                                        ┌──────────────────────┴────────────┐
                                        │     NotificationTransport         │
                                        │     (CompositeTransport)          │
                                        │                                   │
                                        │  ┌─────────┐  ┌───────────────┐  │
                                        │  │Socket.IO │  │OpenClaw       │  │
                                        │  │Transport │  │Transport (v2) │  │
                                        │  └────┬─────┘  └──────┬────────┘  │
                                        └───────┼───────────────┼───────────┘
                                                │               │
                                                ▼               ▼
                                       ┌──────────────┐ ┌──────────────┐
                                       │   BROWSER    │ │ WhatsApp /   │
                                       │  (Socket.IO  │ │ Telegram /   │
                                       │   listener)  │ │ Slack (v2)   │
                                       └──────────────┘ └──────────────┘
```

### Why Not Just EventEmitter Everywhere?

The [EVENT_ARCHITECTURE_ANALYSIS](../../architecture/EVENT_ARCHITECTURE_ANALYSIS.md) identified 7 event emitters creating a spaghetti web. The notification system replaces that with 3 clear channels:

| Old Pattern (EventEmitter) | Problem | New Pattern |
|---|---|---|
| `events.emit('task:complete')` → planner reacts | Planner is LLM, can't subscribe to events | NotificationQueue → planner pulls via tool |
| `events.emit('worker:event')` → AgentManager → SocketServer | 3-hop passthrough of the same event | `transport.send()` from orchestrator — one hop to any channel |
| `events.emit('task:available')` → wake worker | Worker doesn't exist yet at emit time | Orchestrator spawns worker directly |
| `events.emit('plan:proposed')` → ??? → somehow reaches user | Unclear routing through multiple emitters | Orchestrator calls `transport.send()` → reaches browser, WhatsApp, etc. |
| `events.emit('task:cancelled')` → worker ignores | Worker is mid-LLM-call, can't listen to events | CancellationToken checked at tool boundaries |

### Design Principles (from the research)

1. **Match the mechanism to the consumer.** LLM agents → message injection. Browsers → WebSocket. Workers → context at spawn + CancellationToken for errors.
2. **Pull for normal, push for urgent.** Planner polls in its MONITOR loop (pull). Worker death or execution complete interrupts the planner (push). Workers pull context from L2 normally, but errors/cancellation are pushed via CancellationToken.
3. **Every notification goes to users.** Via `NotificationTransport` — V1 is Socket.IO, extends to OpenClaw Gateway (WhatsApp, Telegram, Slack) via `CompositeTransport`. Orchestrator doesn't know which channel the user is on.
4. **No event chains.** Notification goes from source → NotificationQueue → consumer. Not source → EventEmitter A → EventEmitter B → EventEmitter C → consumer.
5. **Typed notifications.** `PlannerNotification` is a discriminated union, not a string event name. TypeScript catches missing handlers at compile time.
6. **Cooperative cancellation.** Workers check CancellationToken at tool boundaries — clean abort, no mid-LLM corruption. Retries start from scratch.
7. **Transport-agnostic from day one.** `NotificationTransport` interface decouples the orchestrator from delivery. Adding a new channel (OpenClaw, email, webhook) = implementing one interface, registering with `CompositeTransport`. Zero orchestrator changes.
8. **Workers talk to users directly — planner is informed, not a relay.** Workers get their own `ask_user` tool. Questions go straight to the user, not through the planner. Planner is notified (so it knows the worker is waiting), but doesn't mediate.

---

## Worker↔User Interaction

### The Gap

Workers can broadcast TO users (via `worker:event` → Socket.IO), but they cannot ask users anything. If a worker needs clarification, a file, or approval for a destructive action — it has no mechanism. It guesses or fails.

### Three Interaction Types

| Type | Direction | Current State | Solution |
|---|---|---|---|
| **Direct chat** | User ↔ Worker | ✅ Works — `handleWorkerMessage()` → `continueTask()` | Keep pattern, remove ad-hoc task creation |
| **Worker asks question** | Worker → User → Worker | ❌ Missing | Reuse planner's `Map<id, resolver>` bridge |
| **Approval gates** | Worker → User → Worker | ❌ Missing | `ask_user` + `needs_approval` tool config |

### Layer 1: Direct Chat (Already Works — One Fix Needed)

Current code: `handleWorkerMessage()` → `continueTask(taskId, content)` → `workerPool.runTask(taskId, role, message)` — reuses the same worker's LangGraph thread via `taskId`. This is the right pattern.

**Fix during refactor:** Currently `startTask()` creates ad-hoc tasks (`task-${Date.now()}`). In the new system, tasks come from the planner's plan via TaskStore. `handleWorkerMessage()` should only allow `continueTask()` on existing planned tasks. Ad-hoc worker chats are a separate mode ("Chat Agent" lifecycle).

```
User types "@writer review this paragraph"
  │
  ▼
SocketServerV2.handleWorkerMessage()
  │
  ├── taskId exists? → continueTask(taskId, content)  ← planned task conversation
  │                     └── Worker continues LangGraph thread
  │
  └── No taskId?   → Start ad-hoc chat ("Chat Agent" lifecycle)
                      └── Creates ephemeral task, separate from plan
```

### Layer 2: Worker Asks User (Reuse Planner's Bridge)

Same `Map<questionId, resolver>` pattern as planner's `ask_user`, but scoped to a task thread.

```typescript
// Worker's ask_user tool — same bridge, different Socket.IO events
const pendingQuestions = new Map<string, { resolve: (answer: string) => void }>();

// Worker tool side: blocks until user responds
const worker_ask_user = tool(async ({ question, taskId }) => {
  const id = randomUUID();
  const { promise, resolve } = Promise.withResolvers<string>();
  pendingQuestions.set(id, { resolve });
  
  // Emit to task thread (not global chat)
  socketIO.to(teamRoom).emit('worker:ask', { id, taskId, question, role: worker.role });
  
  // Notify planner: "worker is waiting for user" (so planner knows, but doesn't relay)
  notificationQueue.push({ type: 'worker_waiting', taskId, question });
  
  // Worker heartbeat → WAITING mode (watchdog backs off)
  worker.setMode('waiting', { type: 'human_input', questionId: id });
  
  const answer = await promise;  // blocks here
  worker.setMode('autonomous');   // resume normal mode
  pendingQuestions.delete(id);
  return answer;
});

// Socket side: unblocks the worker
socket.on('worker:respond', ({ id, answer }) => {
  pendingQuestions.get(id)?.resolve(answer);
});
```

**Key differences from planner's `ask_user`:**
- Events are `worker:ask` / `worker:respond` (not `planner:ask` / `planner:respond`)
- Scoped to task thread in UI (not global chat)
- Notifies planner that worker is waiting (planner may decide to cancel if waiting too long)
- Worker heartbeat switches to `WAITING` mode — watchdog backs off

### Layer 3: Worker Communication Tools

Workers get the same communication tools as the planner — `tell_user`, `discuss_approach`, and `ask_user` — scoped to their task thread. These are **the same bridge** (same `Map<id, resolver>`, same Socket.IO pattern), just with different event prefixes.

| Tool | Worker Version | Socket.IO Event | Blocking? |
|---|---|---|---|
| `tell_user` | `worker_tell_user` | `worker:tell` (fire-and-forget) | No |
| `discuss_approach` | `worker_discuss_approach` | `worker:ask` / `worker:respond` (with options) | Yes |
| `ask_user` | `worker_ask_user` | `worker:ask` / `worker:respond` | Yes |

**Why workers need `tell_user`:** Workers already stream tokens via `worker:event`, but that's raw LLM output. `tell_user` sends **structured messages** — findings, warnings, progress updates — that appear as distinct UI elements in the task thread, not buried in a stream.

**Why workers need `discuss_approach`:** When a worker has two valid implementations ("Should I use REST or GraphQL for this API?"), it shouldn't guess. It presents options, user picks, worker proceeds. Same bridge, same pattern.

### Layer 4: Approval System

**Extracted to separate feature (Phase 2, post-Mastra):** See [A9 Approval System](../../features/approval-system/feature_architecture.md).

A9 depends on A1 (Mastra Migration) to leverage `requireApproval`, `suspend()`, and state persistence natively. It adds our product layer on top: structured requests (4 types: plan, replan, tool, artifact), auto-approve rules per team, conditional approval functions, sticky decisions, and audit trail. Uses A5's `Map<id, resolver>` bridge for plan-level approval and Mastra's stream events for tool-level approval.

### Why Not Planner-Mediated?

Routing worker questions through the planner was considered and rejected:

| | Direct (worker → user) | Planner-mediated (worker → planner → user → planner → worker) |
|---|---|---|
| **Latency** | 1 round-trip | 3 round-trips (+ 2 LLM calls to relay) |
| **Token cost** | 0 extra LLM tokens | ~2000 tokens per relay (planner reasons about what to ask) |
| **Fidelity** | User sees exact worker context | Planner may summarize/lose context |
| **Complexity** | Reuses existing bridge | New planner tool + relay logic |

The planner IS notified (via notification queue) so it can decide to cancel if the worker waits too long. But it doesn't sit in the communication path.

### Worker Interaction by Agent Type

| Agent Type | Direct Chat | `tell_user` | `ask_user` / `discuss_approach` | Approval Gates | Default |
|---|---|---|---|---|---|
| **Ping Team (auto)** | ❌ No | ✅ Findings/warnings stream to user | ❌ No — task spec should be clear | ✅ Destructive tools only (auto-approve rest) | Autonomous |
| **User-controlled external** | ✅ Yes | ✅ Full structured messages | ✅ Yes — can ask/discuss | ✅ Yes — user controls execution | Interactive |
| **Internal agent** | ✅ Yes | ✅ Full structured messages | ✅ Yes — user is present | ✅ Yes — especially for system changes | Interactive |

Ping Team workers are autonomous by design. They get `tell_user` (for streaming findings to the UI) and approval gates (for destructive tools), but NOT `ask_user` or `discuss_approach`. If they need clarification, the task spec was inadequate — the planner should fix it.

---

## Worker Failure Reporting: The Reverse Channel

### The Missing Design

The notification system above covers orchestrator → planner and orchestrator → worker. But what happens when a **worker itself** fails a task? The current pseudocode has:

```typescript
// This is all we had:
async reportFailure(taskId: string, error: string): Promise<void> {
  await this.taskStore.fail(taskId, error);
  this.notifyPlanner({ type: 'task_failed', taskId, error });
}
```

A bare `error: string` is not enough. The planner needs structured information to decide what to do: Is this retriable? How far did the worker get? What exactly broke — the worker, the tool, the LLM, or the external system? Without this, the planner is guessing.

### Worker Failure Report (Structured)

```typescript
interface WorkerFailureReport {
  taskId: string;
  workerId: string;
  role: string;

  // What happened?
  error: {
    category: ErrorCategory;
    message: string;                      // human-readable
    code?: string;                        // machine-readable (e.g., 'ECONNREFUSED', 'RATE_LIMIT')
    stack?: string;                       // for debugging (not sent to planner LLM)
    toolName?: string;                    // which tool failed, if applicable
    llmStep?: number;                     // which LLM turn hit the error
  };

  // How far did the worker get? (informational — retries start from scratch)
  progress?: {
    completedSteps: number;               // how many tool calls succeeded
    totalStepsAttempted: number;
    lastStepDescription: string;          // what was the worker doing when it failed
  };

  // Should we retry?
  retryGuidance: {
    retriable: boolean;                   // worker's assessment: is retry likely to help?
    suggestedAction: 'retry' | 'retry_different_approach' | 'skip' | 'escalate';
    reason: string;                       // why this suggestion
    attemptsExhausted?: boolean;          // if worker already retried internally
    internalRetries?: number;             // how many times the worker retried before giving up
  };

  // Resource usage at time of failure
  usage: {
    tokensUsed: number;
    wallClockMs: number;
    toolCallsMade: number;
  };

  timestamp: number;
}

type ErrorCategory =
  | 'llm_error'           // LLM refused, hallucinated, or returned garbage
  | 'tool_error'          // A tool threw an error (file not found, API returned 500)
  | 'external_service'    // External dependency unavailable (DB, API, MCP server)
  | 'rate_limit'          // Hit rate limit on LLM or external API
  | 'timeout'             // Worker's own operation timed out (not watchdog — self-detected)
  | 'validation_error'    // Worker produced output that doesn't meet acceptance criteria
  | 'context_exceeded'    // LLM context window full, can't continue
  | 'permission_denied'   // Worker lacks access to required resource
  | 'cancelled'           // CancellationToken was set (orchestrator-initiated — see Channel 3)
  | 'unknown';            // Unclassified error
```

### Why Error Classification Matters

The planner's decision depends entirely on the **error category**. A flat string forces the planner to parse natural language to figure out what happened. A structured `ErrorCategory` lets the planner (or even automated orchestrator logic) make the right call immediately:

| Error Category | Retriable? | Planner's Likely Action | Orchestrator Auto-Action |
|---|---|---|---|
| `llm_error` | Usually yes | Retry with same or different model | None — planner decides |
| `tool_error` | Depends | Retry or fix the tool input (update task description) | None |
| `external_service` | Yes (transient) | Wait + retry, or skip if non-critical | Optionally auto-retry once after delay |
| `rate_limit` | Yes (with backoff) | Retry after delay, or split work across workers | Auto-retry with exponential backoff (up to N times) |
| `timeout` | Maybe | Retry with simpler scope, or split into subtasks | None |
| `validation_error` | Yes (prompt issue) | Update task description with clearer criteria, retry | None |
| `context_exceeded` | No (same input = same result) | Split task into smaller subtasks | None |
| `permission_denied` | No (config issue) | Escalate to user (fix permissions) or reassign to role with access | None |
| `cancelled` | N/A | Already handled by CancellationToken flow | Already handled |
| `unknown` | Unknown | Escalate to user or retry once as best effort | None |

### The Full Flow: Worker Fails → Planner Decides → Action

```
Worker encounters error during execution
  │
  ▼
Worker catches error, classifies it
  │
  ├── Builds WorkerFailureReport (structured)
  │     └── Includes: category, progress info, retry guidance, usage stats
  │
  └── Reports to Orchestrator (no partial state saved — retries start fresh)
        │
        ▼
Orchestrator receives failure report
  │
  ├── 1. Update TaskStore: status → 'failed', attach failure report
  │
  ├── 2. AUTO-ACTIONS (orchestrator handles without planner):
  │     ├── rate_limit + retries < maxAutoRetry → auto-retry after backoff
  │     ├── external_service + retries < 1 → auto-retry once after 5s delay
  │     └── All else → no auto-action, escalate to planner
  │
  ├── 3. Downstream dependency impact:
  │     ├── Find all tasks with failed task in their dependencies
  │     ├── Mark downstream tasks as 'blocked' (reason: 'upstream_failed')
  │     ├── Do NOT cascade-fail them — planner may fix the upstream
  │     └── Emit Socket.IO: 'task:blocked' for each affected task
  │
  ├── 4. Notify Planner via NotificationQueue:
  │     └── push({
  │           type: 'task_failed',
  │           severity: category === 'cancelled' ? 'info' : 'warning',
  │           payload: {
  │             taskId,
  │             role,
  │             error: { category, message, code },
  │             partialOutput: report.partialOutput,
  │             retryGuidance: report.retryGuidance,
  │             blockedDownstream: [...downstream task IDs],
  │             usage: report.usage,
  │           }
  │         })
  │     If severity is 'warning' or higher → also inject system message
  │     (push mode — don't wait for planner's next MONITOR poll)
  │
  ├── 5. Notify Users via Socket.IO:
  │     └── emit('task:failed', { taskId, role, error: message, hasPartialWork: true })
  │
  └── 6. Cleanup: kill worker sandbox, free worker pool slot
        │
        ▼
Planner receives notification (via pull or push)
  │
  ├── Reads failure report + partial output
  │
  ├── DECISION (planner's LLM reasoning):
  │     ├── RETRY: Same task, same approach
  │     │    └── submit_plan({ tasks: [same task] }) or orchestrator retryTask(id)
  │     │
  │     ├── RETRY DIFFERENTLY: Same goal, different approach
  │     │    └── update_task(id, { description: "Try using X instead of Y..." })
  │     │        + re-submit
  │     │
  │     ├── SPLIT: Task was too big, break it down
  │     │    └── remove_task(id) + add_tasks([subtask1, subtask2, ...])
  │     │
  │     ├── REASSIGN: Wrong role for this task
  │     │    └── reassign_task(id, newRole)
  │     │
  │     ├── SKIP: Non-critical, downstream tasks can proceed without it
  │     │    └── remove_task(id) (cascade removes dep from downstream)
  │     │
  │     ├── ESCALATE: Needs human decision
  │     │    └── ask_user("Task X failed because Y. Options: retry/skip/replan. Your call?")
  │     │
  │     └── REPLAN: Failure invalidates the plan
  │          └── replan(reason, newPlan)
  │
  └── Planner informs user of decision:
       └── tell_user("Task X failed (rate limit). Retrying with backoff.")
```

### Worker-Side Failure Handling

The worker doesn't just `throw` and die. It catches errors, classifies them, and reports structured information. **Retries start from scratch** — no partial state preservation. Tasks are already scoped small by the planner, so re-executing from the beginning is simpler and more reliable than trying to resume from an unknown intermediate state.

```typescript
class Worker {
  async execute(task: Task): Promise<TaskOutput> {
    let stepsCompleted = 0;

    try {
      const result = await this.agent.generate(task.description);
      return this.extractOutput(result);
    } catch (error) {
      // Classify the error
      const category = this.classifyError(error);

      // Build structured failure report (no partial progress saved — retry from scratch)
      const report: WorkerFailureReport = {
        taskId: task.id,
        workerId: this.id,
        role: this.role,
        error: {
          category,
          message: error.message,
          code: error.code,
          toolName: error.toolName,    // set by tool wrapper
          llmStep: stepsCompleted,
        },
        progress: stepsCompleted > 0 ? {
          completedSteps: stepsCompleted,
          totalStepsAttempted: stepsCompleted + 1,
          lastStepDescription: this.lastStepDescription,
        } : undefined,
        retryGuidance: this.assessRetriability(category, error),
        usage: {
          tokensUsed: this.tokenCounter,
          wallClockMs: Date.now() - this.startTime,
          toolCallsMade: this.toolCallCount,
        },
        timestamp: Date.now(),
      };

      // Emit structured failure (orchestrator receives this, NOT a raw string)
      this.events.emit('failure', report);
    }
  }

  private classifyError(error: any): ErrorCategory {
    // Map known error patterns to categories
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND')
      return 'external_service';
    if (error.status === 429 || error.message?.includes('rate limit'))
      return 'rate_limit';
    if (error.message?.includes('context length') || error.message?.includes('token limit'))
      return 'context_exceeded';
    if (error.message?.includes('permission') || error.status === 403)
      return 'permission_denied';
    if (error instanceof TaskCancelledException)
      return 'cancelled';
    if (error.toolName)
      return 'tool_error';
    if (error.source === 'llm')
      return 'llm_error';
    return 'unknown';
  }

  private assessRetriability(
    category: ErrorCategory,
    error: any
  ): WorkerFailureReport['retryGuidance'] {
    switch (category) {
      case 'rate_limit':
        return {
          retriable: true,
          suggestedAction: 'retry',
          reason: 'Rate limit is transient. Retry after backoff.',
        };
      case 'external_service':
        return {
          retriable: true,
          suggestedAction: 'retry',
          reason: `Service ${error.code} — likely transient. Retry after delay.`,
        };
      case 'context_exceeded':
        return {
          retriable: false,
          suggestedAction: 'retry_different_approach',
          reason: 'Context window full. Task needs to be split or simplified.',
        };
      case 'permission_denied':
        return {
          retriable: false,
          suggestedAction: 'escalate',
          reason: 'Missing permissions. Needs human/admin intervention.',
        };
      case 'validation_error':
        return {
          retriable: true,
          suggestedAction: 'retry_different_approach',
          reason: 'Output didn\'t meet acceptance criteria. Refine task description.',
        };
      default:
        return {
          retriable: category !== 'cancelled',
          suggestedAction: category === 'cancelled' ? 'skip' : 'retry',
          reason: category === 'cancelled'
            ? 'Task was cancelled by orchestrator.'
            : 'Unknown error. One retry may help.',
        };
    }
  }
}
```

### Orchestrator Auto-Retry vs Planner Decision

Not every failure needs the planner's attention. Transient errors (rate limits, brief network blips) waste the planner's LLM tokens if escalated every time. The orchestrator handles these automatically:

```typescript
class Orchestrator {
  private retryCounters = new Map<string, number>();
  private readonly MAX_AUTO_RETRIES = 2;

  private async onTaskFailed(report: WorkerFailureReport): Promise<void> {
    // 1. Update task store
    await this.taskStore.fail(report.taskId, report);

    // 2. Block downstream tasks
    const downstream = await this.depResolver.getDependents(report.taskId);
    for (const taskId of downstream) {
      await this.taskStore.block(taskId, `upstream_failed:${report.taskId}`);
      this.emitToUsers('task:blocked', { taskId, reason: 'upstream_failed' });
    }

    // 3. Auto-retry for transient errors (orchestrator handles, planner not involved)
    const retryCount = this.retryCounters.get(report.taskId) || 0;

    if (this.shouldAutoRetry(report, retryCount)) {
      this.retryCounters.set(report.taskId, retryCount + 1);
      const delay = this.getRetryDelay(report.error.category, retryCount);

      // Notify user (but not planner) about auto-retry
      this.emitToUsers('task:retrying', {
        taskId: report.taskId,
        attempt: retryCount + 2,    // +2 because first attempt was #1
        reason: report.error.message,
        retryAfterMs: delay,
      });

      setTimeout(async () => {
        await this.taskStore.updateStatus(report.taskId, 'ready');
        await this.dispatchReadyTasks();
      }, delay);
      return; // Don't bother the planner
    }

    // 4. Escalate to planner (structured notification, not a raw string)
    this.notifyPlanner({
      type: 'task_failed',
      severity: report.error.category === 'cancelled' ? 'info' : 'warning',
      timestamp: report.timestamp,
      payload: {
        taskId: report.taskId,
        role: report.role,
        error: {
          category: report.error.category,
          message: report.error.message,
          code: report.error.code,
          toolName: report.error.toolName,
        },
        partialOutput: report.partialOutput,
        retryGuidance: report.retryGuidance,
        blockedDownstream: downstream,
        usage: report.usage,
        autoRetriesExhausted: retryCount,
      },
    });

    // 5. Notify users
    this.emitToUsers('task:failed', {
      taskId: report.taskId,
      role: report.role,
      error: report.error.message,
      category: report.error.category,
      hasPartialWork: !!report.partialOutput,
      blockedTasks: downstream.length,
    });

    // 6. Cleanup worker
    this.workerPool.release(report.workerId);
    this.workerTokens.delete(report.taskId);
  }

  private shouldAutoRetry(report: WorkerFailureReport, retryCount: number): boolean {
    if (retryCount >= this.MAX_AUTO_RETRIES) return false;
    // Only auto-retry transient errors
    return report.error.category === 'rate_limit'
        || report.error.category === 'external_service';
  }

  private getRetryDelay(category: ErrorCategory, attempt: number): number {
    const base = category === 'rate_limit' ? 10_000 : 5_000; // 10s for rate limit, 5s for others
    return base * Math.pow(2, attempt);  // exponential backoff: 5s, 10s, 20s
  }
}
```

### Why Retry From Scratch (Not Resume)

When a worker fails, retries start from scratch — a new worker gets the same task description and executes fresh. No partial state preservation, no "resume from step 3."

**Why this is the right call:**

1. **Tasks are already small.** The planner decomposes goals into scoped tasks. A well-scoped task takes minutes, not hours. Re-executing from scratch wastes little.
2. **Resuming is fragile.** A new worker would need to understand the old worker's intermediate state — which files were half-written, which tool outputs were cached, what the LLM's reasoning chain looked like. Reconstructing this is harder than re-doing the work.
3. **Partial state can be poisoned.** If the worker failed because of bad LLM reasoning (hallucination, wrong approach), resuming from that partial state propagates the problem. Starting fresh gives the new worker a clean shot.
4. **Simplicity.** No `savePartialProgress()`, no `loadPartialState()`, no reconciliation logic, no "is this partial output still valid?" checks. The retry path is identical to the first-run path.

**What the planner DOES get (for decision-making):**
- `progress.completedSteps` / `totalStepsAttempted` — how far the worker got
- `progress.lastStepDescription` — what it was doing when it broke
- `error.category` — what class of error (retriable? config issue?)
- `retryGuidance` — worker's self-assessment of whether retry will help

This is enough for the planner to decide: retry same task, split it smaller, change the approach, or skip.

```
Task: "Research authentication patterns for the API"

Worker fails at step 4 of 5 (MCP server down — ECONNREFUSED)

Planner receives failure notification:
  - Sees: progress.completedSteps = 3, error.category = 'external_service'
  - Sees: retryGuidance = { retriable: true, suggestedAction: 'retry' }
  - Decides: "Auto-retry exhausted (2 attempts). MCP server seems down.
              Retry the whole task but exclude MCP-dependent steps —
              update task description to skip codebase pattern search.
              Add a follow-up task for when MCP is available."
  - Actions: update_task('T-005', { description: 'Research auth patterns (skip codebase search)' })
             + add_tasks([
               { id: 'T-005b', description: 'Analyze codebase auth patterns (when MCP available)',
                 dependencies: ['T-005'] },
             ])
```

### Summary: The Complete Failure Path

```
┌────────────┐     ┌──────────────────┐     ┌────────────────┐     ┌──────────┐
│   WORKER   │     │   ORCHESTRATOR   │     │    PLANNER     │     │   USER   │
│            │     │                  │     │                │     │          │
│ Error!     │     │                  │     │                │     │          │
│ ├─classify │     │                  │     │                │     │          │
│ └─report ──┼────►│ onTaskFailed()   │     │                │     │          │
│            │     │ ├─update task DB  │     │                │     │          │
│ (dies)     │     │ ├─block downstream│     │                │     │          │
│            │     │ ├─auto-retry?────┼─No──┤                │     │          │
│            │     │ │  Yes: spawn   │     │                │     │          │
│            │     │ │  fresh worker ─┼────►│                │──►  │ retrying │
│            │     │ │  (from scratch)│     │                │     │          │
│            │     │ ├─notify planner─┼────►│ check_notifs() │     │          │
│            │     │ │  (structured)  │     │ ├─read report  │     │          │
│            │     │ │                │     │ ├─decide action │     │          │
│            │     │ │                │     │ │  retry/split/ │     │          │
│            │     │ │                │     │ │  skip/replan/ │     │          │
│            │     │ │                │     │ │  escalate     │     │          │
│            │     │ │                │     │ └─tell_user()──┼────►│ update   │
│            │     │ │                │     │                │     │          │
│            │     │ └─notify user───┼─────┼────────────────┼────►│ failed   │
│            │     │   (Socket.IO)   │     │                │     │          │
└────────────┘     └──────────────────┘     └────────────────┘     └──────────┘
```

This closes the loop. The worker failure path is no longer `reportFailure(id, string)` — it's a structured pipeline where the worker classifies, the orchestrator triages (auto-retry transients, escalate the rest), the planner decides strategy, and the user stays informed throughout.

---

## Plan Schema (Planner → Orchestrator Contract)

```typescript
interface Plan {
  id: string;
  goal: string;
  strategy: string;               // Planner's reasoning for this approach
  tasks: PlanTask[];
  metadata: {
    estimatedComplexity: 'low' | 'medium' | 'high';
    requiresApproval: boolean;
  };
}

interface PlanTask {
  id: string;
  description: string;
  assignedRole: string;            // lowercase role key
  dependencies: string[];          // task IDs this depends on
  contextFromTasks: string[];      // which prior task outputs to pass as context
  acceptanceCriteria: string;      // how to know task is done
}
```

## Key Benefit: Swappable Planners

Different situations demand different planning strategies. The planner agent is swappable — same orchestrator, different brain.

### Planner Types

| Planner Type | When to Use | Instructions Focus | Risk Style |
|---|---|---|---|
| **Simple List** | Small tasks, single-role, low risk | "Create a linear list of steps" | Minimal analysis |
| **DAG Planner** | Multi-role, parallel work, medium complexity | "Identify dependencies, maximize parallelism, flag bottlenecks" | Dependency risk mapping |
| **Iterative Planner** | Exploratory, unknown scope, R&D | "Start with research task, plan next steps based on findings, budget experiments" | Uncertainty budgeting |
| **Human-Hybrid** | High stakes, needs oversight, production changes | "Propose plan, present risk assessment, request approval before each phase" | Full risk review gates |
| **External Planner** | Third-party AI or human PM | Orchestrator exposed via MCP (Option B), driven externally | External risk framework |

### Planner Capabilities Matrix

Every planner type should be capable of these core functions, with varying depth:

| Capability | What It Means | Why It Matters |
|---|---|---|
| **Goal Decomposition** | Break vague goal into concrete, assignable tasks | Workers can't execute ambiguity |
| **Risk Assessment** | Identify what could go wrong before execution starts | Avoids wasted cycles on doomed approaches |
| **Dependency Analysis** | Map which tasks block which, find critical path | Prevents idle workers waiting on bottlenecks |
| **Resource Matching** | Match tasks to the right agent roles/skills | Wrong agent on wrong task = rework |
| **Effort Estimation** | Gauge complexity per task (low/medium/high) | Helps prioritize and set expectations |
| **Contingency Planning** | Define fallback if a task or approach fails | Failures don't stall the entire project |
| **Progress Evaluation** | Assess completed work against the plan | Detects drift before it compounds |
| **Adaptive Replanning** | Revise plan mid-flight based on new information | Plans never survive first contact — the planner must adapt |

### Risk Assessment Framework

The planner should produce structured risk assessments alongside every plan:

```typescript
interface PlanRiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  
  risks: Array<{
    id: string;
    description: string;                    // "API design may not support real-time updates"
    probability: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    affectedTasks: string[];                // task IDs at risk
    mitigation: string;                     // "Design API with WebSocket from start"
    contingency: string;                    // "Fall back to polling if WebSocket fails"
  }>;

  assumptions: string[];                    // "Assumes MongoDB is available"
  unknowns: string[];                       // "Don't know the data volume yet"
  
  criticalPath: string[];                   // task IDs on the critical path
  parallelizableGroups: string[][];         // groups of tasks that can run simultaneously
}
```

### Planner Decision Loop

The planner doesn't just plan once. It runs a continuous decision loop:

```
1. RECEIVE goal/update
   │
2. ASSESS current state (read L2: task outputs, failures, blockers)
   │
3. ANALYZE risks (what could go wrong from here?)
   │
4. DECIDE action:
   │  ├── CREATE plan (first time)
   │  ├── CONTINUE (everything on track)
   │  ├── REPLAN (something failed or scope changed)
   │  ├── ESCALATE (risk too high, need human decision)
   │  └── COMPLETE (all tasks done, goal met)
   │
5. EXECUTE decision via orchestrator tool
   │
6. MONITOR → back to step 2
```

This loop is what makes the planner the **leader**, not just a plan generator. It stays engaged throughout execution, steering the team like a PM who's actually paying attention.

---

## Memory Access Design

### The Question
Should the planner have its own L1-Memory, or use L2 directly as its memory?

### L1 Split: Memory vs Workspace

L1 has two distinct concerns that should not be conflated:

```
L1-Memory:    What an agent remembers (conversation, reasoning, working notes)
L1-Workspace: What an agent works on (31 tools: file CRUD, grep/glob, scratchpad/todo, keyword search, identity, code intel, git, sandbox)
```

But not every agent needs the same memory model.

### Decision: Planner uses L2. Workers use L1-Memory.

**The planner's memory IS L2.** Everything the planner thinks, decides, and reasons about is inherently team knowledge — plans, risk assessments, decision rationale, replanning context. There's nothing private about "I chose approach A because of risk X." In fact, everyone benefits from seeing it.

**Workers keep L1-Memory.** A worker's intermediate reasoning ("tried path X, got error, switched to Y") is implementation noise — useful locally during execution but not worth broadcasting to every team member in real-time.

```
┌──────────────────────────────────────────────────────────────────┐
│                        MEMORY MODEL                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PLANNER (no L1-Memory — uses L2 directly)                      │
│  ├── LLM message array (in-process, transient during call)      │
│  └── Persistent memory → writes directly to L2:                 │
│       ├── Plans and revisions                                    │
│       ├── Risk assessments                                       │
│       ├── Decision rationale ("chose A over B because...")       │
│       ├── Replanning context ("task X failed, pivoting to Y")   │
│       └── Goal progress notes                                   │
│       All of this is team knowledge. Nothing is private.         │
│                                                                  │
│  WORKERS (L1-Memory + L1-Workspace)                             │
│  ├── L1-Memory (local, in-process):                             │
│  │    ├── Conversation history with LLM                         │
│  │    ├── Working notes, reasoning log                           │
│  │    ├── Tool call history                                      │
│  │    └── Summarized → L2 on task completion                    │
│  │                                                               │
│  └── L1-Workspace (31 tools, per-task):                         │
│       ├── File CRUD (create, read, write, delete, exists, list) │
│       ├── Search (grep, glob, keyword_search, search_and_replace)│
│       ├── Scratchpad (scratch_note, scratch_todo, scratch_remember, scratch_file, promote_to_workspace) │
│       ├── Identity (whoami, my_progress, my_tools, my_context)  │
│       ├── Code intel (get_repo_map, get_symbols, find_symbol, get_dependencies, get_file_summary) │
│       ├── Git branch (per-task), commit, history                │
│       ├── Lifecycle (publish, reactivate, discard)              │
│       └── Sandbox (command execution)                            │
│                                                                  │
│  L2 (Shared Team Memory — always alive)                         │
│  ├── Planner's memory lives here (direct read/write)            │
│  ├── Worker output summaries land here (on completion)          │
│  ├── CRDT docs, manifests, group chat                           │
│  └── Searchable by all agents                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Why This Is Better Than "Every Agent Gets L1-Memory"

| Concern | L1-Memory for Planner (rejected) | L2 as Planner Memory (chosen) |
|---|---|---|
| **Visibility** | Planner reasoning hidden until task ends | Planner reasoning visible immediately to team and humans |
| **Persistence** | Must summarize + write to L2 manually | Already in L2 — no extra step |
| **Resume** | Must reload from L2 summary (lossy) | Already in L2 — full fidelity on resume |
| **Auditability** | Must extract from agent internals | Every decision already in shared store — auditable by default |
| **Duplicate state** | Planner has local copy + L2 copy → sync risk | Single source of truth in L2 |
| **Worker access** | Workers can't see planner reasoning until summary | Workers can read planner's rationale from L2 in real-time |

The planner is the team leader. Its thinking IS team context. Hiding it in local memory and summarizing later is like a PM who writes notes in a private notebook and only shares them at the end of the project.

### What About Speed?

**"Won't L2 be slower than in-process L1-Memory?"**

In practice, no — and here's why:
- The planner makes **low-frequency, high-impact decisions** (create plan, assess risk, replan). It's not a tight loop making 100 decisions per second. One L2 write per decision is fine.
- The LLM call itself is the bottleneck (1-30 seconds). An L2 write (~5-50ms) is noise in comparison.
- The planner's **LLM message array** (conversation with the model) still lives in-process during the `generate()`/`stream()` call. That's not L1-Memory — that's just how AI SDK works. It's transient and automatic.

Workers are different. They call tools rapidly (read file → search → read another file → write). Local L1-Memory avoids a network hop on every reasoning step.

### How Planner Memory Works in L2

```typescript
// Planner writes to L2 as it works — not at the end, but in real-time

// When planner creates a plan:
await l2_write({
  type: 'plan',
  id: plan.id,
  content: plan,
  metadata: { goal, timestamp, version: 1 }
});

// When planner assesses risk:
await l2_write({
  type: 'risk_assessment',
  planId: plan.id,
  content: riskAssessment,
});

// When planner replans:
await l2_write({
  type: 'replan_decision',
  planId: plan.id,
  content: { 
    reason: "Task T-003 failed: API rate limit hit",
    decision: "Split API calls across 2 workers",
    previousPlanVersion: 1,
    newPlanVersion: 2,
  }
});

// When planner resumes (new session for same goal):
const priorPlans = await l2_search({ type: 'plan', goalId });
const priorDecisions = await l2_search({ type: 'replan_decision', goalId });
// Planner has full context — nothing lost
```

### Worker Memory Flow (L1-Memory → L2 Summary)

Workers still use L1-Memory locally, and summarize to L2 on completion:

```
Worker executing task:
  LLM call → message array (in-process, transient)
  Reasoning → stored in L1-Memory (local, fast)
  Tool calls → logged in L1-Memory
  
Worker completes task:
  L1-Memory → summarize → write to L2:
    "Completed API design. Chose REST (rationale: ...). Created 3 files."
  L1-Workspace → git commit (A8)
  
Worker dies/crashes:
  L1-Memory lost (ephemeral). This is OK — task will be retried from scratch on fresh worker.
  L1-Workspace discarded. Retries start clean — no partial state to reconcile.
```

### Why Planner Doesn't Need L1-Workspace

| Reason | Explanation |
|---|---|
| **L1-Workspace is worker territory** | Files, code, search — belongs to the worker executing the task |
| **Scope boundary** | Planner plans *what* to do, workers do the *how*. Planner shouldn't read source code. |
| **Context pollution** | Workspace has raw files. Planner needs *summaries and outputs*, which workers write to L2. |
| **Multiple workspaces** | Each worker has its own. Which one would the planner read? |

If the planner needs to know "what files exist" or "what was built":
1. **Workers write output summaries to L2** — on task completion
2. **Orchestrator's `get_status()` tool** — task states + output summaries from TaskStore
3. **L2 output manifests** — structured records of what each task produced

### Updated Summary

| Layer | Planner | Worker | Orchestrator |
|---|---|---|---|
| **Task State** | ✅ Query via orchestrator tools | ✅ Read own task + report completion | ✅ **Owns it** (single writer) |
| **L1-Memory** | ❌ Doesn't need — uses L2 directly | ✅ Local memory (conversation, reasoning, working notes) | ❌ Not an agent |
| **L1-Workspace** | ❌ None | ✅ Full (31 tools: file CRUD, grep/glob, scratchpad/todo, keyword search, identity, code intel, git, sandbox) | ❌ None |
| **L2** (shared) | ✅ **IS its memory** (plans, decisions, reasoning — all written directly) | ✅ Read/write (outputs, summaries on completion) | ✅ Direct (execution logs) |
| **L3** (knowledge) | 🔮 Future (read-only) | 🔮 Future (read-only) | ❌ None |

### Component Map (Final)

| Component | Role | Lifecycle | Analogy |
|---|---|---|---|
| **Orchestrator** | Runtime + task master. Always alive. Spawns agents, manages task state, dispatches, reacts to events. | Singleton per team — lives as long as team exists | Construction site + foreman |
| **Planner** | Strategic brain. Decides WHAT. Plans, risk, replanning. Memory lives in L2 (shared). | Spawned by Orchestrator per goal. Dies when goal completes. | Architect — thinking on the whiteboard, visible to everyone |
| **Workers** | Executors. Do the work. Report back. L1-Memory (local) + L1-Workspace (files/code). | Spawned by Orchestrator per task. Ephemeral. | Tradespeople with their own notepad and toolbench |
| **L1-Memory** | Per-worker local memory. Conversation, reasoning, tool history. Workers only. | Task duration. Summarized to L2 on completion. | Worker's personal notepad |
| **L1-Workspace** | Per-worker workspace. 31 tools: file CRUD, grep/glob, scratchpad/todo, keyword search, identity, code intel, git, sandbox. Workers only. | Created per task, persisted as git branch (A8). | Worker's toolbench |
| **L2** | Shared team memory. Plans (planner's memory), outputs, docs, search. | Always alive. | Project wiki + whiteboard |
| **MemoryManager** | **REMOVED** — task state → Orchestrator's TaskStore. Planner memory → L2. Worker memory → L1-Memory. | N/A | N/A |

---

## L2 as the Collaboration Backbone: How the Planner + Orchestrator Leverage L2

### The Core Insight

Ping's goal is **collaboration**. Not just task dispatch — real collaboration where agents share context, build on each other's work, and the planner makes informed decisions. **L2 is the medium through which collaboration happens.** Without L2 search and shared memory, agents are isolated workers posting to a bulletin board. With L2, they're a team thinking together.

The Planner is the leader. L2 is the shared whiteboard the leader writes on and reads from. The Orchestrator is the runtime that makes the whiteboard accessible to everyone.

### Three Collaboration Dimensions L2 Enables

```
┌─────────────────────────────────────────────────────────────────────────┐
│              L2-POWERED COLLABORATION MODEL                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. PLANNER → L2: Strategic Context (the leader's whiteboard)          │
│     ├── Plans, revisions, risk assessments                              │
│     ├── Decision rationale ("chose REST over GraphQL because...")       │
│     ├── Replanning context ("task T-003 failed, pivoting to Y")        │
│     └── ALL searchable. Workers read this to understand WHY.            │
│                                                                         │
│  2. WORKERS → L2: Execution Artifacts (the team's output)              │
│     ├── Output summaries on task completion                             │
│     ├── Discoveries during execution ("found rate limit on API")       │
│     ├── Artifact manifests (what was produced, where it lives)          │
│     └── Searchable by planner + other workers for context injection.   │
│                                                                         │
│  3. L2 → PLANNER: Informed Replanning (the feedback loop)              │
│     ├── Planner searches L2 for prior work before planning             │
│     ├── Planner searches L2 for failure patterns before replanning     │
│     ├── Planner finds cross-task insights that no single worker sees   │
│     └── THIS is where collaboration becomes intelligence.               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### How the Planner Leverages L2 for Better Planning

The Planner doesn't plan in a vacuum. L2 gives it the team's collective memory. Every planning decision improves when the planner can search what came before.

#### 1. Context-Aware Initial Planning

Before creating a plan, the planner searches L2 for related prior work:

```
User: "Build a REST API for user management"

Planner (before calling create_plan):
  l2_search("REST API")          → finds: prior team built a REST API for products
  l2_search("user management")   → finds: researcher wrote analysis of auth patterns
  l2_search("API design risk")   → finds: prior plan flagged rate limiting as a risk

Planner now creates a BETTER plan because it:
  ✅ Reuses patterns from prior REST API work (faster)
  ✅ Incorporates researcher's auth analysis (no duplicate research)
  ✅ Pre-mitigates rate limiting risk (learned from team history)
```

Without L2 search, the planner would start from scratch every time — ignoring the team's accumulated knowledge.

#### 2. Context Injection into Task Descriptions

When the planner writes task descriptions, it can pull relevant L2 content and inject it as context:

```typescript
// Planner creates task with L2 context baked in
const priorApiDesigns = await l2_search({ query: "API design patterns", type: "output_summary" });
const knownRisks = await l2_search({ query: "API rate limit mitigation", type: "risk_assessment" });

const task: PlanTask = {
  id: "T-002",
  description: "Design REST API for user CRUD operations",
  assignedRole: "developer",
  contextFromL2: [
    { source: priorApiDesigns[0].id, summary: "Prior API used Express + Zod validation" },
    { source: knownRisks[0].id, summary: "Rate limiting was a problem — use token bucket" },
  ],
  acceptanceCriteria: "OpenAPI spec with rate limit middleware included",
};
```

This is **collaboration through context** — the planner distills team knowledge into actionable guidance for each worker.

#### 3. Failure-Informed Replanning

When a task fails, the planner doesn't just retry blindly. It searches L2 for patterns:

```
Task T-003 failed: "MongoDB connection timeout"

Planner searches L2:
  l2_search("MongoDB timeout")     → finds: happened twice before in similar scenarios
  l2_search("database connection") → finds: worker discovered connection pool exhaustion
  l2_search("T-003 context")       → finds: worker's output summary before failure

Planner replans with INSIGHT:
  "MongoDB timeouts are recurring. Root cause: connection pool exhaustion
   under concurrent writes. Split T-003 into sequential subtasks instead
   of parallel. Add connection pool monitoring to T-001."

vs. without L2:
  "T-003 failed. Retry T-003." (learns nothing)
```

#### 4. Cross-Task Pattern Recognition

The planner can see patterns that no individual worker sees because it has L2 search across ALL task outputs:

```
Planner periodic assessment (via decision loop):
  l2_search("error")        → 3 workers hit the same CORS error independently
  l2_search("blocked")      → 2 workers waiting on the same missing env variable

Planner insight (only possible with L2 search):
  "Multiple workers hitting CORS errors. This is a shared infrastructure problem,
   not a per-task bug. Creating new task: 'Fix CORS config' and assigning to
   devops role as P0 blocker."
```

This is **emergent collaboration** — the planner acts as the "brain" that connects dots across the team's distributed work.

### How the Orchestrator Surfaces L2 to the Planner

The Orchestrator is the runtime that gives the Planner its tools. This includes L2 tools:

```typescript
// Orchestrator injects L2 tools when spawning the planner
const planner = new Agent({
  tools: {
    // Orchestrator's own tools
    orchestrate:      this.createOrchestrateTool(),
    get_status:       this.createStatusTool(),
    get_blocked:      this.createBlockedTool(),
    get_critical_path: this.createCriticalPathTool(),
    
    // L2 tools — the collaboration layer
    l2_search:        this.createL2SearchTool(),
    l2_read:          this.createL2ReadTool(),
    l2_write:         this.createL2WriteTool(),
    l2_list:          this.createL2ListTool(),
  },
});
```

#### L2 Tool Specifications for the Planner

| Tool | Purpose | When Planner Uses It |
|------|---------|------|
| `l2_search(query)` | BM25 + fuzzy keyword search across all L2 content | Before planning (find prior work), during replanning (find failure patterns), during assessment (find cross-task patterns) |
| `l2_read(docId)` | Read a specific L2 document by ID | After search finds a relevant document — read full content |
| `l2_write(doc)` | Write a document to L2 (plans, decisions, assessments) | After every planning decision — write rationale immediately |
| `l2_list(filter)` | List L2 documents by type/date/author | Broad discovery — "what has the team produced this session?" |

### How Workers Leverage L2 for Collaboration

Workers don't just consume L2 — they contribute to it, creating a feedback loop:

```
┌──────────────────────────────────────────────────────────────────┐
│                  WORKER ↔ L2 COLLABORATION FLOW                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BEFORE EXECUTION (Worker reads L2):                            │
│  ├── Read planner's rationale: WHY this task exists             │
│  ├── Read related task outputs: What prior workers discovered   │
│  ├── Read risk assessments: Known pitfalls to avoid             │
│  └── Worker starts informed, not blind                          │
│                                                                  │
│  DURING EXECUTION (Worker works in L1):                         │
│  ├── L1-Memory: local reasoning, tool calls, intermediate notes │
│  ├── L1-Workspace: files, code, search, git                    │
│  └── Optionally: write urgent discoveries to L2 mid-task        │
│       e.g., "ALERT: API rate limit is 100/min not 1000/min"     │
│                                                                  │
│  AFTER EXECUTION (Worker writes L2):                            │
│  ├── Output summary: what was produced                          │
│  ├── Discoveries: what was learned                              │
│  ├── Artifacts: where files/code live (manifest)                │
│  └── This feeds the planner's next decision cycle               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### L2 Search Powers Group Chat Collaboration

When workers enter a [Group Chat session](../../ping/group-chat-architecture.md), L2 search provides the shared context that makes the discussion productive:

```
Orchestrator creates Group Chat session (Writer + Editor):
  │
  ├── Pre-loads L2 context into the session:
  │    l2_search("writing style guide")  → team's agreed style
  │    l2_search("draft outline")        → what the planner decided
  │    l2_search("target audience")      → researcher's findings
  │
  ├── Both workers enter the chat PRE-INFORMED
  │    instead of starting "so what are we supposed to do?"
  │
  └── Group chat outcome → written to L2:
       "Writer and Editor agreed: formal tone for intro, casual for examples.
        Writer owns sections 1-3, Editor reviews 2-3 after first draft."
       
       This decision is now searchable for future reference.
```

Without L2 search feeding into group chat, workers would enter blind and waste turns re-establishing context they could have just read.

### The Collaboration Loop (Why This Matters for Ping)

Ping's goal is collaboration. Here's how L2 makes collaboration **systemic**, not accidental:

```
                    ┌─────────────────────┐
                    │                     │
     ┌──────────────┤   L2 SHARED MEMORY  ├──────────────┐
     │              │   (CRDT + Search)   │              │
     │              │                     │              │
     │              └──────┬──────────────┘              │
     │                     │                             │
     │            ┌────────┴────────┐                    │
     │            │                 │                    │
     ▼            ▼                 ▼                    │
  ┌───────┐  ┌────────┐  ┌──────────────┐              │
  │PLANNER│  │WORKERS │  │ GROUP CHATS  │              │
  │       │  │        │  │              │              │
  │ reads │  │ read   │  │ pre-loaded   │              │
  │ L2 to │  │ L2 for │  │ with L2      │              │
  │ plan  │  │ context│  │ context      │              │
  │       │  │        │  │              │              │
  │writes │  │ write  │  │ outcomes     │              │
  │plans  │  │outputs │  │ written      │──────────────┘
  │to L2  │  │to L2   │  │ to L2        │
  └───────┘  └────────┘  └──────────────┘
  
  EVERY participant reads from AND writes to L2.
  Knowledge compounds. Nothing is lost. Nothing is private.
  The team gets SMARTER over time because L2 remembers everything.
```

### Concrete L2 Search Queries the Planner Should Make

| Planning Phase | L2 Search Query | What It Finds | How It Helps |
|---|---|---|---|
| **Goal received** | `"{goal keywords}"` | Prior work on similar goals | Avoid duplicate effort |
| **Before decomposition** | `"risk" AND "{domain}"` | Historical risk assessments | Pre-mitigate known risks |
| **Before role assignment** | `"role:{role} output"` | What this role has produced before | Match task complexity to role capability |
| **Before creating plan** | `type:plan goal:"{similar}"` | Prior plans for similar goals | Reuse proven task structures |
| **During execution monitoring** | `type:output_summary status:completed` | Recently completed work | Track real progress vs plan |
| **On task failure** | `"error" OR "failed" AND "{error message}"` | Prior failures with same error | Find known fixes, avoid repeated failures |
| **On replanning** | `type:replan_decision` | Prior replanning decisions | Learn from past pivots |
| **On cross-task issues** | `"blocked" OR "waiting" OR "error"` | Common blockers across workers | Detect systemic issues (infra, config) |

### L2 Document Types for Collaboration

To make L2 search effective, documents need structured types:

```typescript
type L2DocumentType =
  // Planner writes these
  | 'plan'                    // Full plan with tasks
  | 'plan_revision'           // Updated plan after replan
  | 'risk_assessment'         // Risk analysis
  | 'decision_rationale'      // Why approach A was chosen over B
  | 'replan_decision'         // What changed and why
  | 'goal_progress'           // Periodic assessment

  // Workers write these  
  | 'output_summary'          // What the task produced
  | 'discovery'               // Something learned during execution
  | 'artifact_manifest'       // Structured record of files/outputs
  | 'alert'                   // Urgent finding (e.g., rate limit)

  // Group chats produce these
  | 'collaboration_outcome'   // Agreed decisions from group chat
  | 'action_items'            // Next steps from discussion

  // Orchestrator writes these
  | 'execution_log'           // Task state transitions
  | 'incident'                // Worker death, stall, etc.

interface L2Document {
  id: string;
  type: L2DocumentType;
  teamId: string;
  goalId: string;
  authorRole: string;            // "planner", "developer", "researcher"
  authorTaskId?: string;         // which task produced this
  content: any;                  // structured content
  tags: string[];                // searchable tags
  timestamp: Date;
  version: number;               // CRDT version
}
```

### Why This Makes Ping Different

Most AI orchestration platforms treat agents as **isolated workers** with a **shared task queue**. The task list is the only shared state. This is like a company where employees only communicate via a ticketing system — technically functional, but terrible collaboration.

Ping with L2 search gives agents a **shared brain**:

| Without L2 Search | With L2 Search |
|---|---|
| Planner creates plan from goal alone | Planner searches prior work, incorporates team knowledge into plan |
| Worker starts each task blind | Worker reads planner's rationale + related outputs before starting |
| Task failure → retry the same way | Task failure → planner searches for patterns, replans intelligently |
| Group chat → workers re-establish context from scratch | Group chat → pre-loaded with relevant L2 context |
| Knowledge dies when a task ends | Knowledge persists in L2, searchable forever |
| Each goal starts from zero | Each goal builds on team's accumulated intelligence |

**This is what collaboration means in Ping.** Not just "agents work on different tasks." Real collaboration: agents share context, learn from each other, and the planner synthesizes it all into better decisions. L2 is the medium. Search is the mechanism.
