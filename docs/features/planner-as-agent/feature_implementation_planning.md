# Planner as Agent — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 1 (Core Loop)  
**ID:** A5  
**Priority:** CRITICAL

---

## Branch
- `feature/planner-as-agent`

## Scope
Transform planner from a sub-agent into the top-level agentic brain. Orchestrator becomes a reactive runtime the planner drives via tools. Research-first, user-interactive planning with CLARIFY → RESEARCH → DISCUSS → PLAN → SUSPEND/WAKE cognitive loop.

**Shared with A6 (Task Orchestration):** A5 owns DependencyResolver, notifications, failure reporting, cancellation, watchdog, and the OrchestratorService refactor. A6 owns TaskStore, WorkerPool parallel dispatch, lazy context injection, and MemoryManager migration. Both features share this branch.

---

## Current Codebase Inventory

Audit of every existing file that this feature touches. Each tagged:
- **STAYS** — No changes needed. Used as-is.
- **REFACTOR** — Exists, needs modification. Details of what changes.
- **NEW** — Does not exist. Must be created from scratch.

### Orchestrator Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `orchestrator/OrchestratorService.ts` | ~900 | **REFACTOR** (heavy) | **Exists:** State machine (`idle→gathering→awaiting_approval→executing`), `handleMessage()` entry, `planBuilderAgent` + `orchestratorAgent` dual-agent setup, `executeAgent()` helper, `createContext()` dependency injection, `wakeWorker()` with sequential `dispatchChain`, `handleTaskComplete()` with workspace publish + dependency cascading, `handleTaskFailed()` with basic error emit, `loadActivePlan()` restart recovery, `approvePlan()` with dependants map + MemoryManager wiring, `resetPlan()`/`interruptPlan()` lifecycle, `PlanStore` integration. **Remove:** `planBuilderAgent` (planner replaces it), `orchestratorAgent` (planner is the agent), 4-state machine (planner manages its own phases), `extractResponse()` helper. **Add:** Reactive runtime loop (planner drives via tools), `pendingUserMessages` queue + `onUserMessage()`, `plannerWakeSignal` with debounce, `NotificationQueue` integration, `DependencyResolver` instance, plan mutation methods (6), `cancelWorker()` + watchdog loop, `WorkerFailureReport` handler with cockatiel retry/circuit-breaker. **Keep:** `dispatchChain` serialization, `PlanStore` persistence, `loadActivePlan()` recovery, `MemoryManager` task wiring, `EventEmitter` event emission backbone (refactored to use transport layer). |
| `orchestrator/types.ts` | ~100 | **REFACTOR** | **Exists:** `OrchestratorState` (4 states), `OrchestratorContext` (memoryManager, events, planStore, planBuilder, state getters), `OrchestratorConfig`, `OrchestratorMessage`, `PlanProposedEvent`, `PlanApprovedEvent`, `TaskPlan`. **Change:** Simplify `OrchestratorState` to `idle \| executing`, remove `planBuilder` from context (planner is now the caller, not the callee), add `UserInteractionManager`, `NotificationQueue`, `DependencyResolver` to context. Add planner-specific types (`PlannerWakeReason`, `PlanMutationEvent`). |
| `orchestrator/schemas.ts` | ~90 | **REFACTOR** | **Exists:** Re-exports `AgentPlanSchema`/`TaskItemSchema`, defines `PlanRequirementsSchema` (goal, context, constraints, roles), `TaskStatusSummarySchema`, `CreatePlanResultSchema`, `ApprovePlanResultSchema`. **Change:** `PlanRequirementsSchema` becomes internal to planner (not a tool input). Add schemas for `UserQuestion`, `UserChoice`, `PlannerNotification`, `WorkerFailureReport`. Extend `TaskStatusSummarySchema` with pending notifications count. |
| `orchestrator/index.ts` | ~40 | **REFACTOR** | **Exists:** Barrel exports for service, types, schemas, tools. **Change:** Add new exports: `UserInteractionManager`, `NotificationQueue`, `DependencyResolver`, `NotificationTransport`, new types/schemas. |

