# Frontend Phase 4: Knowledge & Workspaces — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**UX Research:** [ux-research.md](ux-research.md)  
**Phase:** 4 (Agent Workspace & Persistence)

---

## Branch
- `feature/frontend-phase4-knowledge`

## Scope
Artifact browser with trust model, L2 CRDT editor fix with agent cursors, workspace viewer, knowledge wiki browser.

## Priority Order
1. Artifact Browser + Trust Badges (P0)
2. L2 CRDT Editor Fix + Agent Cursors (P0)
3. Workspace Viewer (P1)
4. Knowledge Wiki Browser (P2)

## Dependencies (install before starting)
```bash
cd packages/frontend
bun add react-arborist react-syntax-highlighter @tanstack/react-query
bun add @uiw/react-md-editor gray-matter react-diff-viewer-continued
# Verify existing: react-markdown, @blocknote/react, @blocknote/mantine, yjs, y-websocket
```

---

## Implementation Steps

### Step 1: Trust Badge System + Artifact Types
**Files to create:**
- `packages/frontend/components/trust/TrustBadge.tsx` — Renders 🏠 Internal (green) / 🔗 Team: {name} (blue) / ⚠ External (orange) based on `ArtifactSource.type`
- `packages/frontend/types/artifacts.ts` — `ArtifactSource`, `TrustLevel`, `ArtifactWithSource` types

**Exit criteria:** TrustBadge renders correctly for all three source types

### Step 2: Artifact Browser (table + filters)
**Files to create:**
- `packages/frontend/components/artifacts/ArtifactBrowser.tsx` — Route: `/teams/:id/artifacts`. Mantine Table with columns: name, type, source/trust (TrustBadge), status (colored badge), creator, date. Sort + filter by status/source/type. Group by goal with progress %.
- `packages/frontend/hooks/useArtifacts.ts` — @tanstack/react-query hook. Fetches `GET /api/v2/teams/:id/artifacts`. Invalidates on `artifact:update` socket event.

**Exit criteria:** Artifact table renders, sortable, filterable, real-time updates via socket

### Step 3: Artifact Side-Peek + Trust-Aware Approval
**Files to create:**
- `packages/frontend/components/artifacts/ArtifactPreview.tsx` — Mantine Drawer (right slide-in). Renders content by type: markdown (react-markdown), code (react-syntax-highlighter), image (`<img>`). Shows TrustBadge + review history timeline.
- `packages/frontend/components/artifacts/ArtifactApproval.tsx` — Trust-aware action buttons:
  - 🏠 Internal → [Approve] [Request Changes] [Reject] (after preview)
  - 🔗 Child team (pre-reviewed) → [Accept] [Re-Review] [Reject]
  - ⚠ External → Must preview → [Approve] [Request Changes] [Reject]

**Exit criteria:** Click artifact row → side-peek opens → approve/reject based on trust tier

### Step 4: Trust Configuration (Team Settings)
**Files to create:**
- `packages/frontend/components/settings/TrustConfig.tsx` — Added to existing team settings. Radio groups for default policies (internal/child-team/external). Agent-specific override table with trust level dropdown.

**Exit criteria:** Configure trust policies, saved to `PATCH /api/v2/teams/:id/settings`

### Step 5: Fix L2 CRDT Editor + Agent Cursors
**Files to modify:**
- Existing collaborative editor component — Fix Hocuspocus WebSocket connection:
  - Auto-reconnect with exponential backoff
  - Connection status indicator (🟢/🟡/🔴)
  - "Reconnecting..." banner (NOT modal)
  - Local changes preserved during disconnection
- Add Yjs Awareness for agent cursors:
  - Each agent sets `awareness.setLocalStateField("user", { name, color })`
  - BlockNote's `collaboration.user` config renders cursors automatically
  - Cursor presence bar at bottom: "🟢 researcher  🟢 developer  🟠 you"

**Exit criteria:** Multiple agents + human see each other's cursors. Disconnect/reconnect works without data loss.

### Step 6: Document Picker Sidebar
**Files to create:**
- `packages/frontend/components/collab/DocumentPicker.tsx` — Left sidebar listing all CRDT docs for current goal. Shows doc name + number of active editors. Click to switch documents.

**Exit criteria:** Browse and switch between CRDT documents

### Step 7: Workspace Viewer
**Files to create:**
- `packages/frontend/components/workspace/WorkspaceViewer.tsx` — Route: `/teams/:id/workspace`. Agent/task dropdown selector at top. react-arborist file tree (read-only) with:
  - Color markers (🟢 new / 🔵 modified / 🔴 deleted)
  - workspace/ vs .scratch/ visual separation
  - Compact git commit history (last 5, expandable)
- `packages/frontend/components/workspace/FilePreview.tsx` — Click file → preview with syntax highlighting. Annotation button (stores in L2 collab, not in git).
- `packages/frontend/hooks/useWorkspace.ts` — Fetches workspace files + git history for selected agent/task. Fresh API call per navigation (no caching).

**Exit criteria:** Browse agent workspace files, see git history, switch agents, annotate files

### Step 8: Knowledge Wiki Browser
**Files to create:**
- `packages/frontend/components/knowledge/KnowledgeWiki.tsx` — Route: `/knowledge`. Hybrid layout: search bar (⌘K via Mantine Spotlight) + react-arborist folder tree (skills/runbooks/projects/decisions/onboarding with color-coded type icons).
- `packages/frontend/components/knowledge/KnowledgeViewer.tsx` — Right panel: react-markdown viewer + metadata footer (type, audience, roles, source provenance).
- `packages/frontend/hooks/useKnowledge.ts` — @tanstack/react-query. Fetches tree + docs from `/api/v2/knowledge`. Invalidates on `knowledge:update` socket event.

**Exit criteria:** Navigate folder tree, search docs, view markdown with metadata

### Step 9: Wiki Editor (Split-Pane)
**Files to create:**
- `packages/frontend/components/knowledge/KnowledgeEditor.tsx` — @uiw/react-md-editor in split-pane mode (source + preview). YAML frontmatter form above editor (type dropdown, audience radio, roles multi-select via gray-matter parsing). Save calls `PUT /api/v2/knowledge/:id`.

**Exit criteria:** Edit docs with live preview, frontmatter form, save to backend

### Step 10: Knowledge Promotion Queue
**Files to create:**
- `packages/frontend/components/knowledge/PromotionQueue.tsx` — Notification badge on Knowledge nav item ("🔔 3"). Click shows list of agent-promoted docs pending human review. Review → approve (adds to wiki) or dismiss.

**Exit criteria:** See pending promotions, review and approve/dismiss

### Step 11: Layer-Aware Navigation
**Files to modify:**
- Sidebar navigation component — Query `GET /api/v2/teams/:id/plugins` on team load. Show/hide nav items:
  - L1 (always): Chat, Workspace, Artifacts, Settings
  - L2 (if CollaborationPlugin): + Collab
  - L3 (if KnowledgePlugin): + Knowledge

**Exit criteria:** Sidebar adapts to team's registered plugins

## Testing Strategy
- Artifact trust badges render correctly for all 3 source types
- Approval flow changes based on trust tier
- CRDT editor: 2 agents + 1 human editing simultaneously, cursors visible
- Disconnect/reconnect: no data loss, banner shows correctly
- Workspace viewer: files match git branch content
- Knowledge search returns relevant results
- Wiki editor: save + reload preserves content + frontmatter
- Layer-aware nav: L2/L3 items hidden when plugins not registered

## Complexity
Medium-High — 20-25 days frontend work. Can be parallelized across developers (L1 artifacts + L2 editor + L3 wiki are independent).
