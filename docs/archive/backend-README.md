# Backend Documentation - Worker Runtime

## Overview
The Worker runtime is a sophisticated multi-agent orchestration system that coordinates AI agents to collaborate on complex tasks. It manages role discovery, agent initialization, task planning, execution, and inter-agent communication using LangGraph and Azure OpenAI.

## Architecture

```
src/worker/
├── agentManager/           # Core orchestration logic
│   ├── agentManager.ts    # Main orchestrator
│   ├── Agent.ts           # LangGraph agent wrapper
│   ├── AgentConfig.ts     # Agent configuration interface
│   └── agentBuilder/      # Builder agents (ROLE, CONFIG, PLAN)
├── AgentWorker/           # Worker execution engine
│   ├── AgentWorker.ts     # Task execution and event emission
│   └── IAgentWorker.ts    # Worker interface
├── roleManager/           # Role discovery and management
│   └── RoleManager.ts     # Role lifecycle management
├── memoryManager/         # Task and context storage
│   └── MemoryManager.ts   # Task lifecycle and dependencies
├── api/                   # REST API endpoints
├── util/                  # Utilities (TaskQueue, etc.)
└── types/                 # TypeScript type definitions
```

## Core Components

### AgentManager
The top-level orchestrator responsible for coordinating the entire multi-agent workflow.

**File**: [agentManager/agentManager.ts](../../src/worker/agentManager/agentManager.ts)

**Responsibilities**:
1. Discovers roles needed for a task via RoleManager
2. Generates execution plans via Plan Builder
3. Initializes agent workers with configurations
4. Manages task distribution and dependencies
5. Coordinates inter-agent communication
6. Subscribes to task completion events

**Key Methods**:
```typescript
async planTasksForRoles(taskDescription: string, roles: RoleDescriptor[]): Promise<Plan>
async assignTasksToWorkers(tasks: Task[]): Promise<void>
async waitForCompletion(): Promise<void>
```

**Workflow**:
```
User Task → Role Discovery → Config Generation → Worker Init 
→ Plan Generation → Task Assignment → Execution → Completion
```

**Events**:
- Subscribes to `taskComplete` events from workers
- Updates MemoryManager with task results
- Triggers dependent tasks when prerequisites complete

### RoleManager
Discovers and manages agent roles required for task execution.

**File**: [roleManager/RoleManager.ts](../../src/worker/roleManager/RoleManager.ts)

**Responsibilities**:
1. Suggests roles for given task using ROLE Builder
2. Generates agent configurations using CONFIG Builder
3. Initializes workers with proper response formats
4. Maintains registry of active workers

**Key Methods**:
```typescript
async getRoles(taskDescription: string): Promise<RoleDescriptor[]>
async getRoleWorkers(taskDescription: string): Promise<Record<string, AgentWorker>>
```

**Role Discovery Process**:
```typescript
// 1. Call Role Builder to identify needed roles
const roles = await roleBuilder.runAgent(taskDescription);

// 2. For each role, generate configuration
const config = await configBuilder.runAgent(prompt);

// 3. Initialize agent with configuration
const agent = new Agent(agentConfig);
const worker = new AgentWorker(agent);

// 4. Register worker by lowercase role name
this.roleWorkers[role.toLowerCase()] = worker;
```

**Default Fallback**:
If role builder fails, falls back to a single `GeneralAgent` role.

### MemoryManager
Manages task lifecycle, dependencies, and execution state.

**File**: [memoryManager/MemoryManager.ts](../../src/worker/memoryManager/MemoryManager.ts)

**Data Structure**:
```typescript
interface Task {
  id: string;
  description: string;
  assigned_role: string;      // Lowercase role key
  context?: string;
  status: 'ready' | 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: any;
  prerequisites: Map<string, boolean>;  // taskId -> completed
  dependants: string[];                 // Tasks waiting on this
}
```

**Status Lifecycle**:
1. **ready**: Can be taken up for execution (all prerequisites met or none)
2. **pending**: Dependencies need completion first
3. **in_progress**: Assigned to agent and executing
4. **completed**: Final output returned
5. **failed**: Task failed during execution

**Key Methods**:
```typescript
addTask(task: Task): void
getTasks(role: string): Task[]          // Returns ready tasks for role
updateTaskStatus(taskId: string, status: Status): void
completeTask(taskId: string, outputData: any): void
isComplete(): boolean                    // All tasks completed?
```

**Dependency Resolution**:
- Tasks with no prerequisites are immediately ready
- When a task completes, updates all dependent tasks' prerequisites
- Automatically promotes tasks to ready when all prerequisites complete

### AgentWorker
Executes tasks using LangGraph agents and emits completion events.

