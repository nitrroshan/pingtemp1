# Ping — Phased Roadmap

**Created:** April 1, 2026  
**Model:** Waterfall — each phase delivers a working, evolved app  
**Principle:** Maximum value, minimum effort. After each phase, Ping works end-to-end.

---

## Golden Path (Must Never Break)

Every phase MUST pass this end-to-end flow before shipping:

```
1. User opens frontend (or CLI)
2. User submits a goal
3. Planner creates a plan (tasks + deps)
4. User approves the plan
5. Workers execute tasks (parallel when DAG allows)
6. Each task produces output
7. User sees results (approve/reject artifacts)
8. Goal completes
```

**Rule:** If a phase requires swapping an internal system (agent runtime, tool loading, workspace model), the old path MUST work alongside the new until migration is complete. Feature flags, not big-bang swaps.

---

## Current State (Updated April 6, 2026)

- AgentManagerV2 with OrchestratorService (4 tools: create_plan, approve_plan, get_status, get_context)
- MemoryManager with task DAG dependencies + RoleTaskQueue
- WorkerPool with AiSdkAgent (`AGENT_RUNTIME=aisdk`, AI SDK v6 `streamText()` + `stopWhen`)
- LangChain→AI SDK tool converter (`toAiSdkTool()` with `inputSchema`)
- Full streaming pipeline: `stream_part` events → `worker:stream` → Socket.IO → frontend `processStreamPart()`
- L1 Workspace (git, scratchpad, search, symbol index, 31 tools per agent)
- L2 Collaboration (Hocuspocus CRDT, PlanStore, GroupChatManager, collab tool)
- TeamService + MongoDB (CRUD, agents, members, skill assignments)
- SkillRegistry + SkillResolver (10 seeded skills, per-request DB loading, SkillSelector UI)
- SocketServerV2 with declarative `WORKER_EVENT_ROUTES` map
- Frontend: React Router, useOrchestration/useChat hooks, StreamMessage/ToolCard/ReasoningSection rendering
- Dev tooling: `bun run seed` (3 teams, 10 agents, 10 skills), `bun run db:reset`, `start.ps1` dev options

**What's remaining:** Plan approval UI end-to-end test, NotificationChip wiring, word-boundary streaming, LangGraph cleanup, Docker setup, CLI.

---

## Phase 1: Core Loop ✅ COMPLETE
### "User gives a goal → Planner plans → Workers execute → User approves → Done"

| Feature | What | Status |
|---|---|---|
| **Planner as Agent** | OrchestratorService with 4 tools (create_plan, approve_plan, get_status, get_context) | ✅ Done |
| **Task Orchestration** | MemoryManager with prerequisite Map, DAG ready-task detection, RoleTaskQueue | ✅ Done |
| **Frontend Orchestrator Integration** | PlanApproval, TaskDashboard, GoalInput components, useOrchestration hook | ✅ Done |
| **Seed Data** | `bun run seed` — 3 teams, 10 agents, 10 skills. `bun run db:reset`. `start.ps1` options 20-22 | ✅ Done |

#### Frontend in Phase 1

**Goal:** The core user flow works in the browser.

| What | Effort | Details |
|---|---|---|
| **Refactor App.tsx** | 3-5 days | Extract `useOrchestration()`, `useChat()`, `useAgentTree()` hooks. App.tsx drops from 1200 → ~300 lines. Add React Router for `/teams/:id/chat`, `/teams/:id/tasks`. |
| **Plan Approval (improve)** | 1-2 days | PlanApproval modal exists ✅ — enhance with task dependency visualization, edit/reorder tasks before approve. |
| **Task Dashboard** | 2-3 days | Real-time task status panel: colored chips (ready/in-progress/completed/failed), progress %. Replace current read-only TaskList. |
| **Goal Input** | 1 day | Dedicated goal submission UI (not just chat). "What do you want to build?" → submit → planner starts. |
| **Error Toasts** | 1 day | `onError()` events → toast notifications with context, not just logs in hidden panel. |

**After Phase 1 (backend):**
```
User types goal → Planner creates plan → User approves in UI → 
Workers execute in parallel → Tasks complete → User sees results
```
The core collaboration loop works. Planner decides what, orchestrator executes how, user controls flow.

**After Phase 1 (frontend):**
```
App.tsx refactored → React Router → Goal input UI →
Plan approval enhanced → Task dashboard live → Error toasts
```

