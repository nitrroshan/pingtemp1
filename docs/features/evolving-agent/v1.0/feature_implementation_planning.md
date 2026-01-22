# Evolving Agent v1.0 - Implementation Plan

**Parent:** [Feature Architecture](../feature_architecture.md)  
**Approach:** Option A - LangGraph Evolution  
**Branch:** `user/nitrroshan/evolvingagent`

---

## Scope: v1.0 MVP

Transform current agent architecture into a proper agent system with:
- ✅ Declarative agent definitions (YAML/JSON)
- ✅ Model provider abstraction (Azure OpenAI now, Claude later)
- ✅ Skills System integration
- ✅ Rich event streaming
- ✅ **Task dependency handling with cascading failures**
- ✅ Testing infrastructure
- ✅ User-created agents (API + storage)

**Out of scope for v1.0:**
- Claude/Anthropic integration (v1.1)
- Long-term memory across sessions (v1.2)
- Planning/reasoning loops (v1.2)

---

## Implementation Steps

### Phase 1: Agent Definition Schema (Day 1)

#### Step 1.1: Create AgentDefinition types
**Files:** `src/worker/agentManager/types/AgentDefinition.types.ts`

```typescript
interface AgentDefinition {
  name: string;
  role: string;
  model: ModelConfig;
  goal: string;
  systemPrompt: string;
  tools: ToolsConfig;
  skills?: string[];
  memory: MemoryConfig;
  settings: AgentSettings;
}

interface ModelConfig {
  provider: 'azure-openai' | 'openai' | 'anthropic';
  model: string;  // "gpt-4o", "claude-sonnet-4-20250514", etc.
}

interface ToolsConfig {
  builtin?: string[];
  mcp?: Record<string, MCPServerConfig>;
}

interface MemoryConfig {
  shortTerm: boolean;
  checkpoint: boolean;
  longTerm: boolean;
}

interface AgentSettings {
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}
```

**Exit criteria:** Types compile, exported from index.ts

---

#### Step 1.2: Create sample agent definitions
**Files:** `src/worker/agents/definitions/code-reviewer.yaml`

```yaml
name: "Code Reviewer"
role: "code-reviewer"

model:
  provider: azure-openai
  model: gpt-4o

goal: "Review code for bugs, security issues, and style"

systemPrompt: |
  You are a senior code reviewer. You:
  - Find bugs and security vulnerabilities
  - Suggest improvements and best practices
  - Provide clear, actionable feedback

tools:
  builtin: [read_file, grep_search]
  mcp: {}

skills:
  - code-analysis

memory:
  shortTerm: true
  checkpoint: true
  longTerm: false

settings:
  temperature: 0.3
  maxTokens: 4096
```

**Exit criteria:** YAML files parse correctly, schema validates

---

### Phase 2: Agent Factory (Day 2)

#### Step 2.1: Create ModelProvider abstraction
**Files:** `src/worker/agentManager/models/ModelProvider.ts`

```typescript
interface ModelProvider {
  createModel(config: ModelConfig): BaseChatModel;
}

class AzureOpenAIProvider implements ModelProvider {
  createModel(config: ModelConfig): AzureChatOpenAI {
    return new AzureChatOpenAI({
      azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT_URL,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiDeploymentName: config.model,
      azureOpenAIApiVersion: "2025-01-01-preview",
    });
  }
}

// Factory
function getModelProvider(provider: string): ModelProvider {
  switch (provider) {
    case 'azure-openai': return new AzureOpenAIProvider();
    // case 'anthropic': return new AnthropicProvider(); // v1.1
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
```

**Exit criteria:** Can create Azure OpenAI model from config

---

#### Step 2.2: Create AgentFactory
**Files:** `src/worker/agentManager/AgentFactory.ts`

