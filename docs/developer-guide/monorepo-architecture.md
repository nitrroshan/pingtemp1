# Monorepo Architecture

**Ping uses a monorepo structure with pnpm workspaces to separate Team Builder (design mode) and Ping Runtime (execution mode) while sharing common code.**

---

## Why Monorepo?

**✅ Advantages:**
- Independent versioning (Team Builder v1.0, Ping v2.0)
- Independent deployment (can deploy separately)
- Clear boundaries (enforced separation)
- Easy to split into separate repos later
- Share code via `shared` package
- Different dependencies per package

**❌ vs. Single Package:**
- More complex setup (workspace config)
- Requires monorepo tooling (pnpm workspaces)

---

## Package Structure

```
agent-chat-backend/           (Monorepo root)
├── packages/
│   ├── team-builder/         (@ping/team-builder)
│   ├── ping/                 (@ping/runtime)
│   └── shared/               (@ping/shared)
├── package.json              (Workspace root)
├── pnpm-workspace.yaml       (pnpm config)
└── tsconfig.json             (Base config)
```

---

## Package: @ping/team-builder

**Purpose:** Design-time interface for creating teams and synthesizing agents

**Location:** `packages/team-builder/`

```
team-builder/
├── src/
│   ├── role-manager/
│   │   ├── RoleManagerMetaAgent.ts      (Think/Plan/Suggest/Build)
│   │   ├── ThinkPhase.ts                (Analyze need for roles)
│   │   ├── PlanPhase.ts                 (Design role specs)
│   │   ├── SuggestPhase.ts              (Approval layer)
│   │   └── BuildPhase.ts                (Instantiate agents)
│   ├── agent-synthesis/
│   │   ├── AgentFactory.ts              (Runtime agent creation)
│   │   ├── RoleSpecEngine.ts            (Role spec validation)
│   │   └── AgentTemplates.ts            (Base agent templates)
│   ├── team-designer/
│   │   ├── TeamComposer.ts              (Team composition logic)
│   │   └── TeamDesignerUI.tsx           (React UI)
│   ├── config-exporter/
│   │   ├── TeamConfigExporter.ts        (Export team configs)
│   │   └── ConfigValidator.ts           (Validate configs)
│   └── index.ts
├── package.json
└── tsconfig.json
```

**Dependencies:**
```json
{
  "name": "@ping/team-builder",
  "version": "1.0.0",
  "dependencies": {
    "@ping/shared": "workspace:*",
    "@langchain/core": "^0.1.0",
    "@langchain/openai": "^0.0.20"
  }
}
```

---

## Package: @ping/runtime

**Purpose:** Runtime execution platform for team workflows

**Location:** `packages/ping/`

```
ping/
├── src/
│   ├── team-service/
│   │   ├── TeamService.ts               (Team management)
│   │   ├── TeamModel.ts                 (Team data structure)
│   │   ├── MembershipManager.ts         (Human & agent membership)
│   │   └── TeamRepository.ts            (Persistence)
│   ├── orchestrator/
│   │   ├── AgentManager.ts              (Existing, add team scoping)
│   │   ├── TeamGoalHandler.ts           (NEW: Team goal handling)
│   │   └── TaskCoordinator.ts           (Coordinate tasks)
│   ├── role-manager/
│   │   ├── RoleManagerRuntime.ts        (Agent registry)
│   │   ├── AgentRegistry.ts             (Team-scoped agents)
│   │   └── TaskAssignment.ts            (Assign tasks to agents)
│   ├── task-planner/
│   │   ├── TaskPlanner.ts               (Goal decomposition)
│   │   ├── GoalDecomposer.ts            (Break down goals)
│   │   └── DependencyGraph.ts           (Task dependencies)
│   ├── artifact-store/
│   │   ├── ArtifactStore.ts             (Artifact management)
│   │   ├── BaseArtifact.ts              (Core artifact model)
│   │   ├── VersionManager.ts            (Versioning)
│   │   └── TeamArtifactSpace.ts         (Team-scoped storage)
│   ├── approval/
│   │   ├── ApprovalSystem.ts            (Approval orchestration)
│   │   ├── OutputValidator.ts           (Validate outputs)
│   │   ├── ApprovalQueue.ts             (Approval requests)
│   │   └── AuditLog.ts                  (Audit trail)
│   ├── agent-worker/
│   │   └── AgentWorker.ts               (Existing, add team context)
│   ├── state-manager/
│   │   └── MemoryManager.ts             (Existing, add artifacts)
│   ├── api/
│   │   ├── HttpServer.ts                (REST API)
│   │   └── SocketServer.ts              (WebSocket)
│   └── ui/                              (React frontend)
│       ├── App.tsx
│       ├── components/
│       └── services/
├── package.json
└── tsconfig.json
```

