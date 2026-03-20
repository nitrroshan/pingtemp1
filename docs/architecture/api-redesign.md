# API Redesign: AgentManager + SocketServer

**Status:** `draft`
**Problem:** Current API is confusing with parallel flows, too many events, unclear naming

---

## Mental Model: Everything is an Agent

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  USER PERSPECTIVE: "I chat with Agents"                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐           │
│  │  Orchestrator   │     │   Architect     │     │   Developer     │           │
│  │     Agent       │     │    Worker       │     │    Worker       │           │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘           │
│           │                       │                       │                     │
│           ▼                       ▼                       ▼                     │
│      Creates Plan            Works on Task           Works on Task              │
│      with Tasks             (architecture)         (implementation)             │
│                                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│  FLOW:                                                                          │
│                                                                                 │
│  1. User → Orchestrator: "Build a REST API"                                     │
│     Orchestrator → User: "Here's a plan with 3 tasks..."                        │
│                                                                                 │
│  2. User: [Approve Plan]                                                        │
│     → Tasks assigned to Worker Agents                                           │
│                                                                                 │
│  3. User: [Start Task] or clicks on task                                        │
│     → Worker Agent starts working (output streams to center)                    │
│                                                                                 │
│  4. User → Worker: "Add email validation"                                       │
│     Worker → User: Updated output                                               │
│                                                                                 │
│  5. User: [Approve Output]                                                      │
│     → Task complete, next task unlocked                                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Current State (Problems)

### 1. Two Parallel Flows (Confusing)
```
LEGACY:     agent:message → startTask/continueTask → agent:message
ORCHESTRATOR: orchestrator:message → orchestratorMessage → plan events
```
These are completely separate - hard to understand when to use which.

### 2. Too Many Events (15+ events)
```
Client → Server:
- agent:message
- orchestrator:message  
- plan:approve
- task:approve
- task:complete

Server → Client:
- agent:message
- agent:done
- agent:error
- orchestrator:message
- orchestrator:error
- plan:proposed
- plan:approved
- plan:approval:success
- plan:approval:failed
- task:approved
- task:completed
- task:status
- task:error
- orchestrator:progress
- execution:complete
```

### 3. Unclear Method Names
```
startTask()           → starts ad-hoc task (legacy)
startTaskExecution()  → starts orchestrated task  
approveTaskForChat()  → enables user chat before execution
completeTaskByUser()  → marks task done
```

### 4. Frontend Wrapper Hell
```
AgentManagerService 
  → SocketService (just passes through)
    → socket.emit()
  → HttpService (just passes through)
    → fetch()
```

### 5. AgentManager Passed Everywhere (Tight Coupling)
```typescript
// Current: AgentManager instance passed to everything
const agentManager = new AgentManager()
createAgentMangerRouteHandlers(agentManager)  // passed to HTTP
new SocketServer(httpServer, agentManager)     // passed to Socket
new Team(config, [], agentManager)             // passed to Team??

// Makes testing hard, initialization order matters, 
// everything depends on one big object
```

---

## Redesigned API

### Fix: Registry Pattern (AgentManager = Runtime Team)

**Concept:** AgentManager is the runtime representation of a Team. Registry caches them.

```
┌─────────────────────────────────────────────────────────────────┐
│  SERVER MEMORY                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AgentManagerRegistry (cache)                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  "team-123" → AgentManager (runtime)                     │   │
│  │  "team-456" → AgentManager (runtime)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                    ▲                                            │
│                    │ lazy create from                           │
│                    ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  MongoDB: Teams, Agents (persistent data)                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```typescript
// agentManager/registry.ts

class AgentManagerRegistry {
  private managers: Map<string, AgentManager> = new Map()

  /** Get or create manager for a team (lazy load from DB) */
  async getForTeam(teamId: string): Promise<AgentManager> {
    // Return cached if exists
    if (this.managers.has(teamId)) {
      return this.managers.get(teamId)!
    }
    
    // Load team from DB
    const team = await TeamModel.findById(teamId).populate('members')
    if (!team) throw new Error(`Team ${teamId} not found`)
    
    // Create runtime manager from team data
    const manager = new AgentManager({
      teamId: team.id,
      teamName: team.name,
      roles: team.members.map(m => ({
        role: m.role,
        goal: m.goal,
        systemPrompt: m.systemPrompt
      }))
    })
    
    // Cache it
    this.managers.set(teamId, manager)
    return manager
  }

  /** Evict from cache (team deleted, or cleanup) */
  remove(teamId: string): void {
    const manager = this.managers.get(teamId)
    if (manager) {
      manager.shutdown()  // cleanup workers, etc.
      this.managers.delete(teamId)
    }
  }
}

