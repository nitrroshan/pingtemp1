# Documentation Refactoring Execution Plan
**Aligned with Current Ping Vision (ONE Product with Design + Execution Modes)**

> **Reference**: This plan aligns with the Ping vision in `docs/ping/` which establishes Ping as a single product with:
> - **Design Mode** (Team Builder) - Role Manager meta-agent for agent synthesis
> - **Execution Mode** (Runtime) - Teams + Orchestration + Agent Supervision

---

## Current State

### ✅ Already Created (Foundational Ping Docs)
- `docs/ping/vision.md` - Complete Ping vision (9 modules, 4 phases)
- `docs/ping/architecture.md` - Technical architecture (design + execution modes)
- `docs/ping/team-builder.md` - Role Manager meta-agent (Think/Plan/Suggest/Build)
- `docs/ping/artifact-output-strategy.md` - Hybrid Git + Object Storage
- `docs/ping/realtime-collaboration.md` - OT/CRDT multi-agent editing
- `docs/ping/structured-document-model.md` - North star for rich documents
- `docs/developer-guide/monorepo-architecture.md` - pnpm workspace structure
- `docs/developer-guide/current-state-to-ping.md` - Migration guide

### 📂 Folder Structure Created
```
docs/
├── ping/ (Ping vision docs - DONE ✅)
├── developer-guide/ (Implementation guides - PARTIAL ✅)
├── product/ (NEW - for user-facing product docs)
│   └── ping/ (NEW - created)
├── features/ (NEW - for feature development tracking)
├── archive/ (NEW - for obsolete docs)
├── backend/ (TO MOVE)
├── frontend/ (TO MOVE)
└── services/ (TO MOVE)
```

### 📋 Existing Docs to Refactor
**Backend guides** (`backend/`):
- `agentManager.md` → Move to `developer-guide/modules/orchestrator.md`
- `roleManager.md` → Move to `developer-guide/modules/role-manager.md`
- `memoryManager.md` → Move to `developer-guide/modules/memory-manager.md`
- `agentWorker.md` → Move to `developer-guide/modules/agent-worker.md`
- `AgentWorker/` → Merge into agent-worker.md

**Frontend guides** (`frontend/`):
- `components.md` → Move to `developer-guide/frontend/components.md`
- `README.md` → Move to `developer-guide/frontend/overview.md`

**Services** (`services/`):
- `agentRegistry.md` → Consolidate into role-manager.md

**Feature planning docs** (root):
- `REHYDRATION_STRATEGY.md` → Transform to `features/database-persistence/`
- `ROLE_DISCOVERY_ENHANCEMENT.md` → Transform to `features/role-discovery/`
- `AGENTMANAGERSERVICE_INTEGRATION.md` → Transform to `features/agent-manager-service/`
- `API_SPLIT.md` → Consolidate into architecture
- `BACKEND_FRONTEND_INTEGRATION.md` → Transform to `features/ping-ui-integration/`

