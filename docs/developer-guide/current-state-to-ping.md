# Current Codebase to Ping Migration

**This guide maps the existing codebase to Ping's architecture and identifies what exists vs. what needs to be built.**

---

## Overview

**Ping Vision:** Teams + Orchestration + Agent Supervision Platform

**Current State:** Foundation exists, needs team scoping and missing modules

---

## Architecture Mapping

### ✅ What Already Exists

| Ping Module | Current Implementation | Location | Status |
|-------------|------------------------|----------|--------|
| **Orchestrator** | `AgentManager.ts` | `src/worker/agentManager/` | ✅ Exists, needs team scoping |
| **Role Manager (Runtime)** | `RoleManager.ts` | `src/worker/roleManager/` | ✅ Exists, needs team membership |
| **State Manager** | `MemoryManager.ts` | `src/worker/memoryManager/` | ✅ Exists, needs artifact tracking |
| **Execution Engine** | `AgentWorker.ts` | `src/worker/AgentWorker/` | ✅ Exists, needs team context |
| **Ping UI** | React frontend | `src/AgentChat/` | ✅ Foundation exists |
| **API Layer** | HTTP + WebSocket | `src/worker/api/` | ✅ Exists |

### ❌ What's Missing (MVP Features)

| Ping Module | Required For | Priority |
|-------------|--------------|----------|
| **Team Service** | Team scoping & membership | 🔴 Critical |
| **Artifact Store** | Versioned outputs | 🔴 Critical |
| **Approval System** | Human control | 🔴 Critical |
| **Role Manager (Meta-Agent)** | Agent synthesis (Suggest, Build) | 🟡 High |
| **Task Planner** | Goal decomposition | 🟡 High |

---

## Package Migration Plan

### Current Structure → Monorepo

```
Current (Single Package):
src/
├── worker/
│   ├── agentManager/
│   ├── roleManager/
│   ├── memoryManager/
│   ├── AgentWorker/
│   └── api/
└── AgentChat/

Monorepo (Three Packages):
packages/
├── team-builder/       (@ping/team-builder)
│   └── src/
│       ├── role-manager/        (Meta-agent: Think/Plan/Suggest/Build)
│       ├── agent-synthesis/
│       └── team-designer/
├── ping/               (@ping/runtime)
│   └── src/
│       ├── team-service/        (NEW)
│       ├── orchestrator/        (from agentManager)
│       ├── role-manager/        (from roleManager + team context)
│       ├── artifact-store/      (NEW)
│       ├── approval/            (NEW)
│       ├── agent-worker/        (from AgentWorker)
│       ├── state-manager/       (from memoryManager)
│       └── ui/                  (from AgentChat)
└── shared/             (@ping/shared)
    └── src/
        ├── types/
        └── utils/
```

---

## Component-by-Component Migration

### 1. Orchestrator (AgentManager)

**Current File:** `src/worker/agentManager/AgentManager.ts`

**What Exists:**
- ✅ Goal execution
- ✅ Task coordination
- ✅ Event subscription

**What to Add:**
- ❌ Team scoping (goals belong to teams)
- ❌ Team context in all operations
- ❌ Team-level state management

**Migration Path:**
```typescript
// Before
class AgentManager {
  async executeGoal(goal: string): Promise<void> {
    // ...
  }
}

// After
class Orchestrator {
  async executeGoal(teamId: string, goal: string): Promise<void> {
    const team = await this.teamService.getTeam(teamId)
    // Scope all operations to team
  }
}
```

**New Location:** `packages/ping/src/orchestrator/Orchestrator.ts`

---

### 2. Role Manager (Dual Mode)

**Current File:** `src/worker/roleManager/RoleManager.ts`

#### Design Mode (Meta-Agent)

**What Exists:**
- ✅ Role discovery logic (Think phase foundation)
- ✅ Role builder agents (Plan phase foundation)

**What to Add:**
- ❌ Suggest phase (human approval)
- ❌ Build phase (runtime agent instantiation)
- ❌ Team Designer UI

