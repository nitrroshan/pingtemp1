# Documentation Refactoring Proposal
## Aligned with Two-Product Vision (Team Builder + Ping)

> **North Star Goal**: 
> - **Team Builder**: Design-time interface for creating teams, synthesizing agents, and defining roles (Role Manager is here)
> - **Ping**: Runtime platform where teams execute work with full visibility, control, and accountability

## Current State Analysis

### Two-Product Architecture

```
┌─────────────────────────────────────┐
│       TEAM BUILDER                   │  (Design-time)
├─────────────────────────────────────┤
│ • Role Manager (meta-agent)          │  Think, Plan, Suggest, Build
│ • Agent Synthesis                    │  Create roles from intent
│ • Team Composition                   │  Design team structure
│ • Role Specification                 │  Define agent capabilities
└─────────────────────────────────────┘
           ↓ Exports
    Team Configuration (JSON/YAML)
           ↓ Imports
┌─────────────────────────────────────┐
│            PING                      │  (Runtime)
├─────────────────────────────────────┤
│ • Team Execution                     │  Run team workflows
│ • Task Orchestration                 │  Coordinate work
│ • Agent Supervision                  │  Monitor & control
│ • Artifact Management                │  Track outputs
└─────────────────────────────────────┘
```

### Existing Codebase → Product Mapping

**Current Implementation** → **Team Builder** → **Ping**

**Team Builder Modules** (Design-time):
- `RoleManager` → **Role Manager (meta-agent)** - Agent synthesis, role creation
- Role discovery logic → **Think** (analyze need for roles)
- Role builder agents → **Plan** (design role specs)
- Agent instantiation → **Build** (materialize agents)
- NEW: **Suggest** (approval layer)

**Ping Modules** (Runtime):
- `AgentManager` → **Orchestrator** - Execute team goals, coordinate tasks
- `MemoryManager` → **State Manager** - Track tasks, artifacts, execution
- `AgentWorker` → **Execution Engine** - Run agent tasks
- Frontend (AgentChat) → **Ping UI** - Team workspace, supervision
- NEW: **Team Service** - Team scoping & membership
- NEW: **Artifact Store** - Versioned outputs
- NEW: **Approval System** - Human control layer

### Existing Documentation Structure
```
docs/
├── README.md (Overview)
├── INDEX.md (Navigation)
├── backend/ (Developer guides)
│   ├── agentManager.md
│   ├── roleManager.md
│   ├── memoryManager.md
│   ├── agentWorker.md
│   └── AgentWorker/ (subsection)
├── frontend/ (Developer guides)
│   ├── README.md
│   └── components.md
├── services/
│   └── agentRegistry.md
├── REHYDRATION_STRATEGY.md (Feature planning)
├── ROLE_DISCOVERY_ENHANCEMENT.md (Feature planning)
├── AGENTMANAGERSERVICE_INTEGRATION.md (Feature)
├── API_SPLIT.md (Feature)
├── BACKEND_FRONTEND_INTEGRATION.md (Feature)
├── taskManager_roleManager.md (Implementation details)
├── setup.md (Getting started)
├── project.md (Overview)
└── todo.md (Tracking)
```

### Issues Identified

1. **Mixed purposes**: Developer guides, features, planning, and product docs all in one place
2. **No clear separation**: Feature implementation vs product capabilities
3. **Inconsistent structure**: Some features have docs, others don't
4. **No task tracking**: No tasks/ folders
5. **No version management**: Features not organized by versions
6. **Cleanup needed**: Completed features still have planning notes

## Proposed New Structure (Two-Product Documentation)

