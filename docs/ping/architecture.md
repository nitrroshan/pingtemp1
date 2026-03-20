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

## Component Interaction (Runtime)

> **Key Insight:** 
> - **RoleManager** creates the team (agents)
> - **AgentManager** coordinates the team (plan, distribute, track)
> - **Tools invoke agents** — Orchestrator tools call PlanBuilder, workers, etc.

```
                    ┌─────────────────────────────────────┐
                    │           RoleManager               │
                    │   (Creates team of agents)          │
                    │                                     │
                    │  • Uses RoleBuilder agent           │
                    │  • Uses ConfigBuilder agent         │
                    │  • Registers agents as team         │
                    └──────────────────┬──────────────────┘
                                       │ Team (agents ready to work)
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     AgentManager                             │
│              (Coordinates the team)                          │
│                                                              │
│  • Receives goals                                            │
│  • Holds team agents (for chat + task execution)             │
│  • Uses Orchestrator to plan & distribute                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     ┌─────────────────┐         ┌─────────────────────────────┐
     │ Direct Chat     │         │ Orchestrator (Brain)        │
     │                 │         │                             │
     │ User ↔ Agent    │         │ Tools invoke agents:        │
     │ (conversation)  │         │ • create_plan → PlanBuilder │
     └─────────────────┘         │ • queue_task → TaskQueue    │
                                 │ • replan → PlanBuilder      │
                                 └──────────────┬──────────────┘
                                                │
                              ┌─────────────────┼─────────────────┐
                              ▼                 ▼                 ▼
                       ┌───────────┐     ┌───────────┐     ┌───────────┐
                       │PlanBuilder│     │  Worker   │     │  Worker   │
                       │  (agent)  │     │  (agent)  │     │  (agent)  │
                       └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
                             │                 │                 │
                             ▼                 ▼                 ▼
                       ┌───────────────────────────────────────────────┐
                       │              MemoryManager                     │
                       │  • Stores tasks                                │
                       │  • Tracks progress                             │
                       │  • Manages dependencies                        │
                       └───────────────────────────────────────────────┘
```

**Component Summary:**

| Component | Responsibility | Tools/Agents It Uses |
|-----------|----------------|----------------------|
| **RoleManager** | Creates team of agents | RoleBuilder agent, ConfigBuilder agent |
| **AgentManager** | Coordinates team work | Orchestrator, team agents |
| **Orchestrator** | Plans & distributes tasks | PlanBuilder agent, worker agents |
| **PlanBuilder** | Creates task plan | (structured output agent) |
| **Workers** | Execute tasks | (tools, LLM reasoning) |
| **MemoryManager** | Tracks task state | (data store) |

**Tools = Agent Invocations:**

| Tool | Agent It Calls |
|------|----------------|
| `create_plan` | PlanBuilder (InternalAgent with responseFormat) |
| `queue_task` | Adds to TaskQueue (agents poll for their role) |
| `replan` | PlanBuilder with failure context |
| `get_status` | MemoryManager (not an agent, just data) |

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

### 2. AgentManager (Runtime - Team Coordinator)

**Location:** `packages/ping/src/orchestrator/`

**Current Implementation:** `AgentManager.ts` (being refactored)

> **Architecture Decision (Jan 22, 2026):** 
> - **RoleManager** creates agents and registers them as a team
> - **AgentManager** coordinates the team: plans tasks, distributes work, syncs context & artifacts
> - **Orchestrator** is AgentManager's brain — actively coordinates task flow between agents

**Clear Separation:**

| Component | Responsibility |
|-----------|----------------|
| **RoleManager** | Creates agents, registers them as team members |
| **AgentManager** | Holds team, provides API for chat/goals |
| **Orchestrator** | Actively coordinates: assigns tasks, syncs context, collects artifacts |