**Continuity Contract — Phase 1:**

| What | Status | How Ensured |
|---|---|---|
| Golden path (goal → plan → execute → done) | ✅ **Established here** | This IS the golden path. All future phases layer on top. |
| LangGraph agent runtime | ✅ Stays | InternalAgent + `agent.invoke()` unchanged. Phase 2 will replace. |
| MemoryManager task state | ✅ Stays | Task lifecycle via MemoryManager. Phase 1 adds DAG on top, keeps MemoryManager for storage. |
| Existing frontend chat | ⚠️ Refactored | App.tsx refactored but same Socket.IO events. Old message flow preserved through new hooks. |
| WorkerPool execution | ✅ Stays | Same `runTask()` flow. Workers execute tasks, emit events. |

**Smoke test after Phase 1:**
```
bun run dev:backend && bun run dev:frontend
→ Open browser → Submit goal → See plan → Approve → Tasks execute → Results shown
→ All tasks complete → Goal marked done
→ ERROR? → Phase 1 is not done.
```

---

## Phase 2: Real-Time Experience ✅ ~90% COMPLETE
### "See everything happening in real-time, like watching a team work"

| Feature | What | Status |
|---|---|---|
| **AI SDK Migration (A1)** | `AGENT_RUNTIME=aisdk`, AiSdkAgent with `streamText()`, `azure.chat()`, `useDeploymentBasedUrls`, `stopWhen: stepCountIs()`, `Output.object()` | ✅ Done |
| **Agentic Streaming (A2)** | Full lifecycle `stream_part` events via `worker:stream` → Socket.IO → `processStreamPart` → StreamMessage/ToolCard/ReasoningSection | ✅ Done |
| **Skills Integration (C3)** | SkillResolver, 10 seeded skills, SkillSelector UI in DetailPanel, per-request DB skill loading | ✅ Done |
| **LangChain→AI SDK Tool Converter** | `toAiSdkTool()` wraps LangChain StructuredTool → AI SDK tool format with `inputSchema` | ✅ Done |
| **Immutable Stream Rendering** | React 18 StrictMode-safe with `.map()` patterns, no mutations | ✅ Done |
| **NotificationChip wiring** | Task-started/completed inline chips in chat | ⬜ Not started |
| **Smooth streaming (word-boundary)** | smoothStream transform for word-boundary chunking | ⬜ Not started |
| **StreamBridge** | Deprecated — replaced by AgentEvent pipeline via executeToolMode() | ❌ Archived |

#### Frontend in Phase 2

**Goal:** Everything streams live. The UI feels alive.

| What | Effort | Details |
|---|---|---|
| **Stream Renderer** | 3-5 days | Process single `stream` Socket.IO event. Render by type: `text-delta` → incremental text, `reasoning-*` → collapsible thinking section, `tool-input-*` / `tool-output-*` → tool call cards (showing name, args streaming, result). |
| **Tool Call Cards** | 2-3 days | Expandable cards in chat: tool name → streaming args → executing spinner → result. Rendered by `toolName` (plan card for `create_plan`, approval buttons for `request_approval`, etc.). |
| **Notification Events** | 1-2 days | `task-started`, `task-completed`, `task-failed` → inline chips in chat. `artifact-state` → approval badges. `collab-turn/outcome` → threaded collaboration view. |
| **Smooth Streaming Text** | 1 day | Word-boundary text chunking for smooth UX (not single-character jitter). |
| **Skills Selector** | 1-2 days | In agent settings: checkboxes for available skills per role. Toggle on/off, saved to backend. |

**After Phase 2 (backend):**
```
LangGraph replaced with AI SDK → streamText() with fullStream →
Tools hot-swappable per call → Skills wired into agents →
Streaming events flow to frontend via Socket.IO
```

**After Phase 2 (frontend):**
```
Streaming text token-by-token → Tool call cards → Reasoning sections →
Task chips inline → Artifact previews → Approval buttons in chat →
Skills configurable per agent
```
The experience goes from "submit and wait" to "watch your team work in real-time."

