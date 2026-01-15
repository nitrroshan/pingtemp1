# Agent - Agent Instance

## Overview
The Agent component wraps a LangGraph-based AI agent that processes tasks and generates structured responses. It handles initialization, invocation, and integration with Azure OpenAI.

## Location
Wrapped instance: `src/worker/agentManager/Agent.ts`

## Responsibilities

1. **Initialization**: Asynchronously set up the LangGraph agent
2. **Invocation**: Process messages and generate responses
3. **Checkpointing**: Maintain conversation state with MemorySaver
4. **Response Formatting**: Enforce structured output schemas
5. **Error Handling**: Gracefully handle failures

## Key Properties

```typescript
class AgentWorker {
  private agent: any;              // LangGraph agent instance
  private isAgentReady: Promise<any>;  // Initialization promise
}
```

## Initialization Flow

```
Constructor → isAgentReady = agent.initAgent()
              ↓
First callAgent() → await isAgentReady
                    ↓
                  this.agent = initialized agent
```

### Lazy Initialization
Agent is not awaited in constructor. Instead, it's awaited on first task execution:

```typescript
constructor(agentInstance: Agent) {
  this.isAgentReady = agentInstance.initAgent();  // Start, don't await
  // ... other initialization
}

private async callAgent(input: string, thread_id: string) {
  if (!this.agent) {
    this.agent = await this.isAgentReady;  // Await here
  }
  // ... proceed with invocation
}
```

**Benefits**:
- Non-blocking constructor
- Worker can be created immediately
- Initialization happens in parallel with other setup

## Agent Invocation

### Method Signature
```typescript
await this.agent.invoke(
  { messages: this.messages },
  { configurable: { thread_id: thread_id } }
);
```

### Required Configuration

#### thread_id (Required)
LangGraph with MemorySaver requires `thread_id` for tracking conversation:
**Current Implementation**: Hardcoded to `"1"`
**Future Enhancement**: Parameterize for multiple conversation threads

### Input Format
Messages are passed in LangGraph format:

```typescript
{
  messages: [
    { role: 'user', content: '"Hello"' },
    { role: 'user', content: '"How are you?"' }
  ]
}
```

**Note**: Content is JSON stringified

## Response Structure

### Structured Response
Agent returns a structured response based on the configured schema:

```typescript
response = {
  structuredResponse: {
    type: 'result' | 'delegate' | 'question' | 'error' | 'request_info',
    content: string
  },
  // ... other metadata from LangGraph
}
```

## Configuration

### Agent Config Structure
```typescript
interface AgentConfig {
  role: string;
  goal: string;
  systemPrompt: string;
  responseFormat?: ZodSchema;   // Structured output schema
  tools?: any[];                // LangChain tools
  mcpClientConfigs?: Record<string, MCPConfig>;
}
```

### Example Configuration
```typescript
const agentConfig = {
  role: "Researcher",
  goal: "Research topics thoroughly",
  systemPrompt: "You are a research specialist...",
  responseFormat: z.object({
    type: z.enum(['result', 'question', 'error']),
    content: z.string().min(1)
  })
};
```
## Usage Examples

### Basic Initialization
```typescript
const agentConfig = {
  role: "Assistant",
  goal: "Help users",
  systemPrompt: "You are a helpful assistant.",
  responseFormat: z.object({
    type: z.enum(['result']),
    content: z.string()
  })
};

const agent = new Agent(agentConfig);
const worker = new AgentWorker(agent);

// Agent initializes in background
// First task execution will await completion
await worker.createTask("Hello");
```

### With MCP Tools
```typescript
const agentConfig = {
  role: "Developer",
  goal: "Write code",
  systemPrompt: "You write clean code.",
  responseFormat: responseSchema,
  mcpClientConfigs: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    }
  }
};
```

## Related Documentation

- [Initialization Details](./initialization.md)
- [LangGraph Integration](./langgraph-integration.md)
- [Error Handling Guide](./error-handling.md)
- [AgentConfig Reference](../../agentConfig.md)
