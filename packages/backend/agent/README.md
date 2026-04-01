# Agent Module - Usage Guide

This module provides a unified agent system where all agents implement the `IAgent` interface, have task lists with dependency handling, and can be defined declaratively in YAML files.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [AgentFactory](#agentfactory)
- [Creating Agents](#creating-agents)
- [Task Management](#task-management)
- [Executing Agents](#executing-agents)
- [Events](#events)
- [Extending Agents](#extending-agents)

---

## Quick Start

```typescript
import { getAgentFactory } from './agent/index.js';

// 1. Get the factory (BuilderAgent is auto-detected for internal agents with responseFormat)
const factory = getAgentFactory();

// 2. Create/get an agent
const roleBuilder = factory.getRoleBuilder();

// 3. Execute the agent
for await (const event of roleBuilder.execute({
  message: 'Create roles for a code review system',
  threadId: 'thread-123'
})) {
  console.log(event.type, event);
}
```

---

## Core Concepts

### AgentType

Every agent has a type that determines its execution strategy:

| Type | Description | Config |
|------|-------------|--------|
| `internal` | LangGraph-based, runs locally | `InternalConfig` |
| `internal` + `responseFormat` | Structured output builders | `InternalConfig` with `responseFormat` |
| `external` | HTTP proxy to external agent | `ExternalConfig` |
| `agentic-ui` | Vision-based app control | `AgenticUIConfig` |

> **Note:** The `builder` type was removed. Builders are now `internal` agents with `config.responseFormat` set.

### IAgent Interface

All agents implement `IAgent`:

```typescript
interface IAgent {
  // Identity
  readonly id: string;
  readonly name: string;
  readonly type: AgentType;
  readonly role: string;
  
  // Task Management
  readonly tasks: ITaskList;
  assignTask(task: Omit<Task, 'status' | 'assignedAt'>): void;
  getActiveTasks(): Task[];
  
  // Execution
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;
  
  // Lifecycle
  initialize(): Promise<void>;
  stop(): Promise<void>;
}
```

---

## AgentFactory

The `AgentFactory` creates and manages agent instances.

### Getting the Factory

```typescript
import { getAgentFactory, setAgentFactory } from './agent/index.js';

// Get default factory (lazy initialized)
const factory = getAgentFactory();

// Or create custom factory
import { AgentFactory } from './agent/index.js';
const customFactory = new AgentFactory('./my-agents');
setAgentFactory(customFactory);
```

### Registering Agent Types

Before creating agents, register implementations:

```typescript
import { registerAgentType } from './agent/index.js';
import { BuilderAgent } from './agent/builder/index.js';
import { InternalAgent } from './agent/internal/InternalAgent.js';

// Register all implementations at startup
registerAgentType('builder', BuilderAgent);
registerAgentType('internal', InternalAgent);
```

### Creating Agents

```typescript
const factory = getAgentFactory();

// By ID (loads from YAML)
const agent = factory.createById('role-builder');

// Get singleton instance
const agent = factory.getInstance('role-builder');

// Builder convenience methods
const roleBuilder = factory.getRoleBuilder();
const configBuilder = factory.getConfigBuilder();
const planBuilder = factory.getPlanBuilder();

// By builder type
const builder = factory.getBuilder('role'); // 'role' | 'config' | 'plan'
```

### From Definition Object

```typescript
import type { AgentDefinition } from './agent/types.js';

const definition: AgentDefinition = {
  id: 'my-agent',
  name: 'My Custom Agent',
  role: 'custom/my-agent',
  type: 'builder',
  goal: 'Do something specific',
  config: {
    builderType: 'role',
    outputSchema: 'AgentRoleSchema',
    model: {
      provider: 'azure-openai',
      deployment: 'gpt-4o-2',
      temperature: 0.3
    }
  }
};

const agent = factory.create(definition);
```

### Querying Agents

```typescript
// List all YAML definitions
const definitions = factory.listDefinitions();

// List running instances
const instances = factory.listInstances();

// Check existence
if (factory.has('role-builder')) {
  const def = factory.getDefinition('role-builder');
}
```

### Lifecycle Management

```typescript
// Initialize all registered agents
await factory.initializeAll();

// Stop all agents
await factory.stopAll();

// Hot-reload YAML definitions
factory.reloadDefinitions();

// Remove specific instance
await factory.removeInstance('role-builder');
```

---

## Creating Agents

### YAML Agent Definitions

Agents are defined in `src/worker/agent/agents/*.yaml`:

```yaml
# agents/my-analyzer.yaml
id: my-analyzer
name: "Code Analyzer"
role: internal/analyzer
type: internal

goal: "Analyze code and identify patterns"

systemPrompt: |
  You are an expert code analyzer.
  Analyze the provided code and identify patterns, anti-patterns, and improvements.

config:
  model:
    provider: azure-openai
    deployment: gpt-4o-2
    temperature: 0.2
  tools:
    - name: read_file
      type: builtin
    - name: grep_search
      type: builtin
  memory:
    shortTerm: true
    checkpoint: true

settings:
  streaming: true
  timeout: 120000
```

### Builder Agent Definition

```yaml
# agents/role-builder.yaml
id: role-builder
name: "Role Builder"
role: system/role-builder
type: builder

goal: "Generate specialized agent roles"

systemPrompt: |
  You are an expert in architecting AI agent teams.
  Design the MINIMAL set of complementary roles needed.
  Return ONLY JSON.

config:
  builderType: role
  outputSchema: AgentRoleSchema
  model:
    provider: azure-openai
    deployment: gpt-4o-2
    temperature: 0.3

settings:
  streaming: false
```

---

## Task Management

Every agent has a `TaskList` for tracking work.

### Assigning Tasks

```typescript
const agent = factory.getInstance('my-agent');

// Assign a single task
agent.assignTask({
  id: 'task-1',
  description: 'Analyze authentication module',
  priority: 1,
  assignedBy: 'orchestrator',
  dependencies: []
});

// Assign task with dependencies
agent.assignTask({
  id: 'task-2',
  description: 'Review security findings',
  priority: 2,
  assignedBy: 'orchestrator',
  dependencies: ['task-1'],         // Must wait for task-1
  dependencyType: 'all',            // All deps must complete
  onDependencyFail: 'skip'          // Skip if dep fails
});
```

### Dependency Configuration

```typescript
interface Task {
  dependencies: string[];          // Task IDs this depends on
  dependencyType: 'all' | 'any';   // 'all' = all must complete, 'any' = one is enough
  onDependencyFail: 'skip' | 'fail' | 'replan';
}
```

| `onDependencyFail` | Behavior |
|--------------------|----------|
| `skip` | Mark task as skipped, continue with others |
| `fail` | Cascade failure to this task |
| `replan` | Emit event for orchestrator to replan |

### Batch Adding Tasks

```typescript
// Add multiple tasks with inter-dependencies
agent.tasks.addBatch([
  { id: 't1', description: 'Task 1', priority: 1, dependencies: [], assignedBy: 'system', assignedAt: new Date() },
  { id: 't2', description: 'Task 2', priority: 2, dependencies: ['t1'], assignedBy: 'system', assignedAt: new Date() },
  { id: 't3', description: 'Task 3', priority: 3, dependencies: ['t1', 't2'], assignedBy: 'system', assignedAt: new Date() },
]);

// Circular dependencies are detected and emit event
agent.tasks.on('task:circular-detected', ({ taskIds, cycle }) => {
  console.error('Circular dependency:', cycle.join(' → '));
});
```

### Querying Tasks

```typescript
const tasks = agent.tasks;

// By status
tasks.all();           // All tasks
tasks.pending();       // Waiting to start
tasks.inProgress();    // Currently executing
tasks.completed();     // Finished successfully
tasks.failed();        // Finished with error

// Dependency-aware queries
tasks.getReady();      // Pending + all dependencies satisfied
tasks.getBlocked();    // Pending + has failed dependency

// Specific task
const task = tasks.getById('task-1');

// Dependency graph
const graph = tasks.getDependencyGraph();  // Map<taskId, dependencyIds[]>
const ordered = tasks.getTopologicalOrder(); // Tasks in execution order
```

### Completing Tasks

```typescript
// Mark complete with output
agent.completeTask('task-1', { 
  findings: ['issue-1', 'issue-2'],
  score: 85 
});

// Mark failed
agent.failTask('task-1', 'Connection timeout');
```

---

## Executing Agents

### Basic Execution

```typescript
const agent = factory.getInstance('role-builder');

// Execute and stream events
for await (const event of agent.execute({
  message: 'Design roles for a code review system',
  threadId: 'thread-123'
})) {
  switch (event.type) {
    case 'thinking':
      console.log('💭', event.content);
      break;
    case 'message':
      console.log('💬', event.content);
      break;
    case 'done':
      console.log('✅ Output:', event.output);
      break;
    case 'error':
      console.error('❌', event.error);
      break;
  }
}
```

### Event Types

```typescript
type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'planning'; steps: string[] }
  | { type: 'tool_start'; tool: string; args: Record<string, any> }
  | { type: 'tool_result'; tool: string; result: any; error?: string }
  | { type: 'message'; content: string; streaming?: boolean }
  | { type: 'message_delta'; delta: string }
  | { type: 'artifact'; artifact: any }
  | { type: 'error'; error: string; recoverable: boolean }
  | { type: 'done'; output?: any; summary?: string };
```

### Execution Input

```typescript
interface AgentInput {
  message: string;          // User/orchestrator message
  threadId: string;         // Conversation thread ID
  taskId?: string;          // Optional task being executed
  
  context?: {
    files?: FileReference[];      // Files for context
    artifacts?: ArtifactReference[]; // Previous outputs
    teamId?: string;              // Team context
  };
}
```

---

## Events

Agents emit events for real-time monitoring.

### Event Subscription

```typescript
const agent = factory.getInstance('my-agent');

// Subscribe to events
agent.on('task:added', ({ agentId, task }) => {
  console.log(`Task added to ${agentId}:`, task.id);
});

agent.on('task:completed', ({ agentId, task }) => {
  console.log(`Task completed:`, task.id, task.output);
});

agent.on('task:failed', ({ agentId, task }) => {
  console.error(`Task failed:`, task.id, task.error);
});

// Task-level events
agent.tasks.on('task:circular-detected', ({ taskIds, cycle }) => {
  console.error('Circular dependency:', cycle);
});

agent.tasks.on('task:replan-needed', ({ taskId, failedDependency }) => {
  console.log('Need to replan for:', taskId);
});
```

### Event Types

| Event | Source | Payload |
|-------|--------|---------|
| `task:added` | TaskList | `{ agentId, task }` |
| `task:started` | TaskList | `{ agentId, task }` |
| `task:completed` | TaskList | `{ agentId, task }` |
| `task:failed` | TaskList | `{ agentId, task }` |
| `task:skipped` | TaskList | `{ taskId, reason }` |
| `task:replan-needed` | TaskList | `{ taskId, failedDependency }` |
| `task:circular-detected` | TaskList | `{ taskIds, cycle }` |
| `status:changed` | BaseAgent | `{ agentId, from, to }` |

---

## Extending Agents

### Creating a Custom Agent Type

```typescript
// my-agent/MyAgent.ts
import { BaseAgent, registerAgentType } from '../agent/index.js';
import type { AgentDefinition, AgentInput, AgentEvent } from '../agent/types.js';

export class MyAgent extends BaseAgent {
  private client: any;

  constructor(definition: AgentDefinition) {
    super(definition);
  }

  async initialize(): Promise<void> {
    // Initialize your client/model
    this.client = await createMyClient(this.definition.config);
    this.setStatus('idle');
  }

  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    this.setStatus('executing');
    yield this.thinkingEvent('Analyzing...');

    try {
      const result = await this.client.run(input.message);
      
      yield this.messageEvent(result.content);
      yield this.doneEvent(result.output);
      
      this.setStatus('idle');
    } catch (error: any) {
      this.setStatus('error');
      yield this.errorEvent(error.message, true);
    }
  }
}

// Register the type
registerAgentType('my-type', MyAgent);
```

### BaseAgent Helper Methods

```typescript
// Status management
protected setStatus(status: AgentStatus): void;

// Event helpers (use in execute())
protected thinkingEvent(content: string): AgentEvent;
protected messageEvent(content: string): AgentEvent;
protected toolStartEvent(tool: string, args: Record<string, any>): AgentEvent;
protected toolResultEvent(tool: string, result: any): AgentEvent;
protected artifactEvent(artifact: any): AgentEvent;
protected doneEvent(output?: any, summary?: string): AgentEvent;
protected errorEvent(error: string, recoverable: boolean): AgentEvent;

// Conversation history
protected addToHistory(role: 'user' | 'assistant' | 'system', content: string): void;
protected getHistory(): Message[];
protected clearHistory(): void;
```

---

## Complete Example: Orchestrator Integration

```typescript
import { 
  getAgentFactory, 
  registerAgentType 
} from './agent/index.js';
import { BuilderAgent } from './agent/builder/index.js';

// Setup
registerAgentType('builder', BuilderAgent);
const factory = getAgentFactory();

async function orchestrate(userRequest: string) {
  // Step 1: Discover roles
  const roleBuilder = factory.getRoleBuilder();
  let roles: any;
  
  for await (const event of roleBuilder.execute({
    message: userRequest,
    threadId: 'orchestrator-1'
  })) {
    if (event.type === 'done') {
      roles = event.output;
    }
  }

  console.log('Discovered roles:', roles);

  // Step 2: Generate plan
  const planBuilder = factory.getPlanBuilder();
  let plan: any;

  for await (const event of planBuilder.execute({
    message: JSON.stringify({ request: userRequest, roles }),
    threadId: 'orchestrator-1'
  })) {
    if (event.type === 'done') {
      plan = event.output;
    }
  }

  console.log('Generated plan:', plan);

  // Step 3: Create worker agents and assign tasks
  for (const task of plan.tasks) {
    const workerAgent = factory.getInstance(task.assignedRole);
    workerAgent.assignTask({
      id: task.id,
      description: task.description,
      priority: task.priority,
      assignedBy: 'orchestrator',
      dependencies: task.dependencies || [],
      dependencyType: task.dependencyType || 'all',
      onDependencyFail: task.onDependencyFail || 'fail'
    });
  }

  // Step 4: Execute ready tasks
  for (const agent of factory.listInstances()) {
    const readyTasks = agent.tasks.getReady();
    for (const task of readyTasks) {
      console.log(`Executing ${task.id} on ${agent.name}`);
      // ... execute and handle events
    }
  }
}
```

---

## Testing

### Using Mock Factory

```typescript
import { AgentFactory, setAgentFactory } from './agent/index.js';

// In tests
const testFactory = new AgentFactory('./test/fixtures/agents');
setAgentFactory(testFactory);

// Register mock implementations
registerAgentType('builder', MockBuilderAgent);
```

### Mock Agent

```typescript
class MockBuilderAgent extends BaseAgent {
  async initialize(): Promise<void> {}

  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    yield { type: 'done', output: { roles: [{ name: 'MockRole' }] } };
  }
}
```

---

## Environment Variables

```bash
# Required for Azure OpenAI
AZURE_OPENAI_ENDPOINT_URL=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-4o-2

# Optional
AGENTS_DIR=./src/worker/agent/agents  # Custom agents directory
```

---

## File Structure

```
src/worker/agent/
├── README.md              # This file
├── index.ts               # Barrel exports
├── types.ts               # All TypeScript interfaces
├── BaseAgent.ts           # Abstract base class
├── TaskList.ts            # Task management with dependencies
├── AgentFactory.ts        # Creates agents from definitions
├── AgentLoader.ts         # Loads YAML definitions
├── agents/                # YAML agent definitions
│   ├── role-builder.yaml
│   ├── config-builder.yaml
│   └── plan-builder.yaml
├── builder/               # Builder agent implementation
│   ├── index.ts
│   ├── BuilderAgent.ts
│   └── schemas/
│       ├── AgentRoleSchema.ts
│       ├── AgentConfigSchema.ts
│       └── AgentPlanSchema.ts
├── internal/              # (pending) LangGraph agents
├── external/              # (pending) HTTP proxy agents
└── agentic-ui/            # (pending) Vision-based agents
```
