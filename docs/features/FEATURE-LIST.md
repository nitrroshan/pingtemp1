# Ping — Master Feature List

**Last Updated:** April 1, 2026  
**Total Features:** 34 (18 existing + 16 new)

---

## Legend

| Status | Meaning |
|---|---|
| ✅ Done | Implemented and working |
| 🔄 In Progress | Actively being built |
| 📋 Planned | Architecture doc exists, decision pending |
| 🆕 New | New feature from this planning session |
| 🔬 Research | Research/vision phase only |
| ⏸️ Deferred | Was planned but deferred/stalled |

---

## Feature Categories

### A. Core Runtime (Agent Execution Engine)

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| A1 | **Mastra/AI SDK Migration** | 📋 Planned | [mastra-migration](mastra-migration/) | Replace LangChain with Vercel AI SDK + selective Mastra. Foundation for streaming, tools, evals. |
| A2 | **Agentic Streaming** | 📋 Planned | [agentic-streaming](agentic-streaming/) | Real-time token/tool-call/reasoning streaming via `streamText` + Socket.IO. |
| A3 | **Tools as MCP Servers** | 🆕 New | [tools-as-mcp](tools-as-mcp/) | Refactor all built-in tools into MCP servers. Exportable as npm packages. Any agent (internal or external) can plug in. |
| A4 | **Worker Sandboxing** | 🆕 New | [worker-sandboxing](worker-sandboxing/) | Run worker agents in isolated containers/sandboxes (E2B, Daytona, Docker, or Mastra LocalSandbox). |
| A5 | **Planner as Agent** | 🆕 New | [planner-as-agent](planner-as-agent/) | Decouple planner from orchestrator. Planner is just another agent the orchestrator calls via tool/MCP. Swappable planners. |
| A6 | **Task Orchestration Redesign** | 🆕 New | [task-orchestration](task-orchestration/) | Research & redesign task lifecycle: DAG-based deps, parallel execution, retry, replan, context passing. |
| A7 | **External Agent Invocation** | 🆕 New | [external-agent-invocation](external-agent-invocation/) | Worker agents can call external agents (via MCP, HTTP, A2A protocol). Research best interop method. |
| A8 | **Git-Based Task Context** | 🆕 New | [git-task-context](git-task-context/) | Preserve agent work as git commits. Branch-per-task. New sessions can pull branches. Branches persist until project completes. |
| A9 | **Approval System** | 🆕 New | [approval-system](approval-system/) | Structured approval for plans, tools, artifacts. Leverages Mastra's `requireApproval` + `suspend()`. Depends on A1. Auto-approve rules per team. Audit trail. |
| A10 | **Persistent Agents & Three-Layer Hierarchy** | 🆕 New | [persistent-agents](persistent-agents/) | Three-layer agent hierarchy: persistent Planner (team leader) → persistent Chat Agents (role employees) → transient Task Sub-Agents (workers). Always-on chat, parallel plans, AI SDK sub-agents. Extends A5. |

### B. Platform Architecture (Packaging & Deployment)

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| B1 | **Team Package Extraction** | 🆕 New | [team-package](team-package/) | Extract team definition + AgentManager into separate npm package. Each team = one AgentManager instance. Consumable by CLI, frontend, or any app. |
| B2 | **CLI App (Backend Consumer)** | 📋 Planned / 🆕 Revamp | [cli-system](cli-system/) | Full CLI app in its own package consuming AgentManager directly. Claude Code-like UX: commands, streaming, tool visibility. Tests backend locally. |
| B3 | **Dev/Prod Environment Setup** | 🆕 New | [dev-prod-setup](dev-prod-setup/) | Proper environment configuration: dev/staging/prod profiles, Docker Compose, env validation, deployment-ready config. |
| B4 | **Seed Data System** | 🆕 New | [seed-data](seed-data/) | Configurable seeding for dev/test. Controlled via config flag. No seeding in production. Test fixtures for teams, agents, skills, tasks. |
| B5 | **Bun Monorepo Migration** | 🔄 In Progress | [bun-monorepo-migration](bun-monorepo-migration/) | Consolidate 3 package managers → Bun workspaces. Phase 4 (final cleanup) underway. |

### C. Intelligence & Quality

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| C1 | **LLM Response Grading** | 📋 Planned | [llm-response-grading](llm-response-grading/) | Mastra evals: LLM-as-judge, rule-based scoring, user feedback. Per-agent quality monitoring. |
| C2 | **Skills System** | 🔬 Research | [skills-system](skills-system/) | Portable agent capabilities: SKILL.md definitions, progressive disclosure, role templates. |
| C3 | **Skills Integration** | 🆕 New | [skills-integration](skills-integration/) | Wire skills into agent runtime: skill discovery, loading, execution. Skills as MCP tools or AI SDK tools. |

