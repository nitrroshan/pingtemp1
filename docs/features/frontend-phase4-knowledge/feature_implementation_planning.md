# Frontend Phase 4: Knowledge & Workspaces — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 4 (Agent Workspace & Persistence)

---

## Branch
- `feature/frontend-phase4-knowledge`

## Scope
Knowledge wiki browser, artifact browser, workspace viewer, fix collaborative editor.

## Implementation Steps

### Step 1: Knowledge Wiki Browser
**Files to create:**
- `packages/frontend/components/KnowledgeWiki.tsx` — Route: `/knowledge`. Left panel: folder tree (skills/runbooks/projects/decisions/onboarding). Right panel: markdown viewer. Top: search bar + "New" button.
- `packages/frontend/components/KnowledgeTree.tsx` — Recursive folder tree component
- `packages/frontend/components/KnowledgeViewer.tsx` — Markdown viewer with syntax highlighting (react-markdown + rehype-highlight)

**Exit criteria:** Navigate folder tree, view markdown documents, metadata footer

### Step 2: Wiki Search
**Files to create:**
- `packages/frontend/components/KnowledgeSearch.tsx` — Search bar with results dropdown. Calls `/api/v2/knowledge/search`. Highlights matching terms.

**Exit criteria:** Full-text search across knowledge docs with results

### Step 3: Wiki Create/Edit
**Files to create:**
- `packages/frontend/components/KnowledgeEditor.tsx` — Markdown editor for creating/editing wiki pages. YAML frontmatter form (type, audience, roles). Save button calls API.

**Exit criteria:** Create new docs, edit existing docs, save to backend

### Step 4: Artifact Browser
**Files to create:**
- `packages/frontend/components/ArtifactBrowser.tsx` — Route: `/teams/:id/artifacts`. List all artifacts per goal with status badges (approved/pending/rejected). Filter by status, role, type.
- `packages/frontend/components/ArtifactPreviewModal.tsx` — Click artifact → modal with rendered content (markdown/code/image by media type). Approval action buttons for pending items.

**Exit criteria:** Browse artifacts, preview by type, approve/reject pending

### Step 5: Workspace Viewer
**Files to create:**
- `packages/frontend/components/WorkspaceViewer.tsx` — Route: `/teams/:id/workspace`. File tree (read-only) from git branch. Separate sections for workspace files vs .scratch. Git commit history with messages and timestamps. Agent/task selector dropdown.
- `packages/frontend/components/FilePreviewModal.tsx` — Click file → preview modal with syntax highlighting

**Exit criteria:** Browse workspace files, view git history, switch between agents/tasks

### Step 6: Fix Collaborative Editor
**Files to modify:**
- Existing collaborative editor component — Ensure Hocuspocus connection stable. Add reconnect-on-disconnect with "reconnecting..." banner. Show presence indicators (colored cursors per agent/user).

**Exit criteria:** CRDT editor syncs reliably, shows who's editing

### Step 7: Document Picker
**Files to create:**
- `packages/frontend/components/DocumentPicker.tsx` — Sidebar list of all CRDT docs for current goal. Click to open in editor.

**Exit criteria:** Users can browse and open shared CRDT documents

## Testing Strategy
- Visual testing for all views
- Knowledge search returns relevant results
- Artifact approval flow works end-to-end
- Workspace viewer shows correct files per branch

## Complexity
Medium — 15-20 days frontend work.
