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
- WorkerPool with AiSdkAgent (AI SDK v6 `streamText()` + `stopWhen`)
- LangChain→AI SDK tool converter (`toAiSdkTool()` with `inputSchema`)
- Full streaming pipeline: `stream_part` events → `worker:stream` → Socket.IO → frontend `processStreamPart()`
- L1 Workspace (git, scratchpad/todo, file CRUD, grep/glob, keyword search, identity, code intel, 31 tools per agent)
- L2 Collaboration (Hocuspocus CRDT, PlanStore, GroupChatManager, collab tool)
- TeamService + MongoDB (CRUD, agents, members, skill assignments)
- SkillRegistry + SkillResolver (10 seeded skills, per-request DB loading, SkillSelector UI)
- SocketServerV2 with declarative `WORKER_EVENT_ROUTES` map
- Frontend: React Router, useOrchestration/useChat hooks, StreamMessage/ToolCard/ReasoningSection rendering
- Dev tooling: `bun run seed` (3 teams, 10 agents, 10 skills), `bun run db:reset`, `start.ps1` dev options

**What's remaining:** Plan approval UI end-to-end test, Docker setup, CLI.

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
| Agent runtime | ✅ Migrated → Phase 2 | AiSdkAgent with `streamText()`. LangGraph fully removed. |
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

## Phase 2: Real-Time Experience ✅ COMPLETE
### "See everything happening in real-time, like watching a team work"

| Feature | What | Status |
|---|---|---|
| **AI SDK Migration (A1)** | AiSdkAgent with `streamText()`, `azure.chat()`, `useDeploymentBasedUrls`, `stopWhen: stepCountIs()`, `Output.object()`. LangGraph fully removed. | ✅ Done |
| **Agentic Streaming (A2)** | Full lifecycle `stream_part` events via `worker:stream` → Socket.IO → `processStreamPart` → StreamMessage/ToolCard/ReasoningSection | ✅ Done |
| **Skills Integration (C3)** | SkillResolver, 10 seeded skills, SkillSelector UI in DetailPanel, per-request DB skill loading | ✅ Done |
| **LangChain→AI SDK Tool Converter** | `toAiSdkTool()` wraps LangChain StructuredTool → AI SDK tool format with `inputSchema` | ✅ Done |
| **Immutable Stream Rendering** | React 18 StrictMode-safe with `.map()` patterns, no mutations | ✅ Done |
| **NotificationChip wiring** | Backend emits task lifecycle on `stream` channel; frontend creates standalone notification messages when outside active stream | ✅ Done |
| **Smooth streaming (word-boundary)** | SmoothStream buffers text-delta at word boundaries in AiSdkAgent.executeToolMode() | ✅ Done |
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
AI SDK streamText() with fullStream + SmoothStream word-boundary buffering →
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

**Continuity Contract — Phase 2 (COMPLETE):**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ✅ **Preserved** | AI SDK migration complete. AiSdkAgent is the only runtime. LangGraph fully removed. |
| Agent execution | ✅ Done | Planner (OrchestratorService) and workers (WorkerPool) both use `AiSdkAgent` with `streamText()`. No dual-runtime flag needed. |
| Tool loading | ✅ Done | `toAiSdkTool()` adapter wraps LangChain tools to AI SDK format. Existing tools unchanged. |
| Plan approval flow | ✅ Stays | Plan tools (`create_plan`, `approve_plan`) work the same. |
| Task orchestration | ✅ Stays | OrchestratorService dispatches tasks identically. |
| Frontend messages | ✅ Enhanced | `stream` channel delivers all content. Legacy `progress` channel still works for backward compat. |
| SocketServerV2 events | ✅ Done | `stream` channel with typed parts. Task lifecycle events (`task-started`, `task-completed`, `task-failed`) emit as both `state` and `stream` events. |
| NotificationChip | ✅ Done | Backend emits task lifecycle on `stream` channel. Frontend handles inline (during stream) and standalone (outside stream) notification messages. |
| SmoothStream | ✅ Done | Word-boundary text buffering in `AiSdkAgent.executeToolMode()` prevents single-character jitter. |

**Smoke test after Phase 2:**
```
bun run dev:backend && bun run dev:frontend
→ Submit goal → See plan (streamed token-by-token) → Approve
→ Watch tasks execute (tool cards, reasoning, live text)
→ Task chips appear inline in chat (started, completed, failed)
→ Results shown → Goal done
→ ERROR? → Phase 2 is not done.
```

---

