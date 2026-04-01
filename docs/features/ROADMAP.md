# Ping — Phased Roadmap

**Created:** April 1, 2026  
**Model:** Waterfall — each phase delivers a working, evolved app  
**Principle:** Maximum value, minimum effort. After each phase, Ping works end-to-end.

---

## Current State (What Works Today)

- AgentManagerV2 with OrchestratorService
- MemoryManager with task dependencies
- WorkerPool with InternalAgent (LangGraph)
- L1 Workspace (git, scratchpad, search, symbol index, 21 tools)
- L2 Collaboration (Hocuspocus CRDT, PlanStore, GroupChatManager, collab tool)
- TeamService (CRUD, agents, members — backend 95% done)
- SkillRegistry + SkillTools (5 tools, never wired)
- SocketServerV2 + HttpServer (basic events)
- Frontend (basic chat UI, agent listing)

**What's broken:** No streaming, no plan approval UI, skills not wired, teams not in UI, no sandboxing, no L3 knowledge, CLI is basic, no Docker setup.

---

## Phase 1: Core Loop (4-5 weeks)
### "User gives a goal → Planner plans → Workers execute → User approves → Done"

**Why first:** This is the minimum viable product. Nothing else matters if the core loop doesn't work. Everything built after layers on top of this.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Planner as Agent** | Planner = top-level brain. Calls `create_plan`, `replan`, `get_status`. Orchestrator = reactive runtime. | 2-3 weeks | A5 |
| **Task Orchestration** | DAG deps, parallel dispatch, failure detection, context flow. Replaces MemoryManager for task state. | (included in A5 — same work) | A6 |
| **Frontend Orchestrator Integration** | Plan approval UI, task list, status dashboard. Wire `SocketServerV2` events to React. | 3-4 days | — |
| **Seed Data** | Sample teams, agents, skills for demo/testing. | 2-3 days | — |

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

---

## Phase 2: Real-Time Experience (3-4 weeks)
### "See everything happening in real-time, like watching a team work"

**Why second:** The core loop works but feels dead — user submits goal and waits for a blob. Phase 2 makes it feel alive.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Agentic Streaming** | AI SDK `streamText` over Socket.IO. Token-by-token text, tool call cards, reasoning. Uses AI SDK Data Stream Protocol format. | 2-3 weeks | A2 |
| **Mastra/AI SDK Migration** | Replace LangGraph `agent.invoke()` with AI SDK `streamText()`. Hot-swappable tools. Required for streaming. | (included in A2 — same migration) | A1 |
| **Skills Integration** | Wire existing SkillRegistry into agent tool loading. Agent YAML declares skills. User selects skills in UI. | 1 week | C3 |

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

---

## Phase 3: Teams & Packages (3-4 weeks)
### "Multiple teams, reusable packages, production-ready structure"

**Why third:** Core loop works (Phase 1), looks great (Phase 2). Now structure it for real use — teams, packages, proper frontend.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Team Package** | Extract `@ping/agent-manager` + `@ping/teams` as separate packages. Backend becomes thin API. | 2-3 weeks | B1 |
| **Teams Integration** | Frontend team UI (create, select, manage agents). CLI team commands. | 1-2 weeks | E6 |
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
Backend is thin API layer → CLI imports packages directly →
Docker Compose for one-command setup
```

**After Phase 3 (frontend):**
```
Team switcher → Team management page → Agent settings →
Chat persistence → Responsive layout → Dark mode
```
Ping is a real multi-team product, not a single-instance demo.

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

---

## Phase 6: Isolation & Security (2-3 weeks)
### "Agents can't break things, safe for production"

**Why sixth:** Everything works (Phases 1-5) but agents run in the same process. Not safe for untrusted code or multi-tenant.

| Feature | What | Effort | ID |
|---|---|---|---|
| **Worker Sandboxing** | Microsandbox (primary) / Docker (fallback) per worker. Resource limits, network isolation. Dev mode = no sandbox. | 2-3 weeks | A4 |

#### Frontend in Phase 6

**Goal:** Sandbox visibility for ops/admin.

| What | Effort | Details |
|---|---|---|
| **Sandbox Status Panel** | 1-2 days | Per-worker: show container status (running/stopped), resource usage (memory/CPU), network policy. |
| **Worker Health Dashboard** | 1-2 days | Overview: all active workers with heartbeat indicators, stall detection alerts, kill button. |

**After Phase 6 (backend):**
```
Microsandbox/Docker per worker → Resource limits →
Network isolation → Dev mode = no sandbox
```

**After Phase 6 (frontend):**
```
Sandbox status panel → Worker health dashboard → Kill button
```
Safe for untrusted user goals.

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
