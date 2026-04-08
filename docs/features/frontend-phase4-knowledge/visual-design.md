# Phase 4 Visual Design — How It Looks and Feels

**Date:** April 8, 2026  
**Purpose:** Full-page diagrams showing every Phase 4 view, interaction, and state.

---

## Full Application Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  P I N G                                     Team: [Product ▾]    🌙 👤    │
├────────────┬─────────────────────────────────────────────────────────────────┤
│            │                                                                 │
│  SIDEBAR   │                    MAIN CONTENT AREA                           │
│            │                                                                 │
│  ┌────────┐│     (changes based on which nav item is selected)              │
│  │Team:   ││                                                                 │
│  │Product ││     💬 Chat      → streaming chat with agents                  │
│  └────────┘│     📁 Workspace → file tree + file preview                    │
│            │     📦 Artifacts → table + side-peek approval                  │
│  Navigation│     🤝 Collab    → CRDT editor + agent cursors                 │
│  ──────────│     📚 Knowledge → wiki tree + markdown viewer                 │
│  💬 Chat   │     ⚙️ Settings  → team config + trust settings               │
│  📁 Worksp │                                                                 │
│  📦 Artifa │                                                                 │
│  🤝 Collab │                                                                 │
│  📚 Knowle │                                                                 │
│  ⚙️ Settin │                                                                 │
│            │                                                                 │
│  Agents    │                                                                 │
│  ──────────│                                                                 │
│  🟢 planner│                                                                 │
│  🟢 researc│                                                                 │
│  🟡 develo │                                                                 │
│  ⚪ design │                                                                 │
│            │                                                                 │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## 1. Artifact Browser — Full Page View

The user clicks **📦 Artifacts** in the sidebar.

### Default State: Table View

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📦 Artifacts                                                                │
│                                                                              │
│  Goal: [Build Auth System ▾]                    [Filter ▾]  [Status ▾]      │
│  Progress: ████████░░░░░░░░ 40%   (2/5 approved)                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Name                     Source           Status      Creator   When  │  │
│  ├────────────────────────────────────────────────────────────────────────┤  │
│  │ 📄 Auth API Design       🏠 Internal      ✅ Approved  research  2h  │  │
│  │ 📄 Login Endpoint         🏠 Internal      ✅ Approved  develop   1h  │  │
│  │ 📄 Auth Module            🔗 Team: Eng     ⏳ Pending   backend  30m  │  │
│  │   └─ ✓ Reviewed by Team: Engineering                                  │  │
│  │ 📄 Security Audit Report  ⚠ External       ⏳ Pending   claude   15m  │  │
│  │ 🖼️ Auth Flow Diagram     🏠 Internal      ⏳ Pending   design   10m  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  5 artifacts · 2 approved · 3 pending                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Trust Badges — Close-Up

```
  🏠 Internal                        — Green badge, solid
     Your team's own agent produced this. You know the agent.

  🔗 Team: Engineering               — Blue badge, with team name
     Came from a child Ping team via MCP. Black box — you didn't see
     the agents work, but the child team's planner approved it.
     Shows: "✓ Reviewed by Team: Engineering"

  ⚠ External                         — Orange badge, warning style
     Third-party MCP agent (e.g., Claude, Codex). No prior relationship.
     Requires full human review before approval.
```

### Side-Peek Preview — Trusted Child Team Artifact

User clicks "Auth Module" row → drawer slides in from the right:

```
┌─────────────────────────────────┬────────────────────────────────────────────┐
│  Artifact Table (dimmed)        │  📄 Auth Module Implementation             │
│                                 │                                             │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  🔗 Team: Engineering                      │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ✓ Reviewed by child team (30m ago)        │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  backend-dev · T-012 · TypeScript · 8.2KB  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │                                             │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ┌───────────────────────────────────────┐  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │  // auth.module.ts                    │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │  import { Module } from '@nestjs/co  │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │  import { JwtModule } from '@nestjs  │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │                                       │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │  @Module({                            │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │    imports: [JwtModule, UsersModule]  │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │    controllers: [AuthController],    │  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  │    providers: [AuthService],         │  │
│                                 │  │  })                                   │  │
│                                 │  │  export class AuthModule {}           │  │
│                                 │  └───────────────────────────────────────┘  │
│                                 │                                             │
│                                 │  ┌─────────┐ ┌───────────┐ ┌──────────┐   │
│                                 │  │✓ Accept  │ │🔍Re-Review│ │✗ Reject  │   │
│                                 │  └─────────┘ └───────────┘ └──────────┘   │
│                                 │   ↑ green      ↑ blue        ↑ red         │
│                                 │  Quick accept  Open full     Reject with   │
│                                 │  (pre-reviewed) review view  comment        │
│                                 │                                             │
│                                 │  ── Review History ────────────────────    │
│                                 │  · Team: Eng planner approved (30m ago)    │
│                                 │  · Created by backend-dev (45m ago)        │
│                                 │                                             │
│                                 │                               [✕ Close]    │
└─────────────────────────────────┴────────────────────────────────────────────┘
```