## Phase 3: Service Audit, Event Refactor & Teams ✅ COMPLETE
### "Verify services fit the product, clean event architecture, multi-team structure"

**Why third:** Core loop works (Phase 1), looks great (Phase 2). Before adding more layers, **verify what we built actually fits the product vision**, clean up the internal event architecture (7 EventEmitters → 0), then structure for real multi-team use.

### 3A: TeamService & SkillService Audit ✅

**Goal:** Verify that TeamService and SkillRegistryService are implemented according to the product's actual needs. If they don't fit → plan and execute modifications. Check against the product vision in `docs/ping/architecture.md`.

**Why now:** These services were built for Phase 1/2 scaffolding. Before Phase 3 layers teams/packages on top, we need to confirm the foundation is right. Fixing after package extraction is 10x harder.

| Task | What | Details |
|---|---|---|
| **TeamService Audit** | Review every method against product needs | **Current API (19 methods):** `createTeam`, `getTeam`, `listTeams`, `updateTeam`, `deleteTeam`, `addAgent`, `getTeamAgents`, `removeAgent`, `updateAgentStatus`, `delegateAgent`, `reclaimAgent`, `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`, `setSkillEnabled`, `addMember`, `removeMember`, `getTeamMembers`, `getWorkspace`. **Check:** Does the Team model support everything the product needs? Is the `ownerId` / manager model correct? Does `delegateAgent`/`reclaimAgent` make sense for our execution model? Are `TeamSettings` sufficient (`executionMode`, `maxConcurrency`)? Does `getWorkspace()` integrate properly with the workspace layer? |
| **SkillRegistryService Audit** | Review every method against product needs | **Current API (15 methods):** `createSkill`, `getSkill`, `getAllSkills`, `updateSkill`, `deleteSkill`, `incrementInstallCount`, `searchSkills`, `findSimilarSkills`, `assignSkillToAgent`, `removeSkillFromAgent`, `getAgentSkills`, `getAgentsWithSkill`, `findSkillForTask`, `getStats`. **Check:** Is the skill model complete? Does semantic search (vector embeddings) work properly? Is `findSkillForTask()` used by the planner? Does the skill→tool resolution pipeline (`SkillResolver`) handle all tool types? |
| **Product Alignment Check** | Cross-reference with product architecture | Check `docs/ping/architecture.md` — does TeamService support both Design Mode (Team Builder) and Execution Mode (Runtime)? Does RoleManager→AgentManager→Worker flow use TeamService correctly? Are there missing concepts (team templates, team cloning, team versioning)? |
| **Gap Analysis & Plan** | Document gaps, plan modifications | If services don't fit: write a focused modification plan (which methods to add/change/remove, schema migrations needed). If they fit: document verification and move on. | Remove unecesary code that does not align with goal.
| **Execute Modifications** | Implement changes if needed | Apply the modification plan. Update tests. Verify golden path still works. |

**Exit criteria:** Written confirmation that TeamService and SkillRegistryService match product needs, OR modifications completed and tested.

### 3B: AgentEvent Refactor ✅

**Goal:** Replace 7 internal EventEmitter chains with typed alternatives. 0 EventEmitters in backend code afterward. Socket.IO remains the only event system (appropriate for network I/O to frontend).

**Why now:** Current architecture has 3 critical problems documented in `docs/architecture/EVENT_ARCHITECTURE_ANALYSIS.md`:
1. 7 EventEmitters with overlapping event names (`task:complete` on 3 emitters)
2. Fire-and-forget streaming (no backpressure — 787+ stream events lost if consumer is slow)
3. `.bind(this)` listeners never cleaned up (memory leak risk)

Detailed architecture: [`docs/features/task-orchestration/event-refactor/feature_architecture.md`](docs/features/task-orchestration/event-refactor/feature_architecture.md)