**Dependencies:**
```json
{
  "name": "@ping/runtime",
  "version": "1.0.0",
  "dependencies": {
    "@ping/shared": "workspace:*",
    "@langchain/core": "^0.1.0",
    "@langchain/langgraph": "^0.0.19",
    "express": "^4.18.0",
    "socket.io": "^4.6.0"
  }
}
```

---

## Package: @ping/shared

**Purpose:** Shared types, utilities, and constants

**Location:** `packages/shared/`

```
shared/
├── src/
│   ├── types/
│   │   ├── Team.ts                      (Team interface)
│   │   ├── Agent.ts                     (Agent interface)
│   │   ├── Task.ts                      (Task interface)
│   │   ├── Artifact.ts                  (Artifact interface)
│   │   ├── RoleSpec.ts                  (Role specification)
│   │   └── TeamConfig.ts                (Team configuration)
│   ├── utils/
│   │   ├── logger.ts                    (Logging utility)
│   │   ├── validation.ts                (Validation helpers)
│   │   └── serialization.ts             (JSON/YAML helpers)
│   ├── constants/
│   │   ├── roles.ts                     (Default roles)
│   │   └── config.ts                    (Default configs)
│   └── index.ts
├── package.json
└── tsconfig.json
```

**Dependencies:**
```json
{
  "name": "@ping/shared",
  "version": "1.0.0",
  "dependencies": {
    "zod": "^3.22.0"
  }
}
```

---

## Workspace Configuration

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### Root package.json

```json
{
  "name": "ping-monorepo",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev:team-builder": "pnpm --filter @ping/team-builder dev",
    "dev:ping": "pnpm --filter @ping/runtime dev",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "turbo": "^1.11.0"
  }
}
```

---

## Shared Types Example

### @ping/shared/src/types/Team.ts

```typescript
export interface Team {
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

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'approver' | 'supervisor'
}

export interface Agent {
  id: string
  roleSpec: RoleSpec
  teamId: string
  status: 'active' | 'idle' | 'terminated'
  createdAt: Date
}
```

### @ping/shared/src/types/RoleSpec.ts

```typescript
export interface RoleSpec {
  name: string
  objective: string
  inputs: string[]
  outputs: string[]
  authority: string
  lifecycle: 'ephemeral' | 'session-bound' | 'persistent'
  template: 'planner' | 'executor' | 'critic' | 'memory-centric'
}
```

---

## Package Imports

### From @ping/team-builder

```typescript
import type { Team, RoleSpec, Agent } from '@ping/shared'
import { logger, validateRoleSpec } from '@ping/shared'
```

### From @ping/runtime

```typescript
import type { Team, Task, Artifact } from '@ping/shared'
import { logger, serializeTeam } from '@ping/shared'
```

---

## Development Workflow

### Install dependencies

```bash
pnpm install
```

### Build all packages

```bash
pnpm build
```

### Run Team Builder in dev mode

```bash
pnpm dev:team-builder
```

### Run Ping Runtime in dev mode

```bash
pnpm dev:ping
```

### Run tests

```bash
pnpm test
```

---

## Deployment

### Option 1: Deploy Together

```bash
# Build all packages
pnpm build

# Deploy monorepo
docker build -t ping:latest .
```

### Option 2: Deploy Separately

```bash
# Build and deploy Team Builder
pnpm --filter @ping/team-builder build
docker build -f packages/team-builder/Dockerfile -t team-builder:latest .

# Build and deploy Ping Runtime
pnpm --filter @ping/runtime build
docker build -f packages/ping/Dockerfile -t ping-runtime:latest .
```

---

## Migration Plan

### Phase 1: Set Up Monorepo

1. Create monorepo structure
2. Configure pnpm workspaces
3. Create `@ping/shared` package
4. Move common types to `@ping/shared`

### Phase 2: Create Packages

1. Create `@ping/team-builder` package
2. Create `@ping/runtime` package
3. Move code to appropriate packages

### Phase 3: Migrate Current Code

1. Move `RoleManager.ts` to both packages (design & runtime modes)
2. Move `AgentManager.ts` to `@ping/runtime`
3. Move `MemoryManager.ts` to `@ping/runtime`
4. Move frontend to `@ping/runtime/src/ui`

### Phase 4: Implement Missing Features

1. Implement Team Service
2. Implement Artifact Store
3. Implement Approval System
4. Implement Role Manager Suggest & Build phases

---

## Related Documentation

- [Ping Vision](../ping/vision.md) - Product vision
- [Ping Architecture](../ping/architecture.md) - Technical architecture
- [Team Builder](../ping/team-builder.md) - Design mode details
- [Current State Mapping](./current-state-to-ping.md) - Migration from current code