**New Location:** `packages/team-builder/src/role-manager/RoleManagerMetaAgent.ts`

#### Runtime Mode (Agent Registry)

**What Exists:**
- ✅ Agent registry
- ✅ Role capabilities tracking

**What to Add:**
- ❌ Team membership (agents belong to teams)
- ❌ Team-scoped task assignment

**Migration Path:**
```typescript
// Before
class RoleManager {
  async discoverRoles(): Promise<AgentRole[]> {
    // ...
  }
}

// After (Design Mode)
class RoleManagerMetaAgent {
  async analyze(context: TeamContext): Promise<RoleDecision> // Think
  async design(intent: string): Promise<RoleSpec[]>          // Plan
  async validate(specs: RoleSpec[]): Promise<ApprovalResult> // Suggest
  async instantiate(spec: RoleSpec): Promise<AgentHandle>    // Build
}

// After (Runtime)
class RoleManagerRuntime {
  async getAgentsByTeam(teamId: string): Promise<Agent[]>
  async assignTask(teamId: string, agentId: string, taskId: string): Promise<void>
}
```

**New Locations:**
- Design: `packages/team-builder/src/role-manager/`
- Runtime: `packages/ping/src/role-manager/`

---

### 3. State Manager (MemoryManager)

**Current File:** `src/worker/memoryManager/MemoryManager.ts`

**What Exists:**
- ✅ Task tracking
- ✅ Status management
- ✅ Prerequisites

**What to Add:**
- ❌ Artifact tracking
- ❌ Versioning
- ❌ Team scoping (tasks belong to teams)

**Migration Path:**
```typescript
// Before
class MemoryManager {
  async addTask(task: Task): Promise<void> {
    // ...
  }
}

// After
class StateManager {
  async addTask(teamId: string, task: Task): Promise<void> {
    task.teamId = teamId
    // ...
  }
  
  async addArtifact(teamId: string, artifact: Artifact): Promise<void> {
    // NEW: Track artifacts
  }
}
```

**New Location:** `packages/ping/src/state-manager/StateManager.ts`

---

### 4. Execution Engine (AgentWorker)

**Current File:** `src/worker/AgentWorker/AgentWorker.ts`

**What Exists:**
- ✅ Task execution
- ✅ Event emission
- ✅ Message handling

**What to Add:**
- ❌ Team context in execution
- ❌ Artifact output tracking

**Migration Path:**
```typescript
// Before
class AgentWorker {
  async execute(input: TInput): Promise<TOutput> {
    // ...
  }
}

// After
class ExecutionEngine {
  async execute(teamId: string, agentId: string, taskId: string, input: TInput): Promise<TOutput> {
    const result = await this.agent.invoke(input)
    await this.artifactStore.saveArtifact(teamId, taskId, result)
    return result
  }
}
```

**New Location:** `packages/ping/src/agent-worker/ExecutionEngine.ts`

---

### 5. Ping UI (Frontend)

**Current Location:** `src/AgentChat/`

**What Exists:**
- ✅ Agent chat interface
- ✅ Message display
- ✅ WebSocket communication

**What to Add:**
- ❌ Team workspace view
- ❌ Artifact tree
- ❌ Approval queue
- ❌ Team-centric navigation

**Migration Path:**
```tsx
// Before
<App>
  <Sidebar agents={agents} />
  <ChatArea messages={messages} />
</App>

// After
<App>
  <TeamSidebar teams={teams} currentTeam={currentTeam} />
  <TeamWorkspace teamId={currentTeam.id}>
    <TaskList tasks={tasks} />
    <ArtifactTree artifacts={artifacts} />
    <ApprovalQueue approvals={approvals} />
    <AgentOutputs outputs={outputs} />
  </TeamWorkspace>
</App>
```

**New Location:** `packages/ping/src/ui/`

---

### 6. Team Service (NEW)

**No Current Implementation**