```typescript
class AgentFactory {
  async create(definition: AgentDefinition): Promise<EvolvingAgent> {
    // 1. Load model
    const provider = getModelProvider(definition.model.provider);
    const model = provider.createModel(definition.model);
    
    // 2. Load tools
    const tools = await this.loadTools(definition.tools);
    
    // 3. Load skills (integrates with Skills System)
    const skillTools = await this.loadSkills(definition.skills);
    
    // 4. Setup memory/checkpointer
    const checkpointer = definition.memory.checkpoint 
      ? new MemorySaver() 
      : undefined;
    
    // 5. Create LangGraph agent
    const agent = await createAgent({
      model,
      tools: [...tools, ...skillTools],
      checkpointer,
      systemPrompt: definition.systemPrompt,
    });
    
    return new EvolvingAgent(agent, definition);
  }
  
  async createFromFile(path: string): Promise<EvolvingAgent> {
    const definition = await this.loadDefinition(path);
    return this.create(definition);
  }
}
```

**Exit criteria:** Factory creates agent from YAML definition

---

### Phase 3: Evolving Agent Runtime (Day 3)

#### Step 3.1: Create EvolvingAgent class
**Files:** `src/worker/agentManager/EvolvingAgent.ts`

```typescript
type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; tool: string; args: any }
  | { type: 'tool_result'; tool: string; result: any }
  | { type: 'message'; content: string; final?: boolean }
  | { type: 'error'; error: string }
  | { type: 'done' };

class EvolvingAgent {
  private agent: LangGraphAgent;
  private definition: AgentDefinition;
  private messages: BaseMessage[] = [];
  public events: EventEmitter;
  
  constructor(agent: LangGraphAgent, definition: AgentDefinition) {
    this.agent = agent;
    this.definition = definition;
    this.events = new EventEmitter();
  }
  
  async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
    yield { type: 'thinking', content: 'Processing request...' };
    
    this.messages.push(new HumanMessage(input.message));
    
    // Invoke with event hooks
    const response = await this.agent.invoke(
      { messages: this.messages },
      { 
        configurable: { thread_id: input.threadId },
        callbacks: [{
          handleToolStart: (tool, input) => {
            this.events.emit('event', { type: 'tool_start', tool: tool.name, args: input });
          },
          handleToolEnd: (output) => {
            this.events.emit('event', { type: 'tool_result', result: output });
          }
        }]
      }
    );
    
    yield { type: 'message', content: response.content, final: true };
    yield { type: 'done' };
  }
  
  getDefinition(): AgentDefinition {
    return this.definition;
  }
}
```

**Exit criteria:** EvolvingAgent yields events during execution

---

#### Step 3.2: Update AgentWorker to use EvolvingAgent
**Files:** `src/worker/AgentWorker/AgentWorker.ts`

- Replace `Agent` with `EvolvingAgent` 
- Forward events from EvolvingAgent to WebSocket
- Keep TaskQueue for serialization

**Exit criteria:** AgentWorker works with new EvolvingAgent

---

### Phase 4: Skills Integration (Day 4)

#### Step 4.1: Connect AgentFactory to Skills System
**Files:** `src/worker/agentManager/AgentFactory.ts`

```typescript
private async loadSkills(skillIds: string[]): Promise<Tool[]> {
  if (!skillIds?.length) return [];
  
  // Use existing Skills System
  const { getSkillTools } = await import('../skillRegistry/index.js');
  return getSkillTools();  // Returns skill-related tools
}
```

**Exit criteria:** Agents can use skills from definitions

---

#### Step 4.2: Create built-in tools registry
**Files:** `src/worker/agentManager/tools/BuiltinTools.ts`

```typescript
const BUILTIN_TOOLS: Record<string, () => Tool> = {
  'read_file': () => new ReadFileTool(),
  'write_file': () => new WriteFileTool(),
  'grep_search': () => new GrepSearchTool(),
  'run_command': () => new RunCommandTool(),
};

function loadBuiltinTools(names: string[]): Tool[] {
  return names.map(name => {
    const factory = BUILTIN_TOOLS[name];
    if (!factory) throw new Error(`Unknown builtin tool: ${name}`);
    return factory();
  });
}
```

**Exit criteria:** Can load builtin tools by name

---

### Phase 5: Task Dependency Handling (Day 5)

> **Architecture Alignment (Jan 22, 2026):**
> - Central **TaskQueue** is managed by Orchestrator, organized by role
> - Agents **poll** tasks from TaskQueue for their role
> - Agent's internal TaskList is **optional** — for local tracking only
> - Dependency resolution happens in **MemoryManager**, not in agent

#### Step 5.1: Enhance Task interface with dependency fields
**Files:** `src/worker/agent/types.ts`