```
docs/
├── README.md (Two-product overview: Team Builder + Ping)
├── INDEX.md (Updated navigation)
│
├── team-builder/ (Design-time Product - NEW)
│   ├── vision.md (Team Builder vision - agent synthesis platform)
│   ├── architecture.md (Role Manager + agent factory architecture)
│   ├── README.md (What is Team Builder - for users)
│   ├── features/
│   │   ├── role-manager.md (Meta-agent: Think, Plan, Suggest, Build)
│   │   ├── agent-synthesis.md (Runtime agent creation)
│   │   ├── team-composition.md (Designing team structures)
│   │   ├── role-specification.md (Role spec schema & validation)
│   │   └── export-config.md (Team config output for Ping)
│   ├── guides/
│   │   ├── creating-teams.md
│   │   ├── designing-roles.md
│   │   ├── role-manager-interface.md
│   │   └── exporting-to-ping.md
│   └── api/
│       ├── role-manager-api.md
│       ├── agent-synthesis-api.md
│       └── team-config-schema.md
│
├── ping/ (Runtime Product - NEW)
│   ├── vision.md (Full Ping vision document)
│   ├── architecture.md (High-level Ping system architecture)
│   ├── README.md (What is Ping - for users)
│   ├── features/
│   │   ├── teams-workspace.md (Ping's core: Teams as execution units)
│   │   ├── orchestration.md (How Ping coordinates work)
│   │   ├── agent-supervision.md (Human control & visibility)
│   │   ├── artifact-management.md (Outputs & versioning)
│   │   └── approval-system.md (Governance layer)
│   ├── guides/
│   │   ├── getting-started.md (from setup.md)
│   │   ├── creating-teams.md
│   │   ├── defining-goals.md
│   │   └── managing-agents.md
│   └── api/
│       ├── team-api.md
│       ├── orchestrator-api.md
│       └── websocket-events.md
│
├── developer-guide/ (Implementation Guide for Both Products - NEW)
│   ├── two-product-architecture.md (Team Builder + Ping relationship)
│   ├── current-state-mapping.md (Map current code to Team Builder vs Ping)
│   │
│   ├── team-builder-components/ (Design-time modules)
│   │   ├── role-manager-meta-agent.md (Think, Plan, Suggest, Build)
│   │   ├── agent-factory.md (Runtime agent instantiation)
│   │   ├── role-spec-engine.md (Role specification & validation)
│   │   ├── team-designer.md (Team composition UI/logic)
│   │   └── config-exporter.md (Team config generation)
│   │
│   ├── ping-components/ (Runtime modules)
│   │   ├── team-service.md (Team scoping & membership)
│   │   ├── orchestrator.md (AgentManager + team context)
│   │   ├── role-manager.md (Agent registry, team membership, task assignment)
│   │   ├── state-manager.md (MemoryManager + artifacts)
│   │   ├── execution-engine.md (AgentWorker)
│   │   ├── artifact-store.md (Versioned outputs)
│   │   ├── approval-governance.md (Human control)
│   │   └── ping-ui.md (Team workspace)
│   ├── patterns/
│   │   ├── team-scoping.md (How teams own agents/tasks/artifacts)
│   │   ├── database-persistence.md (from REHYDRATION_STRATEGY.md)
│   │   ├── event-driven-execution.md
│   │   └── adapter-layer.md (External agent integration)
│   └── setup/
│       ├── development-environment.md
│       └── debugging.md
│
├── features/ (Feature Development for Both Products - NEW)
│   │
│   ├── TEAM_BUILDER_MVP/ (Team Builder Phase 1 - NEW)
│   │   ├── feature_architecture.md (Role Manager + Agent Synthesis MVP)
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   ├── PING_PHASE_1_MVP/ (Ping Runtime MVP)
│   │   ├── feature_architecture.md (MVP scope & modules)
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   ├── team-service/ (NEW - Ping Phase 1)
│   │   ├── feature_architecture.md
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   │       ├── task-001-team-model.md
│   │   │       ├── task-002-team-membership.md
│   │   │       └── task-003-team-scoping.md
│   │   └── bugs/
│   │
│   ├── artifact-store/ (NEW - Ping Phase 1)
│   │   ├── feature_architecture.md
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   │       ├── task-001-base-artifact.md
│   │   │       ├── task-002-versioning.md
│   │   │       └── task-003-team-ownership.md
│   │   └── bugs/
│   │
│   ├── approval-governance/ (NEW - Ping Phase 1)
│   │   ├── feature_architecture.md
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   ├── team-aware-orchestrator/ (REFACTOR from AgentManager)
│   │   ├── feature_architecture.md (How AgentManager becomes team-aware)
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   ├── role-manager-meta-agent/ (NEW - Team Builder core)
│   │   ├── feature_architecture.md (Think, Plan, Suggest, Build)
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   │       ├── task-001-analyze-intent.md (Think)
│   │   │       ├── task-002-design-roles.md (Plan)
│   │   │       ├── task-003-approval-layer.md (Suggest)
│   │   │       └── task-004-instantiate-agents.md (Build)
│   │   └── bugs/
│   │
│   ├── agent-synthesis/ (NEW - Team Builder)
│   │   ├── feature_architecture.md (Runtime agent creation)
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   ├── team-config-export/ (NEW - Bridge Team Builder → Ping)
│   │   ├── feature_architecture.md (Config schema & validation)
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   ├── database-persistence/ (from REHYDRATION_STRATEGY.md)
│   │   ├── feature_architecture.md
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   │       ├── task-001-memory-manager-persistence.md
│   │   │       ├── task-002-role-manager-factories.md
│   │   │       └── task-003-agent-manager-rehydrate.md
│   │   └── bugs/
│   │
│   ├── role-discovery/ (from ROLE_DISCOVERY_ENHANCEMENT.md)
│   │   ├── feature_architecture.md
│   │   ├── v1.0/
│   │   │   ├── feature_implementation_planning.md
│   │   │   ├── feature_implementation.md
│   │   │   └── tasks/
│   │   └── bugs/
│   │
│   └── ping-ui-team-workspace/ (from BACKEND_FRONTEND_INTEGRATION.md)
│       ├── feature_architecture.md
│       ├── v1.0/
│       │   ├── feature_implementation_planning.md
│       │   ├── feature_implementation.md
│       │   └── tasks/
│       └── bugs/
│
└── archive/ (OLD - to be removed/consolidated)
    ├── taskManager_roleManager.md
    ├── project.md
    ├── todo.md
    └── DOCUMENTATION_REVIEW_CHECKLIST.md
```

