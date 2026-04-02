# Frontend Redesign — Feature Architecture

## Product Vision Context

**Ping** is a team-based orchestration platform where humans and AI agents collaborate. The UI must serve as a **Team Workspace**, **Task Orchestrator**, **Agent Supervisor**, and **Single Source of Truth for outputs**. Teams are the execution boundary — they own goals, tasks, agents, and artifacts. Teams can recursively compose (team-as-agent).

The redesign must create a **design system foundation** that supports the full 7-phase roadmap:

| Phase | Frontend Capabilities Required |
|-------|-------------------------------|
| 1 (done) | Chat, task dashboard, plan approval, goal input |
| 2 | **Streaming**: token-by-token text, tool call cards, reasoning sections, notification chips, artifact previews, skill selector |
| 3 | **Teams**: team switcher, team management, agent settings, chat persistence, responsive, dark/light theme |
| 4 | **Knowledge**: wiki browser, artifact browser, workspace viewer, collaborative editor |
| 5 | **Admin**: MCP server dashboard, tool activity log, admin settings |
| 6 | **Ops**: worker health, sandbox status, resource monitoring |
| 7 | **Intelligence**: quality grades on messages, agent performance dashboard, LSP error display |

**Design principle:** The UI is **streaming-first** — all agent output arrives incrementally via Socket.IO. The chat isn't just text — it contains **rich interactive cards** (plans, approvals, artifacts, tool calls) rendered inline by `toolName`.

## Current Wiring (Must Preserve)

### Hooks & Services
| Layer | Components | Status |
|-------|-----------|--------|
| **State** | useOrchestration, useChat, useAgentTree, useToast | Preserve — UI-only changes |
| **Network** | AgentServiceV2 (Socket.IO v2 + HTTP v2) | Preserve — primary service |
| **Legacy** | SocketService, HttpService, AgentManagerService | NOT used — can remove later |
| **Data flow** | All prop-drilled from App.tsx, NO React Context | May add Context in redesign |

### Socket Events
**In:** `registered`, `message`, `state`, `progress`, `output`, `error`
**Out:** `register`, `message`, `action`
**Future:** `stream` (unified streaming channel — Phase 2), `approval:decided`, `approval:resumed`

### 13 Current Components (all get redesigned)
Sidebar, ChatArea (+5 sub), GoalInput, TaskDashboard, PlanApproval, AgentManagerPanel (+6 sub), AgentModal (+6 sub), Toast, CollaborativeEditor (+1 sub)

### Unused Backend APIs
- `progress` events — not rendered (Phase 2 will use via `stream`)
- Skills API — no UI (Phase 2: SkillSelector)
- Team members — no invite UI (Phase 3: Team Management)
- Agent status — not displayed (Phase 6: Worker Health)

## Architecture Decision

### Chosen: Tailwind CSS + shadcn/ui

**Rationale:** shadcn/ui gives Radix accessibility + full component ownership. Supports dark/light theme via CSS variables (Phase 3). Copy-paste model means no version lock-in. Ecosystem includes Sonner (toasts), cmdk (command palette), vaul (drawers) — all needed.

**Remove Mantine** after migration (currently installed but barely used — only BlockNote themes).

### Design Language: Linear/Vercel Dark

**Why this aesthetic fits Ping:** Ping is a workspace for serious work — plans, tasks, approvals, artifacts. It needs to feel **professional, information-dense, and calm** — like Linear (task management) meets Vercel (developer workspace). Not a consumer chat app.

```
Background:  zinc-950 (#09090b)     Text Primary:   zinc-50  (#fafafa)
Surface:     zinc-900 (#18181b)     Text Secondary: zinc-400 (#a1a1aa)
Elevated:    zinc-800 (#27272a)     Text Muted:     zinc-500 (#71717a)
Border:      zinc-800 (#27272a)     Accent:         blue-500 (#3b82f6)
```

**Status palette:** green-500 (ready), yellow-500 (pending), blue-500 (in-progress), emerald-500 (completed), red-500 (failed)

**Typography:** Inter (body, 14px) + JetBrains Mono (code). Weights: 400/500/600.

**Dark/light:** CSS variable-based. Dark is default. Light mode added in Phase 3.

