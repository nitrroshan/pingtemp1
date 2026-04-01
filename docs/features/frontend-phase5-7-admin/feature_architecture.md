# Frontend Phases 5-7: Admin, Ops & Intelligence — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**Phases:** 5 (Tools & MCP), 6 (Isolation), 7 (Intelligence)

---

## Overview

Phases 5-7 are admin/ops/metrics dashboards — smaller frontend efforts that build on the foundation from Phases 1-4. Combined into one doc because each phase's frontend work is 3-5 days.

---

## Phase 5 Frontend: Admin Dashboard

**Depends on:** Tools & MCP (A3)

### MCP Server Dashboard (`/admin/mcp`)

```
┌─────────────────────────────────────────────────────────────┐
│  🔌 MCP Servers                               [+ Connect]   │
│                                                              │
│  ── Ping Packages ──────────────────────────────────────     │
│  ✅ @ping/mcp-collab         8 tools  · connected           │
│  ✅ @ping/mcp-knowledge      4 tools  · connected           │
│  ✅ @ping/mcp-skills         5 tools  · connected           │
│                                                              │
│  ── Third-Party ────────────────────────────────────────     │
│  ✅ Brave Search MCP         2 tools  · connected           │
│  ⚠️ GitHub MCP               6 tools  · reconnecting...     │
│  ☐  Docker MCP               — tools  · not configured      │
│                                                              │
│  [View all tools]  [Server logs]                             │
└─────────────────────────────────────────────────────────────┘
```

### Tool Activity Log (in chat)

Per message, expandable section showing all tools called:

```
▶ 3 tools used                                    ← collapsed
▼ 3 tools used                                    ← expanded
  🔧 web-search("competitor analysis") → 12 results    45ms
  🔧 read-url("https://...") → 2.3 KB                 120ms
  🔧 summarize(content) → 150 words                    890ms
```

### Admin Settings (`/admin/settings`)

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️ Settings                                                │
│                                                              │
│  ── Connection ─────────────────────────────────────────     │
│  MongoDB:  [mongodb://localhost:27017/ping_____]             │
│  Status:   ✅ Connected                                      │
│                                                              │
│  ── Default Model ──────────────────────────────────────     │
│  Planner:  [azure/gpt-4o_______________▼]                   │
│  Workers:  [azure/gpt-4o_______________▼]                   │
│                                                              │
│  ── Auto-Approval Defaults ─────────────────────────────     │
│  ☐ Auto-approve all task proposals                           │
│  ☐ Auto-approve all artifacts                                │
│                                                              │
│  [Save]                                                      │
└─────────────────────────────────────────────────────────────┘
```

**Phase 5 frontend effort:** ~5-7 days

---

## Phase 6 Frontend: Worker Ops Dashboard

**Depends on:** Worker Sandboxing (A4)

### Worker Health Dashboard (`/admin/workers`)

```
┌─────────────────────────────────────────────────────────────┐
│  🏭 Workers                                   5 active      │
│                                                              │
│  ┌───────┬────────────┬─────────┬────────┬─────────────┐    │
│  │ Role  │ Task       │ Status  │ Memory │ Actions     │    │
│  ├───────┼────────────┼─────────┼────────┼─────────────┤    │
│  │ 📎 researcher │ T-001  │ 🟢 ok    │ 180MB │           │    │
│  │ 📎 researcher │ T-002  │ 🟢 ok    │ 165MB │           │    │
│  │ 📎 strategist │ T-003  │ 🟡 slow  │ 312MB │ [Kill]    │    │
│  │ 📎 writer     │ T-004  │ 🟢 ok    │ 201MB │           │    │
│  │ 📎 designer   │ T-005  │ 🔴 stall │ 450MB │ [Kill]    │    │
│  └───────┴────────────┴─────────┴────────┴─────────────┘    │
│                                                              │
│  Sandbox: microsandbox · Network: isolated · Max: 2GB each  │
└─────────────────────────────────────────────────────────────┘
```

- Real-time heartbeat indicators (green/yellow/red)
- Memory/CPU usage per worker
- Kill button for stuck workers
- Sandbox config display

**Phase 6 frontend effort:** ~3-4 days

---

## Phase 7 Frontend: Quality & Metrics

**Depends on:** LLM Response Grading, LSP Integration (D4)

### Quality Grades (in messages)

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 Writer                                          Grade: A │
│                                                              │
│ Here's the marketing copy for product X...                   │
│                                                              │
│ ── Quality Assessment ──                                     │
│ ✅ On-topic (0.95)                                           │
│ ✅ Matches acceptance criteria (0.88)                        │
│ ⚠️ Possible hallucination: "market share 32%" — no source   │
└─────────────────────────────────────────────────────────────┘
```

### Agent Performance Dashboard (`/admin/performance`)

```
┌─────────────────────────────────────────────────────────────┐
│  📊 Agent Performance                                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           Success Rate by Role (last 30 days)        │    │
│  │  researcher  ████████████████████████  95%           │    │
│  │  writer      ██████████████████       78%            │    │
│  │  designer    ████████████████████     82%            │    │
│  │  developer   ██████████████           65%            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Avg task time: 4m 23s · Avg quality: B+ · Total goals: 12  │
└─────────────────────────────────────────────────────────────┘
```

### LSP Errors Panel (in workspace viewer)

For coding agent workspaces, show type errors inline:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Problems (3)                                            │
│                                                              │
│  src/auth/handler.ts:42                                      │
│    Property 'tokn' does not exist on type 'User'.           │
│    Did you mean 'token'?                                     │
│                                                              │
│  src/auth/handler.ts:67                                      │
│    Argument of type 'string' is not assignable to            │
│    parameter of type 'number'.                               │
│                                                              │
│  tests/auth.test.ts:12                                       │
│    Cannot find name 'descirbe'. Did you mean 'describe'?    │
└─────────────────────────────────────────────────────────────┘
```

**Phase 7 frontend effort:** ~5-7 days

---

## Summary: All Frontend Phases

| Phase | Focus | Key Components | Effort |
|---|---|---|---|
| **1** | Core refactor + flow | Hooks, Router, Goal Input, Task Dashboard, Plan Approval | 10-12 days |
| **2** | Streaming + live | StreamMessage, ToolCards, ReasoningSection, ArtifactPreview, SkillSelector | 12-15 days |
| **3** | Teams + polish | Team Switcher, Team/Agent Settings, Persistence, Responsive, Dark Mode | 12-15 days |
| **4** | Knowledge + workspaces | Wiki Browser, Artifact Browser, Workspace Viewer, CRDT Editor fix | 15-20 days |
| **5** | Admin | MCP Dashboard, Tool Activity, Admin Settings | 5-7 days |
| **6** | Ops | Worker Health Dashboard, Sandbox Status | 3-4 days |
| **7** | Metrics | Quality Grades, Performance Charts, LSP Errors | 5-7 days |
| **Total** | | | **~65-80 days** |