## Refactoring Steps (Ping-Aligned)

### Phase 1: Create Ping Documentation Structure (Do First)
1. Create `docs/ping/` folder structure (Vision & user docs)
2. Create `docs/developer-guide/` folder structure (Ping implementation)
3. Create `docs/features/` folder structure (Ping modules as features)
4. Create `docs/archive/` folder

### Phase 2: Ping Vision & Product Documentation (New Content)
1. **Create Ping vision docs** (`ping/`)
   - `vision.md` - Full Ping vision document (Teams + Orchestration + Supervision)
   - `architecture.md` - Ping system architecture (9 core modules)
   - `README.md` - What is Ping (user-facing overview)
   
2. **Create Ping feature docs** (`ping/features/*.md`)
   - Teams workspace (execution boundaries)
   - Orchestration (goal → tasks → execution)
   - Agent supervision (human control layer)
   - Artifact management (outputs & versioning)
   - Approval system (governance)
   
3. **Create Ping guides** (`ping/guides/*.md`)
   - Getting started (from `setup.md`)
   - Creating teams
   - Defining goals
   - Managing agents

4. **Create Ping API docs** (`ping/api/*.md`)
   - Team API (create, manage teams)
   - Orchestrator API (goals, tasks, execution)
   - WebSocket events (real-time updates)

### Phase 3: Ping Developer Guide (Map Current → Ping)
1. **Create migration roadmap** (`developer-guide/current-state-to-ping.md`)
   - Map existing components to Ping modules
   - Identify what's done vs what's needed
   - Phase 1 MVP scope breakdown

2. **Ping Components** (`developer-guide/components/*.md`)
   - `team-service.md` - NEW module (foundational)
   - `team-aware-orchestrator.md` - AgentManager with team scoping (what to add)
   - `team-owned-agents.md` - RoleManager with team membership (what to add)
   - `artifact-store.md` - NEW module (Phase 1)
   - `approval-governance.md` - NEW module (Phase 1)
   - `agent-worker.md` - Execution engine (refine from backend/)
   - `ping-ui.md` - How frontend becomes team workspace

3. **Ping Patterns** (`developer-guide/patterns/*.md`)
   - Team scoping (agents, tasks, artifacts owned by teams)
   - Database persistence (from REHYDRATION_STRATEGY.md)
   - Event-driven execution
   - Adapter layer (external agent integration)

4. **Setup** (`developer-guide/setup/*.md`)
   - Development environment setup
   - Debugging guide

### Phase 4: Ping Feature Development (New + Transform Existing)

