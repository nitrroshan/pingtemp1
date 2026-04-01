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
        └── search_agents(capability)→ Registry: find available agents/roles

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
Goal → Research domain → Analyse requirements → Assess team capabilities
     → Reason about trade-offs → Build dependency graph → Submit plan
     → Monitor execution → Replan when needed
```
Multiple LLM calls with tools in between. The planner gathers real knowledge before committing to a plan.

### The Planner's Cognitive Workflow

The planner follows a mandatory multi-step workflow. It MUST NOT skip straight to plan generation.

```
┌─────────────────────────────────────────────────────────┐
│                PLANNER COGNITIVE LOOP                    │
│                                                         │
│  1. RESEARCH                                            │
│     │  Call research tools to understand the domain.    │
│     │  Topics: architecture patterns, tech stack,       │
│     │  common pitfalls, prior art, best practices.      │
│     │  Can call multiple times for different angles.    │
│     ▼                                                   │
│  2. ANALYSE                                             │
│     │  Decompose the goal into components.              │
│     │  Identify hard vs soft constraints.               │
│     │  Surface risks, unknowns, assumptions.            │
│     ▼                                                   │
│  3. ASSESS TEAM                                         │
│     │  Query available roles and their capabilities.    │
│     │  Match task types to roles. Identify gaps.        │
│     ▼                                                   │
│  4. REASON                                              │
│     │  Weigh trade-offs (speed vs quality vs risk).     │
│     │  Choose an approach with explicit rationale.      │
│     │  The planner's chain-of-thought is visible in L2. │
│     ▼                                                   │
│  5. PLAN                                                │
│     │  Call submit_plan with a dependency-aware DAG.    │
│     │  Inject research findings into task context.notes │
│     │  so workers get domain knowledge for free.        │
│     ▼                                                   │
│  6. MONITOR & ADAPT                                     │
│     │  Read execution progress via orchestrator tools.  │
│     │  Replan if tasks fail or scope changes.           │
│     └──────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────────┘
```

### Planner Tools: Two Categories

The planner's tools fall into two groups:

**Knowledge Tools** — how the planner learns before planning:

| Tool | Purpose | When Used |
|---|---|---|
| `research_domain` | Query an LLM/knowledge source for domain expertise. Architecture patterns, tech stack analysis, best practices, pitfalls. Can be called multiple times with different topics. | Step 1 — always before planning |
| `analyze_requirements` | Decompose a goal into components, constraints, risks, and unknowns. Returns structured analysis. | Step 2 — after initial research |
| `get_team_capabilities` | Query available roles and what each can do. Maps role → skills/tools/limitations. | Step 3 — before assigning tasks to roles |
| `get_context` | Search L2 shared memory for prior work, past plans, prior failures, related outputs. | Steps 1-4 — whenever prior context exists |

**Execution Tools** — how the planner drives the orchestrator:

| Tool | Purpose | When Used |
|---|---|---|
| `submit_plan` | Submit a complete task plan to the orchestrator for approval and execution. | Step 5 — only after research and analysis |
| `get_status` | Query current task states, progress, completions, failures. | Step 6 — during monitoring |
| `get_blocked` | Get blocked tasks and their reasons. | Step 6 — when tasks stall |
| `get_critical_path` | Get the longest dependency chain (bottleneck). | Steps 4-6 — for scheduling reasoning |
| `cancel_task` | Cancel a running or pending task. | Step 6 — during replanning |
| `request_approval` | Pause and request human approval before proceeding. | Any step — when stakes are high |
| `search_agents` | Look up agent registry for available capabilities/roles. | Step 3 — team assessment |

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
  
  async reportFailure(taskId: string, error: string): Promise<void> {
    await this.taskStore.fail(taskId, error);
    this.notifyPlanner({ type: 'task_failed', taskId, error });
    // Planner decides whether to replan — orchestrator just reports
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
      worker.on('failure', (error) => this.onTaskFailed(task.id, error));
      
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

  private async onTaskFailed(taskId: string, error: string): Promise<void> {
    await this.taskStore.fail(taskId, error);
    // Orchestrator doesn't decide what to do — it notifies the planner
    // The planner's tool call will return this failure info
    // Planner decides: replan, retry, escalate, or abort
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
L1-Workspace: What an agent works on (files, code, search, git, sandbox)
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
│  └── L1-Workspace (files, code, per-task):                      │
│       ├── Files and code artifacts                               │
│       ├── Local search index (MiniSearch)                        │
│       ├── Git branch (per-task)                                  │
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
  L1-Memory lost (ephemeral). This is OK — task will be retried on fresh worker.
  L1-Workspace persists if git committed (partial progress saved).
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
| **L1-Workspace** | ❌ None | ✅ Full (files, code, search, git, sandbox) | ❌ None |
| **L2** (shared) | ✅ **IS its memory** (plans, decisions, reasoning — all written directly) | ✅ Read/write (outputs, summaries on completion) | ✅ Direct (execution logs) |
| **L3** (knowledge) | 🔮 Future (read-only) | 🔮 Future (read-only) | ❌ None |

### Component Map (Final)

| Component | Role | Lifecycle | Analogy |
|---|---|---|---|
| **Orchestrator** | Runtime + task master. Always alive. Spawns agents, manages task state, dispatches, reacts to events. | Singleton per team — lives as long as team exists | Construction site + foreman |
| **Planner** | Strategic brain. Decides WHAT. Plans, risk, replanning. Memory lives in L2 (shared). | Spawned by Orchestrator per goal. Dies when goal completes. | Architect — thinking on the whiteboard, visible to everyone |
| **Workers** | Executors. Do the work. Report back. L1-Memory (local) + L1-Workspace (files/code). | Spawned by Orchestrator per task. Ephemeral. | Tradespeople with their own notepad and toolbench |
| **L1-Memory** | Per-worker local memory. Conversation, reasoning, tool history. Workers only. | Task duration. Summarized to L2 on completion. | Worker's personal notepad |
| **L1-Workspace** | Per-worker workspace. Files, code, search, git, sandbox. Workers only. | Created per task, persisted as git branch (A8). | Worker's toolbench |
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
