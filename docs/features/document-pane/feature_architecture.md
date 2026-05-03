# Document Pane — Feature Architecture

**Date:** May 3, 2026
**Status:** Architecture approved
**Priority:** P1 — Users can't see what agents produce until they dig into CRDT manually
**Depends on:** CRDT-First Architecture (done), BlockNote server-side (done), DocumentRef (done)
**Related:** [plan-session](../plan-session/feature_architecture.md), [crdt-first-architecture](../crdt-first-architecture/feature_architecture.md)

---

## Problem

Agents write rich documents to CRDT (completion reports, research, plans). Users can't see them. The only way to view CRDT content is the dev-only `DevCollabButton`. The `DetailPanel` shows task metadata and discussions but not the documents agents produce.

## What We Want

A **Document Pane** in the frontend that shows CRDT documents in a BlockNote editor. Users can browse, read, and edit documents that agents create — plan documents, task completion reports, research notes, custom docs.

## Current Layout

```
┌──────────┬──────────────────────────┬──────────────────┐
│ Sidebar  │   ChatArea               │  DetailPanel     │
│ (w-auto) │   (flex-1)               │  (w-320, fixed)  │
│          │                          │  Task/Plan/Agent  │
│          │                          │  tabs only        │
└──────────┴──────────────────────────┴──────────────────┘
```

## Proposed Layout

```
┌──────────┬──────────────────────────┬──────────────────┐
│ Sidebar  │   ChatArea               │  DocumentPane    │
│ (w-auto) │   (flex-1)               │  (w-480,         │
│          │                          │   resizable)      │
│          │                          │                   │
│          │                          │  ┌──────────────┐│
│          │                          │  │ Doc List     ││
│          │                          │  │ or           ││
│          │                          │  │ BlockNote    ││
│          │                          │  │ Editor       ││
│          │                          │  └──────────────┘│
└──────────┴──────────────────────────┴──────────────────┘
```

## Architecture

### Option A: Replace DetailPanel (Recommended)

Replace the current `DetailPanel` (320px, fixed) with a wider `DocumentPane` (480px, resizable) that has two views:

1. **File List View** — shows all CRDT docs for the active goal, grouped by type (plan, tasks, custom docs). Each entry shows doc name, type badge, last modified.
2. **Document View** — BlockNote editor connected to Hocuspocus for the selected doc's `Y.XmlFragment("content")`. Read-only for system docs, editable for agent/user docs.

DetailPanel's current functionality (task overview, discussion, activity) moves into the Document Pane as tabs or inline sections within the task document view.

**Pros:** One panel, cleaner layout, reuses existing CollaborativeEditor infrastructure.
**Cons:** Loses the compact task-overview layout. Task metadata needs to be shown within the document view.
**Effort:** Medium — 1 week.

### Option B: Side-by-Side

Keep DetailPanel at 320px AND add DocumentPane at 480px on the far right (4-column layout).

**Pros:** No loss of DetailPanel functionality.
**Cons:** Too wide on most screens. 320 + 480 = 800px consumed by right panels.
**Effort:** Medium.

### Option C: Tabbed Within DetailPanel

Add a "Documents" tab to the existing DetailPanel. Reuse the 320px space.

**Pros:** Minimal layout changes. Familiar tab pattern.
**Cons:** 320px is too narrow for a BlockNote editor. Documents are cramped.
**Effort:** Small — 2-3 days.

## Recommendation: Option A

Replace DetailPanel with DocumentPane. 480px is the minimum for readable BlockNote content. Task metadata can be shown as a header section above the document content.

## Implementation Approach

### Components

```
DocumentPane/
  DocumentPane.tsx        — Main container, routes between list and editor views
  DocumentList.tsx        — File list view (all CRDT docs for active goal)
  DocumentEditor.tsx      — BlockNote editor connected to Hocuspocus
  DocumentHeader.tsx      — Doc metadata bar (type, author, last modified)
```

### Data Flow

```
User clicks "📄 Documents" button
  → uiStore.documentPaneOpen = true
  → DocumentPane renders

DocumentPane mounts
  → reads docNames from goalSessionStore.tasks (task docs) + known system docs (plan, goal)
  → shows DocumentList

User clicks a document
  → uiStore.documentPanePath = "{taskId}/task"
  → DocumentEditor mounts
  → HocuspocusProvider connects to collab service: ws://{COLLAB_URL}/{teamId}/{goalId}/{docName}
  → Y.XmlFragment("content") → BlockNote editor

User can browse back to list, switch between docs
```