**File**: [AgentWorker/AgentWorker.ts](../../src/worker/AgentWorker/AgentWorker.ts)

**Features**:
- Task queue for serialized execution per worker
- Event-driven completion notifications
- Message history management for context
- LangGraph checkpoint integration

**Key Methods**:
```typescript
async createTask(input: string): Promise<void>
getMessages(): any[]
private async callAgent(input: string, thread_id: string): Promise<any>
```

**Event Emission**:
```typescript
this.events.emit('taskComplete', {
  input: taskInput,
  result: agentResponse,
  content: extractedContent
});
```

**Task Queue**:
- Ensures tasks execute serially per worker
- Prevents race conditions
- Maintains context consistency

### Agent
Creates and configures LangGraph agents with Azure OpenAI and optional MCP tools.

**File**: [agentManager/Agent.ts](../../src/worker/agentManager/Agent.ts)

**Configuration**:
```typescript
interface AgentConfig {
  role: string;
  goal: string;
  systemPrompt: string;
  responseFormat?: ZodSchema;   // Structured output schema
  tools?: any[];                // LangChain tools
  mcpClientConfigs?: Record<string, MCPConfig>;  // MCP tool servers
}
```

**Initialization**:
1. Creates Azure OpenAI model with deployment config
2. Loads MCP tools if configured
3. Binds response format schema if provided
4. Creates LangGraph agent with `MemorySaver` checkpointer
5. Wraps with structured output extraction middleware

**Critical Requirements**:
- Always pass `thread_id` in `agent.invoke()` for checkpointing
- Use `{ configurable: { thread_id: "..." } }` in invoke config
- Response format schemas must be strict; prompts must return valid JSON

## Builder Agents

Builder agents are specialized LLM-based agents that generate roles, configurations, and plans.

### ROLE Builder
**Purpose**: Identifies roles needed for a task

**Input**: Task description

**Output**: Array of role descriptors
```typescript
[
  { name: "ResearchAgent", goal: "Gather information" },
  { name: "WriterAgent", goal: "Create content" }
]
```

**Fallback**: Single `GeneralAgent` if builder fails

### CONFIG Builder
**Purpose**: Generates agent configuration for a specific role

**Input**: Task + Role descriptor

**Output**: Agent configuration
```typescript
{
  role: "ResearchAgent",
  goal: "Research the topic thoroughly",
  systemPrompt: "You are a research specialist...",
  tools: [...],
  mcpClientConfigs: {...}
}
```

### PLAN Builder
**Purpose**: Creates execution plan with task dependencies

**Input**: Task + Available roles

**Output**: Structured plan
```typescript
{
  tasks: [
    { role: "ResearchAgent", task: "...", dependencies: [] },
    { role: "WriterAgent", task: "...", dependencies: ["task-1"] }
  ],
  rationale: "Research must complete before writing"
}
```

## Task Assignment Flow

### 1. Initialize System
```typescript
const agentManager = new AgentManager();
```

### 2. Discover Roles
```typescript
const roles = await agentManager.roleManager.getRoles(taskDescription);
// roles = [{ name: "Role1", goal: "..." }, ...]
```

### 3. Generate Plan
```typescript
const plan = await agentManager.planTasksForRoles(taskDescription, roles);
// plan = { tasks: [...], rationale: "..." }
```

### 4. Add Tasks to Memory
```typescript
plan.tasks.forEach(task => {
  agentManager.memoryManager.addTask({
    id: generateId(),
    description: task.task,
    assigned_role: task.role.toLowerCase(),  // IMPORTANT: lowercase!
    status: task.dependencies.length > 0 ? 'pending' : 'ready',
    prerequisites: new Map(task.dependencies.map(d => [d, false])),
    dependants: []
  });
});
```

### 5. Initialize Workers
```typescript
const workers = await agentManager.roleManager.getRoleWorkers(taskDescription);
// workers = { "role1": AgentWorker, "role2": AgentWorker }
```

### 6. Assign and Execute
```typescript
await agentManager.assignTasksToWorkers(plan.tasks);
// Non-blocking: subscribes to taskComplete events per task
```

### 7. Wait for Completion
```typescript
await agentManager.waitForCompletion();
```

## Event-Driven Execution

### Fire-and-Forget Pattern
```typescript
async assignTasksToWorkers(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    const worker = this.roleManager.roleWorkers[task.assigned_role.toLowerCase()];
    
    // Subscribe to completion event
    worker.events.once('taskComplete', (data) => {
      this.memoryManager.completeTask(task.id, data.content);
    });
    
    // Execute (non-blocking)
    worker.createTask(task.description);
  }
}
```

