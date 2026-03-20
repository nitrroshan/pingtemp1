## AgentManager

AgentManager orchestrates multi-agent initialization, task assignment, and communication.

### Features

1) Creates a set of roles needed to complete a task (via Role Builder)
2) Initializes Agents with roles, required tools, and prompts (via Config Builder)
3) Creates a Plan of actions to complete the task (via Plan Builder)
3) Manages task distribution among agents 
4) Facilitates communication and coordination among agents (planned interfaces)
5) Plans for future enhancements like dynamic role adjustment and inter-agent messaging


### Implementation
Task Distribution 
1) Decides the Agent to assign task based on role and capabilities
2) Assigns tasks to appropriate AgentWorkers. AgentsWorkers maintain a queue of tasks for their respective agents.
2) Works with AgentWorkers to assign new tasks to peer agents
3) Aggregates results from all agents for final output
Communication
1) Agents communicate via message passing through the AgentManager
2) Messages are tasks, status updates, or requests for information/tools

### Current Implementation (Steps 1–3)

- decideRoles(task): Produces normalized role descriptors from Role Builder output
- createAgentConfigsForRoles(task, roles): Generates an AgentConfig for each role
- startWorkers(configs): Starts one AgentWorker per AgentConfig
- broadcastTask(workers, taskInput): Executes a task across all workers and aggregates results

### Usage

```ts
import { runAgentManager } from "./agentManager.js";

const { roles, configs, workers } = await runAgentManager(
  "Analyze customer feedback and suggest improvements"
);

// Broadcast a follow-up task to all workers
// (optional) suppose taskInput is a string or an object
// const results = await mgr.broadcastTask(workers, "Process feedback batch #1");
// console.log(results);
```

### Roadmap

- Dynamic role adjustment (re-evaluating and updating roles mid-run)
- Inter-agent messaging and coordination channels
- Capability-based task routing (send tasks to agents with matching skills)
- Graceful shutdown and lifecycle management (dispose MCP clients, flush queues)