**What to Build:**
- Team model & repository
- Membership management (humans + agents)
- Team scoping logic
- Cross-team collaboration rules

**New Location:** `packages/ping/src/team-service/`

**Data Model:**
```typescript
interface Team {
  id: string
  name: string
  type: 'product' | 'marketing' | 'sales' | 'engineering' | 'custom'
  humans: User[]
  agents: Agent[]
  tasks: Task[]
  artifacts: Artifact[]
  createdAt: Date
  updatedAt: Date
}
```

---

### 7. Artifact Store (NEW)

**No Current Implementation**

**What to Build:**
- BaseArtifact model
- Version management
- Team-scoped storage
- Diff engine

**New Location:** `packages/ping/src/artifact-store/`

**Data Model:**
```typescript
interface Artifact {
  id: string
  teamId: string
  agentId: string
  taskId: string
  type: 'code' | 'document' | 'data' | 'config'
  content: string
  version: number
  parentVersion?: number
  createdAt: Date
  metadata: Record<string, any>
}
```

---

### 8. Approval System (NEW)

**No Current Implementation**

**What to Build:**
- Output validation
- Approval queue
- Audit log
- Diff viewer

**New Location:** `packages/ping/src/approval/`

---

## Shared Types Migration

**Current Locations:**
- `src/worker/agentManager/types/`
- `src/worker/memoryManager/types/`
- `src/worker/roleManager/types/`

**New Location:** `packages/shared/src/types/`

**Consolidate:**
```typescript
// @ping/shared/src/types/index.ts
export * from './Team'
export * from './Agent'
export * from './Task'
export * from './Artifact'
export * from './RoleSpec'
export * from './TeamConfig'
```

---

## Migration Checklist

### Phase 1: Set Up Monorepo ✅ (Complete)
- [x] Create foundational documentation
- [ ] Create `pnpm-workspace.yaml`
- [ ] Create `packages/` structure
- [ ] Configure TypeScript base config

### Phase 2: Create @ping/shared
- [ ] Move common types to `packages/shared/src/types/`
- [ ] Move utilities to `packages/shared/src/utils/`
- [ ] Set up package.json
- [ ] Build and test

### Phase 3: Create @ping/runtime
- [ ] Move `AgentManager` → `Orchestrator` (add team scoping)
- [ ] Move `RoleManager` → `RoleManagerRuntime` (add team membership)
- [ ] Move `MemoryManager` → `StateManager` (add artifacts)
- [ ] Move `AgentWorker` → `ExecutionEngine` (add team context)
- [ ] Move frontend → `ui/` (add team workspace)
- [ ] Create `TeamService` (NEW)
- [ ] Create `ArtifactStore` (NEW)
- [ ] Create `ApprovalSystem` (NEW)

### Phase 4: Create @ping/team-builder
- [ ] Move `RoleManager` → `RoleManagerMetaAgent` (Think/Plan)
- [ ] Implement Suggest phase (approval layer)
- [ ] Implement Build phase (agent instantiation)
- [ ] Create Team Designer UI
- [ ] Create Config Exporter

### Phase 5: Test & Deploy
- [ ] Integration tests (team-builder → ping)
- [ ] End-to-end tests
- [ ] Documentation updates
- [ ] Deployment configs

---

## Key Differences: Current vs. Ping

| Aspect | Current | Ping |
|--------|---------|------|
| **Scope** | Global agents/tasks | Team-scoped agents/tasks/artifacts |
| **Orchestration** | Goal → tasks | Team goal → team tasks |
| **Agents** | Shared across all work | Owned by teams |
| **Outputs** | In-memory strings | Versioned artifacts |
| **Control** | No approval | Human approval layer |
| **Modes** | Single runtime | Design + Execution |

---

## Related Documentation

- [Ping Vision](../ping/vision.md) - Product vision
- [Ping Architecture](../ping/architecture.md) - Technical architecture
- [Monorepo Structure](./monorepo-architecture.md) - Package organization
- [Team Builder](../ping/team-builder.md) - Design mode details
