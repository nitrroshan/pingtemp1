# Frontend Documentation - AgentChat

## Overview
AgentChat is a React-based frontend application for managing and interacting with AI agents. It provides a browser-based interface for creating agent hierarchies, managing chat sessions, orchestrating workflows, and monitoring agent activities in real-time.

## Technology Stack
- **Framework**: React 19.2.0 with TypeScript
- **Build Tool**: Vite 6.2.0
- **UI Icons**: lucide-react
- **Real-time Communication**: Socket.IO Client 4.8.1
- **AI Integration**: @google/genai (Gemini API)
- **Runtime**: Electron (optional desktop mode)

## Project Structure

```
src/AgentChat/
├── App.tsx                     # Main application component
├── index.tsx                   # Entry point
├── types.ts                    # TypeScript type definitions
├── constants.ts                # Application constants
├── components/                 # React components
│   ├── Sidebar.tsx            # Agent hierarchy navigation
│   ├── ChatArea.tsx           # Main chat interface
│   ├── AgentModal.tsx         # Create/edit agent modal
│   └── AgentManagerPanel.tsx  # Orchestration monitoring panel
├── services/                   # Service layer
│   ├── AgentManagerService.ts # Unified backend communication
│   ├── SocketService.ts       # WebSocket management
│   ├── HttpService.ts         # HTTP API calls
│   └── geminiService.ts       # Google Gemini integration
├── dummyData/                  # Mock data for development
├── assets/                     # Static assets and icons
└── electron/                   # Electron app configuration
```

## Key Components

### App.tsx
The root component that manages:
- Agent hierarchy state
- Chat histories for each agent
- Task management per agent
- Real-time orchestration events
- WebSocket connection lifecycle

**Key Features**:
- Multi-agent management with parent-child relationships
- Per-agent chat sessions with persistent history
- Task tracking and completion status
- Real-time orchestration logs and agent status updates
- Workflow creation and monitoring

### Components

#### Sidebar
- Displays hierarchical agent structure
- Supports drag-and-drop agent creation
- Shows agent status indicators
- Allows expanding/collapsing sub-agents
- Provides quick access to agent workflows

#### ChatArea
- Main chat interface for user-agent interaction
- Real-time message streaming
- Task list per agent
- Support for multiple chat modes (user, orchestrator, app)
- Message history with error handling

#### AgentManagerPanel
- Real-time orchestration monitoring
- Active agents display with status
- Event log with timestamped entries
- Workflow progress tracking
- Color-coded log levels (info, success, warning, error)

#### AgentModal
- Create new agents or sub-agents
- Edit agent configuration
- Set agent roles, descriptions, and system instructions
- Icon selection from lucide-react

## Services Architecture

### AgentManagerService
Unified service combining Socket.IO and HTTP communication with the backend.

**Responsibilities**:
- WebSocket connection management
- Agent subscription/unsubscription
- Message routing to/from agents
- HTTP API calls for workflows and orchestration
- Event listener management

**Key Methods**:
```typescript
connect(): Promise<void>
subscribeToAgent(agentRole: string): void
sendMessageToAgent(agentRole: string, content: string): Promise<AgentResponse>
createWorkflow(workflowGoal: string): Promise<WorkflowResponse>
on(event: string, callback: Function): void
```

### SocketService
Manages WebSocket connections and real-time events.

**Features**:
- Automatic reconnection handling
- Event subscription management
- Message queuing during disconnection
- Connection state tracking

**Events**:
- `connect`: Connection established
- `disconnect`: Connection lost
- `agent:message`: Message from an agent
- `agent:status`: Agent status update
- `orchestration:log`: Orchestration event log
- `workflow:progress`: Workflow execution progress

### HttpService
Handles HTTP API requests to the backend.

**Endpoints**:
- `POST /api/workflow/create`: Create new workflow
- `POST /api/workflow/start`: Start workflow execution
- `GET /api/agents`: List available agents
- `POST /api/agents`: Register new agent

### geminiService
Integration with Google Gemini API for AI capabilities.

**Features**:
- Direct AI model access
- Streaming responses
- Context management
- Error handling

## Type Definitions

### Core Types

#### Agent
```typescript
interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  icon: string;
  systemInstruction: string;
  parentId?: string;
  subAgents?: Agent[];
  collapsed?: boolean;
  hasAppInterface?: boolean;
}
```

#### Message
```typescript
interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  isError?: boolean;
}
```

#### Task
```typescript
interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}
```

#### ActiveAgentState
```typescript
interface ActiveAgentState {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'completed' | 'failed';
  currentTask: string;
  reasoning: string;
  assignedAt: number;
}
```

#### OrchestrationEvent
```typescript
interface OrchestrationEvent {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  source: string;
  target?: string;
}
```

## State Management

The application uses React's built-in state management with hooks:

- `useState`: Local component state
- `useEffect`: Side effects and lifecycle management
- Event-driven updates via WebSocket callbacks

**Key State Variables**:
- `agents`: Hierarchical agent structure
- `chatHistories`: Per-agent message history
- `tasks`: Per-agent task lists
- `activeOrchestrationAgents`: Currently active agents in workflows
- `orchestrationLogs`: Real-time event logs

## Real-time Communication Flow

1. **Connection Establishment**:
   - App initializes and connects to backend via `AgentManagerService`
   - WebSocket connection established on component mount

2. **Agent Subscription**:
   - User selects an agent
   - Frontend subscribes to agent's event channel
   - Backend routes agent responses to subscribed clients

3. **Message Flow**:
   ```
   User Input → ChatArea → AgentManagerService → Backend
   Backend → Agent Processing → Socket Emission → Frontend Update
   ```

4. **Workflow Execution**:
   - User creates workflow goal
   - Backend orchestrates multiple agents
   - Real-time status updates stream to frontend
   - Orchestration panel displays progress

## Development

### Setup
```bash
cd src/AgentChat
npm install
npm run dev
```

### Build
```bash
npm run build
```

### Electron Mode
```bash
# Build and run as desktop app
npm run electron:dev
```

## Configuration

### Environment Variables
Create a `.env` file in `src/AgentChat/`:

```env
VITE_BACKEND_URL=http://localhost:3002
VITE_GEMINI_API_KEY=your_gemini_api_key
```

### Constants
Key configuration in `constants.ts`:
- Default agent templates
- UI theme colors
- Icon mappings
- API endpoints

## Best Practices

1. **Component Organization**:
   - Keep components focused and single-responsibility
   - Extract reusable logic into custom hooks
   - Use TypeScript for type safety

2. **State Management**:
   - Lift state to appropriate level
   - Avoid prop drilling with context when needed
   - Keep socket subscriptions clean (subscribe/unsubscribe)

3. **Performance**:
   - Memoize expensive computations
   - Debounce user inputs
   - Lazy load components when possible

4. **Error Handling**:
   - Graceful degradation on connection loss
   - User-friendly error messages
   - Automatic retry for failed operations

## Future Enhancements

- **Persistent Storage**: Save agent configurations and chat history
- **Advanced Workflows**: Visual workflow builder
- **Collaboration**: Multi-user agent sharing
- **Analytics**: Usage statistics and performance metrics
- **Plugin System**: Extensible agent capabilities
- **Mobile Support**: Responsive design improvements

## Related Documentation

- [Backend Integration](../BACKEND_FRONTEND_INTEGRATION.md)
- [Agent Manager Service](../AGENTMANAGERSERVICE_INTEGRATION.md)
- [Backend Documentation](../backend/README.md)
