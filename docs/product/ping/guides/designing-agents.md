# Designing Agents with Team Builder

**Team Builder is like Lovable or Rocket, but for agent teams.** Describe what you want to build in conversational natural language, and AI designs specialized agents with the right capabilities - no manual configuration needed.

**The difference:**
- **Lovable/Rocket**: "Build a fitness app" → AI generates code
- **Team Builder**: "Build a fitness app" → AI generates agent team (Product Manager, Mobile Dev, Backend Dev, QA)

**Team Builder is Ping's Design Mode** - an AI-powered system that helps you create optimal agent teams through conversation with the **Role Manager meta-agent**.

---

## Team Builder vs Traditional Configuration

### Traditional Approach ❌

**Manual, error-prone, time-consuming:**

```
Step 1: Guess what roles you need
→ "Maybe I need a Product Manager, Engineer, Designer?"

Step 2: Manually configure each agent
→ Choose model (GPT-4? Claude?)
→ Write system prompt (150+ lines)
→ Select tools (file system, Git, code execution...)
→ Configure parameters (temperature, max tokens...)

Step 3: Test agent interactions
→ Do they overlap? Do they conflict?
→ Are capabilities missing?

Step 4: Iterate (repeat steps 1-3 multiple times)
→ Trial and error
→ Manual adjustments
→ Weeks of refinement
```

**Time investment:** Days to weeks
**Expertise required:** Deep LLM knowledge, prompt engineering
**Error rate:** High (guessing, overlapping roles, gaps)

### Team Builder Approach ✅

**Conversational, AI-guided, automatic - with capability-based tool/MCP linking:**

```
Step 1: Describe your goal
→ "Build a fitness tracking app for iOS and Android"

Step 2: Answer clarifying questions
→ Role Manager: "Cross-platform or native?"
→ You: "Cross-platform with React Native"

Step 3: Review AI suggestions
→ Role Manager proposes 5-agent team with capabilities

Step 4: For EACH agent, link tools/MCPs based on capabilities
→ Mobile Developer needs "React Native" capability
  → Link MCP: @modelcontextprotocol/server-filesystem (code files)
  → Link MCP: @modelcontextprotocol/server-git (version control)
  → Create custom tool: "react-native-simulator" (test UI)
  
→ Backend Developer needs "API development" capability  
  → Link MCP: @modelcontextprotocol/server-postgres (database)
  → Create custom tool: "api-test-runner" (endpoint testing)
  
→ QA Engineer needs "testing" capability
  → Link MCP: @modelcontextprotocol/server-filesystem (test files)
  → Create custom tool: "test-coverage-analyzer"

Step 5: You approve/modify tool selections
→ "Backend Developer also needs Redis for caching"
→ Team Builder adds: @modelcontextprotocol/server-redis

Step 6: AI builds the team
→ Agents configured with linked MCPs and tools
→ Prompts optimized for each role
→ Tool access validated
→ Ready to work
```

**Key difference:** For each agent, Team Builder:
1. **Analyzes required capabilities**
2. **Links existing MCPs** (if available for that capability)
3. **Creates custom tools** (if no MCP exists)
4. **Validates tool access** (permissions, credentials)
5. **You approve** the final tool configuration

**Time investment:** Minutes (with user approval for tools)
**Expertise required:** None for roles, basic understanding for tool selection
**Error rate:** Low (AI suggests tools, you validate)

---

## What is Team Builder?

**Team Builder** uses conversational AI (Role Manager meta-agent) to help you design agent teams through natural dialogue.

**Instead of:**
```
❌ Manually selecting "Product Manager", "Engineer", "Designer"
❌ Guessing what roles you need
❌ Trial-and-error team composition
❌ Writing prompts and configuring tools
```

**You do:**
```
✅ Describe your goal in natural language
✅ Answer clarifying questions
✅ Review AI suggestions
✅ Refine through conversation
✅ Approve and let AI build the team
```

