# Backend API Split - Architecture Documentation

## Overview
The AgentManagerAPI has been refactored into a modular architecture separating Socket.IO and HTTP concerns, similar to the frontend service split.

## File Structure

### Before (Single File - 347 lines)
```
src/worker/api/
  └── AgentManagerAPI.ts (Socket.IO + HTTP mixed)
```

### After (Modular - 3 files)
```
src/worker/api/
  ├── AgentManagerAPI.ts    (Coordinator - 92 lines)
  ├── SocketServer.ts       (Socket.IO logic - 268 lines)
  └── HttpServer.ts         (Express/HTTP logic - 139 lines)
```

## Architecture

### AgentManagerAPI.ts (Coordinator/Facade)
**Purpose:** Main entry point that initializes and coordinates both servers

**Responsibilities:**
- Initialize AgentManager
- Create and start HTTP server
- Initialize Socket.IO server using the HTTP server
- Provide access methods for both servers
- Coordinate shutdown of all services

**Key Methods:**
- `constructor(port)` - Initializes all services
- `getAgentManager()` - Returns AgentManager instance
- `getHttpServer()` - Returns HttpServer instance
- `getSocketServer()` - Returns SocketServer instance
- `broadcastTaskUpdate()` - Delegates to SocketServer
- `start()` - Logs startup (server already listening)
- `stop()` - Gracefully shuts down both servers

### SocketServer.ts
**Purpose:** Handles all Socket.IO real-time communication

**Responsibilities:**
- Socket.IO connection management
- User registration and session tracking
- Client subscription management
- Agent message routing
- Task completion event handling
- Broadcasting to subscribed clients
- AgentManager event bridging

**Key Features:**
- User session persistence (userId tracking)
- Client connection tracking (clientId per connection)
- Registration flow with 5-second timeout
- Subscription system for agent-specific updates
- Message routing to AgentWorkers
- Event-driven architecture

**Key Methods:**
- `setupSocketIO()` - Initialize connection handlers
- `setupSocketHandlers()` - Setup per-socket event listeners
- `handleAgentMessage()` - Route messages to workers
- `updateUserSession()` - Track user reconnections
- `sendToClient()` - Send to specific client
- `broadcastToAll()` - Broadcast to all clients
- `broadcastTaskUpdate()` - Broadcast to subscribed clients
- `setupAgentManagerListeners()` - Bridge AgentManager events

**Socket Events:**
- Incoming: `register`, `subscribe`, `unsubscribe`, `send_message`, `disconnect`
- Outgoing: `registered`, `agent_response`, `task_update`, `roleDiscovery`, `error`

### HttpServer.ts
**Purpose:** Handles all HTTP/REST API endpoints

**Responsibilities:**
- Express app setup and middleware
- CORS configuration
- REST endpoint implementation
- Request validation
- Error handling

**Key Features:**
- Health check endpoint
- Task creation endpoint
- JSON body parsing
- CORS enabled for all origins
- Comprehensive logging

**Endpoints:**
- `GET /health` - Health check (status, timestamp, service name)
- `POST /api/createtask` - Create and start new task
- *Commented endpoints available:* `/api/tasks`, `/api/roles`, `/api/workers`

**Key Methods:**
- `setupMiddleware()` - Configure CORS and JSON parsing
- `setupRoutes()` - Define HTTP endpoints
- `listen(port)` - Start HTTP server
- `getApp()` - Get Express app (for Socket.IO integration)
- `getServer()` - Get HTTP server instance
- `close()` - Gracefully shutdown

## Data Models

### ClientConnection (SocketServer)
```typescript
interface ClientConnection {
  clientId: string;           // Unique per connection (UUID)
  userId: string;             // Persistent user identifier
  socket: Socket;             // Socket.IO socket instance
  subscribedAgents: Set<string>; // Agent roles subscribed to
  connectedAt: number;        // Connection timestamp
}
```

### UserSession (SocketServer)
```typescript
interface UserSession {
  userId: string;             // Persistent user identifier
  currentClientId: string;    // Current active clientId
  clientIds: string[];        // History of all clientIds
  lastConnected: number;      // Last connection timestamp
}
```

## Integration Flow

### 1. Server Startup
```
AgentManagerAPI.constructor()
  → new AgentManager()
  → new HttpServer(agentManager)
  → createServer(httpServer.getApp())
  → server.listen(port)
  → new SocketServer(server, agentManager)
```