// Server-level singleton
export const agentManagerRegistry = new AgentManagerRegistry()
```

**Usage:**

```typescript
// SocketServer - get manager for team
async handleMessage(socket, data) {
  const { teamId, agentId, content } = data
  const manager = await agentManagerRegistry.getForTeam(teamId)
  const result = await manager.chatWithWorker(agentId, content)
  socket.emit('message', result)
}

// HTTP handler
router.post('/teams/:teamId/start', async (req, res) => {
  const manager = await agentManagerRegistry.getForTeam(req.params.teamId)
  await manager.startTask(req.body.taskId)
  res.json({ success: true })
})
```

**Benefits:**
- ✅ Team data in DB, runtime in memory
- ✅ Lazy loading - only create when needed
- ✅ Each team isolated
- ✅ Server restart = reload from DB when accessed
- ✅ Easy cleanup when team deleted

### Core Concept: Everything is an Agent

From frontend perspective, **everything is an Agent**:

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND VIEW: User chats with Agents                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Agent: Orchestrator  →  Plans work, creates tasks              │
│  Agent: Architect     →  Works on architecture tasks            │
│  Agent: Developer     →  Works on implementation tasks          │
│  Agent: Tester        →  Works on testing tasks                 │
│                                                                 │
│  All are "Agents" to the user                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Flow:**
1. User chats with **Orchestrator Agent** → Creates plan with tasks
2. User approves plan → Tasks assigned to **Worker Agents**
3. User starts task → Worker Agent begins work
4. User chats with **Worker Agent** → Refines output
5. User approves output → Task complete

### Socket Events (Simplified to 5)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `message` | Bidirectional | Chat between user and any agent |
| `action` | Client→Server | Approve, complete, modify, cancel |
| `state` | Server→Client | Session/task state changed |
| `output` | Server→Client | Agent produced structured output |
| `error` | Server→Client | Error occurred |

### Client → Server

#### `message` - Send a message to an Agent
```typescript
// To Orchestrator Agent (planning mode)
socket.emit('message', {
  agentId: 'orchestrator',      // special agent for planning
  content: 'Build a REST API for users',
  sessionId?: string            // optional, creates new if missing
})

// To Worker Agent (task execution mode)
socket.emit('message', {
  agentId: 'architect',         // or 'developer', 'tester', etc.
  taskId: 'task-123',           // which task this worker is doing
  content: 'Add validation for email'
})
```

#### `action` - Perform an action
```typescript
// Approve plan
socket.emit('action', {
  type: 'approve-plan',
  sessionId: 'sess-123'
})

// Start task execution
socket.emit('action', {
  type: 'start-task',
  taskId: 'task-123'
})

// Complete task
socket.emit('action', {
  type: 'complete-task',
  taskId: 'task-123',
  output?: any
})

// Modify task
socket.emit('action', {
  type: 'modify-task',
  taskId: 'task-123',
  changes: { description: '...' }
})

// Cancel/discard
socket.emit('action', {
  type: 'cancel-task',
  taskId: 'task-123'
})
```

### Server → Client

#### `message` - Agent response (same event, other direction)
```typescript
{
  sessionId: string
  agentId: string        // 'orchestrator' | 'architect' | 'developer' | etc.
  taskId?: string        // present when worker is on a task
  content: string
  isStreaming?: boolean  // true if more chunks coming
  timestamp: number
}
```

#### `state` - State changed
```typescript
{
  sessionId: string
  
  // Session state (only one of these per event)
  sessionState?: 'planning' | 'ready' | 'executing' | 'completed'
  
  // Plan proposed (when orchestrator creates plan)
  plan?: Task[]
  
  // Task updates (when task status changes)
  tasks?: Task[]
  
  timestamp: number
}

// Examples:

// Orchestrator proposed a plan
{ sessionId: 's1', sessionState: 'ready', plan: [...tasks] }

// User approved plan, tasks created
{ sessionId: 's1', sessionState: 'executing', tasks: [...tasks] }

// Task started
{ sessionId: 's1', tasks: [{ id: 't1', status: 'in_progress' }] }