**Example conversation:**
```
💬 You: "I need to analyze customer feedback from surveys"

🤖 Role Manager:
"What type of analysis do you need?
- Sentiment analysis
- Topic modeling
- Statistical trends
- All of the above"

💬 You: "All of the above, plus generate a report"

🤖 Role Manager:
"Proposing 3-agent team:
1. Data Analyst - clean data, statistical analysis
2. NLP Specialist - sentiment, topic modeling
3. Report Writer - synthesize findings, create report

Approve to build this team?"
```

---

## The Role Manager Meta-Agent

Role Manager operates in **4 phases**:

### 1. Think (Analyze)

**Role Manager analyzes your goal** to understand what capabilities are needed.

**Example:**

**Your Goal:**
```
"Create a technical design document for a real-time chat system"
```

**Role Manager's Analysis:**
```
Required capabilities:
- System architecture design
- Technical writing
- API specification
- Database design
- Security considerations
- Scalability planning
```

### 2. Plan (Design)

**Role Manager designs specific agent roles** with capabilities, responsibilities, and tools.

**Example Output:**

```yaml
Proposed Roles:

1. System Architect
   Responsibilities:
   - Design overall system architecture
   - Choose technology stack
   - Define service boundaries
   Capabilities:
   - System design patterns
   - Scalability analysis
   - Technology evaluation
   Tools:
   - Diagram generation
   - Architecture templates

2. Technical Writer
   Responsibilities:
   - Structure technical documentation
   - Ensure clarity and consistency
   - Create API documentation
   Capabilities:
   - Technical documentation
   - Markdown/structured docs
   - Audience awareness
   Tools:
   - Structured Document Model
   - Template library

3. Security Engineer
   Responsibilities:
   - Identify security requirements
   - Design authentication/authorization
   - Define data protection measures
   Capabilities:
   - Security best practices
   - Threat modeling
   - Compliance awareness
   Tools:
   - Security checklist
   - Threat database
```

### 3. Suggest (Approval)

**Role Manager presents the team for human approval.**

**You see:**
- Proposed agents with full specs
- Rationale for each role
- Alternative compositions (if applicable)

**Your options:**
- ✅ **Approve** - Proceed with suggested team
- 🔄 **Modify** - Add/remove roles, adjust capabilities
- ❌ **Reject** - Provide feedback, redesign

**Example Approval UI:**

```
┌────────────────────────────────────────────────────────┐
│ Role Manager suggests 3 agents:                         │
├────────────────────────────────────────────────────────┤
│ [✓] System Architect                                    │
│     • Design system architecture                        │
│     • Choose tech stack                                 │
│                                                          │
│ [✓] Technical Writer                                    │
│     • Write documentation                               │
│     • API specs                                         │
│                                                          │
│ [✓] Security Engineer                                   │
│     • Security requirements                             │
│     • Auth/authz design                                 │
├────────────────────────────────────────────────────────┤
│ [Approve Team]  [Modify]  [Redesign]                   │
└────────────────────────────────────────────────────────┘
```

### 4. Build (Instantiate)

**Role Manager creates the agents** with configured capabilities and tools.

**Automated steps:**
1. Create agent instances
2. Configure LangGraph workflows
3. Assign tools and capabilities
4. Add agents to team
5. Initialize agent workspaces

**Result:**
- ✅ Agents appear in team roster
- ✅ Ready to accept tasks
- ✅ Can start collaborating

---

## Using Team Builder

### Method 1: Conversational Design (Like Lovable/Rocket)

**Natural dialogue with Role Manager - the recommended approach:**

**Complete example conversation:**