### D. Memory & Search

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| D1 | **Memory System (L1/L2/L3)** | 🔄 In Progress | [memory-system](memory-system/) | L1: workspace/branches (done). L2: CRDT collab (done). L3: knowledge base (deferred v2.0). |
| D2 | **L2 Search & Indexing** | 📋 Planned | [l2-search-indexing](l2-search-indexing/) | MiniSearch keyword + JSONPath structured queries on L2 CRDT docs. Semantic deferred. |
| D3 | **L2 as Deployed Service** | 🆕 New | [l2-service](l2-service/) | Deploy L2 (Hocuspocus + search) as standalone service. Every agent calls it for search/indexing. Separate from backend runtime. |

### E. Orchestration & Teams

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| E1 | **Orchestrator Agent** | 🔄 In Progress | [orchestrator-agent](orchestrator-agent/) | LLM-driven planning with PlanBuilder, conversational refinement, task coordination. |
| E2 | **AgentManager Redesign** | 🔄 In Progress | [agentmanager-redesign](agentmanager-redesign/) | Task lifecycle (approve, complete), workspace per task, git branches, report_status tool. |
| E3 | **Agent Refactoring** | 🔄 In Progress | [agent-refactoring](agent-refactoring/) | Unify OLD/NEW agent systems. TaskQueue integration. Worker pool consolidation. |
| E4 | **Agent Manager Migration** | ✅ Done | [agent-manager-migration](agent-manager-migration/) | Unified WorkerPool + DefinitionBuilder. Complete. |
| E5 | **Team Service** | 📋 Planned | [team-service](team-service/) | Team CRUD, manager ownership, agent delegation, isolated workspaces. |
| E6 | **Teams Integration** | 🆕 New | [teams-integration](teams-integration/) | Wire teams into frontend and CLI. Frontend uses team-based separation via AgentManager. CLI uses AgentManager directly. |

### F. Frontend & Integration

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| F1 | **Frontend Orchestrator Integration** | 📋 Planned | [frontend-orchestrator-integration](frontend-orchestrator-integration/) | Plan approval UI, task list, task chat view. Backend handlers ready, frontend Step 1.3 pending. |
| F2 | **MCP Server Integration** | 🆕 New | [mcp-integration](mcp-integration/) | Integrate at least one real MCP server (Docker MCP, filesystem MCP, or Brave Search). Prove the pipeline works end-to-end. |
| F3 | **OpenClaw Integration** | 🔬 Research | [openclaw-integration](openclaw-integration/) | External agent via OpenClaw Gateway (WhatsApp, Telegram, Discord channels). |

### G. Research & Vision

| # | Feature | Status | Directory | Summary |
|---|---------|--------|-----------|---------|
| G1 | **Evolving Agent** | 🔬 Research | [evolving-agent](evolving-agent/) | Agent architecture: goals, skills, tools, memory, swappable LLMs. |
| G2 | **Agent Collaboration Docs** | 🔬 Research | [agent-collab-docs](agent-collab-docs/) | Dual-agent design (Task + Communication per worker). Validated by DPT-Agent paper. |
| G3 | **Open-Source Research** | 🆕 New | [opensource-research](opensource-research/) | Evaluate OSS projects that simplify our stack: Mastra, AI SDK, E2B, Daytona, OpenHands, SWE-agent, Plandex, etc. |

---

## Dependency Graph

```
A1 Mastra/AI SDK Migration ──────────────────────────────────── FOUNDATION
 ├── A2 Agentic Streaming (needs streamText)
 ├── A3 Tools as MCP Servers (needs AI SDK tool() + @mastra/mcp)
 ├── A5 Planner as Agent (needs new agent primitives)
 ├── A7 External Agent Invocation (needs MCP interop)
 ├── A9 Approval System (needs requireApproval + suspend())
 ├── C1 LLM Response Grading (needs @mastra/evals)
 └── C3 Skills Integration (needs AI SDK tool format)

A3 Tools as MCP Servers ───────────────────────────────────────
 ├── F2 MCP Server Integration (prove pipeline)
 └── A7 External Agent Invocation (MCP interop)

A4 Worker Sandboxing ──────────────────────────────────────────
 ├── A8 Git-Based Task Context (sandboxed git ops)
 └── B1 Team Package (isolated team runtimes)

B1 Team Package Extraction ────────────────────────────────────
 ├── E6 Teams Integration (frontend + CLI consume)
 └── B2 CLI App (CLI consumes AgentManager package)

D2 L2 Search & Indexing ──────────────────────────────────── INDEPENDENT
 └── D3 L2 as Deployed Service (deploy search separately)

E1 Orchestrator Agent + A5 Planner as Agent ───────────────────
 ├── A6 Task Orchestration Redesign (better task lifecycle)
 └── A10 Persistent Agents (extends A5, needs 3B Event Refactor)
```

## Execution Phases

### Phase 0 — Finish In-Progress (ongoing)
> Complete stalled work. No new features.

- E2 AgentManager Redesign — finish remaining steps
- E3 Agent Refactoring — unblock Phase 3 integration  
- B5 Bun Monorepo — finish Phase 4 cleanup
- D1 Memory System — L2 collaboration stabilization

### Phase 1 — Foundation (Weeks 1-4)
> Swap the engine. Two parallel tracks.

**Track A: AI SDK Migration**
- **A1** Mastra/AI SDK Migration
- **A2** Agentic Streaming
- **A3** Tools as MCP Servers (start defining)

