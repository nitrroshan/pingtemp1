# Ping — Technical Architecture

**Ping is a team-based orchestration platform with two operational modes: Design (Team Builder) and Execution (Runtime).**

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         PING                                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────┐      ┌─────────────────────┐      │
│  │   TEAM BUILDER       │      │   PING RUNTIME       │      │
│  │   (Design Mode)      │ ───▶ │   (Execution Mode)   │      │
│  ├─────────────────────┤      ├─────────────────────┤      │
│  │ • Role Manager       │      │ • Team Service       │      │
│  │   (meta-agent)       │      │ • Orchestrator       │      │
│  │ • Agent Synthesis    │      │ • Agent Manager      │      │
│  │ • Team Designer      │      │ • Task Planner       │      │
│  │ • Config Exporter    │      │ • Artifact Store     │      │
│  └─────────────────────┘      │ • Approval System    │      │
│            │                   │ • Progress Monitor   │      │
│            │ Team Config       │ • Adapter Layer      │      │
│            └──────────────────▶│ • Ping UI            │      │
│                                └─────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## Module Architecture

### 1. Team Service (Runtime - Foundational)

**Location:** `packages/ping/src/team-service/`

**Responsibilities:**
- Team creation & membership management
- Team-level scoping (agents, tasks, artifacts)
- Cross-team collaboration rules

**Key Components:**
- `TeamModel.ts` - Team data structure
- `TeamRepository.ts` - Team persistence
- `MembershipManager.ts` - Human & agent membership

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

### 2. Orchestrator (Runtime - Team-Aware)

**Location:** `packages/ping/src/orchestrator/`

**Current Implementation:** `AgentManager.ts`

**What Changes:** Add team scoping

**Responsibilities:**
- Receive team goals
- Trigger task planning
- Coordinate agent execution
- Maintain execution state

**Key Components:**
- `TeamGoalHandler.ts` - NEW: Receive & scope goals per team
- `TaskCoordinator.ts` - Coordinate tasks within team
- `ExecutionState.ts` - Track team execution state

**Enhancement:**
```typescript
// Before (current)
executeGoal(goal: string): Promise<void>

// After (team-aware)
executeGoal(teamId: string, goal: string): Promise<void>
```

---

### 3. Role Manager (Dual Mode)

**Location:** 
- Design Mode: `packages/team-builder/src/role-manager/`
- Runtime: `packages/ping/src/role-manager/`

**Design Mode (Meta-Agent):**
- Think: Analyze need for new roles
- Plan: Design role specifications
- Suggest: Human approval layer
- Build: Instantiate agents at runtime

**Runtime (Agent Registry):**
- Manage agent registry per team
- Track agent capabilities
- Assign tasks to agents
- Monitor agent progress

**Shared Interface:**
```typescript
// Design Mode
interface RoleManagerMetaAgent {
  analyze(context: TeamContext): RoleDecision
  design(roleIntent: string): RoleSpec[]
  validate(roleSpecs: RoleSpec[]): ApprovalResult
  instantiate(roleSpec: RoleSpec): AgentHandle
}

// Runtime
interface RoleManagerRuntime {
  getAgentsByTeam(teamId: string): Agent[]
  assignTask(agentId: string, taskId: string): void
  trackProgress(agentId: string): AgentProgress
}
```

---

### 4. Task Planner (Runtime)

**Location:** `packages/ping/src/task-planner/`

**Responsibilities:**
- Decompose team goals into executable tasks
- Define task dependencies
- Set output expectations

**Key Components:**
- `GoalDecomposer.ts` - Break down goals
- `DependencyGraph.ts` - Task dependencies
- `OutputContract.ts` - Expected outputs

---

### 5. Artifact Store (Runtime - NEW)

**Location:** `packages/ping/src/artifact-store/`

**Responsibilities:**
- Store agent outputs per team (code, documents, binary files)
- Track versions using hybrid storage (Git + Object Storage)
- Enable inspection, diffs, and approvals
- Support agent branching workflows