```
\ud83d\udcac You:
"I need to build a RESTful API for a project management tool"

\ud83e\udd16 Role Manager (Think phase):
"Analyzing your requirements... I need more context:

1. What features should the API support?
   - Task management
   - User management  
   - Project organization
   - All of the above

2. What's your preferred tech stack?
   - Node.js (Express/Fastify)
   - Python (FastAPI/Django)
   - Java (Spring Boot)
   - No preference

3. Team size preference?
   - Minimal (3-4 agents)
   - Balanced (5-6 agents)
   - Comprehensive (7+ agents)"

\ud83d\udcac You:
"All features, Node.js with Express, keep it balanced"

\ud83e\udd16 Role Manager (Plan phase):
"Designing optimal team structure...

Proposed 5-agent team:

1. **Backend Architect**
   Role: Design API architecture, data models, service boundaries
   Capabilities: REST principles, microservices, scalability
   Tools: Diagrams, architecture templates
   
2. **API Developer**
   Role: Implement endpoints, middleware, validation
   Capabilities: Express, TypeScript, error handling
   Tools: Code generation, file system, Git
   
3. **Database Engineer**
   Role: Design schema, queries, migrations
   Capabilities: PostgreSQL/MongoDB, ORMs, optimization
   Tools: Database access, migration tools
   
4. **Security Engineer**  
   Role: Authentication, authorization, security best practices
   Capabilities: JWT, OAuth, RBAC, API security
   Tools: Security scanning, token management
   
5. **QA Engineer**
   Role: API testing, integration tests, performance
   Capabilities: Jest, Supertest, load testing
   Tools: Test execution, monitoring

This covers all your requirements with good separation of concerns.
Would you like to proceed, or modify the team?"

\ud83d\udcac You:
"Looks good, but can the Database Engineer also handle caching?"

\ud83e\udd16 Role Manager (Suggest phase - iteration):
"Updated Database Engineer role:

**Database Engineer** (expanded)
   Role: Database design + caching strategy
   Capabilities: 
   - PostgreSQL/MongoDB
   - Redis/Memcached caching
   - Query optimization
   - Cache invalidation strategies
   Tools: Database access, Redis client, monitoring

All other roles unchanged. Approve this team?"

\ud83d\udcac You:
"Approved!"

\ud83e\udd16 Role Manager (Build phase):
"✅ Building your team with tools/MCPs...

1. Backend Architect
   - Agent: Azure OpenAI GPT-4
   - Tools: Diagram generator, architecture templates
   - MCPs: None needed (design-focused)
   
2. API Developer
   - Agent: Azure OpenAI GPT-4
   - Capabilities: Express, TypeScript, API development
   - MCPs linked:
     → @modelcontextprotocol/server-filesystem (code files)
     → @modelcontextprotocol/server-git (version control)
   - Custom tools: API scaffolding generator
   
3. Database Engineer (with caching)
   - Agent: Azure OpenAI GPT-4  
   - Capabilities: PostgreSQL, Redis caching
   - MCPs linked:
     → @modelcontextprotocol/server-postgres (database access)
     → @modelcontextprotocol/server-redis (caching layer)
   - Custom tools: Migration generator, cache invalidation helper
   
4. Security Engineer
   - Agent: Azure OpenAI GPT-4
   - Capabilities: JWT, OAuth, security scanning
   - MCPs linked:
     → @modelcontextprotocol/server-filesystem (config files)
   - Custom tools: Security checklist, OWASP scanner
   
5. QA Engineer
   - Agent: Azure OpenAI GPT-4
   - Capabilities: Jest, Supertest, load testing
   - MCPs linked:
     → @modelcontextprotocol/server-filesystem (test files)
     → @modelcontextprotocol/server-git (test commits)
   - Custom tools: Test runner, coverage analyzer

Configuring workspace: /workspace/project-mgmt-api
Validating MCP connections... ✓
Initializing custom tools... ✓

✨ Team 'Project Management API Team' is ready!
All agents have their required tools and MCP access.

[View Team] [Review Tool Access] [Start Workflow]"
```

**Via UI:**
1. Open team workspace
2. Click **"Design with AI"**
3. Chat with Role Manager
4. Refine through conversation
5. Approve to build

**Via API (event-driven messaging with Role Manager agent):**

Behind the scenes, this is **just sending/receiving messages** to/from the Role Manager agent - like a chat interface. No need for multiple APIs.

**Option 1: Event-Driven (WebSocket) - Recommended**

