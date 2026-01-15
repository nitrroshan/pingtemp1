# WebSocket Events Reference

**Real-time updates for agent activity, tasks, and artifacts.** Subscribe to events for live collaboration.

---

## Connection

### WebSocket URL

```
wss://api.ping.ai/v1/ws
```

### Authentication

Authenticate via query parameter or upgrade header:

**Query Parameter:**
```javascript
const ws = new WebSocket('wss://api.ping.ai/v1/ws?token=YOUR_API_TOKEN')
```

**Header (during upgrade):**
```http
Authorization: Bearer YOUR_API_TOKEN
```

### Connection Example

```javascript
const socket = new WebSocket('wss://api.ping.ai/v1/ws?token=' + apiToken)

socket.onopen = () => {
  console.log('Connected to Ping')
}

socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  handleEvent(message)
}

socket.onerror = (error) => {
  console.error('WebSocket error:', error)
}

socket.onclose = () => {
  console.log('Disconnected from Ping')
}
```

---

## Subscriptions

### Subscribe to Team

Receive all events for a team (goals, tasks, agents, artifacts).

**Send:**
```json
{
  "type": "subscribe",
  "channel": "team",
  "teamId": "team-123"
}
```

**Response:**
```json
{
  "type": "subscribed",
  "channel": "team",
  "teamId": "team-123",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

### Subscribe to Goal

Receive events for a specific goal execution.

**Send:**
```json
{
  "type": "subscribe",
  "channel": "goal",
  "goalId": "goal-456"
}
```

**Response:**
```json
{
  "type": "subscribed",
  "channel": "goal",
  "goalId": "goal-456",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

### Subscribe to Agent

Receive events for a specific agent's activity.

**Send:**
```json
{
  "type": "subscribe",
  "channel": "agent",
  "agentId": "agent-789"
}
```

**Response:**
```json
{
  "type": "subscribed",
  "channel": "agent",
  "agentId": "agent-789",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

### Unsubscribe

Stop receiving events for a channel.

**Send:**
```json
{
  "type": "unsubscribe",
  "channel": "team",
  "teamId": "team-123"
}
```

**Response:**
```json
{
  "type": "unsubscribed",
  "channel": "team",
  "teamId": "team-123",
  "timestamp": "2026-01-15T10:35:00Z"
}
```

---

## Event Types

### Goal Events

#### goal:created

Emitted when a goal is given to the team.

```json
{
  "type": "goal:created",
  "goalId": "goal-456",
  "teamId": "team-123",
  "goal": "Create API documentation for user service",
  "status": "analyzing",
  "plannerAgent": {
    "id": "agent-planner",
    "status": "analyzing",
    "message": "Analyzing goal requirements..."
  },
  "timestamp": "2026-01-15T10:30:00Z"
}
```

#### goal:planning

Emitted when Planner Agent starts creating tasks.

```json
{
  "type": "goal:planning",
  "goalId": "goal-456",
  "plannerAgent": {
    "id": "agent-planner",
    "status": "planning",
    "message": "Creating high-level tasks and assigning to agents..."
  },
  "timestamp": "2026-01-15T10:30:15Z"
}
```

#### goal:executing

Emitted when agents start executing tasks.

```json
{
  "type": "goal:executing",
  "goalId": "goal-456",
  "status": "executing",
  "tasks": [
    {
      "id": "task-001",
      "name": "Analyze API endpoints",
      "assignedTo": "agent-789",
      "status": "ready"
    },
    {
      "id": "task-002",
      "name": "Write documentation",
      "assignedTo": "agent-790",
      "status": "ready"
    }
  ],
  "timestamp": "2026-01-15T10:30:30Z"
}
```

#### goal:progress

Emitted periodically during execution with progress updates.

```json
{
  "type": "goal:progress",
  "goalId": "goal-456",
  "progress": 45,
  "completedTasks": 2,
  "totalTasks": 5,
  "activeAgents": 2,
  "timestamp": "2026-01-15T10:35:00Z"
}
```

#### goal:completed

Emitted when all tasks complete.

```json
{
  "type": "goal:completed",
  "goalId": "goal-456",
  "status": "completed",
  "completedAt": "2026-01-15T11:00:00Z",
  "duration": 1800,
  "tasksCompleted": 5,
  "artifactsCreated": 8,
  "artifacts": [
    {
      "path": "docs/api-documentation.md",
      "size": 15420,
      "createdBy": "agent-790"
    }
  ],
  "timestamp": "2026-01-15T11:00:00Z"
}
```

#### goal:failed

Emitted when goal execution fails.

```json
{
  "type": "goal:failed",
  "goalId": "goal-456",
  "status": "failed",
  "error": {
    "code": "INSUFFICIENT_CONTEXT",
    "message": "Agents lack required context to complete tasks",
    "failedTask": "task-003",
    "suggestion": "Provide API specification document"
  },
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

### Task Events

#### task:started

Emitted when an agent starts working on a task.

```json
{
  "type": "task:started",
  "taskId": "task-001",
  "goalId": "goal-456",
  "name": "Analyze API endpoints",
  "agentId": "agent-789",
  "agentRole": "api-developer",
  "startedAt": "2026-01-15T10:31:00Z",
  "timestamp": "2026-01-15T10:31:00Z"
}
```

#### task:progress

Emitted during task execution with progress updates.

```json
{
  "type": "task:progress",
  "taskId": "task-001",
  "goalId": "goal-456",
  "agentId": "agent-789",
  "progress": 60,
  "currentAction": "Analyzing authentication endpoints",
  "timestamp": "2026-01-15T10:33:00Z"
}
```

#### task:completed

Emitted when a task completes successfully.

```json
{
  "type": "task:completed",
  "taskId": "task-001",
  "goalId": "goal-456",
  "name": "Analyze API endpoints",
  "agentId": "agent-789",
  "completedAt": "2026-01-15T10:35:00Z",
  "duration": 240,
  "outputs": [
    {
      "path": "docs/endpoints.md",
      "size": 4200
    }
  ],
  "timestamp": "2026-01-15T10:35:00Z"
}
```

#### task:failed

Emitted when a task fails.

```json
{
  "type": "task:failed",
  "taskId": "task-003",
  "goalId": "goal-456",
  "name": "Create code examples",
  "agentId": "agent-791",
  "failedAt": "2026-01-15T10:40:00Z",
  "error": {
    "code": "MISSING_DEPENDENCY",
    "message": "Cannot create examples without completed documentation",
    "prerequisite": "task-002"
  },
  "timestamp": "2026-01-15T10:40:00Z"
}
```

---

### Agent Events

#### agent:message

Emitted when an agent sends a message (e.g., status update, question).

```json
{
  "type": "agent:message",
  "agentId": "agent-789",
  "agentRole": "api-developer",
  "agentName": "API Developer",
  "content": "Found 12 endpoints. Starting documentation for authentication flow.",
  "context": {
    "taskId": "task-001",
    "goalId": "goal-456"
  },
  "timestamp": "2026-01-15T10:32:00Z"
}
```

#### agent:action

Emitted when an agent performs a significant action.

```json
{
  "type": "agent:action",
  "agentId": "agent-790",
  "action": "file_created",
  "details": {
    "path": "docs/api-overview.md",
    "size": 2400,
    "type": "markdown"
  },
  "context": {
    "taskId": "task-002"
  },
  "timestamp": "2026-01-15T10:36:00Z"
}
```

#### agent:idle

Emitted when an agent becomes idle (no assigned tasks).

```json
{
  "type": "agent:idle",
  "agentId": "agent-789",
  "agentRole": "api-developer",
  "idleSince": "2026-01-15T10:35:00Z",
  "timestamp": "2026-01-15T10:35:00Z"
}
```

#### agent:delegated

Emitted when an agent is delegated to a team member.

```json
{
  "type": "agent:delegated",
  "agentId": "agent-792",
  "agentRole": "frontend-developer",
  "delegatedTo": "user-555",
  "delegatedBy": "user-123",
  "delegatedAt": "2026-01-15T10:20:00Z",
  "timestamp": "2026-01-15T10:20:00Z"
}
```

#### agent:reclaimed

Emitted when owner reclaims a delegated agent.

```json
{
  "type": "agent:reclaimed",
  "agentId": "agent-792",
  "agentRole": "frontend-developer",
  "reclaimedBy": "user-123",
  "reclaimedAt": "2026-01-15T10:50:00Z",
  "timestamp": "2026-01-15T10:50:00Z"
}
```

---

### Artifact Events

#### artifact:created

Emitted when an agent creates an artifact.

```json
{
  "type": "artifact:created",
  "artifactId": "artifact-001",
  "path": "docs/api-documentation.md",
  "name": "api-documentation.md",
  "type": "markdown",
  "size": 15420,
  "createdBy": "agent-790",
  "context": {
    "taskId": "task-002",
    "goalId": "goal-456"
  },
  "gitCommit": "a3f2e1d",
  "timestamp": "2026-01-15T10:38:00Z"
}
```

#### artifact:updated

Emitted when an artifact is modified.

```json
{
  "type": "artifact:updated",
  "artifactId": "artifact-001",
  "path": "docs/api-documentation.md",
  "updatedBy": "agent-791",
  "changes": {
    "linesAdded": 45,
    "linesRemoved": 12,
    "sizeDelta": 1200
  },
  "gitCommit": "b4c3d2e",
  "timestamp": "2026-01-15T10:42:00Z"
}
```

#### artifact:approved

Emitted when a human approves an artifact.

```json
{
  "type": "artifact:approved",
  "artifactId": "artifact-001",
  "path": "docs/api-documentation.md",
  "approvedBy": "user-123",
  "approvedAt": "2026-01-15T10:55:00Z",
  "timestamp": "2026-01-15T10:55:00Z"
}
```

---

### Team Events

#### team:member_added

Emitted when a member is added to the team.

```json
{
  "type": "team:member_added",
  "teamId": "team-123",
  "userId": "user-555",
  "role": "member",
  "addedBy": "user-123",
  "timestamp": "2026-01-15T09:00:00Z"
}
```

#### team:member_removed

Emitted when a member is removed.

```json
{
  "type": "team:member_removed",
  "teamId": "team-123",
  "userId": "user-555",
  "removedBy": "user-123",
  "agentsReclaimed": ["agent-792", "agent-793"],
  "timestamp": "2026-01-15T11:30:00Z"
}
```

#### team:agent_added

Emitted when an agent is added to the team.

```json
{
  "type": "team:agent_added",
  "teamId": "team-123",
  "agentId": "agent-794",
  "agentRole": "qa-engineer",
  "addedBy": "user-123",
  "timestamp": "2026-01-15T09:15:00Z"
}
```

---

## Client Libraries

### JavaScript/TypeScript

```typescript
import { PingWebSocket } from '@ping/client'

const socket = new PingWebSocket({
  token: 'your-api-token'
})

// Subscribe to team events
await socket.subscribe('team', 'team-123')

// Listen for specific events
socket.on('goal:created', (event) => {
  console.log('New goal:', event.goal)
})

socket.on('task:completed', (event) => {
  console.log(`Task ${event.name} completed by ${event.agentId}`)
})

socket.on('agent:message', (event) => {
  console.log(`${event.agentName}: ${event.content}`)
})
```

### Python

```python
from ping import PingWebSocket

socket = PingWebSocket(token='your-api-token')

# Subscribe to goal
socket.subscribe('goal', 'goal-456')

# Event handlers
@socket.on('task:progress')
def handle_progress(event):
    print(f"Task {event['taskId']}: {event['progress']}%")

@socket.on('artifact:created')
def handle_artifact(event):
    print(f"New artifact: {event['path']}")

socket.connect()
```

---

## Error Events

### error

Emitted when an error occurs.

```json
{
  "type": "error",
  "error": {
    "code": "SUBSCRIPTION_FAILED",
    "message": "Team not found or access denied",
    "details": {
      "teamId": "team-999"
    }
  },
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

## Heartbeat

Server sends periodic heartbeat to keep connection alive.

**Server sends:**
```json
{
  "type": "ping",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

**Client should respond:**
```json
{
  "type": "pong",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

## Best Practices

1. **Reconnection**: Implement exponential backoff for reconnections
2. **Heartbeat**: Respond to pings to keep connection alive
3. **Subscriptions**: Unsubscribe when no longer needed to reduce load
4. **Error Handling**: Always handle error events
5. **Message Queuing**: Queue messages if connection is temporarily lost

---

## Rate Limits

- **Max subscriptions per connection**: 50
- **Max messages per second**: 100
- **Connection timeout**: 5 minutes of inactivity

---

## Next Steps

- **[Orchestrator API](./orchestrator-api.md)** - Give goals to trigger events
- **[Artifact API](./artifact-api.md)** - Access artifacts from events
- **[Team API](./team-api.md)** - Manage team to receive events