**Continuity Contract — Phase 2 (HIGHEST RISK PHASE):**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ⚠️ **At risk — agent runtime swap** | Single flag: `AGENT_RUNTIME` (values: `langgraph\|ai-sdk`). Defaults `langgraph`. Both planner and workers use the same `InternalAgent` class, so they switch together. Set to `ai-sdk` only after tests pass. |
| Agent execution | ⚠️ Migrating | Planner (OrchestratorService) and workers (WorkerPool) both use `InternalAgent` — same LangGraph `createAgent()` pipeline. Migration means replacing `InternalAgent` internals once, not per-component. Both runtimes available side-by-side until AI SDK is validated. |
| Tool loading | ⚠️ Changing | AI SDK tools have different signature than LangGraph tools. Create adapter: `langchainTool → aiSdkTool` converter. Existing tool files don't change — adapter wraps them. |
| Plan approval flow | ✅ Stays | Plan tools (`create_plan`, `approve_plan`) work the same — only the agent calling them changes internally. |
| Task orchestration | ✅ Stays | OrchestratorService dispatches tasks identically. Only the agent inside the worker changes. |
| Frontend messages | ⚠️ Enhanced | New streaming events (`text-delta`, `tool-input-*`, etc.) are ADDITIVE. Old `agent:message` events still work for non-streaming fallback. Frontend handles both. |
| SocketServerV2 events | ✅ Stays + adds | Existing events unchanged. New `stream` event added. Frontend subscribes to both during transition. |

**Migration strategy (prevents breakage):**

Single flag: `AGENT_RUNTIME` (values: `langgraph` | `ai-sdk`). Defaults to `langgraph`.
Both planner (OrchestratorService) and workers (WorkerPool) use the same `InternalAgent` class — there's no separate runtime per component. A single flag controls which backend `InternalAgent` uses internally.

```
Week 1: Build AI SDK backend for InternalAgent alongside LangGraph.
         Flag: AGENT_RUNTIME=langgraph (default)
         InternalAgent uses LangGraph createAgent() as today.
         Test: golden path still works with langgraph

Week 2: Switch InternalAgent to AI SDK. Both planner and workers switch together.
         Flag: AGENT_RUNTIME=ai-sdk
         InternalAgent uses AI SDK streamText() internally.
         Test: golden path works fully on AI SDK
         Test: streaming works end-to-end
         Test: toggle back to AGENT_RUNTIME=langgraph → rollback works

Week 3: Harden streaming, tool adapters, edge cases.
         Flag: AGENT_RUNTIME=ai-sdk (new default)
         Test: full golden path + streaming + tool calls

Week 4: Remove LangGraph code paths (or keep behind flag for rollback).
```

**Smoke test after Phase 2:**
```
bun run dev:backend && bun run dev:frontend
→ Submit goal → See plan (streamed token-by-token) → Approve
→ Watch tasks execute (tool cards, reasoning, live text)
→ Results shown → Goal done
→ Toggle AGENT_RUNTIME=langgraph → SAME test passes (rollback works)
→ ERROR? → Phase 2 is not done.
```

---

## Phase 3: Teams & Packages (3-4 weeks)
### "Multiple teams, reusable packages, production-ready structure"

**Why third:** Core loop works (Phase 1), looks great (Phase 2). Now structure it for real use — teams, packages, proper frontend.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Team Package** | Extract `@ping/agent-manager` + `@ping/teams`. Frontend only uses `@ping/teams` (via API). CLI directly calls `@ping/agent-manager` for sessions. Each team owns one AgentManager. | 2-3 weeks | B1 |
| **Teams Integration** | Frontend team UI (create, select, manage agents). CLI team commands + direct session mode. | 1-2 weeks | E6 |
| **Dev/Prod Setup** | Docker Compose, environment configs, MongoDB setup, `.env` templates. | 3-5 days | — |

#### Frontend in Phase 3

**Goal:** Multi-team experience. Settings. Polish.

| What | Effort | Details |
|---|---|---|
| **Team Switcher** | 2-3 days | Sidebar top: dropdown to switch between teams. Each team has its own agent tree, chat history, task state. |
| **Team Management Page** | 3-5 days | `/teams` page: create team, edit settings, manage roles/agents, delete team. Card-based team list. |
| **Agent Settings Panel** | 2-3 days | Per-agent: edit name, role, model, skills, system prompt. Slide-over panel. |
| **Chat Persistence** | 1-2 days | `localStorage` for chat histories + active team. Survives refresh. |
| **Responsive Layout** | 2-3 days | Mobile-friendly sidebar (collapsible), proper breakpoints. |
| **Dark/Light Theme** | 1 day | Mantine theme toggle. System preference detection. |

