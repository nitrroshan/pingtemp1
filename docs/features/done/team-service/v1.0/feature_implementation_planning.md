# Team Service v1.0 - Implementation Planning

**Architecture:** Option A - Centralized Team Manager  
**Skills Integration:** Skills System v1.0 can be added later (not blocking)

---

## Version 1.0 - MVP Scope

**Goal:** Basic team management with Planner Agent, manager ownership, and agent delegation.

**What's Included:**
- Create/read/update/delete teams
- Automatic Planner Agent on team creation
- Add/remove worker agents
- Delegate/reclaim worker agents to/from employees
- Team member management (manager + employees)
- Workspace initialization (Git repo per team)
- Database schema with proper indexes and constraints

**What's NOT Included (Future Versions):**
- Team-level skill installation (v1.1)
- Cross-team agent sharing (Option D feature)
- Advanced team analytics/metrics
- Team templates
- Bulk agent operations
- Team archiving/restoration

**Skills Integration (Already Implemented):**
- `src/worker/skillRegistry/` provides full skill management
- `SkillIntegration.enhanceAgentWithSkills()` adds skill tools to agents
- `SkillIntegration.autoAssignSkillsForRole()` auto-assigns skills based on role
- Team Service v1.0 integrates with existing SkillRegistry
- Agents store `assignedSkills[]` in database
- Skills loaded progressively (metadata at startup, full content on-demand)

---

## Branch Strategy

- **Feature branch**: `feature/team-service-v1.0`
- **Merge to**: `main` (via PR after v1.0 complete)

---

## Implementation Steps

### Step 1: Database Schema (MongoDB) ✅
**Files to create:**
- `src/worker/database/collections/teams.ts`
- `src/worker/database/collections/agents.ts`
- `src/worker/database/collections/teamMembers.ts`
- `src/worker/database/indexes.ts`

**Note:** Using MongoDB for v1.0 (already configured). Plan for PostgreSQL migration in v2.0 if constraint enforcement or complex transactions needed.

**Collections:**
```typescript
// teams collection
interface Team {
  _id: ObjectId
  name: string
  ownerId: string                        // Manager (user ID)
  workspaceId: string                    // Git repo reference
  settings: {
    executionMode: 'sequential' | 'parallel' | 'hybrid'
    maxConcurrency: number
  }
  createdAt: Date
  updatedAt: Date
}

// agents collection
interface Agent {
  _id: ObjectId
  teamId: ObjectId                       // Reference to teams._id
  role: string                           // 'planner' | 'engineer' | 'designer' | ...
  type: 'planner' | 'worker'
  name: string
  ownedBy: string                        // Manager ID
  delegatedTo: string | null             // Employee ID or null
  
  // Agent Definition (stored as YAML text)
  definitionYaml: string                 // Full YAML from Team Builder
  
  // Lifecycle (database-driven sync)
  status: 'pending' | 'running' | 'stopped' | 'error'
  lastStartedAt: Date | null
  errorMessage: string | null
  
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

// teamMembers collection
interface TeamMember {
  _id: ObjectId
  teamId: ObjectId                       // Reference to teams._id
  userId: string
  role: 'manager' | 'employee'
  joinedAt: Date
}

// agentSkills collection (junction table)
interface AgentSkill {
  _id: ObjectId
  agentId: ObjectId                      // Reference to agents._id
  skillId: string                        // Reference to skills.skillId
  enabled: boolean                       // Runtime enable/disable
  assignedAt: Date
}
```

**Indexes (create on startup):**
```typescript
// src/worker/database/indexes.ts
export async function createIndexes(db: Db) {
  // Teams
  await db.collection('teams').createIndex({ ownerId: 1 })
  await db.collection('teams').createIndex({ createdAt: -1 })
  
  // Agents
  await db.collection('agents').createIndex({ teamId: 1 })
  await db.collection('agents').createIndex({ ownedBy: 1 })
  await db.collection('agents').createIndex({ delegatedTo: 1 })
  await db.collection('agents').createIndex({ type: 1 })
  await db.collection('agents').createIndex({ status: 1 })
  // Note: "one planner per team" enforced in code, not DB
  
  // Team Members
  await db.collection('teamMembers').createIndex({ teamId: 1, userId: 1 }, { unique: true })
  await db.collection('teamMembers').createIndex({ userId: 1 })
  
  // Agent Skills
  await db.collection('agentSkills').createIndex({ agentId: 1 })
  await db.collection('agentSkills').createIndex({ skillId: 1 })
  await db.collection('agentSkills').createIndex({ agentId: 1, skillId: 1 }, { unique: true })
}
```

