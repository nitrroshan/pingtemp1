# Open-Source Research — Feature Architecture

**Status:** New (Ongoing Research)  
**Date:** March 29, 2026  
**ID:** G3

---

## Overview

Evaluate open-source projects that can simplify Ping's stack, replace custom implementations, or provide proven patterns. This is not a buildable feature — it's an ongoing research track that feeds into architecture decisions for other features.

---

## Projects to Evaluate

### Tier 1 — Actively Adopting

| Project | Simplifies | Status | Features Using |
|---|---|---|---|
| **Vercel AI SDK** (`ai`) | Model routing, streaming, tool calling, structured output | Recommended (A1) | A1, A2, A3, A5 |
| **Mastra** (`@mastra/core`) | MCP, evals, workspace/sandbox, memory | Selective adoption (A1) | A1, A3, A4, C1 |
| **`@ai-sdk/azure`** | Azure OpenAI provider | Will adopt | A1 |
| **`@mastra/mcp`** | MCP client + server | Will adopt | A3, F2, A7 |
| **`@mastra/evals`** | Scoring/evaluation | Will adopt | C1 |
| **`fastmcp`** | MCP server framework (TypeScript) | Already in deps | A3, F2 |

### Tier 2 — Evaluate for Specific Features

| Project | Simplifies | Feature | Evaluation Notes |
|---|---|---|---|
| **E2B** | Cloud sandboxes for agent execution | A4 | $0.16/hr per sandbox. Mastra has `E2BSandbox` provider. Good for prod. |
| **Daytona** | Dev environment management | A4 | Open-source alternative to E2B. Mastra has `DaytonaSandbox`. Self-hostable. |
| **Docker MCP Server** | Container management via MCP | F2, A4 | Official MCP server for Docker. Low effort integration. |
| **Brave Search MCP** | Web search via MCP | F2 | Gives agents internet access. Free tier available. |

### Tier 3 — Study for Patterns/Architecture

| Project | What to Study | Relevance |
|---|---|---|
| **OpenHands** (prev. OpenDevin) | Agent + sandbox + event stream architecture | A4 (sandboxing), A2 (streaming), A6 (task orchestration) |
| **SWE-agent** (Princeton) | Container-per-agent, tool design, trajectory | A4, A8 reference |
| **Plandex** | Git-based AI planning, context management | A6 (task orchestration), A8 (git context) |
| **Cline** | VS Code agent with streaming UI | B2 (CLI UX), A2 (streaming) |
| **Aider** | CLI-based coding agent, git integration | B2 (CLI), A8 (git) |
| **Claude Code** (Anthropic) | CLI agent UX, tool streaming, commands | B2 (CLI UX reference) |
| **Cursor** | Agent + editor integration, apply model | G1 (evolving agent patterns) |
| **Google A2A** | Agent-to-agent protocol | A7 (external agent invocation) |
| **LangGraph** (current) | Graph-based agent orchestration | E1 (orchestrator — migrating away) |
| **CrewAI** | Multi-agent with role assignment | E1 (orchestrator patterns) |
| **AutoGen** (Microsoft) | Multi-agent conversation framework | E1, G2 (agent collaboration) |
| **Julep** | Stateful AI workflows with long-running tasks | A6 (task orchestration) |
| **Inngest** | Durable functions/workflow engine | A6 (if we need external workflow) |
| **Temporal** | Distributed workflow orchestration | A6 (at scale) |

### Tier 4 — Watch / Future

| Project | What It Does | When Relevant |
|---|---|---|
| **Mastra Studio** | Dev UI for agent testing | After Mastra adoption |
| **Langfuse** | LLM observability platform | If C1 needs external platform |
| **Braintrust** | AI eval platform | If C1 needs external platform |
| **Y-Sweet** (Jamsocket) | Scalable CRDT hosting | If Hocuspocus hits scale limits |
| **ShareDB** | OT-based real-time editing | Alternative to CRDT if needed |

---

## Evaluation Criteria

For each project:
1. **Does it replace custom code?** (less code to maintain)
2. **Maturity** — version, stars, contributors, last commit
3. **TypeScript support** — first-class or wrapper?
4. **Deployment complexity** — self-hosted? cloud only? embedded?
5. **Lock-in risk** — can we swap it out if needed?
6. **Cost** — free/OSS? per-use pricing?

---

## Key Decisions This Research Informs

| Decision | Projects Informing It | Target Feature |
|---|---|---|
| Which sandbox provider? | E2B vs Daytona vs Docker vs LocalSandbox | A4 |
| Which MCP servers to start with? | Docker MCP, Brave, GitHub, filesystem | F2 |
| Agent-to-agent protocol? | MCP vs A2A vs custom HTTP | A7 |
| Task orchestration model? | Mastra workflows vs Temporal vs custom DAG | A6 |
| CLI UX patterns? | Claude Code, Cline, Aider | B2 |