#### NEW Ping Features (Phase 1 MVP)

1. **Ping Phase 1 MVP Tracker** (`features/PING_PHASE_1_MVP/`)
   - Overall MVP architecture & scope
   - Cross-module implementation plan
   - MVP task breakdown

2. **Team Service** (`features/team-service/`)
   - Architecture: Team model, membership, scoping
   - Planning: v1.0 MVP (single team)
   - Tasks: team-001-model, team-002-membership, team-003-scoping

3. **Artifact Store** (`features/artifact-store/`)
   - Architecture: BaseArtifact, versioning, team ownership
   - Planning: v1.0 MVP (append-only outputs)
   - Tasks: artifact-001-base, artifact-002-versioning, artifact-003-ownership

4. **Approval & Governance** (`features/approval-governance/`)
   - Architecture: Validate outputs, control merges, audit trail
   - Planning: v1.0 MVP (approve/reject)
   - Tasks: approval-001-validate, approval-002-diff, approval-003-audit

#### REFACTOR Existing to Ping

5. **Team-Aware Orchestrator** (`features/team-aware-orchestrator/`)
   - Architecture: What team scoping to add to AgentManager
   - AgentManager already orchestrates - just add team context
   - Tasks: orchestrator-001-team-goals, orchestrator-002-team-tasks, orchestrator-003-team-state

6. **Team-Owned Agents** (`features/team-owned-agents/`)
   - Architecture: How agents become team members
   - RoleManager already manages agents - add team ownership
   - Tasks: agents-001-team-assignment, agents-002-team-registry, agents-003-team-capabilities

7. **Database Persistence** (`features/database-persistence/`)
   - Transform REHYDRATION_STRATEGY.md
   - Keep existing tasks (already defined)

8. **Role Discovery** (`features/role-discovery/`)
   - Transform ROLE_DISCOVERY_ENHANCEMENT.md
   - Align with team-owned agents

9. **Ping UI (Team Workspace)** (`features/ping-ui-team-workspace/`)
   - Transform BACKEND_FRONTEND_INTEGRATION.md
   - Focus on team workspace UI
   - Tasks: ui-001-team-view, ui-002-artifact-tree, ui-003-approvals