// Task completed
{ sessionId: 's1', tasks: [{ id: 't1', status: 'completed' }] }
```

#### `output` - Agent produced output
```typescript
{
  sessionId: string
  taskId: string
  agentId: string
  output: {
    content: string              // the actual output
    contentType?: string         // hint: 'code', 'markdown', 'json', 'text'
    filePath?: string            // if this should be saved to a file
    links?: string[]             // references, resources
  }
  timestamp: number
}
```

> **TODO: Future Output Types**
> As agents mature, we may need richer output structures:
> - `files: FileChange[]` - multiple file creates/modifications with diffs
> - `diagram: { type, data }` - architecture diagrams, flowcharts
> - `testResults: { passed, failed, coverage }` - for tester agent
> - `approval: { type, options }` - when agent needs user decision
> - Streaming chunks for long outputs
> 
> Start simple, add structure when we hit real needs.

#### `error` - Error occurred
```typescript
{
  sessionId?: string
  taskId?: string
  error: string
  timestamp: number
}
```

---

## Backend: Simplified SocketServer

```typescript
// SocketServer.ts (simplified)

class SocketServer {
  setupHandlers(socket: Socket) {
    socket.on('message', (data) => this.handleMessage(socket, data))
    socket.on('action', (data) => this.handleAction(socket, data))
  }

  async handleMessage(socket: Socket, data: MessagePayload) {
    const { agentId, sessionId, taskId, content } = data
    
    if (agentId === 'orchestrator') {
      // Chat with orchestrator for planning
      const result = await this.agentManager.chatWithOrchestrator(sessionId, content)
      socket.emit('message', { agentId: 'orchestrator', ...result })
      
      if (result.plan) {
        socket.emit('state', { session: { state: 'ready', plan: result.plan }})
      }
    } else {
      // Chat with worker agent on a task
      const result = await this.agentManager.chatWithWorker(agentId, taskId, content)
      socket.emit('message', { agentId, taskId, ...result })
      
      if (result.output) {
        socket.emit('output', { agentId, taskId, output: result.output })
      }
    }
  }

  async handleAction(socket: Socket, data: ActionPayload) {
    const { type, sessionId, taskId, ...rest } = data
    
    switch (type) {
      case 'approve-plan':
        const tasks = await this.agentManager.approvePlan(sessionId)
        socket.emit('state', { session: { state: 'ready' }, tasks })
        break
        
      case 'start-task':
        await this.agentManager.startTask(taskId)
        socket.emit('state', { tasks: [{ id: taskId, status: 'in_progress' }] })
        break
        
      case 'complete-task':
        await this.agentManager.completeTask(taskId, rest.output)
        socket.emit('state', { tasks: [{ id: taskId, status: 'completed' }] })
        break
    }
  }
}
```

---

## Frontend: Simplified Service

```typescript
// AgentService.ts (replaces AgentManagerService)

class AgentService {
  private socket: Socket
  private sessionId: string | null = null

  // ============ SEND MESSAGE TO AGENTS ============
  
  /** Send message to orchestrator for planning */
  sendToOrchestrator(content: string): void {
    this.socket.emit('message', {
      agentId: 'orchestrator',
      sessionId: this.sessionId,
      content
    })
  }

  /** Send message to worker agent on a task */
  sendToWorker(agentId: string, taskId: string, content: string): void {
    this.socket.emit('message', {
      agentId,
      taskId,
      content
    })
  }

  // ============ ACTIONS ============

  approvePlan(): void {
    this.socket.emit('action', { type: 'approve-plan', sessionId: this.sessionId })
  }

  startTask(taskId: string): void {
    this.socket.emit('action', { type: 'start-task', taskId })
  }

  completeTask(taskId: string, output?: any): void {
    this.socket.emit('action', { type: 'complete-task', taskId, output })
  }

  // ============ RECEIVE ============

  onMessage(callback: (msg: AgentMessage) => void): () => void {
    this.socket.on('message', callback)
    return () => this.socket.off('message', callback)
  }

  onState(callback: (state: SessionState) => void): () => void {
    this.socket.on('state', callback)
    return () => this.socket.off('state', callback)
  }

  onOutput(callback: (output: AgentOutput) => void): () => void {
    this.socket.on('output', callback)
    return () => this.socket.off('output', callback)
  }

  onError(callback: (error: ErrorInfo) => void): () => void {
    this.socket.on('error', callback)
    return () => this.socket.off('error', callback)
  }
}
```

---

## AgentManager: Simplified Public API

```typescript
// AgentManagerV2.ts - Public API only

class AgentManager {
  // ============ SESSION ============
  
  createSession(teamId: string, roles: string[]): string  // returns sessionId
  getSession(sessionId: string): Session | null
  
  // ============ CHAT WITH AGENTS ============
  
  /** Chat with orchestrator agent for planning */
  async chatWithOrchestrator(sessionId: string, content: string): Promise<ChatResult>
  
  /** Chat with worker agent on a task */
  async chatWithWorker(agentId: string, taskId: string, content: string): Promise<ChatResult>
  
  // ============ TASK ACTIONS ============
  
