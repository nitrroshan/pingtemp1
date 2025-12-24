# Frontend Components Documentation

## Overview
This document details the React components that make up the AgentChat frontend interface.

## Component Hierarchy

```
App
├── Sidebar
│   └── Agent hierarchy with recursive sub-agents
├── ChatArea
│   ├── Chat messages
│   ├── Input field
│   └── Task list
├── AgentModal
│   └── Create/Edit agent form
└── AgentManagerPanel
    ├── Active agents display
    └── Orchestration logs
```

## Components

### App.tsx
Main application component that manages global state and coordinates all child components.

**Location**: [src/AgentChat/App.tsx](../../src/AgentChat/App.tsx)

**State Management**:
```typescript
// Agent management
const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
const [activeAgentId, setActiveAgentId] = useState<string>();

// Chat and tasks
const [chatHistories, setChatHistories] = useState<Record<string, Message[]>>({});
const [tasks, setTasks] = useState<Record<string, Task[]>>({});

// UI state
const [isModalOpen, setIsModalOpen] = useState(false);
const [isPanelOpen, setIsPanelOpen] = useState(false);

// Orchestration
const [activeOrchestrationAgents, setActiveOrchestrationAgents] = useState<ActiveAgentState[]>([]);
const [orchestrationLogs, setOrchestrationLogs] = useState<OrchestrationEvent[]>([]);
```

**Key Features**:
- Hierarchical agent management with parent-child relationships
- Per-agent chat histories and task lists
- Real-time WebSocket connection management
- Orchestration monitoring and logging
- Agent creation/editing via modal

**Utility Functions**:
```typescript
// Find agent in nested structure
findAgentById(id: string, list: Agent[]): Agent | undefined

// Update agents recursively
updateAgents(list: Agent[], id: string, updater: (a: Agent) => Agent): Agent[]

// Create orchestrator for workflow
createOrchestratorAgent(workflowGoal: string): Agent

// Create sub-agent
createSubAgent(agentData: Partial<Agent>): Agent
```

### Sidebar.tsx
Navigation component displaying the agent hierarchy.

**Location**: [src/AgentChat/components/Sidebar.tsx](../../src/AgentChat/components/Sidebar.tsx)

**Props**:
```typescript
interface SidebarProps {
  agents: Agent[];
  activeAgentId: string;
  onAgentSelect: (id: string) => void;
  onAddAgent: (parentId?: string) => void;
  onTogglePanel: () => void;
  isPanelOpen: boolean;
  orchestrationActive: boolean;
}
```

**Features**:
- Hierarchical tree view with expand/collapse
- Visual indicators for active agent
- Add agent/sub-agent buttons
- Collapsible sections (Agents, Workflows)
- Agent status indicators

**Rendering Pattern**:
```typescript
const renderAgents = (agentList: Agent[], level: number = 0) => {
  return agentList.map(agent => (
    <div key={agent.id} style={{ paddingLeft: `${level * 16}px` }}>
      <AgentItem agent={agent} />
      {agent.subAgents && renderAgents(agent.subAgents, level + 1)}
    </div>
  ));
};
```

### ChatArea.tsx
Main chat interface for user-agent interaction.

**Location**: [src/AgentChat/components/ChatArea](../../src/AgentChat/components/ChatArea/)

**Props**:
```typescript
interface ChatAreaProps {
  agent: Agent;
  messages: Message[];
  tasks: Task[];
  onSendMessage: (content: string) => void;
  onToggleTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}
```

**Features**:
- Message list with user/model differentiation
- Scrollable message container with auto-scroll
- Task list sidebar with completion tracking
- Input field with send button
- Error message display
- Loading indicators

**Message Rendering**:
```typescript
messages.map(msg => (
  <div className={`message ${msg.role}`} key={msg.id}>
    <div className="message-header">
      <Icon /> {/* User or Bot icon */}
      <span>{msg.role === 'user' ? 'You' : agent.name}</span>
      <time>{formatTimestamp(msg.timestamp)}</time>
    </div>
    <div className={`message-content ${msg.isError ? 'error' : ''}`}>
      {msg.content}
    </div>
  </div>
))
```

