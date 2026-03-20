# Getting Started with Ping

**Welcome to Ping!** This guide will help you set up and start using Ping to orchestrate multi-agent teams.

---

## What is Ping?

Ping is a multi-agent collaboration platform that enables teams of AI agents to work together on complex tasks with human supervision and control.

**Two Integrated Modes:**
- **Design Mode (Team Builder)** - Create and synthesize agents using AI
- **Execution Mode (Runtime)** - Orchestrate teams, supervise agents, manage artifacts

---

## Prerequisites

Before installing Ping, ensure you have:

- **Node.js** 18 or higher ([Download](https://nodejs.org/))
- **pnpm** 8 or higher (`npm install -g pnpm`)
- **Git** ([Download](https://git-scm.com/))
- **Azure OpenAI API** credentials ([Get access](https://azure.microsoft.com/en-us/products/ai-services/openai-service))
- **Redis** (optional, for real-time collaboration)
- **MongoDB** (optional, for persistence)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/ping.git
cd ping
```

### 2. Install Dependencies

Ping uses a monorepo structure with pnpm workspaces:

```bash
pnpm install
```

This installs dependencies for all packages:
- `@ping/runtime` - Execution mode backend
- `@ping/team-builder` - Design mode backend
- `@ping/shared` - Shared types and utilities
- `@ping/ui` - Frontend application

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT_URL=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key-here
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Server Configuration
PORT=3000
NODE_ENV=development

# Database (Optional)
MONGODB_URI=mongodb://localhost:27017/ping
REDIS_URL=redis://localhost:6379

# Storage (Optional - for Artifact Store)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=ping-artifacts
AWS_REGION=us-east-1
```

### 4. Start Development Server

```bash
# Start all services
pnpm dev
```

This starts:
- **Runtime backend** on `http://localhost:3000`
- **Team Builder backend** on `http://localhost:3001`
- **Frontend UI** on `http://localhost:5173`

---

## First Steps

### 1. Access Ping UI

Open your browser to [http://localhost:5173](http://localhost:5173)

You should see the Ping workspace interface.

### 2. Create Your First Team

**As a manager, you create and own the team:**

1. Click **"New Team"** in the sidebar
2. Enter team details:
   - **Name**: "Product Development Team"
   - **Description**: "Build product requirements and user stories"
   - **Owner**: You (automatically set as manager)
3. Click **"Create Team"**

**You now own:**
- The team itself
- The Planner (created automatically)
- All worker agents (when you add them)
- The team workspace

### 3. Design Agents (Using Role Manager Meta-Agent)

The **Role Manager** meta-agent helps you create the right agents for your team.

1. In your team workspace, click **"Design Agents"**
2. Describe your goal:
   ```
   "I need to create a product requirements document for a new mobile app"
   ```
3. Role Manager will **Think** → **Plan** → **Suggest** agents:
   - **Product Manager** - Gather requirements
   - **Technical Writer** - Write documentation
   - **UX Designer** - Create wireframes

4. Review the suggested agents and click **"Approve"**
5. Role Manager will **Build** the agents (instantiate them)

### 4. Run Your First Workflow

**In Execution Mode (Runtime):**

1. Click **"Run Team"**
2. Define your goal:
   ```
   "Create a product requirements document for a fitness tracking mobile app"
   ```
3. The **Orchestrator** will:
   - Use the Planner to break down the goal into tasks
   - Assign tasks to worker agents
   - Coordinate execution
4. Watch agents collaborate in real-time:
   - **Product Manager** writes requirements
   - **Technical Writer** structures the document
   - **UX Designer** adds wireframe references

### 5. Review Artifacts

**Artifacts are the final outputs of agent tasks** - everything agents create ends up in your team workspace:

1. Click **"Workspace"** in the sidebar to see your team's folder structure:
   ```
   product-development-team/
   ├── docs/
   │   └── product-requirements.md  ← Task output
   ├── designs/
   │   └── wireframes.png           ← Task output
   └── .git/                         ← Version history
   ```

2. Click **"Artifacts"** tab to see all task outputs:
   - **Product Requirements Document** (by Product Manager)
   - **Wireframes** (by UX Designer)
   - **Technical Specifications** (by Technical Writer)

3. Click any artifact to:
   - **Preview** - View content inline
   - **Version History** - See all changes (Git commits)
   - **Diff View** - Compare versions
   - **Download** - Export as Word/PDF

4. **Review and approve**:
   - ✅ **Approve** - Accept the artifact
   - 🔄 **Request Changes** - Send back to agent with feedback
   - 💬 **Comment** - Add inline comments for discussion

**Every task creates artifacts** - agents don't just "think", they produce tangible deliverables you can review, version, and use.

---

## Key Concepts

### Teams

**Teams are execution boundaries** in Ping - a collection of agents working together:

- **Planner** - Manages the team (planning, coordination, task assignment)
- **Worker Agents** - Execute tasks (Product Manager, Engineer, Designer, etc.)
- **Team Workspace** - Shared folder for all artifacts
- **Human Owners** - Employees who manage specific agents

**Example team structure:**
```
Product Team
├── Planner (manages team)
├── Worker Agents:
│   ├── Product Manager (owned by Alice)
│   ├── Technical Writer (owned by Bob)
│   └── UX Designer (shared)
├── Workspace: /workspace/product-team/
└── Artifacts: requirements.md, wireframes.png
```

**Key concepts:**
- **Everything is an agent** - Planner, workers, even specialists
- **Agent ownership** - Humans can manage specific agents (review outputs, provide guidance)
- **Isolation** - Each team has its own agents, workspace, and artifacts
- **Delegation** - Assign agents to employees for closer supervision

### Agents

**All components in Ping are agents** - AI workers with specific roles and capabilities:

**Agent Types:**

1. **Planner**
   - Role: Team manager and coordinator
   - Responsibilities: Plan workflows, assign tasks, monitor progress
   - Ownership: Always owned by team manager
   - One per team

2. **Worker Agents**
   - Roles: Product Manager, Engineer, Designer, Analyst, QA, etc.
   - Responsibilities: Execute assigned tasks, create artifacts
   - Ownership: Initially owned by manager, can be delegated to employees
   - Multiple per team

3. **Meta-Agent (Role Manager)**
   - Role: Agent designer (used in Team Builder mode)
   - Responsibilities: Discover roles, design agents, suggest team composition
   - System-level agent

**Ownership & Delegation Model:**
```
Manager (David) creates Engineering Team:

Initial state:
├── Planner (David)
└── Worker Agents:
    ├── Frontend Developer (David)
    ├── Backend Developer (David)
    └── QA Engineer (David)

After delegation:
├── Planner (David - cannot delegate)
└── Worker Agents:
    ├── Frontend Developer (delegated to Sarah)
    ├── Backend Developer (delegated to Mike)
    └── QA Engineer (David - kept by manager)
```

**As a manager, you can:**
- **Create teams** - Start new teams with agents
- **Own all agents** - Initially control all team agents
- **Delegate agents** - Assign worker agents to employees
- **Retain agents** - Keep some agents under direct management
- **Reclaim agents** - Take back delegated agents if needed

**As an employee with delegated agent, you can:**
- **Manage your agent** - Review outputs, provide guidance
- **Approve artifacts** - Accept or request changes
- **Monitor tasks** - See what your agent is working on
- **Provide feedback** - Guide agent behavior within your scope

**Example:**
```
Sarah (delegated Frontend Developer agent):
- Sees all UI component tasks assigned to it
- Reviews React code artifacts
- Approves or requests changes
- Cannot reassign agent or change its role

David (Manager, owns the team):
- Sees all team activity
- Can reassign tasks between agents
- Can reclaim Sarah's agent if needed
- Manages Planner directly
```

### Artifacts

**Artifacts are the final outputs of every agent task** - the tangible deliverables stored in your team workspace:

- **Documents** (Markdown, structured docs, Word exports)
- **Code** (files, commits, pull requests)
- **Data** (JSON, CSV, analysis results)
- **Binary files** (images, PDFs, videos)

**Task → Artifact relationship:**
```
Task: "Write product requirements"
  ↓
Artifact: docs/product-requirements.md (v1)

Task: "Create wireframes"
  ↓
Artifact: designs/wireframes.png (v1)

Task: "Implement login API"
  ↓
Artifacts: 
  - src/api/auth.ts (code)
  - Pull Request #42 (review)
```

**Workspace visibility:**
- All artifacts visible in **team workspace folder**
- Git-versioned for history and rollback
- Organized by type (docs/, code/, designs/, data/)

**Storage:**
- Text/Code → Git branches (viewable in workspace)
- Binary files → S3/Azure Blob (linked in workspace)
- Collaborative docs → Real-time OT/CRDT (auto-saved)

### Orchestration

**How the Orchestrator coordinates the team using the Planner:**

1. **Goal** - Human defines what to achieve
2. **Planner Analyzes** - Breaks goal into tasks with expected outputs
3. **Planner Assigns** - Assigns tasks to worker agents based on roles
4. **Worker Agents Execute** - Work on tasks and create artifacts
5. **Artifacts to Workspace** - All outputs saved to team workspace
6. **Human Reviews** - Agent owners review their agent's artifacts
7. **Planner Coordinates** - Manages dependencies, handles blockers

**Agent-centric flow:**
```
Human: "Create mobile app design"
  ↓
Planner (thinks):
  "I need requirements, UI design, and wireframes.
   I'll assign tasks to my worker agents."
  ↓
Planner (assigns):
  - Product Manager agent → "Write requirements"
  - UX Designer agent → "Create wireframes"
  - Technical Writer agent → "Document design decisions"
  ↓
Worker Agents (execute):
  - Product Manager → docs/requirements.md
  - UX Designer → designs/wireframes.png
  - Technical Writer → docs/design-rationale.md
  ↓
Workspace:
  mobile-app-team/
  ├── docs/
  │   ├── requirements.md (by Product Manager, reviewed by Alice)
  │   └── design-rationale.md (by Technical Writer, reviewed by Bob)
  └── designs/
      └── wireframes.png (by UX Designer, reviewed by Carol)
  ↓
Agent Owners Review:
  - Alice approves Product Manager's requirements
  - Bob requests changes to Technical Writer's doc
  - Carol approves UX Designer's wireframes
  ↓
Planner:
  "2/3 artifacts approved. Technical Writer working on revisions."
```

**Key insight:** The Planner is an agent running inside the Orchestrator, managing other worker agents.

---

## Common Workflows

### Workflow 1: Product Requirements

```
1. Create "Product Team"
2. Design agents: Product Manager, Tech Writer
3. Set goal: "Create PRD for feature X"
4. Agents collaborate → Artifact: docs/prd-feature-x.md
5. View in workspace, export to Word
6. Approve artifact → Ready for engineering
```

**Workspace output:**
```
product-team/
└── docs/
    └── prd-feature-x.md (v3, approved)
```

### Workflow 2: Code Development

```
1. Create "Engineering Team"
2. Design agents: Frontend Dev, Backend Dev, QA
3. Set goal: "Build login feature"
4. Agents work → Artifacts:
   - src/components/Login.tsx
   - src/api/auth.ts
   - tests/login.test.ts
5. View workspace, review pull requests
6. Approve artifacts, merge to main
```

**Workspace output:**
```
engineering-team/
├── src/
│   ├── components/Login.tsx (v2, approved)
│   └── api/auth.ts (v1, approved)
└── tests/
    └── login.test.ts (v1, approved)
```

### Workflow 3: Data Analysis

```
1. Create "Analytics Team"
2. Design agents: Data Analyst, Visualization Expert
3. Set goal: "Analyze Q4 sales data"
4. Agents collaborate → Artifacts:
   - analysis/q4-sales.ipynb (Jupyter notebook)
   - reports/q4-summary.md (report)
   - charts/revenue-trends.png (visualization)
5. View workspace, review charts and insights
6. Approve artifacts, export report to PDF
```

**Workspace output:**
```
analytics-team/
├── analysis/
│   └── q4-sales.ipynb (v1, approved)
├── reports/
│   └── q4-summary.md (v2, approved)
└── charts/
    ├── revenue-trends.png
    └── customer-segments.png
```

### Workflow 4: Team Creation & Agent Delegation

**Manager creates team and delegates agents to employees:**

```
Step 1: Manager (David) creates "Customer Support Team"
- David owns the team
- David owns the Planner (automatically created)

Step 2: David designs worker agents using Team Builder:
- Support Engineer
- Documentation Writer  
- QA Specialist
- David initially owns all three agents

Step 3: David delegates agents to employees:
- Support Engineer → John (John is technical, handles code issues)
- Documentation Writer → Sarah (Sarah writes well, manages help content)
- QA Specialist → David keeps it (manager does quality oversight)
- Planner → David keeps it (managers always own the planner)

Team structure after delegation:
├── Planner (David - manager control)
└── Worker Agents:
    ├── Support Engineer (delegated to John)
    ├── Documentation Writer (delegated to Sarah)
    └── QA Specialist (David - not delegated)

Step 4: David sets team goal: "Improve documentation for top 10 support issues"

Step 5: Orchestrator uses Planner (managed by David) to assign tasks:
- Support Engineer: "Analyze top 10 tickets" → John will review
- Documentation Writer: "Write help articles" → Sarah will review
- QA Specialist: "Review article quality" → David will review

Step 6: Employees manage their delegated agents:
- John reviews Support Engineer's ticket analysis artifact
- Sarah approves Documentation Writer's help articles
- David reviews QA Specialist's quality report

Step 7: All artifacts in workspace:
   customer-support-team/
   ├── analysis/
   │   └── ticket-trends.md (by Support Engineer, approved by John)
   ├── docs/
   │   └── help-articles/ (by Documentation Writer, approved by Sarah)
   └── qa/
       └── review-results.md (by QA Specialist, approved by David)

Step 8: David (manager) sees full team dashboard:
- 3/3 tasks complete
- 3/3 artifacts approved
- Team goal achieved
```

**Benefits of manager ownership + delegation:**
- **Central control** - Manager owns team, maintains oversight
- **Distributed management** - Employees manage individual agents
- **Domain expertise** - Delegate agents to employees with relevant skills
- **Scalability** - Manager doesn't review every artifact, only their agents
- **Flexibility** - Manager can reclaim or reassign agents as needed
- **Accountability** - Clear ownership chain (Manager → Employee → Agent)

---

## Tips for Success

### 1. Clear Goals

**Bad:** "Do some research"
**Good:** "Research top 3 competitors and create comparison table"

### 2. Right Agents

Use **Role Manager** to discover the right agents for your goal. Don't manually create agents unless you know exactly what you need.

### 3. Delegate Strategically (For Managers)

**As a manager creating teams:**
- Keep Planner under your control (always)
- Delegate worker agents to employees with domain expertise
- Retain some agents if you need direct oversight
- You can reclaim or reassign agents anytime

**Best delegation pattern:**
```
Manager owns:
- Planner (coordination)
- Critical agents (security, compliance, architecture)

Employees own:
- Domain-specific agents (frontend dev, content writer, analyst)
- Execution agents (implementation, testing, documentation)
```

### 4. Review Often

Check **Artifacts** tab regularly to:
- Monitor progress
- Provide feedback
- Approve deliverables early

**If you're a manager:** Review team dashboard for overall progress
**If you manage an agent:** Focus on your agent's artifacts

### 5. Leverage Real-Time Collaboration

For documents, use **Structured Document Model**:
- Multiple agents edit simultaneously
- No merge conflicts
- Export to Word/PDF when done

### 5. Use Templates

Ping provides templates for common documents:
- Product Requirements
- Technical Design
- User Stories
- Test Plans
- Quarterly Reports

---

## Troubleshooting

### Issue: Agents not responding

**Check:**
1. Azure OpenAI credentials in `.env`
2. API quota and rate limits
3. Network connectivity

**Fix:**
```bash
# Test Azure OpenAI connection
curl https://your-resource.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2024-02-15-preview \
  -H "Content-Type: application/json" \
  -H "api-key: your-key" \
  -d '{"messages":[{"role":"user","content":"test"}]}'
```

### Issue: Frontend not loading

**Check:**
1. Backend servers running (`pnpm dev`)
2. Port 5173 available
3. Browser console for errors

**Fix:**
```bash
# Restart frontend
cd packages/ui
pnpm dev
```

### Issue: Artifacts not saving

**Check:**
1. MongoDB connection (if using persistence)
2. S3/Azure Blob credentials (for binary files)
3. Git repository initialized

**Fix:**
```bash
# Initialize Git for artifact storage
cd workspace/teams/your-team
git init
```

### Issue: Real-time collaboration not working

**Check:**
1. Redis running (`redis-cli ping` → `PONG`)
2. WebSocket connection (browser dev tools → Network → WS)

**Fix:**
```bash
# Start Redis
redis-server

# Or with Docker
docker run -d -p 6379:6379 redis
```

---

## Next Steps

Now that Ping is running, explore:

1. **[Creating Teams](./creating-teams.md)** - Deep dive into team creation
2. **[Designing Agents](./designing-agents.md)** - Using Team Builder
3. **[Reviewing Artifacts](./reviewing-artifacts.md)** - Approval workflow and version control

### API Reference

- **[Orchestrator API](../api/orchestrator-api.md)** - Give goals to teams
- **[Team API](../api/team-api.md)** - Manage teams and agents  
- **[Artifact API](../api/artifact-api.md)** - Access and download outputs
- **[WebSocket Events](../api/websocket-events.md)** - Real-time agent communication

---

## Get Help

- **Documentation**: See [docs/INDEX.md](../../INDEX.md) for complete documentation index
- **Architecture**: [Ping Architecture](../../ping/architecture.md)
- **Vision**: [Ping Vision](../../ping/vision.md)
- **Issues**: Report bugs in your project's issue tracker
- **Community**: [Configure your team's chat/support channel]

---

**Ready to orchestrate your first multi-agent team?** 🚀

Start with a simple goal and let Ping's agents collaborate to achieve it!