### Side-Peek Preview — Untrusted External Artifact

Different buttons — no "Accept" shortcut:

```
│                                 │  ⚠ External Agent: claude-mcp              │
│                                 │  ⚠ No prior review — full review required  │
│                                 │                                             │
│                                 │  (content preview area...)                  │
│                                 │                                             │
│                                 │  ┌──────────┐ ┌─────────────────┐ ┌──────┐│
│                                 │  │✓ Approve  │ │📝Request Changes│ │✗ Reje││
│                                 │  └──────────┘ └─────────────────┘ └──────┘│
│                                 │   ↑ Must scroll through content first      │
│                                 │   Approve disabled until preview scrolled  │
```

---

## 2. Agent Cursors — What You See in the CRDT Editor

The user clicks **🤝 Collab** in the sidebar.

### Multiple Agents Editing Simultaneously

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🤝 Collaborate                                                              │
│  Doc: [requirements.md ▾]              🟢 Connected   👤 3 editing          │
├───────────────┬──────────────────────────────────────────────────────────────┤
│               │                                                              │
│  Documents    │  ╔══════════════════════════════════════════════════════╗    │
│  ───────────  │  ║                                                      ║    │
│  📄 requireme │  ║  # Product Requirements                             ║    │
│    👤 3       │  ║                                                      ║    │
│  📄 design-sp │  ║  ## Authentication                                  ║    │
│    👤 1       │  ║                                                      ║    │
│  📄 api-contr │  ║  Users must be able to sign in wi|th email          ║    │
│    👤 0       │  ║  and password. OAuth 2.0 support f│or Google and    ║    │
│               │  ║  GitHub is required.              │                  ║    │
│               │  ║                            ┌──────┴────────┐        ║    │
│               │  ║                            │ 🔵 researcher │        ║    │
│               │  ║                            └───────────────┘        ║    │
│               │  ║                                                      ║    │
│               │  ║  ## Authorization                                   ║    │
│               │  ║                                                      ║    │
│               │  ║  Role-based access control with three|               ║    │
│               │  ║  tiers: admin, editor, viewer.       │               ║    │
│               │  ║                               ┌──────┴────────┐     ║    │
│               │  ║                               │ 🟢 developer  │     ║    │
│               │  ║                               └───────────────┘     ║    │
│               │  ║                                                      ║    │
│               │  ║  ## API Design                                      ║    │
│               │  ║                                                      ║    │
│               │  ║  RESTful endpoint|s following OpenAPI spec.          ║    │
│               │  ║            ┌──────┴──────┐                           ║    │
│               │  ║            │ 🟠 you      │                           ║    │
│               │  ║            └─────────────┘                           ║    │
│               │  ║                                                      ║    │
│               │  ╚══════════════════════════════════════════════════════╝    │
│               │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│  Presence: 🔵 researcher (line 7)  🟢 developer (line 16)  🟠 you (line 23)│
└──────────────────────────────────────────────────────────────────────────────┘
```

### How Cursors Work

Each cursor is a **colored vertical bar** at the agent's current position, with a **name label** floating above it. As the agent types, the cursor moves and text appears character-by-character. The user sees the agent writing in real-time.

```
  The cursor looks like this in the text:

  "Users must be able to sign in wi|th email"
                                    ▲
                             ┌──────┴────────┐
                             │ 🔵 researcher │  ← colored label
                             └───────────────┘

  When researcher selects text, you see a highlight:

  "Users must be able to ████████████ email"
                         ▲ blue highlight ▲
                    researcher's selection
