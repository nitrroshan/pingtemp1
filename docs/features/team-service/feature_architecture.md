# Team Service Architecture

**Feature:** Team management with Planner Agent, manager ownership, and delegation model

---

## Overview

Team Service provides the foundational execution boundary for Ping. Each team:
- Has one manager (owner)
- Automatically includes one Planner Agent (system-added, helps with tasks/artifacts/agents)
- Contains worker agents designed by Team Builder that collaborate with humans (can be delegated to employees)
- Has an isolated workspace (docs/, code/, designs/, data/)
- Executes goals through human-agent collaboration coordinated by Planner Agent

**Core Flow:**
```
Manager talks to Team Builder (Role Manager)
  → Team Builder helps design worker agents conversationally
  → Team Builder publishes agent configs as JSON
  → Orchestrator reads JSON and creates team
  → System automatically adds Planner Agent to team
  → Orchestrator starts worker agents
  → Manager gives goal to team
  → Planner Agent helps break down goal into tasks
  → Planner Agent manages task assignments to worker agents
  → Worker agents collaborate with humans to execute tasks
  → Artifacts saved to workspace
```

---

## Architecture Options

### Option A: Centralized Team Manager (Recommended)

**Implementation:**
- Single `TeamService` class manages all team operations
- Teams stored in database with ownership tracking
- Planner Agent automatically added on team creation (system agent, helps with tasks/artifacts)
- Agent delegation tracked via `delegatedTo` field (Planner Agent cannot be delegated)
- Workspace created automatically (Git repository per team)

**Database Schema:**
```typescript
Team {
  id: string
  name: string
  ownerId: string              // Manager (user ID)
  createdAt: timestamp
  updatedAt: timestamp
  workspaceId: string          // Git repo reference
  settings: {
    executionMode: 'sequential' | 'parallel' | 'hybrid'
    maxConcurrency: number
  }
}

Agent {
  id: string
  teamId: string
  role: string                 // 'planner' | 'engineer' | 'designer' | ...
  type: 'planner' | 'worker'
  name: string
  ownedBy: string              // Manager ID
  delegatedTo: string?         // Employee ID or null
  capabilities: string[]
  mcpServers: string[]         // Linked MCP tool servers
  createdAt: timestamp
  isActive: boolean
}

TeamMember {
  teamId: string
  userId: string
  role: 'manager' | 'employee'
  joinedAt: timestamp
}
```

**API Integration (Used by Orchestrator):**
- POST /teams → Orchestrator calls after reading Team Builder's JSON
- GET /teams/:id → Retrieve team with agents (ownership info)
- POST /teams/:id/agents → Orchestrator calls to add agent from Team Builder
- POST /teams/:id/agents/:id/delegate → Manager/UI calls to delegate to employee
- POST /teams/:id/agents/:id/reclaim → Manager/UI calls to reclaim from employee
- DELETE /teams/:id/agents/:id → Remove agent (403 for Planner)

**Pros:**
- Clean separation of concerns (team management vs execution)
- Easy to enforce business rules (one Planner per team, cannot delegate Planner)
- Ownership tracking straightforward (ownedBy, delegatedTo fields)
- Database queries efficient (indexed on teamId, ownerId)
- Scalable (teams independent, can shard by teamId)

**Cons:**
- Additional abstraction layer (TeamService + AgentManager)
- Two database tables (Team + Agent) instead of one
- Need to coordinate team creation with workspace initialization

**Effort:** Medium (3-4 days)
- Database schema and migrations
- TeamService implementation
- Team CRUD endpoints
- Agent delegation logic
- Workspace initialization integration
- Unit and integration tests

**AgentManager Integration:**
```typescript
// Option A: AgentManager uses TeamService for clean team access
class AgentManager {
  async executeGoal(teamId: string, goal: string) {
    // Get team with all agents
    const team = await teamService.getTeam(teamId)
    
    // Planner Agent guaranteed to exist
    const planner = team.agents.find(a => a.type === 'planner')
    
    // Route goal to Planner
    await this.routeToAgent(planner, goal)
    
    // Get worker agents
    const workers = team.agents.filter(a => a.type === 'worker')
    // Execute tasks with workers...
  }
  
  async addAgent(teamId: string, agentConfig: AgentConfig) {
    // Validate team exists, then add agent
    const agent = await teamService.addAgent(teamId, agentConfig)
    // Start agent...
  }
}
```

