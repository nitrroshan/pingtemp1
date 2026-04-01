# L3 Knowledge Base — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 4 (Agent Workspace & Persistence)  
**ID:** D1

---

## Branch
- `feature/knowledge-base`

## Scope (v1)
Document types with audience, git-backed markdown storage, worker integration (auto-inject at task start), ingestion pipeline, full-text search, MCP server.

## Implementation Steps

### Step 1: Extend Knowledge Types
**Files to modify:**
- `packages/backend/memory/L3/knowledge/types/` — Add `KnowledgeType` enum (`skill` | `runbook` | `project` | `decision` | `onboarding`), `audience` field (`agent` | `human` | `both`), `roles` array, `usefulWhen` tags, `lastValidated` date

**Exit criteria:** Type system supports all document types from architecture

### Step 2: Implement Git-Backed Storage
**Files to create:**
- `packages/backend/memory/L3/knowledge/GitSync.ts` — Sync markdown files from git repo to MongoDB index. Watch for git commits → re-index changed files. Parse YAML frontmatter for metadata.

**Git structure:**
```
knowledge/
├── skills/        (agent-facing skills)
├── runbooks/      (procedures)
├── projects/      (project docs)
├── decisions/     (why we chose X)
└── onboarding/    (getting started)
```

**Exit criteria:** Git commits trigger MongoDB re-indexing, YAML frontmatter parsed

### Step 3: Enhance KnowledgeRetrieval with Role-Based Filtering
**Files to modify:**
- `packages/backend/memory/L3/knowledge/KnowledgeRetrieval.ts` — Add role-based filtering (match `roles` field), full-text search via MiniSearch or MongoDB text index, `getForTask()` method

**Exit criteria:** Search returns only role-appropriate docs, full-text search works

### Step 4: Implement Worker Integration (Auto-Inject)
**Files to modify:**
- `packages/backend/services/WorkerPool.ts` — Before dispatching task, call `KnowledgeBase.getForTask({ description, role, projectId })`. Inject returned docs into agent system prompt section.

**Injection format:** Section header + doc title + content snippet (max 500 tokens per doc, max 3 docs)  
**Exit criteria:** Workers automatically receive relevant knowledge at task start

### Step 5: Implement Ingestion Pipeline
**Files to create:**
- `packages/backend/memory/L3/knowledge/Ingestion.ts` — Two ingestion sources:
  1. Goal completion → approved artifacts → `KnowledgePromotion.proposeNew()`
  2. Planner decisions → propose decision doc

**Files to modify:**
- `packages/backend/orchestrator/OrchestratorService.ts` — On goal completion, trigger artifact promotion check

**Exit criteria:** Completed goals propose relevant outputs as knowledge documents

### Step 6: Enhance KnowledgeStore CRUD
**Files to modify:**
- `packages/backend/memory/L3/knowledge/KnowledgeBase.ts` — Full implementation: `search()`, `getForTask()`, `create()`, `update()`, `propose()`, `approve()`, `getProjectDocs()`

**Exit criteria:** Full CRUD + search + approval workflow operational

### Step 7: Create MCP Server
**Files to create:**
- `packages/backend/memory/L3/mcp/server.ts` — FastMCP server exposing: `search_knowledge`, `read_doc`, `create_doc`, `list_docs`, `get_project`

**Exit criteria:** CLI and external agents can access knowledge base via MCP

### Step 8: Add API Endpoints
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add `/api/v2/knowledge/search`, `/api/v2/knowledge/:id`, `/api/v2/knowledge` (create), `/api/v2/knowledge/proposals` (list/approve)

**Exit criteria:** Frontend can browse, search, create, approve knowledge docs

## Testing Strategy
- Unit test: GitSync parses YAML frontmatter correctly
- Integration test: create doc in git → auto-indexed in MongoDB → searchable
- Test: worker auto-inject provides relevant docs
- Test: goal completion proposes artifacts as knowledge

## Complexity
Medium — 2-3 weeks for v1.