**Constraint Enforcement (in code):**
```typescript
// TeamService.addAgent() - enforce one Planner per team
async addAgent(teamId: string, yaml: string, type: 'planner' | 'worker') {
  if (type === 'planner') {
    const existing = await db.agents.findOne({ teamId: new ObjectId(teamId), type: 'planner' })
    if (existing) throw new CannotAddSecondPlannerError(teamId)
  }
  // Create agent...
}

// TeamService.deleteTeam() - cascade delete manually
async deleteTeam(teamId: string) {
  const oid = new ObjectId(teamId)
  await db.agents.deleteMany({ teamId: oid })
  await db.teamMembers.deleteMany({ teamId: oid })
  await db.agentSkills.deleteMany({ agentId: { $in: agentIds } })
  await db.teams.deleteOne({ _id: oid })
}
```

**Testing:**
- Indexes created on startup
- Constraint enforcement works (one Planner per team)
- Cascade deletes work correctly
- Skills junction table queries efficient

---

### Step 2: TeamService Class ✅
**Files to create:**
- `src/worker/teamService/TeamService.ts`
- `src/worker/teamService/types/index.ts`

**TeamService interface:**
```typescript
import type { AgentDefinition } from '../agent/types.js'

interface ITeamService {
  // Team CRUD
  createTeam(params: CreateTeamParams): Promise<Team>
  getTeam(teamId: string): Promise<Team>
  listTeams(filters: TeamFilters): Promise<Team[]>
  updateTeam(teamId: string, updates: TeamUpdates): Promise<Team>
  deleteTeam(teamId: string): Promise<void>
  
  // Agent management (uses AgentFactory internally)
  addAgent(teamId: string, agentConfig: AgentConfig): Promise<Agent>
  removeAgent(teamId: string, agentId: string): Promise<void>
  delegateAgent(teamId: string, agentId: string, employeeId: string): Promise<Agent>
  reclaimAgent(teamId: string, agentId: string): Promise<Agent>
  
  // Skill management
  assignSkillToAgent(agentId: string, skillId: string): Promise<void>
  removeSkillFromAgent(agentId: string, skillId: string): Promise<void>
  autoAssignSkills(agentId: string, roleDescription: string): Promise<string[]>
  
  // Member management
  addMember(teamId: string, userId: string, role: 'employee'): Promise<void>
  removeMember(teamId: string, userId: string): Promise<void>
  
  // Workspace
  getWorkspace(teamId: string): Promise<WorkspaceInfo>
}

// Agent config for addAgent()
interface AgentConfig {
  name: string
  role: string
  definitionId?: string           // Use existing YAML definition
  definition?: AgentDefinition    // Or provide inline definition
  assignedSkills?: string[]       // Skills to assign
  autoAssignSkills?: boolean      // Auto-assign based on role
  roleDescription?: string        // For auto-assignment
}
```

**Implementation:**
- Database connection via Prisma/TypeORM
- Automatic Planner Agent creation in `createTeam()`
- Validation: cannot delegate/remove Planner Agent
- Cascade: removing member reclaims their delegated agents

**Testing:**
- Unit tests for each method
- Test Planner Agent auto-creation
- Test delegation/reclaim logic
- Test cascade operations

---

### Step 3: Database Integration ✅
**Files to create/modify:**
- `src/worker/database/schema.prisma` (if using Prisma)
- `src/worker/database/connection.ts`

**Tasks:**
- Set up database connection pool
- Configure environment variables (DATABASE_URL)
- Create database client singleton
- Add transaction support

**Testing:**
- Connection pooling works
- Transactions rollback on error
- Connection recovery after network issues

---

### Step 4: Team API Endpoints ✅
**Files to create:**
- `src/worker/api/routes/teams.ts`
- `src/worker/api/middleware/teamAuth.ts`

