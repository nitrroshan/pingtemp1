# Creating Teams in Ping

**Teams are the foundation of work in Ping.** This guide shows you how to create, configure, and manage teams.

---

## What is a Team?

A **team** is an execution boundary that contains:
- **Agents** - AI workers with specific roles
- **Tasks** - Work items to accomplish
- **Artifacts** - Outputs produced by agents
- **Workspace** - Isolated environment with Git repo, file storage

**Key Principle:** Teams are isolated. One team's agents cannot access another team's artifacts (unless explicitly shared).

---

## Creating a Team

### Via Ping UI

1. **Open Ping** at [http://localhost:5173](http://localhost:5173)
2. Click **"New Team"** in the sidebar (or press `Ctrl+N`)
3. Fill in team details:

```
Name: Product Development Team
Description: Create and maintain product requirements, user stories, and specs
Visibility: Private
```

4. Click **"Create Team"**

### Via API

```typescript
import { PingClient } from '@ping/client'

const ping = new PingClient({ apiUrl: 'http://localhost:3000' })

const team = await ping.teams.create({
  name: 'Product Development Team',
  description: 'Create and maintain product requirements',
  visibility: 'private',
  settings: {
    autoApproval: false,
    realTimeCollaboration: true
  }
})

console.log(`Team created: ${team.id}`)
```

---

## Team Properties

### Name

**Purpose:** Identify the team

**Rules:**
- 3-50 characters
- Unique within your organization
- Can contain letters, numbers, spaces, hyphens

**Examples:**
- ✅ "Product Development"
- ✅ "Q1-2026-Engineering"
- ❌ "PD" (too short)
- ❌ "Team-with-a-really-long-name-that-nobody-will-remember" (too long)

### Description

**Purpose:** Explain the team's purpose

**Best Practices:**
- 1-2 sentences
- Describe **what** the team does, not **how**
- Include deliverables

**Examples:**
- ✅ "Create product requirements and user stories for mobile app features"
- ✅ "Analyze sales data and generate quarterly reports for executives"
- ❌ "A team that does stuff"

### Visibility

**Options:**
- **Private** - Only team members can see (default)
- **Internal** - All organization members can view
- **Public** - Anyone can view (for open-source projects)

**Note:** Visibility only affects viewing. Artifacts are always protected by approval workflow.

---

## Team Settings

### Auto-Approval

**When enabled:**
- Agents can commit artifacts without human review
- Faster execution
- **Risk:** Less control

**When disabled (default):**
- All artifacts require human approval
- Slower but safer
- **Recommended** for production work

**Configure:**
```typescript
await ping.teams.update(teamId, {
  settings: {
    autoApproval: false // Require human review
  }
})
```

### Real-Time Collaboration

**When enabled (recommended):**
- Multiple agents edit documents simultaneously
- Uses OT/CRDT (no merge conflicts)
- Requires Redis

**When disabled:**
- Sequential editing only
- Simpler setup

**Configure:**
```typescript
await ping.teams.update(teamId, {
  settings: {
    realTimeCollaboration: true
  }
})
```

### Artifact Storage

**Options:**

**Git Only (default):**
- All artifacts versioned in Git
- Best for code and text

**Git + Object Storage:**
- Text/code → Git
- Binaries → S3/Azure Blob
- Best for mixed content

**Configure:**
```typescript
await ping.teams.update(teamId, {
  settings: {
    artifactStorage: {
      type: 'hybrid',
      git: {
        remote: 'https://github.com/your-org/team-artifacts'
      },
      objectStorage: {
        provider: 's3',
        bucket: 'ping-artifacts',
        prefix: `teams/${teamId}/`
      }
    }
  }
})
```

---

## Team Workspace

When you create a team, Ping automatically sets up:

### 1. Git Repository

**Purpose:** Version control for artifacts

**Structure:**
```
workspace/teams/{team-id}/
├── .git/
├── main (branch)
├── agent/{role}/task-{id}/ (agent branches)
└── artifacts/
    ├── documents/
    ├── code/
    └── data/
```

**Automatic Actions:**
- Initialize Git repo
- Create main branch (protected)
- Set up branch policies

### 2. File Storage

**For binary artifacts:**
- Images, PDFs, videos
- Stored in S3/Azure Blob
- Git LFS-style pointers in Git

### 3. Database Records

**Team metadata:**
- Members (agents)
- Tasks
- Artifacts
- Settings

---

## Adding Agents to Team

### Using Team Builder (Recommended)

**Let Role Manager meta-agent design your team:**

1. Open team workspace
2. Click **"Design Agents"**
3. Describe your goal:
   ```
   "I need to create API documentation for a REST service"
   ```
4. Role Manager will:
   - **Think:** Analyze requirements
   - **Plan:** Design roles (Technical Writer, API Developer, QA)
   - **Suggest:** Present for approval
   - **Build:** Instantiate agents

**Advantages:**
- AI-optimized team composition
- Discovers roles you might not think of
- Faster than manual setup

### Manual Agent Creation

**If you know exactly what you need:**

1. Click **"Add Agent"** in team workspace
2. Select role from registry:
   - Product Manager
   - Software Engineer
   - Data Analyst
   - Technical Writer
   - UX Designer
3. Configure agent:
   - Name
   - Custom instructions (optional)
   - Tools/capabilities

**Example:**
```typescript
const agent = await ping.teams.addAgent(teamId, {
  role: 'software-engineer',
  name: 'Backend Developer',
  config: {
    specialization: 'Node.js, TypeScript, REST APIs',
    tools: ['code-execution', 'file-system', 'git'],
    temperature: 0.3 // More deterministic
  }
})
```

---

## Team Templates

Ping provides templates for common team structures:

### Product Team

```
Agents:
- Product Manager
- Technical Writer
- UX Designer

Artifacts:
- Product Requirements Documents
- User Stories
- Wireframes

Tools:
- Structured Document Model
- Figma integration (optional)
```

### Engineering Team

```
Agents:
- Frontend Developer
- Backend Developer
- QA Engineer
- DevOps Engineer

Artifacts:
- Source code
- Pull requests
- Test reports

Tools:
- Git
- Code execution
- CI/CD integration
```

### Analytics Team

```
Agents:
- Data Analyst
- Visualization Expert
- Report Writer

Artifacts:
- Jupyter notebooks
- Charts and graphs
- Executive reports

Tools:
- Python execution
- Data connectors
- Export to PDF
```

**Use a template:**
```typescript
const team = await ping.teams.createFromTemplate({
  template: 'product-team',
  name: 'Mobile App Product Team',
  customizations: {
    addAgents: ['UX Researcher'],
    removeAgents: ['Technical Writer']
  }
})
```

---

## Managing Team Members

### View Team Members

```typescript
const members = await ping.teams.getMembers(teamId)

members.forEach(agent => {
  console.log(`${agent.name} (${agent.role})`)
})
```

### Remove Agent

```typescript
await ping.teams.removeAgent(teamId, agentId)
```

**Note:** Removing an agent doesn't delete their past work. Artifacts remain in Git history.

### Update Agent Configuration

```typescript
await ping.teams.updateAgent(teamId, agentId, {
  config: {
    temperature: 0.5, // More creative
    tools: [...existingTools, 'web-search']
  }
})
```

---

## Team Lifecycle

### Active Team

**State:** Working on tasks

**Actions Available:**
- Add/remove agents
- Run workflows
- Review artifacts
- Update settings

### Paused Team

**When to pause:**
- Waiting for external input
- Budget constraints
- Seasonal work (e.g., quarterly reports)

**Effect:**
- Agents stop processing tasks
- Workspace remains accessible
- No API costs

```typescript
await ping.teams.pause(teamId)
```

### Archived Team

**When to archive:**
- Project completed
- Team no longer needed

**Effect:**
- Read-only access
- Artifacts preserved
- Cannot add tasks

```typescript
await ping.teams.archive(teamId)
```

### Deleted Team

**When to delete:**
- Test/experimental teams
- Compliance requirements

**Effect:**
- **Permanent deletion**
- Artifacts moved to cold storage (30-day retention)
- Cannot be restored after 30 days

```typescript
await ping.teams.delete(teamId, {
  confirm: true,
  reason: 'Test team no longer needed'
})
```

---

## Best Practices

### 1. Team Scope

**Do:** Create focused teams
```
✅ "Mobile App Features Team"
✅ "Q1 Analytics Team"
```

**Don't:** Create overly broad teams
```
❌ "Everything Team"
❌ "General Purpose Team"
```

### 2. Team Size

**Ideal:** 3-7 agents
- Enough diversity
- Manageable collaboration

**Too small:** 1-2 agents
- Limited capabilities
- Single point of failure

**Too large:** 10+ agents
- Coordination overhead
- Unclear responsibilities

### 3. Naming Convention

**Use prefixes for organization:**
```
{Department}-{Project}-Team

Examples:
- Eng-Auth-Team
- Product-MobileApp-Team
- Analytics-Q1Report-Team
```

### 4. Template Usage

**Start with template, customize:**
1. Choose closest template
2. Add/remove agents as needed
3. Save as new template (optional)

### 5. Settings Review

**Quarterly review:**
- Auto-approval still appropriate?
- Artifact storage working?
- Team members still needed?

---

## Troubleshooting

### Issue: Cannot create team

**Possible causes:**
1. Duplicate team name
2. Insufficient permissions
3. Organization limit reached

**Fix:**
```typescript
// Check existing teams
const teams = await ping.teams.list()
console.log(teams.map(t => t.name))

// Check limits
const quota = await ping.organization.getQuota()
console.log(`Teams: ${quota.teams.used}/${quota.teams.limit}`)
```

### Issue: Agents not appearing in team

**Check:**
1. Agent creation succeeded
2. Agent status is "active"
3. Team not paused/archived

**Fix:**
```typescript
// Verify agent exists
const agent = await ping.agents.get(agentId)
console.log(agent.status) // Should be 'active'

// Verify team membership
const members = await ping.teams.getMembers(teamId)
console.log(members.find(m => m.id === agentId))
```

### Issue: Workspace not initialized

**Check:**
1. Git installed
2. Disk space available
3. File permissions

**Fix:**
```bash
# Manually initialize workspace
cd workspace/teams/{team-id}
git init
git add .
git commit -m "Initialize team workspace"
```

---

## Next Steps

- **[Designing Agents](./designing-agents.md)** - Using Team Builder to create optimal agent teams
- **[Orchestrator API](../api/orchestrator-api.md)** - Give goals and coordinate execution
- **[Reviewing Artifacts](./reviewing-artifacts.md)** - Approving and managing outputs

---

**Teams are the foundation of everything in Ping.** Take time to design them well, and your agents will collaborate smoothly! 🎯
