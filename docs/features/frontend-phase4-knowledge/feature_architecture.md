# Frontend Phase 4: Knowledge & Workspaces — Feature Architecture

**Status:** Decisions Confirmed  
**Date:** April 8, 2026  
**Phase:** 4  
**Depends on:** Phase 3 (teams UI, plugin architecture), Knowledge Base (D1), Git Task Context (A8)  
**UX Research:** [ux-research.md](ux-research.md)

---

## Overview

Three stacking workspace layers, each with a distinct frontend view. L1 is always present. L2 and L3 activate based on registered plugins.

```
L3: Knowledge Wiki (/knowledge)           — organizational memory
L2: Collab Panel   (/teams/:id/collaborate) — team shared state  
L1: Workspace+Artifacts (/teams/:id/workspace, /artifacts) — individual agent work
```

### Confirmed Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Workspace viewer scope | **Read + annotate** |
| 2 | Agent navigation | **Dropdown selector** |
| 3 | Artifact list layout | **Table list** (with source/trust column) |
| 4 | Approval flow | **Trust-aware preview** |
| 5 | Editor technology | **Fix BlockNote, evaluate Tiptap for v2** |
| 6 | Agent cursors | **Real cursors** (Yjs Awareness) |
| 7 | Wiki navigation | **Hybrid** (search prominent + collapsible tree) |
| 8 | Wiki view/edit | **Split-pane** (rendered markdown + source editor) |
| 9 | Trust model | **Source-based tiers** (internal / child team / external) |

### Technology Stack

```
Already have:                 Add:                          Custom-build:
────────────                 ─────                         ──────────────
BlockNote + Yjs + Hocuspocus  react-arborist               Trust Badge system
Mantine (UI framework)        @tanstack/react-query         Artifact approval flow
Socket.IO                     @uiw/react-md-editor          Agent presence indicators
react-markdown                react-syntax-highlighter      Knowledge promotion queue
                              react-diff-viewer-continued   Layer-aware navigation
                              gray-matter                   Workspace annotation system
```

---

## L1: Workspace Viewer & Artifact Browser

### Workspace Viewer (`/teams/:id/workspace`)

**Agent dropdown selector** at top. Read-only file tree with annotation support.

```
┌─────────────────────────────────────────────────────────────────┐
│  🗂️ Workspace   Agent: [researcher (T-003) ▾]   🟢 in_progress │
│  branch: task/T-003/researcher                                   │
├──────────────────┬──────────────────────────────────────────────┤
│                  │                                               │
│  📁 workspace/   │  ┌─ research-report.md ─────────────────┐    │
│  ├── 🟢 research │  │                                      │    │
│  ├── 🔵 competit │  │  # Market Research Report            │    │
│  └── 🔵 scraped- │  │                                      │    │
│                  │  │  ## Executive Summary                │    │
│  📁 .scratch/    │  │  Based on analysis of 5 competitors  │    │
│  ├── draft-v1.md │  │  ...                                 │    │
│  ├── draft-v2.md │  │                                      │    │
│  └── test-parse  │  │  ┌──────────────────────────────┐    │    │
│                  │  │  │ 💬 Annotation (you, 2m ago)   │    │    │
│  ── History ──   │  │  │ "Add error rate comparison"  │    │    │
│  abc12 "Complete │  │  └──────────────────────────────┘    │    │
│  def45 "Add comp │  │                                      │    │
│  ghi78 "Initial  │  └──────────────────────────────────────┘    │
│                  │                                               │
│  🟢 new  🔵 mod  │  [📋 Copy] [💬 Annotate] [📥 Download]       │
└──────────────────┴──────────────────────────────────────────────┘
```