```
┌─────────────────────────────────────────────────────────────┐
│                      RoleManager                             │
│  • Decides what agents are needed                            │
│  • Creates agents (via RoleBuilder agent)                    │
│  • Registers agents as team members                          │
└─────────────────────────────┬────────────────────────────────┘
                              │ Team of Agents
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      AgentManager                            │
│  • Holds team agents                                         │
│  • Exposes API: chatWithAgent(), handleGoal()               │
│  • Delegates orchestration to Orchestrator                   │
├─────────────────────────────────────────────────────────────┤
│  chatWithAgent(agentId, message)  ←── Direct agent chat     │
│  handleGoal(teamId, goal)         ←── Orchestrate all tasks │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Orchestrator (AgentManager's Brain)             │
│                                                              │
│  ACTIVE COORDINATION:                                        │
│  • Assigns tasks to agents (one agent can have many tasks)   │
│  • Syncs task info: AgentManager ↔ Agents                   │
│  • Provides context TO agents (from other agents' outputs)   │
│  • Collects context FROM agents (for dependent tasks)        │
│  • Syncs artifacts/outputs to ArtifactStore                  │
│                                                              │
│  Tools (invoke other agents):                                │
│  • create_plan → PlanBuilder agent                           │
│  • queue_task → adds to TaskQueue (by role)                  │
│  • sync_artifacts → ArtifactStore                            │
│  • replan → PlanBuilder agent                                │
└──────────────────────────────────────────────────────────────┘
```

### Task Queue Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK QUEUE (by role)                         │
│                  Managed by Orchestrator                        │
├────────────────────┬───────────────────┬────────────────────────┤
│  writer: [task1]   │  editor: [task3]  │  researcher: []        │
│          [task2]   │                   │                        │
└──────────┬─────────┴─────────┬─────────┴─────────┬──────────────┘
           │ polls             │ polls             │ polls
           ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌─────────────┐
    │  Writer   │       │  Editor   │       │  Researcher │
    │  Agent    │       │  Agent    │       │  Agent      │
    └───────────┘       └───────────┘       └─────────────┘
```

### Orchestrator's Core Jobs

**1. Task Queue Management**
- Central **TaskQueue** organized by role
- Orchestrator adds tasks via `queue_task` tool
- Agents **poll** tasks for their role
- Agents can maintain their own internal queue for tracking

**2. queue_task Flow**
```typescript
// Orchestrator adds task to central TaskQueue
const queueTaskTool = tool(async ({ taskId }, context) => {
  const task = memoryManager.getTask(taskId);
  
  // Gather context from completed dependencies
  const ctx = await gatherContext(task.dependencies);
  
  // Add to TaskQueue by role - agent will poll for it
  taskQueue.enqueue(task.assigned_role, {
    ...task,
    context: ctx
  });
  
  return { queued: true, role: task.assigned_role };
});
```

**3. Agent Instance (Polls from TaskQueue)**
```typescript
// Agent polls tasks from central TaskQueue for its role
// Like a Claude.ai session that picks up work
class AgentInstance {
  private role: string;
  private internalQueue: Task[] = [];  // Optional: agent's own tracking
  private conversation: Message[] = [];
  private mode: 'interactive' | 'auto' = 'interactive';
  
  constructor(config: AgentConfig, user: User, private taskQueue: TaskQueue) {
    this.role = config.role;
    
    // Listen for tasks available for this role
    this.taskQueue.onTaskAvailable(({ role }) => {
      if (role === this.role) {
        this.pollTask();
      }
    });
  }
  
  // User starts the agent
  static async start(role: string, user: User, taskQueue: TaskQueue): Promise<AgentInstance> {
    const config = await factory.getConfig(role);
    const instance = new AgentInstance(config, user, taskQueue);
    agentManager.registerAgent(instance);
    return instance;
  }
  
  // Poll task from central queue
  private async pollTask() {
    const task = this.taskQueue.poll(this.role);
    if (task) {
      this.internalQueue.push(task);  // Track internally
      await this.startTask(task);
    }
  }
  
  // Start working on task
  private async startTask(task: TaskWithContext) {
    this.conversation.push({
      role: 'system',
      content: `Task: ${task.description}\nContext: ${JSON.stringify(task.context)}`
    });
    
    if (this.mode === 'auto') {
      await this.runAutoMode(task.id);
    }
    // Interactive: user chats with agent
  }
  
  // User chats with agent
  async chat(message: string): Promise<string> {
    this.conversation.push({ role: 'user', content: message });
    const response = await this.execute({ messages: this.conversation });
    this.conversation.push({ role: 'assistant', content: response });
    return response;
  }
  
  // User completes task
  completeTask(taskId: string) {
    this.emit('task:complete', { taskId, output: this.conversation });
  }
  