**Track B: Infrastructure (parallel)**
- **D2** L2 Search & Indexing
- **B3** Dev/Prod Environment Setup
- **B4** Seed Data System

### Phase 2 — Platform Shape (Weeks 4-8)
> Package things properly. Prove e2e pipeline.

- **B1** Team Package Extraction
- **B2** CLI App Revamp (consumes AgentManager package)
- **A5** Planner as Agent
- **F2** MCP Integration (one real MCP server end-to-end)
- **C3** Skills Integration
- **E5** Team Service + **E6** Teams Integration

### Phase 3 — Hardening (Weeks 8-12)
> Isolation, quality, context preservation.

- **A4** Worker Sandboxing
- **A8** Git-Based Task Context
- **C1** LLM Response Grading
- **D3** L2 as Deployed Service
- **A6** Task Orchestration Redesign (research + implement)
- **A7** External Agent Invocation (research + prototype)

### Phase 4 — Polish & Ecosystem (Weeks 12+)
> Integration, research features, frontend.

- **F1** Frontend Orchestrator Integration (complete Step 1.3)
- **C2** Skills System (full design + community model)
- **G3** Open-Source Research (ongoing)
- **G1/G2** Vision features as capacity allows
- **F3** OpenClaw Integration (if prioritized)

---

## Deferred / Stalled Features (Need Decision)

These were previously planned but never started or stalled:

| Feature | Original Location | Issue | Action Needed |
|---|---|---|---|
| CLI Phase 3-4 | cli-system | Bash mode, file mentions, session save | Rolled into B2 CLI Revamp |
| Memory L3 Knowledge Base | memory-system v2.0 | Never started | Remains deferred to Phase 4+ |
| L2 Semantic Search | l2-search-indexing Tier 3 | Deferred to Phase 2 of L2 | Remains deferred |
| Frontend Step 1.3 | frontend-orchestrator-integration | Marked "deferred to separate repo" | Rolled into F1 |
| Agent Refactoring Phase 3 | agent-refactoring | Blocked on RoleTaskQueue | Unblock in Phase 0 |
| Artifact Store | docs/ping/artifact-output-strategy.md | Vision exists, no feature | Covered by A8 Git-Based Task Context |
| CRDT FS Projection | docs/ping/crdt-filesystem-projection.md | Research only | Covered by D3 L2 as Service |
| Structured Document Model | docs/ping/structured-document-model.md | North star vision | Deferred to Phase 4+ |
| Agentic UI (Vision) | docs/ping/agentic-ui.md | Concept only | Deferred to Phase 4+ |
| Database Persistence | docs/archive/REHYDRATION_STRATEGY.md | Archived | Covered by B3 Dev/Prod Setup |
| Role Discovery Enhancement | docs/archive/ROLE_DISCOVERY_ENHANCEMENT.md | Archived | Covered by A5 Planner as Agent |

---

## Open-Source Projects to Evaluate (G3)

| Project | What It Solves | Relevance |
|---|---|---|
| **Mastra** (`@mastra/core`) | Agent framework, MCP, memory, evals, workspace | A1, A3, C1, C3 |
| **Vercel AI SDK** (`ai`) | Model routing, streaming, tool calling | A1, A2 |
| **E2B** (`e2b`) | Cloud sandboxes for code execution | A4 Worker Sandboxing |
| **Daytona** | Dev environment management, workspace isolation | A4 Worker Sandboxing |
| **Docker MCP** | MCP server providing container tools | F2 MCP Integration |
| **OpenHands** (prev. OpenDevin) | Agent coding framework with sandbox | A4, A6 reference architecture |
| **SWE-agent** (Princeton) | Software engineering agent with container | A4, A8 reference |
| **Plandex** | AI planning + git-based context | A6, A8 reference |
| **Cline / Aider** | CLI-based AI coding with streaming | B2 CLI reference |
| **Claude Code** | CLI agent with tool streaming UX | B2 CLI reference (UX patterns) |
| **Model Context Protocol** | Tool interop standard | A3, A7, F2 |
| **A2A Protocol** (Google) | Agent-to-agent communication | A7 External Agent Invocation |
| **fastmcp** | TypeScript MCP server framework | A3 (already in deps) |
| **Turborepo** | Monorepo build system | B5 Monorepo (alternative to Bun workspaces) |
| **tsup / unbuild** | Package bundling for npm publish | B1 Team Package |

---

## Cross-Cutting Concerns

| Concern | Features Affected | Notes |
|---|---|---|
| **Package boundaries** | B1, B2, E6 | AgentManager as consumable package; teams package; CLI package |
| **MCP everywhere** | A3, A7, F2, C3 | All tools → MCP servers. Skills → MCP. External agents → MCP. |
| **Streaming protocol** | A2, F1, B2 | Socket.IO for frontend, direct stream for CLI, SSE for external |
| **Git as persistence** | A8, E2, A4 | Branch per task, commit on finish, pull to resume |
| **Environment config** | B3, B4 | Dev/staging/prod. Seeding. Docker Compose. |
| **Testing strategy** | B4, B2, C1 | Seed data + CLI for manual test + evals for automated quality |
