# Persistent Agents & Three-Layer Hierarchy — Feature Architecture

**Status:** Draft  
**Date:** April 6, 2026  
**ID:** A10  
**Priority:** HIGH — Foundational for parallel plans, always-on chat, and Planner-as-Agent (A5)  
**Depends on:** Phase 3 Event Refactor (3B), Planner as Agent (A5)  
**Supersedes:** Parts of A5 (planner-as-agent) — this doc extends A5 with sub-agent patterns and persistent chat sessions

---

## Table of Contents

1. [Why This Feature Exists](#1-why-this-feature-exists)
2. [Current Architecture — Bottlenecks](#2-current-architecture--bottlenecks)
3. [Target Architecture — Three-Layer Agent Hierarchy](#3-target-architecture--three-layer-agent-hierarchy)
4. [Layer 1: Planner Agent (Team Leader)](#4-layer-1-planner-agent-team-leader)
5. [Layer 2: Chat Agents (Role Employees)](#5-layer-2-chat-agents-role-employees)
6. [Layer 3: Task Sub-Agents (The Hands)](#6-layer-3-task-sub-agents-the-hands)
7. [Sub-Agent Communication Model](#7-sub-agent-communication-model)
8. [Parallel Plans Architecture](#8-parallel-plans-architecture)
9. [Resource Ownership Model](#9-resource-ownership-model)
10. [Updated Planner Design (A5 Extension)](#10-updated-planner-design-a5-extension)
11. [Architecture Options](#11-architecture-options)
12. [Current Code → Target Mapping](#12-current-code--target-mapping)
13. [Migration Path](#13-migration-path)
14. [Frontend Impact](#14-frontend-impact)
15. [Open Questions](#15-open-questions)

---

## 1. Why This Feature Exists

Three problems in the current architecture cannot be solved independently — they share a root cause:

| Problem | Root Cause |
|---|---|
| **No parallel plans** | OrchestratorService has a single `state`, `pendingPlan`, `currentGoalId` — one plan at a time per team |
| **No always-on chat** | Chatting with an agent = executing a task. When the task ends, the worker is disposed. No conversation without an active task. |
| **Planner not a real agent** | OrchestratorService is a state machine that calls LLM, not a persistent agent with memory and tools. Can't chat with the planner about plans. |

**The shared root cause:** Agents are transient (born with a task, die after it). There's no persistent agent identity, no long-lived conversation, no separation between "thinking/chatting" and "doing work."

**The solution:** A three-layer agent hierarchy where persistent agents (Layers 1-2) own conversations and spawn transient sub-agents (Layer 3) for heavy work.

---

## 2. Current Architecture — Bottlenecks

### 2.1 Single-Plan-Per-Team Model

The current design is strictly **one active plan per team at a time**:

- **`OrchestratorService`** has a single `state` field (`idle | gathering | awaiting_approval | executing`)
  - Source: `packages/backend/orchestrator/OrchestratorService.ts` line ~55
- **`pendingPlan`** is a single nullable field — one plan proposal at a time (line ~57)
- **`currentGoalId`** is a single string — only one goal context active (line ~78)
- **`MemoryManager`** uses a flat `Map<string, Task>` with no plan/goal scoping
  - Source: `packages/backend/memory/MemoryManager.ts` line ~49
- **`approvePlan()`** calls `clearAllTasks()` before loading new tasks — explicitly destroying any previous plan's state
  - Source: `packages/backend/orchestrator/OrchestratorService.ts` line ~367
- **`dispatchChain`** serializes all task execution to prevent Git conflicts (line ~67)

### 2.2 Chat Is Tied to Task Execution

- **`continueTask()`** requires an active worker in `WorkerPool` — if the task is completed and the worker disposed, chat is impossible.
  - Source: `packages/backend/agentManager/AgentManagerV2.ts` line ~1363
- **`handleWorkerMessage()`** in SocketServerV2 either starts a new ad-hoc task (`startTask`) or continues an existing one (`continueTask`) — there's no "just chat" mode.
  - Source: `packages/backend/api/SocketServerV2.ts` line ~658
- Workers are disposed after task completion (via `workerPool.dispose()`), destroying the conversation thread.

### 2.3 Planner Is a State Machine, Not an Agent

- `OrchestratorService` owns both planning AND orchestration in a single state machine.
- Planning is a single LLM call (structured output), not an iterative agentic loop.
- No persistent planner conversation — user can't ask follow-up questions about the plan.
- No research phase — planner doesn't gather domain knowledge before planning.

### 2.4 What Already Works

- **`AgentManagerRegistry`** creates one `AgentManager` per team — good for multi-team but not multi-plan within a team.
- **`PlanStore`** already supports multi-goal via `goalId` directories — the persistence layer is ahead of the runtime.
- **AI SDK v6** has first-class sub-agent support via `ToolLoopAgent` + tool-as-subagent with streaming.

---

## 3. Target Architecture — Three-Layer Agent Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1: PLANNER (persistent, team-scoped)                          │
│                                                                     │
│  "The CEO" — owns the goal, talks to user, makes strategic         │
│  decisions, monitors all work, replans when needed                  │
│                                                                     │
│  Spawns: research sub-agents, submits plans                         │
│  Memory: Full conversation with user (persisted to DB)              │
│  Tools: user interaction, knowledge, plan management                │
│  Always available for chat about: goals, plans, strategy            │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2: CHAT AGENTS (persistent, role-scoped)                      │
│                                                                     │
│  "The Employees" — one per role, persistent identity/memory         │
│  Understand their domain, can discuss past/future work              │
│                                                                     │
│  Spawns: task execution sub-agents                                  │
│  Memory: Per-role conversation history (persisted to DB)            │
│  Tools: L2 collab, L3 knowledge, workspace read, execute_task      │
│  Always available for chat about: their domain, past tasks          │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 3: TASK SUB-AGENTS (transient, task-scoped)                   │
│                                                                     │
│  "The Hands" — do the actual work, write code, create files        │
│  Fresh context per task, return summary to parent                   │
│                                                                     │
│  Memory: Ephemeral (task instructions + dep outputs only)           │
│  Tools: workspace write, skills, commit, publish                    │
│  Disposed after task completion                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Three Layers, Not Two

You might wonder why not just Planner → Task Sub-Agents directly. The middle layer (Chat Agents per role) solves:

1. **Always-on chat** — users talk to persistent role agents, not transient workers
2. **Context separation** — the planner doesn't need to hold every role's context
3. **Parallel plans** — each role's chat agent can handle tasks from multiple goals
4. **Domain continuity** — the Backend Dev remembers what it built across tasks
5. **Token efficiency** — task sub-agents burn 100k tokens and return 2k summaries; chat agents accumulate only summaries

---

## 4. Layer 1: Planner Agent (Team Leader)

The Planner is the **team's top-level persistent Chat Agent**. It owns the user conversation, drives strategic decisions, and controls the orchestrator via tools.

### Identity

```
Per-Team Planner Agent (persistent, long-lived — the "team leader")
│
│  Identity: "I am the lead planner for Team X"
│  Memory: Full goal conversation history (persisted to DB)
│  Model: Configurable (gpt-4o default, o1 for complex planning)
│  Tools: user interaction, knowledge, team capabilities, execution
│
├── submit_plan(plan) ← tool that starts orchestration
│   └── Orchestrator (STATELESS service, not an agent)
│       ├── DependencyResolver → dispatches tasks
│       ├── Wakes planner via wake signal on events
│       └── ChatAgentPool → routes tasks to chat agents
│
├── research_domain(topic) ← SUB-AGENT (fresh context, returns summary)
│   └── Research sub-agent with knowledge tools
│       Gets fresh context per call, prevents planner context bloat
│       Returns: 2k token summary of patterns, risks, findings
│
├── execute_task_directly(role, instructions) ← sub-agent via chat agent
│   └── Spawns or messages the role's chat agent
│
└── monitor_execution() ← reads status, doesn't need sub-agent
```

### What Changes From the A5 (Planner-as-Agent) Doc

The A5 doc's design is **mostly right**, but the sub-agent insight refines it:

| A5 Doc Says | Updated with Sub-Agent Pattern |
|---|---|
| `research_domain` is a tool that calls a separate LLM | Make it a **sub-agent tool** — gets fresh context, returns summary via `toModelOutput()`. Prevents planner context bloat. |
| Planner suspends/resumes via wake signals | **Keep this** — it's the right pattern. Planner is a persistent chat agent whose LLM pauses between sub-agent invocations. Zero tokens while suspended. |
| Workers report back through orchestrator | Workers are sub-agents of chat agents. Chat agents report to planner via collab tools (L2). |
| Plan mutation tools modify plan mid-flight | **Keep this** — these become tools on the planner's persistent agent. It can mutate anytime it wakes. |
| Orchestrator as event-driven runtime (Option A) | **Orchestrator becomes stateless**. It receives plans, dispatches tasks, reports events. The planner owns all strategic state. |

### Planner Chat Flow (Updated)

```
User: "Build a blog with auth"
  │
  ▼
Planner Chat Agent (persistent)
  │ ask_user("Should I include OAuth or just email/password?")
  │   ← User: "Email/password is fine"
  │
  │ research_domain("Next.js blog architecture") ← SUB-AGENT (fresh context)
  │   → Returns: 2000 token summary of patterns
  │
  │ submit_plan(plan)
  │   → Orchestrator dispatches tasks to chat agents
  │   → Planner SUSPENDS (zero tokens while waiting)
  │
  │ [Task T-001 completes] → Planner WAKES
  │ tell_user("Backend API completed. Starting frontend.")
  │   → Planner SUSPENDS again
  │
  │ [Task T-003 fails] → Planner WAKES
  │ ask_user("Auth service failed. Retry or skip?")
  │   ← User: "Retry with different approach"
  │ update_task("T-003", { description: "Use Passport.js instead of custom JWT" })
  │   → Planner SUSPENDS
  │
  │ [All tasks done] → Planner WAKES
  │ tell_user("All done! Blog is deployed.")
```

Meanwhile, the **user can chat with the planner at any time** about plans, strategy, decisions — even while tasks are executing.

### Planner Cognitive Loop (From A5, Preserved)

```
1. CLARIFY  → Talk to user. Ask about scope, constraints, preferences.
2. RESEARCH → Sub-agent calls for domain knowledge (fresh context each time).
3. ANALYSE  → Decompose goal into components, risks, unknowns.
4. DISCUSS  → Present findings + trade-offs to user. Get feedback.
5. ASSESS   → Query team capabilities via registry.
6. REASON   → Weigh trade-offs, choose approach with explicit rationale.
7. PLAN     → submit_plan() with dependency-aware DAG.
8. MONITOR  → Suspend/wake. Update user. Replan if needed.
```

---

## 5. Layer 2: Chat Agents (Role Employees)

One persistent Chat Agent per role in a team. These are the "employees" that users can talk to anytime.

### Identity

```
Per-Role Chat Agent (persistent, long-lived — the "employee")
│
│  Identity: "I am the Backend Developer for Team X"
│  Memory: Full conversation history (persisted to DB)
│  Model: gpt-4o (cheap, fast, good for conversation)
│
├── execute_task(taskId, instructions) ← AI SDK sub-agent tool
│   │  Sub-agent: Full AiSdkAgent with workspace write tools
│   │  Memory: Fresh context (only task instructions + dep outputs)
│   │  Tools: workspace (L1 read+write), collab (L2), skills, report_status, complete_task
│   │  Model: gpt-4o or claude-sonnet (may differ from parent)
│   │  Streams: intermediate progress back to chat agent → UI
│   │  Returns: toModelOutput() summarizes the work → keeps parent context clean
│   │
│   └── Result: "Created /api/users endpoint with JWT auth. 3 files changed."
│
├── read_workspace(path) ← lightweight tool, no sub-agent needed
├── search_collab(query) ← reads L2 shared docs
├── search_knowledge(query) ← reads L3 knowledge base
└── get_task_history(taskId) ← reads completed task outputs from DB
```

### Tools Available to Chat Agents

| Tool | Type | Description |
|---|---|---|
| `execute_task` | **Sub-agent** | Spawns a task sub-agent with full workspace tools. Streams progress. Returns summary. |
| `read_workspace` | Direct tool | Read-only access to workspace files (main branch) |
| `search_files` | Direct tool | Search workspace files by pattern/content |
| `search_collab` | Direct tool | Search L2 collaboration docs |
| `search_knowledge` | Direct tool | Search L3 knowledge base |
| `get_task_history` | Direct tool | Read outputs/reports from completed tasks |
| `get_plan_context` | Direct tool | Read current plan status, task states |

### What Chat Agents Can Do (Without Active Task)

- Discuss completed task outputs ("what approach did you take for the API?")
- Review plan rationale ("why did you choose this task order?")
- Answer domain questions using L3 knowledge base
- Read (not write) workspace files and collab docs
- Plan follow-up work without formal task creation
- Discuss the user's ad-hoc questions about their expertise area

### What Chat Agents Cannot Do (Without Active Task)

- Write to workspace (no `create_file`, `update_file`, `commit`)
- Use skills (skills are loaded per-task from DB)
- Modify plan state
- Execute code

---

## 6. Layer 3: Task Sub-Agents (The Hands)

Transient agents spawned by Chat Agents to do actual work. Fresh context per task, killed after completion.

### Identity

```
Task Sub-Agent (transient, task-scoped)
│
│  Context: Task instructions + dependency outputs (injected at spawn)
│  Model: Configurable per task (defaults to parent's model)
│
├── workspace_read(path)     ← L1 read from task branch
├── workspace_write(path)    ← L1 write to task branch
├── workspace_commit(msg)    ← Git commit on task branch
├── workspace_publish()      ← Mark task branch ready for merge
├── search_collab(query)     ← L2 read shared docs
├── write_collab(doc, text)  ← L2 write to shared docs
├── report_status(message)   ← Notify parent chat agent of progress
├── complete_task(output)    ← Signal task done with output
├── [skill tools]            ← Loaded per-task from DB skill assignments
└── [code_intel tools]       ← LSP-based analysis tools
```

### Lifecycle

1. Chat Agent's `execute_task` tool spawns the sub-agent with:
   - Task instructions from the plan
   - Dependency outputs from completed tasks
   - Workspace branch (isolated from main)
   - Skills loaded from DB for this role

2. Sub-agent executes autonomously (multi-step via `stopWhen: stepCountIs(N)`)

3. During execution, sub-agent `yield`s progress events (streaming to UI via the chat agent)

4. On completion, `toModelOutput()` extracts a summary (2k tokens) — this is ALL the parent chat agent sees

5. Sub-agent is disposed. Workspace branch awaits merge.

### Why Fresh Context Matters

| Concern | Without Fresh Context | With Fresh Context |
|---|---|---|
| Token usage | Chat agent accumulates 100k+ tokens of workspace exploration per task | Sub-agent burns tokens independently; parent only sees 2k summary |
| Context window | Parent hits context limit after 2-3 tasks | Parent stays lean — only summaries accumulate |
| Hallucination risk | Old task context bleeds into new task decisions | Each task starts clean — no cross-contamination |
| Cost | All tokens on one expensive thread | Parent on cheap model, sub-agent burns then dies |

---

## 7. Sub-Agent Communication Model

### AI SDK v6 Native Support

AI SDK v6 has first-class sub-agent support via `ToolLoopAgent` + `async function*` tool execute:

```typescript
// Chat Agent's execute_task tool — spawns a task sub-agent
const executeTaskTool = tool({
  parameters: z.object({
    taskId: z.string(),
    instructions: z.string(),
  }),
  execute: async function* ({ taskId, instructions }, { abortSignal }) {
    // 1. Create sub-agent with workspace tools
    const subagent = new ToolLoopAgent({
      model: azure.chat('gpt-4o'),
      tools: {
        ...workspaceWriteTools,   // L1 write access on task branch
        ...collabTools,            // L2 collab
        ...skillTools,             // loaded from DB
        report_status: reportStatusTool,
        complete_task: completeTaskTool,
      },
      stopWhen: stepCountIs(10),
    });

    // 2. Run sub-agent — streams progress
    const stream = subagent.stream({
      prompt: instructions,
      abortSignal,
    });

    // 3. Yield intermediate progress to parent → UI
    for await (const message of readUIMessageStream({
      stream: stream.toUIMessageStream(),
    })) {
      yield message; // parent sees streamed progress
    }
  },
  // 4. Parent only sees the summary — NOT the 100k tokens of exploration
  toModelOutput: ({ output }) => {
    return {
      type: 'text',
      value: extractTaskSummary(output),  // e.g., "Created 3 files, 245 lines"
    };
  },
});
```

### Communication Directions

| Direction | Mechanism | Example |
|---|---|---|
| **Chat → Task** | Tool input (instructions, context) | Chat agent passes task instructions + user conversation context |
| **Task → Chat** | `yield` (streaming) + `toModelOutput()` (final) | Sub-agent streams progress; parent only retains summary |
| **User → Chat** | Normal message (always available) | User asks chat agent a question at any time |
| **User → Task (mid-execution)** | Via interrupt mechanism (see below) | User sends message to chat agent → chat agent injects it into task |
| **Planner → Chat** | Via orchestrator dispatch (task assignment) | Orchestrator routes task to role's chat agent |
| **Chat → Planner** | Via L2 collab docs OR orchestrator events | Chat agent writes task output to L2; planner wakes on completion |

### Mid-Execution User Messages

AI SDK sub-agents are **autonomous** — no mid-flight user messages by default. But we need this for:
- User wants to redirect a running task
- User provides additional context mid-task
- User wants to cancel/pause the current approach

**Solution: Interrupt mechanism**

```typescript
// Chat agent holds a reference to the running sub-agent's abort controller
class ChatAgent {
  private activeTaskAbort: AbortController | null = null;
  private interruptChannel: AsyncQueue<string> | null = null;

  // When user sends message while task is running:
  async onUserMessage(message: string) {
    if (this.interruptChannel) {
      // Inject into sub-agent's pending tool call
      this.interruptChannel.push(message);
    } else {
      // No active task — handle as normal chat
      await this.chat(message);
    }
  }
}
```

In the sub-agent, the `report_status` tool can check the interrupt channel:

```typescript
const reportStatusTool = tool({
  execute: async ({ message }, { abortSignal }) => {
    // Check if user injected a message
    const userInterrupt = interruptChannel.tryPop();
    if (userInterrupt) {
      return `User message received: "${userInterrupt}". Adjust your approach accordingly.`;
    }
    return 'Status reported. Continue.';
  },
});
```

This is lightweight — the sub-agent sees user messages at natural breakpoints (between tool calls), not mid-stream.

---

## 8. Parallel Plans Architecture

### The GoalContext Abstraction

Instead of a single plan state per team, introduce a `GoalContext` that scopes all per-plan state:

```
Team (AgentManager)
 ├─ GoalContext "goal-001-build-landing-page"
 │   ├─ State: executing
 │   ├─ PlanStore (already goalId-scoped ✅)
 │   ├─ MemoryManager tasks (scoped by goalId)
 │   ├─ Planner conversation thread (scoped)
 │   └─ dispatchChain (serialized within this goal)
 │
 ├─ GoalContext "goal-002-setup-ci-pipeline"
 │   ├─ State: awaiting_approval
 │   ├─ PlanStore (scoped)
 │   ├─ MemoryManager tasks (scoped)
 │   ├─ Planner conversation thread (scoped)
 │   └─ dispatchChain (independent)
 │
 └─ Chat Agents (shared across goals — persistent)
     ├─ Backend Dev → can work on tasks from ANY goal
     ├─ Frontend Dev → can work on tasks from ANY goal
     └─ DevOps → can work on tasks from ANY goal
```

### Key Changes for Parallel Plans

| Component | Current | Target | Risk |
|---|---|---|---|
| **OrchestratorService** | Single `state`, `pendingPlan`, `currentGoalId` | `Map<goalId, GoalContext>` with per-goal state | Medium — biggest refactor |
| **MemoryManager** | Flat task map | Tasks tagged with `goalId` + filtered queries | Medium |
| **WorkerPool / ChatAgentPool** | Workers keyed by `taskId` | Chat agents shared across goals; sub-agents keyed by `taskId` | Low — sub-agents are already task-scoped |
| **dispatchChain** | One chain per team (serialized) | One chain per goal (parallel goals, serialized within goal) | Medium |
| **SocketServerV2** | `handleMessage` routes to single orchestrator | Route by `goalId` parameter in message payload | Low |
| **PlanStore** | Already goalId-scoped ✅ | No change needed | None |

### The Workspace Conflict Problem

The reason `dispatchChain` serializes everything is because **all tasks share one Git repo per team**. Two goals writing to the same repo = file conflicts. Options:

| Option | Description | Available In |
|---|---|---|
| **Per-goal workspace** | Each goal gets its own repo clone or git worktree | Phase 4 (Git Task Context) |
| **Per-task branches** | Already partially implemented via `AgentWorkspace`, but concurrent branch operations still conflict | Phase 3 (partial) |
| **Container isolation** | Each sub-agent gets its own filesystem | Phase 6 (Worker Sandboxing) |

**Implication:** Full parallel plan **execution** may need Phase 4 or Phase 6. However, **parallel plan management** (creating, reviewing, approving multiple plans, chatting about them) can be done now — only execution must serialize if sharing a workspace.

### Phased Parallel Plan Support

| Phase | Capability |
|---|---|
| **Phase 3** | Parallel plan *creation and approval*. Users can discuss multiple goals with the planner simultaneously. Execution still serializes (workspace constraint). |
| **Phase 4** | Per-goal workspace isolation → parallel *execution*. Each goal's tasks run on independent workspace branches/worktrees. |
| **Phase 6** | Complete isolation per sub-agent → no workspace conflicts even within a single goal. |

---

## 9. Resource Ownership Model

### L1 Workspace (Git)

| Agent Layer | Read Access | Write Access | Scope |
|---|---|---|---|
| **Planner** | Main branch (read-only) | None | Team workspace overview |
| **Chat Agent** | Main branch + all task branches | None | Full visibility, can discuss any code |
| **Task Sub-Agent** | Task branch (isolated) | Task branch only | One branch per task, merged on completion |

### L2 Collaboration (Hocuspocus CRDT)

| Agent Layer | Read Access | Write Access | Scope |
|---|---|---|---|
| **Planner** | Full team L2 | Write plans, decisions, status | Team-wide shared docs |
| **Chat Agent** | Full team L2 | Write task reports, findings | Scoped to role's docs |
| **Task Sub-Agent** | Goal-scoped L2 | Write task-specific collab docs | Scoped to current task |

### L3 Knowledge Base

| Agent Layer | Read Access | Write Access | Scope |
|---|---|---|---|
| **Planner** | Full knowledge base | Promote from L2 | Organization-wide |
| **Chat Agent** | Full knowledge base | None (propose promotion) | Read for domain context |
| **Task Sub-Agent** | Injected subset | None | Only task-relevant knowledge |

### Conversation History

| Agent Layer | Storage | Lifetime | Size |
|---|---|---|---|
| **Planner** | MongoDB (per team) | Persistent across sessions | Grows with goals — prune old summaries |
| **Chat Agent** | MongoDB (per role per team) | Persistent across sessions | Grows with tasks — only summaries from sub-agents |
| **Task Sub-Agent** | In-memory only | Dies with sub-agent | Can be large (100k+ tokens) — never persisted in parent |

---

## 10. Updated Planner Design (A5 Extension)

### What Stays From A5

All of these remain unchanged from the Planner-as-Agent architecture doc:

- ✅ Planner cognitive loop (CLARIFY → RESEARCH → PLAN → MONITOR)
- ✅ User interaction tools (ask_user, tell_user, discuss_approach)
- ✅ Knowledge tools (research_domain, analyze_requirements, get_team_capabilities, get_context)
- ✅ Execution tools (submit_plan, get_status, get_blocked, get_critical_path, cancel_task)
- ✅ Plan mutation tools (update_task, add_tasks, remove_task, reprioritize, reassign_task, replan)
- ✅ Plan mutation guard rails
- ✅ Suspend/wake monitor pattern (not polling)
- ✅ Worker failure reporting
- ✅ Orchestrator as event-driven runtime (Option A)
- ✅ Single-writer task state model

### What Changes With Sub-Agent Pattern

| A5 Concept | Change | Why |
|---|---|---|
| `research_domain` tool | Now a **sub-agent** (not direct LLM call) | Fresh context per research call. Returns summary. Prevents planner context from growing with research content. |
| Workers report through orchestrator | Workers are **sub-agents of chat agents**. Chat agents report to orchestrator/planner. | Adds persistent conversation layer between task execution and planning. |
| Orchestrator spawns workers | Orchestrator routes tasks to **chat agents**. Chat agents spawn task sub-agents. | Chat agents are always-on; orchestrator doesn't manage agent lifecycle. |
| Planner is spawned per goal | Planner is **persistent** — one per team, handles all goals. Goals are scoped contexts within the planner's conversation. | Enables parallel plan management and always-on planner chat. |
| Orchestrator owns planner lifecycle | **Planner outlives any single plan.** Orchestrator is a stateless service the planner calls. | Planner is the strategist; orchestrator is the executor. |

### Planner as Persistent Chat Agent

The key insight: **The planner IS the team's top-level chat agent.** When a user opens a team, they're talking to the planner. The planner:

1. **Receives goals** → starts the cognitive loop
2. **Answers questions** → about plans, strategy, approach (no LLM tools needed)
3. **Monitors execution** → wakes on events, updates user, replans
4. **Handles follow-up** → new goals start new GoalContexts, planner manages all of them

```
# User opens Team X → they're chatting with the Planner

User: "Build a blog with auth"
Planner: *starts cognitive loop — research, plan, submit*

User: "Actually, can you also set up CI/CD for this?"
Planner: *starts SECOND GoalContext — parallel plan management*
Planner: "Sure, I'll create a separate plan for CI/CD. The blog work continues."

User: "How's the blog going?"
Planner: *checks goal-001 status* "3 of 5 tasks complete. Backend API done."

User: "Hey Backend Dev, what auth library did you use?"
→ Routes to Backend Dev Chat Agent (Layer 2) — not the planner
Backend Dev: "Used Passport.js with bcrypt. Here's the middleware..."
```

---

## 11. Architecture Options

### Option A: Full Three-Layer with AI SDK Sub-Agents (Recommended)

**Implementation:** Persistent chat agents (Layers 1-2) use AI SDK `ToolLoopAgent` with `async function*` execute on the `execute_task` tool. Sub-agents stream progress via `yield`, return summaries via `toModelOutput()`.

**Pros:**
- AI SDK v6 natively supports this pattern — minimal custom code
- Clean token management — sub-agents burn context independently
- Always-on chat — persistent agents never die
- Parallel plans — planner manages multiple GoalContexts
- Streaming works naturally through the sub-agent yield pipeline
- AbortSignal propagation for clean cancellation

**Cons:**
- Two-level agent creation (chat agent creates sub-agent) adds latency
- Sub-agent cold start per task (no conversation warm-up)
- Interrupt mechanism (user → running sub-agent) requires custom implementation
- More complex debugging — three layers to trace through

**Effort:** High (4-6 weeks)

### Option B: Two-Layer (Planner + Task Workers, No Chat Layer)

**Implementation:** Planner is persistent (Layer 1), task workers are transient (Layer 3). No persistent chat agents per role — users can only chat with the planner.

**Pros:**
- Simpler — fewer moving parts
- Less resource usage (no idle chat agents per role)
- Faster to implement

**Cons:**
- No always-on chat with individual roles
- Planner must hold ALL context (every role's domain knowledge)
- Planner context window grows unbounded
- No domain continuity per role — each task starts from zero
- Users can't ask "Hey Backend Dev, why did you do X?"

**Effort:** Medium (2-3 weeks)

### Option C: Flat Persistent Agents (No Sub-Agents)

**Implementation:** All agents are persistent (planner + roles). Tasks are executed inline by the chat agent — no sub-agent spawning.

**Pros:**
- Simplest model — each agent is just a long-running conversation
- Domain continuity is perfect — agent remembers everything
- No sub-agent communication complexity

**Cons:**
- **Context window explosion** — each agent accumulates unbounded context from task execution
- **No isolation** — task failures corrupt the chat thread
- **Expensive** — every message includes the full task execution history
- **No parallelism** — agent can only do one task at a time (single conversation thread)
- Doesn't scale past 2-3 tasks per agent before hitting context limits

**Effort:** Low (1-2 weeks) but quickly hits walls

### Recommendation: Option A

Option A (Three-Layer with AI SDK Sub-Agents) is the clear winner because:

1. It's the only option that solves ALL three problems (parallel plans, always-on chat, persistent planner)
2. AI SDK v6 provides native support — we're not building custom sub-agent infrastructure
3. Token management is sustainable — sub-agents die, parents stay lean
4. It aligns with the A5 planner-as-agent design (extends, doesn't replace)
5. The migration can be phased — add chat layer first, then sub-agent spawning

---

## 12. Current Code → Target Mapping

| Current Component | Becomes | Migration Complexity |
|---|---|---|
| `OrchestratorService` (state machine + planning) | **Split:** Planner Chat Agent (planning logic) + Orchestrator Service (stateless task dispatch) | High |
| `WorkerPool.runTask()` (creates worker, runs, disposes) | Chat Agent's `execute_task` tool spawns a sub-agent | High |
| `WorkerPool.workers` (Map<taskId, AiSdkAgent>) | `ChatAgentPool` (persistent agents per role) + transient sub-agents | Medium |
| `AgentManagerV2.continueTask()` | Send a message to the role's persistent chat agent | Low |
| `AgentManagerV2.startTask()` | Planner or user triggers `execute_task` on the role's chat agent | Medium |
| `MemoryManager` | Scoped by goalId; chat agents query for task context | Medium |
| `PlanStore` | Already goalId-scoped — **no change** | None |
| `AiSdkAgent` | Becomes the base for both chat agents and sub-agents | Low |
| `SocketServerV2` | Add chat routing (goalId + agentRole), sub-agent stream forwarding | Medium |

---

## 13. Migration Path

### Phase 1: Persistent Chat Agents (Quick Win)

**Goal:** Always-on chat with agents, even when no task is active.

| Step | What | Impact |
|---|---|---|
| 1 | Create `ChatAgentPool` alongside existing `WorkerPool`. Chat agents have L2/L3 read tools + conversation history. | Additive — no existing code changes |
| 2 | `continueTask()` routes to chat agent instead of requiring active worker | Fixes "can't chat after task completes" |
| 3 | Chat agents persist in `ChatAgentPool` across messages (not disposed) | Agents remember conversations |
| 4 | Store/load conversation history in MongoDB | Survives restart |

**Exit criteria:** User can chat with any role's agent at any time, regardless of task status. Chat history persists across sessions.

### Phase 2: Task Sub-Agent Spawning

**Goal:** Chat agents delegate heavy work to transient sub-agents.

| Step | What | Impact |
|---|---|---|
| 1 | Add `execute_task` tool to chat agents using AI SDK `ToolLoopAgent` + `async function*` | Chat agents can spawn sub-agents |
| 2 | Sub-agent gets workspace tools, skills, and task context | Full workspace access for task work |
| 3 | `toModelOutput()` extracts task summary → parent context stays clean | Token efficiency |
| 4 | Stream sub-agent progress to UI via parent's yield pipeline | Live task visibility |
| 5 | Migrate `WorkerPool.runTask()` to use this new path | Replace transient worker pattern |

**Exit criteria:** Tasks execute via sub-agents spawned by chat agents. Chat agents retain only summaries. Streaming works end-to-end.

### Phase 3: Planner as Persistent Agent

**Goal:** Planner becomes the team's top-level persistent chat agent.

| Step | What | Impact |
|---|---|---|
| 1 | Create persistent Planner Agent per team in `ChatAgentPool` | Planner outlives any single plan |
| 2 | Move planning logic from `OrchestratorService` state machine into planner tools | Planner drives planning; orchestrator is stateless |
| 3 | `research_domain` becomes a sub-agent tool (fresh context) | Research doesn't bloat planner |
| 4 | Implement suspend/wake pattern (from A5) | Zero-cost idle planner |
| 5 | User's team-level chat routes to planner agent | Users talk to planner by default |

**Exit criteria:** Planner is a persistent agent. Users chat with it freely. Planning, monitoring, and replanning all work through the planner agent.

### Phase 4: Parallel GoalContexts

**Goal:** Multiple plans can exist and execute in parallel.

| Step | What | Impact |
|---|---|---|
| 1 | Introduce `GoalContext` data structure (state + pendingPlan + goalId) | Each plan gets isolated state |
| 2 | `OrchestratorService.goals: Map<goalId, GoalContext>` | Multi-goal tracking |
| 3 | MemoryManager tasks tagged with goalId + filtered queries | Task scoping per goal |
| 4 | Planner manages multiple GoalContexts in conversation | Parallel plan management |
| 5 | Per-goal workspace isolation (requires Phase 4 Git Task Context) | Parallel execution (not just management) |

**Exit criteria:** Users can submit multiple goals. Plans are managed independently. Execution parallelism depends on workspace isolation availability.

---

## 14. Frontend Impact

### New UI Concepts

| Concept | Description | Component |
|---|---|---|
| **Goal Tabs / Switcher** | Each goal has its own view with plan + tasks + chat | GoalSwitcher, GoalView |
| **Agent Chat (always on)** | Chat input always enabled for any agent, regardless of task status | ChatArea (updated) |
| **Planner Chat** | Team-level chat defaults to planner agent | TeamChat → PlannerAgent |
| **Role Chat** | Click on any role → chat with its persistent agent | RoleChat → ChatAgent |
| **Sub-Agent Progress** | During task execution, stream sub-agent's work inline in chat | StreamMessage (enhanced) |
| **Task→Chat Linking** | Click on a completed task → see the sub-agent's execution log | TaskDetail → ExecutionLog |

### Socket.IO Event Changes

| Event | Current | Target |
|---|---|---|
| `sendMessage` | `{ teamId, agentId, content }` | `{ teamId, agentId, goalId?, content, type: 'chat' \| 'goal' }` |
| `stream` | Flat stream for one active agent | Tagged with `agentRole` + `goalId` + `layer` (chat/subagent) |
| `state` | Single plan state | Per-goalId plan state |

### Message Routing

```
User types message in:
  → Team-level chat → Routes to Planner Agent (Layer 1)
  → Role-level chat → Routes to Chat Agent for that role (Layer 2)

During task execution:
  → Messages still go to Chat Agent (Layer 2)
  → Chat Agent can inject interrupt into running sub-agent
  → Or respond directly if the question doesn't affect the task
```

---

## 15. Open Questions

| # | Question | Options | Decision |
|---|---|---|---|
| 1 | **Chat Agent model cost** — persistent agents idle most of the time. Should they use a cheaper model for chat and switch to a stronger one for task execution? | A) Same model always. B) Cheap for chat, strong for sub-agents. C) Team configurable. | *Open — Option C is most flexible.* |
| 2 | **Conversation pruning** — chat agents accumulate history over time. When to prune? | A) Fixed window (last N messages). B) Summarize old messages. C) Never prune (rely on context window growth). | *Open — summarization loses detail but saves tokens.* |
| 3 | **Chat Agent count** — one per role, or one per agent? (A role might have multiple agents.) | A) One per role (shared identity). B) One per agent (unique identity). | *Open — one per role is simpler.* |
| 4 | **Planner thread for multiple goals** — should each goal have its own planner thread, or one shared thread? | A) Shared thread (planner tracks all goals). B) Separate thread per goal (cleaner isolation). | *Open — shared enables cross-goal reasoning.* |
| 5 | **Sub-agent tool limit** — should sub-agents get ALL skills assigned to the role, or only task-relevant ones? | A) All role skills. B) Planner selects skills per task. C) Chat agent selects based on task analysis. | *Open — Option B reduces noise.* |
| 6 | **Interrupt granularity** — how often should sub-agents check for user interrupts? | A) Every tool call boundary. B) Explicit `check_interrupts` tool. C) Only at `report_status` calls. | *Open — more frequent = more responsive.* |
| 7 | **Child team visibility** — can parent UI drill into child team's agents? | A) Black box. B) Drill-in. C) Via proxy. | **Resolved: A (Black box).** Parent sees only planner-level status updates. Child team may run on different server/person. |
| 8 | **ask_user routing across teams** — who decides if a child's ask_user reaches the parent user? | A) Always bubble up. B) Child planner decides. C) Configurable per team. | **Resolved: C (Configurable).** Child planner decides per `askUserPolicy`: `handle_locally \| bubble_up \| auto`. |
| 9 | **Redirect propagation** — when user redirects a child team, how far does it cascade? | A) Only to child planner. B) Kill all sub-agents. C) Planner decides per-case. | **Resolved: A (Child planner only).** Parent shouldn't kill another person's agents. |
| 10 | **Child team agents** — real persistent agents or lightweight wrappers? | A) Full persistent agents. B) Lightweight adapters. | **Resolved: A (Full persistent agents).** Each child team has its own complete three-layer hierarchy. |

See [Sub-Agent Protocol — Team Stacking Integration](sub-agent-protocol.md#12-team-stacking-integration-b3-alignment) for the full distributed multi-user model, `TeamSubAgent` adapter code, and cross-team ask_user/ping flows.

---

## References

- [Planner as Agent (A5)](../planner-as-agent/feature_architecture.md) — Original planner architecture. This doc extends it with sub-agent patterns.
- [ROADMAP.md](../ROADMAP.md) — Phased roadmap. This feature spans Phases 3-4.
- [Event Architecture Analysis](../../architecture/EVENT_ARCHITECTURE_ANALYSIS.md) — Event refactor prerequisite.
- [Task Orchestration Event Refactor](../task-orchestration/event-refactor/) — Phase 3B prerequisite.
- AI SDK v6 Sub-Agents — `ToolLoopAgent`, `async function*` execute, `toModelOutput()`, `readUIMessageStream()`.