**Endpoints (Used by Orchestrator):**
```typescript
POST   /api/v1/teams                    // Create team
GET    /api/v1/teams/:id                // Get team
PUT    /api/v1/teams/:id                // Update team
DELETE /api/v1/teams/:id                // Delete team
GET    /api/v1/teams                    // List teams

POST   /api/v1/teams/:id/agents         // Add worker agent
DELETE /api/v1/teams/:id/agents/:agentId // Remove agent
POST   /api/v1/teams/:id/agents/:agentId/delegate   // Delegate
POST   /api/v1/teams/:id/agents/:agentId/reclaim    // Reclaim

POST   /api/v1/teams/:id/members        // Add employee
DELETE /api/v1/teams/:id/members/:userId // Remove employee

GET    /api/v1/teams/:id/workspace      // Get workspace info
```

**Middleware:**
- Authentication (verify API token)
- Team membership validation
- Manager-only operations (delegate/reclaim)

**Testing:**
- Integration tests for all endpoints
- Test auth middleware
- Test error responses (404, 403, 400)
- Test Orchestrator workflow

---

### Step 5: Orchestrator Integration ✅
**Files to modify:**
- `src/worker/agentManager/AgentManager.ts`

**Changes:**
- Add `AgentFactory` for creating IAgent instances
- Add `teamService` dependency for database operations
- Update `executeGoal()` to accept `teamId`
- Integrate with SkillIntegration for skill-enhanced agents

**Implementation:**
```typescript
import { AgentFactory } from '../agent/AgentFactory.js'
import { enhanceAgentWithSkills, autoAssignSkillsForRole } from '../skillRegistry/SkillIntegration.js'
import type { AgentDefinition, IAgent } from '../agent/types.js'

class AgentManager {
  private agentFactory: AgentFactory
  private agentInstances: Map<string, IAgent> = new Map()
  
  constructor(
    private teamService: TeamService,
    private memoryManager: MemoryManager,
    agentsDir: string = './agents'
  ) {
    this.agentFactory = new AgentFactory(agentsDir)
  }
  
  async executeGoal(teamId: string, goal: string) {
    // Get team with all agents from database
    const team = await this.teamService.getTeam(teamId)
    
    // Get Planner Agent record (guaranteed to exist)
    const plannerRecord = team.agents.find(a => a.type === 'planner')
    
    // Get or create IAgent instance via AgentFactory
    const planner = await this.getOrCreateAgent(plannerRecord)
    
    // Route goal to Planner (Planner creates tasks, assigns to workers)
    await this.routeToPlanner(planner, goal)
  }
  
  async getOrCreateAgent(agentRecord: AgentRecord): Promise<IAgent> {
    // Return cached instance if exists
    if (this.agentInstances.has(agentRecord.id)) {
      return this.agentInstances.get(agentRecord.id)!
    }
    
    // Build AgentDefinition from database record
    const definition = this.buildDefinition(agentRecord)
    
    // Create IAgent instance via AgentFactory
    const agent = this.agentFactory.create(definition)
    
    // Enhance with skills (adds skill tools to agent)
    await this.enhanceWithSkills(agent, agentRecord)
    
    // Initialize agent
    await agent.initialize()
    
    this.agentInstances.set(agentRecord.id, agent)
    return agent
  }
  
  private buildDefinition(agentRecord: AgentRecord): AgentDefinition {
    // Use YAML definition if specified
    if (agentRecord.definitionId) {
      return this.agentFactory.loader.load(agentRecord.definitionId)
    }
    
    // Use inline definition if provided
    if (agentRecord.definition) {
      return agentRecord.definition
    }
    
    // Build minimal definition from database fields
    return {
      id: agentRecord.id,
      name: agentRecord.name,
      role: agentRecord.role,
      type: 'internal',
      goal: `Execute tasks as ${agentRecord.role}`,
      config: {
        model: { provider: 'azure-openai', deployment: 'gpt-4o-2' },
        skills: agentRecord.assignedSkills
      }
    }
  }
  
  private async enhanceWithSkills(agent: IAgent, agentRecord: AgentRecord): Promise<void> {
    if (agentRecord.assignedSkills?.length > 0) {
      const enhanced = await enhanceAgentWithSkills({
        systemPrompt: agent.definition.systemPrompt || '',
        tools: agent.definition.config?.tools || [],
        preloadMetadata: agentRecord.assignedSkills,
        agentId: agentRecord.id
      })
      // Apply enhanced config to agent
      agent.definition.systemPrompt = enhanced.systemPrompt
      agent.definition.config.tools = enhanced.tools
    }
  }
}
```

