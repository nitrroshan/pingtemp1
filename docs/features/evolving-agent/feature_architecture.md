# Evolving Agent Architecture

**Feature:** A proper agent architecture with goals, skills, tools, memory, and swappable LLM backends (Claude/OpenAI)

---

## Current State Analysis

### How Agents Are Created Today

```
User Task Description
       ↓
  RoleManager.suggestRoles() ─── uses ROLE Builder (LLM)
       ↓
  RoleDefinition[] (name, role, capabilities, responsibilities)
       ↓
  RoleManager.getRoles() ─── uses CONFIG Builder (LLM)
       ↓
  AgentConfig[] (role, goal, systemPrompt, responseFormat, tools)
       ↓
  Agent.initAgent() ─── creates LangGraph agent
       ↓
  AgentWorker ─── wraps agent, manages tasks, emits events
```

### Current AgentConfig Interface
```typescript
interface AgentConfig {
  name: string;
  role: string;
  goal: string;
  description?: string;
  systemPrompt?: string;
  responseFormat?: any;      // Zod schema for structured output
  tools?: any[];             // Currently empty []
  mcpClientConfigs?: {};     // Currently empty {}
}
```

### Current Agent.ts (LangGraph wrapper)
```typescript
class Agent {
  async initAgent(agentConfig: AgentConfig): Promise<LangGraphAgent> {
    // 1. Load Azure OpenAI model (hardcoded: gpt-4o-2)
    const model = new AzureChatOpenAI({...});
    
    // 2. Load MCP tools (if configs provided)
    const mcpTools = await loadMCPTools(mcpClientConfigs);
    
    // 3. Create LangGraph agent with checkpointer
    return createAgent({
      model,
      tools: [...tools, ...mcpTools],
      checkpointer: new MemorySaver(),
      systemPrompt,
      responseFormat: providerStrategy(responseFormat)
    });
  }
}
```

### Current AgentWorker.ts
```typescript
class AgentWorker {
  private agent: LangGraphAgent;
  private taskQueue: TaskQueue;
  private messages: any[];
  public events: EventEmitter;
  
  async callAgent(input: string, thread_id: string) {
    // Add message to conversation
    this.messages.push({ role: "user", content: input });
    
    // Invoke LangGraph agent
    const response = await this.agent.invoke(
      { messages: this.messages },
      { configurable: { thread_id } }
    );
    
    // Emit event
    this.events.emit("message", {
      thread_id,
      role: "assistant",
      content: response.structuredResponse.content
    });
  }
}
```

### Current Flow: RoleManager → AgentWorker

```typescript
// In RoleManager.createWorkersForRoles()
for (const agentConfig of agentConfigs) {
  const agentInstance = new Agent(agentConfig);
  const worker = new AgentWorker(agentInstance);
  this.roleWorkers[agentConfig.role.toLowerCase()] = worker;
}
```

---

### What's Good ✅

| Component | Status | Notes |
|-----------|--------|-------|
| **AgentConfig** | ✅ Good base | Has name, role, goal, systemPrompt |
| **LangGraph** | ✅ Working | createAgent with checkpointer |
| **MCP Support** | ✅ Ready | mcpClientConfigs in config |
| **Event Emission** | ✅ Basic | EventEmitter with 'message' event |
| **Task Queue** | ✅ Working | Serializes task execution |
| **Thread ID** | ✅ Working | For checkpoint/conversation resume |

### What's Missing ❌

| Gap | Impact | Needed For |
|-----|--------|------------|
| **Model swapping** | Can't use Claude | Multi-provider support |
| **Skills integration** | No skill loading | Skills System v1.1 |
| **Declarative definition** | Hardcoded in builders | Easy agent creation |
| **Rich events** | Only 'message' event | UI progress tracking |
| **Testing infrastructure** | No mocks | Automated testing |
| **Streaming** | No token streaming | Better UX |
| **Tool loading** | tools: [] always | Real tool usage |

---

## Overview

Current agents are basic LLM wrappers. A "proper agent" needs:
- **Identity**: Name, role, goal, persona
- **Capabilities**: Tools + Skills (portable bundles)
- **Memory**: Short-term, session checkpoints, long-term learning
- **Reasoning**: Goal decomposition, planning, reflection
- **Communication**: Streaming events, artifacts, progress

---

## What Makes a Proper Agent?

### 1. Agent Definition (Declarative)
```yaml
name: "Code Reviewer"
role: "code-reviewer"
model: "claude-sonnet-4-20250514"  # or "gpt-4o"
goal: "Review code for bugs, security, and style"

systemPrompt: |
  You are a senior code reviewer...

tools:
  builtin: [read_file, grep_search, run_command]
  mcp: [github, filesystem]
  
skills:
  - security-review
  - code-analysis

memory:
  shortTerm: true       # Current conversation
  checkpoint: true      # Resume sessions
  longTerm: false       # Learn across sessions

settings:
  temperature: 0.3
  maxTokens: 4096
  streaming: true
```