```typescript
// Connect to Role Manager agent
const roleManager = await ping.agents.connect('role-manager')

// Subscribe to agent's messages
roleManager.on('message', (message) => {
  console.log('Role Manager:', message.content)
  
  if (message.type === 'question') {
    // Agent is asking a question
    handleQuestion(message)
  } else if (message.type === 'proposal') {
    // Agent sent team proposal
    showProposal(message.proposal)
  } else if (message.type === 'complete') {
    // Team is built
    console.log('Team ready:', message.team)
  }
})

// Send initial goal message
await roleManager.send({
  content: 'Build a RESTful API for project management'
})

// Agent analyzes, responds with questions
// → You receive via 'message' event

// Reply to agent's questions
await roleManager.send({
  content: 'All features, Node.js with Express, balanced team'
})

// Agent designs team, sends proposal
// → You receive via 'message' event

// Send modification message
await roleManager.send({
  content: 'Add Redis caching to Database Engineer'
})

// Agent updates, sends confirmation
// → You receive via 'message' event

// Send approval message
await roleManager.send({
  content: 'Approved, build the team'
})

// Agent builds team, sends completion
// → You receive final team via 'message' event
```

**Option 2: Message Polling (HTTP)**

```typescript
// Start conversation by sending first message
const conversationId = await ping.messages.send({
  agent: 'role-manager',
  content: 'Build a RESTful API for project management'
})

// Fetch agent's response messages
const messages = await ping.messages.fetch({
  conversationId,
  since: lastMessageId
})

messages.forEach(msg => {
  console.log('Role Manager:', msg.content)
})

// Send your reply
await ping.messages.send({
  conversationId,
  content: 'All features, Node.js with Express, balanced team'
})

// Keep fetching new messages
const newMessages = await ping.messages.fetch({
  conversationId,
  since: lastMessageId
})
```

**What's actually happening:**

```
Your Code                          Backend                Role Manager Agent
   │                                  │                          │
   ├─ send("Build API...") ──────────>│                          │
   │                                  ├─ route to agent ────────>│
   │                                  │                          │ (analyzes goal)
   │                                  │<─ agent message ─────────┤
   │<─ event: message ────────────────┤                          │
   │   "What features?"               │                          │
   │                                  │                          │
   ├─ send("All features...") ───────>│                          │
   │                                  ├─ route to agent ────────>│
   │                                  │                          │ (designs team)
   │                                  │<─ agent message ─────────┤
   │<─ event: message ────────────────┤                          │
   │   {type: 'proposal', team: [...]}│                          │
   │                                  │                          │
   ├─ send("Add Redis...") ──────────>│                          │
   │                                  ├─ route to agent ────────>│
   │                                  │                          │ (updates design)
   │                                  │<─ agent message ─────────┤
   │<─ event: message ────────────────┤                          │
   │   "Updated! Approve?"            │                          │
   │                                  │                          │
   ├─ send("Approved!") ─────────────>│                          │
   │                                  ├─ route to agent ────────>│
   │                                  │                          │ (builds team)
   │                                  │<─ agent message ─────────┤
   │<─ event: message ────────────────┤                          │
   │   {type: 'complete', team: {...}}│                          │
```

**Key insight:** It's just **message passing** - you send messages to the agent, receive messages back. No complex APIs needed. WebSocket for real-time events, or HTTP polling for simple fetching.

### Method 2: Goal-Driven (Quick)

**Let Role Manager analyze your goal without conversation:**

1. Open team workspace
2. Click **"Design Agents"**
3. Enter your goal:

```
"Create a comprehensive API documentation website for our REST service"
```

4. Click **"Analyze"**
5. Wait for Role Manager to complete all 4 phases
6. Review and approve suggested team

**Best for:**
- New teams
- Unfamiliar domains
- Complex projects

### Method 2: Role-Based

**Specify roles you think you need:**

1. Click **"Design Agents"** → **"From Roles"**
2. Describe roles:

```
Roles needed:
- Technical Writer (API documentation)
- Frontend Developer (documentation website)
- DevOps Engineer (hosting and CI/CD)
```

3. Role Manager will:
   - Validate role choices
   - Suggest refinements
   - Add missing roles (if any)
   - Design capabilities

**Best for:**
- When you know required roles
- Augmenting existing teams
- Specific expertise needed

### Method 3: Template-Based

**Start from a template:**

1. Click **"Design Agents"** → **"From Template"**
2. Choose template:
   - Product Team
   - Engineering Team
   - Analytics Team
   - Documentation Team
   - Research Team