| Step | What | Files | Details |
|---|---|---|---|
| **WorkerPool → AsyncGenerator** | Replace `events.emit("worker:stream")` with `yield` | `WorkerPool.ts`, `SocketServerV2.ts` | `runTask()` becomes `AsyncGenerator<AgentEvent>` — consumer controls pace, backpressure preserved. Remove `WorkerPool.events` EventEmitter entirely. |
| **OrchestratorService → AsyncGenerator** | Replace `events.emit("worker:stream")` with `yield*` | `OrchestratorService.ts`, `SocketServerV2.ts` | `handleMessage()` returns `AsyncGenerator<AgentEvent>`. SocketServerV2 iterates directly. |
| **RoleTaskQueue → Direct Callbacks** | Replace `events.emit("task:available")` with callbacks | `RoleTaskQueue.ts`, `MemoryManager.ts`, `AgentManagerV2.ts` | `TaskCallbacks` interface: `onTaskReady`, `onTaskComplete`, `onTaskFailed`. Only 1 consumer (OrchestratorService) — events are overkill. Direct calls give full stack traces. |
| **OrchestratorService Wiring** | Wire direct callback injection | `OrchestratorService.ts`, `AgentManagerV2.ts` | Arrow functions in constructor — no runtime `.bind(this)`. Remove all `memoryManager.on(...)` registrations. |
| **Cleanup Dead Code** | Remove EventEmitters, aliases, route maps | Multiple files | Remove `AgentManager.events` alias, `ensureTeamEventsBroadcast()`, `attachedTeams` Set, `WORKER_EVENT_ROUTES` map, `AiSdkAgent._emitter`. |

**End state:**
```
Agent → Consumer (streaming):    AsyncGenerator pass-through (backpressure ✅)
Task DAG lifecycle:              Direct callbacks (1 consumer, type-safe ✅)
Internal coordination:           Constructor injection (traceable ✅)
→ Socket.IO (network boundary):  socket.emit() (appropriate for N browsers)
```

**Exit criteria:** 0 EventEmitters in backend. Golden path works. Streaming has backpressure. Task lifecycle is direct calls.

### 3C: Package Extraction — Plugin Architecture ✅

| Feature | What | Effort | ID |
|---|---|---|---|
| **Plugin Architecture** | Claude Code model: IPlugin, IMcpServer, ISkill interfaces. Plugins bundle skills + MCP servers + storage. L1/L2/L3 become plugins. ToolContext-driven tool resolution (planner vs worker). | 1 week | B1a |
| **Package Extraction** | Extract `@ping/agent-manager` (core engine), `@ping/teams` (team mgmt), `@ping/workspace` (L1), `@ping/collaboration` (L2), `@ping/knowledge` (L3). Backend becomes thin API. | 1-2 weeks | B1b |
| **Teams Integration** | Frontend team UI (create, select, manage agents). CLI team commands + direct session mode. | 1-2 weeks | E6 |
| **Dev/Prod Setup** | Docker Compose, environment configs, MongoDB setup, `.env` templates. | 3-5 days | — |

**New package structure after 3C:**
```
packages/
  agent-manager/     @ping/agent-manager    → core: AgentManager, WorkerPool, AiSdkAgent, plugin interfaces
  teams/             @ping/teams            → TeamService, SkillResolver, McpResolver
  workspace/         @ping/workspace        → L1: 31 workspace tools, git, codeintel
  collaboration/     @ping/collaboration    → L2: CRDT, group chat, search, publish, status
  knowledge/         @ping/knowledge        → L3: knowledge base, wiki, runbooks
  backend/           thin API               → Express + Socket.IO (imports all packages)
  frontend/          React UI               → unchanged
  registry/          agent registry          → unchanged
```

**Dependency graph (no circular deps):**
```
@ping/workspace ──────┐
@ping/collaboration ──┤── depend on ──→ @ping/agent-manager ──→ AI SDK
@ping/knowledge ──────┘
@ping/teams ──────────────────────────→ @ping/agent-manager
backend ──→ @ping/teams + all plugins
```

**Key design decisions (see [package-refactoring/feature_architecture.md](features/team-package/package-refactoring/feature_architecture.md)):**
- Skills = prompt playbooks (always/on-demand load modes), NOT executable tools
- MCP servers = tool providers (action servers + knowledge servers)
- Plugins assignable at team-level and role-level
- L2 has 4 MCP servers: collab-docs (with search/grep/query/whatsnew), group-chat, publish, status
- Pre-task workflow: search context → publish understanding + open questions → create sub-tasks for answers → execute
- Plan/task persistence: FilePlanStore default (core), L2 upgrades to CrdtPlanStore when registered

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
3A: TeamService + SkillService audited and verified for product fit →
    Skills integration fix (SkillSelector → endpoint → DB → SkillResolver pipeline) →
    AgentSkillModel duplication fixed → TeamSettings.maxConcurrency wired →
3B: 0 EventEmitters in core orchestration (typed callbacks everywhere) →
    BaseAgent._emitter + TaskList.emitter dead code removed →