### Orchestrator Tools

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `orchestrator/tools/index.ts` | ~35 | **REFACTOR** | **Exists:** Creates 4 tools: `create_plan`, `approve_plan`, `get_status`, `get_context`. Returns flat array. **Change:** Register 15+ new tools alongside existing. Conditionally include planner-only vs worker tools. |
| `orchestrator/tools/createPlan.ts` | ~95 | **REFACTOR** → rename to `submitPlan.ts` | **Exists:** Takes `PlanRequirementsSchema` input, invokes `planBuilder.invoke()`, stores via `setPendingPlan()`, saves to `PlanStore`, emits `plan:proposed`. **Change:** Planner now constructs the plan itself (no PlanBuilder invocation). Tool becomes `submit_plan` — validates DAG via `DependencyResolver`, stores tasks in PlanStore, sets state to `awaiting_approval`. Planner may call this multiple times if user rejects. |
| `orchestrator/tools/approvePlan.ts` | ~95 | **REFACTOR** → becomes `request_approval` | **Exists:** No-input tool, reads `getPendingPlan()`, builds dependants map, adds tasks to MemoryManager, emits `plan:approved`. **Change:** Becomes `request_approval` — pauses planner execution (returns a Promise that resolves when user approves via Socket.IO). On approval: tasks flow to MemoryManager. On rejection: returns rejection reason to planner as error response. |
| `orchestrator/tools/getStatus.ts` | ~95 | **REFACTOR** | **Exists:** Iterates all roles via `memoryManager.getTasks()`, counts by status, returns `TaskStatusSummary`. **Change:** Use `memoryManager.getAllTasks()` instead of per-role iteration. Add pending notifications count from `NotificationQueue`. Add blocked task info from `DependencyResolver`. |
| `orchestrator/tools/getContext.ts` | ~110 | **REFACTOR** | **Exists:** Reads `OutputManifest` files from `.ping/outputs/`, filters by taskId/role, formats for LLM. Scans workspace directories. **Change:** Add L2 collaboration doc search (shared CRDT docs). Add L3 knowledge base search when available. Keep output manifest scanning. |
| `orchestrator/tools/userTools.ts` | — | **NEW** | `ask_user`, `tell_user`, `discuss_approach` — 3 tools for planner↔user interaction. Shared `UserInteractionManager` bridge. |
| `orchestrator/tools/knowledgeTools.ts` | — | **NEW** | `research_domain`, `analyze_requirements`, `get_team_capabilities` — 3 research tools. |
| `orchestrator/tools/planMutationTools.ts` | — | **NEW** | `update_task`, `add_tasks`, `remove_task`, `reprioritize`, `reassign_task`, `replan` — 6 plan modification tools. |
| `orchestrator/tools/executionTools.ts` | — | **NEW** | `cancel_task`, `get_blocked`, `get_critical_path`, `search_agents` — 4 execution monitoring tools. |
| `orchestrator/tools/notificationTools.ts` | — | **NEW** | `check_notifications` — drain notification queue on planner wake. |

### New Orchestrator Modules

| File | Tag | Purpose |
|------|-----|---------|
| `orchestrator/UserInteractionManager.ts` | **NEW** | `Map<questionId, resolver>` bridge. `askQuestion()` → Promise that blocks. `resolveQuestion()` from Socket handler. Timeout via `AbortSignal.timeout()`. Shared by planner and worker tools. |
| `orchestrator/DependencyResolver.ts` | **NEW** | DAG validation (cycle detection via DFS), topological sort, `getReady()`, `getBlocked()`, `getCriticalPath()`. Re-resolves after every mutation. ~50 lines core algorithm. |
| `orchestrator/NotificationQueue.ts` | **NEW** | `PlannerNotification` discriminated union, severity levels, `push()`/`drain()`/`hasUrgent()`. Wraps emittery for typed async events. |
| `orchestrator/NotificationTransport.ts` | **NEW** | `NotificationTransport` interface → `SocketIOTransport` (V1). `CompositeTransport` for multi-channel. Seam for future OpenClaw integration. |
| `orchestrator/PlannerAgent.ts` | **NEW** | Thin wrapper: `AgentFactory.createById('planner')`, injects team roles into system prompt. Same pattern as current orchestrator agent setup. |
| `orchestrator/types/plannerTypes.ts` | **NEW** | `Plan`, `PlanTask`, `PlannerNotification`, `UserQuestion`, `UserChoice`, `TaskPatch`, `TaskPriority`, `PlannerWakeReason` types. |
| `orchestrator/types/workerTypes.ts` | **NEW** | `WorkerFailureReport`, `ErrorCategory` enum (10 categories). Structured failure data. |

### Agent System

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `agent/AgentFactory.ts` | ~180 | **STAYS** | **Exists:** `AgentLoader` + `AgentFactory` with `createById()`, `getInstance()`, builder convenience methods, definition queries. **No changes needed** — planner uses `createById('planner')` exactly like orchestrator does today. |
| `agent/BaseAgent.ts` | — | **STAYS** | Base class for all agents. Not modified. |
| `agent/internal/InternalAgent.ts` | ~200+ | **STAYS** | **Exists:** LangGraph agent with tool mode / structured output mode, `initialize()`, `execute()` AsyncGenerator, `setTools()` for post-init injection, model creation (Azure/Anthropic/OpenAI), MCP tool loading. **No changes** — planner is an InternalAgent in tool mode, same as current orchestrator. |
| `agent/agents/orchestrator.yaml` | ~130 | **REFACTOR** → deprecate | **Exists:** Orchestrator agent definition with system prompt covering conversation/planning/monitoring phases, 4-tool references (create_plan, approve_plan, get_status, get_context), streaming config. **Change:** Deprecate in favor of `planner.yaml`. Keep for `PLANNER_MODE=legacy` rollback. |
| `agent/agents/plan-builder.yaml` | ~110 | **STAYS** (deprecated path) | **Exists:** PlanBuilder agent with structured output (AgentPlanSchema), detailed system prompt for task decomposition. **Not modified** — retained for legacy mode. Planner agent absorbs this responsibility natively. |
| `agent/agents/planner.yaml` | — | **NEW** | Planner agent definition: model config, 15+ tool references, cognitive workflow system prompt (CLARIFY → RESEARCH → ANALYSE → DISCUSS → ASSESS TEAM → REASON → PLAN → MONITOR). |
| `agent/internal/tools/reportStatusTool.ts` | — | **STAYS** | Worker tool for status reporting. Used as-is by workers. |
| `agent/internal/tools/completeTaskTool.ts` | — | **STAYS** | Worker tool for task completion. Used as-is by workers. |