3. Customize:
   - Add/remove agents
   - Adjust capabilities
   - Modify tools

**Best for:**
- Standard workflows
- Quick setup
- Learning Ping

---

## Agent Capabilities

Role Manager designs agents with specific **capabilities**:

### Technical Capabilities

**Examples:**
- **Code Generation** - Write Python, TypeScript, etc.
- **System Design** - Architecture patterns, scalability
- **Data Analysis** - SQL, Pandas, visualization
- **API Design** - REST, GraphQL, OpenAPI
- **Testing** - Unit tests, integration tests, E2E

### Domain Capabilities

**Examples:**
- **Product Management** - Requirements, user stories, roadmaps
- **Technical Writing** - Documentation, tutorials, API specs
- **UX Design** - Wireframes, user flows, usability
- **Security** - Threat modeling, authentication, encryption
- **DevOps** - CI/CD, infrastructure, monitoring

### Collaboration Capabilities

**Examples:**
- **Real-Time Editing** - OT/CRDT collaboration on documents
- **Code Review** - Review PRs, suggest improvements
- **Research** - Web search, literature review
- **Project Management** - Task tracking, dependencies

---

## Capability-Based Tool & MCP Linking

**For each agent, Team Builder links tools/MCPs based on required capabilities:**

### The Linking Process

**Step 1: Capability Analysis**
```
Agent: Database Engineer
Capabilities needed:
- PostgreSQL database access
- Redis caching
- Schema migrations
```

**Step 2: MCP Discovery**
```
Searching available MCPs:
✓ @modelcontextprotocol/server-postgres → matches "PostgreSQL"
✓ @modelcontextprotocol/server-redis → matches "Redis caching"  
✗ No MCP for "schema migrations"
```

**Step 3: Tool Creation (for gaps)**
```
Creating custom tool: "migration-generator"
- Input: Schema changes
- Output: SQL migration file
- Access: Database connection via postgres MCP
```

**Step 4: User Approval**
```
Proposed configuration for Database Engineer:

MCPs:
- @modelcontextprotocol/server-postgres (read/write access)
- @modelcontextprotocol/server-redis (read/write access)

Custom Tools:
- migration-generator (creates SQL migrations)
- schema-validator (validates migrations)

Approve this configuration? [Yes] [Modify]
```

**Step 5: Validation**
```
Validating access:
✓ PostgreSQL connection successful
✓ Redis connection successful  
✓ Custom tools registered
✓ Agent can execute all capabilities
```

### Common Capability → Tool Mappings

| Capability | MCP Server | Custom Tools |
|------------|-----------|-------------|
| File system access | `@modelcontextprotocol/server-filesystem` | - |
| Git operations | `@modelcontextprotocol/server-git` | Branch naming conventions |
| Database (Postgres) | `@modelcontextprotocol/server-postgres` | Migration generator, seed data |
| Database (MongoDB) | `@modelcontextprotocol/server-mongodb` | Schema validator |
| Caching (Redis) | `@modelcontextprotocol/server-redis` | Cache invalidation helper |
| Web search | `@modelcontextprotocol/server-brave-search` | Result summarizer |
| Code execution | Custom Python/Node runtime | Package installer |
| API testing | - | HTTP client, test assertion library |
| Diagram generation | - | Mermaid/PlantUML renderer |
| Document editing | `@modelcontextprotocol/server-filesystem` | Markdown formatter, template engine |

### Asking User for MCP/Tool Choices

**When multiple options exist:**

```
🤖 Role Manager:
"For the API Developer agent's database capability, I found 2 options:

Option 1: Use @modelcontextprotocol/server-postgres (PostgreSQL)
- Pros: Direct SQL access, full control
- Cons: Requires schema management

Option 2: Use @modelcontextprotocol/server-mongodb (MongoDB)  
- Pros: Flexible schema, JSON documents
- Cons: No relational queries

Which database would you prefer?"

💬 You: "PostgreSQL"

🤖 Role Manager:
"Linking @modelcontextprotocol/server-postgres to API Developer.
Also creating custom tool: 'orm-query-builder' for easier queries.
Approve?"
```

**When no MCP exists:**

