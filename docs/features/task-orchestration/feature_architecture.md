# Task Orchestration — Feature Architecture

**Status:** New  
**Date:** March 30, 2026  
**ID:** A6  
**Depends on:** A5 (Planner as Agent)

---

## Overview

Task Orchestration is the **execution runtime** — the machinery that takes a plan and makes it happen. It stores tasks, resolves dependencies, dispatches workers, tracks completion, handles failures, and provides real-time visibility.

This is distinct from the Planner (A5), which decides **what** to do. Task Orchestration decides **how** to execute it.

```
A5 (Planner as Agent):           A6 (Task Orchestration):
  Goal decomposition               Task storage (TaskStore)
  Risk assessment                   DAG dependency resolution
  Replanning decisions              Parallel worker dispatch
  Strategy & approach               Context flow between tasks
  When to retry vs abort            Failure detection & reporting
  L2 memory (shared knowledge)      Watchdog (stall/death detection)
                                    Concurrency management
                                    State machine enforcement
```

### Current State
- `MemoryManager` stores tasks with `status`, `assigned_role`, `prerequisites: Map<string, boolean>`
- Tasks are ready when all prerequisites are true
- `RoleTaskQueue` serializes per-role, no cross-role coordination
- No parallel execution tracking, no retry mechanism, no context inheritance
- No DAG — just flat prerequisite maps

### Target State
- Tasks form a **DAG** with typed edges (`blocks`, `informs`)
- Parallel tasks execute concurrently when deps are met
- Failed tasks reported to Planner — Planner decides response
- Task context (inputs, outputs, artifacts) flows through the DAG
- Real-time visibility via stream events + dashboard telemetry
- Single-writer pattern — only the Orchestrator writes task state

---

## Separation of Concerns: Planner vs Orchestrator

| Concern | Planner (A5) | Task Orchestration (A6) |
|---|---|---|
| **Creating tasks** | Calls `create_plan` tool with task list | Stores tasks in TaskStore, validates DAG |
| **Dependencies** | Defines deps in plan (`T-003 depends on T-001, T-002`) | DependencyResolver enforces them — blocks dispatch until met |
| **Dispatch** | Doesn't dispatch — submits a plan | Spawns workers for all ready tasks |
| **Parallel execution** | Marks which tasks CAN be parallel | WorkerPool runs them concurrently, bounded by config |
| **Progress tracking** | Queries via `get_status`, `get_blocked` tools | TaskStore tracks all state, serves queries |
| **Failure response** | DECIDES: retry, replan, skip, or abort | DETECTS failure, reports to Planner |
| **Context flow** | Specifies `contextFromTasks` in plan | Stores outputs, injects into downstream tasks |
| **Stall detection** | Receives stall notifications, decides response | Watchdog monitors heartbeats, escalates to Planner |
| **Visibility** | — | Emits `task-started/completed/failed` events to frontend |

---

## Task Lifecycle

```
                    Planner calls create_plan
                            │
                            ▼
                     ┌──────────┐
                     │ proposed  │  Plan submitted, awaiting approval
                     └─────┬────┘
                           │ User approves
                           ▼
                     ┌──────────┐
                     │  ready   │  All dependencies met (or none)
                     └─────┬────┘
                           │ Orchestrator dispatches worker
                           ▼
                     ┌──────────────┐
                     │ in_progress  │  Worker executing
                     └──┬────────┬─┘
                        │        │
                  success│        │failure
                        ▼        ▼
                 ┌───────────┐ ┌────────┐
                 │ completed │ │ failed │
                 └───────────┘ └───┬────┘
                                   │
                          Planner decides:
                          ├── retry (same task, fresh worker)
                          ├── replan (revise affected tasks)
                          ├── skip (mark optional, continue)
                          └── abort (stop goal)
```

### State Transitions (Single Writer)

Only the Orchestrator transitions task state. No one else writes.