  // Auto mode
  private async runAutoMode(taskId: string) {
    const result = await this.execute({ messages: this.conversation });
    this.emit('task:complete', { taskId, output: result });
  }
}
```

**Why agents are like Claude.ai/OpenAI?**
- **User-initiated**: Users start agent instances for specific work
- **Interactive by default**: User chats with agent until work is done
- **Auto mode available**: Agent works independently, completes on its own
- **Session-based**: No intermediate results — work continues until session ends

**Agent Execution Modes:**

| Mode | How It Works | Task Ends When |
|------|--------------|----------------|
| **Interactive** (default) | User chats with agent back and forth | User says "done" or closes session |
| **Auto** | Agent works independently | Agent completes the work |

**4. Agent Lifecycle (User-Initiated, Polls from TaskQueue)**
```
┌─────────────┐     starts      ┌─────────────┐
│    User     │ ───────────────▶│   Agent     │  ← Like opening Claude.ai
│             │                 │  Instance   │
└─────────────┘                 └──────┬──────┘
                                       │
                                       │ registers with
                                       ▼
┌─────────────┐                 ┌─────────────┐
│ Orchestrator│ ──queue_task───▶│  TaskQueue  │
│             │   (by role)     │  (central)  │
│             │                 └──────┬──────┘
│             │                        │ polls
│             │                        ▼
│             │                 ┌─────────────┐
│             │ ◀──task:done────│   Agent     │
└─────────────┘                 │  Instance   │
                                └─────────────┘
```

**5. Context Sync (Event-Driven)**
```
┌─────────────┐                      ┌─────────────┐
│   Agent A   │ ─── task:complete ──▶│ Orchestrator│
│  (writer)   │      (event)         │             │
└─────────────┘                      │  Listens,   │
                                     │  gathers    │
┌─────────────┐                      │  context,   │
│  TaskQueue  │ ◀─── queue_task ─────│  queues     │
│  (editor)   │    (with context)    │  next task  │
└──────┬──────┘                      └─────────────┘
       │ polls
       ▼
┌─────────────┐
│   Agent B   │
│  (editor)   │
└─────────────┘
```

**6. Artifact Sync**
- Agents emit `task:complete` with output
- Orchestrator stores in ArtifactStore
- Context passed to dependent tasks at assignment time

### Task Queueing Flow

```typescript
// User starts agent instances (like opening Claude.ai chats)
const writerAgent = await user.startAgent('writer');  // User initiates
const editorAgent = await user.startAgent('editor');  // User initiates

// Agents register with AgentManager and listen to TaskQueue
agentManager.registerAgent(writerAgent);
agentManager.registerAgent(editorAgent);

// Orchestrator queues tasks to central TaskQueue (by role)
await orchestrator.tools.queue_task({
  taskId: 'task-1',
  // Task includes: role, description, dependencies, context
});

// Agent polls from TaskQueue for its role
writerAgent.taskQueue.onTaskAvailable(({ role }) => {
  if (role === 'writer') {
    const task = taskQueue.poll('writer');  // Get task with context
    writerAgent.startTask(task);
  }
});

// Agent handles the task (like Claude processing your message)
// User can interact with the agent during execution
writerAgent.on('task:complete', ({ taskId, result }) => {
  // Orchestrator syncs artifacts and queues next tasks
  artifactStore.store(result);
  memoryManager.completeTask(taskId, result);
  
  // Check for dependent tasks now ready
  const readyTasks = memoryManager.getReadyTasks();
  for (const task of readyTasks) {
    orchestrator.tools.queue_task({ taskId: task.id });
  }
});
```

### Orchestrator Tools

| Tool | Purpose |
|------|---------|
| `create_plan` | Calls PlanBuilder agent → tasks with dependencies |
| `queue_task` | Adds task + context to TaskQueue (by role) |
| `sync_artifacts` | Stores agent outputs in ArtifactStore |
| `get_context` | Retrieves outputs from completed tasks |
| `replan` | Calls PlanBuilder when task fails |
| `get_status` | Checks TaskQueue and agent status |

> **Note:** Orchestrator **queues** tasks by role; agents **poll** for their tasks. This enables parallel execution and fault isolation.

**Note:** `discover_roles` and `generate_config` are **RoleManager's responsibility**, not Orchestrator's.

**Two Interaction Modes:**

| Mode | Use Case | Method |
|------|----------|--------|
| **Chat Mode** | User talks to specific team agent | `chatWithAgent(agentId, message)` |
| **Goal Mode** | User gives goal, AgentManager coordinates team | `handleGoal(teamId, goal)` |

**Example Flow:**
```typescript
// AgentManager supports both modes
class AgentManager {
  private orchestrator: InternalAgent;
  private agentRegistry: Map<string, IAgent>;
  private factory: AgentFactory;
  