```
🤖 Role Manager:
"For the QA Engineer's load testing capability, no MCP server exists.

I can create a custom tool:
- Name: 'load-test-runner'
- Function: Execute k6 load tests
- Output: Performance metrics, response times

Or you can:
- Install external MCP if available
- Integrate with existing tool (Artillery, JMeter)

Preference?"

💬 You: "Create the custom k6 tool"

🤖 Role Manager:
"Creating 'load-test-runner' tool with k6 integration.
QA Engineer will be able to:
- Define load test scenarios
- Execute tests
- Analyze results
Proceed?"
```

---

## Agent Tools

Role Manager assigns **tools** to agents based on their roles:

### Standard Tools

**File System:**
- Read/write files
- List directories
- File search

**Git:**
- Create branches
- Commit changes
- Create pull requests

**Document Editing:**
- Structured Document Model
- Markdown
- Code editing

### Specialized Tools

**Code Execution:**
- Python interpreter
- Node.js runtime
- Shell commands

**External Services:**
- Web search
- API calls
- Database queries

**Generation:**
- Diagrams (Mermaid, PlantUML)
- Images (DALL-E)
- Charts (matplotlib, D3)

**Example Agent with Tools & MCPs:**

```typescript
{
  role: 'data-analyst',
  name: 'Senior Data Analyst',
  capabilities: [
    'data-analysis',
    'visualization',
    'statistical-modeling'
  ],
  
  // MCPs linked based on capabilities
  mcps: [
    {
      server: '@modelcontextprotocol/server-postgres',
      purpose: 'Query production database for analysis',
      access: 'read-only'
    },
    {
      server: '@modelcontextprotocol/server-filesystem', 
      purpose: 'Save analysis results and reports',
      access: 'read-write'
    }
  ],
  
  // Custom tools created for this agent
  customTools: [
    {
      name: 'python-notebook-runner',
      purpose: 'Execute Jupyter notebooks with Pandas/NumPy',
      implementation: 'Custom Python runtime'
    },
    {
      name: 'chart-generator',
      purpose: 'Create matplotlib/seaborn visualizations', 
      implementation: 'Python visualization wrapper'
    },
    {
      name: 'statistical-analyzer',
      purpose: 'Run statistical tests (t-test, ANOVA, regression)',
      implementation: 'scipy/statsmodels wrapper'
    }
  ],
  
  // Standard tools (available to all agents)
  standardTools: [
    'structured-documents',  // Write reports (Markdown/Word)
    'web-search'            // Research methodologies
  ]
}
```

**Tool configuration approved by user:**
```
💬 User reviewed:
- MCP access to production database (read-only) ✓
- File system access for saving results ✓  
- Python execution with data science libraries ✓
- Custom visualization tools ✓

Configuration approved → Agent ready to work
```

---

## Customizing Agent Design

### Modify Suggested Agents

**After Role Manager suggests a team:**

1. Click **"Modify"** on the approval screen
2. Adjust agents:

**Add capabilities:**
```
System Architect
+ Add: "Cloud infrastructure design"
+ Add: "Cost optimization"
```

**Remove capabilities:**
```
Technical Writer
- Remove: "Video content creation"
```

**Change tools:**
```
Security Engineer
+ Add: "Threat modeling tool"
+ Add: "OWASP checklist"
```

3. Click **"Update and Review"**
4. Role Manager validates changes
5. Approve final design

### Add Custom Agents

**If Role Manager misses a needed role:**

1. Click **"Add Custom Agent"**
2. Provide:

```yaml
Role: Marketing Specialist
Responsibilities:
  - Create product marketing content
  - Write blog posts
  - Social media messaging
Capabilities:
  - Copywriting
  - SEO optimization
  - Audience targeting
Tools:
  - Structured documents
  - Web search
  - Content templates
```

3. Click **"Add to Team"**
4. Role Manager will:
   - Validate the role
   - Suggest complementary capabilities
   - Integrate with existing agents

---

## Agent Specialization

**Agents can be specialized** for specific domains:

### Language/Framework Specialization

```typescript
{
  role: 'software-engineer',
  specialization: {
    languages: ['TypeScript', 'Python'],
    frameworks: ['React', 'Node.js', 'FastAPI'],
    focus: 'Full-stack web development'
  }
}
```