**Task Management**:
```typescript
<div className="tasks-sidebar">
  {tasks.map(task => (
    <div key={task.id} className={task.completed ? 'completed' : ''}>
      <input 
        type="checkbox" 
        checked={task.completed}
        onChange={() => onToggleTask(task.id)}
      />
      <span>{task.title}</span>
      <button onClick={() => onDeleteTask(task.id)}>×</button>
    </div>
  ))}
</div>
```

### ChatArea/index.tsx
Chat message display and input handling.

**Sub-components**:
- Message list with virtualization
- Input field with text area
- Task sidebar
- File attachment support (future)

### AgentModal.tsx
Modal dialog for creating or editing agents.

**Location**: [src/AgentChat/components/AgentModal.tsx](../../src/AgentChat/components/AgentModal.tsx)

**Props**:
```typescript
interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (agent: Partial<Agent>) => void;
  editAgent?: Agent;
  parentAgent?: Agent;
}
```

**Form Fields**:
```typescript
// Agent configuration
name: string;              // Agent name
role: string;              // Role/type
description: string;       // Purpose description
systemInstruction: string; // System prompt
icon: string;              // Icon name from lucide-react
hasAppInterface: boolean;  // Show app tab
```

**Validation**:
- Name required (min 2 characters)
- Role required
- Description recommended
- System instruction recommended

**Usage Modes**:
1. **Create New Agent**: Empty form
2. **Create Sub-Agent**: Pre-fills parent relationship
3. **Edit Existing**: Loads agent data

### AgentManagerPanel.tsx
Real-time orchestration monitoring panel.

**Location**: [src/AgentChat/components/AgentManagerPanel.tsx](../../src/AgentChat/components/AgentManagerPanel.tsx)

**Props**:
```typescript
interface AgentManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeAgents: ActiveAgentState[];
  logs: OrchestrationEvent[];
  onCreateWorkflow: (goal: string) => void;
}
```

**Features**:
- Active agents display with status
- Real-time event logs with timestamps
- Workflow creation form
- Color-coded log levels
- Auto-scroll to latest events
- Clear logs functionality

**Active Agent Display**:
```typescript
<div className="active-agents">
  {activeAgents.map(agent => (
    <div key={agent.id} className={`agent-card ${agent.status}`}>
      <div className="agent-header">
        <span className="agent-name">{agent.name}</span>
        <span className={`status-badge ${agent.status}`}>
          {agent.status}
        </span>
      </div>
      <div className="agent-task">{agent.currentTask}</div>
      <div className="agent-reasoning">{agent.reasoning}</div>
      <time>{formatTimestamp(agent.assignedAt)}</time>
    </div>
  ))}
</div>
```

**Event Log**:
```typescript
<div className="event-logs">
  {logs.map(log => (
    <div key={log.id} className={`log-entry ${log.type}`}>
      <time>{formatTimestamp(log.timestamp)}</time>
      <span className="log-source">[{log.source}]</span>
      {log.target && <span className="log-target">→ {log.target}</span>}
      <span className="log-message">{log.message}</span>
    </div>
  ))}
</div>
```

**Log Types**:
- `info`: General information (blue)
- `success`: Successful operations (green)
- `warning`: Warnings (yellow)
- `error`: Errors (red)

## Shared Types

### Agent
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

### Message
```typescript
interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  isError?: boolean;
}
```

### Task
```typescript
interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}
```

### ActiveAgentState
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

### OrchestrationEvent
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

## Styling

### CSS Organization
```
src/AgentChat/
├── App.css              # Global styles
├── components/
│   ├── Sidebar.css
│   ├── ChatArea.css
│   ├── AgentModal.css
│   └── AgentManagerPanel.css
```

### Theme Variables
```css
:root {
  --primary-color: #0ea5e9;
  --secondary-color: #06b6d4;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --bg-primary: #1a1a1a;
  --bg-secondary: #2a2a2a;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
}
```

### Responsive Design
- Mobile-first approach
- Breakpoints: 768px (tablet), 1024px (desktop)
- Collapsible sidebars for small screens
- Touch-friendly button sizes

## Event Handling