**Testing:**
- Test AgentFactory creates IAgent instances correctly
- Test skill enhancement adds skill tools
- Test goal routing to Planner Agent
- Test agent instance caching

---

### Step 6: Team Builder Integration ✅
**Files to modify:**
- `src/worker/roleManager/RoleManager.ts`

**Changes:**
- After designing agents, publish YAML config with AgentDefinition format
- Orchestrator reads YAML and creates agents via AgentFactory
- Optionally auto-assign skills based on role description

**Flow:**
```typescript
import type { AgentDefinition } from '../agent/types.js'
import { autoAssignSkillsForRole } from '../skillRegistry/SkillIntegration.js'
import { parse } from 'yaml'

// Team Builder publishes YAML with AgentDefinition format
// Example: mobile-app-team.yaml
//
// teamName: Mobile App Team
// ownerId: user-123
// agents:
//   - name: Alex (Engineer)
//     role: engineer
//     definitionId: backend-engineer
//     assignedSkills:
//       - api-development
//       - database-design

// Orchestrator reads YAML and parses it
const yamlContent = await fs.readFile('mobile-app-team.yaml', 'utf-8')
const teamConfig = parse(yamlContent)

// Create team
const team = await teamService.createTeam({
  name: teamConfig.teamName,
  ownerId: teamConfig.ownerId
})

// Create each agent
for (const agentConfig of teamConfig.agents) {
  const agent = await teamService.addAgent(team.id, {
    name: agentConfig.name,
    role: agentConfig.role,
    definitionId: agentConfig.definitionId,
    definition: agentConfig.definition,
    assignedSkills: agentConfig.assignedSkills
  })
  
  // Auto-assign skills based on role description
  if (agentConfig.autoAssignSkills && agentConfig.roleDescription) {
    await autoAssignSkillsForRole(
      agent.id,
      agentConfig.roleDescription,
      3  // max skills
    )
  }
}
```

**Testing:**
- Test Team Builder → Orchestrator → TeamService → AgentFactory flow
- Verify Planner Agent auto-created
- Verify worker agents created with correct AgentDefinition
- Test auto-skill assignment finds relevant skills

---

### Step 7: Workspace Initialization ✅
**Files to create:**
- `src/worker/workspace/WorkspaceManager.ts`

**Tasks:**
- Create Git repository per team
- Initialize folder structure (docs/, code/, designs/, data/)
- Store workspace reference in Team table
- Handle workspace cleanup on team deletion

**Implementation:**
```typescript
class WorkspaceManager {
  async createWorkspace(teamId: string): Promise<string> {
    // Create Git repo
    const workspaceId = `workspace-${teamId}`
    await this.initGitRepo(workspaceId)
    
    // Create folders
    await this.createFolders(workspaceId, [
      'docs',
      'code',
      'designs',
      'data'
    ])
    
    return workspaceId
  }
}
```

**Testing:**
- Workspace created with correct structure
- Git initialized properly
- Workspace deleted when team deleted

---

### Step 8: Error Handling & Validation ✅
**Files to create:**
- `src/worker/teamService/errors.ts`
- `src/worker/teamService/validators.ts`

**Error types:**
```typescript
class TeamNotFoundError extends Error {}
class AgentNotFoundError extends Error {}
class CannotDelegatePlannerError extends Error {}
class CannotRemovePlannerError extends Error {}
class NotTeamManagerError extends Error {}
class AgentAlreadyDelegatedError extends Error {}
```

**Validations:**
- Team name not empty
- Agent role valid
- User has permission for operation
- Planner Agent cannot be delegated/removed

**Testing:**
- Test each error case
- Verify HTTP status codes (404, 403, 400)

---

## Migration Strategy

**From current state:**
1. Run database migrations
2. Deploy TeamService alongside existing code
3. Update Orchestrator to use TeamService for new teams
4. Existing in-memory teams continue to work
5. Gradual migration of old teams to database

**Rollback plan:**
- Keep old team creation code
- Feature flag: `USE_TEAM_SERVICE=true/false`
- If issues, flip flag to false

---

## Testing Strategy

**Unit Tests:**
- TeamService methods (90%+ coverage)
- Validators
- Error handling