```

### Connection States

```
  🟢 Connected (normal):
  ┌──────────────────────────────────────┐
  │  🟢 Connected   👤 3 editing        │  ← green dot in header
  └──────────────────────────────────────┘

  🟡 Reconnecting (temporary disconnect):
  ┌──────────────────────────────────────────────────────────────┐
  │  ⚠️ Reconnecting... Local changes will sync automatically.  │  ← yellow banner
  │  Editor still usable — type normally.                        │  below header,
  └──────────────────────────────────────────────────────────────┘  NOT a modal

  🔴 Disconnected (persistent failure):
  ┌──────────────────────────────────────────────────────────────┐
  │  ❌ Connection lost. Changes saved locally.  [Retry]         │  ← red banner
  └──────────────────────────────────────────────────────────────┘  with retry button
```

---

## 3. Workspace Viewer — Full Page View

The user clicks **📁 Workspace** in the sidebar.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🗂️ Workspace                                                               │
│  Agent: [researcher (T-003) ▾]       branch: task/T-003/researcher          │
│                                       status: 🟢 in_progress                │
├──────────────────────┬───────────────────────────────────────────────────────┤
│                      │                                                       │
│  📁 workspace/       │  # Market Research Report                            │
│  ├── 🟢 research-rep │                                                       │
│  ├── 🔵 competitor-m │  ## Executive Summary                                │
│  └── 🔵 scraped-data │                                                       │
│                      │  Based on analysis of 5 competitors in the           │
│  📁 .scratch/        │  authentication space, we recommend...               │
│    (dimmer styling)  │                                                       │
│  ├── draft-v1.md     │  ## Competitor Matrix                                │
│  ├── draft-v2.md     │                                                       │
│  └── test-parser.py  │  | Provider | Price | Features |                     │
│                      │  |----------|-------|----------|                     │
│  ── Git History ──   │  | Auth0    | $$$   | Full     |                     │
│                      │  | Firebase | $$    | Basic    |                     │
│  🔵 abc123           │  | Supabase | $     | Good     |                     │
│  "Complete report"   │                                                       │
│  2h ago · 3 files    │  ──────────────────────────────────                  │
│                      │                                                       │
│  🔵 def456           │  ┌──────────────────────────────────────┐            │
│  "Add pricing data"  │  │ 💬 Add annotation                    │            │
│  2h ago · 1 file     │  │ ┌──────────────────────────────────┐ │            │
│                      │  │ │ This section needs data sources  │ │            │
│  🔵 ghi789           │  │ │ cited. Please add references.    │ │            │
│  "Initial notes"     │  │ └──────────────────────────────────┘ │            │
│  3h ago · 2 files    │  │              [Submit] [Cancel]       │            │
│                      │  └──────────────────────────────────────┘            │
│  [Show all ▾]        │                                                       │
│                      │  [📋 Copy] [💬 Annotate] [📥 Download]               │
│  🟢 new 🔵 mod 🔴 del│                                                       │
└──────────────────────┴───────────────────────────────────────────────────────┘
```

### Agent Dropdown — Switching Workspaces

```
  ┌──────────────────────────────────┐
  │  Agent: [researcher (T-003) ▾]   │
  │  ┌──────────────────────────────┐│
  │  │ 🟢 researcher (T-003)     ✓ ││  ← current
  │  │ 🟢 developer  (T-004)       ││
  │  │ 🟡 designer   (T-005)       ││
  │  │ ⚪ qa-tester  (not started) ││  ← greyed out
  │  └──────────────────────────────┘│
  └──────────────────────────────────┘
```

---

## 4. Knowledge Wiki — Full Page View

The user clicks **📚 Knowledge** in the sidebar.