**Benefits:**
- Single call to get team and all agents
- Team validation automatic (404 if team doesn't exist)
- Planner Agent guaranteed by TeamService
- Workspace reference on Team entity
- Clean separation: TeamService = data, AgentManager = execution

---

### Option B: Agent-Centric / Notion-Style (Teams as Tagged Collections)

**Implementation:**
- No explicit Team entity - teams are just tagged agent collections (like Notion pages with tags)
- Agents have `teamTag` field and `isPlanner` boolean
- Team operations are agent queries (get all agents with teamTag)
- Workspace reference stored on Planner Agent
- Flexible: agents can be "re-tagged" to different teams (like moving Notion pages)

**Philosophy:**
Similar to Notion's flexible database model where:
- No rigid folders/hierarchies
- Tags determine grouping
- Queries create views
- Maximum flexibility, application-enforced rules

**Database Schema:**
```typescript
Agent {
  id: string
  teamTag: string              // Group agents into "team"
  isPlanner: boolean           // True for Planner Agent
  ownedBy: string
  delegatedTo: string?
  workspaceId: string?         // Only on Planner Agent
  capabilities: string[]
}
```

**Pros:**
- Simpler database (one table)
- Fewer abstractions (just agents)
- **Maximum flexibility** - agents can be "re-teamed" instantly (change teamTag)
- **Notion-style power** - complex queries possible (find agents by multiple tags, capabilities)
- No migration needed when restructuring teams

**Cons (Explained with Examples):**

1. **Same issues as Notion: Flexibility = complexity in enforcement**
   - Notion lets you do anything (move blocks, change tags) but can't enforce rules
   - Example: In Notion, you can accidentally delete a parent page and orphan child blocks
   - In Ping: You could accidentally change an agent's teamTag and break workspace references

2. **Team concept not explicit (harder to enforce "one Planner" rule)**
   - No Team table means no place to enforce "each team must have exactly one Planner"
   - Database can't enforce: "Only one agent with teamTag='backend-team' AND isPlanner=true"
   - You'd need application code: `if (planners.length !== 1) throw error`
   - Example problem: Bug creates 2 Planners for same team → system breaks, no database protection

3. **No clear team ownership model (who owns the "team"?)**
   - Team is just a tag ("backend-team") - tags don't have owners
   - Example question: "Who can delete the backend-team?" → No answer in database
   - Must check: "Find any agent with teamTag='backend-team', get ownedBy" → messy
   - Example problem: Engineer A owns agent 1, Engineer B owns agent 2, both have teamTag='backend-team'
     - Who owns the "team"? First agent creator? Arbitrary!

4. **Workspace management unclear (which agent stores workspace reference?)**
   - Workspace belongs to team, but team doesn't exist as entity
   - Must store workspaceId on Planner Agent (one specific agent)
   - Example problem: If Planner Agent deleted → workspace reference lost
   - Must write code: "Always store workspace on Planner, never delete Planner without cleanup"

5. **Hard to enforce delegation rules (can't prevent Planner delegation)**
   - Want rule: "Planner Agent cannot be delegated"
   - Database can't enforce: "If isPlanner=true, then delegatedTo must be null"
   - Must write code in every delegation function to check isPlanner first
   - Example problem: Developer forgets check in new delegation API → Planner gets delegated → chaos

6. **Difficult to add team-level settings (execution mode, max concurrency)**
   - Settings like "run tasks sequentially" apply to whole team
   - No Team table → where to store team settings?
   - Options (all messy):
     - Store on Planner Agent (weird, settings aren't agent properties)
     - Store on every agent (duplicated data, inconsistency risk)
     - Create separate TeamSettings table with teamTag (now you need Team entity anyway!)

7. **Query complexity (find all agents with teamTag, filter by isPlanner, check delegatedTo)**
   ```sql
   -- Option A (with Team table): Simple
   SELECT * FROM teams WHERE id = 'team-123';  -- Done!
   
   -- Option B (tags only): Complex
   SELECT * FROM agents WHERE teamTag = 'backend-team';  -- Gets agents
   -- Then in application code:
   const planner = agents.find(a => a.isPlanner);  // Find Planner
   if (!planner) throw error;  // Check exists
   const workspace = planner.workspaceId;  // Get workspace
   // Repeat this logic everywhere you need team info
   ```

8. **Application-level enforcement needed (can't use database constraints)**
   - Database constraints are automatic, always enforced
   - Application code can have bugs, be bypassed
   - Example:
     ```sql
     -- Option A: Database enforces this ALWAYS
     CREATE UNIQUE INDEX idx_one_planner 
       ON agents(teamId, type) 
       WHERE type = 'planner';
     -- Try to create 2nd Planner → Database blocks it automatically
     
     -- Option B: Must enforce in code
     async function addAgent(teamTag, agent) {
       if (agent.isPlanner) {
         const existingPlanners = await findPlanners(teamTag);
         if (existingPlanners.length > 0) {
           throw new Error('Team already has Planner');
         }
       }
       // Bug: What if 2 requests run simultaneously? → 2 Planners created!
     }
     ```

**Summary:**
Option B trades **database guarantees** for **flexibility**. Like Notion, you can do anything, but the system can't protect you from mistakes. You must write careful application code to enforce every rule that the database would enforce automatically in Option A.

**AgentManager Integration:**
```typescript
// Option B: AgentManager queries agents by teamTag
class AgentManager {
  async executeGoal(teamTag: string, goal: string) {
    // Query all agents with teamTag
    const agents = await db.agents.findAll({ where: { teamTag } })
    
    // Find Planner Agent
    const planner = agents.find(a => a.isPlanner)
    if (!planner) throw new Error('No Planner Agent found')
    
    // Route goal to Planner
    await this.routeToAgent(planner, goal)
    
    // Get worker agents
    const workers = agents.filter(a => !a.isPlanner)
    // Execute tasks with workers...
  }
  
  async addAgent(teamTag: string, agentConfig: AgentConfig) {
    // Create agent with teamTag
    const agent = await db.agents.create({
      ...agentConfig,
      teamTag,
      isPlanner: false
    })
    // Start agent...
  }
}
```

**Issues:**
- Every operation requires querying agents by teamTag first
- No single "team" entity to validate against
- Workspace reference must be retrieved from Planner Agent
- Team-level operations (like "get all teams for user") require grouping agents
- Enforcing "one Planner per team" needs application-level checks

**Effort:** Low (2-3 days)
- Add teamTag field to Agent table
- Update agent queries
- Add team-level API wrapper

---

### Option C: Team as AgentManager Instance

**Implementation:**
- Each team has its own AgentManager instance
- AgentManager stores team metadata
- Planner Agent created in AgentManager constructor
- Worker agents added via AgentManager.addAgent()

**In-Memory Structure:**
```typescript
class AgentManager {
  teamId: string
  ownerId: string
  plannerAgent: Agent          // Always present
  workerAgents: Agent[]
  workspace: WorkspaceRef
  
  constructor(teamId, ownerId) {
    this.plannerAgent = new Agent({ role: 'planner', type: 'planner' })
    this.workerAgents = []
  }
  
  addAgent(agent) { ... }
  delegateAgent(agentId, employeeId) { ... }
  giveGoal(goal) { ... }       // Routes to Planner Agent
}
```

**Pros:**
- Team lifecycle tied to AgentManager instance
- Natural enforcement of "one Planner per team"
- AgentManager already orchestrates agents
- Team operations just call AgentManager methods

**Cons:**
- AgentManager becomes stateful (currently mostly stateless)
- One AgentManager instance per team (memory overhead)
- Need persistent storage anyway (can't just use in-memory)
- AgentManager lifecycle management complex (when to create/destroy instances)
- Mixing orchestration logic with team management

**Effort:** High (5-6 days)
- Refactor AgentManager to be instantiable
- Add team metadata to AgentManager
- Implement instance lifecycle management
- Add persistence layer
- Update all AgentManager callers

---

### Option D: Hybrid / Notion-Style (Structured Teams + Flexible Agents)

**Implementation:**
- Team entity exists (structured like Notion Page)
- Agents are flexible (like Notion Blocks within a page)
- Agents can have multiple tags for cross-team collaboration
- Team has primary agents, but agents can be shared/referenced across teams

**Philosophy:**
Like Notion's dual model:
- **Pages** = Teams (structured, clear ownership, workspace)
- **Blocks** = Agents (flexible, reusable, can be synced/referenced across pages)
- Best of both: Structure + Flexibility

**Database Schema:**
```typescript
Team {
  id: string
  name: string
  ownerId: string
  workspaceId: string
  settings: { ... }
  createdAt: timestamp
}

Agent {
  id: string
  primaryTeamId: string        // Primary team (like Notion block's parent page)
  sharedWithTeams: string[]    // Teams this agent is shared with
  tags: string[]               // Flexible tags for organization
  type: 'planner' | 'worker'
  ownedBy: string
  delegatedTo: string?
  capabilities: string[]
  mcpServers: string[]
}

AgentReference {
  teamId: string               // Team that references this agent
  agentId: string              // Agent being referenced
  referenceType: 'primary' | 'shared'
  createdAt: timestamp
}
```

**Pros:**
- **Structured teams** (clear ownership, workspace, settings)
- **Flexible agents** (can be shared across teams)
- **Notion-style power** (query by tags, capabilities, team membership)
- **Cross-team collaboration** (agents can work on multiple teams)
- **Clear primary ownership** (agent belongs to one team primarily)
- Database enforces team existence, application handles agent sharing

**Cons:**
- More complex schema (3 tables instead of 2)
- Sharing logic needs careful implementation (what happens when primary team deleted?)
- Need to manage agent references (cascade updates)
- More complex queries (JOIN AgentReference for shared agents)

**AgentManager Integration:**
```typescript
// Option D: Hybrid approach with primary and shared agents
class AgentManager {
  async executeGoal(teamId: string, goal: string) {
    // Get team
    const team = await teamService.getTeam(teamId)
    
    // Get primary + shared agents
    const allAgents = await teamService.getTeamAgents(teamId) // Includes shared
    
    // Planner Agent (always primary to this team)
    const planner = allAgents.find(a => a.type === 'planner')
    
    // Route goal to Planner
    await this.routeToAgent(planner, goal)
    
    // Workers can be primary or shared
    const workers = allAgents.filter(a => a.type === 'worker')
    // Execute tasks...
  }
  
  async shareAgent(agentId: string, targetTeamId: string) {
    // Share agent with another team (like syncing Notion block)
    await teamService.shareAgentWithTeam(agentId, targetTeamId)
  }
}
```

**Use Cases:**
- **Senior engineer shared across teams** (primary: Backend Team, shared: Mobile Team, DevOps Team)
- **Security specialist** (works with multiple teams on audits)
- **Design system agent** (shared by all product teams)
- Like Notion: sync block across multiple pages

**Effort:** High (5-6 days)
- Database schema (Team, Agent, AgentReference)
- TeamService with sharing logic
- Reference management (cascade, cleanup)
- Shared agent queries
- UI for cross-team collaboration
- Unit and integration tests

---

## Recommendation

**Option A: Centralized Team Manager** OR **Option D: Hybrid**

**Choose A if:**
- Teams are independent (no cross-team agents)
- Simple, clear boundaries
- Enforce strict isolation

**Choose D if:**
- Agents collaborate across teams (like senior engineers)
- Need Notion-style flexibility
- Want structured teams + flexible agents

**Why Option A:**
1. **Clear ownership model** - Database enforces manager ownership, delegation tracking explicit
2. **Planner Agent rules enforceable** - Special `type: 'planner'` field, cannot delegate via database constraint
3. **Scalable** - Teams independent, can shard by teamId
4. **Clean separation** - TeamService manages team lifecycle, AgentManager orchestrates execution
5. **Database-backed** - Persistent, queryable, indexable
6. **Team-level settings** - Execution mode, max concurrency easily added
7. **Workspace integration** - Team → Workspace mapping clear
8. **Simplest to implement** - No cross-team complexity

**Why Option D (if needed):**
1. **All benefits of Option A** PLUS agent sharing
2. **Cross-team collaboration** - Senior agents work on multiple teams
3. **Notion-style flexibility** - Structure + Flexibility
4. **Gradual adoption** - Start with isolated teams, add sharing later

**Trade-offs:**
- Additional abstraction layer (acceptable for clean architecture)
- Two tables instead of one (acceptable for data integrity)

**Implementation Priority:**
1. Database schema (Team, Agent, TeamMember tables)
2. TeamService class (CRUD operations)
3. Team API endpoints
4. Agent delegation logic
5. Integration with AgentManager (team → goal execution)
6. Workspace initialization

---

## Integration Points

### With AgentManager (Orchestrator)
- Team Builder publishes agent configs as JSON
- Orchestrator (AgentManager/TeamService) reads JSON
- Orchestrator creates team and agents via TeamService
- Orchestrator starts agents (initializes LangGraph instances, connects MCP tools)
- When user gives goal: `Orchestrator.executeGoal(teamId, goal)`
  → Orchestrator retrieves team's Planner Agent
  → Routes goal to Planner Agent
  → Planner Agent helps break down and coordinate
  → Orchestrator manages human-agent collaboration for task execution

### With RoleManager (Team Builder)
- **Team creation flow**:
  - User talks to Team Builder conversationally
  - Team Builder designs worker agents based on requirements
  - Team Builder publishes agent configs as JSON
  - Orchestrator reads JSON and calls TeamService.createTeam(name, ownerId, workerAgentConfigs)
  - TeamService creates team + system adds Planner Agent + creates worker agents
  - Orchestrator starts worker agents
- **Adding agents later**:
  - User asks Team Builder to add agent
  - Team Builder designs worker agent conversationally
  - Team Builder publishes agent config as JSON
  - Orchestrator reads JSON and calls TeamService.addAgent(teamId, workerAgentConfig)
  - Agent stored with `ownedBy: managerId, delegatedTo: null`
  - Orchestrator starts new agent

### With MemoryManager
- Each goal execution creates tasks in MemoryManager
- Tasks reference `teamId` and `goalId`
- MemoryManager tracks task ownership (which agent assigned)

### With Workspace/Artifact Store
- Team creation triggers workspace creation (Git repo)
- Workspace structure: docs/, code/, designs/, data/
- Artifacts reference `teamId`, `goalId`, `taskId`

---

## Data Flow

### Team Creation
```
User talks to Team Builder: "I need a team for mobile app development"
  → Team Builder (Role Manager): "What agents do you need?"
  → User describes requirements conversationally
  → Team Builder designs worker agents (Engineer, Designer, QA)
  → Team Builder publishes JSON config: {
      teamName: 'Mobile App Team',
      ownerId: 'user-123',
      agents: [engineerConfig, designerConfig, qaConfig]
    }
  → Orchestrator reads JSON
  → Orchestrator calls: TeamService.createTeam()
    → Create Team record
    → System automatically creates Planner Agent (type: 'planner', system-managed)
    → Create designed worker agents (type: 'worker', ownedBy: 'user-123')
    → Initialize Workspace (Git repo)
  → Orchestrator starts all agents (Planner + workers)
  → Return team with Planner Agent + worker agents
```

### Adding Worker Agent (Later)
```
User talks to Team Builder: "Add a security specialist"
  → Team Builder helps design security agent conversationally
  → Team Builder publishes JSON config: {
      role: 'security-specialist',
      capabilities: ['security-audit', 'penetration-testing'],
      mcpServers: ['security-tools']
    }
  → Orchestrator reads JSON
  → Orchestrator calls: TeamService.addAgent()
    → Create Agent record (type: 'worker', ownedBy: 'user-123', delegatedTo: null)
    → Link MCP servers
  → Orchestrator starts new agent
  → Return agent
```

### Delegating Agent
```
Manager delegates engineer to employee
  → POST /teams/{id}/agents/{agentId}/delegate { employeeId: 'emp-456' }
  → TeamService.delegateAgent()
    → Check: agent.type !== 'planner' (403 if planner)
    → Update: agent.delegatedTo = 'emp-456'
    → Return updated agent
```

### Giving Goal
```
User: "Build login screen"
  → POST /teams/{id}/goals { goal: 'Build login screen' }
  → TeamService.giveGoal()
    → Retrieve Planner Agent
    → Planner Agent helps analyze goal and break into tasks
    → Planner Agent manages task assignments
    → Planner Agent coordinates artifacts and agent-human collaboration
    → Worker agents collaborate with humans to execute assigned tasks
    → Artifacts saved to workspace
```

---

## API Endpoints (from team-api.md)

- **POST /teams** - Create team (auto-includes Planner Agent)
- **GET /teams/:id** - Get team with agents (ownership/delegation info)
- **PUT /teams/:id** - Update team metadata
- **DELETE /teams/:id** - Delete team (cascade delete agents, workspace)
- **GET /teams** - List teams (filter by ownerId for "my teams")

- **POST /teams/:id/members** - Add employee to team
- **DELETE /teams/:id/members/:userId** - Remove employee (auto-reclaim delegated agents)

- **POST /teams/:id/agents** - Add worker agent
- **POST /teams/:id/agents/:id/delegate** - Delegate to employee
- **POST /teams/:id/agents/:id/reclaim** - Reclaim from employee
- **DELETE /teams/:id/agents/:id** - Remove agent (403 for Planner)

- **GET /teams/:id/workspace** - Get workspace info (structure, Git status)

---

## Database Indexes

```sql
-- Team queries
CREATE INDEX idx_teams_owner ON teams(ownerId);
CREATE INDEX idx_teams_created ON teams(createdAt DESC);

-- Agent queries
CREATE INDEX idx_agents_team ON agents(teamId);
CREATE INDEX idx_agents_owner ON agents(ownedBy);
CREATE INDEX idx_agents_delegated ON agents(delegatedTo);
CREATE INDEX idx_agents_type ON agents(type);  -- Planner vs Worker
CREATE UNIQUE INDEX idx_one_planner_per_team ON agents(teamId, type) WHERE type = 'planner';

-- Team member queries
CREATE INDEX idx_team_members_user ON team_members(userId);
CREATE INDEX idx_team_members_team ON team_members(teamId);
```

---

## Skills System Integration

**Feature:** Portable, reusable agent capabilities (see [Skills System](../skills-system/feature_architecture.md))

### How Skills Enhance Teams

**Without Skills:**
- Agent configs duplicated across teams
- No reusability (each team configures tools/prompts separately)
- Updates require manual propagation

**With Skills:**
- Teams **install skills** from registry (like npm install)
- Agents **inherit skills** from team
- **Skill updates propagate** automatically (update "Security Review" skill → all teams benefit)

### Team-Skills Architecture

```typescript
Team {
  id, name, ownerId, workspaceId
  installedSkills: string[]      // ["security-review", "react-expert"]
}

Agent {
  id, teamId, type, ownedBy, delegatedTo
  assignedSkills: string[]       // Subset of team's installed skills
  customConfig?: object          // Team-specific overrides
}

Skill {
  id, name, description
  fullConfig: {
    tools: Tool[]
    prompts: PromptTemplate[]
    examples: Example[]
  }
}
```

### Flow: Installing and Using Skills

**1. Manager Installs Skill to Team:**
```
Manager browses Skill Registry
  → Selects "Security Review" skill
  → POST /api/teams/:teamId/skills { skillId: "security-review" }
  → Skill added to team.installedSkills
  → All team agents can now use Security Review
```

**2. Planner Agent Uses Skill:**
```
User gives goal: "Review this code for vulnerabilities"
  → Planner Agent sees team has "security-review" skill installed
  → Planner Agent activates skill (loads tools, prompts)
  → Executes security scan using skill's capabilities
  → Returns findings to user
```

**3. Creating Worker with Skills:**
```
Team Builder designs "Security Specialist" agent
  → Agent config: { assignedSkills: ["security-review", "code-analysis"] }
  → POST /api/teams/:teamId/agents { ...config }
  → Agent inherits skill configs from team's installed skills
  → Agent starts with merged tools/prompts from skills
```

### Progressive Disclosure (Context Optimization)

**Current Problem:**
- Loading 100 teams × 5 agents × 2000 tokens = 1M tokens
- Orchestrator bloated with full agent configs

**With Skills:**
- Startup: Load only skill **descriptions** (30-50 tokens each)
- Runtime: Load skill **fullConfig** only when agent executes task
- **8x context reduction** (125K tokens vs 1M tokens)

**Implementation:**
```typescript
// Startup: Lightweight
const skillRegistry = await loadSkillDescriptions()
// {
//   "security-review": {
//     description: "Scans code for vulnerabilities using OWASP",
//     category: "security"
//   },
//   ...
// }

// Runtime: Load full config on-demand
async function executeTask(agentId, task) {
  const agent = await getAgent(agentId)
  const skills = await Promise.all(
    agent.assignedSkills.map(skillId => 
      skillRegistry.getFullConfig(skillId)  // Fetch from cache/DB
    )
  )
  const mergedConfig = mergeSkillConfigs(agent.customConfig, skills)
  // Execute task with merged config...
}
```

### Role Templates (Standardized Workers)

**Problem:** Every team configures "Frontend Developer" from scratch

**Solution:** Role Templates define standard worker types

```typescript
RoleTemplate {
  id: "frontend-developer"
  name: "Frontend Developer"
  description: "Builds UI components with React"
  defaultSkills: ["react-expert", "testing-automation"]
  basePrompt: "You are a frontend developer..."
}

// Team creates agent from template
POST /api/teams/:teamId/agents/from-template
Body: {
  roleTemplateId: "frontend-developer"
  name: "Alex (Frontend)"
  assignedSkills: ["react-expert", "accessibility"]  // Override defaults
}
```

### Benefits for Teams

1. **Faster Onboarding:**
   - Install "Starter Pack" skills (Code Review, Testing, Documentation)
   - Use role templates instead of manual config
   - 50% reduction in setup time

2. **Consistency:**
   - All teams use same "Security Review" implementation
   - Updates propagate (fix bug in skill → all teams benefit)
   - No config drift across teams

3. **Open Source Ecosystem:**
   - Community publishes skills to GitHub
   - Teams install from registry or GitHub URL
   - Example: "Medical Coding Skill" from healthcare community

4. **Customization:**
   - Teams install shared skills
   - Teams override with `customConfig` (disable tools, add prompts)
   - Best of both: Standardization + Flexibility

### Team Service API Changes

**New endpoints for skills:**
```typescript
// Install skill to team
POST /api/teams/:teamId/skills
Body: { skillId: string, customConfig?: object }

// List team's installed skills
GET /api/teams/:teamId/skills
Response: { skills: Skill[] }

// Uninstall skill
DELETE /api/teams/:teamId/skills/:skillId

// Create agent with skills (enhanced)
POST /api/teams/:teamId/agents
Body: {
  name: string
  type: "worker"
  assignedSkills: string[]      // NEW: Skills from team's installed list
  customConfig?: object
}

// Create agent from role template
POST /api/teams/:teamId/agents/from-template
Body: {
  roleTemplateId: string
  name: string
  assignedSkills?: string[]     // Override template defaults
}
```

### TeamService Integration

**Modified TeamService class:**
```typescript
class TeamService {
  // Existing methods...
  
  // NEW: Skill installation
  async installSkill(teamId: string, skillId: string, userId: string): Promise<void> {
    // Verify user is team manager
    const team = await this.getTeam(teamId)
    if (team.ownerId !== userId) throw new ForbiddenError()
    
    // Install skill
    await skillRegistry.installSkillToTeam(teamId, skillId, userId)
  }
  
  // MODIFIED: Agent creation with skills
  async createAgent(teamId: string, config: {
    name: string
    type: AgentType
    assignedSkills: string[]    // NEW parameter
    customConfig?: object
  }): Promise<Agent> {
    // Verify skills are installed to team
    const teamSkills = await skillRegistry.getTeamSkills(teamId)
    const teamSkillIds = teamSkills.map(s => s.id)
    const invalidSkills = config.assignedSkills.filter(id => !teamSkillIds.includes(id))
    if (invalidSkills.length > 0) {
      throw new Error(`Skills not installed to team: ${invalidSkills.join(', ')}`)
    }
    
    // Create agent
    const agent = await db.agents.create({
      teamId,
      ...config
    })
    
    // Assign skills to agent
    await Promise.all(
      config.assignedSkills.map(skillId =>
        skillRegistry.assignSkillToAgent(agent.id, skillId)
      )
    )
    
    return agent
  }
  
  // NEW: Create agent from role template
  async createAgentFromTemplate(teamId: string, params: {
    roleTemplateId: string
    name: string
    assignedSkills?: string[]  // Override template defaults
  }): Promise<Agent> {
    const template = await roleTemplateRegistry.getTemplate(params.roleTemplateId)
    
    // Use provided skills or template defaults
    const skillIds = params.assignedSkills || template.defaultSkills
    
    return this.createAgent(teamId, {
      name: params.name,
      type: 'worker',
      assignedSkills: skillIds,
      customConfig: {
        basePrompt: template.basePrompt,
        roleTemplateId: template.id
      }
    })
  }
}
```

### Migration Strategy

**Phase 1: Add Skills to Existing Teams (v1.0):**
- Run migration script to convert agent configs → skills
- Example: Agent with Semgrep tool → Install "Security Review" skill, assign to agent
- Slim down agent configs (remove duplicated tool definitions)
- Teams benefit immediately (skill updates propagate)

**Phase 2: Progressive Disclosure (v1.1):**
- Optimize Orchestrator startup (load descriptions only)
- Lazy-load skill fullConfigs on agent execution
- Measure context reduction (target: 8x)

**Phase 3: Role Templates (v1.2):**
- Create official templates (Frontend Dev, Backend Dev, QA, DevOps)
- Team Builder suggests templates during agent design
- UI for creating agents from templates

**Phase 4: GitHub Integration (v1.3):**
- Teams install skills from GitHub repos
- Registry indexes popular GitHub skills
- Community skill ecosystem

### Implementation Timeline

**Team Service v1.0:** 6 days (existing plan)
**Skills System v1.0:** 7.5 days (parallel development)

**Dependencies:**
- Skills System v1.0 **does NOT block** Team Service v1.0
- Team Service can launch without skills (agents use full configs)
- Skills System can be added later (migration script converts configs)

**Recommended Approach:**
1. Implement Team Service v1.0 first (6 days)
2. Deploy and validate team management works
3. Implement Skills System v1.0 (7.5 days)
4. Run migration to convert existing teams to use skills
5. Both systems work together seamlessly

---

## Decision Required

**Which architecture approach should we use: Option A, B, C, or D?**

**Recommendations:**
- **Option A** - Best for MVP (simple, clear, database-enforced)
- **Option D** - Best for future (Notion-style flexibility, cross-team agents)

Start with **Option A** for MVP, add Skills System after validation, migrate to **Option D** when cross-team collaboration needed.

**Skills System Decision:** Implement Skills System v1.0 after Team Service v1.0 validates core team management. Skills enhance teams but don't block core functionality.
