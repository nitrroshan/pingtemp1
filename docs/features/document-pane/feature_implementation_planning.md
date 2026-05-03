# Document Pane — Implementation Plan

**Branch:** `feature/document-pane`
**Architecture:** [feature_architecture.md](./feature_architecture.md) — Option A (replace DetailPanel)
**Build check:** `cd packages/frontend && npx vite build`

---

## Scope

Display CRDT documents and workspace files in a browsable pane. Users can see what agents produce — completion reports, plan documents, code files — without digging into CRDT manually.

**In scope:** Document list, CRDT doc viewer (BlockNote), workspace file viewer, backend file endpoints, uiStore wiring.
**Out of scope:** Plan approval flow (PR4), document editing by users, discussion thread viewer (already exists in DetailPanel).

---

## Steps

### Step 1: Backend — Workspace File Endpoints (1 day)

**File:** `packages/backend/api/routes/workspaceRoutes.ts`

| Endpoint | Method | Response |
|----------|--------|----------|
| `/api/v2/workspaces/:teamId/goals/:goalId/files` | GET | `{ files: [{ path, size, type }] }` |
| `/api/v2/workspaces/:teamId/goals/:goalId/files/*` | GET | `{ content: string, path: string }` |

Implementation:
- Get `AgentManager` from `agentManagerRegistry.getForTeam(teamId)`
- Get workspace plugin: `registry.getPluginStorage("workspace")`
- Call `workspace.listFiles()` / `workspace.readFile(path)`
- Path traversal protection: reject `..`, absolute paths, symlinks

### Step 2: Frontend — AgentServiceV2 Methods (0.5 day)

**File:** `packages/frontend/services/AgentServiceV2.ts`

```typescript
async listCrdtDocs(teamId: string): Promise<string[]>
// GET /api/collab/{teamId}/docs → returns doc names

async listWorkspaceFiles(teamId: string, goalId: string): Promise<Array<{ path: string; size: number; type: string }>>
// GET /api/v2/workspaces/{teamId}/goals/{goalId}/files

async readWorkspaceFile(teamId: string, goalId: string, path: string): Promise<string>
// GET /api/v2/workspaces/{teamId}/goals/{goalId}/files/{path}
```

### Step 3: Frontend — uiStore State (0.5 day)

**File:** `packages/frontend/stores/uiStore.ts`

Add:
```typescript
documentPaneOpen: boolean;          // default false
documentPanePath: string | null;    // "crdt:{docName}" or "workspace:{filePath}"
setDocumentPane: (path: string | null) => void;
toggleDocumentPane: () => void;
```

When `documentPaneOpen = true`, DetailPanel is replaced by DocumentPane in App.tsx layout.

### Step 4: Frontend — DocumentList Component (1 day)

**New file:** `packages/frontend/components/DocumentPane/DocumentList.tsx`

Shows all available documents grouped by type:

```
📋 Plan
  └── plan — Plan document

📝 Tasks (3)
  ├── task-1/task — Design Database Schema ✅
  ├── task-2/task — Implement Auth ✅
  └── task-3/task — Build CRUD Endpoints ⏳

📁 Workspace Files (5)
  ├── src/schema.ts
  ├── src/auth/login.ts
  └── ... more
```

Data sources:
- CRDT docs: `agentServiceV2.listCrdtDocs(teamId)` → filter by `{goalId}/` prefix, extract doc names
- Workspace files: `agentServiceV2.listWorkspaceFiles(teamId, goalId)`
- Task metadata: `goalSessionStore.tasks` → map task IDs to titles + statuses for display

Click handler: `uiStore.setDocumentPane("crdt:{docName}")` or `uiStore.setDocumentPane("workspace:{path}")`

### Step 5: Frontend — CrdtDocViewer Component (1 day)

**New file:** `packages/frontend/components/DocumentPane/CrdtDocViewer.tsx`

Wraps existing `CollaborativeEditor` with:
- Document metadata header (type badge, author, last modified from Y.Map("meta"))
- Read-only mode for system docs (plan, task, goal)
- Full docId construction: `{teamId}/{goalId}/{docName}`

```typescript
// Props: { docName: string; teamId: string; goalId: string }
// Renders: <DocumentHeader> + <CollaborativeEditor docId={fullDocId} userName={userId} />
```

Also reads Y.Map("meta") via `provider.document.getMap("meta")` for header display.

### Step 6: Frontend — WorkspaceFileViewer Component (1 day)

**New file:** `packages/frontend/components/DocumentPane/WorkspaceFileViewer.tsx`

Simple code/text viewer:
- Fetches content via `agentServiceV2.readWorkspaceFile(teamId, goalId, path)`
- Renders in `<pre>` with syntax highlighting (or basic monospace)
- Shows file path, size in header
- Read-only — no editing

### Step 7: Frontend — DocumentPane Container (0.5 day)

**New file:** `packages/frontend/components/DocumentPane/DocumentPane.tsx`

Routes between views based on `uiStore.documentPanePath`:
- `null` → show `<DocumentList />`
- `"crdt:plan"` → show `<CrdtDocViewer docName="plan" />`
- `"crdt:{taskId}/task"` → show `<CrdtDocViewer docName="{taskId}/task" />`
- `"workspace:src/api.ts"` → show `<WorkspaceFileViewer path="src/api.ts" />`

Header has back button to return to list.

### Step 8: Frontend — Wire Into App Layout (0.5 day)

**File:** `packages/frontend/App.tsx`

Replace the `DetailPanel` conditional render with:
```tsx
{uiStore.documentPaneOpen ? (
  <DocumentPane teamId={teamId} goalId={goalId} />
) : isPanelOpen ? (
  <DetailPanel ... />
) : null}
```

Add "📄 Documents" toggle button to the toolbar/context bar.

### Step 9: Frontend — Entry Points (0.5 day)

**Files:** Various existing components

| Entry Point | Component | Action |
|-------------|-----------|--------|
| Context bar button | `ContextBar.tsx` | `uiStore.toggleDocumentPane()` |
| Task card | `PlanTaskList.tsx` | `uiStore.setDocumentPane("crdt:{taskId}/task")` |
| Plan header | `PlanTaskList.tsx` | `uiStore.setDocumentPane("crdt:plan")` |
| Keyboard | `App.tsx` | `Cmd+D` → `uiStore.toggleDocumentPane()` |

---

## Verification Checklist

| # | Check |
|---|-------|
| 1 | `GET /api/v2/workspaces/:teamId/goals/:goalId/files` returns file list |
| 2 | `GET /api/v2/workspaces/:teamId/goals/:goalId/files/*` returns file content |
| 3 | Path traversal (`../`, absolute paths) rejected with 400 |
| 4 | DocumentList shows CRDT docs grouped by type |
| 5 | DocumentList shows workspace files |
| 6 | Clicking CRDT doc opens BlockNote editor with live content |
| 7 | Clicking workspace file shows code content |
| 8 | Back button returns to document list |
| 9 | `Cmd+D` toggles document pane |
| 10 | Completed task docs show completion report in BlockNote |
| 11 | Plan doc shows plan overview in BlockNote |
| 12 | Frontend builds: `npx vite build` passes |