### Layout Architecture

Designed to scale from current 3-view app to full 7-phase product:

```
┌──────────────────────────────────────────────────────────────┐
│  Command Bar (Cmd+K — global search, quick actions)          │
├─────────┬────────────────────────────────┬───────────────────┤
│         │                                │                   │
│ SIDEBAR │      MAIN CONTENT              │  DETAIL PANEL     │
│ (240px) │      (flex-1)                  │  (320px, opt.)    │
│         │                                │                   │
│ Team    │  ┌─ Context Bar ─────────────┐ │  Agent settings   │
│ Switcher│  │ Agent name · status · ... │ │  Task details     │
│         │  └───────────────────────────┘ │  Tool activity    │
│ ─────── │                                │  Event logs       │
│ Nav     │  View content:                 │  Approvals        │
│ 💬 Chat │  - Chat (streaming messages)   │  Workspace files  │
│ 📋 Tasks│  - Tasks (kanban board)        │                   │
│ 📝 Docs │  - Knowledge (wiki browser)    │                   │
│ 📦 Artf │  - Artifacts (file list)       │                   │
│ ─────── │  - Workspace (git tree)        │                   │
│ Agents  │  - Collaborate (CRDT editor)   │                   │
│ ─────── │                                │                   │
│ Admin   │  ┌─ Input Area ─────────────┐ │                   │
│ ⚙ Settngs│  │ (chat view only)         │ │                   │
│ 📊 Perf │  └───────────────────────────┘ │                   │
├─────────┴────────────────────────────────┴───────────────────┤
│  Status Bar: 🟢 Connected · 3 agents active · Planning...   │
└──────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Sidebar navigation** replaces tab bar — scales to 10+ views (not just 3)
- **Team switcher** at sidebar top — teams are the primary scope
- **Detail panel** (Sheet) replaces AgentManagerPanel — reusable for settings, logs, approvals
- **Command palette** (Cmd+K) — power user quick actions
- **Status bar** — connection health, active agents, session state at a glance
- **Routing-first** — `/teams/:id/chat`, `/teams/:id/tasks`, `/knowledge`, `/admin/*`

### Chat as Rich Interactive Canvas

The chat view is **not a simple message list**. After Phase 2, messages contain:

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Planner                                          │
│                                                      │
│ Let me analyze this...                  ← text       │
│                                                      │
│ ▶ Thinking... (click to expand)         ← reasoning  │
│                                                      │
│ ┌─ 🔧 create_plan ──────────────────┐  ← tool card  │
│ │ ✅ Complete                         │              │
│ │ 6 tasks · 3 roles · DAG view       │              │
│ │ [✓ Approve] [✏ Modify] [✕ Reject]  │              │
│ └────────────────────────────────────┘              │
│                                                      │
│ 🟢 Researcher started T-001            ← notif chip │
│ ✅ T-001 complete                       ← notif chip │
│                                                      │
│ ┌─ 📄 Market Research Report ────────┐  ← artifact  │
│ │ text/markdown · 4.2KB              │              │
│ │ [Preview] [Approve] [Reject]       │              │
│ └────────────────────────────────────┘              │
│                                                      │
│ $0.12 · 4.2K tokens · ⏱ 2m 15s       ← cost badge  │
└─────────────────────────────────────────────────────┘
```

The design system must support these **card types** as first-class components:
- **PlanCard** — interactive task DAG with dependencies
- **ApprovalCard** — structured approve/reject with context
- **ToolCard** — generic tool call with lifecycle states
- **ArtifactPreview** — rich preview by media type
- **NotificationChip** — inline task lifecycle events
- **ReasoningSection** — collapsible thinking block
- **CostBadge** — token/cost/time display
- **QualityGrade** — A-F grade with assessment (Phase 7)

## New Dependencies

`@radix-ui/*`, `tailwind-merge`, `class-variance-authority`, `clsx`, `cmdk`, `sonner`, `framer-motion`

## Impact

- **Frontend only** — no backend changes needed for v1.0
- **Mantine removal** after BlockNote themes migrated
- **All existing socket events, HTTP calls, and data flows preserved**
- **Foundation for Phases 2-7** — design system scales to streaming, teams, knowledge, admin
