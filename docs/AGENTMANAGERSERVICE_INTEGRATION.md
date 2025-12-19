# AgentManagerService Frontend Integration

## Overview
This document describes the integration of the backend `AgentManagerService` HTTP/WebSocket API with the React frontend (`App.tsx`), replacing local orchestrator agent creation with backend-managed orchestration.

## Changes Summary

### 1. **Import AgentManagerService** (`App.tsx` line 9)
```typescript
import { agentManagerService } from './services/AgentManagerService';
```

### 2. **Replace Local Orchestrator Creation with API Call**

**Before (Lines 129-147):**
```typescript
const handleAddAgent = (agentData: Partial<Agent>) => {
  if (!agentData.parentId) {
    const orchestratorId = generateId();
    const workflowGoal = agentData.description || "General Task";
    
    const orchestratorAgent: Agent = {
      id: orchestratorId,
      name: 'Orchestrator',
      role: 'Orchestrator',
      description: workflowGoal,
      systemInstruction: `You are the Orchestrator and Planner...`,
      icon: 'Cpu',
      subAgents: [],
      collapsed: false
    };

    setAgents(prev => [...prev, orchestratorAgent]);
    setActiveAgentId(orchestratorId);
  }
  // ...
}
```

**After (Lines 129-172):**
```typescript
const handleAddAgent = async (agentData: Partial<Agent>) => {
  if (!agentData.parentId) {
    const workflowGoal = agentData.description || "General Task";
    
    try {
      // Call backend API to create task and initiate orchestration
      console.log('[App] Creating task via AgentManagerService:', workflowGoal);
      const taskResponse = await agentManagerService.createTask(workflowGoal);
      
      console.log('[App] Task created successfully:', taskResponse);
      addOrchestrationLog('SYSTEM', `Task created: ${workflowGoal}`, 'success');
      
      // Create a UI representation of the orchestrator
      const orchestratorId = taskResponse.taskId || generateId();
      const orchestratorAgent: Agent = {
        id: orchestratorId,
        name: 'Orchestrator',
        role: 'Orchestrator',
        description: workflowGoal,
        systemInstruction: `Backend-managed orchestrator for: "${workflowGoal}"`,
        icon: 'Cpu',
        subAgents: [],
        collapsed: false
      };

      setAgents(prev => [...prev, orchestratorAgent]);
      setActiveAgentId(orchestratorId);
      
      // The backend will automatically:
      // 1. Discover roles via RoleManager
      // 2. Create workers via AgentManager
      // 3. Send updates via WebSocket
      
    } catch (error: any) {
      console.error('[App] Failed to create task:', error);
      addOrchestrationLog('SYSTEM', `Failed to create task: ${error.message}`, 'error');
      alert(`Failed to create task: ${error.message}`);
    }
  }
  // ... sub-agent handling remains unchanged
}
```

### 3. **Add WebSocket Event Listeners** (`App.tsx` lines 47-119)

Added `useEffect` hook to:
- Connect to `AgentManagerService` WebSocket on component mount
- Listen for backend events:
  - `workerUpdate`: Worker status changes
  - `roleDiscovery`: Role discovery completion
  - `taskUpdate`: Task status updates
  - `agentResponse`: Agent message responses
- Update UI state based on events:
  - `activeOrchestrationAgents`: Worker statuses
  - `orchestrationLogs`: Event logs for AgentManagerPanel
  - `chatHistories`: Agent responses added to chat

```typescript
useEffect(() => {
  console.log('[App] Connecting to AgentManagerService...');
  agentManagerService.connect();

  const handleWorkerUpdate = (data: any) => {
    console.log('[App] Worker update received:', data);
    addOrchestrationLog('BACKEND', `Worker: ${data.role} - ${data.status}`, 'info');
    
    setActiveOrchestrationAgents(prev => {
      const existing = prev.find(a => a.role === data.role);
      if (existing) {
        return prev.map(a => a.role === data.role ? { ...a, status: data.status } : a);
      }
      return [...prev, { role: data.role, status: data.status }];
    });
  };

  const handleRoleDiscovery = (data: any) => {
    console.log('[App] Roles discovered:', data);
    addOrchestrationLog('BACKEND', `Discovered roles: ${data.roles?.join(', ')}`, 'success');
  };

  const handleTaskUpdate = (data: any) => {
    console.log('[App] Task update:', data);
    addOrchestrationLog('BACKEND', `Task ${data.taskId}: ${data.status}`, 'info');
  };

  const handleAgentResponse = (data: any) => {
    console.log('[App] Agent response:', data);
    if (data.content) {
      addOrchestrationLog(data.role || 'AGENT', data.content, 'info');
      
      const matchingAgent = agents.find(a => a.role.toLowerCase() === data.role?.toLowerCase());
      if (matchingAgent) {
        const newMessage: Message = {
          id: generateId(),
          role: 'model',
          content: data.content,
          timestamp: Date.now()
        };
        setChatHistories(prev => ({
          ...prev,
          [matchingAgent.id]: [...(prev[matchingAgent.id] || []), newMessage]
        }));
      }
    }
  };

  agentManagerService.on('workerUpdate', handleWorkerUpdate);
  agentManagerService.on('roleDiscovery', handleRoleDiscovery);
  agentManagerService.on('taskUpdate', handleTaskUpdate);
  agentManagerService.on('agentResponse', handleAgentResponse);

  return () => {
    agentManagerService.off('workerUpdate', handleWorkerUpdate);
    agentManagerService.off('roleDiscovery', handleRoleDiscovery);
    agentManagerService.off('taskUpdate', handleTaskUpdate);
    agentManagerService.off('agentResponse', handleAgentResponse);
  };
}, [agents]);
```

## Architecture Flow

