# Chat Agent Layer — Implementation Planning

**Status:** Ready for Step 1 · See [feature_architecture.md](./feature_architecture.md) for the design.

## Phases

Each step matches a version. Each ships behind a default-off feature gate.

### Step 1 — `ChatAgent` + read endpoint (v1.0)
**Risk:** Low — additive, gated off by default.

**Files:**
- NEW `packages/backend/src/config/features.ts` — env-based feature flags
- NEW `packages/agent-manager/src/chatAgent/ChatAgent.ts` — class with TaskStore listeners + `getMyTasks()` delegation (no local task map)
- EDIT `packages/agent-manager/src/memory/TaskStore.ts` — add role-filtered listener wrappers: `onTaskReady(role, cb)`, `onTaskComplete(role, cb)`, `onTaskFailed(role, cb)`. Today's `RoleTaskQueue` callbacks fire for ALL tasks (include `role` in payload but no pre-filtering). Step 1 adds filtered versions.
- EDIT `packages/agent-manager/src/AgentManager*.ts` — add `chatAgents: Map<string, ChatAgent>` + `getChatAgent(role)` lazy-create helper; instantiate when `FEATURES.chatAgents` is on
- EDIT `packages/backend/api/HttpServer.ts` — add `GET /api/v2/teams/{id}/roles/{role}/tasks`

**Done when:**
- With flag off: zero behavior change, no new objects in memory
- With flag on: endpoint returns role's task list; updates within 1s of TaskStore mutation
- Unit test verifies `ChatAgent.getMyTasks()` reflects task lifecycle events

[task-001-chat-agent](./tasks/task-001-chat-agent.md)

### Step 2 — R1 read-only chat (v1.1)
**Risk:** Medium — adds an LLM loop per role.

**Files:**
- NEW `packages/agent-manager/src/chatAgent/tools/getMyTasks.ts`, `getTaskDetail.ts`, `readWorkspace.ts`, `searchCollab.ts`
- EDIT `packages/agent-manager/src/chatAgent/ChatAgent.ts` — `handleUserMessage(text): AsyncGenerator<AgentEvent>`
- EDIT `packages/backend/api/HttpServer.ts` — `POST /api/v2/teams/{id}/roles/{role}/messages`
- EDIT `packages/backend/api/SocketServerV2.ts` — route `worker:stream` for role-scoped chats to `stream` channel with `roleId` payload

**Done when:**
- User sends message to a gated role → stream response back
- Chat Agent can answer "what tasks do you have?" using its own data
- Workspace read works (returns file list / file content)

[task-002-chat-agent-chat](./tasks/task-002-chat-agent-chat.md)

### Step 3 — Channel B task updates + UI threads (v1.2)
**Risk:** Medium backend (new callback chain), Medium frontend (thread routing).

**Backend files:**
- NEW `packages/agent-manager/src/types/TaskUpdate.ts` — `TaskUpdate` discriminated union (7 variants: started, progress, tool_milestone, ask_user, blocked, completed, failed)
- EDIT `packages/agent-manager/src/agent/internal/AiSdkAgent.ts` — synthesize `TaskUpdate` events from existing hooks (`prepareStep`, `onStepFinish`, `experimental_onToolCallStart/Finish`, `onError`)
- EDIT `packages/agent-manager/src/services/WorkerPool.ts` — add `callbacks.onTaskUpdate`; fan hook-synthesized + lifecycle-tool events into single stream
- EDIT `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — route `onTaskUpdate` by `task.assigned_role` to `agentManager.getChatAgent(role).ingestTaskUpdate(...)`
- EDIT `packages/backend/api/SocketServerV2.ts` — add `task_update` Socket.IO channel (low-volume, per-team room)

**Frontend files:**
- EDIT `packages/frontend/hooks/useChat.ts` — partition messages into `main` + `threads[taskId]`
- NEW `packages/frontend/components/ChatArea/TaskThreadCard.tsx` — collapsed card showing task summary + unread count
- NEW `packages/frontend/components/ChatArea/TaskThreadView.tsx` — expanded thread view
- EDIT `packages/frontend/components/ChatArea/ChatArea.tsx` — render thread cards inline in main conversation

**Done when:**
- Worker stream events with `taskId` route to a thread, not main
- Thread card shows in main conversation with unread badge
- Click card → expanded thread view (modal or inline)

[task-003-task-threads](./tasks/task-003-task-threads.md)

### Step 4 — Chat Agent dispatches workers (v1.3)
**Risk:** High — changes the dispatch path.

**Files:**
- EDIT `packages/agent-manager/src/chatAgent/ChatAgent.ts` — `handleTask(task)` method with mode-based dispatch (auto/review/manual) + per-role concurrency (`maxConcurrentWorkers`, active set, queue)
- EDIT `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — when `chatAgentEnabledFor(task.assignedRole)` and dispatch flag on, route `onTaskReady` to ChatAgent instead of WorkerPool directly
- NEW `team.featureFlags.chatAgentDispatch` per-team override in MongoDB Team schema

**Done when:**
- Per-team override can flip dispatch path independently
- Worker events flow through ChatAgent into thread (Step 3 path)
- Falling back to WorkerPool when flag off works (kill-switch tested)

[task-004-chat-agent-dispatch](./tasks/task-004-chat-agent-dispatch.md)

### Step 5 — `create_agent_task` tool (v1.4)
**Risk:** Medium — new write path into TaskStore (still gated by Orchestrator). Self-role only — no cross-role authorization needed.

**Files:**
- NEW `packages/agent-manager/src/orchestrator/tools/createAgentTask.ts` — zod schema (no `assignedRole` field) + factory; mirrors `submitPlan.ts` shape
- EDIT `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — add `createTaskFromAgent(spec, callerRole)` method; sets `assignedRole = callerRole` server-side; reuses existing `onTaskCreated` callback
- EDIT `packages/agent-manager/src/chatAgent/ChatAgent.ts` — register the tool when `FEATURES.chatAgentTaskCreation` is on; pass `role` into tool factory so it's bound to caller
- EDIT `packages/backend/src/config/features.ts` — add `chatAgentTaskCreation` flag

**Done when:**
- Calling `backend-dev` ChatAgent in R1 chat with "add rate limiting" produces a new ready task assigned to **backend-dev** (not any other role)
- Tool schema does NOT accept `assignedRole` — orchestrator sets it from caller identity
- Validation rejects: prerequisites referencing tasks in other roles, circular prereqs within own role, missing required fields
- Task appears in Sidebar (frontend redesign) within 1s of tool call
- Per-team override works (canary)
- Cross-role request from ChatAgent returns clear error: "Use Planner for cross-role tasks"

[task-005-create-agent-task-tool](./tasks/task-005-create-agent-task-tool.md)

## Out of Scope

- MCP / Crush / Claude Code workers — covered by Worker Architecture feature
- Workspace git isolation — covered by A8 Git Task Context
- Persistence of ChatAgent state to MongoDB — v2.0
- Sub-agent spawning, child teams — covered by B3 Team Stacking

## Open Questions

1. **One ChatAgent per (team, role) or per (team, role, user)?** — Start with per (team, role). User identity is recorded on each message but state is shared. Multi-user isolation deferred to v2.
2. **What happens to in-flight conversations when flag flips?** — Step 1–3 are safe (additive). Step 4 needs a "drain" phase for the outgoing path.
3. **Should Chat Agent share LLM model config with Planner or have its own?** — Default: same as the role's existing agent definition (YAML). Override in agent definition if needed.