**Key Components:**
- `BaseArtifact.ts` - Core artifact model
- `GitStorageBackend.ts` - Git branches, commits, PRs for text/code
- `ObjectStorageBackend.ts` - S3/Blob storage for binary files
- `VersionManager.ts` - Unified versioning across storage types
- `TeamArtifactSpace.ts` - Team-scoped artifact workspace
- `BranchManager.ts` - Per-agent branch management

**Storage Strategy:**
- **Code/Documents** → Git branches + Pull Requests
- **Binary Files** → Object Storage (S3/Azure Blob) + Git LFS-style pointers
- **Small Data** (<10MB) → Git
- **Large Data** (>10MB) → Object Storage + metadata

**See:** [Artifact Output Strategy](./artifact-output-strategy.md) for detailed implementation

**Data Model:**
```typescript
interface Artifact {
  id: string
  teamId: string
  agentId: string
  taskId: string
  type: 'code' | 'document' | 'binary' | 'data'
  storage: 'git' | 'object'
  version: number
  parentVersion?: number
  createdAt: Date
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected'
  metadata: Record<string, any>
}

interface GitArtifact extends Artifact {
  storage: 'git'
  branchName: string
  commitHash: string
  prId?: string
}

interface ObjectStorageArtifact extends Artifact {
  storage: 'object'
  storageUrl: string
  contentHash: string
  size: number
  mimeType: string
}
```

---

### 6. Approval & Governance (Runtime - NEW)

**Location:** `packages/ping/src/approval/`

**Responsibilities:**
- Validate agent outputs
- Control artifact merges
- Maintain audit trail

**Key Components:**
- `OutputValidator.ts` - Validate outputs
- `ApprovalQueue.ts` - Manage approval requests
- `AuditLog.ts` - Track all approvals

---

### 7. Agent Worker (Runtime - Execution Engine)

**Location:** `packages/ping/src/agent-worker/`

**Current Implementation:** `AgentWorker.ts`

**What Changes:** Add team context to task execution

**Responsibilities:**
- Execute agent tasks
- Emit real-time events
- Handle task failures

---

### 8. State Manager (Runtime)

**Location:** `packages/ping/src/state-manager/`

**Current Implementation:** `MemoryManager.ts`

**What Changes:** Add artifact tracking & versioning

**Responsibilities:**
- Track tasks, status, outputs
- Manage team execution state
- Provide ready tasks per role

---

### 9. Ping UI (Runtime - Team Workspace)

**Location:** `packages/ping/src/ui/` (React frontend)

**Current Implementation:** `src/AgentChat/`

**What Changes:** Team-centric interface

**Key Features:**
- Team task list
- Artifact tree view
- Approval queue
- Agent output panes
- Timeline & progress views

---

## Monorepo Structure

```
agent-chat-backend/       (Monorepo root)
├── packages/
│   ├── team-builder/     (Design Mode - Independent Package)
│   │   ├── src/
│   │   │   ├── role-manager/    (Meta-agent: Think/Plan/Suggest/Build)
│   │   │   ├── agent-synthesis/  (Runtime agent creation)
│   │   │   ├── team-designer/    (UI for team composition)
│   │   │   └── config-exporter/  (Export team configs)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ping/             (Runtime - Independent Package)
│   │   ├── src/
│   │   │   ├── team-service/     (Team scoping & membership)
│   │   │   ├── orchestrator/     (AgentManager + team context)
│   │   │   ├── role-manager/     (Agent registry, runtime)
│   │   │   ├── task-planner/     (Goal decomposition)
│   │   │   ├── artifact-store/   (Versioned outputs)
│   │   │   ├── approval/         (Human control)
│   │   │   ├── agent-worker/     (Execution engine)
│   │   │   ├── state-manager/    (MemoryManager + artifacts)
│   │   │   └── ui/               (React frontend)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/           (Shared Library)
│       ├── src/
│       │   ├── types/            (Common types)
│       │   ├── utils/            (Shared utilities)
│       │   └── constants/        (Shared constants)
│       └── package.json
│
├── package.json          (Workspace config)
├── pnpm-workspace.yaml   (pnpm workspace definition)
└── tsconfig.json         (Base TypeScript config)
```