### Dependency Updates
When a task completes:
1. MemoryManager updates task status
2. Dependent tasks' prerequisites are marked complete
3. Ready tasks become available for execution
4. Workers automatically pick up new ready tasks

## Integration with MCP Tools

### Configuration
```typescript
mcpClientConfigs: {
  filesystem: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  },
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "..." }
  }
}
```

### Loading
```typescript
const mcpClient = new MultiServerMCPClient(mcpClientConfigs);
await mcpClient.connect();
const tools = await mcpClient.getTools();
// tools = [Tool1, Tool2, ...]
```

### Binding to Agent
```typescript
const model = new ChatOpenAI({...}).bindTools(tools);
```

## API Endpoints

### REST API
**File**: [api/](../../src/worker/api/)

**Endpoints**:
- `POST /api/workflow/create`: Create workflow
- `POST /api/workflow/start`: Start execution
- `GET /api/agents`: List active agents
- `POST /api/tasks`: Create task

### WebSocket Events
**Server**: [server.ts](../../src/worker/server.ts)

**Events Emitted**:
- `agent:message`: Agent response
- `agent:status`: Status update
- `orchestration:log`: Event log
- `workflow:progress`: Execution progress

**Events Received**:
- `subscribe:agent`: Subscribe to agent updates
- `message:agent`: Send message to agent
- `workflow:create`: Create new workflow

## Environment Configuration

Required environment variables (`.env`):

```env
# Azure OpenAI
AZURE_OPENAI_ENDPOINT_URL=https://your-endpoint.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Optional: MCP Tool Configurations
MCP_FILESYSTEM_PATH=/workspace
GITHUB_TOKEN=ghp_xxx
```

## Build and Run

### Install Dependencies
```bash
cd src/worker
npm install
```

### Build TypeScript
```bash
npm run build
```

### Run Server
```bash
npm start
```

### Development Mode
```bash
npm run dev
```

### Debug (VS Code)
Use the "Debug AgentManager" configuration in `.vscode/launch.json`

## Common Patterns

### Adding New Role
1. ROLE Builder discovers it automatically
2. CONFIG Builder generates configuration
3. RoleManager initializes worker
4. AgentManager assigns tasks

### Adding New Task Type
1. Define task in plan
2. Add to MemoryManager
3. Set dependencies
4. Worker automatically picks up when ready

### Custom Builder
```typescript
import { AgentBuilderFactory } from './agentBuilder/AgentBuilderFactory';

const customBuilder = await AgentBuilderFactory.getBuilder('CUSTOM');
const result = await customBuilder.runAgent(prompt);
```

## Debugging

### Common Issues

**1. Missing thread_id**
```typescript
// ❌ Wrong
await agent.invoke({ messages });

// ✅ Correct
await agent.invoke({ messages }, { configurable: { thread_id: "123" } });
```

**2. Role/Worker Key Mismatch**
```typescript
// Ensure lowercase consistency
task.assigned_role = "researchagent";
workers["researchagent"] = new AgentWorker(...);
```

**3. Strict Response Format**
- Ensure prompts instruct model to return ONLY JSON
- Or relax `responseFormat` in AgentConfig
- Add fallback parsing in AgentBuilder

### Logging
```typescript
import { Logger } from 'tslog';
const logger = new Logger({ name: "ComponentName" });

logger.info("Message", { metadata });
logger.debug("Debug info");
logger.error("Error occurred", error);
```

## Testing

### Unit Tests
```bash
npm test
```

### Test Files
- [agentManager.test.ts](../../src/worker/agentManager/agentManager.test.ts)

## Performance Considerations

### Concurrency
- Per-worker serialized via TaskQueue
- For parallelism, spawn multiple workers
- Ensure unique `thread_id` per context

### Memory Management
- Clear completed tasks periodically
- Limit message history length
- Use streaming for large responses

### Optimization
- Cache builder results when possible
- Reuse agent instances
- Batch task assignments

## Future Enhancements

- **Dynamic Role Adjustment**: Adapt roles based on progress
- **Inter-Agent Messaging**: Direct communication between agents
- **Hierarchical Orchestration**: Multi-level task decomposition
- **Persistent Checkpointing**: Save/restore execution state
- **Distributed Execution**: Scale across multiple nodes
- **Advanced Planning**: Reinforcement learning for task planning

## Related Documentation

- [Agent Manager Integration](../AGENTMANAGERSERVICE_INTEGRATION.md)
- [Role Discovery Enhancement](../ROLE_DISCOVERY_ENHANCEMENT.md)
- [Task Manager & Role Manager](../taskManager_roleManager.md)
- [Copilot Instructions](../../.github/copilot-instructions.md)