  // MODE 1: Direct agent chat (user talks to specific agent)
  async chatWithAgent(agentId: string, message: string, threadId: string): Promise<AgentResponse> {
    let agent = this.agentRegistry.get(agentId);
    if (!agent) {
      agent = this.factory.create(agentId);
      this.agentRegistry.set(agentId, agent);
    }
    return agent.execute({ message, threadId });
  }
  
  // MODE 2: Goal orchestration (system coordinates workflow)
  async handleGoal(teamId: string, goal: string): Promise<void> {
    await this.orchestrator.execute({ 
      teamId, 
      goal,
      agentRegistry: this.agentRegistry  // Orchestrator registers spawned agents
    });
    // Orchestrator decides: discover_roles? create_plan? spawn_agent? etc.
    // Spawned agents become available for direct chat
  }
}
```

### How Other Components Fit

The Orchestrator tools wrap calls to other components. Here's the full picture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR TOOLS                               │
├──────────────────┬──────────────────────────────────────────────────────┤
│ discover_roles   │ → RoleBuilder (InternalAgent with responseFormat)    │
│                  │ → RoleManager.registerRole() to save discovered roles│
├──────────────────┼──────────────────────────────────────────────────────┤
│ generate_config  │ → ConfigBuilder (InternalAgent with responseFormat)  │
│                  │ → AgentFactory.register() to cache configs           │
├──────────────────┼──────────────────────────────────────────────────────┤
│ create_plan      │ → PlanBuilder (InternalAgent with responseFormat)    │
│                  │ → MemoryManager.addTasks() to track execution        │
├──────────────────┼──────────────────────────────────────────────────────┤
│ spawn_agent      │ → AgentFactory.create(config)                        │
│                  │ → RoleManager.addWorker() to register                │
├──────────────────┼──────────────────────────────────────────────────────┤
│ queue_task       │ → TaskQueue.enqueue(role, task + context)            │
│                  │ → Agent polls for its role's tasks                   │
├──────────────────┼──────────────────────────────────────────────────────┤
│ replan           │ → PlanBuilder with failure context                   │
│                  │ → MemoryManager.updateTasks() with new plan          │
└──────────────────┴──────────────────────────────────────────────────────┘
```

**Component Roles in New Architecture:**

| Component | Old Role | New Role |
|-----------|----------|----------|
| **AgentManager** | Orchestration logic (~500 lines) | Thin wrapper (~100 lines) - just hosts Orchestrator |
| **RoleManager** | Called by AgentManager directly | Called via `discover_roles` and `spawn_agent` tools |
| **MemoryManager** | Called by AgentManager directly | Called via `create_plan` and `queue_task` tools |
| **TaskQueue** | N/A | Central queue by role, agents poll |
| **AgentFactory** | Held by AgentManager | Held by AgentManager, passed to Orchestrator tools |
| **Builders** | Separate `type: builder` agents | Now `type: internal` with `responseFormat` |

---

### 3. Role Manager (Dual Mode)

**Location:** 
- Design Mode: `packages/team-builder/src/role-manager/`
- Runtime: `packages/ping/src/role-manager/`

> **Orchestrator Integration:** RoleManager is called via Orchestrator tools, not directly by AgentManager.

#### Design Mode: Role Creation UI

The frontend can create roles in two ways:

**1. AI-Assisted (Meta-Agent Flow):**
```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Frontend   │────▶│   RoleManager    │────▶│   RoleBuilder    │
│   (React)    │     │   (Meta-Agent)   │     │  (InternalAgent) │
└──────┬───────┘     └────────┬─────────┘     └────────┬─────────┘
       │                      │                        │
       │ "I need support      │ analyze()              │ execute()
       │  agents"             │ suggest()              │ → roles[]
       │                      │                        │
       ▼                      ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  API: POST /api/teams/:teamId/roles/suggest                     │
│  Body: { description: "..." }                                   │
│  Response: { suggestions: [{ name, goal, capabilities }...] }   │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ User reviews & approves
┌─────────────────────────────────────────────────────────────────┐
│  API: POST /api/teams/:teamId/roles                             │
│  Body: { roles: [...approvedRoles] }                            │
└─────────────────────────────────────────────────────────────────┘
```