---

## Data Flow

### Design Mode (Team Builder)

```
1. User: "Create a product launch team"
2. Team Builder: Invokes Role Manager meta-agent
3. Role Manager (Think): Analyzes need for agents
4. Role Manager (Plan): Designs role specs (Product Manager, Marketing, Content Creator)
5. Role Manager (Suggest): Presents to user
6. User: Approves
7. Role Manager (Build): Instantiates agents
8. Team Builder: Exports team config (JSON/YAML)
```

### Execution Mode (Ping Runtime)

```
1. Ping: Imports team config
2. User: "Launch product X"
3. Team Service: Scopes goal to team
4. Orchestrator: Receives team goal
5. Task Planner: Decomposes into tasks
6. Role Manager (Runtime): Assigns tasks to agents
7. Agent Worker: Executes tasks
8. Artifact Store: Stores outputs
9. Approval System: Queues for human review
10. User: Approves/rejects
11. Orchestrator: Continues or retries
```

---

## Current Codebase Mapping

### Team Builder (Design Mode)
| Component | Current File | Status |
|-----------|--------------|--------|
| Role Manager (Meta-Agent) | `src/worker/roleManager/RoleManager.ts` | ✅ Foundation exists |
| Think Phase | Role discovery logic | ✅ Partially exists |
| Plan Phase | Role builder agents | ✅ Partially exists |
| Suggest Phase | — | ❌ Missing (MVP feature) |
| Build Phase | Agent instantiation | ❌ Missing (MVP feature) |
| Team Designer | — | ❌ Missing (MVP feature) |
| Config Exporter | — | ❌ Missing (MVP feature) |

### Ping Runtime
| Component | Current File | Status |
|-----------|--------------|--------|
| Orchestrator | `src/worker/agentManager/AgentManager.ts` | ✅ Exists, needs team scoping |
| Role Manager (Runtime) | `src/worker/roleManager/RoleManager.ts` | ✅ Exists, needs team membership |
| State Manager | `src/worker/memoryManager/MemoryManager.ts` | ✅ Exists, needs artifact tracking |
| Agent Worker | `src/worker/AgentWorker/AgentWorker.ts` | ✅ Exists, needs team context |
| Ping UI | `src/AgentChat/` | ✅ Foundation exists |
| Team Service | — | ❌ Missing (MVP feature) |
| Artifact Store | — | ❌ Missing (MVP feature) |
| Approval System | — | ❌ Missing (MVP feature) |

---

## Technology Stack

### Backend
- **Runtime:** Node.js + TypeScript
- **Framework:** Express (HTTP), Socket.IO (WebSocket)
- **AI:** LangChain, Azure OpenAI
- **Database:** MongoDB (planned), JSON files (current)
- **Monorepo:** pnpm workspaces

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **State:** React hooks
- **Communication:** Socket.IO (real-time), Axios (HTTP)

---

## Next Steps

1. **Set up monorepo** (pnpm workspaces)
2. **Create package structure** (team-builder, ping, shared)
3. **Migrate current code** to appropriate packages
4. **Implement missing MVP features:**
   - Team Service
   - Artifact Store
   - Approval System
   - Role Manager Suggest & Build phases

---

## Related Documentation

- [Ping Vision](./vision.md) - Product vision and goals
- [Team Builder](./team-builder.md) - Design mode details
- [Artifact Output Strategy](./artifact-output-strategy.md) - How agents create outputs (Git + Object Storage)
- [Monorepo Structure](../developer-guide/monorepo-architecture.md) - Package organization
- [Current State Mapping](../developer-guide/current-state-to-ping.md) - Migration guide