### User Interactions
```typescript
// Agent selection
const handleAgentSelect = (id: string) => {
  setActiveAgentId(id);
  // Load chat history and tasks
};

// Message sending
const handleSendMessage = (content: string) => {
  // Add to local history
  // Send to backend via WebSocket
  // Wait for response
};

// Task management
const handleToggleTask = (taskId: string) => {
  setTasks(prev => ({
    ...prev,
    [activeAgentId]: prev[activeAgentId].map(t =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    )
  }));
};
```

### WebSocket Events
```typescript
useEffect(() => {
  agentManagerService.connect();
  
  agentManagerService.on('agent:message', handleAgentMessage);
  agentManagerService.on('agent:status', handleAgentStatus);
  agentManagerService.on('orchestration:log', handleOrchestrationLog);
  
  return () => {
    agentManagerService.off('agent:message', handleAgentMessage);
    agentManagerService.off('agent:status', handleAgentStatus);
    agentManagerService.off('orchestration:log', handleOrchestrationLog);
    agentManagerService.disconnect();
  };
}, []);
```

## State Management Patterns

### Hierarchical Updates
```typescript
// Update agent in nested structure
const updateAgent = (agentId: string, updates: Partial<Agent>) => {
  setAgents(prev => updateAgents(prev, agentId, agent => ({
    ...agent,
    ...updates
  })));
};
```

### Per-Agent Data
```typescript
// Chat histories by agent ID
chatHistories[agentId] = [...messages];

// Tasks by agent ID
tasks[agentId] = [...tasks];
```

### Optimistic Updates
```typescript
// Add message immediately (optimistic)
setChatHistories(prev => ({
  ...prev,
  [agentId]: [...prev[agentId], newMessage]
}));

// Send to backend
await agentManagerService.sendMessageToAgent(agentRole, content);
```

## Performance Optimization

### Memoization
```typescript
import { useMemo, useCallback } from 'react';

const sortedAgents = useMemo(() => 
  agents.sort((a, b) => a.name.localeCompare(b.name)),
  [agents]
);

const handleSend = useCallback((content: string) => {
  // Handler logic
}, [activeAgentId, chatHistories]);
```

### Virtual Scrolling
For large message lists:
```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={messages.length}
  itemSize={100}
>
  {({ index, style }) => (
    <div style={style}>
      <Message message={messages[index]} />
    </div>
  )}
</FixedSizeList>
```

### Code Splitting
```typescript
import { lazy, Suspense } from 'react';

const AgentModal = lazy(() => import('./components/AgentModal'));
const AgentManagerPanel = lazy(() => import('./components/AgentManagerPanel'));

<Suspense fallback={<LoadingSpinner />}>
  {isModalOpen && <AgentModal />}
</Suspense>
```

## Testing

### Component Tests
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders agents list', () => {
    const agents = [{ id: '1', name: 'TestAgent', ... }];
    render(<Sidebar agents={agents} />);
    expect(screen.getByText('TestAgent')).toBeInTheDocument();
  });
  
  it('handles agent selection', () => {
    const onSelect = jest.fn();
    render(<Sidebar onAgentSelect={onSelect} />);
    fireEvent.click(screen.getByText('TestAgent'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });
});
```

## Accessibility

### ARIA Labels
```typescript
<button aria-label="Send message" onClick={handleSend}>
  <Send />
</button>

<input 
  type="checkbox" 
  aria-label={`Mark task "${task.title}" as complete`}
  checked={task.completed}
/>
```

### Keyboard Navigation
- Tab order follows logical flow
- Enter submits forms
- Escape closes modals
- Arrow keys navigate lists

### Screen Reader Support
- Semantic HTML elements
- ARIA roles where needed
- Live regions for dynamic content

## Future Enhancements

1. **Drag and Drop**: Reorder agents, attach files
2. **Rich Text**: Markdown rendering in messages
3. **Code Highlighting**: Syntax highlighting for code blocks
4. **Voice Input**: Speech-to-text for messages
5. **Collaborative Editing**: Multiple users in same workspace
6. **Plugin System**: Extensible UI components
7. **Themes**: Light/dark mode, custom themes
8. **Internationalization**: Multi-language support

## Related Documentation

- [Frontend Overview](./README.md)
- [Services Layer](../../services/AgentManagerService.ts)
- [Types Definition](../../types.ts)