### 2. Client Connection Flow
```
Client connects
  → SocketServer receives 'connection' event
  → Wait for 'register' event (5s timeout)
  → Generate clientId (UUID)
  → Create ClientConnection
  → Update/create UserSession
  → Emit 'registered' event
  → Setup socket event handlers
```

### 3. Task Creation Flow (HTTP)
```
POST /api/createtask
  → Validate taskDescription
  → agentManager.configureNewWorkflow()
  → agentManager.createTask()
  → Return 202 Accepted
  → Task execution happens async
```

### 4. Message Flow (Socket.IO)
```
Client emits 'send_message'
  → SocketServer.handleAgentMessage()
  → Get worker by role
  → Subscribe to worker.events.taskComplete
  → worker.execute(task)
  → Worker completes
  → Emit 'agent_response' to client
```

### 5. Event Broadcasting Flow
```
AgentManager emits 'roleDiscovery'
  → SocketServer.setupAgentManagerListeners()
  → socketServer.broadcastToAll('roleDiscovery', data)
  → All connected clients receive event
```

## Benefits of Split Architecture

### Separation of Concerns
- Socket.IO logic isolated in SocketServer
- HTTP logic isolated in HttpServer
- AgentManagerAPI focuses on coordination

### Maintainability
- Easier to locate and fix bugs
- Clear responsibility boundaries
- Reduced file size (347 → 92 + 268 + 139)

### Testability
- Each server can be tested independently
- Mock dependencies more easily
- Focused unit tests per concern

### Scalability
- Can scale Socket.IO and HTTP independently
- Easier to add new endpoints or events
- Clear extension points

### Debugging
- Consistent logging prefixes: `[AgentManagerAPI]`, `[SocketServer]`, `[HttpServer]`
- Named functions appear in stack traces
- Event flow is traceable

## Migration Notes

### No Breaking Changes
The external API remains identical:
- Same Socket.IO events
- Same HTTP endpoints
- Same initialization: `new AgentManagerAPI(port)`
- Same methods: `start()`, `stop()`, `broadcastTaskUpdate()`

### Internal Changes Only
- Code organization improved
- Better separation of concerns
- No client-side changes required

## Patterns Used

### Facade Pattern
`AgentManagerAPI` acts as a facade, providing a simple interface to the complex subsystems (HttpServer, SocketServer)

### Coordinator Pattern
`AgentManagerAPI` coordinates the lifecycle of both servers without implementing their logic

### Event-Driven Architecture
- AgentManager events bridge to Socket.IO
- Worker events drive responses
- Loose coupling between components

## Future Enhancements

### Potential Improvements
1. **Environment-based CORS**: Configure allowed origins from env vars
2. **Rate Limiting**: Add rate limiting to HTTP endpoints
3. **Authentication**: Add JWT or session-based auth
4. **Middleware Extraction**: Create separate middleware modules
5. **Health Checks**: Add detailed health checks (DB, workers, etc.)
6. **Metrics**: Add Prometheus/metrics endpoint
7. **WebSocket Fallback**: Add fallback transports for Socket.IO

### Commented Endpoints
The following endpoints are available but commented out:
- `GET /api/tasks` - Get all tasks from memory
- `GET /api/roles` - Get all roles for a task
- `GET /api/workers` - Get all active workers

To enable, uncomment in `HttpServer.ts`

## Comparison with Frontend

### Similar Pattern
The backend split mirrors the frontend service architecture:

**Frontend:**
- `AgentManagerService.ts` (facade)
- `SocketService.ts` (Socket.IO client)
- `HttpService.ts` (HTTP fetch)
- `socketMethods.ts` (functional exports)
- `httpMethods.ts` (functional exports)

**Backend:**
- `AgentManagerAPI.ts` (facade/coordinator)
- `SocketServer.ts` (Socket.IO server)
- `HttpServer.ts` (Express server)

### Consistent Architecture
Both frontend and backend now follow:
1. **Separation of concerns**: Socket.IO vs HTTP
2. **Facade pattern**: Unified API surface
3. **Logging prefixes**: Consistent debugging
4. **Modular design**: Each file has single responsibility

## Related Documentation
- [Frontend Services Split](./BACKEND_FRONTEND_INTEGRATION.md)
- [Role Discovery Enhancement](./ROLE_DISCOVERY_ENHANCEMENT.md)
- [Project Overview](./project.md)