**2. Manual Creation (Direct Form):**
```
┌──────────────┐     ┌──────────────────┐
│   Frontend   │────▶│   RoleManager    │
│  (Role Form) │     │   .createRole()  │
└──────────────┘     └──────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  API: POST /api/teams/:teamId/roles                             │
│  Body: { name, goal, capabilities, responsibilities, ... }     │
└─────────────────────────────────────────────────────────────────┘
```

**RoleManager Meta-Agent Interface (Design Mode):**
```typescript
interface RoleManagerMetaAgent {
  // AI-Assisted role creation
  analyze(context: TeamContext): Promise<RoleDecision>
  suggestRoles(description: string): Promise<AgentRole[]>  // Uses RoleBuilder
  
  // Human approval layer
  validateRoles(roles: AgentRole[]): Promise<ValidationResult>
  
  // Persist roles
  createRole(teamId: string, role: AgentRole): Promise<void>
  updateRole(teamId: string, roleId: string, updates: Partial<AgentRole>): Promise<void>
  deleteRole(teamId: string, roleId: string): Promise<void>
  
  // Instantiate at runtime
  instantiate(roleSpec: AgentRole): Promise<IAgent>
}
```

**How Orchestrator Uses RoleManager:**
```typescript
// discover_roles tool
const discoverRolesTool = tool(async ({ goal }, { roleManager, factory }) => {
  // 1. Call RoleBuilder to discover roles
  const roleBuilder = factory.create('role-builder');
  const roles = await roleBuilder.execute({ goal });
  
  // 2. Register discovered roles with RoleManager
  for (const role of roles.structuredResponse) {
    roleManager.registerRole(role);
  }
  
  return roles.structuredResponse;
});

// spawn_agent tool
const spawnAgentTool = tool(async ({ config }, { roleManager, factory }) => {
  // 1. Create agent from config
  const agent = factory.create(config);
  
  // 2. Register as worker with RoleManager
  roleManager.addWorker(config.role, agent);
  
  return { agentId: agent.id, role: config.role };
});
```

**Design Mode (Meta-Agent):**
- Think: Analyze need for new roles
- Plan: Design role specifications
- Suggest: Human approval layer
- Build: Instantiate agents at runtime

**Runtime (Agent Registry):**
- Manage agent registry per team
- Track agent capabilities
- Register agents that poll from TaskQueue
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