**Root docs** (to update/archive):
- `README.md` → Update with new structure
- `INDEX.md` → Update navigation
- `project.md` → Archive (replaced by ping/vision.md)
- `todo.md` → Archive (replaced by features/*/tasks/)
- `taskManager_roleManager.md` → Archive (consolidated)
- `DOCUMENTATION_REVIEW_CHECKLIST.md` → Archive (one-time use)

---

## Refactoring Phases

### Phase 1: Create Folder Structure ✅ IN PROGRESS
**Status**: Partially complete

**Completed**:
- ✅ Created `docs/product/`
- ✅ Created `docs/product/ping/`
- ✅ Created `docs/features/`
- ✅ Created `docs/archive/`
- ✅ `docs/ping/` exists (foundational docs)
- ✅ `docs/developer-guide/` exists (partial)

**Remaining**:
```powershell
# Create missing subfolders
cd docs/developer-guide
mkdir modules, frontend, patterns, setup

cd docs/product/ping
mkdir guides, api
```

---

### Phase 2: Move & Refactor Backend/Frontend Docs
**Goal**: Reorganize implementation guides under `developer-guide/`

#### 2.1 Backend Modules → `developer-guide/modules/`
```powershell
# Move and update backend docs
Move-Item docs/backend/agentManager.md docs/developer-guide/modules/orchestrator.md
Move-Item docs/backend/roleManager.md docs/developer-guide/modules/role-manager.md
Move-Item docs/backend/memoryManager.md docs/developer-guide/modules/memory-manager.md
Move-Item docs/backend/agentWorker.md docs/developer-guide/modules/agent-worker.md
```

**Content updates needed**:
- Add context: "This module is part of Ping's Execution Mode"
- Link to `docs/ping/architecture.md` for high-level design
- Update terminology to match Ping vision (teams, artifacts, approval)

#### 2.2 Frontend → `developer-guide/frontend/`
```powershell
# Move frontend docs
Move-Item docs/frontend/components.md docs/developer-guide/frontend/components.md
Move-Item docs/frontend/README.md docs/developer-guide/frontend/overview.md
```

**Content updates needed**:
- Position as "Ping UI" (not just "frontend")
- Reference Ping's team workspace concept
- Link to product docs for user-facing features

#### 2.3 Services → Consolidate
```powershell
# Merge into role-manager.md
# Content from services/agentRegistry.md → developer-guide/modules/role-manager.md
```

---

### Phase 3: Transform Feature Planning Docs to Feature Folders
**Goal**: Convert planning docs to proper feature development structure

#### 3.1 Database Persistence
```
features/database-persistence/
├── feature_architecture.md (from REHYDRATION_STRATEGY.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
│       ├── task-001-memory-manager-persistence.md
│       ├── task-002-role-manager-factories.md
│       └── task-003-agent-manager-rehydrate.md
└── bugs/
```

**Action**: Extract architecture from REHYDRATION_STRATEGY.md, create task files

#### 3.2 Role Discovery
```
features/role-discovery/
├── feature_architecture.md (from ROLE_DISCOVERY_ENHANCEMENT.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
└── bugs/
```

#### 3.3 AgentManager Service Integration
```
features/agent-manager-service/
├── feature_architecture.md (from AGENTMANAGERSERVICE_INTEGRATION.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
└── bugs/
```

#### 3.4 Ping UI Integration
```
features/ping-ui-integration/
├── feature_architecture.md (from BACKEND_FRONTEND_INTEGRATION.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
└── bugs/
```

---

### Phase 4: Create Missing MVP Feature Folders
**Goal**: Set up feature development tracking for new Ping modules

#### 4.1 Team Service (NEW - Foundational)
```
features/team-service/
├── feature_architecture.md (NEW - Teams as execution boundaries)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
│       ├── task-001-team-model.md
│       ├── task-002-team-membership.md
│       └── task-003-team-scoping.md
└── bugs/
```

#### 4.2 Artifact Store (NEW - MVP)
```
features/artifact-store/
├── feature_architecture.md (NEW - from artifact-output-strategy.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
│       ├── task-001-git-storage-backend.md
│       ├── task-002-object-storage-backend.md
│       ├── task-003-branch-manager.md
│       └── task-004-metadata-store.md
└── bugs/
```

#### 4.3 Real-Time Collaboration (NEW - MVP)
```
features/realtime-collaboration/
├── feature_architecture.md (NEW - from realtime-collaboration.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
│       ├── task-001-sharedb-setup.md
│       ├── task-002-websocket-connections.md
│       ├── task-003-presence-awareness.md
│       └── task-004-git-snapshots.md
└── bugs/
```

#### 4.4 Approval System (NEW - MVP)
```
features/approval-governance/
├── feature_architecture.md (NEW - Human control layer)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
│       ├── task-001-pr-workflow.md
│       ├── task-002-snapshot-approval.md
│       └── task-003-audit-trail.md
└── bugs/
```

#### 4.5 Role Manager Meta-Agent (NEW - Team Builder)
```
features/role-manager-meta-agent/
├── feature_architecture.md (NEW - from team-builder.md)
├── v1.0/
│   ├── feature_implementation_planning.md
│   ├── feature_implementation.md
│   └── tasks/
│       ├── task-001-think-phase.md (Analyze intent)
│       ├── task-002-plan-phase.md (Design roles)
│       ├── task-003-suggest-phase.md (Approval layer)
│       └── task-004-build-phase.md (Instantiate agents)
└── bugs/
```

---

### Phase 5: Create Product Documentation
**Goal**: User-facing guides for Ping platform

#### 5.1 Product Guides (`product/ping/guides/`)
**Create**:
- `getting-started.md` (from `setup.md` + Ping context)
- `creating-teams.md` (NEW - Team creation workflow)
- `designing-agents.md` (NEW - Using Team Builder)
- `managing-workflows.md` (NEW - Orchestration guide)
- `reviewing-artifacts.md` (NEW - Approval workflow)

#### 5.2 API Documentation (`product/ping/api/`)
**Create**:
- `team-api.md` (NEW - Team CRUD operations)
- `orchestrator-api.md` (NEW - Goal/task endpoints)
- `websocket-events.md` (NEW - Real-time events)
- `artifact-api.md` (NEW - Artifact operations)

---

### Phase 6: Update Navigation & Root Docs

#### 6.1 Update INDEX.md
```markdown
# Ping Documentation Index

## Product Documentation
- [Ping Vision](./ping/vision.md) - Complete platform vision
- [Architecture](./ping/architecture.md) - Technical architecture
- [Team Builder](./ping/team-builder.md) - Design Mode (Role Manager)
- [Getting Started](./product/ping/guides/getting-started.md)

## Developer Guide
- [Monorepo Architecture](./developer-guide/monorepo-architecture.md)
- [Current State to Ping](./developer-guide/current-state-to-ping.md)
- [Modules](./developer-guide/modules/)
- [Frontend](./developer-guide/frontend/)
- [Patterns](./developer-guide/patterns/)

## Features
- [Team Service](./features/team-service/)
- [Artifact Store](./features/artifact-store/)
- [Real-Time Collaboration](./features/realtime-collaboration/)
- [Approval & Governance](./features/approval-governance/)
- [Role Manager Meta-Agent](./features/role-manager-meta-agent/)

## Archive
- [Obsolete Documentation](./archive/)
```

#### 6.2 Update README.md
- Position as Ping platform overview
- Link to new structure
- Quick start guide
- Reference developer-guide for implementation

---

### Phase 7: Archive Obsolete Documentation

**Move to `archive/`**:
- `project.md` (replaced by ping/vision.md)
- `todo.md` (replaced by features/*/tasks/)
- `taskManager_roleManager.md` (consolidated into modules)
- `DOCUMENTATION_REVIEW_CHECKLIST.md` (one-time use)
- Old planning docs (after transforming to features/)