3C: Plugin Architecture implemented (Steps 1-10):
    IPlugin, IMcpServer, ISkill interfaces in plugin/types.ts →
    PluginRegistry with per-context tool/skill resolution →
    L1/L2/L3 wrapped as WorkspacePlugin/CollaborationPlugin/KnowledgePlugin →
    WorkerPool: plugin-based tool assembly + legacy fallback →
    AiSdkAgent.appendSystemPrompt() for skill instruction injection →
    AgentManagerV2 uses PluginRegistry (dual-path with MemoryCoordinator) →
    OrchestratorService: planStore injected via config, toGoalId() in core →
    Frontend: Team switcher, Team Management, Agent Settings, Chat/Theme persistence →
    Dev/Prod: Docker Compose, .env.example, Dockerfiles, config system →
    Package extraction (Steps 11-15) deferred — code is decoupled, physical move is mechanical
```

**After Phase 3 (frontend):**
```
Team switcher → Team management page → Agent settings →
Chat persistence → Responsive layout → Dark mode
```
Ping is a real multi-team product with clean internals, not a brittle single-instance demo.

**Continuity Contract — Phase 3 (COMPLETE):**

| What | Status | How Ensured |
|---|---|---|
| Golden path | ✅ **Preserved** | 3A: Services audited. 3B: 0 EventEmitters (typed callbacks). 3C: Plugin architecture wraps existing code — zero behavior change. |
| Agent execution | ✅ Stays | AI SDK runtime unchanged. Plugin wrappers delegate to existing L1/L2/L3 code. |
| Streaming | ✅ Stays | Typed callbacks preserve same stream_part flow. Frontend receives identical events. |
| Tool loading | ✅ Enhanced | WorkerPool uses PluginRegistry for tool assembly; falls back to legacy MemoryCoordinator path. Both paths work. |
| Single-team mode | ✅ Preserved | Default team works without team selection. |
| API endpoints | ✅ Added | PATCH /teams/:id/agents/:agentId for agent config. Skill endpoints wired to v2 router. |
| Frontend | ✅ Enhanced | Team switcher, Team Management, Agent Settings, Chat Persistence, Dark/Light Theme. |
| EventEmitters | ✅ Removed | 0 EventEmitters in core orchestration. Socket.IO stays (network boundary). |
| Package extraction | ⏭️ Deferred | Steps 11-15 (physical file moves) deferred. Code is fully decoupled via plugin interfaces. Extraction is mechanical when needed. |

**Migration strategy (prevents breakage):**
```
Phase 3A: Audit TeamService + SkillRegistryService. Modify if needed.
          Test: golden path works. Services match product vision.

Phase 3B: Event refactor (incremental — each step is independently shippable):
  Step 1: WorkerPool → AsyncGenerator. Remove WorkerPool.events.
          Test: streaming works, golden path works.
  Step 2: OrchestratorService → AsyncGenerator. 
          Test: orchestrator streaming works.
  Step 3: RoleTaskQueue → Direct callbacks. Remove RoleTaskQueue.events.
          Test: task lifecycle works (DAG, dependencies, completion).
  Step 4: Wire OrchestratorService callbacks. Remove .bind(this).
          Test: full golden path end-to-end.
  Step 5: Cleanup dead code (aliases, route maps, unused emitters).
          Test: golden path works. 0 EventEmitters in codebase.

Phase 3C: Package extraction (15 steps — see [package-refactoring/feature_implementation_planning.md](features/team-package/package-refactoring/feature_implementation_planning.md)):
  Steps 1-5: Define interfaces + wrap L1/L2/L3 as plugins (additive, no breaking changes)
          Test: golden path works. All existing tools still function.
  Step 6: Refactor WorkerPool — plugin-based tool assembly (key decoupling)
          Test: all 31 workspace tools, collab tool, knowledge tools work via PluginRegistry.
  Steps 7-9: Cleanup AgentManagerV2, AiSdkAgent, OrchestratorService
          Test: golden path works. Zero imports from memory/ or skills/ in core.
  Step 10: Wire backend startup with plugins
          Test: golden path end-to-end.
  Steps 11-13: Extract packages (@ping/agent-manager, @ping/teams, @ping/workspace, @ping/collaboration, @ping/knowledge)
          Test: each package builds independently. bun install resolves workspace deps.
  Steps 14-15: Update backend imports + verify dependency graph
          Test: golden path works. No circular deps. All packages publishable.
```

**Smoke test after Phase 3:**
```
bun run dev:backend && bun run dev:frontend
→ Open browser → Default team loaded automatically
→ Submit goal → Streamed plan → Approve → Tasks stream → Done
→ Verify: 0 EventEmitters in backend (grep confirms)
→ Verify: streaming uses AsyncGenerator chain (backpressure preserved)
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
