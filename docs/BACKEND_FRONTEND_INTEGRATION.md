# Connecting Frontend to Backend Agents

## Architecture

```
┌─────────────────────────────────────┐
│   Frontend (React - Port 3001)     │
│                                     │
│  ┌────────────────────────────┐    │
│  │   Nexus Prime              │    │
│  │   (Main Orchestrator UI)   │    │
│  └──────────┬─────────────────┘    │
│             │                       │
│  ┌──────────▼─────────────────┐    │
│  │  AgentManagerService       │    │
│  │  (WebSocket + HTTP Client) │    │
│  └──────────┬─────────────────┘    │
└─────────────┼─────────────────────┘
              │
              │ HTTP (3002) + WS (3003)
              │
┌─────────────▼─────────────────────┐
│   Backend (Node.js)               │
│                                   │
│  ┌─────────────────────────────┐ │
│  │   AgentManagerAPI           │ │
│  │   (HTTP + WebSocket Server) │ │
│  └──────────┬──────────────────┘ │
│             │                     │
│  ┌──────────▼──────────────────┐ │
│  │   AgentManager              │ │
│  │   (Orchestrator + Planner)  │ │
│  └──────────┬──────────────────┘ │
│             │                     │
│  ┌──────────▼──────────────────┐ │
│  │   RoleManager               │ │
│  │   (Creates Workers)         │ │
│  └──────────┬──────────────────┘ │
│             │                     │
│  ┌──────────▼──────────────────┐ │
│  │   Workers (AgentWorker)     │ │
│  │   ├─ Code Architect         │ │
│  │   ├─ Debug Dragon           │ │
│  │   └─ Creative Director      │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

## Setup Steps

### 1. Install Dependencies

```bash
# In worker directory
cd src/worker
npm install express cors ws
npm install --save-dev @types/express @types/cors @types/ws

# In AgentChat directory (if needed)
cd ../AgentChat
npm install
```

### 2. Start the Backend Server

```bash
cd src/worker
npm run build
node dist/server.js
```

This will start:
- HTTP API on `http://localhost:3002`
- WebSocket on `ws://localhost:3003`

### 3. Start the Frontend

```bash
cd src/AgentChat
npm run dev
```

Frontend runs on `http://localhost:3001`

### 4. Connect Frontend to Backend

In your `App.tsx`, initialize the connection:

```typescript
import { agentManagerService } from './services/AgentManagerService';
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    // Connect to backend
    agentManagerService.connect()
      .then(() => console.log('Connected to AgentManager'))
      .catch(console.error);

    // Subscribe to all agents
    agentManagerService.subscribeToAgent('*');

    // Listen for task updates
    agentManagerService.on('task_update', (update) => {
      console.log('Task update:', update);
      // Update your UI here
    });

    // Cleanup
    return () => {
      agentManagerService.disconnect();
    };
  }, []);

  // ... rest of your component
}
```

## API Endpoints

### HTTP API (Port 3002)

- **GET** `/health` - Health check
- **GET** `/api/roles?task=<description>` - Get roles for a task
- **POST** `/api/tasks` - Create new task
  ```json
  { "description": "Analyze customer feedback" }
  ```
- **GET** `/api/tasks` - Get all tasks
- **GET** `/api/workers?task=<description>` - Get all workers

### WebSocket API (Port 3003)

**Client → Server Messages:**

```typescript
// Subscribe to agent updates
{
  type: 'subscribe',
  agentRole: 'code_architect' // or '*' for all
}

// Send message to agent
{
  type: 'send_message',
  agentRole: 'code_architect',
  content: 'Refactor the authentication module'
}
```

**Server → Client Messages:**

```typescript
// Connection confirmed
{
  type: 'connected',
  clientId: 'uuid',
  timestamp: 1234567890
}

// Task update
{
  type: 'task_update',
  agentRole: 'code_architect',
  update: { ... },
  timestamp: 1234567890
}

// Agent response
{
  type: 'agent_response',
  agentRole: 'code_architect',
  messageId: 'abc123',
  result: {
    type: 'result', // or 'delegate', 'question', 'error', 'request_info'
    content: 'Refactoring complete...',
    meta: { ... }
  },
  timestamp: 1234567890
}
```

## Usage Examples

### Send Chat Message to Agent

```typescript
const response = await agentManagerService.sendMessageToAgent(
  'code_architect',
  'Review the authentication code'
);

console.log(response.result.type); // 'result' | 'question' | etc.
console.log(response.result.content); // Agent's response
```

### Create a New Task

```typescript
const result = await agentManagerService.createTask(
  'Analyze customer feedback and suggest improvements'
);

console.log(result.status); // 'started'
```

### Get All Tasks

```typescript
const tasks = await agentManagerService.getTasks();
console.log(tasks); // Array of task objects
```

## Mapping Backend Agents to Frontend UI

In your `App.tsx`, map backend workers to frontend agents:

```typescript
useEffect(() => {
  agentManagerService.getWorkers()
    .then(workers => {
      // Map workers to your frontend agent structure
      const mappedAgents = workers.map(worker => ({
        id: worker.role,
        name: formatRoleName(worker.role),
        type: worker.role === 'orchestrator' ? 'orchestrator' : 'architect',
        status: worker.status,
        icon: getIconForRole(worker.role)
      }));
      
      setAgents(mappedAgents);
    });
}, []);
```

## Message Type Protocol

Backend workers return messages with types:
- **result**: Task completed successfully
- **delegate**: Task delegated to another agent
- **question**: Agent needs clarification
- **error**: Error occurred
- **request_info**: Agent needs more information

Handle these in your UI:

```typescript
agentManagerService.on('agent_response', (data) => {
  switch (data.result.type) {
    case 'result':
      // Show success message
      break;
    case 'question':
      // Show question dialog to user
      break;
    case 'delegate':
      // Show delegation to another agent
      break;
    // ...etc
  }
});
```

## Next Steps

1. ✅ Backend API created
2. ✅ Frontend service created
3. ⏳ Install dependencies (`express`, `cors`, `ws`)
4. ⏳ Update `package.json` scripts
5. ⏳ Integrate service into `App.tsx`
6. ⏳ Handle message types in UI
7. ⏳ Add real-time task updates to task panel