**After Phase 3 (backend):**
```
@ping/agent-manager + @ping/teams as packages →
Frontend → Backend API → @ping/teams only (never sees AgentManager) →
CLI → @ping/agent-manager directly for sessions (no HTTP needed) →
Each team wraps one AgentManager instance →
Docker Compose for one-command setup
```

**After Phase 3 (frontend):**
```
Team switcher → Team management page → Agent settings →
Chat persistence → Responsive layout → Dark mode
```
Ping is a real multi-team product, not a single-instance demo.

**Continuity Contract — Phase 3:**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ⚠️ **At risk — package extraction** | Extract one module at a time. After each extraction: run golden path smoke test. Old import paths re-export from new packages during transition. |
| Agent execution | ✅ Stays | AI SDK runtime (from Phase 2) unchanged. Package extraction moves files, not behavior. |
| Streaming | ✅ Stays | Same streaming pipeline. Just lives in `@ping/agent-manager` now. |
| Tool loading | ✅ Stays | Tools still loaded same way. Package extraction is structural, not behavioral. |
| Single-team mode | ✅ Preserved | Without team selection, uses default team. Frontend doesn't force team creation. |
| API endpoints | ⚠️ Adding | New team endpoints (`/api/v2/teams/*`). Existing endpoints unchanged. Frontend uses new endpoints only when teams feature is active. |
| Frontend | ⚠️ Enhanced | Team switcher is additive. Without teams, UI works exactly like Phase 2 (single team, single chat). |

**Migration strategy (prevents breakage):**
```
Step 1: Extract @ping/agent-manager. Backend imports from package.
        Test: golden path works.

Step 2: Extract @ping/teams. Backend imports from package.
        Test: golden path works (single-team, no teams UI yet).

Step 3: Wire frontend team UI. Default team auto-selected.
        Test: golden path works with default team.
        Test: create second team, switch between them.
```

**Smoke test after Phase 3:**
```
bun run dev:backend && bun run dev:frontend
→ Open browser → Default team loaded automatically
→ Submit goal → Streamed plan → Approve → Tasks stream → Done
→ Create new team → Switch to it → Submit goal → Same flow works
→ Switch back to first team → Chat history preserved
→ docker compose up → Same flow works in containers
→ ERROR? → Phase 3 is not done.
```

---

## Phase 4: Agent Workspace & Persistence (3-4 weeks)
### "Agents work in isolated spaces, knowledge persists, nothing is lost"

**Why fourth:** Teams work (Phase 3) but agents share filesystem, crashes lose state, no organizational memory.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Git Task Context** | Two-repo model: memory repo (per-role play area) + workspace repo (shared deliverables). Branch-per-task, merge on completion. | 2-3 weeks | A8 |
| **Knowledge Base (L3)** | Wiki for organizational memory. Document types, git-backed markdown, auto-inject into agents, promotion from L2, wiki UI. | 2-3 weeks | D1 |
| **L2 Search** | Hocuspocus SearchExtension. `l2` tool with search/grep/ls/cat/query. Agents search shared state. | 3-4 days | — |

#### Frontend in Phase 4

**Goal:** Knowledge wiki, artifact browser, workspace visibility.

| What | Effort | Details |
|---|---|---|
| **Knowledge Wiki Browser** | 3-5 days | `/knowledge` page: folder tree (skills/runbooks/projects/decisions), markdown viewer, search bar, create/edit buttons. |
| **Artifact Browser** | 2-3 days | Per-goal: list all artifacts produced with status badges (pending/approved/rejected). Click to preview (markdown/code/image). |
| **Workspace Viewer** | 2-3 days | Per-agent: see current workspace files (read-only git tree), commit history, branch info. |
| **Collaborative Editor (fix)** | 2-3 days | Ensure BlockNote + Hocuspocus syncs reliably. Show presence indicators (which agent is editing). |

**After Phase 4 (backend):**
```
Two git repos per team (memory + workspace) → Branch-per-task →
L3 wiki stores org knowledge → Auto-inject at task start →
L2 search (grep/query over CRDT docs)
```

**After Phase 4 (frontend):**
```
Knowledge wiki browser → Artifact browser → Workspace viewer →
CRDT editor fixed → Presence indicators
```
Agents have real workspaces, knowledge compounds, nothing is lost on restart.