**After transformation, move**:
- `REHYDRATION_STRATEGY.md` → `archive/REHYDRATION_STRATEGY.md`
- `ROLE_DISCOVERY_ENHANCEMENT.md` → `archive/ROLE_DISCOVERY_ENHANCEMENT.md`
- `AGENTMANAGERSERVICE_INTEGRATION.md` → `archive/AGENTMANAGERSERVICE_INTEGRATION.md`
- `API_SPLIT.md` → `archive/API_SPLIT.md`
- `BACKEND_FRONTEND_INTEGRATION.md` → `archive/BACKEND_FRONTEND_INTEGRATION.md`

**Delete empty folders**:
- `docs/backend/` (after moving all content)
- `docs/frontend/` (after moving all content)
- `docs/services/` (after consolidating)

---

## Execution Order (Recommended)

### Batch 1: Structure ✅ (In Progress)
- [x] Create main folders (product, features, archive)
- [ ] Create subfolders (modules, frontend, patterns, setup, guides, api)

### Batch 2: Move Implementation Guides
- [ ] Move backend docs → developer-guide/modules/
- [ ] Move frontend docs → developer-guide/frontend/
- [ ] Update cross-references

### Batch 3: Transform Planning Docs
- [ ] Database persistence feature
- [ ] Role discovery feature
- [ ] AgentManager service feature
- [ ] Ping UI integration feature

### Batch 4: Create MVP Feature Folders
- [ ] Team Service
- [ ] Artifact Store
- [ ] Real-Time Collaboration
- [ ] Approval System
- [ ] Role Manager Meta-Agent

### Batch 5: Product Documentation
- [ ] Create user guides
- [ ] Create API docs

### Batch 6: Navigation & Cleanup
- [ ] Update INDEX.md
- [ ] Update README.md
- [ ] Archive obsolete docs
- [ ] Delete empty folders

---

## Next Steps

**Ready to proceed with Batch 1 completion?**
I'll create the remaining subfolders:
- `developer-guide/modules/`
- `developer-guide/frontend/`
- `developer-guide/patterns/`
- `developer-guide/setup/`
- `product/ping/guides/`
- `product/ping/api/`

Then move to Batch 2 (moving implementation guides).

**Estimated time**: 30-45 minutes for complete refactoring across all batches.