### Industry Specialization

```typescript
{
  role: 'product-manager',
  specialization: {
    industry: 'FinTech',
    expertise: ['Payment systems', 'Regulatory compliance', 'KYC/AML'],
    focus: 'B2B payment products'
  }
}
```

### Custom Instructions

```typescript
{
  role: 'technical-writer',
  customInstructions: `
Write documentation for a non-technical audience.
Use simple language, avoid jargon.
Include code examples in Python and JavaScript.
Follow Google Developer Documentation Style Guide.
  `
}
```

---

## Iterative Refinement Through Conversation

**Team Builder is conversational - refine your team through natural dialogue:**

### Common Refinement Scenarios

#### Scenario 1: Team Too Large

```
\ud83d\udcac You:
"This team has 8 agents - that's too complex for a small project"

\ud83e\udd16 Role Manager:
"Understood. Let me consolidate roles to simplify:

Proposed consolidation:
- Frontend Dev + UX Designer → Full-Stack Designer
- Backend Dev + DevOps → Backend Engineer (with deployment)
- QA + Security → QA/Security Engineer
- Keep Product Manager

Reduced from 8 to 4 agents while maintaining all capabilities.
Review this leaner structure?"

\ud83d\udcac You:
"Perfect, approve it"

\ud83e\udd16 Role Manager:
"\u2705 Building streamlined 4-agent team..."
```

#### Scenario 2: Missing Capability

```
\ud83d\udcac You:
"We need someone to handle data analytics and generate reports"

\ud83e\udd16 Role Manager:
"Adding Data Analyst role to your team:

**Data Analyst**
- Responsibilities: Query data, analyze trends, generate reports
- Capabilities: SQL, data visualization, statistical analysis
- Tools: Database connector, chart generation, report templates

Updated team now has 6 agents. This analyst will work with:
- Backend Developer (access to database)
- Product Manager (requirements for reports)

Approve this addition?"
```

#### Scenario 3: Change Tech Stack

```
\ud83d\udcac You:
"Actually, let's switch from Express to FastAPI (Python)"

\ud83e\udd16 Role Manager:
"Reconfiguring team for Python FastAPI stack...

Updated roles:
- Backend Architect: FastAPI design patterns, async/await
- API Developer: Python, Pydantic, FastAPI middleware
- Database Engineer: SQLAlchemy instead of TypeORM
- Security Engineer: Python security libs (PyJWT, cryptography)
- QA Engineer: Pytest, HTTPX instead of Jest

All agent capabilities reconfigured for Python ecosystem.
Build this Python-based team?"
```

#### Scenario 4: Split Responsibilities

```
\ud83d\udcac You:
"The Backend Developer has too many responsibilities. Can we split this role?"

\ud83e\udd16 Role Manager:
"Good observation. Splitting Backend Developer into two focused roles:

**API Developer** (new)
- Endpoints, routing, middleware
- Request/response handling
- API versioning

**Business Logic Engineer** (new)
- Domain models
- Business rules
- Data processing

Both will collaborate through:
- Shared code repository
- Common database schema
- Coordinated PRs

This increases team size from 5 to 6 agents. Approve?"
```

#### Scenario 5: Adjust Agent Autonomy

```
\ud83d\udcac You:
"The QA Engineer should have more autonomy to write tests without approval"

\ud83e\udd16 Role Manager:
"Increasing QA Engineer autonomy level:

Before:
- Approval required for all test creation
- Manual review of test results

After:
- Auto-approve test file creation
- Autonomous test execution
- Only flag failures for human review

QA Engineer can now:
✓ Write unit tests independently
✓ Run integration tests
✓ Report issues without waiting

Update this configuration?"
```

### Refinement Commands

**Quick modifications via natural language:**

| You Say | Role Manager Does |
|---------|-------------------|
| "Add a DevOps role" | Suggests DevOps Engineer with CI/CD, deployment capabilities |
| "Remove UX Designer" | Removes role, redistributes responsibilities |
| "Make this team smaller" | Consolidates roles to reduce agent count |
| "Add Python expertise" | Adds Python to relevant agent capabilities |
| "Split Frontend Developer" | Creates specialized UI and Component developers |
| "Need security review" | Adds Security Engineer or adds security to existing role |
| "Too expensive" | Suggests using smaller models (GPT-3.5) for some agents |

