# Orchestrator API Reference

**Give goals to your team's Planner.** The Planner breaks goals into tasks and assigns them to worker agents.

---

## Base URL

```
https://api.ping.ai/v1
```

All endpoints require authentication and team membership.

---

## Goals

### Give Goal to Team

Sends a goal to the team's Planner. The Planner analyzes the goal, creates high-level tasks, and assigns them to worker agents.

**Endpoint:**
```http
POST /teams/{teamId}/goals
```

**Request Body:**
```typescript
{
  goal: string                    // Natural language goal description
  context?: string                // Additional context or constraints
  executionMode?: 'sequential' | 'parallel' | 'hybrid'
  maxConcurrency?: number         // Max agents working simultaneously (parallel mode)
}
```

**Response:**
```typescript
{
  id: string                      // Goal execution ID
  goal: string
  status: 'analyzing' | 'planning' | 'executing' | 'completed' | 'failed'
  teamId: string
  createdAt: string
  
  planner: {
    id: string
    status: 'analyzing'           // Current Planner activity
    currentAction: 'Analyzing goal and identifying required capabilities'
  }
  
  tasks: []                       // Empty initially, populated after planning
  
  _links: {
    self: string                  // This goal
    websocket: string             // WebSocket URL for real-time updates
    tasks: string                 // Tasks endpoint
  }
}
```

**Example:**
```bash
curl -X POST https://api.ping.ai/v1/teams/team-123/goals \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Create comprehensive API documentation for the user management service",
    "context": "Target audience: Backend developers. Include authentication, CRUD operations, and error handling.",
    "executionMode": "parallel"
  }'
```

**What happens:**
1. Planner receives goal
2. Analyzes requirements
3. Creates high-level tasks
4. Assigns tasks to worker agents
5. Worker agents execute their tasks
6. Results saved to workspace

---

### Get Goal Status

Retrieves current status of goal execution including tasks and agent activity.

**Endpoint:**
```http
GET /teams/{teamId}/goals/{goalId}
```

**Response:**
```typescript
{
  id: string
  goal: string
  status: 'analyzing' | 'planning' | 'executing' | 'completed' | 'failed'
  progress: number                // 0-100 percentage
  createdAt: string
  completedAt?: string
  
  planner: {
    id: string
    status: 'completed'
    completedAt: string
    message: 'Created 5 tasks and assigned to worker agents'
  }
  
  tasks: [
    {
      id: string
      name: string
      description: string
      assignedTo: string          // Agent ID
      agentRole: string           // e.g., 'technical-writer'
      status: 'ready' | 'in_progress' | 'completed' | 'failed'
      progress: number
      prerequisites: string[]     // Task IDs that must complete first
      outputs: string[]           // Expected artifact paths
      createdAt: string
      startedAt?: string
      completedAt?: string
    }
  ]
  
  activeAgents: [
    {
      agentId: string
      role: string
      currentTask: string
      status: 'working' | 'waiting' | 'idle'
      lastActivity: string
    }
  ]
  
  artifacts: [
    {
      path: string
      name: string
      createdBy: string           // Agent ID
      createdAt: string
    }
  ]
}
```

---

### List Goals

Lists all goals for a team with optional status filter.

**Endpoint:**
```http
GET /teams/{teamId}/goals
```

**Query Parameters:**
- `status` - Filter by status (e.g., `executing`, `completed`)
- `limit` - Max results (default: 20)
- `offset` - Pagination offset

**Response:**
```typescript
{
  goals: [
    {
      id: string
      goal: string
      status: string
      progress: number
      taskCount: number
      completedTasks: number
      createdAt: string
      completedAt?: string
    }
  ]
  pagination: {
    total: number
    limit: number
    offset: number
  }
}
```

---

### Cancel Goal

Cancels an executing goal. In-progress tasks complete; pending tasks are cancelled.

**Endpoint:**
```http
POST /teams/{teamId}/goals/{goalId}/cancel
```

**Response:**
```typescript
{
  id: string
  status: 'cancelled'
  cancelledAt: string
  tasksCompleted: number
  tasksCancelled: number
  message: 'Goal cancelled. Completed tasks: 3, Cancelled tasks: 2'
}
```

---

## Tasks

### Get Task

Retrieves detailed task information including agent activity.

**Endpoint:**
```http
GET /teams/{teamId}/goals/{goalId}/tasks/{taskId}
```

**Response:**
```typescript
{
  id: string
  name: string
  description: string
  goalId: string
  
  assignment: {
    agentId: string
    agentRole: string
    agentName: string
    assignedAt: string
  }
  
  status: 'ready' | 'in_progress' | 'completed' | 'failed'
  progress: number
  
  prerequisites: [
    {
      taskId: string
      taskName: string
      completed: boolean
    }
  ]
  
  outputs: [
    {
      expected: string            // Expected artifact path
      actual?: string             // Actual artifact path
      createdAt?: string
    }
  ]
  
  execution: {
    startedAt?: string
    completedAt?: string
    duration?: number             // Seconds
    error?: {
      code: string
      message: string
      suggestion: string
    }
  }
  
  agentActivity: [
    {
      timestamp: string
      action: string              // e.g., 'Analyzing API endpoints'
      progress: number
    }
  ]
}
```

---

### Retry Task

Retries a failed task with optional modifications.

**Endpoint:**
```http
POST /teams/{teamId}/goals/{goalId}/tasks/{taskId}/retry
```