### Old Flow (Frontend Only)
1. User creates workflow via `AgentModal`
2. `handleAddAgent` creates local `orchestratorAgent` object
3. Frontend manages orchestration manually
4. No backend coordination

### New Flow (Backend-Integrated)
1. User creates workflow via `AgentModal`
2. `handleAddAgent` calls `agentManagerService.createTask(workflowGoal)`
3. Backend receives HTTP POST to `/api/createtask`
4. `AgentManager` orchestrates:
   - `RoleManager` discovers roles via builder agent
   - `AgentManager` creates workers per role
   - `AgentWorker` executes tasks via LangGraph agents
5. Backend sends real-time updates via WebSocket:
   - `workerUpdate`: Worker lifecycle events
   - `roleDiscovery`: Role discovery results
   - `taskUpdate`: Task status changes
   - `agentResponse`: Agent output messages
6. Frontend receives events and updates UI:
   - `AgentManagerPanel`: Shows active workers and logs
   - `ChatArea`: Displays agent responses
   - `Sidebar`: Updates agent status

## API Endpoints Used

### HTTP API
- **POST `/api/createtask`**
  - Request: `{ description: string }`
  - Response: `{ taskId: string, message: string }`
  - Called by: `agentManagerService.createTask(description)`

### WebSocket Events (Client → Server)
- `sendMessage`: Send message to specific agent role
  - Payload: `{ role: string, content: string }`

### WebSocket Events (Server → Client)
- `workerUpdate`: Worker status changed
  - Payload: `{ role: string, status: string }`
- `roleDiscovery`: Roles discovered
  - Payload: `{ roles: string[] }`
- `taskUpdate`: Task status updated
  - Payload: `{ taskId: string, status: string }`
- `agentResponse`: Agent generated response
  - Payload: `{ role: string, content: string }`

## Backend Components

### AgentManager (`src/worker/agentManager/AgentManager.ts`)
- Top-level orchestrator
- Plans tasks via builder agents
- Assigns tasks to workers
- Emits events via WebSocket

### RoleManager (`src/worker/roleManager/RoleManager.ts`)
- Discovers roles via ROLE builder agent
- Initializes role-specific workers
- Registers workers with AgentManager

### AgentWorker (`src/worker/AgentWorker/AgentWorker.ts`)
- Executes tasks using LangGraph agents
- Emits `taskComplete` events
- Maintains task queue per worker

### MemoryManager (`src/worker/memoryManager/MemoryManager.ts`)
- Stores tasks, prerequisites, status, outputs
- Tracks task dependencies
- Provides ready tasks per role

## Testing Checklist

- [ ] Backend server running (`npm run dev` in root)
- [ ] Frontend dev server running (`npm run dev` in `src/AgentChat`)
- [ ] WebSocket connection establishes on load (check console logs)
- [ ] Creating workflow triggers HTTP POST to `/api/createtask`
- [ ] Backend emits `roleDiscovery` event
- [ ] Backend emits `workerUpdate` events for each worker
- [ ] `AgentManagerPanel` shows active workers
- [ ] Orchestration logs display backend events
- [ ] Agent responses appear in chat history
- [ ] Error handling shows alert on API failure

## Environment Variables Required

### Backend (`.env` in root)
```bash
AZURE_OPENAI_ENDPOINT_URL=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
azureOpenAIApiDeploymentName=your-deployment-name
azureOpenAIApiVersion=2024-08-01-preview
```

### Frontend (`.env` in `src/AgentChat`)
```bash
VITE_API_BASE_URL=http://localhost:3002
VITE_WS_URL=ws://localhost:3003
```

## Known Limitations

1. **Sub-agent creation**: Still uses local state (Case 2 in `handleAddAgent`)
   - Future enhancement: Add API endpoint for sub-agent registration
2. **Chat message routing**: Messages sent in `ChatInput` use local `geminiService`
   - Future enhancement: Route through `agentManagerService.sendMessageToAgent()`
3. **Task management**: Tasks created via UI are local only
   - Future enhancement: Sync tasks with backend `MemoryManager`

## Debugging Tips

1. **WebSocket not connecting:**
   - Check `VITE_WS_URL` in `.env`
   - Verify backend WebSocket server is running on port 3003
   - Check browser console for connection errors

2. **API calls failing:**
   - Check `VITE_API_BASE_URL` in `.env`
   - Verify backend HTTP server is running on port 3002
   - Check Network tab in DevTools for 404/500 errors

3. **Events not received:**
   - Check backend console for event emission logs
   - Verify event listener names match exactly (case-sensitive)
   - Ensure `useEffect` dependency array includes `agents` for chat updates

4. **TypeScript errors:**
   - Ensure `AgentManagerService.ts` types match backend response schemas
   - Verify `Message` interface uses `'model'` not `'assistant'` for role type

## Related Files

- **Frontend:**
  - `src/AgentChat/App.tsx`: Main orchestration integration
  - `src/AgentChat/services/AgentManagerService.ts`: WebSocket/HTTP client
  - `src/AgentChat/components/AgentModal/`: Workflow creation UI
  - `src/AgentChat/components/AgentManagerPanel/`: Orchestration visualization

- **Backend:**
  - `src/worker/agentManager/AgentManager.ts`: Top-level orchestrator
  - `src/worker/roleManager/RoleManager.ts`: Role discovery
  - `src/worker/AgentWorker/AgentWorker.ts`: Task execution
  - `src/worker/memoryManager/MemoryManager.ts`: Task storage

## Next Steps

1. Test end-to-end workflow creation and execution
2. Add error boundaries for WebSocket disconnections
3. Implement chat message routing through backend
4. Add task synchronization with backend `MemoryManager`
5. Create sub-agent registration API endpoint
6. Add authentication/authorization for API calls