### 2. Reasoning Loop
```
1. Receive goal/message
2. Think: What do I need to do?
3. Plan: Break into steps (if complex)
4. Act: Use tools or respond
5. Observe: Check results
6. Reflect: Did it work? Adjust?
7. Repeat or complete
```

### 3. Event-Driven Output
```typescript
type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; tool: string; args: any }
  | { type: 'tool_result'; tool: string; result: any }
  | { type: 'message'; content: string; streaming?: boolean }
  | { type: 'artifact'; path: string; content: string }
  | { type: 'error'; error: string }
  | { type: 'done' }
```

---

## Architecture Options

### Option A: LangGraph-Based (Current Evolution)

**Implementation:**
- Keep LangGraph as the agent runtime
- Add declarative agent definitions (YAML/JSON)
- Integrate Skills System (already built)
- Enhance with structured events

```
AgentDefinition (YAML)
       ↓
  AgentFactory
       ↓
  LangGraph Agent ←── Tools + Skills + Memory
       ↓
  AgentWorker (executes, emits events)
```

**Pros:**
- Already using LangGraph - minimal disruption
- Built-in checkpointing (MemorySaver)
- Proven tool execution loop
- Skills System ready to integrate

**Cons:**
- LangGraph abstractions can be opaque
- Testing requires LangGraph mocks
- Tied to LangChain ecosystem

**Effort:** Medium (5-7 days)

---

### Option B: Native Agent Runtime (Custom Built)

**Implementation:**
- Build custom agent loop (no LangGraph)
- Direct Claude/OpenAI SDK calls
- Full control over reasoning/planning
- Clean event streaming

```typescript
class Agent {
  async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
    while (!done) {
      const response = await this.model.chat(messages, tools);
      if (response.toolCalls) {
        yield* this.executeTools(response.toolCalls);
      }
      if (response.content) {
        yield { type: 'message', content: response.content };
      }
    }
  }
}
```

**Pros:**
- Full control over agent behavior
- Clean, debuggable code
- Easy to test (mock model directly)
- No framework lock-in
- Simpler mental model

**Cons:**
- Must implement checkpointing manually
- More code to maintain
- Re-inventing some LangGraph features

**Effort:** High (8-10 days)

---

### Option C: Hybrid (LangGraph Core + Custom Wrapper)

**Implementation:**
- Use LangGraph for core loop + checkpointing
- Custom wrapper for events + definition loading
- Best of both: LangGraph reliability + custom flexibility

```
AgentDefinition (YAML)
       ↓
  AgentFactory (custom)
       ↓
  LangGraph Agent (core loop)
       ↓
  AgentRuntime (custom wrapper)
       ↓
  Event Stream (custom)
```

**Pros:**
- Leverage LangGraph's tested loop
- Add custom events/streaming on top
- Gradual migration possible
- Keep checkpointing for free

**Cons:**
- Two layers to understand
- Some abstraction leakage
- Medium complexity

**Effort:** Medium (6-8 days)

---

## Comparison: Simple Chat vs Proper Agent

| Aspect | Simple Chat | Proper Agent |
|--------|-------------|--------------|
| **Input** | Single message | Goal + context + files |
| **Output** | Text response | Stream of events + artifacts |
| **Tools** | Maybe some | Rich toolset + skills |
| **Memory** | Conversation only | Multi-layer (short/long term) |
| **Planning** | None | Breaks down complex tasks |
| **Testing** | Manual only | Automated + mocks |
| **Definition** | Hardcoded | Declarative YAML/JSON |
| **Model** | One fixed | Swappable (Claude/OpenAI) |

---

## Key Components Needed

### 1. AgentDefinition Schema
```typescript
interface AgentDefinition {
  name: string;
  role: string;
  model: 'claude-sonnet-4-20250514' | 'gpt-4o' | 'gpt-4o-mini';
  goal: string;
  systemPrompt: string;
  tools: {
    builtin?: string[];
    mcp?: string[];
  };
  skills?: string[];
  memory: {
    shortTerm: boolean;
    checkpoint: boolean;
    longTerm: boolean;
  };
  settings: {
    temperature: number;
    maxTokens: number;
    streaming: boolean;
  };
}
```

### 2. AgentFactory
- Loads definition from YAML/JSON
- Creates model (Claude or OpenAI)
- Loads tools and skills
- Configures memory
- Returns ready-to-run agent

### 3. AgentRuntime
- Executes agent with input
- Yields events (thinking, tool calls, messages)
- Handles errors gracefully
- Manages conversation state