### Phase 5: Archive & Update Root Docs
1. Move obsolete docs to `archive/`:
   - `taskManager_roleManager.md` (consolidated into developer guide)
   - `project.md` (replaced by ping/vision.md)
   - `todo.md` (replaced by features/*/tasks/)
   - `DOCUMENTATION_REVIEW_CHECKLIST.md` (one-time use)
   - `AGENTMANAGERSERVICE_INTEGRATION.md` (transformed to features)
   - `API_SPLIT.md` (consolidated into Ping architecture)

2. Update root documentation with Ping branding:
   - `README.md` → Ping overview + new structure
   - `INDEX.md` → Ping-centric navigation
   - Add link to `.github/instructions/` for contributors

3. Update `.github/copilot-instructions.md`:
   - Add Ping vision context
   - Reference Ping module architecture
   - Link to ping/vision.md for product direction

## Migration Checklist

### ✅ Before Starting
- [ ] User approval of this plan
- [ ] Decide which docs to archive vs refactor
- [ ] Identify completed features (for cleanup)

### 📋 Phase 1: Structure
- [ ] Create `docs/product/` folders
- [ ] Create `docs/developer-guide/` folders
- [ ] Create `docs/features/` folders
- [ ] Create `docs/archive/` folder

### 📋 Phase 2: Ping Vision & Product Docs (NEW)
- [ ] Create `ping/vision.md` (Full Ping document)
- [ ] Create `ping/architecture.md` (9 core modules)
- [ ] Create `ping/README.md` (User-facing overview)
- [ ] Create `ping/features/*.md` (5 files: teams, orchestration, supervision, artifacts, approval)
- [ ] Create `ping/guides/*.md` (4 files: getting-started, teams, goals, agents)
- [ ] Create `ping/api/*.md` (3 files: team-api, orchestrator-api, websocket)

### 📋 Phase 3: Ping Developer Guide (MAP CURRENT → PING)
- [ ] Create `current-state-to-ping.md` (migration roadmap)
- [ ] Create `ping-architecture.md` (module integration)
- [ ] Create component docs (7 files: team-service, orchestrator, agent-manager, artifact-store, approval, worker, ui)
- [ ] Create pattern docs (4 files: team-scoping, persistence, events, adapters)
- [ ] Create setup docs (2 files)

### 📋 Phase 4: Ping Features (NEW + TRANSFORM)
**NEW Ping Features:**
- [ ] Ping Phase 1 MVP tracker (top-level)
- [ ] Team Service feature (NEW)
- [ ] Artifact Store feature (NEW)
- [ ] Approval & Governance feature (NEW)

**REFACTOR Existing:**
- [ ] Team-Aware Orchestrator (from AgentManager)
- [ ] Team-Owned Agents (from RoleManager)
- [ ] Database Persistence (from REHYDRATION_STRATEGY.md)
- [ ] Role Discovery (from ROLE_DISCOVERY_ENHANCEMENT.md)
- [ ] Ping UI Team Workspace (from BACKEND_FRONTEND_INTEGRATION.md)

### 📋 Phase 5: Cleanup
- [ ] Move to archive/
- [ ] Update README.md
- [ ] Update INDEX.md
- [ ] Delete obsolete files (after verification)

## Two-Product Refactoring Strategy

### Understood North Star
**Two separate but connected products:**

1. **Team Builder** (Design-time)
   - Role Manager as meta-agent
   - Agent synthesis & role creation
   - Team composition design
   - Export team configurations

2. **Ping** (Runtime)
   - Import team configurations
   - Execute team workflows
   - Orchestrate tasks
   - Supervise agents
   - Manage artifacts

### Current Codebase Split

**→ Team Builder** (Design-time):
- ✅ RoleManager = Foundation for Role Manager meta-agent
- ✅ Role discovery = Foundation for "Think" phase
- ✅ Role builder agents = Foundation for "Plan" phase
- ❌ **Missing**: Suggest (approval layer)
- ❌ **Missing**: Build (agent instantiation at runtime)
- ❌ **Missing**: Team composition UI
- ❌ **Missing**: Config export

**→ Ping** (Runtime):
- ✅ AgentManager = Orchestrator (execute goals)
- ✅ MemoryManager = State management
- ✅ AgentWorker = Execution engine
- ✅ Frontend = Foundation for Ping UI
- ❌ **Missing**: Team Service (import configs, scope execution)
- ❌ **Missing**: Artifact Store
- ❌ **Missing**: Approval & Governance

### Execution Plan

**Option A: Two-Product Vision First (Recommended)**
1. Create `team-builder/vision.md` + `ping/vision.md` (establish both products)
2. Create `developer-guide/two-product-architecture.md` (how they connect)
3. Create `developer-guide/current-state-mapping.md` (split current code)
4. Create Team Builder MVP features (role-manager, agent-synthesis, config-export)
5. Create Ping MVP features (team-service, artifact-store, approval)
6. Archive old docs

**Option B: Features First**
1. Create all feature folders (new + refactored)
2. Create Ping vision docs
3. Create developer guide
4. Archive old docs

**Option C: Incremental (Safest)**
1. Phase 2 (Ping vision) only
2. Get feedback
3. Phase 3 (Developer guide mapping)
4. Get feedback
5. Phase 4 (Features) in batches
6. Phase 5 (Archive)

## Next Steps

I recommend **Option A (Two-Product Vision First)** because:
- Establishes clear separation: **Team Builder** (design-time) vs **Ping** (runtime)
- Shows Role Manager as **meta-agent in Team Builder**, not Ping orchestration
- Clarifies current code split between the two products
- Guides development: build Team Builder first, then Ping consumes its output

**Ready to execute?** Confirm and I'll:
1. Create **Team Builder vision** (Role Manager as meta-agent for agent synthesis)
2. Create **Ping vision** (runtime execution of teams)
3. Create **two-product architecture** document (how they connect)
4. Map current codebase to Team Builder vs Ping
5. Set up feature folders for both products
6. Begin documentation refactoring

**Key Question:**
Should Team Builder and Ping be:
- **Same codebase, different modules?**
- **Separate repos?**
- **Monorepo with separate packages?**

**Or specify:**
- Different option (B or C)
- Start with specific phase
- Questions about the approach