**Key features:**
- **Dropdown agent/task selector** — switch between agent workspaces
- **Color markers** on files: 🟢 new, 🔵 modified, 🔴 deleted
- **workspace/ vs .scratch/** visual separation (scratch dimmer)
- **Read + annotate** — can't edit files, but can add annotations stored in L2 collab (agents read via `collab` tool)
- **Compact commit history** — last 5 commits, expandable

**Libraries:** react-arborist (file tree), react-markdown (md preview), react-syntax-highlighter (code preview)

### Artifact Browser (`/teams/:id/artifacts`)

**Table list** with trust/source column. Trust-aware approval flow.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📦 Artifacts — Goal: Build Auth System         [Filter ▾] [Status ▾]  │
│                                                                         │
│  Name                    Source          Status      Creator    Date     │
│  ─────────────────────────────────────────────────────────────────────  │
│  📄 Auth API Design      🏠 Internal     ✅ Approved  researcher  2h    │
│  📄 Login Endpoint        🏠 Internal     ✅ Approved  developer   1h    │
│  📄 Auth Module           🔗 Team: Eng    ⏳ Pending   backend     30m   │
│     ✓ Reviewed by Team: Engineering                                     │
│  📄 Security Audit        ⚠ External     ⏳ Pending   claude-mcp  15m   │
│  🖼️ Auth Flow Diagram    🏠 Internal     ⏳ Pending   designer    10m   │
│                                                                         │
│  5 artifacts · 2 approved · 3 pending     Progress: ██████░░░░ 40%     │
└─────────────────────────────────────────────────────────────────────────┘

  Click "Auth Module" → side-peek drawer opens:
  ┌──────────────────────────────────────────────────┐
  │  📄 Auth Module Implementation                    │
  │  🔗 Team: Engineering · ✓ Reviewed internally    │
  │                                                   │
  │  ┌────────────────────────────────────────────┐  │
  │  │  // auth.module.ts                          │  │
  │  │  @Module({                                  │  │
  │  │    imports: [JwtModule, UsersModule],        │  │
  │  │    controllers: [AuthController],           │  │
  │  │    providers: [AuthService, JwtStrategy],   │  │
  │  │  })                                         │  │
  │  │  export class AuthModule {}                 │  │
  │  └────────────────────────────────────────────┘  │
  │                                                   │
  │  [✓ Accept]  [🔍 Re-Review]  [✗ Reject]          │
  │                                                   │
  │  Review History:                                  │
  │  · Team: Eng planner approved (30m ago)           │
  └──────────────────────────────────────────────────┘
```

**Trust-aware approval flow:**
- 🏠 **Internal** artifacts → Preview required before Approve/Reject
- 🔗 **Child team** artifacts → Show "✓ Reviewed internally", offer **Accept** (fast) or **Re-Review** (full)  
- ⚠ **External** artifacts → Always require preview + full review, no shortcuts

**Libraries:** Mantine Table (sortable/filterable), Mantine Drawer (side-peek), react-markdown + react-syntax-highlighter (preview)

---

## L2: Collaboration Panel (`/teams/:id/collaborate`)

Fix BlockNote + Hocuspocus. Add real agent cursors via Yjs Awareness.

### What Are Agent Cursors?

When multiple agents (and humans) edit the same CRDT document, each participant's cursor position and selection is visible to others in real-time. This is powered by **Yjs Awareness protocol** — a lightweight presence system built into Yjs.

```
┌─────────────────────────────────────────────────────────────────┐
│  🤝 Collaborate   Doc: [requirements.md ▾]   🟢 Connected      │
│                   👤 3 editing                                   │
├────────────┬────────────────────────────────────────────────────┤
│            │                                                     │
│  Documents │  # Product Requirements                            │
│            │                                                     │
│  📄 requir │  ## Authentication                                 │
│  👤 3      │  Users must be able to sign in with|               │
│  📄 design │                         ▲                          │
│  👤 1      │               researcher (blue cursor)             │
│  📄 api-sp │                                                     │
│  👤 0      │  ## Authorization                                  │
│            │  Role-based access contr|ol with                   │
│            │                         ▲                          │
│            │               developer (green cursor)             │
│            │                                                     │
│            │  ## API Design                                     │
│            │  RESTful endpoints for|                            │
│            │                       ▲                            │
│            │             you (orange cursor)                    │
│            │                                                     │
├────────────┴────────────────────────────────────────────────────┤
│  🟢 researcher  🟢 developer  🟠 you                           │
│  Editing: line 5  Editing: line 12  Editing: line 18           │
└─────────────────────────────────────────────────────────────────┘
```

**How agent cursors work technically:**

```typescript
// Each agent/user broadcasts their cursor via Yjs Awareness
const provider = new WebsocketProvider("ws://hocuspocus:1234", docId, ydoc);

// Agent sets awareness state (backend does this for each agent)
provider.awareness.setLocalStateField("user", {
  name: "researcher",      // agent role name
  color: "#4A90D9",        // unique color per agent
  colorLight: "#4A90D920", // selection highlight
});

// BlockNote reads awareness and renders colored cursors automatically
const editor = useCreateBlockNote({
  collaboration: {
    fragment: ydoc.getXmlFragment("document"),
    user: { name: "researcher", color: "#4A90D9" },
    provider,
  }
});
// → Cursors appear automatically. No custom rendering needed.
```

**Connection status UX:**
- 🟢 **Connected** — editing live, cursors visible
- 🟡 **Reconnecting...** — banner (NOT modal), local edits preserved, will sync when reconnected
- 🔴 **Disconnected** — banner with retry button, edits safe locally

**Libraries:** BlockNote (@blocknote/react + @blocknote/mantine), Hocuspocus, Yjs (y-websocket, awareness)

---

## L3: Knowledge Wiki Browser (`/knowledge`)

**Hybrid navigation:** search prominent at top, collapsible folder tree on left. **Split-pane editing.**

```
┌─────────────────────────────────────────────────────────────────┐
│  📚 Knowledge Base          🔍 [Search knowledge... ⌘K] [+ New]│
│                             🔔 3 proposals to review            │
├──────────────────┬──────────────────────────────────────────────┤
│                  │                                               │
│  📁 Skills       │  # Production Deployment                     │
│  ├── 🟣 deploy-p │                                               │
│  ├── 🟣 api-desi │  ## Procedure                                │
│  └── 🟣 auth-pat │  1. Verify all tests pass in CI              │
│  📁 Runbooks     │  2. Check staging health                     │
│  ├── 🟠 incident │  3. Run: `npm run deploy:prod`               │
│  └── 🟠 campaign │  4. Monitor error rates for 15 minutes       │
│  📁 Projects     │  5. If error rate > 1%, trigger rollback     │
│  ├── 🔵 auth-ser │                                               │
│  └── 🔵 marketin │  ## Rollback                                  │
│  📁 Decisions    │  See: rollback-procedure                      │
│  ├── 🟤 why-post │                                               │
│  📁 Onboarding   │  ──────────────────────────────────          │
│  └── 🟤 eng-setu │  Type: 🟣 skill · Audience: 🤖 Agent        │
│                  │  Roles: devops, backend                       │
│                  │  Source: 🤖 Promoted from goal-001/T-003     │
│                  │  Last updated: March 30, 2026                 │
│                  │                                               │
│                  │  [✏️ Edit]  [📋 Copy Link]                    │
└──────────────────┴──────────────────────────────────────────────┘

  Click "Edit" → split-pane editor opens:
  ┌────────────────────────────┬──────────────────────────────────┐
  │  SOURCE (markdown)         │  PREVIEW (rendered)              │
  │                            │                                   │
  │  ---                       │  # Production Deployment         │
  │  type: skill               │                                   │
  │  audience: agent           │  ## Procedure                    │
  │  roles: [devops, backend]  │  1. Verify all tests pass in CI  │
  │  ---                       │  2. Check staging health         │
  │                            │  3. Run: npm run deploy:prod     │
  │  # Production Deployment   │  4. Monitor error rates for 15m  │
  │                            │  5. If error rate > 1%, rollback │
  │  ## Procedure              │                                   │
  │  1. Verify all tests...    │  ## Rollback                     │
  │                            │  See: rollback-procedure         │
  │  [Save] [Cancel]           │                                   │
  └────────────────────────────┴──────────────────────────────────┘
```

**Knowledge Promotion Queue** — notification badge when agents promote artifacts to L3:
```
┌────────────────────────────────────────────────────┐
│  🔔 Knowledge Proposals (3 pending)                │
│                                                     │
│  📄 "API Rate Limiting Pattern"                    │
│     🤖 Promoted by researcher from goal-005/T-002  │
│     Type: skill · [Review] [Dismiss]               │
│                                                     │
│  📄 "Incident Response Checklist v2"               │
│     🤖 Promoted by devops from goal-008/T-001      │
│     Type: runbook · [Review] [Dismiss]             │
│                                                     │
│  📄 "Why We Chose Postgres over Mongo"             │
│     🤖 Promoted by architect from goal-003/T-004   │
│     Type: decision · [Review] [Dismiss]            │
└────────────────────────────────────────────────────┘
```

**Libraries:** react-arborist (folder tree), react-markdown (viewer), @uiw/react-md-editor (split-pane editor), gray-matter (frontmatter), MiniSearch or API (search), Mantine Spotlight (⌘K search)

---

## Trust Model — How It's Built

### Data Model

```typescript
// Stored per-team in TeamSettings (MongoDB)
interface TrustConfig {
  // Default policies per source type
  defaults: {
    internal: 'auto-approve' | 'require-review';
    childTeam: 'auto-accept' | 'accept-with-badge' | 're-review';
    external: 'always-review' | 'per-agent';
  };
  
  // Per-agent/team overrides
  overrides: Array<{
    agentId: string;         // or teamId for child teams
    name: string;            // display name
    type: 'agent' | 'team';
    trustLevel: 'approved' | 'trusted' | 'untrusted';
  }>;
}

// Every artifact carries its source info
interface ArtifactSource {
  type: 'internal' | 'child-team' | 'external';
  agentId: string;
  agentName: string;
  teamId?: string;           // for child team artifacts
  teamName?: string;
  preReviewed: boolean;      // true if child team already approved
  reviewedBy?: string;       // who reviewed in child team
}
```

### Frontend Components

```
TrustBadge.tsx        — renders 🏠/🔗/⚠ badge based on ArtifactSource.type
TrustConfig.tsx       — team settings form for trust policies + overrides
ArtifactApproval.tsx  — trust-aware buttons (Accept vs Approve vs Re-Review)
```

### Flow

```
Artifact arrives (via worker completion or MCP SSE from child team)
  ↓
Backend attaches ArtifactSource { type, agentId, preReviewed, ... }
  ↓
Frontend receives artifact with source metadata
  ↓
TrustBadge renders based on source.type:
  internal    → 🏠 Internal (green)
  child-team  → 🔗 Team: {name} (blue) + pre-reviewed indicator
  external    → ⚠ External (orange)
  ↓
ArtifactApproval renders actions based on trust policy:
  HIGH trust  → [Accept] (one-click, acknowledges pre-review)
  MEDIUM      → [Accept] [Re-Review] (choice)
  LOW         → Must preview first → then [Approve] [Request Changes] [Reject]
```

---

## Layer-Aware Navigation

Sidebar adapts based on registered plugins:

```
Team with L1 only:       Team with L1+L2:         Team with L1+L2+L3:
┌──────────────┐        ┌──────────────┐         ┌──────────────┐
│ 💬 Chat      │        │ 💬 Chat      │         │ 💬 Chat      │
│ 📁 Workspace │        │ 📁 Workspace │         │ 📁 Workspace │
│ 📦 Artifacts │        │ 📦 Artifacts │         │ 📦 Artifacts │
│ ⚙️ Settings  │        │ 🤝 Collab    │         │ 🤝 Collab    │
│              │        │ ⚙️ Settings  │         │ 📚 Knowledge │
│              │        │              │         │ ⚙️ Settings  │
└──────────────┘        └──────────────┘         └──────────────┘
```

Frontend queries `GET /api/v2/teams/:id/plugins` → receives list of active plugins → shows/hides nav items.

---

## Implementation Checklist

| Component | Priority | Effort | Status |
|---|---|---|---|
| **Artifact Browser + Trust Badges** | P0 | 3-4 days | ❌ |
| Artifact side-peek + trust-aware approval | P0 | 2-3 days | ❌ |
| Trust configuration (team settings) | P1 | 1-2 days | ❌ |
| **L2 CRDT editor fix + presence cursors** | P0 | 2-3 days | ❌ |
| Connection status banner | P0 | 0.5 days | ❌ |
| Document picker sidebar | P1 | 1 day | ❌ |
| **Workspace Viewer (file tree + git)** | P1 | 2-3 days | ❌ |
| File preview + annotations | P1 | 2 days | ❌ |
| **Knowledge Wiki Browser** | P2 | 3-5 days | ❌ |
| Wiki search (⌘K) | P2 | 1 day | ❌ |
| Wiki split-pane editor | P2 | 2 days | ❌ |
| Knowledge promotion queue | P2 | 1-2 days | ❌ |
| Layer-aware navigation | P1 | 1 day | ❌ |

**Total effort:** ~20-25 days frontend work