### 4. Testing Infrastructure
```typescript
const agent = await AgentFactory.create({
  definition: 'code-reviewer.yaml',
  mocks: { model: new MockLLM() }
});

const events = await collectEvents(agent.run({ message: 'Review auth.ts' }));
expect(events).toContainTool('read_file');
```

---

## Integration Points

- **Skills System**: Already built, provides tool bundles
- **MemoryManager**: Task tracking (separate from agent memory?)
- **RoleManager**: Discovers roles → creates agent definitions?
- **AgentWorker**: Becomes thin wrapper around AgentRuntime
- **Frontend**: Subscribes to agent events via WebSocket

---

## Questions to Resolve

1. **Memory overlap**: LangGraph checkpoints vs MemoryManager - which does what?
2. **Role vs Agent**: Is a "role" just an agent definition template?
3. **Skills loading**: At agent creation or on-demand via tools?
4. **Testing strategy**: Mock at LLM level or tool level?

---

## Recommendation

**✅ DECISION: Option A (LangGraph Evolution)** - Approved

We're already 60% there with LangGraph. Just need to fill the gaps:

**Effort breakdown:**
1. Add model provider abstraction (Claude/OpenAI) - 1-2 days
2. Integrate Skills System tools - 1 day (already built)
3. Add declarative YAML/JSON definitions - 1 day
4. Enhance events (thinking, tool_start, tool_result) - 1-2 days
5. Add testing infrastructure - 1-2 days

**Total: 5-8 days**

See [v1.0 Implementation Plan](./v1.0/feature_implementation_planning.md) for details.

---

## Version Roadmap

### v1.0 - Evolving Agent Core (Current)
- Declarative YAML agent definitions
- ModelProvider abstraction (Azure OpenAI, Claude)
- AgentFactory with validation
- EvolvingAgent runtime with rich events
- Skills integration
- **Task dependency handling with cascading failure strategies**
- Testing infrastructure (MockModel)

---

## Task Dependency Architecture

### Overview

Every agent has a **TaskList** to track assigned work. Tasks can have dependencies on other tasks, and the system handles dependency resolution, circular detection, and cascading failures.

### Task Model

```typescript
interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: number;
  
  // Dependencies
  dependencies: string[];           // Task IDs that must complete first
  dependencyType: 'all' | 'any';    // 'all' = all must complete, 'any' = any one
  
  // Failure handling
  onDependencyFail: 'skip' | 'fail' | 'replan';
  
  // Execution timestamps
  assignedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  output?: any;
  error?: string;
}
```

### Dependency Resolution Flow

```
        ┌──────┐
        │Task A│ (no deps → ready immediately)
        └───┬──┘
            │ completes
            ▼
        ┌──────┐
        │Task B│ (depends on A → now ready)
        └───┬──┘
            │ fails
            ▼
   ┌────────┴────────┐
   │                 │
┌──▼──┐          ┌───▼───┐
│Task C│         │Task D │
│skip  │         │replan │
└──────┘         └───────┘
```

### Failure Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `fail` | Cascade failure to dependent tasks | Critical path tasks |
| `skip` | Mark as skipped, don't execute | Optional enhancements |
| `replan` | Emit event for orchestrator to re-plan | Complex tasks with alternatives |

### Circular Dependency Detection

When tasks are added via `addBatch()`, the system detects circular dependencies:

```
A → B → C → A  (circular!)
```

**Behavior:**
1. All tasks are added to the list
2. Circular dependencies are detected via DFS
3. `task:circular-detected` event is emitted with:
   - `taskIds`: All tasks involved in the cycle
   - `cycle`: The actual path (e.g., `['A', 'B', 'C', 'A']`)
4. Affected tasks are marked with `isCircular = true`
5. **Does NOT throw** — caller decides how to handle

```typescript
taskList.on('task:circular-detected', ({ taskIds, cycle }) => {
  console.warn(`Circular: ${cycle.join(' → ')}`);
  // Option: trigger re-planning to break the cycle
  planBuilder.run(`Break circular dependency: ${taskIds.join(', ')}`);
});
```

### Key TaskList Methods

```typescript
interface ITaskList {
  // Query
  getReady(): Task[];      // Tasks with all dependencies satisfied
  getBlocked(): Task[];    // Tasks blocked by failed dependencies
  
  // Validation
  hasCircularDependency(taskId: string): boolean;
  getTopologicalOrder(): Task[];
  
  // Batch operations
  addBatch(tasks: Task[]): void;  // Validates deps + detects cycles
  
  // Events
  on('task:replan-needed', handler): void;      // Dependency failed
  on('task:circular-detected', handler): void;  // Cycle detected
}
```

### Integration with PlanBuilder

The PlanBuilder agent generates tasks WITH dependency configuration:

```yaml
# Generated by plan-builder.yaml:
tasks:
  - id: "research"
    description: "Research API endpoints"
    dependencies: []
    dependencyType: "all"
    onDependencyFail: "fail"
    
  - id: "implement"
    description: "Implement the API"
    dependencies: ["research"]
    dependencyType: "all"
    onDependencyFail: "replan"  # Can find alternative approach
```

### Orchestrator Re-planning

```typescript
// AgentManager listens for re-plan events
taskList.on('task:replan-needed', async ({ task, failedDependency }) => {
  const planBuilder = factory.getPlanBuilder();
  const newPlan = await planBuilder.run(
    `Re-plan task "${task.description}" - dependency "${failedDependency}" failed`
  );
  taskList.addBatch(newPlan.tasks);
});
```

---

### v1.1 - External Agent Support

**Goal:** Allow users to connect agents built outside Ping to the platform.

#### Concept

```
┌─────────────────────────────────────────────────────────────┐
│                    PING PLATFORM                            │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Internal     │    │ Internal     │    │ External     │  │
│  │ Agent        │    │ Agent        │    │ Agent Proxy  │  │
│  │ (LangGraph)  │    │ (LangGraph)  │    │ (HTTP→User)  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                  │                    │           │
│         └──────────────────┼────────────────────┘           │
│                            │                                │
│                    ┌───────▼───────┐                        │
│                    │ Unified Agent │                        │
│                    │   Registry    │                        │
│                    └───────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                             │
        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                             │  HTTP / WebSocket
                             ▼
              ┌──────────────────────────────────┐
              │   USER'S EXTERNAL AGENT          │
              │   (localhost:5000 or cloud)      │
              │                                  │
              │   - User's own LLM               │
              │   - User's own tools             │
              │   - User's own logic             │
              └──────────────────────────────────┘
```

#### How It Works

**Message Flow:**
```
User types message in Ping UI
        ↓
Ping receives message
        ↓
Ping checks: Is this agent internal or external?
        │
        ├── Internal → Run LangGraph agent (normal flow)
        │
        └── External → Forward message to user's endpoint
                              ↓
                       User's agent processes
                              ↓
                       Returns response to Ping
                              ↓
                       Ping shows response in UI
```

#### External Agent Components

1. **ExternalAgentConfig**
```typescript
interface ExternalAgentConfig {
  id: string;
  name: string;
  type: 'external';
  endpoint: string;           // "http://localhost:5000/chat"
  healthEndpoint?: string;    // "http://localhost:5000/health"
  auth?: {
    type: 'bearer' | 'api-key' | 'none';
    token?: string;
  };
  timeout?: number;           // Request timeout in ms
  retries?: number;           // Retry on failure
}
```

2. **ExternalAgentProxy** (implements same interface as internal agents)
```typescript
class ExternalAgentProxy implements IAgentWorker {
  async execute(input: { message: string, thread_id: string }) {
    // Forward to user's endpoint
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        message: input.message,
        thread_id: input.thread_id,
        context: {} // Optional conversation context
      })
    });
    return response.json();
  }
}
```

3. **Agent Registry** (unified internal + external)
```typescript
class AgentRegistry {
  private internalAgents: Map<string, AgentWorker>;
  private externalAgents: Map<string, ExternalAgentProxy>;
  
  getAgent(id: string): IAgentWorker {
    return this.internalAgents.get(id) || this.externalAgents.get(id);
  }
  
  registerExternal(config: ExternalAgentConfig): void {
    // Validate endpoint is reachable
    // Create proxy
    // Add to registry
  }
}
```

#### API Endpoints

```
POST /api/agents/external        → Register external agent
GET  /api/agents/external        → List external agents
GET  /api/agents/external/:id    → Get external agent details
PUT  /api/agents/external/:id    → Update external agent
DELETE /api/agents/external/:id  → Unregister external agent
POST /api/agents/external/:id/test → Test connection
```

#### User's Agent Contract

Users must implement this simple interface:

```typescript
// POST /chat (or whatever endpoint they register)
Request: {
  message: string;      // User's message
  thread_id: string;    // Conversation ID
  context?: {           // Optional context
    history?: Message[];
  };
}

Response: {
  content: string;      // Agent's reply
  metadata?: {          // Optional metadata
    thinking?: string;
    tools_used?: string[];
  };
}
```

#### v1.1 Scope

| Feature | Priority | Notes |
|---------|----------|-------|
| Basic REST proxy | P0 | HTTP POST to external endpoint |
| Health monitoring | P0 | Check if external agent is alive |
| Auth (Bearer/API Key) | P0 | Secure connections |
| Retry logic | P1 | Handle temporary failures |
| Streaming support | P2 | WebSocket for real-time responses |
| Context forwarding | P2 | Send conversation history |

**Estimated Effort: 3-4 days**

### v1.2 - Agent Marketplace (Future)
- Share agent definitions with team
- Import community agent templates
- Version control for agent definitions
