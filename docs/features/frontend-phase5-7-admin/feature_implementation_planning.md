# Frontend Phases 5-7: Admin, Ops & Intelligence — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phases:** 5 (Tools & MCP), 6 (Isolation), 7 (Intelligence)

---

## Branch
- `feature/frontend-phase5-admin` (Phase 5)
- `feature/frontend-phase6-ops` (Phase 6)
- `feature/frontend-phase7-intelligence` (Phase 7)

## Phase 5 Scope: Admin Dashboard

### Step 1: MCP Server Dashboard
**Files to create:**
- `packages/frontend/components/admin/McpDashboard.tsx` — Route: `/admin/mcp`. List connected MCP servers with status (connected/reconnecting/disconnected), tool count per server. Group by Ping packages vs third-party. "+ Connect" button for adding third-party servers.

**Exit criteria:** View all MCP server connections and health

### Step 2: Tool Activity Log
**Files to create:**
- `packages/frontend/components/chat/ToolActivityLog.tsx` — Per-message expandable section showing: tool name, input summary, result preview, execution time. Collapsed by default.

**Exit criteria:** Users see which tools were used in each response

### Step 3: Admin Settings Page
**Files to create:**
- `packages/frontend/components/admin/AdminSettings.tsx` — Route: `/admin/settings`. Sections: Connection (MongoDB status), Default Model (planner/workers dropdown), Auto-Approval defaults. Save button.

**Exit criteria:** Admin can configure global settings

**Phase 5 Total:** ~5-7 days

---

## Phase 6 Scope: Extend Existing Worker UI with Sandbox Info

**Note:** Worker health monitoring (heartbeat, stall detection, kill button) already exists via Phase 1's Watchdog (A5). The `SwarmView` + `AgentCard` components already show worker status. Phase 6 frontend only **extends** these existing components with sandbox-specific data — no new dashboards needed.

### Step 4: Extend AgentCard + SwarmView with Sandbox Data
**Files to modify:**
- `packages/frontend/components/AgentManagerPanel/AgentCard.tsx` — Add: sandbox provider badge (Microsandbox/Docker), container status indicator (running/stopped), resource usage bars (memory/CPU), network policy tag. Data from backend `worker:status` events (already emitted by Watchdog).
- `packages/frontend/components/AgentManagerPanel/SwarmView.tsx` — Add summary row at top: total active sandboxes, aggregate resource usage, provider distribution (e.g., "4 Microsandbox, 1 Docker").
- `packages/frontend/types.ts` — Extend `ActiveAgentState` with `sandbox?: { provider, containerStatus, memoryUsageMb, cpuPercent, networkPolicy }`.

**Exit criteria:** Existing AgentCard shows sandbox status alongside worker health. No new pages/routes.

**Phase 6 Total:** ~1.5 days

---

## Phase 7 Scope: Quality & Metrics

### Step 5: Quality Grades in Messages
**Files to create:**
- `packages/frontend/components/chat/QualityGrade.tsx` — Per-message grade badge (A/B/C/F). Expandable assessment showing individual scores: on-topic, matches criteria, hallucination warnings with flagged claims.

**Exit criteria:** Quality scores visible per agent response

### Step 6: Agent Performance Dashboard
**Files to create:**
- `packages/frontend/components/admin/PerformanceDashboard.tsx` — Route: `/admin/performance`. Bar chart: success rate by role (last 30 days). Summary stats: avg task time, avg quality, total goals. Sortable/filterable.

**Exit criteria:** Performance trends visible per role/agent

### Step 7: LSP Errors Panel
**Files to create:**
- `packages/frontend/components/workspace/LspErrors.tsx` — In workspace viewer: show type errors from LSP inline. File, line number, error message, suggestion.

**Exit criteria:** Coding agent type errors visible in workspace viewer

**Phase 7 Total:** ~5-7 days

---

## Testing Strategy
- Visual testing per component
- MCP dashboard reflects actual server connections
- AgentCard sandbox extensions update in real-time
- Performance charts render with sample data

## Complexity
Medium — ~12-15 days total across all three phases (Phase 6 reduced from 3-4 to 1.5 days by extending existing components).