### Existing Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| Hocuspocus provider | ✅ Done | `CollaborativeEditor.tsx` connects via `HocuspocusProvider` |
| BlockNote editor | ✅ Done | `@blocknote/react` + `@blocknote/mantine` installed |
| CRDT docs with content | ✅ Done | `CrdtTaskSync.syncStatus` writes completion reports to `Y.XmlFragment("content")` |
| Doc metadata in Y.Map("meta") | ✅ Done | All docs have `type`, `status`, `assignedRole` etc. |
| CRDT doc listing API | ✅ Done | `GET /api/collab/:teamId/docs` returns all doc names for a team |
| `uiStore.viewMode: "collaborate"` | ✅ Exists | In the store, not wired to UI |
| Workspace file listing | ❌ Missing | Need `GET /api/v2/workspaces/:teamId/files` endpoint |
| Workspace file reading | ❌ Missing | Need `GET /api/v2/workspaces/:teamId/files/:path` endpoint |

### Backend: New Workspace Endpoints

```typescript
// GET /api/v2/workspaces/:teamId/goals/:goalId/files
// Lists workspace files for a goal (uses SafeAgentWorkspace.listFiles)
// Response: { files: [{ path, size, type }] }

// GET /api/v2/workspaces/:teamId/goals/:goalId/files/*path
// Read a workspace file (uses SafeAgentWorkspace.readFile)
// Response: { content: string, path: string }
```

### Frontend: Key Patterns From Existing Code

**CollaborativeEditor.tsx** (reuse directly):
```typescript
// Connect to CRDT doc:
const provider = new HocuspocusProvider({
  url: serverUrl,  // VITE_HOCUSPOCUS_URL || ws://localhost:1234
  name: docId,     // "{teamId}/{goalId}/{docName}"
  token,
});
const fragment = provider.document.getXmlFragment("content");
const editor = useCreateBlockNote({ collaboration: { provider, fragment, user } });
```

**useDiscussion hook** (pattern for Y.Map/Y.Array observation):
```typescript
// Subscribe to Y.Map changes:
const map = doc.getMap("meta");
map.observe(() => setData(map.toJSON()));
// Cleanup: map.unobserve(handler); provider.destroy();
```

**Document List data source** (combine 3 sources):
```typescript
// 1. CRDT docs: GET /api/collab/{teamId}/docs → filter by goalId prefix
// 2. Workspace files: GET /api/v2/workspaces/{teamId}/goals/{goalId}/files
// 3. Task metadata: goalSessionStore.tasks → derive expected docs
```

### UI State (uiStore additions)

```typescript
documentPaneOpen: boolean;
documentPanePath: string | null;    // "crdt:{docName}" or "workspace:{filePath}"
documentPaneType: "crdt" | "workspace" | null;
setDocumentPane: (path: string | null, type?: "crdt" | "workspace") => void;
toggleDocumentPane: () => void;
```

### Document View Modes

| URI Scheme | Viewer | Editable? |
|------------|--------|-----------|
| `crdt:plan` | BlockNote (via CollaborativeEditor) | Read-only (system) |
| `crdt:{taskId}/task` | BlockNote (via CollaborativeEditor) | Read-only (system) |
| `crdt:{custom}` | BlockNote (via CollaborativeEditor) | Editable (agent/user) |
| `crdt:{taskId}/discussion` | DiscussionThread (existing component) | Via discuss protocol |
| `workspace:src/api.ts` | CodeViewer (Monaco or plain text) | Read-only |
| `workspace:*.md` | Markdown preview | Read-only |

### Implementation Steps

1. **Backend: Add workspace file endpoints** (`workspaceRoutes.ts`)
   - `GET /api/v2/workspaces/:teamId/goals/:goalId/files` — list files
   - `GET /api/v2/workspaces/:teamId/goals/:goalId/files/*` — read file content

2. **Frontend: AgentServiceV2 methods**
   - `listCrdtDocs(teamId)` — calls `GET /api/collab/{teamId}/docs`
   - `listWorkspaceFiles(teamId, goalId)` — calls new endpoint
   - `readWorkspaceFile(teamId, goalId, path)` — calls new endpoint

3. **Frontend: DocumentPane component**
   - `DocumentPane.tsx` — container, routes between list and viewer
   - `DocumentList.tsx` — shows CRDT docs + workspace files, grouped by type
   - `CrdtDocViewer.tsx` — wraps `CollaborativeEditor` for CRDT docs
   - `WorkspaceFileViewer.tsx` — plain text / code viewer for workspace files

4. **Frontend: Wire into layout**
   - Add `documentPaneOpen` + `documentPanePath` to uiStore
   - Replace `DetailPanel` conditionally when document pane is open
   - Add entry points (task card → "View Document", plan list → "View Plan")

5. **Frontend: Auto-open on events**
   - On `sessionState === "awaiting_approval"` → auto-open plan doc
   - On task completion → show notification with "View Report" link
- This is PR4 from the CRDT-first roadmap
