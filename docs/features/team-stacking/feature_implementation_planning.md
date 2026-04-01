# Team Stacking — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (after External Agent Invocation A7)  
**ID:** B3

---

## Branch
- `feature/team-stacking`

## Scope — Incremental Phases

### v1.0: ExternalAgent + Registry (Foundation)
_Delivered by A7 (External Agent Invocation)._

### v1.1: Team-as-MCP-Server (This Plan)
Parent team delegates goals to child teams via MCP Streamable HTTP.

### v2.0: Recursive Composition (Future)
Teams of teams with cycle detection.

---

## Implementation Steps (v1.1)

### Step 1: Create Team MCP Server
**Files to create:**
- `packages/backend/team/McpTeamServer.ts` — FastMCP server per team exposing:
  - `submit_goal(goal, context)` — Stream progress events as SSE (AsyncGenerator yields)
  - `get_capabilities()` — Return team's roles and skills
  - `cancel(goalId)` — Cancel running goal

**Transport:** Streamable HTTP (SSE streaming for real-time progress)  
**Exit criteria:** Team MCP server starts, `tools/list` returns 3 tools, `submit_goal` streams events

### Step 2: Wire Team MCP Server Startup
**Files to modify:**
- `packages/backend/server.ts` — Start MCP server per team on team creation. Assign unique port or path.
- `packages/backend/team/TeamService.ts` — On `createTeam()`, start MCP server. On `deleteTeam()`, stop MCP server.

**Exit criteria:** Each team has a running MCP server

### Step 3: Register Teams in Agent Registry
**Files to modify:**
- `packages/registry/` — Allow `type: 'team'` registrations with `mcpEndpoint`, `capabilities` (union of team's role capabilities)

**Exit criteria:** Teams discoverable in registry alongside individual agents

### Step 4: Parent Planner Delegates to Child Team
**Files to modify:**
- `packages/backend/orchestrator/tools/executionTools.ts` — Planner's `submit_plan` can assign tasks to external team agents (discovered via registry)
- `packages/backend/agent/external/ExternalAgent.ts` — Handle team-specific `submit_goal` tool (instead of `execute_task`)

**Exit criteria:** Parent planner assigns a task → ExternalAgent calls child team's `submit_goal` → streams progress back

### Step 5: Add Delegation Chain for Cycle Detection (v2.0 prep)
**Files to modify:**
- `packages/backend/agent/external/ExternalAgent.ts` — Pass `delegationChain: string[]` in goal context. Each team adds its ID. If team ID already in chain → reject (cycle detected).

**Exit criteria:** Circular delegation prevented

### Step 6: Cross-Team Dependencies (v2.1 Future)
**Design:** Child team A's output feeds child team B via shared CRDT docs or parent orchestrator routing. _Not implemented in v1.1._

## Testing Strategy
- Test: child team receives goal, plans, executes, returns results via SSE
- Test: parent planner sees child team progress in real-time
- Test: cycle detection rejects circular delegation
- Test: cancel propagates to child team

## Research Notes
- **FastMCP** already in deps — ideal for team MCP servers
- MCP Streamable HTTP spec (2025-03-26) supports everything needed: SSE, sessions, resumability
- Each team MCP server runs on same host, different path (no extra ports needed)

## Complexity
Medium — 2-3 weeks for v1.1. Builds on A7 foundations.
