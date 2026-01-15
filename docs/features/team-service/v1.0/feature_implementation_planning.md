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
- **Skills System integration** (v1.0 uses full agent configs, Skills added later via migration)
- Cross-team agent sharing (Option D feature)
- Advanced team analytics/metrics
- Team templates
- Bulk agent operations
- Team archiving/restoration

**Skills System Compatibility:**
- Team Service v1.0 creates teams with agents using **full configs** (tools, prompts embedded)
- Skills System v1.0 (implemented after) will **migrate** these configs to portable skills
- Migration script extracts common tool patterns → creates skills → assigns to agents
- No architectural changes needed (Skills layer sits on top)

---

## Branch Strategy

- **Feature branch**: `feature/team-service-v1.0`
- **Merge to**: `main` (via PR after v1.0 complete)

---

## Implementation Steps

### Step 1: Database Schema & Migrations ✅
**Files to create:**
- `src/worker/database/migrations/001_create_teams.sql`
- `src/worker/database/migrations/002_create_agents.sql`
- `src/worker/database/migrations/003_create_team_members.sql`

**Schema:**
```sql
-- Team table
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  settings JSONB DEFAULT '{"executionMode": "parallel", "maxConcurrency": 3}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('planner', 'worker')),
  name VARCHAR(255) NOT NULL,
  owned_by UUID NOT NULL,
  delegated_to UUID,
  capabilities TEXT[] DEFAULT '{}',
  mcp_servers TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Team members table
CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('manager', 'employee')),
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Indexes
CREATE INDEX idx_teams_owner ON teams(owner_id);
CREATE INDEX idx_teams_created ON teams(created_at DESC);
CREATE INDEX idx_agents_team ON agents(team_id);
CREATE INDEX idx_agents_owner ON agents(owned_by);
CREATE INDEX idx_agents_delegated ON agents(delegated_to);
CREATE INDEX idx_agents_type ON agents(type);
CREATE UNIQUE INDEX idx_one_planner_per_team ON agents(team_id, type) WHERE type = 'planner';
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
```

**Testing:**
- Run migrations on test database
- Verify constraints (one Planner per team, valid types)
- Test cascade deletes

---

### Step 2: TeamService Class ✅
**Files to create:**
- `src/worker/teamService/TeamService.ts`
- `src/worker/teamService/types/index.ts`

**TeamService interface:**
```typescript
interface ITeamService {
  // Team CRUD
  createTeam(params: CreateTeamParams): Promise<Team>
  getTeam(teamId: string): Promise<Team>
  listTeams(filters: TeamFilters): Promise<Team[]>
  updateTeam(teamId: string, updates: TeamUpdates): Promise<Team>
  deleteTeam(teamId: string): Promise<void>
  
  // Agent management
  addAgent(teamId: string, agentConfig: AgentConfig): Promise<Agent>
  removeAgent(teamId: string, agentId: string): Promise<void>
  delegateAgent(teamId: string, agentId: string, employeeId: string): Promise<Agent>
  reclaimAgent(teamId: string, agentId: string): Promise<Agent>
  
  // Member management
  addMember(teamId: string, userId: string, role: 'employee'): Promise<void>
  removeMember(teamId: string, userId: string): Promise<void>
  
  // Workspace
  getWorkspace(teamId: string): Promise<WorkspaceInfo>
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
- Add `teamService` dependency
- Update `executeGoal()` to accept `teamId` instead of bare agents
- Retrieve team and agents via `teamService.getTeam(teamId)`
- Route goal to team's Planner Agent

**Implementation:**
```typescript
class AgentManager {
  constructor(
    private teamService: TeamService,
    private memoryManager: MemoryManager
  ) {}
  
  async executeGoal(teamId: string, goal: string) {
    // Get team with all agents
    const team = await this.teamService.getTeam(teamId)
    
    // Get Planner Agent (guaranteed to exist)
    const plannerAgent = team.agents.find(a => a.type === 'planner')
    
    // Route goal to Planner
    await this.routeToPlanner(plannerAgent, goal)
    
    // Planner creates tasks and assigns to workers
    // (existing AgentManager logic continues)
  }
}
```

**Testing:**
- Test goal routing to Planner Agent
- Test with teams that have different worker agents
- Test delegation doesn't affect execution

---

### Step 6: Team Builder Integration ✅
**Files to modify:**
- `src/worker/roleManager/RoleManager.ts`

**Changes:**
- After designing agents, publish JSON config
- Orchestrator reads JSON and calls `teamService.createTeam()`

**Flow:**
```typescript
// Team Builder publishes JSON
const teamConfig = {
  teamName: 'Mobile App Team',
  ownerId: 'user-123',
  agents: [
    { role: 'engineer', capabilities: [...], mcpServers: [...] },
    { role: 'designer', capabilities: [...], mcpServers: [...] }
  ]
}

// Orchestrator reads and creates team
const team = await teamService.createTeam({
  name: teamConfig.teamName,
  ownerId: teamConfig.ownerId,
  agents: teamConfig.agents  // Worker agents only, Planner auto-added
})
```

**Testing:**
- Test Team Builder → Orchestrator → TeamService flow
- Verify Planner Agent auto-created
- Verify worker agents created with correct config

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
- Database (PostgreSQL 14+)
- Git (for workspace management)
- Node.js 18+ (for async/await)

**NPM packages:**
- Prisma or TypeORM (database ORM)
- simple-git (Git operations)
- express (API endpoints)
- joi or zod (validation)

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
- [ ] **Skills compatibility**: Agent configs structured for future Skills migration

---

## Next Steps After v1.0

**v1.1 - Skills System Integration:**
- Implement Skills System v1.0 (7.5 days, see [Skills Planning](../../skills-system/v1.0/feature_implementation_planning.md))
- Run migration script to convert agent configs → skills
- Update TeamService to support skill installation
- Update API to handle skill-based agent creation
- Progressive disclosure optimization (8x context reduction)

**v1.2 - Role Templates:**
- Official role templates (Frontend Dev, Backend Dev, QA)
- Team Builder suggests templates during agent design
- UI for creating agents from templates

**v1.3 - Team Enhancements:**
- Team templates (preset agent configurations)
- Advanced team analytics/metrics
- Bulk agent operations

**v2.0 - Cross-Team Collaboration (Option D):**
- Agent sharing across teams
- GitHub skill integration
- Skill marketplace

See [Team Service Architecture](../feature_architecture.md) for full roadmap.
- Bulk agent operations (add/remove multiple)
- Team metrics (goals completed, artifacts created)

**v2.0 - Cross-Team Collaboration:**
- Migrate to Option D (Hybrid architecture)
- Agent sharing across teams
- Cross-team goal coordination