```typescript
// Task as stored in central MemoryManager/TaskQueue
interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assigned_role: string;            // Role that will poll for this task
  
  // Dependencies (resolved by MemoryManager, not agent)
  dependencies: string[];           // Task IDs that must complete first
  dependencyType: 'all' | 'any';    // 'all' = all must complete, 'any' = any one
  onDependencyFail: 'skip' | 'fail' | 'replan';  // Failure handling
  
  // Context (provided when task is queued)
  context?: Record<string, any>;    // Outputs from dependencies
  
  // Execution
  assignedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  output?: any;
  error?: string;
}

// Task with context, as received by agent from TaskQueue
interface TaskWithContext extends Task {
  context: Record<string, any>;     // Always present when polled
}
```

**Exit criteria:** Task type includes dependency configuration ✅ DONE

---

#### Step 5.2: Agent polls from central TaskQueue
**Files:** `src/worker/agent/EvolvingAgent.ts`

> **Key Change:** Agent polls from central TaskQueue — does NOT manage dependencies.
> Dependency resolution is done by MemoryManager before tasks are queued.

```typescript
class EvolvingAgent {
  private role: string;
  private internalQueue: TaskWithContext[] = [];  // Optional: local tracking
  private taskQueue: TaskQueue;  // Reference to central queue
  
  constructor(agent: LangGraphAgent, definition: AgentDefinition, taskQueue: TaskQueue) {
    this.agent = agent;
    this.definition = definition;
    this.role = definition.role;
    this.taskQueue = taskQueue;
    
    // Listen for tasks available for this role
    this.taskQueue.onTaskAvailable(({ role }) => {
      if (role === this.role) {
        this.pollTask();
      }
    });
  }
  
  // Poll task from central queue (tasks arrive with context already resolved)
  private async pollTask() {
    const task = this.taskQueue.poll(this.role);
    if (task) {
      this.internalQueue.push(task);  // Optional: track locally
      await this.executeTask(task);
    }
  }
  
  // Internal tracking methods (optional, for agent's own use)
  getPendingTasks(): TaskWithContext[] {
    return this.internalQueue.filter(t => t.status === 'pending');
  }
  
  getCompletedTasks(): TaskWithContext[] {
    return this.internalQueue.filter(t => t.status === 'completed');
  }
}
```

**Exit criteria:** Agent polls from central TaskQueue ✅ UPDATED

---

#### Step 5.2.1: TaskList as optional internal tracking
**Files:** `src/worker/agent/TaskList.ts`

> **Note:** TaskList is now **optional** internal tracking. Dependency resolution
> happens in MemoryManager, not here. This is just for agent's local convenience.

```typescript
// Optional: Agent's internal task tracking (not authoritative)
class TaskList implements ITaskList {
  private tasks: Map<string, TaskWithContext> = new Map();
  
  // Track task locally when polled from queue
  add(task: TaskWithContext): void {
    this.tasks.set(task.id, task);
  }
  
  // Update local status (also emit to Orchestrator)
  complete(taskId: string, output: any): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.output = output;
      this.emitter.emit('task:complete', { taskId, output });
    }
  }
  
  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.error = error;
      this.emitter.emit('task:failed', { taskId, error });
    }
  }
  
  // Local queries
  pending(): TaskWithContext[] {
    return [...this.tasks.values()].filter(t => t.status === 'pending');
  }
  
  completed(): TaskWithContext[] {
    return [...this.tasks.values()].filter(t => t.status === 'completed');
  }
}
```

**Exit criteria:** TaskList tracks agent's local state ✅ DONE

---

#### Step 5.3: Cascading failure handling (MemoryManager)
**Files:** `src/worker/memoryManager/MemoryManager.ts`

> **Architecture Note:** Cascading failures are handled by **MemoryManager** (not agent).
> Agent emits `task:failed`, Orchestrator/MemoryManager handles the cascade.