  async approvePlan(sessionId: string): Promise<Task[]>
  async startTask(taskId: string): Promise<void>
  async completeTask(taskId: string, output?: any): Promise<void>
  async cancelTask(taskId: string): Promise<void>
  
  // ============ QUERIES ============
  
  getAgents(sessionId: string): Agent[]           // all available agents
  getTasks(sessionId: string): Task[]             // all tasks in session
  getTaskStatus(taskId: string): TaskStatus
  
  // ============ CONFIG ============
  
  setAutoApprove(enabled: boolean): void
  setAutoApproveForRole(role: string, enabled: boolean): void
}
```

---

## HTTP API (agentManagerHandler)

HTTP routes are for **setup and CRUD** - not real-time chat.

```
┌─────────────────────────────────────────────────────────────────┐
│  SOCKET vs HTTP                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SOCKET (real-time):          HTTP (request/response):          │
│  - Chat with agents           - Create/list teams               │
│  - Actions (approve, etc.)    - Get agents for team             │
│  - State updates              - CRUD operations                 │
│  - Output streaming           - Initial data loading            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### HTTP Routes (Keep/Simplify)

| Method | Route | Purpose | Status |
|--------|-------|---------|--------|
| POST | `/api/teams` | Create team (discovers roles) | ✅ Keep |
| GET | `/api/teams` | List all teams | ✅ Keep |
| GET | `/api/teams/:id` | Get team by ID | ✅ Keep |
| GET | `/api/teams/:id/agents` | Get agents for team | ✅ Keep |
| GET | `/api/roles` | Get/discover roles | ✅ Keep |
| GET | `/api/sessions/:id` | Get session state | 🆕 Add |
| GET | `/api/sessions/:id/tasks` | Get tasks for session | 🆕 Add |

### Simplified Handler

```typescript
// agentManagerHandler.ts (simplified)

router.post('/teams', async (req, res) => {
  const { name, goal, description } = req.body
  const team = await teamService.create({ name, goal, description })
  const roles = await agentManager.discoverRoles(goal)
  await agentService.createForTeam(team.id, roles)
  res.json({ team, roles })
})

router.get('/teams', async (req, res) => {
  const teams = await teamService.list()
  res.json({ teams })
})

router.get('/teams/:id', async (req, res) => {
  const team = await teamService.get(req.params.id)
  res.json({ team })
})

router.get('/teams/:id/agents', async (req, res) => {
  const agents = await agentService.getByTeam(req.params.id)
  res.json({ agents })
})

router.get('/roles', async (req, res) => {
  const { teamId, goal } = req.query
  if (teamId) {
    const agents = await agentService.getByTeam(teamId)
    res.json({ roles: agents })
  } else {
    const roles = await agentManager.discoverRoles(goal)
    res.json({ roles })
  }
})

// NEW: Session queries
router.get('/sessions/:id', async (req, res) => {
  const session = agentManager.getSession(req.params.id)
  res.json({ session })
})

router.get('/sessions/:id/tasks', async (req, res) => {
  const tasks = agentManager.getTasks(req.params.id)
  res.json({ tasks })
})
```

### What Changes in Handler?

| Current | Change |
|---------|--------|
| `configureNewWorkflow()` | Remove - orchestrator handles this |
| `createTask()` | Remove - use socket `action: start-task` |
| Complex role discovery in route | Move to `agentManager.discoverRoles()` |
| Direct DB queries | Keep - HTTP is fine for CRUD |

---

## Migration Path

### Phase 1: Add New API (Keep Old)
1. Add new events (`chat`, `action`, `message`, `state`, `output`)
2. Keep old events working
3. Frontend can use either

### Phase 2: Migrate Frontend
1. Update AgentManagerService → AgentService
2. Use new events only
3. Test both flows

### Phase 3: Remove Old API
1. Remove old events
2. Clean up AgentManager internal methods
3. Simplify SocketServer

---

## Comparison

| Aspect | Current | Redesigned |
|--------|---------|------------|
| Client→Server events | 5 | 2 (`message`, `action`) |
| Server→Client events | 10+ | 4 (`message`, `state`, `output`, `error`) |
| Frontend methods | 15+ | 7 |
| Parallel flows | 2 (legacy + orchestrator) | 1 unified |
| Learning curve | High | Low |

---

## Questions to Decide

1. **Keep legacy flow?** Or force everyone to orchestrator?
2. **Session management?** Auto-create or explicit?
3. **Output streaming?** Send partial outputs or wait for complete?
4. **Auto-approve default?** On or off?

---

## Next Steps

- [ ] Review and approve design
- [ ] Phase 1: Add new API alongside old
- [ ] Phase 2: Migrate frontend
- [ ] Phase 3: Remove deprecated code