### Browse Mode (Default)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📚 Knowledge Base               🔍 [Search knowledge... ⌘K]    [+ New]    │
│                                  🔔 3 proposals to review                   │
├──────────────────────┬───────────────────────────────────────────────────────┤
│                      │                                                       │
│  📁 Skills           │  # Production Deployment Procedure                   │
│  ├── 🟣 deploy-prod  │                                                       │
│  ├── 🟣 api-design   │  ## Steps                                            │
│  └── 🟣 auth-pattern │                                                       │
│  📁 Runbooks         │  1. Verify all tests pass in CI                      │
│  ├── 🟠 incident-res │  2. Check staging health dashboard                   │
│  └── 🟠 campaign-lau │  3. Run: `npm run deploy:prod`                       │
│  📁 Projects         │  4. Monitor error rates for 15 minutes               │
│  ├── 🔵 auth-service │  5. If error rate > 1%, trigger rollback             │
│  └── 🔵 marketing-ca │                                                       │
│  📁 Decisions        │  ## Rollback                                          │
│  ├── 🟤 why-postgres │  ```bash                                             │
│  📁 Onboarding       │  npm run rollback:prod -- --commit=<sha>             │
│  └── 🟤 eng-setup    │  ```                                                 │
│                      │                                                       │
│  Type colors:        │  ────────────────────────────────────────            │
│  🟣 skill            │  Type: 🟣 Skill · Audience: 🤖 Agent                │
│  🟠 runbook          │  Roles: devops, backend                               │
│  🔵 project          │  Source: 🤖 Promoted from goal-001/T-003            │
│  🟤 decision/onboard │  Last updated: March 30, 2026                        │
│                      │                                                       │
│                      │  [✏️ Edit] [📋 Copy Link] [🔗 Backlinks (3)]         │
└──────────────────────┴───────────────────────────────────────────────────────┘
```

### Edit Mode (Split-Pane)

User clicks "✏️ Edit" → view transforms to split-pane:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📚 Knowledge Base  ✏️ Editing: deploy-prod          [💾 Save] [✕ Cancel]   │
├─────────────────────────────────┬────────────────────────────────────────────┤
│  SOURCE (markdown)              │  PREVIEW (rendered)                        │
│                                 │                                             │
│  ┌─ Frontmatter ─────────────┐ │                                             │
│  │ Type: [Skill ▾]           │ │  # Production Deployment Procedure         │
│  │ Audience: ○Human ●Agent   │ │                                             │
│  │ Roles: [devops] [backend] │ │  ## Steps                                  │
│  └───────────────────────────┘ │                                             │
│                                 │  1. Verify all tests pass in CI            │
│  # Production Deployment       │  2. Check staging health dashboard         │
│  Procedure                     │  3. Run: npm run deploy:prod               │
│                                 │  4. Monitor error rates for 15 minutes     │
│  ## Steps                      │  5. If error rate > 1%, trigger rollback   │
│                                 │                                             │
│  1. Verify all tests pass in   │  ## Rollback                                │
│  CI                            │                                             │
│  2. Check staging health       │  npm run rollback:prod -- --commit=<sha>   │
│  dashboard                     │                                             │
│  3. Run: `npm run deploy:prod` │                                             │
│  4. Monitor error rates for    │                                             │
│  15 minutes                    │                                             │
│  5. If error rate > 1%,        │                                             │
│  trigger rollback              │                                             │
└─────────────────────────────────┴────────────────────────────────────────────┘
```

### Search (⌘K Spotlight)

```
  ┌──────────────────────────────────────────────────┐
  │  🔍 Search knowledge...                          │
  │  ┌──────────────────────────────────────────────┐│
  │  │                                              ││
  │  │  "deploy"                                    ││
  │  │                                              ││
  │  │  Results:                                    ││
  │  │  🟣 deploy-prod — Production Deployment      ││
  │  │     "...Run: npm run deploy:prod..."         ││
  │  │                                              ││
  │  │  🟠 campaign-launch — Campaign Deployment    ││
  │  │     "...deploy marketing assets to CDN..."   ││
  │  │                                              ││
  │  │  🟤 eng-setup — Engineering Onboarding       ││
  │  │     "...deploy your local environment..."    ││
  │  │                                              ││
  │  └──────────────────────────────────────────────┘│
  └──────────────────────────────────────────────────┘
```

### Promotion Queue (🔔 Badge)

User clicks the 🔔 badge → overlay shows:

```
  ┌──────────────────────────────────────────────────────────┐
  │  🔔 Knowledge Proposals — 3 pending review               │
  │                                                           │
  │  ┌─────────────────────────────────────────────────────┐ │
  │  │  📄 API Rate Limiting Pattern                        │ │
  │  │  🤖 Promoted by researcher from goal-005/T-002      │ │
  │  │  Proposed type: 🟣 skill                            │ │
  │  │  [👁️ Review] [✓ Approve to Wiki] [✕ Dismiss]       │ │
  │  ├─────────────────────────────────────────────────────┤ │
  │  │  📄 Incident Response Checklist v2                   │ │
  │  │  🤖 Promoted by devops from goal-008/T-001          │ │
  │  │  Proposed type: 🟠 runbook                          │ │
  │  │  [👁️ Review] [✓ Approve to Wiki] [✕ Dismiss]       │ │
  │  ├─────────────────────────────────────────────────────┤ │
  │  │  📄 Why We Chose Postgres over Mongo                 │ │
  │  │  🤖 Promoted by architect from goal-003/T-004       │ │
  │  │  Proposed type: 🟤 decision                         │ │
  │  │  [👁️ Review] [✓ Approve to Wiki] [✕ Dismiss]       │ │
  │  └─────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────┘
```