```typescript
// In MemoryManager — handles cascading failures
class MemoryManager {
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    task.status = 'failed';
    task.error = error;
    
    // Handle dependent tasks based on onDependencyFail
    this.handleDependencyFailure(taskId);
  }
  
  private handleDependencyFailure(failedId: string): void {
    // Find tasks that depend on the failed task
    for (const [id, task] of this.tasks) {
      if (!task.dependencies.includes(failedId)) continue;
      if (task.status !== 'pending') continue;
      
      switch (task.onDependencyFail) {
        case 'skip':
          task.status = 'skipped';
          this.emitter.emit('task:skipped', { taskId: id });
          break;
        case 'fail':
          this.failTask(id, `Dependency ${failedId} failed`);
          break;
        case 'replan':
          this.emitter.emit('task:replan-needed', { taskId: id, failedId });
          break;
      }
    }
  }
}

// Agent just emits failure — doesn't handle cascade
class EvolvingAgent {
  private async executeTask(task: TaskWithContext) {
    try {
      const result = await this.run({ message: task.description, context: task.context });
      this.events.emit('task:complete', { taskId: task.id, output: result });
    } catch (error) {
      this.events.emit('task:failed', { taskId: task.id, error: error.message });
      // Orchestrator/MemoryManager handles the cascade
    }
  }
}
```

**Exit criteria:** Failures cascade correctly via MemoryManager ✅ DONE

---

#### Step 5.3.1: Circular dependency detection (MemoryManager)
**Files:** `src/worker/memoryManager/MemoryManager.ts`

> **Architecture Note:** Circular dependency detection happens in **MemoryManager**
> when PlanBuilder's plan is added via `create_plan` tool.

```typescript
// In MemoryManager — validates plan before adding tasks
class MemoryManager {
  addTasksFromPlan(tasks: Task[]): void {
    // 1. Validate dependencies exist
    const taskIds = new Set(tasks.map(t => t.id));
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId) && !this.tasks.has(depId)) {
          throw new Error(`Unknown dependency: ${depId}`);
        }
      }
    }
    
    // 2. Detect circular dependencies
    const circularTasks = this.findCircularDependencies(tasks);
    if (circularTasks.length > 0) {
      this.emitter.emit('task:circular-detected', {
        taskIds: circularTasks,
        cycle: this.getCircularPath(circularTasks[0], tasks),
      });
      // Mark tasks as blocked
      for (const id of circularTasks) {
        const task = tasks.find(t => t.id === id)!;
        task.status = 'blocked';
        task.error = 'Circular dependency detected';
      }
    }
    
    // 3. Add valid tasks
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }
  
  private findCircularDependencies(tasks: Task[]): string[] {
    // DFS cycle detection
  }
  
  private getCircularPath(startId: string, tasks: Task[]): string[] {
    // Return the cycle path for error reporting
  }
}
```

**Exit criteria:** Circular deps detected in MemoryManager ✅ DONE

---

#### Step 5.4: Update PlanBuilder schema for dependencies
**Files:** `src/worker/agent/builder/schemas/AgentPlanSchema.ts`

```typescript
export const TaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  assignedRole: z.string(),
  priority: z.number().default(3),
  dependencies: z.array(z.string()).default([]),
  dependencyType: z.enum(['all', 'any']).default('all'),
  onDependencyFail: z.enum(['skip', 'fail', 'replan']).default('fail'),
  expectedOutput: z.string().optional(),
});
```

**Exit criteria:** PlanBuilder generates tasks with dependency config ✅ DONE

---

#### Step 5.5: Update plan-builder.yaml prompt
**Files:** `src/worker/agent/agents/plan-builder.yaml`

Add instructions for LLM to:
- Set appropriate dependency relationships
- Choose `dependencyType` based on task nature
- Choose `onDependencyFail` based on task criticality

**Exit criteria:** Generated plans include proper dependency configuration ✅ DONE

---

### Phase 6: Testing Infrastructure (Day 6)

#### Step 6.1: Create MockModel for testing
**Files:** `src/worker/agentManager/testing/MockModel.ts`

```typescript
class MockModel extends BaseChatModel {
  private responses: Map<string, string>;
  
  constructor(responses: Record<string, string>) {
    super({});
    this.responses = new Map(Object.entries(responses));
  }
  
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const lastMessage = messages[messages.length - 1].content;
    const response = this.responses.get(lastMessage) || 'Mock response';
    return { generations: [{ text: response }] };
  }
}
```

**Exit criteria:** MockModel can be used in tests

---

#### Step 5.2: Create agent test utilities
**Files:** `src/worker/agentManager/testing/testUtils.ts`