### Memory Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `memory/MemoryManager.ts` | ~200 | **STAYS** | **Exists:** Task Map storage, `addTask()`, `getTasks(role)`, `getAllTasks()`, `updateTaskStatus()`, `completeTask()` with dependency cascading, `checkTaskReady()` prerequisite checking, `RoleTaskQueue` integration with auto-queue, `clearAllTasks()`. **No changes for A5** — A6 (Task Orchestration) owns MemoryManager migration. A5 uses the existing API. |
| `memory/types/Task.types.ts` | ~50 | **STAYS** | `Task` interface, `TaskStatus` type. No changes. |
| `memory/MemoryCoordinator.ts` | ~100 | **STAYS** | Plugin-based L1/L2/L3 coordinator. Planner uses same API as today. |
| `memory/L2/` (collaboration) | — | **STAYS** | CRDT docs, PlanStore, OutputManifest. Knowledge tools extend read access but don't modify L2 layer. |

### Services

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `services/WorkerPool.ts` | ~300 | **REFACTOR** (minor) | **Exists:** Definition registry, worker creation with model override, `runTask()` (chat mode + queue mode), workspace tools injection, L2 collab tools, L3 knowledge tools, event emission (`worker:event`, `worker:done`, `worker:error`), workspace publish + merge. **Change:** Add `AbortSignal` parameter to `runTask()` for cancellation. Add structured `WorkerFailureReport` emission (replace bare error strings). Workers check `signal.throwIfAborted()` at tool boundaries. |
| `util/RoleTaskQueue.ts` | ~100 | **REFACTOR** (minor) | Priority queue per role. **Add:** `pollN(role, n)` for parallel dispatch (A6 Task 002). Remove `EventEmitter` events (move to emittery). Keep per-role queues, `queueTask()`, `poll()`, `updatePriority()`, metrics. |
| `util/PriorityQueue.ts` | — | **STAYS** | Min-heap priority queue. No changes. |

### API Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `api/SocketServerV2.ts` | ~600 | **REFACTOR** | **Exists:** Socket.IO on `/socket.io/v2`, 6 events (message, action, state, output, progress, error), `handleConnection()` → `handleRegister()` → `handleMessage()` / `handleAction()`, team room broadcasting (`worker:event→progress`, `worker:done→message`, `worker:error→error`, `task:update→state`, `plan:update→state`), `handleOrchestratorMessage()` routing to `manager.orchestratorMessage()`, `handleWorkerMessage()` with ad-hoc task creation, `handleAction()` with approve/start/complete/cancel/auto-execute/get-state. **Add:** `planner:ask_user` / `planner:tell_user` / `planner:discuss_approach` server→client events. `planner:user_response` client→server handler → `resolveQuestion()`. `worker:ask` / `worker:respond` events for worker↔user interaction. Route mid-execution messages to `onUserMessage()` (not just initial goal). Plan mutation events (`plan:task_updated`, `plan:tasks_added`, etc.). **Refactor:** `handleOrchestratorMessage()` routing: first message → start planner; subsequent messages during `executing` → `onUserMessage()`. Remove ad-hoc task creation from `handleWorkerMessage()`. |
| `api/HttpServer.ts` | — | **STAYS** | REST endpoints. Not modified for A5. |
| `api/AgentManagerAPI.ts` | — | **STAYS** | API entry point. Not modified. |
| `api/SocketConnectionManager.ts` | — | **STAYS** | Connection tracking. Not modified. |
| `api/UserManager.ts` | — | **STAYS** | User tracking. Not modified. |

### AgentManager

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `agentManager/AgentManagerV2.ts` | ~100+ | **REFACTOR** (minor) | **Exists:** `USE_ORCHESTRATOR` feature flag, `WorkerPool` + `OrchestratorService` setup, `orchestratorMessage()`, `getOrchestratorState()`, `getOrchestratorPendingPlan()`, `startTask()` / `continueTask()`, event forwarding. **Change:** Add `PLANNER_MODE=agent\|legacy` env var (replaces `USE_ORCHESTRATOR`). When `agent`: use new planner-driven OrchestratorService. When `legacy`: retain current dual-agent flow. Expose `UserInteractionManager.resolveQuestion()` for Socket handler. |

### Tests

| File | Tag | What Exists → What Changes |
|------|-----|----------------------------|
| `orchestrator/__tests__/tools.test.ts` | **REFACTOR** | **Exists:** Tests for create_plan, approve_plan, get_status, get_context. **Change:** Update for renamed tools (submit_plan, request_approval), add tests for new tools. |
| `orchestrator/__tests__/orchestrator.integration.test.ts` | **REFACTOR** | **Exists:** Integration tests for orchestrator flow. **Change:** Add planner-driven flow tests. |
| `orchestrator/__tests__/userInteraction.test.ts` | **NEW** | UserInteractionManager unit tests. |
| `orchestrator/__tests__/dependencyResolver.test.ts` | **NEW** | DAG validation, cycle detection, topological sort tests. |
| `orchestrator/__tests__/notificationQueue.test.ts` | **NEW** | Push/drain/hasUrgent, severity levels. |
| `orchestrator/__tests__/planMutation.test.ts` | **NEW** | Guard rails, DAG re-resolution after mutations. |
| `orchestrator/__tests__/workerFailure.test.ts` | **NEW** | Error classification, auto-retry, circuit breaker. |
| `orchestrator/__tests__/planner.integration.test.ts` | **NEW** | Full E2E: goal → clarify → plan → execute → complete. |