**Continuity Contract — Phase 4:**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ⚠️ **At risk — workspace model change** | Feature flag: `GIT_MODEL=dual\|single`. Default `single` during migration (current behavior). Switch to `dual` after validation. |
| File operations | ⚠️ Changing | `workspace_read/write/list` tools still work — internally they now route through WorkspaceRepo (task branch). Same API, different backend. |
| Task execution | ✅ Stays | WorkerPool calls same `runTask()`. Internally creates branch before, merges after. Worker doesn't know. |
| Streaming | ✅ Stays | Unchanged from Phase 2. |
| Teams | ✅ Stays | Unchanged from Phase 3. |
| Agent output | ⚠️ Enhanced | `workspace_publish` now means "commit to task branch + mark ready for approval" instead of direct manifest write. Approval → merge to main. Without approval enabled, auto-merges (preserves current behavior). |
| Knowledge Base | ✅ Additive | New L3 features don't touch existing L1/L2 paths. Knowledge injection is optional — workers work without it. |

**Migration strategy (prevents breakage):**
```
Step 1: Add git abstractions (RepoManager, WorkspaceRepo). GIT_MODEL=single (default).
        Test: golden path works identically to Phase 3.

Step 2: Wire workspace branching behind GIT_MODEL=dual.
        Test: GIT_MODEL=single → golden path unchanged.
        Test: GIT_MODEL=dual → golden path with branches + merge.

Step 3: Add memory repo + knowledge base. Purely additive.
        Test: golden path unchanged (knowledge injection is bonus context).

Step 4: Switch default to GIT_MODEL=dual.
        Test: full golden path with workspace branches.
```

**Smoke test after Phase 4:**
```
bun run dev:backend && bun run dev:frontend
→ Submit goal → Plan → Approve → Tasks execute on workspace branches
→ Task completes → Artifacts shown for review → Approve → Merged to main
→ Check /knowledge page → Knowledge wiki renders
→ Submit similar goal → Agent gets prior knowledge injected
→ Toggle GIT_MODEL=single → Old behavior still works (rollback)
→ ERROR? → Phase 4 is not done.
```

---

## Phase 5: Tools & MCP Ecosystem (3-4 weeks)
### "Everything is a package, MCP servers, pluggable tools"

**Why fifth:** The system works great internally. Now make it composable — tools as packages, MCP for external consumers.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Tools & MCP** | Extract `@ping/workspace-tools`, `@ping/lifecycle-tools` (in-process). Build `@ping/mcp-collab`, `@ping/mcp-knowledge`, `@ping/mcp-skills` (MCP servers). | 3-4 weeks | A3 |
| **CLI System** | Full CLI rebuild. `ping team`, `ping chat`, `ping plan`, `ping tasks`. Imports packages directly. | 1-2 weeks | — |

#### Frontend in Phase 5

**Goal:** Tool/MCP visibility, admin dashboard.

| What | Effort | Details |
|---|---|---|
| **MCP Server Dashboard** | 2-3 days | Admin page: list connected MCP servers, tools per server, health status. Add/remove third-party MCP servers. |
| **Tool Activity Log** | 1-2 days | In agent chat: expandable "tools used" section per message. Shows each tool call + result. |
| **Admin Settings** | 2-3 days | `/settings` page: MongoDB connection, MCP server configs, default model, auto-approval rules. |

**After Phase 5 (backend):**
```
@ping/workspace-tools + @ping/lifecycle-tools (in-process packages) →
@ping/mcp-collab + @ping/mcp-knowledge + @ping/mcp-skills (MCP servers) →
CLI imports packages directly → Third-party MCP servers slot in
```

**After Phase 5 (frontend):**
```
MCP server dashboard → Tool activity log → Admin settings page
```
Ping is an ecosystem, not a monolith.

**Continuity Contract — Phase 5:**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ⚠️ **At risk — tool extraction** | Extract tools into packages but keep re-exports from old paths. Workers load tools via `getToolsForRole()` — that function's internals change (loads from package), its API doesn't. |
| Tool execution | ⚠️ Restructured | Tools move from `memory/L1/workspace/tools/` to `@ping/workspace-tools`. Internal function signatures stay identical. Import paths change, but WorkerPool's `getToolsForRole()` abstracts this. |
| Streaming | ✅ Stays | Unchanged. |
| Teams | ✅ Stays | Unchanged. |
| Workspace | ✅ Stays | Unchanged. |
| MCP servers | ✅ Additive | New MCP servers (`@ping/mcp-collab`, etc.) are separate processes. They don't change the main backend. External consumers use MCP; internal code unchanged. |
| CLI | ✅ Additive | New CLI commands import `@ping/agent-manager` directly. Doesn't affect frontend or backend. |