```typescript
async function createTestAgent(
  overrides: Partial<AgentDefinition> = {},
  mocks: { model?: MockModel } = {}
): Promise<EvolvingAgent> {
  const definition: AgentDefinition = {
    name: 'Test Agent',
    role: 'tester',
    model: { provider: 'azure-openai', model: 'gpt-4o' },
    goal: 'Test goal',
    systemPrompt: 'You are a test agent',
    tools: {},
    memory: { shortTerm: true, checkpoint: false, longTerm: false },
    settings: {},
    ...overrides
  };
  
  // Use mock model if provided
  if (mocks.model) {
    return new EvolvingAgent(createMockLangGraphAgent(mocks.model), definition);
  }
  
  return AgentFactory.create(definition);
}

async function collectEvents(agent: EvolvingAgent, input: AgentInput): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run(input)) {
    events.push(event);
  }
  return events;
}
```

**Exit criteria:** Can write tests with mocked agents

---

#### Step 5.3: Write integration tests
**Files:** `src/worker/agentManager/AgentFactory.test.ts`

```typescript
describe('AgentFactory', () => {
  test('creates agent from YAML definition', async () => {
    const agent = await AgentFactory.createFromFile('agents/definitions/code-reviewer.yaml');
    expect(agent.getDefinition().role).toBe('code-reviewer');
  });
  
  test('agent yields events during execution', async () => {
    const agent = await createTestAgent({}, { model: new MockModel({ 'test': 'response' }) });
    const events = await collectEvents(agent, { message: 'test', threadId: '1' });
    
    expect(events).toContainEqual(expect.objectContaining({ type: 'thinking' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'done' }));
  });
});
```

**Exit criteria:** Tests pass, CI green

---

## Files Summary

### New Files (Implemented ✅)
| File | Purpose | Status |
|------|---------|--------|
| `src/worker/agent/types.ts` | Core interfaces (IAgent, Task, AgentEvent) | ✅ Done |
| `src/worker/agent/BaseAgent.ts` | Abstract base class for agents | ✅ Done |
| `src/worker/agent/TaskList.ts` | Task management with dependencies | ✅ Done |
| `src/worker/agent/AgentFactory.ts` | Creates agents from definitions | ✅ Done |
| `src/worker/agent/AgentLoader.ts` | Loads YAML agent definitions | ✅ Done |
| `src/worker/agent/builder/BuilderAgent.ts` | Builder agent implementation | ✅ Done |
| `src/worker/agent/builder/schemas/*.ts` | Output schemas for builders | ✅ Done |
| `src/worker/agent/agents/*.yaml` | YAML agent definitions | ✅ Done |

### New Files (Pending)
| File | Purpose | Status |
|------|---------|--------|
| `src/worker/agent/internal/InternalAgent.ts` | LangGraph-based agent | ⏳ Pending |
| `src/worker/agent/external/ExternalAgent.ts` | HTTP proxy to external agents | ⏳ Pending |
| `models/ModelProvider.ts` | Model abstraction | ⏳ Pending |
| `tools/BuiltinTools.ts` | Built-in tool registry | ⏳ Pending |
| `testing/MockModel.ts` | Testing mock | ⏳ Pending |
| `testing/testUtils.ts` | Test utilities | ⏳ Pending |

### Modified Files
| File | Changes |
|------|---------|
| `AgentWorker.ts` | Use new Agent system instead of Agent |
| `types/index.ts` | Export new types |

---

## Testing Strategy

1. **Unit tests:** MockModel, AgentFactory, TaskList (dependency resolution)
2. **Integration tests:** Full agent creation from YAML
3. **Dependency tests:** Cascading failures, circular detection
4. **Manual testing:** Run agents via WebSocket

---

## Rollback Plan

If issues arise:
1. Keep old `Agent.ts` alongside new agent system
2. AgentWorker can switch between them via config flag
3. `USE_NEW_AGENT_SYSTEM=true` environment variable

---

## Success Criteria

- [ ] Agent created from YAML definition file
- [ ] Events emitted: thinking, tool_start, tool_result, message, done
- [ ] Skills load from definition
- [ ] Tests pass with MockModel
- [ ] Existing RoleManager flow still works
