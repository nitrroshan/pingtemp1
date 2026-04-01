# Frontend Phase 4: Knowledge & Workspaces — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**Phase:** 4  
**Depends on:** Phase 3 (teams UI), Knowledge Base (D1), Git Task Context (A8)

---

## Overview

Add the knowledge wiki browser, artifact/workspace viewers, and fix the collaborative editor. After this phase, users can browse organizational knowledge, see what agents produced, inspect workspace files, and co-edit documents with agents.

### Target State
- `/knowledge` — browse, search, edit org knowledge wiki
- `/teams/:id/artifacts` — browse all artifacts per goal with approval status
- `/teams/:id/workspace` — view agent workspace files and git history
- `/teams/:id/collaborate` — reliable CRDT editor with presence indicators

---

## Components

### Knowledge Wiki Browser (`/knowledge`)

```
┌─────────────────────────────────────────────────────────────┐
│  📚 Knowledge Base                    🔍 [Search...] [+ New]│
├──────────────────┬──────────────────────────────────────────┤
│                  │                                           │
│  📁 Skills       │  # Production Deployment                 │
│  ├── deploy-prod │                                           │
│  ├── api-design  │  ## Procedure                            │
│  └── auth-patter │  1. Verify all tests pass in CI          │
│  📁 Runbooks     │  2. Check staging health                 │
│  ├── incident-re │  3. Run deployment: npm run deploy:prod  │
│  └── campaign-la │  4. Monitor error rates for 15 minutes   │
│  📁 Projects     │  5. If error rate > 1%, trigger rollback │
│  ├── auth-servic │                                           │
│  └── marketing-c │  ## Rollback                              │
│  📁 Decisions    │  See: rollback-procedure                  │
│  └── why-postgre │                                           │
│  📁 Onboarding   │  ---                                     │
│  └── eng-setup   │  Type: skill · Audience: 🤖 agent        │
│                  │  Roles: devops, backend                   │
│                  │  Source: goal-001 / T-003                 │
│                  │  Last updated: March 30, 2026             │
└──────────────────┴──────────────────────────────────────────┘
```

- Folder tree navigation (skills/runbooks/projects/decisions/onboarding)
- Markdown viewer with syntax highlighting for code blocks
- Search bar — full-text search across all docs
- Create/Edit buttons — markdown editor for wiki pages
- Metadata footer — type, audience, roles, source provenance
- Promotion notifications — "New proposal from goal-005: approve?"

### Artifact Browser (`/teams/:id/artifacts`)

```
┌─────────────────────────────────────────────────────────────┐
│  📦 Artifacts — Marketing Campaign                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 📄 Market Research Report     ✅ Approved             │    │
│  │    researcher · T-001 · text/markdown · 4.2 KB      │    │
│  │    [Preview]  [Download]                              │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ 📄 Competitive Analysis       ✅ Approved             │    │
│  │    researcher · T-002 · text/markdown · 3.1 KB      │    │
│  │    [Preview]  [Download]                              │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ 📄 Marketing Copy             ⏳ Pending Review       │    │
│  │    writer · T-004 · text/markdown · 2.8 KB          │    │
│  │    [Preview]  [Approve]  [Request Changes]  [Reject]│    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ 🖼️ Hero Banner                ⏳ Pending Review       │    │
│  │    designer · T-005 · image/png · 245 KB            │    │
│  │    [Preview]  [Approve]  [Request Changes]  [Reject]│    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  4 artifacts · 2 approved · 2 pending                        │
└─────────────────────────────────────────────────────────────┘
```

- List all artifacts per goal with status badges
- Click Preview → modal with rendered content (markdown/code/image)
- Approval actions for pending artifacts
- Filter by status, role, type

### Workspace Viewer (`/teams/:id/workspace`)

```
┌─────────────────────────────────────────────────────────────┐
│  🗂️ Workspace — researcher (T-001)        branch: task/T-001│
│                                                              │
│  📁 workspace/                                               │
│  ├── research-report.md            4.2 KB  · 2h ago         │
│  ├── competitor-matrix.csv         1.1 KB  · 2h ago         │
│  └── scraped-data.json             12 KB   · 3h ago         │
│                                                              │
│  📁 .scratch/ (play area)                                    │
│  ├── draft-v1.md                   2.1 KB  · 3h ago         │
│  ├── draft-v2.md                   3.4 KB  · 2h ago         │
│  └── test-parser.py                0.5 KB  · 3h ago         │
│                                                              │
│  ── Git History ──────────────────────────────────────       │
│  abc123  "Complete market research report"  2h ago          │
│  def456  "Add competitor pricing data"      2h ago          │
│  ghi789  "Initial research notes"           3h ago          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

- File tree (read-only) from git branch
- Separate sections for workspace files vs .scratch (play area)
- Click file → preview in modal
- Git commit history with messages and timestamps
- Switch between agents/tasks via dropdown

### Collaborative Editor (Fix)

Current `CollaborativeEditor.tsx` uses BlockNote + Hocuspocus but reliability is unclear. Phase 4 work:

- Ensure connection to Hocuspocus server is stable
- Show presence indicators (colored cursors for each agent/user)
- Error recovery — reconnect on disconnect, show "reconnecting..." banner
- Document picker in sidebar — list all CRDT docs for the goal

---

## Implementation Checklist

| Component | Status | Effort |
|---|---|---|
| Knowledge Wiki Browser | ❌ | 3-5 days |
| Wiki markdown viewer | ❌ | 1-2 days |
| Wiki search | ❌ | 1 day |
| Wiki create/edit | ❌ | 2 days |
| Artifact Browser | ❌ | 2-3 days |
| Artifact Preview modal (by type) | ❌ | 2 days |
| Workspace Viewer (file tree + git) | ❌ | 2-3 days |
| Fix CRDT editor connectivity | ❌ | 1-2 days |
| Presence indicators | ❌ | 1 day |
| Document picker for editor | ❌ | 1 day |

**Total effort:** ~15-20 days frontend work