**Integration Tests:**
- API endpoints
- Database operations
- Orchestrator integration

**E2E Tests:**
- Team Builder → Create team → Give goal → Execute
- Delegate agent → Employee executes task
- Remove member → Agents reclaimed

---

## Performance Considerations

**Database:**
- Indexes on frequently queried fields
- Connection pooling (10-20 connections)
- Query optimization (N+1 prevention)

**Caching:**
- Cache team metadata (5 min TTL)
- Invalidate on updates
- Redis for distributed caching

**Scalability:**
- Teams independent (can shard by teamId)
- Read replicas for heavy read operations

---

## Security Considerations

**Authentication:**
- API key for Orchestrator
- JWT for user operations

**Authorization:**
- Manager-only: delegate, reclaim, delete team
- Team member: view team, give goals
- Non-member: no access

**Data Protection:**
- No sensitive data in logs
- Encrypt workspace credentials
- Audit log for all operations

---

## Documentation

**To create:**
- API documentation (OpenAPI spec)
- TeamService usage guide
- Database schema documentation
- Migration guide for existing teams

---

## Dependencies

**Required:**
- Database (MongoDB 6+) - already configured
- Git (for workspace management)
- Node.js 18+ (for async/await)

**NPM packages:**
- mongodb (native driver, already installed)
- simple-git (Git operations)
- express (API endpoints)
- zod (validation)

**Future (v2.0):**
- PostgreSQL (if constraint enforcement or complex transactions needed)
- Prisma (for PostgreSQL ORM)

---

## Estimated Timeline

- Step 1: Database Schema - 0.5 day
- Step 2: TeamService Class - 1 day
- Step 3: Database Integration - 0.5 day
- Step 4: API Endpoints - 1 day
- Step 5: Orchestrator Integration - 0.5 day
- Step 6: Team Builder Integration - 0.5 day
- Step 7: Workspace Initialization - 0.5 day
- Step 8: Error Handling - 0.5 day
- Testing & Bug Fixes - 1 day

**Total: 6 days** (matches architecture estimate of 3-4 days coding + 2 days testing)

**Note:** Skills System v1.0 (7.5 days) can be developed in parallel or after Team Service v1.0. See [Skills System Implementation Planning](../../skills-system/v1.0/feature_implementation_planning.md).

---

## Success Criteria

- [ ] Teams can be created via Team Builder
- [ ] Planner Agent automatically added to every team
- [ ] Worker agents can be added/removed
- [ ] Agents can be delegated to employees
- [ ] Manager can reclaim delegated agents
- [ ] Workspace initialized with correct structure
- [ ] All database constraints enforced
- [ ] API returns proper error codes
- [ ] Integration tests pass (95%+ coverage)
- [ ] E2E flow works: Design agents → Create team → Give goal → Execute
- [ ] **AgentFactory integration**: IAgent instances created from AgentDefinition
- [ ] **Skills integration**: Skills can be assigned to agents via SkillRegistry
- [ ] **Auto-assign skills**: `autoAssignSkillsForRole()` finds relevant skills
- [ ] **Skill enhancement**: `enhanceAgentWithSkills()` adds skill tools to agents

---

## Next Steps After v1.0

**v1.1 - Enhanced Skills Integration:**
Skills System already implemented in `src/worker/skillRegistry/`. Enhancements:
- Team-level skill installation (all agents inherit)
- UI for browsing/installing skills from registry
- Skill usage analytics per team

**v1.2 - Role Templates:**
- Official role templates (Frontend Dev, Backend Dev, QA)
- Templates reference AgentDefinition YAML files
- Team Builder suggests templates during agent design
- UI for creating agents from templates

**v1.3 - Team Enhancements:**
- Team templates (preset agent configurations)
- Advanced team analytics/metrics
- Bulk agent operations

**v2.0 - Cross-Team Collaboration (Option D):**
- Migrate to Option D (Hybrid architecture)
- Agent sharing across teams
- Cross-team goal coordination
- GitHub skill integration
- Skill marketplace

See [Team Service Architecture](../feature_architecture.md) for full roadmap.
- Bulk agent operations (add/remove multiple)
- Team metrics (goals completed, artifacts created)

**v2.0 - Cross-Team Collaboration:**
- Migrate to Option D (Hybrid architecture)
- Agent sharing across teams
- Cross-team goal coordination