**Migration strategy (prevents breakage):**
```
Step 1: Extract @ping/workspace-tools. Re-export from old paths.
        Test: golden path works (workers still find tools).

Step 2: Extract @ping/lifecycle-tools. Re-export from old paths.
        Test: golden path works.

Step 3: Build MCP servers as separate processes.
        Test: golden path works (MCP is additive, doesn't replace anything).

Step 4: Remove old path re-exports. All imports from packages.
        Test: golden path works via package imports.
```

**Smoke test after Phase 5:**
```
bun run dev:backend && bun run dev:frontend
→ Submit goal → Full golden path works (streaming, teams, workspace)
→ ping chat "Build a landing page" (CLI) → Same flow works
→ Connect MCP client to @ping/mcp-knowledge → Search returns results
→ /settings page → MCP servers listed with health status
→ ERROR? → Phase 5 is not done.
```

---

## Phase 6: Isolation & Security (2-3 weeks)
### "Agents can't break things, safe for production"

**Why sixth:** Everything works (Phases 1-5) but agents run in the same process. Not safe for untrusted code or multi-tenant.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Worker Sandboxing** | Microsandbox (primary — dev + prod) / Docker (fallback). Dev auto-starts Microsandbox server. Resource limits, network isolation. | 2-3 weeks | A4 |

#### Frontend in Phase 6

**Goal:** Sandbox visibility for ops/admin.

**Note:** Worker health monitoring (heartbeat, stall detection, kill) already exists via Phase 1's Watchdog (A5). SwarmView + AgentCard already show worker status. Phase 6 frontend only **extends** existing components with sandbox-specific data.

| What | Effort | Details |
|---|---|---|
| **Extend AgentCard** | 1 day | Add to existing AgentCard: sandbox provider badge (Microsandbox/Docker), container status (running/stopped), resource usage (memory/CPU bar), network policy tag. All data from backend `worker:status` events. |
| **Extend SwarmView** | 0.5 days | Add summary row: total sandboxes running, aggregate resource usage, provider distribution. |

**After Phase 6 (backend):**
```
Microsandbox/Docker per worker → Resource limits →
Network isolation → Dev auto-starts Microsandbox server
```

**After Phase 6 (frontend):**
```
AgentCard shows sandbox status + resources → SwarmView shows aggregate
(Worker health/heartbeat/kill already in Phase 1 Watchdog)
```
Safe for untrusted user goals.

**Continuity Contract — Phase 6 (HIGH RISK — tool routing change):**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ⚠️ **At risk — tool execution routing** | Feature flag: `SANDBOX_PROVIDER=microsandbox\|docker\|auto`. Auto-detection: try Microsandbox → Docker → **error** (no silent bare-metal). But during migration, existing `@ping/workspace-tools` functions still work without sandbox for testing. |
| Tool execution | ⚠️ Changing | Tools route through `sandbox.exec()` / `sandbox.readFile()` / `sandbox.writeFile()` instead of direct FS. The tool API stays the same — `SandboxProvider` wraps execution transparently. Workers don't change. |
| File operations | ⚠️ Proxied | `workspace_write()` → `sandbox.writeFile()` → file lands in mounted volume. Same result, different path. |
| Streaming | ✅ Stays | Unchanged. Streaming is Socket.IO, not affected by sandbox. |
| Teams | ✅ Stays | Unchanged. |
| Workspace (git) | ✅ Stays | Git repos mounted as volumes into sandbox. WorkspaceRepo operates on mounted path. |
| Knowledge | ✅ Stays | KnowledgeBase runs in main process (not sandboxed). Only worker tool execution is sandboxed. |

**Migration strategy (prevents breakage):**
```
Step 1: SandboxProvider interface + MicrosandboxProvider.
        Backend starts Microsandbox server automatically (dev mode).
        SANDBOX_PROVIDER=auto but tools NOT YET routed through sandbox.
        Test: golden path works identically to Phase 5.

Step 2: Route workspace tools through sandbox.
        Test: golden path works with tools executing in Microsandbox.
        Test: workspace_write → file appears in workspace repo (mounted volume).

Step 3: Add DockerProvider fallback.
        Test: Kill Microsandbox → auto-falls back to Docker → golden path works.

Step 4: Add resource limits + network isolation.
        Test: golden path works under resource limits.
        Test: isolated sandbox can't reach internet.
```