| Transition | Trigger | Orchestrator Action |
|---|---|---|
| `proposed → ready` | User approves plan, deps already met | Check dependencies, mark ready |
| `proposed → pending` | User approves plan, deps not met | Wait for upstream tasks |
| `pending → ready` | Upstream task completes | DependencyResolver re-evaluates |
| `ready → in_progress` | Orchestrator dispatches | Spawn worker, assign task |
| `in_progress → completed` | Worker reports success | Store output, resolve downstream deps, dispatch newly ready tasks |
| `in_progress → failed` | Worker reports failure | Mark failed, notify Planner |
| `failed → ready` | Planner calls retry | Reset task, fresh worker |
| `* → cancelled` | Planner calls cancel or replan | Clean up worker if running |

---

## DAG: How Dependencies Work

Tasks form a directed acyclic graph. Each dependency has a type:

```
research ──blocks──→ design ──blocks──→ implement ──blocks──→ test
                        └──informs──→ docs ──────────blocks──↗
```

### Dependency Types

| Type | Meaning | Behavior |
|---|---|---|
| `blocks` | Downstream can't start until upstream completes | Strict — task stays `pending` |
| `informs` | Downstream benefits from upstream output but can start without it | Soft — task can start, output injected later if available |

### DependencyResolver

```typescript
class DependencyResolver {
  // Check which tasks are ready to run
  resolveReady(tasks: Task[]): Task[] {
    return tasks.filter(task => {
      if (task.status !== 'pending') return false;
      const blockingDeps = task.dependencies
        .filter(d => d.type === 'blocks');
      return blockingDeps.every(d => d.upstreamTaskCompleted);
    });
  }

  // Which tasks are stuck and why
  getBlocked(): BlockedTask[] {
    return tasks
      .filter(t => t.status === 'pending')
      .map(t => ({
        id: t.id,
        blockedBy: t.dependencies
          .filter(d => d.type === 'blocks' && !d.upstreamTaskCompleted)
          .map(d => d.upstreamTaskId),
      }))
      .filter(t => t.blockedBy.length > 0);
  }

  // Longest chain of blocking dependencies
  getCriticalPath(): string[] {
    // Topological sort, find longest path through blocking edges
    return this.longestPath(this.buildBlockingDAG());
  }
}
```

### Cycle Detection

Plans are LLM-generated — they could contain cycles. The Orchestrator validates on submission:

```typescript
async orchestrate(plan: Plan): Promise<void> {
  if (this.depResolver.hasCycle(plan.tasks)) {
    throw new Error(`Plan contains dependency cycle: ${this.depResolver.describeCycle(plan.tasks)}`);
    // Planner gets this error and must fix the plan
  }
  // ... store tasks, resolve, dispatch
}
```

---

## Parallel Execution

The Orchestrator dispatches ALL ready tasks simultaneously. Parallelism is bounded by the WorkerPool:

```
Plan:
  T-001 (researcher) ──┐
  T-002 (researcher) ──┼──→ T-003 (strategist) ──→ T-004 (writer)
                        │                      └──→ T-005 (designer)
                        
Execution timeline:
  ┌──────────┐ ┌──────────┐
  │ T-001    │ │ T-002    │  ← parallel (both ready, no deps)
  └────┬─────┘ └────┬─────┘
       └─────┬──────┘
             ▼
       ┌──────────┐
       │ T-003    │  ← starts when BOTH complete
       └────┬─────┘
     ┌──────┴──────┐
     ▼             ▼
┌──────────┐ ┌──────────┐
│ T-004    │ │ T-005    │  ← parallel (independent after T-003)
└──────────┘ └──────────┘
```

### Concurrency Limits

```typescript
interface WorkerPoolConfig {
  maxConcurrentWorkers: number;    // default: 5 per team
  maxWorkersPerRole: number;       // default: 2 (prevent one role hogging)
}
```

When more tasks are ready than workers available, the Orchestrator queues by priority:
1. Tasks on the critical path first
2. Tasks with more downstream dependents first
3. FIFO for equal priority

---

## Context Flow: Lazy Context Injection

### The Problem with Eager Context

Dumping all upstream task outputs into an agent's prompt wastes tokens and dilutes attention:

```
❌ EAGER (dump everything):
  Agent starts T-003 (Product Positioning)
  → System loads FULL outputs from T-001 (5KB) + T-002 (3KB) into prompt
  → 8KB of context the agent may not need all of
  → Wastes tokens, agent skims past details it doesn't use
  → Gets worse as more tasks complete — later tasks get 20KB+ of context

✅ LAZY (summaries + tools):
  Agent starts T-003
  → Prompt includes: 1-line summaries of T-001 and T-002
  → Agent needs details? Calls get_task_context("T-001")
  → Gets full output on demand. Only loads what it actually uses.
```