---

## Team Composition Patterns

Role Manager uses **proven patterns** for team composition:

### Pattern 1: Creator + Reviewer

**Structure:**
- 1 Creator agent (generates content)
- 1 Reviewer agent (validates quality)

**Example:**
```
Technical Writer (creator)
↓ writes documentation
QA Engineer (reviewer)
↓ validates accuracy, completeness
```

**Best for:**
- Documentation
- Reports
- Content creation

### Pattern 2: Specialist Collaboration

**Structure:**
- Multiple specialists (each owns a domain)
- Collaborate on shared artifacts

**Example:**
```
Frontend Developer
Backend Developer    } → Full-stack application
DevOps Engineer
```

**Best for:**
- Software development
- Complex systems
- Multi-disciplinary work

### Pattern 3: Research + Analysis + Writing

**Structure:**
- Researcher (gathers information)
- Analyst (processes data)
- Writer (produces deliverable)

**Example:**
```
Market Researcher
↓ collects competitor data
Data Analyst
↓ analyzes trends
Business Writer
↓ creates report
```

**Best for:**
- Reports
- Analysis projects
- Strategic planning

### Pattern 4: Iterative Refinement

**Structure:**
- All agents work on same artifact
- Real-time collaboration
- Continuous improvement

**Example:**
```
Product Manager    }
Technical Writer   } → Requirements Document
UX Designer        }   (real-time OT/CRDT)
```

**Best for:**
- Brainstorming
- Living documents
- Agile workflows

---

## Best Practices

### 1. Clear Goals

**Good goal descriptions:**
```
✅ "Create API documentation for our user management service,
   including authentication endpoints, user CRUD operations,
   and code examples in Python and JavaScript"

✅ "Analyze Q4 sales data to identify top-performing products,
   regional trends, and create executive summary with visualizations"
```

**Poor goal descriptions:**
```
❌ "Make some docs"
❌ "Do data stuff"
```

### 2. Trust Role Manager

**Do:**
- Start with Role Manager's suggestions
- Review rationale before modifying
- Test suggested team before major changes

**Don't:**
- Immediately customize without trying
- Add agents "just in case"
- Override without understanding

### 3. Iterative Refinement

**Approach:**
1. Let Role Manager design initial team
2. Run a small workflow
3. Observe agent performance
4. Add/remove agents based on results
5. Repeat

### 4. Right-Sizing

**Avoid:**
- Too few agents (lacks diversity)
- Too many agents (coordination overhead)

**Aim for:**
- 3-7 agents per team
- Clear role boundaries
- Minimal overlap

### 5. Capability Balance

**Ensure agents have:**
- **Technical** capabilities (do the work)
- **Domain** expertise (understand context)
- **Collaboration** skills (work together)

---

## Troubleshooting

### Issue: Role Manager suggests too many agents

**Cause:** Goal is too broad

**Fix:**
```
Before: "Build a mobile app"
After: "Design the authentication flow for a mobile app"
```

### Issue: Missing specialized capabilities

**Cause:** Goal lacks domain context

**Fix:**
```
Before: "Write technical documentation"
After: "Write technical documentation for a Kubernetes operator,
        targeting DevOps engineers familiar with container orchestration"
```

### Issue: Agents have overlapping responsibilities

**Cause:** Unclear role boundaries

**Fix:**
- Review Role Manager's suggested responsibilities
- Modify to clarify scope
- Example: "Frontend Developer" vs "React Developer (client-side only)"

---

## Next Steps

- **[Creating Teams](./creating-teams.md)** - Set up teams for your agents
- **[Reviewing Artifacts](./reviewing-artifacts.md)** - Approve agent outputs
- **[Orchestrator API](../api/orchestrator-api.md)** - Run workflows programmatically

---

**Team Builder makes agent design intelligent and effortless.** Let Role Manager discover the optimal team for your goals! 🤖
