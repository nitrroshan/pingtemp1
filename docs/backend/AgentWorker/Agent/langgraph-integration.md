# LangGraph Integration

## Overview
AgentWorker runs an Agent.(external or internal) to process tasks. 



Current Implementation:
1. Creates Agents with LangGraph:
  1. Starts an agent
    1. (System Prompt with a goal)
  2. Runs a task
  3. Return a structured output

---
### Key Concepts
- AgentWorker Exposed functions:
  - `createTask(input: string, threadId?: string)`: Enqueue a task for processing
  - `callAgent(input: string, threadId: string)`: Invoke the agent with input and thread context
  Future:
  - plugin different agents (not only ReactAgent)
- **Agent**: An entity that processes messages using an LLM and tools
- **Thread**: A conversation context that maintains state across interactions
- **Tools**: External functions or APIs that the agent can call to perform actions
- **Schemas**: Define the structure of the agent's output for consistency
```
### Example Usage
```

## Related Documentation

- [Agent Overview](./README.md)
- [Implementation](./implementation.md)
- [Error Handling](./error-handling.md)
- [LangGraph Official Docs](https://langchain-ai.github.io/langgraph/)