---

## Summary: Stays / Refactor / New

| Category | Count | Files |
|----------|-------|-------|
| **STAYS** (no changes) | 14 | AgentFactory, BaseAgent, InternalAgent, plan-builder.yaml, reportStatusTool, completeTaskTool, MemoryManager, Task.types, MemoryCoordinator, L2/*, PriorityQueue, HttpServer, AgentManagerAPI, SocketConnectionManager, UserManager |
| **REFACTOR** (modify existing) | 10 | OrchestratorService (**heavy**), types.ts, schemas.ts, index.ts, tools/index.ts, createPlan→submitPlan, approvePlan→request_approval, getStatus, getContext, SocketServerV2, AgentManagerV2, orchestrator.yaml (deprecate), tools.test.ts, orchestrator.integration.test.ts, WorkerPool (minor) |
| **NEW** (create from scratch) | 16 | UserInteractionManager, DependencyResolver, NotificationQueue, NotificationTransport, PlannerAgent, plannerTypes.ts, workerTypes.ts, planner.yaml, userTools.ts, knowledgeTools.ts, planMutationTools.ts, executionTools.ts, notificationTools.ts, + 5 new test files |

---

## Package Dependencies: Build vs Buy

Research across npm for each implementation area. Verdict: **2 new packages (`cockatiel`, `emittery`), rest uses built-ins or is trivial custom code.**

| Step | Component | Candidate Packages | Verdict |
|------|-----------|-------------------|--------|
| 1 | Types/schemas | `zod` (already installed) | **Use existing** |
| 2 | UserInteractionManager | `p-defer` (10.5M/wk), `p-timeout` (30.9M/wk) | **Skip both** — use `Promise.withResolvers()` + `AbortSignal.timeout()` (built into Bun/Node 22+) |
| 4 | DAG resolver | `graphlib` (3.2M/wk, last updated 6 years ago) | **Skip** — our DAGs have 10-50 nodes. Topo sort + cycle detection is ~50 lines. Not worth a stale dependency |
| 7 | NotificationQueue + Events | **`emittery`** (42M/wk, typed async events) | **Install `emittery`** — we're already gutting the 7-EventEmitter spaghetti (A5 notifications + A6 event wiring). Adopting emittery now avoids building on EventEmitter then migrating again. Typed generics, async-first, AbortSignal support, `clearListeners()`. NotificationQueue becomes a thin wrapper over typed emittery events |
| 8 | Retry/backoff | **`cockatiel`** (1.3M/wk), `async-retry` (21.9M/wk) | **Install `cockatiel`** — retry with `handleType()` for error classification, `ExponentialBackoff`, circuit breaker for external services, timeout with AbortSignal, bulkhead for worker concurrency. All composable via `wrap()`. Zero deps. Replaces ~150 lines of custom retry logic |
| 9 | CancellationToken | None needed | **Use native `AbortController/AbortSignal`** — this IS the JS standard CancellationToken. `signal.aborted`, `controller.abort(reason)`, `signal.throwIfAborted()`, `signal.addEventListener('abort', cb)`. Our custom `CancellationToken` maps 1:1 to it |

### Action Items
```bash
bun add cockatiel emittery
```

### Why Not More Packages?
- **`p-defer`**: `Promise.withResolvers()` is now standard JS. Same API (`{ promise, resolve, reject }`), zero deps.
- **`p-timeout`**: `AbortSignal.timeout(ms)` does the same thing natively. Wrap with `Promise.race()` if needed.
- **`graphlib`**: 6 years unmaintained. Our DAG is tiny. Custom is safer and debuggable.
- **`async-retry`**: `cockatiel` subsumes it and adds circuit breaker, timeout, bulkhead, fallback.
- **`emittery`**: Install now — we're redesigning the event architecture in A5 Step 7 + A6 Step 4. Building on EventEmitter then migrating to emittery later is pointless double work.

---

## Implementation Steps

### Step 1: Planner Tool Schemas + Types
**Tag: NEW (all new files) + REFACTOR (schemas.ts, index.ts)**

**NEW files:**
- Create `orchestrator/types/plannerTypes.ts` — `Plan`, `PlanTask`, `PlannerNotification`, `WorkerFailureReport`, `UserQuestion`, `UserChoice`, `TaskPatch`, `TaskPriority`, `PlannerWakeReason` types. **Note:** `CancellationToken` type replaced by native `AbortSignal` (see Step 9)
- Create `orchestrator/tools/userTools.ts` — Zod schemas for `ask_user`, `tell_user`, `discuss_approach` + worker versions
- Create `orchestrator/tools/knowledgeTools.ts` — Schemas for `research_domain`, `analyze_requirements`, `get_team_capabilities`
- Create `orchestrator/tools/planMutationTools.ts` — Schemas for `update_task`, `add_tasks`, `remove_task`, `reprioritize`, `reassign_task`, `replan`

**REFACTOR files:**
- `orchestrator/schemas.ts` — Add `UserQuestionSchema`, `UserChoiceSchema`, `PlannerNotificationSchema`, `WorkerFailureReportSchema`. Keep existing schemas (re-used by legacy mode).

**Note:** Approval types (`ApprovalRequest`, `ApprovalDecision`, `ApprovalPolicy`) are owned by [A9 Approval System](../../approval-system/feature_architecture.md).
- `orchestrator/tools/index.ts` — Register all new tools alongside existing 4. Use `mode` parameter to return planner-only vs worker-only vs all tools.

**Exit:** All schemas compile with Zod validation

### Step 2: User Interaction System
**Tag: NEW (UserInteractionManager) + REFACTOR (SocketServerV2)**

**NEW files:**
- Create `orchestrator/UserInteractionManager.ts` — Shared `Map<questionId, {promise, resolve, reject}>` bridge using `Promise.withResolvers()`. `askQuestion(question)` → returns Promise (blocks caller). `resolveQuestion(id, answer)` called by Socket handler. Timeout via `AbortSignal.timeout(300_000)` (5min). `cancelAll()` for shutdown. Used by both planner and worker tools.

**NEW tool implementations** (schemas from Step 1):
- `orchestrator/tools/userTools.ts`:
  - `ask_user` — Calls `UserInteractionManager.askQuestion()`, emits `planner:ask_user`, blocks until response.
  - `tell_user` — Fire-and-forget. Emits `planner:tell_user`. Categories: `finding|progress|warning|status`.
  - `discuss_approach` — Calls `askQuestion()` with options array, emits `planner:discuss_approach`, blocks until selection.
  - **Worker versions:** `worker_ask_user`, `worker_tell_user`, `worker_discuss_approach` — Same bridge, different Socket events (`worker:ask`/`worker:tell`/`worker:respond`), scoped to task thread. Worker heartbeat → `WAITING` mode. Planner notified via `worker_waiting` notification.
  - Ping Team workers get `worker_tell_user` only — NOT `ask_user`/`discuss_approach`.

**REFACTOR files:**
- `api/SocketServerV2.ts` — **Add:** `planner:user_response` → `resolveQuestion()`. `worker:respond` → same bridge. Handle disconnect: cleanup pending questions.

**Note:** Approval system is a separate Phase 2 feature (post-Mastra) — see [A9 Approval System](../../approval-system/feature_implementation_planning.md). A9 leverages Mastra's `requireApproval` + `suspend()` natively.

**Exit:** Round-trip works for planner and workers. `ask_user` blocks and resumes. `tell_user` fires and forgets. Worker tools scoped to task thread.

### Step 3: Knowledge Tools
**Tag: NEW (knowledgeTools) + REFACTOR (getContext)**

**NEW tool implementations** (schemas from Step 1):
- `orchestrator/tools/knowledgeTools.ts`:
  - `research_domain` — Internal LLM call with focused prompt (can use cheaper model). Creates a throwaway InternalAgent with a research-focused system prompt.
  - `analyze_requirements` — Goal decomposition via LLM. Returns structured breakdown.
  - `get_team_capabilities` — Queries `AgentFactory.listDefinitions()` for available roles, returns structured role summary with skills/tools.

**REFACTOR files:**
- `orchestrator/tools/getContext.ts` — **Currently:** Only reads `OutputManifest` files from `.ping/outputs/`. **Add:** L2 collaboration doc search (read shared CRDT docs via `MemoryCoordinator.L2`). Add L3 knowledge base search when available. Keep existing manifest scanning.

**Deps:** None (placeholder L2 OK)  
**Exit:** Each tool returns structured data, unit tests pass

### Step 4: DAG Resolver + Execution Tools
**Tag: NEW (DependencyResolver, executionTools) + REFACTOR (createPlan→submitPlan, getStatus)**

**NEW files:**
- Create `orchestrator/DependencyResolver.ts` — DAG validation (cycle detection via DFS), topological sort via Kahn's algorithm, `getReady()`, `getBlocked()`, `getCriticalPath()`. Re-resolves after every mutation. ~50 lines core. No external deps (our DAGs are 10-50 nodes).
- Create `orchestrator/tools/executionTools.ts` — `cancel_task` (abort worker + mark failed), `get_blocked` (query DAG), `get_critical_path` (longest dependency chain), `search_agents` (query AgentFactory).

**REFACTOR files:**
- `orchestrator/tools/createPlan.ts` → **rename to `submitPlan.ts`** — **Currently:** Takes `PlanRequirementsSchema`, invokes `planBuilder.invoke()`, stores pending plan. **Change:** Planner constructs plan directly. Tool becomes `submit_plan` — accepts plan object, validates DAG via `DependencyResolver`, stores tasks in PlanStore, emits `plan:proposed`. No PlanBuilder invocation.
- `orchestrator/tools/getStatus.ts` — **Currently:** Iterates roles via `memoryManager.getTasks()`, counts by status. **Change:** Use `memoryManager.getAllTasks()` (already exists). Add pending notifications count from `NotificationQueue`. Add blocked task info from `DependencyResolver.getBlocked()`.

**Deps:** Step 1  
**Exit:** DAG rejects cycles (returns cycle path to planner), `getReady()`/`getBlocked()` work correctly

### Step 5: Plan Mutation Tools
**Tag: NEW (implementations) + REFACTOR (OrchestratorService)**

**NEW tool implementations** (schemas from Step 1):
- `orchestrator/tools/planMutationTools.ts` — Six tools: `update_task`, `add_tasks`, `remove_task`, `reprioritize`, `reassign_task`, `replan`. Each delegates to OrchestratorService mutation methods + DependencyResolver re-resolution.

**REFACTOR files:**
- `orchestrator/OrchestratorService.ts` — **Add:** 6 mutation methods: `mutateUpdateTask()`, `mutateAddTasks()`, `mutateRemoveTask()`, `mutateReprioritize()`, `mutateReassignTask()`, `mutateReplan()`. Each: validates guard rails → applies to MemoryManager → re-resolves DAG → emits Socket.IO event. **Currently has none of this.**

**Guard rails (all enforced, all return clear errors to planner):**
- Cannot mutate `in_progress`/`completed` tasks (must `cancel_task` first)
- Cannot create dependency cycles (DAG validator rejects, returns cycle path)
- Cannot assign to nonexistent roles (error includes available roles from `WorkerPool.hasRole()`)
- `replan` logs reason to L2, requires approval if `plan.metadata.requiresApproval`
- All mutations emit Socket.IO events (`plan:task_updated`, `plan:tasks_added`, etc.)

**Deps:** Step 4 (DAG resolver)  
**Exit:** Mutations modify state correctly, DAG always valid, Socket.IO events fire

### Step 6: Planner Agent Definition
**Tag: NEW (planner.yaml, PlannerAgent.ts) + REFACTOR (orchestrator.yaml)**

**NEW files:**
- Create `agent/agents/planner.yaml` — Agent definition: model config (`gpt-4o-2`, temperature 0.7), tool list (15+ tools from Steps 1-5), system prompt with cognitive workflow (CLARIFY → RESEARCH → ANALYSE → DISCUSS → ASSESS TEAM → REASON → PLAN → MONITOR/ADAPT). Includes user interaction instructions at each phase.
- Create `orchestrator/PlannerAgent.ts` — Initialize via `AgentFactory.createById('planner')`, customize system prompt with team roles (same pattern as current orchestrator agent setup in `OrchestratorService.initialize()` lines 107-119 — reads definition, appends team roles to systemPrompt, calls `initialize()`, then `setTools()`).

**REFACTOR files:**
- `agent/agents/orchestrator.yaml` — Add deprecation comment. Keep for `PLANNER_MODE=legacy` rollback.

**Exit:** Planner agent initializes, receives goal, follows cognitive workflow

### Step 7: Notification System + Transport Layer
**Tag: NEW (all new files) + REFACTOR (OrchestratorService, SocketServerV2)**

**NEW files:**
- Create `orchestrator/NotificationQueue.ts` — `PlannerNotification` discriminated union (`task_completed | task_failed | worker_stalled | worker_died | plan_blocked | execution_complete | sla_warning`), severity levels (`info | warning | urgent`). Methods: `push()`, `drain()`, `hasUrgent()`. Backed by emittery for typed async events. **Note:** User messages are NOT notifications — they are conversation (human messages injected separately, with priority over notifications).
- Create `orchestrator/NotificationTransport.ts` — `NotificationTransport` interface with `send()`, `ask()`, `discuss()`. `SocketIOTransport` implements it (V1). `CompositeTransport` fans out to all registered transports. Seam for future OpenClaw integration.
- Create `orchestrator/tools/notificationTools.ts` — `check_notifications` tool calls `drain()` (used when planner wakes, not for polling).

**REFACTOR files:**
- `orchestrator/OrchestratorService.ts` — **Currently:** `handleTaskComplete()` emits `task:update` + `orchestrator:progress` directly via `this.events.emit()`. `handleTaskFailed()` emits `task:error` + `orchestrator:progress`. **Change:** Wire all lifecycle events → `NotificationQueue.push()` instead of direct emit. Every push calls `transport.send()` (not `io.emit` directly). Add `plannerWakeSignal` (Promise + resolve) with 100ms debounce for batching. Add `pendingUserMessages: string[]` queue + `onUserMessage()` handler.
- `api/SocketServerV2.ts` — **Currently:** `ensureTeamEventsBroadcast()` listens to `worker:event`, `worker:done`, `worker:error`, `task:update`, `plan:update`. **Add:** Notification event broadcast (`planner:notification`). Plan mutation event broadcast. Route mid-execution user messages through `onUserMessage()`.

**Planner suspend/resume (not polling):**
- After plan submitted, planner **suspends** (`await plannerWakeSignal` — zero tokens while waiting)
- Orchestrator **wakes** planner by resolving the signal when notifications arrive
- Notifications batched (100ms debounce) so 3 simultaneous completions = 1 wake-up
- On wake: check pending user messages first (inject as human messages, prioritized) → then drain notification queue → inject as system message → planner processes → suspend again
- **User messages take priority** — if user sends a message while planner is processing notifications, notifications pause. User is never waiting behind system bookkeeping

**Mid-execution user messages (User → Planner, unprompted):**
- `pendingUserMessages: string[]` queue in OrchestratorService — stores messages that arrive while planner is busy
- `onUserMessage(content)` handler: push to queue, wake planner with reason `'user_message'`
- Planner state determines behavior:
  - **Suspended** → wake immediately, inject as human message, planner processes
  - **Mid-LLM-call** → queue it. After current turn finishes, inject before next turn (like Claude Code)
  - **Processing notifications** → pause notifications, inject user message first, resume notifications after
- User messages injected as `addHumanMessage(content)` — NOT `addSystemMessage()`. The LLM sees them as user conversation.

**Deps:** Step 4, Step 6  
**Exit:** All lifecycle events push to queue. Planner suspends when idle. Orchestrator wakes planner on events. Mid-execution user messages reach planner with priority. All events routed through transport (not hardcoded Socket.IO).

### Step 8: Worker Failure Reporting
**Tag: NEW (workerTypes) + REFACTOR (OrchestratorService, WorkerPool)**
**Package:** `cockatiel` (install: `bun add cockatiel`)

**NEW files:**
- Create `orchestrator/types/workerTypes.ts` — `WorkerFailureReport` (structured: `errorCategory`, `retriable`, `partialProgress` description, `resourceUsage`), `ErrorCategory` enum (`llm_error | tool_error | external_service | rate_limit | timeout | validation_error | context_exceeded | permission_denied | cancelled | unknown`)

**REFACTOR files:**
- `orchestrator/OrchestratorService.ts` — **Currently:** `handleTaskFailed()` receives `{ taskId, error: string }` and just emits events. **Change:** `onTaskFailed()` receives structured `WorkerFailureReport`. Transient error retry uses `cockatiel`:
  ```typescript
  import { retry, handleWhen, ExponentialBackoff, circuitBreaker, ConsecutiveBreaker, wrap } from 'cockatiel';
  const retryPolicy = retry(handleWhen(e => e.retriable), { maxAttempts: 2, backoff: new ExponentialBackoff() });
  const breaker = circuitBreaker(handleWhen(e => e.category === 'external_service'), { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(3) });
  const resilience = wrap(retryPolicy, breaker);
  ```
  Non-transient → push to `NotificationQueue`. Downstream tasks marked `blocked` (not cascade-failed).
- `services/WorkerPool.ts` — **Currently:** Emits `worker:error` with `{ taskId, error: string }` (bare string). **Change:** Emit `worker:error` with structured `WorkerFailureReport` — classify error (`llm_error`, `tool_error`, etc.), detect if retriable, capture partial progress.

**Deps:** Step 7 (notifications)  
**Exit:** Transient errors auto-retry without bothering planner. Non-transient failures reach planner with structured data. Downstream tasks blocked.

### Step 9: Worker Cancellation (AbortController) + Watchdog
**Tag: REFACTOR (OrchestratorService, WorkerPool)**
**Package:** None — uses native `AbortController`/`AbortSignal` (JS standard)

**REFACTOR files:**
- `orchestrator/OrchestratorService.ts` — **Currently:** No cancellation support. Workers run until done or failed. No heartbeat monitoring. **Add:**
  - `Map<taskId, AbortController>` — one controller per active worker
  - `cancelWorker(taskId, reason)` calls `controller.abort(reason)` (reasons: upstream failed, task cancelled, budget exceeded, plan replaced)
  - Watchdog `setInterval` (configurable, default 30s): check heartbeats, detect dead/idle workers, AIMD patience algorithm
  - Dead worker → abort, mark failed, notify planner
  - Stalled worker → notify planner at warning/urgent thresholds
- `services/WorkerPool.ts` — **Currently:** `runTask()` takes `(taskId, role, message)` or `TaskWithContext`. No signal parameter. **Add:** Accept `AbortSignal` parameter. Pass to `agent.execute()`. Workers check `signal.throwIfAborted()` at tool boundaries. On abort: clean up workspace, emit structured failure report.

**Deps:** Step 8  
**Exit:** Orchestrator can cancel running workers. Watchdog detects dead/stalled workers. Workers abort cleanly.

### Step 10: Refactor OrchestratorService (Big Bang Integration)
**Tag: REFACTOR (heavy — OrchestratorService, SocketServerV2, AgentManagerV2, approvePlan)**

**REFACTOR files:**
- `orchestrator/OrchestratorService.ts` — This is the **main integration step** where all new modules are wired together:
  - **Remove:** `planBuilderAgent` field + `executeAgent(planBuilderAgent, ...)` calls (planner replaces it). `orchestratorAgent` field (planner is the agent). 4-state machine (planner manages its own phases). `extractResponse()` helper.
  - **Simplify `handleMessage()`:** First message → initialize PlannerAgent + start cognitive loop with goal. Subsequent messages during `executing` → `onUserMessage()` (queues + wakes planner).
  - **State machine:** `idle → executing` (2 states only). Planner manages gathering/approval internally via tools.
  - **Wire everything:** `DependencyResolver`, `NotificationQueue`, `NotificationTransport`, `UserInteractionManager`, `PlannerAgent`, cancellation controllers, watchdog timer.
  - **Keep:** `dispatchChain` serialization (still needed for workspace isolation), `PlanStore` persistence, `loadActivePlan()` recovery, `MemoryManager` task wiring.
- `api/SocketServerV2.ts` — **Currently:** `handleOrchestratorMessage()` calls `manager.orchestratorMessage()` and returns response directly. `handleWorkerMessage()` uses `startTask()` for ad-hoc task creation. **Change:** `handleOrchestratorMessage()` → first message starts planner, subsequent route to `onUserMessage()`. Handle `plan:approve`, `plan:reject` actions. `handleWorkerMessage()` → remove ad-hoc task creation via `startTask()`. Only `continueTask()` on planned tasks. Route `worker:respond` events to shared `UserInteractionManager`.
- `agentManager/AgentManagerV2.ts` — **Currently:** `USE_ORCHESTRATOR` env flag. **Change:** Replace with `PLANNER_MODE=agent|legacy`. When `agent`: use new planner-driven OrchestratorService. When `legacy`: retain current dual-agent flow. Expose `UserInteractionManager.resolveQuestion()` for Socket handler.
- `orchestrator/tools/approvePlan.ts` — **Currently:** No-input tool that auto-approves. **Change:** Becomes `request_approval` — pauses planner execution (Promise resolves when user approves via Socket.IO). On rejection: returns reason to planner.

**Deps:** Steps 1–9  
**Exit:** OrchestratorService is a tool-server for the planner. Planner drives all decisions. Workers can ask users directly. Approval flow works via Socket.IO.

### Step 11: Integration Testing
**Tag: NEW (test files) + REFACTOR (existing tests)**

**REFACTOR files:**
- `orchestrator/__tests__/tools.test.ts` — Update for renamed tools, add mocks for new tools.
- `orchestrator/__tests__/orchestrator.integration.test.ts` — Add planner-driven flow tests.

**NEW test files:**
- `orchestrator/__tests__/userInteraction.test.ts` — Resolve/timeout/disconnect/cancelAll
- `orchestrator/__tests__/dependencyResolver.test.ts` — Cycle detection (returns path), topo sort, getReady/getBlocked/getCriticalPath, re-resolution after mutation
- `orchestrator/__tests__/notificationQueue.test.ts` — Push/drain/hasUrgent, severity levels, debounce batching
- `orchestrator/__tests__/planMutation.test.ts` — Guard rails (reject in_progress, reject cycles, reject invalid roles), DAG re-resolution, Socket.IO event emission
- `orchestrator/__tests__/workerFailure.test.ts` — Error classification, auto-retry with cockatiel, circuit breaker tripping, structured report parsing
- `orchestrator/__tests__/planner.integration.test.ts` — Full E2E flows

**E2E test scenarios:**
- Full loop: goal → clarify → research → discuss → plan → approve → execute → suspend → wake on event → complete
- User timeout: `ask_user` with no response → planner proceeds with assumptions
- DAG cycle rejection → planner fixes and resubmits
- Task failure → structured report → auto-retry (transient) or planner decision (non-transient)
- Plan mutation mid-flight: `add_tasks`/`remove_task`/`update_task` → DAG valid → execution continues
- Replan: task fails → planner asks user → user says replan → old tasks cancelled → new plan dispatched
- Worker cancellation: upstream fails → AbortController → running worker aborts cleanly
- Watchdog: worker stops heartbeating → detected dead → planner notified → decides retry
- Mid-execution user message: user sends message during execution → planner wakes → processes user message → resumes plan
- User message during LLM call: message queued → injected after current turn → planner responds before continuing
- Worker asks user: worker calls `ask_user` → `worker:ask` event → user responds → worker resumes. Planner notified of waiting state.
- Approval gate: (see [A9 Approval System](../../approval-system/feature_architecture.md)) tool with `needs_approval: true` → approval requested → user approves → tool runs / user rejects → error returned to agent
- Direct worker chat: user sends message to worker → `continueTask()` on existing planned task. Ad-hoc chat rejected for planned tasks.
- All Socket.IO events reach frontend (notifications, mutations, approval requests)

## Testing Strategy
**Unit tests (mock LLM, mock Socket.IO):**
- Each tool schema validation + happy/error paths
- `UserInteractionManager`: resolve, timeout, disconnect, cancelAll, concurrent questions
- `DependencyResolver`: cycle detection (returns cycle path), topological sort, getReady/getBlocked/getCriticalPath, re-resolution after add/remove
- Plan mutation guard rails: all 5 guard rails return correct errors
- `NotificationQueue`: push/drain/hasUrgent, severity filtering, debounce batching
- `WorkerFailureReport`: classification logic, retriable detection
- Cockatiel retry: retry on transient, circuit breaker trips after 3 consecutive external_service failures

**Integration tests (real Socket.IO, mock LLM):**
- Notification lifecycle: worker completes → queue → planner woken → sees event
- Urgent notification: worker dies → system message injection → planner woken
- Socket.IO round-trip: planner asks → frontend answers → planner resumes
- Plan mutations: all mutation events received by frontend via Socket.IO
- Mid-execution user message round-trip: user sends → queued → planner woken → processed → response

## Rollback Plan
- `PLANNER_MODE=agent|legacy` env var — OrchestratorService retains current planning logic behind feature flag
- **`legacy` mode preserves:** dual-agent (orchestrator.yaml + plan-builder.yaml), 4-state machine, `handleMessage()` direct response, all current Socket events
- Graceful degradation: no frontend → `ask_user` auto-resolves after timeout, `tell_user` logs to console, `discuss_approach` picks first option

## Complexity
High — 7-8 weeks total:
- Steps 1-3 (schemas + user interaction + knowledge): ~2 weeks
- Steps 4-5 (DAG resolver + mutations): ~1.5 weeks
- Step 6 (planner agent definition): ~0.5 weeks
- Steps 7-9 (notifications + failure reporting + cancellation/watchdog): ~2 weeks
- Step 10 (orchestrator refactor — big bang integration): ~1 week
- Step 11 (integration testing): ~1 week