---

## 5. Trust Configuration — Team Settings

User clicks **⚙️ Settings** → "Trust & Review" tab.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ⚙️ Team Settings — Product Team                                            │
│                                                                              │
│  [General] [Members] [Trust & Review] [Plugins]                             │
│  ──────────────────────────────────────────                                  │
│                                                                              │
│  Trust & Review Policies                                                    │
│  ─────────────────────                                                      │
│                                                                              │
│  Internal agents (your team's workers):                                     │
│    ○ Auto-approve all artifacts                                             │
│    ● Require review before approval                                         │
│                                                                              │
│  Child teams (teams delegated via team stacking):                           │
│    ○ Auto-accept (skip review entirely)                                     │
│    ● Accept with badge (show "reviewed by child team", one-click accept)    │
│    ○ Require full re-review                                                 │
│                                                                              │
│  External agents (third-party MCP agents):                                  │
│    ● Always require full review                                             │
│    ○ Per-agent trust settings                                               │
│                                                                              │
│  ── Agent-Specific Overrides ──────────────────────────────────             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────┐              │
│  │ Agent/Team              Type        Trust Level            │              │
│  ├────────────────────────────────────────────────────────────┤              │
│  │ researcher              🏠 Internal  [Trusted     ▾]      │              │
│  │ developer               🏠 Internal  [Trusted     ▾]      │              │
│  │ Team: Engineering       🔗 Child      [Trusted     ▾]      │              │
│  │ claude-mcp              ⚠ External   [Untrusted   ▾]      │              │
│  │ codex-agent             ⚠ External   [Approved    ▾]      │              │
│  └────────────────────────────────────────────────────────────┘              │
│                                                                              │
│  Trust Level Options:                                                       │
│    Approved  = can be auto-approved or light review                         │
│    Trusted   = standard review with pre-reviewed badge                      │
│    Untrusted = always full review, no shortcuts                             │
│                                                                              │
│                                              [Save Changes]                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Layer-Aware Navigation — How It Adapts

### Team with Only L1 (WorkspacePlugin)

```
│  Navigation   │
│  ───────────  │
│  💬 Chat      │  ← always
│  📁 Workspace │  ← always (L1)
│  📦 Artifacts │  ← always (L1)
│  ⚙️ Settings  │  ← always
```

### Team with L1 + L2 (+ CollaborationPlugin)

```
│  Navigation   │
│  ───────────  │
│  💬 Chat      │
│  📁 Workspace │
│  📦 Artifacts │
│  🤝 Collab    │  ← appears when CollaborationPlugin registered
│  ⚙️ Settings  │
```

### Team with L1 + L2 + L3 (+ KnowledgePlugin)

```
│  Navigation   │
│  ───────────  │
│  💬 Chat      │
│  📁 Workspace │
│  📦 Artifacts │
│  🤝 Collab    │
│  📚 Knowledge │  ← appears when KnowledgePlugin registered
│  ⚙️ Settings  │
```

---

## Interaction Summary

| User Action | What Happens |
|-------------|-------------|
| Click artifact row | Side-peek drawer opens from right with preview + trust-aware buttons |
| Click "Accept" on child team artifact | Artifact marked accepted, badge stays "🔗 Team: X ✓" |
| Click "Re-Review" | Side-peek expands to full preview, standard approve/reject flow |
| Click "Approve" on external artifact | Must scroll through preview first, then button enables |
| Open CRDT editor | BlockNote loads, connects to Hocuspocus, agent cursors appear |
| Agent types in CRDT doc | Text appears character-by-character at their colored cursor |
| Connection drops | Yellow banner: "Reconnecting..." — editor stays usable |
| Click file in workspace | Preview panel shows content (markdown rendered, code highlighted) |
| Click "Annotate" on file | Text input opens — annotation saved to L2, agent reads via collab tool |
| Press ⌘K in Knowledge | Spotlight search opens, results highlight matching text |
| Click "Edit" in Knowledge | View transforms to split-pane: source left, preview right |
| 🔔 badge appears | Agent promoted doc to wiki — click to review/approve/dismiss |