**Smoke test after Phase 6:**
```
bun run dev:backend && bun run dev:frontend
→ Microsandbox server auto-started → Workers execute in microVMs
→ Submit goal → Full golden path (streaming, teams, workspace, sandbox)
→ AgentCard shows sandbox status + resource usage
→ Kill Microsandbox → Docker fallback kicks in → Golden path still works
→ ERROR? → Phase 6 is not done.
```

---

## Phase 7: Intelligence & Quality (2-3 weeks)
### "Agents get smarter, outputs get better"

**Why last:** The platform is complete. Now improve agent intelligence.

| Feature | What | Effort | ID |
|---|---|---|---|
| **LLM Response Grading** | Score agent outputs. Detect hallucinations, off-topic responses. | 2 weeks | — |
| **LSP Integration** | Language server for coding agents. Type errors after edits, go-to-definition. | 1-2 weeks | D4 |
| **Evolving Agent** | Agents improve over time. Swappable models, performance tracking. | Ongoing | — |

#### Frontend in Phase 7

**Goal:** Quality visibility, performance metrics.

| What | Effort | Details |
|---|---|---|
| **Quality Scores** | 1-2 days | Per-output: show quality grade (A/B/C/F), hallucination warnings, confidence indicators. |
| **Agent Performance Dashboard** | 2-3 days | Per-agent: success rate, average task time, token usage, quality trend over time. |
| **LSP Error Display** | 1 day | In coding agent's workspace viewer: show type errors inline (like VS Code problems panel). |

**After Phase 7 (backend):**
```
LLM output scoring → LSP for coding agents →
Agent improvement over time → Model hot-swap
```

**After Phase 7 (frontend):**
```
Quality grades per output → Agent performance charts →
LSP error display → Hallucination warnings
```

**Continuity Contract — Phase 7 (LOW RISK — additive features):**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ✅ Safe | All Phase 7 features are additive. Grading observes outputs, doesn't change them. LSP adds diagnostics, doesn't block execution. |
| Agent execution | ✅ Stays | Same AI SDK runtime. Grading runs asynchronously AFTER output. |
| All prior features | ✅ Stays | Streaming, teams, workspace, knowledge, sandbox — all unchanged. |

**Smoke test after Phase 7:**
```
bun run dev:backend && bun run dev:frontend
→ Full golden path (streaming, teams, workspace, sandbox)
→ Task output shows quality grade badge
→ Coding agent's workspace shows LSP errors inline
→ Agent performance dashboard shows historical metrics
→ ERROR? → Phase 7 is not done.
```

---

## Parked / Research (No Phase Assigned)

These are tracked but not scheduled:

| Feature | Why Parked |
|---|---|
| Workspace Semantic Search | BM25 + grep covers 95% of need |
| Agent Collab Docs (Dual-Agent) | Research phase, complex architecture |
| External Agent Invocation | Need MCP ecosystem first (Phase 5) |
| OpenClaw Integration | Research, depends on external protocol |
| L2 as Deployed Service | Premature — L2 works embedded |
| Opensource Research | Ongoing, not a deliverable |
| Agent Worker Migration | Partially done, rest absorbed by Phase 1 |

---

## Summary: 7 Phases, 6-9 Months

| Phase | Name | Duration | Key Outcome |
|---|---|---|---|
| **1** | Core Loop | 4-5 weeks | Goal → Plan → Execute → Done |
| **2** | Real-Time | 3-4 weeks | Live streaming, AI SDK, skills |
| **3** | Teams & Packages | 3-4 weeks | Multi-team, CLI, Docker |
| **4** | Workspace & Knowledge | 3-4 weeks | Git repos, L3 wiki, L2 search |
| **5** | Tools & MCP | 3-4 weeks | Everything is a package |
| **6** | Isolation | 2-3 weeks | Sandboxed workers |
| **7** | Intelligence | 2-3 weeks | Quality scoring, LSP, evolution |

Each phase ends with a **working, demonstrable product**. No phase depends on future phases — if you stop after Phase 3, you have a usable multi-team AI platform.

```
Phase 1: "It works"
Phase 2: "It looks alive"
Phase 3: "It's a real product"
Phase 4: "It remembers everything"
Phase 5: "It's an ecosystem"
Phase 6: "It's safe"
Phase 7: "It's smart"
```