**Request Body:**
```typescript
{
  modifiedDescription?: string   // Optional: Update task description
  reassignTo?: string            // Optional: Assign to different agent
}
```

**Response:**
```typescript
{
  id: string
  status: 'ready'
  message: 'Task queued for retry'
  retryCount: number
}
```

---

### Reassign Task

Reassigns a task to a different agent.

**Endpoint:**
```http
POST /teams/{teamId}/goals/{goalId}/tasks/{taskId}/reassign
```

**Request Body:**
```typescript
{
  agentId: string                // New agent ID
  reason?: string                // Optional reason for reassignment
}
```

**Response:**
```typescript
{
  id: string
  previousAgent: string
  newAgent: string
  reassignedAt: string
  message: 'Task reassigned successfully'
}
```

---

## Agent Messaging

> **Note:** For real-time interactive chat with agents, use **WebSocket** (see [WebSocket Events](./websocket-events.md)). These HTTP endpoints are for programmatic messaging or systems that can't use WebSocket.

### Send Message to Agent

Sends a message to a specific agent programmatically.

**Use Cases:**
- Automated scripts or cron jobs sending instructions to agents
- Systems that cannot use WebSocket (polling-based)
- Programmatic agent guidance (not interactive user chat)

**Endpoint:**
```http
POST /teams/{teamId}/agents/{agentId}/messages
```

**Request Body:**
```typescript
{
  content: string                // Message content
  context?: {
    taskId?: string              // Related task
    artifactPath?: string        // Related artifact
  }
}
```

**Response:**
```typescript
{
  id: string
  agentId: string
  content: string
  sentAt: string
  
  agentResponse?: {
    content: string
    timestamp: string
    action?: string              // e.g., 'task_updated', 'artifact_created'
  }
}
```

---

### Get Agent Messages

Retrieves conversation history with an agent.

**Endpoint:**
```http
GET /teams/{teamId}/agents/{agentId}/messages
```

**Query Parameters:**
- `since` - Return messages after this timestamp
- `limit` - Max messages (default: 50)

**Response:**
```typescript
{
  messages: [
    {
      id: string
      from: 'user' | 'agent'
      content: string
      timestamp: string
      context?: {
        taskId?: string
        artifactPath?: string
      }
    }
  ]
}
```

---

## Execution Control

### Pause Goal Execution

Pauses goal execution after current tasks complete.

**Endpoint:**
```http
POST /teams/{teamId}/goals/{goalId}/pause
```

**Response:**
```typescript
{
  id: string
  status: 'paused'
  pausedAt: string
  activeTasks: number            // Tasks that will complete before full pause
  message: 'Execution pausing. Active tasks will complete.'
}
```

---

### Resume Goal Execution

Resumes a paused goal.

**Endpoint:**
```http
POST /teams/{teamId}/goals/{goalId}/resume
```

**Response:**
```typescript
{
  id: string
  status: 'executing'
  resumedAt: string
  message: 'Execution resumed'
}
```

---

## Planner Interaction

### Query Planner

Ask the Planner to analyze a goal without executing it.

**Endpoint:**
```http
POST /teams/{teamId}/planner/analyze
```

**Request Body:**
```typescript
{
  goal: string
  context?: string
}
```

**Response:**
```typescript
{
  goal: string
  analysis: {
    complexity: 'low' | 'medium' | 'high'
    estimatedTasks: number
    estimatedDuration: string    // e.g., '2-3 hours'
    requiredRoles: string[]      // Agent roles needed
    missingCapabilities: string[] // Capabilities team lacks
  }
  
  suggestedTasks: [
    {
      name: string
      description: string
      suggestedAgent: string
      estimatedDuration: string
    }
  ]
  
  recommendations: [
    string                        // e.g., 'Add QA Engineer agent for testing tasks'
  ]
}
```

---

### Modify Task Plan

Request Planner to adjust tasks for an executing goal.

**Endpoint:**
```http
POST /teams/{teamId}/goals/{goalId}/replan
```

**Request Body:**
```typescript
{
  instruction: string            // e.g., 'Add security review task'
  context?: string
}
```

**Response:**
```typescript
{
  goalId: string
  status: 'replanning'
  planner: {
    status: 'analyzing instruction'
    message: 'Analyzing modification request...'
  }
  message: 'Planner is adjusting task plan'
}
```

---

## Error Responses

**Standard Error Format:**
```typescript
{
  error: {
    code: string
    message: string
    details?: any
  }
}
```

**Common Error Codes:**

| Code | Status | Description |
|------|--------|-------------|
| `GOAL_NOT_FOUND` | 404 | Goal does not exist |
| `TASK_NOT_FOUND` | 404 | Task does not exist |
| `AGENT_NOT_FOUND` | 404 | Agent does not exist |
| `AGENT_BUSY` | 409 | Agent is currently executing another task |
| `TASK_NOT_READY` | 400 | Prerequisites not met |
| `INSUFFICIENT_CAPABILITIES` | 400 | No agent has required capabilities |
| `EXECUTION_FAILED` | 500 | Task execution failed |

---

## Rate Limits

- **Standard tier**: 100 requests/minute
- **Pro tier**: 1000 requests/minute
- **Enterprise tier**: Custom limits

---

## Next Steps

- **[WebSocket Events](./websocket-events.md)** - Real-time goal and task updates
- **[Artifact API](./artifact-api.md)** - Access agent-created artifacts
- **[Team API](./team-api.md)** - Manage team and agents