// Runtime - Called by Orchestrator tools
interface RoleManagerRuntime {
  registerRole(role: AgentRole): void
  addWorker(role: string, agent: IAgent): void
  getWorker(role: string): IAgent | undefined
  getAgentsByTeam(teamId: string): IAgent[]
  trackProgress(agentId: string): AgentProgress
}
```

---

### 4. Task Planner (Runtime) → Now PlanBuilder

**Location:** `packages/ping/src/task-planner/`

> **Architecture Change:** Task Planner is now the `PlanBuilder` agent (type: internal with responseFormat). It's invoked via the `create_plan` Orchestrator tool.

**How Orchestrator Uses Task Planner:**
```typescript
// create_plan tool
const createPlanTool = tool(async ({ goal, roles }, { factory, memoryManager }) => {
  // 1. Call PlanBuilder to decompose goal
  const planBuilder = factory.create('plan-builder');
  const plan = await planBuilder.execute({ goal, roles });
  
  // 2. Add tasks to MemoryManager for tracking
  for (const task of plan.structuredResponse.tasks) {
    memoryManager.addTask({
      id: task.id,
      description: task.description,
      assigned_role: task.role.toLowerCase(),
      status: task.dependencies.length > 0 ? 'pending' : 'ready',
      prerequisites: new Map(task.dependencies.map(d => [d, false]))
    });
  }
  
  return plan.structuredResponse;
});
```

**Responsibilities:**
- Decompose team goals into executable tasks
- Define task dependencies (DAG)
- Set output expectations per task

**Key Components:**
- `PlanBuilder.yaml` - Agent definition with `responseFormat: AgentPlanSchema`
- `AgentPlanSchema.ts` - Zod schema for plan output
- `DependencyGraph.ts` - Validates DAG (no cycles)

---

### 5. Memory Manager (Runtime) → State Tracker

**Location:** `packages/ping/src/state-manager/`

> **Orchestrator Integration:** MemoryManager is updated via `create_plan`, `queue_task`, and `replan` tools.

**How Orchestrator Uses MemoryManager:**
```typescript
// queue_task tool - adds task to central TaskQueue
const queueTaskTool = tool(async ({ taskId }, { taskQueue, memoryManager, artifactStore }) => {
  const task = memoryManager.getTask(taskId);
  
  // Gather context from completed dependencies
  const context = {
    previousOutputs: [],
    artifacts: []
  };
  
  for (const depId of task.dependencies) {
    const depTask = memoryManager.getTask(depId);
    if (depTask.status === 'completed') {
      context.previousOutputs.push({
        taskId: depId,
        output: depTask.output
      });
    }
  }
  
  // Add to TaskQueue - agent will poll for it
  taskQueue.enqueue(task.assigned_role, {
    ...task,
    context
  });
  
  memoryManager.updateTask(taskId, { status: 'queued' });
    return { success: false, error: error.message };
  }
});
```

**Responsibilities:**
- Track task status (ready, pending, in_progress, completed, failed)
- Manage dependencies (unblock tasks when prerequisites complete)
- Store task outputs
- Provide ready tasks to Orchestrator

**Key Interface:**
```typescript
interface MemoryManager {
  addTask(task: Task): void
  getTask(id: string): Task
  getReadyTasks(): Task[]
  completeTask(id: string, output: any): void
  failTask(id: string, error: string): void
  isComplete(): boolean
}
```

---

### 6. Artifact Store (Runtime - NEW)

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

### 7. Approval & Governance (Runtime - NEW)

**Location:** `packages/ping/src/approval/`

> **Future Orchestrator Tool:** `await_approval` tool for human-in-the-loop checkpoints.

**Responsibilities:**
- Validate agent outputs
- Control artifact merges
- Maintain audit trail

**Key Components:**
- `OutputValidator.ts` - Validate outputs
- `ApprovalQueue.ts` - Manage approval requests
- `AuditLog.ts` - Track all approvals

---

### 8. Agent Factory (Runtime - Agent Creation)

**Location:** `packages/ping/src/agent-factory/`

> **Orchestrator Integration:** Factory is held by AgentManager and passed to Orchestrator tools. Used by `spawn_agent` and builder tools.

**Responsibilities:**
- Create agents from YAML definitions or configs
- Cache agent instances for reuse
- Manage agent lifecycle

**Key Interface:**
```typescript
interface AgentFactory {
  create(idOrConfig: string | AgentConfig): IAgent
  get(id: string): IAgent | undefined
  register(definition: AgentDefinition): void
  getDefault(): AgentFactory  // Singleton accessor
}
```

---

### 9. Agent Worker → Now InternalAgent

**Location:** `packages/ping/src/agent-worker/`

> **Architecture Change:** AgentWorker is now `InternalAgent` - unified implementation for both tool-using workers and structured-output builders.

**How Agents Poll from TaskQueue:**
```typescript
// Agent polls for tasks matching its role
const task = taskQueue.poll('writer');  // Returns TaskWithContext
if (task) {
  const result = await agent.execute({ 
    message: task.description,
    context: task.context,
    threadId: `task-${task.id}`
  });
  agent.emit('task:complete', { taskId: task.id, output: result });
}
```

**Responsibilities:**
- Poll tasks from TaskQueue for its role
- Execute tasks via LangChain agent
- Handle tools (MCP, builtin, custom)
- Return structured output when `responseFormat` is set
- Emit `task:complete` / `task:failed` events

---

### 10. Ping UI (Runtime - Team Workspace)

**Location:** `packages/ping/src/ui/` (React frontend)

**Current Implementation:** `src/AgentChat/`

**What Changes:** Team-centric interface + Orchestrator visibility

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
| Suggest Phase | RoleManager.suggestRoles() | 🔄 Planned (uses RoleBuilder) |
| Build Phase | Agent instantiation | ❌ Missing (MVP feature) |
| Role Creation UI | Frontend forms + API | 🔄 Planned |
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
