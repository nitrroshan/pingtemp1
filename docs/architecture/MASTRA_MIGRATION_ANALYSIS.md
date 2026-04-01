# Mastra Migration Feasibility Analysis

> **Purpose:** Evaluate whether migrating from LangChain/LangGraph to Mastra is feasible and beneficial for this codebase.  
> **Date:** February 16, 2026  
> **Status:** Research complete — decision pending

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Is Mastra?](#2-what-is-mastra)
3. [Our Current Stack](#3-our-current-stack)
4. [Feature-by-Feature Comparison](#4-feature-by-feature-comparison)
   - [LLM Provider Support (Azure OpenAI)](#41-llm-provider-support-azure-openai)
   - [Agent Orchestration](#42-agent-orchestration)
   - [MCP Tool Support](#43-mcp-tool-support)
   - [Memory & Persistence](#44-memory--persistence)
   - [Workspace / File Operations / Git](#45-workspace--file-operations--git)
   - [Workflows & Task Planning](#46-workflows--task-planning)
   - [Observability & Evals](#47-observability--evals)
   - [API Layer (Express, Socket.IO)](#48-api-layer)
   - [RAG](#49-rag)
   - [Voice](#410-voice)
5. [What We Would KEEP vs REPLACE](#5-what-we-would-keep-vs-replace)
6. [Migration Effort Estimate](#6-migration-effort-estimate)
7. [Mastra Maturity & Community](#7-mastra-maturity--community)
8. [LSP / Code Navigation](#8-lsp--code-navigation)
9. [Git Integration](#9-git-integration)
10. [Risk Assessment](#10-risk-assessment)
11. [Recommendation](#11-recommendation)

---

## 1. Executive Summary

**Mastra is a compelling TypeScript-first AI framework that provides many features we've built by hand.** However, it does **not** replace LangChain/LangGraph — it is an independent framework with its own agent, workflow, memory, and workspace primitives. A migration would be a **full rewrite of the agent layer**, not a drop-in swap.

**Key findings:**

| Dimension | Verdict |
|---|---|
| Azure OpenAI support | ✅ Yes, via `@ai-sdk/azure` provider |
| Agent orchestration (multi-agent) | ✅ Yes — subagents, agent networks, workflows-as-tools |
| MCP tools | ✅ First-class `@mastra/mcp` — both client and server |
| Memory/persistence | ✅ Rich — message history, working memory, semantic recall, observational memory |
| MongoDB support | ✅ Supported as storage backend |
| Workspace/file ops | ✅ Built-in `Workspace` class with filesystem + sandbox + search + skills |
| Git integration | ❌ No built-in git branching — uses sandboxed environments (E2B, local) instead |
| Custom AgentManager/RoleManager | ❌ No direct equivalent — would need re-architecture |
| Skill registry | ⚠️ Has "skills" concept in workspaces, but different from our SkillRegistry |
| Express/Socket.IO API | ❌ Mastra has its own server — would require migration or bridging |
| LangChain/LangGraph compat | ❌ Separate ecosystem — no interop layer |
| Migration effort | **HIGH** — estimated 4-8 weeks for core agent layer rewrite |

---

## 2. What Is Mastra?

Mastra is a **TypeScript-native framework** for building AI-powered applications and agents. Created by the team behind Gatsby (the React static site framework). It reached **1.0 in early 2026** and is actively developed.

Core primitives:
- **Model Router**: Unified interface to 2,147 models across 79 providers via `"provider/model-name"` strings
- **Agents**: LLM + tools + instructions, with structured output, streaming, maxSteps, subagents
- **Workflows**: Graph-based workflow engine with `.then()`, `.branch()`, `.parallel()`, suspend/resume
- **Memory**: Message history, working memory, semantic recall, observational memory
- **MCP**: Full MCP client and server support
- **Workspaces**: Filesystem + sandbox + search + skills — giving agents persistent file environments
- **Evals/Scorers**: Built-in evaluation scoring for agent quality monitoring
- **Observability**: Tracing, logging, integration with external platforms (Langfuse, MLflow, Datadog)
- **RAG**: Document chunking, embedding, vector storage, retrieval
- **Voice**: TTS/STT with multiple providers
- **Studio**: Dev UI for testing agents, workflows, viewing traces

Mastra uses **Vercel AI SDK** under the hood for model routing, not LangChain.

---

## 3. Our Current Stack

Components in `src/worker/`:

| Component | Technology | Lines (approx) |
|---|---|---|
| `agent/` — AgentFactory, AgentLoader, BaseAgent | Custom + LangChain/LangGraph | ~800 |
| `agentManager/` — AgentManagerV2, AgentManagerRegistry | Custom orchestrator | ~1500 |
| `orchestrator/` — OrchestratorService, FilePlanStore, ArtifactRegistry | Custom task planning | ~1000 |
| `memory/workspace/` — AgentWorkspace, WorkspaceManager, GitBranchManager | Custom + simple-git | ~1400 |
| `memory/` — MemoryCoordinator, knowledge, stores, collaboration | Custom memory system | ~2000 |
| `memoryManager/` — MemoryManager | Custom task lifecycle | ~500 |
| `skillRegistry/` — SkillIntegration, services, tools | Custom skill system | ~1500 |
| `api/` — HTTP + Socket servers | Express + Socket.IO | ~600 |
| `db/` — MongoDB schemas | Mongoose | ~400 |
| `services/` — Various services | Custom | ~500 |

**Key dependencies:**
- `@langchain/openai` ^1.1.3
- `@langchain/langgraph` ^1.0.0
- `@langchain/mcp-adapters` ^1.0.1
- `@langchain/core` ^1.1.0
- `langchain` ^1.1.1
- `@langchain/anthropic` ^1.3.13
- `deepagents` ^1.3.0
- `simple-git` ^3.31.1
- `mongoose` ^9.0.2
- `express` ^5.1.0
- `socket.io` ^4.8.1

---

## 4. Feature-by-Feature Comparison

### 4.1 LLM Provider Support (Azure OpenAI)

| Aspect | Our System | Mastra |
|---|---|---|
| Azure OpenAI | `@langchain/openai` with env vars `AZURE_OPENAI_ENDPOINT_URL`, `AZURE_OPENAI_API_KEY` | `@ai-sdk/azure` provider, uses AI SDK under the hood |
| Model specification | Manual config object per agent | `"azure/deployment-name"` string syntax |
| Multi-provider | Manual — each agent configured separately | Built-in model router, 79 providers, fallback chains |
| Provider fallback | Not implemented | Built-in: define array of models with retry counts |

**Verdict:** ✅ Mastra supports Azure OpenAI. The `@ai-sdk/azure` package wraps the Vercel AI SDK Azure provider. Configuration would shift from env-var-based LangChain setup to AI SDK model strings. **This is a net improvement** — simpler config, built-in fallbacks.

**Migration note:** All `@langchain/openai` usage (createAgent, createDeepAgent in Agent.ts) would need rewriting to Mastra's `Agent` class with `model: "azure/your-deployment"`.

---

### 4.2 Agent Orchestration

| Aspect | Our System | Mastra |
|---|---|---|
| Multi-agent | AgentManagerV2 orchestrates workers by role | Subagents (agents-as-tools), workflows |
| Role discovery | RoleManager builds roles via LLM | No built-in role discovery; would use workflow + agent |
| Task planning | OrchestratorService + FilePlanStore + LLM-generated plans | Workflows with branching, parallel execution, state |
| Task assignment | MemoryManager tracks status, prerequisites, assignments | Workflow steps with data passing, suspend/resume |
| Worker registry | Custom registry keyed by lowercase role names | `mastra.getAgent("name")` registry |
| Event-driven | EventEmitter on AgentWorker for real-time updates | `onStepFinish` callbacks, streaming, workflow events |
| Concurrency | TaskQueue serializes per worker | Workflow `.parallel()` for concurrent steps |

**Verdict:** ⚠️ **Partial match.** Mastra provides strong workflow orchestration and subagent composition, but it does NOT have:
- Automatic role discovery (our RoleManager asks an LLM to discover roles)
- Plan generation from natural language goals
- Task lifecycle management (pending → ready → in_progress → completed → failed)
- Prerequisite-based task ordering

We'd need to **re-implement** our orchestration logic using Mastra's primitives (workflows, agents-as-tools). The building blocks are there, but the high-level orchestration patterns are ours to build.

---

### 4.3 MCP Tool Support

| Aspect | Our System | Mastra |
|---|---|---|
| MCP client | `@langchain/mcp-adapters` MultiServerMCPClient | `@mastra/mcp` MCPClient — first-class support |
| MCP server | Not implemented | `@mastra/mcp` MCPServer — expose agents/tools/workflows via MCP |
| Tool loading | Tools appended to agent config | `await mcpClient.listTools()` or `listToolsets()` for dynamic |
| Multi-tenant | Not supported | Dynamic toolsets per request (different API keys per user) |

**Verdict:** ✅ **Mastra's MCP support is more mature.** It adds MCP server capability (expose our agents over MCP) and multi-tenant dynamic tool loading. This is a clear upgrade.

---

### 4.4 Memory & Persistence

| Aspect | Our System | Mastra |
|---|---|---|
| Task memory | MemoryManager — task status, prerequisites, outputs | Workflow state, storage auto-creates tables |
| Conversation memory | Custom message arrays on AgentWorker | 4-tier memory: message history, working memory, semantic recall, observational memory |
| Knowledge storage | `memory/knowledge/` — custom | RAG pipeline with chunking, embedding, vector stores |
| Collaboration memory | `memory/collaboration/` — custom | Thread-based with resourceId (user/org ownership) |
| Storage backends | MongoDB via mongoose | PostgreSQL, MongoDB, libSQL, Upstash, Cloudflare D1, DynamoDB, LanceDB, MSSQL, Convex |
| Checkpointing | LangGraph MemorySaver with thread_id | Storage-backed conversation threads + workflow state |
| Vector search | Not implemented (planned) | Built-in with pgvector, Pinecone, Qdrant, MongoDB vector |

**Verdict:** ✅ **Mastra's memory system is significantly more sophisticated.** Our MemoryManager is primarily a task lifecycle tracker. Mastra provides:
- **Observational memory**: Background agents that summarize and compress conversation history
- **Working memory**: Persistent structured data (preferences, goals) across conversations
- **Semantic recall**: Vector-similarity retrieval of older messages
- **Memory processors**: Automatic trimming when context exceeds limits

Our MongoDB-based storage would work — Mastra supports MongoDB as a storage backend.

**Migration note:** Our MemoryManager's task-tracking semantics (prerequisites, status enums) don't map directly to Mastra's memory. We'd need to either:
1. Keep MemoryManager alongside Mastra's memory, or
2. Port task lifecycle into Mastra workflow state

---

### 4.5 Workspace / File Operations / Git

| Aspect | Our System | Mastra |
|---|---|---|
| File operations | AgentWorkspace (988 lines) — read, write, list, search | `@mastra/core/workspace` Workspace class — `read_file`, `write_file`, `list_directory`, `delete` |
| Git integration | GitBranchManager — branch per task, commit, merge | ❌ None — uses sandboxed environments instead |
| Code execution | Not implemented | `LocalSandbox` (local) or `E2BSandbox` (cloud) — `execute_command` tool |
| Cloud storage | Not implemented | S3, GCS mounts into sandboxes |
| File search | Custom workspace search tools | BM25, vector, or hybrid search over indexed workspace content |
| Skills | SkillRegistry — dynamic skill loading + LLM-generated tools | Workspace skills — reusable instruction files agents can load |
| Tool approval | Not implemented | `requireApproval: true` per tool, `requireReadBeforeWrite` guard |

**Verdict:** ⚠️ **Mixed.** Mastra's Workspace class provides many features we built by hand (file ops, search, sandboxed execution). However:

- **No git integration**: Mastra's philosophy is sandboxed, ephemeral environments (E2B) rather than git-branch-per-task. Our GitBranchManager pattern has no equivalent.
- **Sandboxing is better**: Their E2B integration provides true process isolation we don't have.
- **Skills differ**: Our SkillRegistry is a dynamic system that discovers and loads skills at runtime with LLM-generated tool wrappers. Mastra's skills are static instruction files in directories.

**If we migrate, we would:**
- Replace AgentWorkspace file ops with Mastra's Workspace
- Keep GitBranchManager as custom code (or rethink git strategy)
- Evaluate E2B sandbox vs. our current approach

---

### 4.6 Workflows & Task Planning

| Aspect | Our System | Mastra |
|---|---|---|
| Plan generation | LLM generates task plan from goal description | No built-in goal→plan; manually define workflow steps |
| Control flow | Sequential task assignment based on prerequisites | `.then()`, `.branch()`, `.parallel()`, `.foreach()` |
| Suspend/resume | Not implemented | First-class: `suspend()` in any step, resume with user input |
| Error handling | Task status → `failed` | Workflow result types: `success`, `failed`, `suspended`, `tripwire`, `paused` |
| State management | MemoryManager stores tasks + outputs | Workflow state with `stateSchema`, `setState`, automatic persistence |
| Restart | Not implemented | `restart()` from last active step, `restartAllActiveWorkflowRuns()` |

**Verdict:** ✅ **Mastra's workflow engine is more robust** for deterministic multi-step processes. It has suspend/resume, state persistence, restart from failure — all things we'd otherwise build.

However, our **dynamic plan generation** (LLM creates the plan at runtime) is fundamentally different from Mastra's **pre-defined workflow graphs**. We'd need to either:
1. Build a meta-workflow that generates and executes dynamic plans
2. Keep our OrchestratorService and use Mastra workflows for individual task execution

---

### 4.7 Observability & Evals

| Aspect | Our System | Mastra |
|---|---|---|
| Tracing | tslog logger | OpenTelemetry-based tracing with DefaultExporter, CloudExporter |
| Eval/scoring | Not implemented | Built-in scorers (answer relevancy, toxicity, custom), live evaluations |
| Studio | Not implemented | Mastra Studio — dev UI for testing agents, viewing traces, running evals |
| External platforms | Not integrated | Langfuse, MLflow, Braintrust, Datadog, New Relic, SigNoz |

**Verdict:** ✅ **Major upgrade.** We have no observability or eval infrastructure. Mastra provides production-grade tracing, live evaluation scoring, and a visual Studio UI — all out of the box.

---

### 4.8 API Layer

| Aspect | Our System | Mastra |
|---|---|---|
| HTTP server | Express 5 with custom routes | Mastra has its own server (Hono-based), or embed in Express/Next.js/Node |
| WebSocket | Socket.IO for real-time agent messages | Streaming via HTTP streaming responses (SSE), not Socket.IO |
| API pattern | REST + WebSocket events | REST + streaming; Mastra Client SDK for frontend |
| Swagger docs | swagger-jsdoc + swagger-ui-express | Not mentioned — relies on typed client SDK |

**Verdict:** ⚠️ **Friction point.** Our Express + Socket.IO API would need either:
1. Migration to Mastra's built-in server (and frontend refactoring)
2. Bridging: keep Express/Socket.IO and call Mastra agents programmatically (viable since Mastra can be used as a library)

Option 2 is more practical — use Mastra agents within our existing Express server.

---

### 4.9 RAG

| Aspect | Our System | Mastra |
|---|---|---|
| RAG | `memory/knowledge/` — nascent | Full pipeline: MDocument, chunking strategies, embedding, vector DB query |
| Vector stores | Not yet | pgvector, Pinecone, Qdrant, MongoDB vector |

**Verdict:** ✅ Mastra's RAG is production-ready and would replace whatever we're building.

---

### 4.10 Voice

| Aspect | Our System | Mastra |
|---|---|---|
| Voice | Not implemented | Full TTS/STT with 10+ providers, realtime speech-to-speech |

**Verdict:** ✅ Free capability we'd gain. Not currently needed but available.

---

## 5. What We Would KEEP vs REPLACE

### REPLACE with Mastra

| Component | Current | Mastra Replacement |
|---|---|---|
| LLM calls | `@langchain/openai`, `@langchain/anthropic` | Mastra model router (`"azure/...", "anthropic/..."`) |
| Agent creation | `Agent.ts` with LangGraph | `new Agent({...})` with Mastra |
| MCP tools | `@langchain/mcp-adapters` | `@mastra/mcp` MCPClient |
| File operations | AgentWorkspace file ops | Mastra `Workspace` with filesystem |
| Checkpointing | LangGraph MemorySaver | Mastra storage + memory |
| Conversation memory | Custom message arrays | Mastra Memory (4-tier) |
| RAG (future) | `memory/knowledge/` | `@mastra/rag` |
| Logging/tracing | tslog | Mastra observability |

### KEEP (no Mastra equivalent)

| Component | Why Keep |
|---|---|
| **AgentManagerV2** | Core orchestration logic — role discovery, dynamic planning, task assignment. No Mastra equivalent. |
| **OrchestratorService** | LLM-generated plans, artifact tracking. Mastra workflows are predefined, not LLM-generated. |
| **GitBranchManager** | Git-branch-per-task pattern. Mastra uses sandboxed environments instead. |
| **MemoryManager (task lifecycle)** | Task status tracking (pending/ready/in_progress/completed/failed). Maps partially to workflow state. |
| **SkillRegistry** | Dynamic skill discovery and LLM-generated tool wrappers. Mastra skills are simpler. |
| **Express + Socket.IO API** | Keep existing API, call Mastra agents as library. |
| **MongoDB schemas** | Keep existing data model, use Mastra's MongoDB storage adapter for memory. |
| **`deepagents` package** | Custom dependency — evaluate if still needed. |
| **Team management** | `teamService/` — no Mastra equivalent for team CRUD. |

### REFACTOR (bridge between old and new)

| Component | Approach |
|---|---|
| AgentFactory/AgentLoader | Rewrite to instantiate Mastra agents instead of LangGraph agents |
| BaseAgent | Replace with Mastra Agent class, keep custom lifecycle hooks |
| WorkspaceManager | Replace file ops with Mastra Workspace, keep git wrapper |
| Memory coordination | Use Mastra memory for conversations, keep custom memory for task state |

---

## 6. Migration Effort Estimate

### Phase 1: Core Agent Layer (2-3 weeks)
- Replace `@langchain/*` with `@mastra/core`, `@mastra/mcp`, `@ai-sdk/azure`
- Rewrite AgentFactory to produce Mastra agents
- Port BaseAgent lifecycle to Mastra Agent class
- Migrate MCP tool loading to `@mastra/mcp` MCPClient
- Update all LLM invocations to Mastra model router syntax

### Phase 2: Memory & Storage (1-2 weeks)
- Configure Mastra storage with MongoDB adapter
- Migrate conversation memory to Mastra Memory (message history + working memory)
- Bridge MemoryManager task lifecycle with workflow state
- Set up semantic recall with vector store

### Phase 3: Workspace (1 week)
- Replace AgentWorkspace file ops with Mastra Workspace
- Keep GitBranchManager as custom extension
- Evaluate E2B sandbox integration
- Port workspace tools to Mastra tool format

### Phase 4: Observability & Testing (1-2 weeks)  
- Set up Mastra observability (tracing, scorers)
- Add live evaluation scorers to agents
- Set up Mastra Studio for development
- Integration testing

### Total: 5-8 weeks for a full migration

This assumes keeping our Express/Socket.IO API and orchestration logic, replacing only the agent/LLM/memory layer.

---

## 7. Mastra Maturity & Community

| Metric | Value |
|---|---|
| GitHub stars | **21,100+** |
| Forks | 1,500+ |
| Contributors | 328 |
| Releases | 64 (latest: v1.3.0, Feb 11, 2026) |
| Used by | 1,600+ projects |
| npm downloads | Active (indicated by badge) |
| License | Apache-2.0 |
| Backing | Founded by Gatsby team; Y Combinator W25 batch |
| Discord | Active community |
| Age | ~1 year (first commits ~early 2025, 1.0 in early 2026) |
| Language | 99.2% TypeScript |
| Workspace feature | Added in v1.1.0 (very recent) |

**Assessment:** Mastra is a **well-funded, rapidly growing project** with strong community traction. The Gatsby team pedigree ensures solid engineering. However:
- **1.0 was only released ~1 month ago** — API stability is still being proven
- **Workspace feature is brand new** (v1.1.0) — less battle-tested
- **Fast-moving** — expect breaking changes in minor versions for newer features

---

## 8. LSP / Code Navigation

Mastra does **not** provide LSP (Language Server Protocol) or code navigation features. It is not an IDE tool.

What it does provide:
- **TypeScript autocomplete** for model names (auto-refreshed hourly in dev)
- **Mastra Studio**: Web-based dev UI for testing agents, inspecting traces, running evals
- **`mastra dev`**: Dev server command that runs Studio locally

For actual code navigation (go-to-definition, find references), you'd use standard TypeScript tooling. Mastra's types are well-defined, so IDE support is good.

---

## 9. Git Integration

**Mastra has NO built-in git integration.** Its workspace philosophy differs from ours:

| Our Approach | Mastra's Approach |
|---|---|
| Git branch per task | Sandboxed environment per agent (E2B or local) |
| Commits track agent work | File writes tracked by filesystem provider |
| Merge back to main on completion | Sandbox content persisted to cloud storage (S3, GCS) |
| `simple-git` for programmatic git ops | `execute_command` tool in sandbox (could run `git` if installed) |

If we need git branching, we'd keep our `GitBranchManager` and `simple-git` as custom code alongside Mastra's workspace.

Alternatively, an agent with a `LocalSandbox` could run `git` commands via `execute_command`, but this is unstructured compared to our typed GitBranchManager API.

---

## 10. Risk Assessment

### High Risk
- **LangChain ecosystem lock-in**: All our agent code uses LangChain patterns (createAgent, invoke with configurable thread_id, MemorySaver checkpoint). This is a full rewrite, not a gradual migration.
- **Orchestration gap**: Our AgentManagerV2's dynamic planning/role discovery has no Mastra equivalent. We'd need to rebuild this on top of Mastra primitives.
- **API disruption**: Frontend currently communicates via Socket.IO events. Mastra uses SSE streaming. Either bridge or migrate frontend.

### Medium Risk
- **Mastra immaturity**: v1.0 released ~1 month ago. API surface may shift.
- **deepagents dependency**: Unclear if `deepagents` (used for structured responses) has Mastra equivalent. Mastra has structured output via Zod schemas.
- **Testing gap**: Our tests reference LangChain patterns. All tests would need updates.

### Low Risk
- **Azure OpenAI**: Well-supported via AI SDK provider.
- **MongoDB**: Supported as storage backend.
- **MCP**: First-class support, migration straightforward.
- **TypeScript**: Both are TypeScript-first; type migration is mechanical.

---

## 11. Recommendation

### Option A: Full Migration to Mastra (NOT recommended now)
- **Pros**: Cleaner architecture, built-in observability/evals, better memory, workspace improvements
- **Cons**: 5-8 weeks of rewrite, risk from Mastra's young 1.0, breaks all existing tests
- **When**: Consider when Mastra reaches 1.5+ and our orchestration patterns stabilize

### Option B: Incremental Adoption (RECOMMENDED)
Keep our orchestration layer (AgentManagerV2, OrchestratorService, MemoryManager) but selectively adopt Mastra components:

1. **Phase 1**: Replace `@langchain/openai` with Mastra model router for new agents. Keep LangChain for existing agents. Test Azure OpenAI compatibility.
2. **Phase 2**: Adopt `@mastra/mcp` to replace `@langchain/mcp-adapters`. Direct module swap.
3. **Phase 3**: Integrate Mastra Memory alongside our MemoryManager for conversation persistence.
4. **Phase 4**: Add Mastra observability (tracing, Studio) without changing agent architecture.
5. **Phase 5**: Evaluate workspace migration once Mastra's workspace feature matures (post v1.2+).

**This approach:**
- Reduces risk by migrating incrementally
- Keeps our unique orchestration logic intact
- Gains Mastra's strengths (model routing, memory, observability) without a full rewrite
- Allows us to evaluate Mastra's stability over time

### Option C: Stay on LangChain (viable fallback)
- **Pros**: No migration cost, known patterns, stable ecosystem
- **Cons**: Miss out on Mastra's integrated memory, observability, workspace, and eval features; continue building these ourselves
- **When**: If Mastra's maturity doesn't improve or our needs don't align

---

## Appendix: Package Mapping

| Current Package | Mastra Replacement | Notes |
|---|---|---|
| `@langchain/openai` | `@mastra/core` + `@ai-sdk/azure` | Model router handles all providers |
| `@langchain/anthropic` | `@mastra/core` (built-in) | `"anthropic/claude-..."` string |
| `@langchain/core` | `@mastra/core` | Different API surface |
| `@langchain/langgraph` | `@mastra/core/workflows` | Workflows replace graphs |
| `@langchain/mcp-adapters` | `@mastra/mcp` | Direct replacement |
| `langchain` | `@mastra/core` | Base framework |
| `simple-git` | **Keep** | No Mastra equivalent |
| `mongoose` | **Keep** + `@mastra/mongodb` (if exists) | Use Mastra's MongoDB storage adapter for memory |
| `express` | **Keep** or Mastra server | Mastra uses Hono; can embed in Express |
| `socket.io` | **Keep** | Mastra uses SSE, not WebSocket |
| `deepagents` | Evaluate | Mastra has structured output via Zod |
| `tslog` | `@mastra/observability` | Built-in tracing replaces custom logging |

---

## Appendix: Key Mastra URLs

- Documentation: https://mastra.ai/docs
- GitHub: https://github.com/mastra-ai/mastra (21.1k stars)
- Agents: https://mastra.ai/docs/agents/overview
- Workflows: https://mastra.ai/docs/workflows/overview
- Memory: https://mastra.ai/docs/memory/overview
- MCP: https://mastra.ai/docs/mcp/overview
- Workspace: https://mastra.ai/docs/workspace/overview
- Models/Providers: https://mastra.ai/models
- Azure provider: https://mastra.ai/models/providers/azure
- Evals: https://mastra.ai/docs/evals/overview
- Observability: https://mastra.ai/docs/observability/overview
- RAG: https://mastra.ai/docs/rag/overview