### The Pattern: Summary in Prompt, Details on Demand

When the Orchestrator dispatches a task, the agent's prompt gets:

```
## Your Task
T-003: Product Positioning for B2B SaaS campaign

## Goal
Build a marketing campaign for product X (B2B SaaS, mid-market)

## Available Context from Prior Tasks
- T-001 (Market Research, researcher): "Found 12 competitors, 3 direct threats. Key segments: mid-market, enterprise."
- T-002 (Competitive Analysis, researcher): "Top 3 competitors analyzed. Pricing: $29-149/mo. Gap: no self-serve onboarding."

Use get_task_context(taskId) to read full details when needed.
Use get_task_artifacts(taskId) to access files produced by prior tasks.
```

The agent sees what's AVAILABLE — but only loads what it NEEDS:

```typescript
// Tools available to every worker
const contextTools = {
  get_task_context: tool({
    description: 'Get full output from a completed upstream task. Use when you need details beyond the summary.',
    parameters: z.object({
      taskId: z.string(),
      section: z.string().optional().describe('Optional: "summary", "artifacts", "data", or omit for everything'),
    }),
    execute: async ({ taskId, section }) => {
      const output = await taskStore.getOutput(taskId);
      if (!output) return `Task ${taskId} has no output yet.`;
      if (section) return JSON.stringify(output[section]);
      return JSON.stringify(output);
    },
  }),

  get_task_artifacts: tool({
    description: 'List or read files produced by a completed task.',
    parameters: z.object({
      taskId: z.string(),
      filePath: z.string().optional().describe('Specific file to read. Omit to list all artifacts.'),
    }),
    execute: async ({ taskId, filePath }) => {
      const manifest = await collabSpace.getOutputManifest(taskId);
      if (!manifest) return `No artifacts for task ${taskId}.`;
      if (filePath) return await workspace.readFile(filePath);
      return manifest.outputs.map(o => `${o.path} (${o.type})`).join('\n');
    },
  }),
};
```

### How the Prompt is Built

```typescript
// In Orchestrator.dispatchTask()
function buildWorkerPrompt(task: Task): string {
  const upstreamTasks = task.contextFromTasks || task.dependencies.map(d => d.taskId);
  
  // Get ONE-LINE summaries only (not full outputs)
  const summaries = await Promise.all(
    upstreamTasks.map(async (taskId) => {
      const t = await taskStore.get(taskId);
      const output = await taskStore.getOutput(taskId);
      return `- ${taskId} (${t.title}, ${t.assignedRole}): "${output?.summary || 'No summary'}"`;
    })
  );

  return `
## Your Task
${task.id}: ${task.title}
${task.description}

## Acceptance Criteria
${task.acceptanceCriteria}

## Goal
${plan.goal}

## Available Context from Prior Tasks
${summaries.join('\n')}

Use get_task_context(taskId) to read full details when needed.
Use get_task_artifacts(taskId) to access files produced by prior tasks.
`;
}
```

### Same Pattern Everywhere

Lazy context applies to ALL knowledge sources, not just task outputs:

| Source | What Goes in Prompt (summary) | Tool to Load Full Content |
|---|---|---|
| **Prior task outputs** | One-line summary per task | `get_task_context(taskId)` |
| **L2 shared docs** | "3 shared docs available" | `collab` tool (discover/read) |
| **L3 knowledge** | "2 relevant docs: deploy-prod, api-design" | `search_knowledge` / `read_doc` |
| **Workspace files** | "47 files in workspace" | `workspace_read_file` |
| **Plan context** | Goal + strategy (2 lines) | `get_status()` for full plan |

**The agent always knows what exists. It only loads what it needs.**

This keeps prompts small (~500 tokens of summaries) while giving agents access to everything (via tools). The LLM decides what's relevant — it's better at that than us guessing upfront.

The Planner controls WHAT context flows via the plan's `contextFromTasks` field:

```typescript
interface PlanTask {
  id: string;
  description: string;
  assignedRole: string;
  dependencies: Array<{ taskId: string; type: 'blocks' | 'informs' }>;
  contextFromTasks: string[];   // which upstream task outputs to inject
  acceptanceCriteria: string;
}
```

---

## Failure Handling

The Orchestrator **detects** failures. The Planner **decides** what to do.

```
Worker fails T-005 (design):
  │
  ▼
Orchestrator:
  ├── Mark T-005 as 'failed' in TaskStore
  ├── Record error context
  ├── Cancel downstream tasks that can't proceed (T-006 depends on T-005)
  └── Notify Planner: { type: 'task_failed', taskId: 'T-005', error: '429 rate limit' }
        │
        ▼
Planner decides (via its decision loop):
  ├── RETRY: "Retry T-005 with smaller batch size"
  │   → Orchestrator resets T-005 to 'ready', spawns fresh worker
  │
  ├── REPLAN: "Split T-005 into T-005a and T-005b"
  │   → Planner calls replan tool
  │   → Orchestrator cancels T-005, creates T-005a/T-005b, rewires deps
  │
  ├── SKIP: "T-005 was optional, continue without it"
  │   → Orchestrator marks T-005 as 'skipped', unblocks downstream
  │
  └── ABORT: "Can't recover, stop goal"
      → Orchestrator cancels all remaining tasks
```

### Retry vs Replan

| Strategy | When | What Happens |
|---|---|---|
| **Retry** | Transient error (rate limit, timeout, OOM) | Same task, fresh worker, same description |
| **Replan** | Fundamental approach failed | Planner revises tasks — may split, reassign, add new tasks |
| **Skip** | Task was optional or has a fallback | Mark skipped, downstream tasks get partial context |
| **Abort** | Unrecoverable or user intervention needed | Cancel everything, report to user |

---

## Watchdog: Detecting Silent Failures

The Orchestrator also runs a watchdog for problems that don't emit events (see [A5 — AIMD Stall Detection](../planner-as-agent/feature_architecture.md)):

| Problem | Detection | Action |
|---|---|---|
| Worker died (crash, OOM) | No heartbeat for > 60s | Kill worker, mark task failed, notify Planner |
| Worker stuck (alive but no progress) | AIMD stall detection | Notify Planner after 3+ stall cycles |
| Zombie process | Container running, task done | Cleanup automatically |

---

## Task Schema

```typescript
interface Task {
  id: string;
  planId: string;
  goalId: string;
  
  // What
  title: string;
  description: string;
  acceptanceCriteria: string;
  
  // Who
  assignedRole: string;              // lowercase role key
  workerId?: string;                 // assigned after dispatch
  
  // Dependencies (DAG edges)
  dependencies: Array<{
    taskId: string;
    type: 'blocks' | 'informs';
  }>;
  contextFromTasks: string[];        // which upstream outputs to inject
  
  // State (single writer: Orchestrator)
  status: 'proposed' | 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  
  // Output
  output?: {
    summary: string;
    artifacts: string[];             // artifact IDs
    data: Record<string, unknown>;   // structured output
  };
  error?: {
    message: string;
    context: string;
    retryCount: number;
  };
  
  // Timestamps
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
}
```

---

## Migration from MemoryManager

Task Orchestration replaces MemoryManager for task state. MemoryManager was a flat task store with boolean prerequisite maps. This feature introduces a proper DAG with typed edges, parallel dispatch, and context flow.

| Before (MemoryManager) | After (Task Orchestration) |
|---|---|
| `MemoryManager.storeTasks()` | `TaskStore.create()` |
| `MemoryManager.getReadyTasks()` | `DependencyResolver.resolveReady()` |
| `prerequisites: Map<string, boolean>` | `dependencies: Array<{ taskId, type }>` — typed DAG edges |
| `MemoryManager.updateStatus()` | `TaskStore.updateStatus()` — single writer |
| No parallel tracking | `WorkerPool` dispatches all ready tasks concurrently |
| No retry mechanism | Failure detected → reported to Planner (A5) → Planner decides |
| No context passing | `TaskStore.getUpstreamOutputs()` feeds downstream tasks |
| `RoleTaskQueue` serializes per-role | Workers spawned per-task, bounded by pool config |
