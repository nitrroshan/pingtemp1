# OpenClaw/ClawdBot External Agent Integration

## Feature Overview

**Goal**: Integrate OpenClaw (ClawdBot) as an external agent that can be orchestrated by our AgentManager, enabling access to ClawdBot's messaging channels (WhatsApp, Telegram, Discord, Slack, etc.), node capabilities, and advanced AI agent features.

**Status**: Research/Design Phase

---

## OpenClaw Architecture Summary

Based on research from [ClawdBot Core Concepts](https://deepwiki.com/clawdbot/clawdbot/1.1-core-concepts):

### Core Components

| Component | Description |
|-----------|-------------|
| **Gateway** | Central control plane on port 18789. WebSocket RPC + HTTP. Routes messages to agents. |
| **Agent** | AI runtime powered by Pi agent framework. Isolated workspace, sessions, auth profiles. |
| **Session** | Conversation context with message history. Key: `agent:<agentId>:channel:<channelType>:<peerId>` |
| **Channel** | Messaging platform integration (WhatsApp, Telegram, Discord, Slack, iMessage, etc.) |
| **Node** | Companion apps (macOS/iOS/Android) providing device capabilities |
| **Workspace** | Agent's file system root with bootstrap files (AGENTS.md, SOUL.md, TOOLS.md) |
| **Sandbox** | Docker container for isolated tool execution |

### Gateway Protocol (v3)

The Gateway exposes a WebSocket RPC interface with JSON frames:

```typescript
// Frame Types
interface RequestFrame {
  id: number;        // Unique request ID
  method: string;    // RPC method name
  params?: object;   // Method parameters
}

interface ResponseFrame {
  id: number;        // Matching request ID
  ok: boolean;       // Success/failure
  result?: unknown;  // Method result (if ok)
  error?: ErrorShape; // Error details (if !ok)
}

interface EventFrame {
  type: string;      // Event type ('agent', 'chat', etc.)
  data: unknown;     // Event payload
}
```

### Connection Handshake

```typescript
// 1. Connect to ws://gateway:18789
// 2. Send connect request
const connectRequest: RequestFrame = {
  id: 1,
  method: "connect",
  params: {
    protocol: 3,           // Required: protocol version
    role: "operator",      // 'operator' or 'node'
    scopes: ["operator.admin", "operator.write", "operator.read"],
    token: "auth-token"    // For non-loopback connections
  }
};

// 3. Receive HelloOk response
interface HelloOk {
  ok: true;
  message: string;
  version: number;
}
```

### Key RPC Methods

| Method | Description |
|--------|-------------|
| `agent` | Invoke agent with message, get streaming response |
| `send` | Send message to channel |
| `sessions.list` | List sessions |
| `sessions.history` | Get session transcript |
| `config.get` | Get configuration |

---

## Integration Approaches

### Approach 1: External Agent via Gateway Protocol (Recommended)

Create an `ExternalAgent` implementation that connects to OpenClaw's Gateway WebSocket and proxies requests/responses.

```
┌─────────────────────┐         ┌─────────────────────┐
│   AgentManager      │         │   OpenClaw Gateway   │
│   (Orchestrator)    │         │    (port 18789)      │
│         │           │         │         │            │
│    ┌────┴────┐      │   WS    │    ┌────┴────┐       │
│    │ OpenClaw│──────┼─────────┼────│ Agent   │       │
│    │ Bridge  │      │         │    │ Runtime │       │
│    │ Agent   │◄─────┼─────────┼────│         │       │
│    └─────────┘      │  Events │    └─────────┘       │
└─────────────────────┘         └─────────────────────┘
```

**Pros**:
- Uses official protocol - stable API contract
- Access to all OpenClaw features (channels, nodes, memory)
- Event streaming for real-time updates
- Multi-agent routing via OpenClaw bindings

**Cons**:
- Network latency between systems
- Need to manage WebSocket connection lifecycle
- Auth token management

### Approach 2: MCP Tool Server

Expose OpenClaw capabilities as an MCP (Model Context Protocol) tool server that our internal agents can invoke.

**Pros**:
- Standard tool interface
- LangChain MCP adapter already in use

**Cons**:
- Limited to tool invocations (no streaming)
- Can't leverage OpenClaw's multi-agent routing

### Approach 3: Direct Library Integration

Import OpenClaw's Pi agent framework directly.

**Cons**:
- Tight coupling
- Version dependencies
- Not designed for this use case

---

## Recommended Architecture: OpenClaw Bridge Agent

### Type Definition

Add to `ExternalConfig` in `agent/types.ts`:

```typescript
export interface OpenClawConfig {
  gateway: {
    host: string;           // e.g., 'localhost' or remote IP
    port: number;           // default: 18789
    token?: string;         // auth token for remote connections
  };
  agent?: {
    id?: string;            // OpenClaw agent ID (default: 'main')
    model?: string;         // Model override
  };
  session?: {
    channel: string;        // e.g., 'api' (virtual channel)
    peerId?: string;        // Session identifier
  };
}
```

### Agent Definition (YAML)

```yaml
id: openclaw-bridge
name: OpenClaw Bridge
role: messaging-specialist
description: Bridge to OpenClaw for messaging platform access

type: external

goal: |
  Access messaging platforms (WhatsApp, Telegram, Discord) 
  via OpenClaw Gateway and coordinate with local agents.

config:
  endpoint: ws://localhost:18789
  protocol: openclaw-gateway-v3
  auth:
    type: bearer
    tokenEnvVar: OPENCLAW_TOKEN
    
  openclaw:
    gateway:
      host: localhost
      port: 18789
    agent:
      id: main
    session:
      channel: api
      peerId: agent-orchestrator

settings:
  streaming: true
  timeout: 60000
  retries: 3
```

### Implementation Classes

#### 1. OpenClawGatewayClient

Low-level WebSocket client for Gateway protocol:

```typescript
// src/worker/agent/external/openclaw/OpenClawGatewayClient.ts

import WebSocket from 'ws';
import { EventEmitter } from 'events';

interface GatewayClientConfig {
  host: string;
  port: number;
  token?: string;
  scopes?: string[];
}

export class OpenClawGatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }>();
  
  constructor(private config: GatewayClientConfig) {
    super();
  }
  
  async connect(): Promise<void> {
    const url = `ws://${this.config.host}:${this.config.port}`;
    this.ws = new WebSocket(url);
    
    return new Promise((resolve, reject) => {
      this.ws!.on('open', async () => {
        try {
          await this.handshake();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      
      this.ws!.on('message', (data) => this.handleMessage(data));
      this.ws!.on('error', (err) => this.emit('error', err));
      this.ws!.on('close', () => this.emit('disconnected'));
    });
  }
  
  private async handshake(): Promise<void> {
    const response = await this.request('connect', {
      protocol: 3,
      role: 'operator',
      scopes: this.config.scopes || ['operator.admin'],
      token: this.config.token
    });
    
    if (!response.ok) {
      throw new Error(`Handshake failed: ${response.error?.message}`);
    }
  }
  
  async request(method: string, params?: object): Promise<any> {
    const id = ++this.requestId;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      this.ws!.send(JSON.stringify({
        id,
        method,
        params
      }));
    });
  }
  
  private handleMessage(data: WebSocket.Data): void {
    const frame = JSON.parse(data.toString());
    
    // Response to request
    if ('id' in frame && this.pendingRequests.has(frame.id)) {
      const { resolve, reject } = this.pendingRequests.get(frame.id)!;
      this.pendingRequests.delete(frame.id);
      
      if (frame.ok === false) {
        reject(new Error(frame.error?.message || 'Unknown error'));
      } else {
        resolve(frame);
      }
    }
    
    // Event broadcast
    if ('type' in frame) {
      this.emit('event', frame);
      this.emit(`event:${frame.type}`, frame.data);
    }
  }
  
  async invokeAgent(message: string, options?: {
    agentId?: string;
    sessionKey?: string;
  }): Promise<AsyncGenerator<AgentEvent>> {
    // Implementation for streaming agent responses
    // ...
  }
  
  async sendMessage(channel: string, target: string, message: string): Promise<void> {
    await this.request('send', {
      channel,
      to: target,
      text: message
    });
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

#### 2. OpenClawBridgeAgent

Agent implementation using the gateway client:

```typescript
// src/worker/agent/external/openclaw/OpenClawBridgeAgent.ts

import { BaseAgent } from '../../BaseAgent.js';
import { OpenClawGatewayClient } from './OpenClawGatewayClient.js';
import type { 
  AgentDefinition, 
  AgentInput, 
  AgentEvent,
  ExternalConfig 
} from '../../types.js';

export class OpenClawBridgeAgent extends BaseAgent {
  private client: OpenClawGatewayClient | null = null;
  private openclawConfig: OpenClawConfig;
  
  constructor(definition: AgentDefinition) {
    super(definition);
    this.openclawConfig = (definition.config as ExternalConfig).openclaw!;
  }
  
  async initialize(): Promise<void> {
    const { gateway } = this.openclawConfig;
    
    this.client = new OpenClawGatewayClient({
      host: gateway.host,
      port: gateway.port,
      token: gateway.token || process.env.OPENCLAW_TOKEN
    });
    
    await this.client.connect();
    
    // Subscribe to agent events
    this.client.on('event:agent', (event) => {
      this._emitter.emit('openclaw:agent', event);
    });
    
    this._status = 'idle';
  }
  
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    if (!this.client) {
      throw new Error('OpenClaw client not initialized');
    }
    
    this._status = 'executing';
    
    try {
      // Invoke OpenClaw agent
      const eventStream = await this.client.invokeAgent(input.message, {
        agentId: this.openclawConfig.agent?.id,
        sessionKey: this.buildSessionKey(input)
      });
      
      // Forward events
      for await (const event of eventStream) {
        yield this.transformEvent(event);
      }
      
    } finally {
      this._status = 'idle';
    }
  }
  
  private buildSessionKey(input: AgentInput): string {
    const { session } = this.openclawConfig;
    return `agent:${this.openclawConfig.agent?.id || 'main'}:` +
           `channel:${session?.channel || 'api'}:` +
           `${session?.peerId || input.threadId}`;
  }
  
  private transformEvent(openclawEvent: any): AgentEvent {
    // Transform OpenClaw events to our AgentEvent format
    switch (openclawEvent.stream) {
      case 'start':
        return { type: 'thinking', content: 'Processing...' };
      case 'text':
        return { type: 'message_delta', delta: openclawEvent.data };
      case 'tool':
        return { 
          type: 'tool_start', 
          tool: openclawEvent.data.name,
          args: openclawEvent.data.args 
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool: openclawEvent.data.name,
          result: openclawEvent.data.result
        };
      case 'end':
        return { type: 'done', output: openclawEvent.data };
      default:
        return { type: 'thinking', content: JSON.stringify(openclawEvent) };
    }
  }
  
  async stop(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    await super.stop();
  }
}
```

---

## Use Cases

### 1. Messaging Channel Access

Route our orchestrator's requests through OpenClaw to reach WhatsApp, Telegram, Discord users:

```typescript
// Send a message via WhatsApp
const openclawAgent = agentManager.getAgent('openclaw-bridge');
await openclawAgent.execute({
  message: 'Send WhatsApp message to +1555123456: "Hello!"',
  threadId: 'whatsapp-outbound'
});
```

### 2. Multi-Channel Presence

Register our agent system as an OpenClaw agent, allowing users on various platforms to interact:

```yaml
# In OpenClaw's clawdbot.json
agents:
  bindings:
    list:
      - channel: whatsapp
        accountId: business
        agentId: external-orchestrator
```

### 3. Capability Sharing

Access OpenClaw's tools (browser, exec, canvas) from our agents:

```typescript
// Use OpenClaw's browser tool
const result = await openclawAgent.execute({
  message: 'Use browser to fetch https://example.com and summarize',
  threadId: 'browser-task'
});
```

### 4. Device Capabilities

Leverage OpenClaw Nodes for camera, screen recording, location:

```typescript
// Capture screen via paired node
const result = await openclawAgent.execute({
  message: 'Capture current screen using node capabilities',
  threadId: 'screen-capture'
});
```

---

## Security Considerations

1. **Token Management**: Store OpenClaw tokens in environment variables, not config files
2. **Scope Limiting**: Request only needed scopes (`operator.read`, `operator.write`)
3. **Network Security**: Use TLS for remote Gateway connections
4. **Sandbox Isolation**: OpenClaw's sandbox handles tool execution isolation
5. **Session Isolation**: Each integration gets isolated session context

---

## Connection Management & Resilience

### Connection States

```
┌──────────┐     connect()     ┌────────────┐
│          ├──────────────────►│            │
│DISCONNECTED                   │ CONNECTING │
│          │◄──────────────────┤            │
└──────────┘    timeout/error  └─────┬──────┘
      ▲                              │ handshake ok
      │                              ▼
      │ disconnect()         ┌────────────┐
      │ or error             │            │
      └──────────────────────┤ CONNECTED  │
                             │            │
                             └────────────┘
```

### Reconnection Strategy

```typescript
// services/openclaw/OpenClawClient.ts
class OpenClawClient {
  private reconnectAttempts = 0;
  private readonly maxReconnects = 10;
  private readonly baseDelay = 1000;
  
  private async reconnect(): Promise<void> {
    while (this.reconnectAttempts < this.maxReconnects) {
      const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
      const jitter = Math.random() * 1000;
      
      await sleep(delay + jitter);
      
      try {
        await this.connect();
        this.reconnectAttempts = 0;
        this.emit('reconnected');
        return;
      } catch (error) {
        this.reconnectAttempts++;
        this.emit('reconnect_failed', { attempt: this.reconnectAttempts, error });
      }
    }
    
    this.emit('reconnect_exhausted');
    throw new Error('Max reconnection attempts reached');
  }
}
```

### Health Monitoring

```typescript
// services/openclaw/OpenClawService.ts
class OpenClawService {
  private healthCheckInterval?: NodeJS.Timeout;
  
  startHealthMonitoring(intervalMs = 30000): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.client.request('health');
        this.emit('health', health);
      } catch (error) {
        this.emit('health_error', error);
        // Trigger reconnection if needed
        if (!this.client.isConnected) {
          await this.ensureConnected();
        }
      }
    }, intervalMs);
  }
}
```

---

## Error Handling

### OpenClaw Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `INVALID_REQUEST` | Malformed request | Fix request structure |
| `METHOD_NOT_FOUND` | Unknown RPC method | Check method name |
| `INVALID_PARAMS` | Schema validation failed | Fix parameters |
| `UNAUTHORIZED` | Auth failed | Check token |
| `NOT_FOUND` | Resource missing | Handle gracefully |
| `CONFLICT` | State conflict | Retry or abort |
| `INTERNAL_ERROR` | Gateway error | Retry with backoff |
| `TIMEOUT` | Operation timeout | Increase timeout or retry |

### Error Handling Implementation

```typescript
// services/openclaw/OpenClawClient.ts
class OpenClawError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public retryable: boolean = false,
    public retryAfterMs?: number
  ) {
    super(message);
    this.name = 'OpenClawError';
  }
}

async function handleResponse(response: ResponseFrame): Promise<any> {
  if (!response.ok) {
    const { code, message, details, retryable, retryAfterMs } = response.error!;
    throw new OpenClawError(code, message, details, retryable, retryAfterMs);
  }
  return response.result;
}
```

### Retry Strategy

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; retryableErrors?: string[] } = {}
): Promise<T> {
  const { maxRetries = 3, retryableErrors = ['INTERNAL_ERROR', 'TIMEOUT'] } = options;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof OpenClawError) {
        if (error.retryable || retryableErrors.includes(error.code)) {
          const delay = error.retryAfterMs || 1000 * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Deployment Considerations

### Local Development

```
┌─────────────────────────────────────────────────────────────────┐
│                     Development Machine                          │
│                                                                  │
│  ┌──────────────┐           ┌──────────────────┐                │
│  │ Our Backend  │    WS     │ OpenClaw Gateway │                │
│  │ :3001        ├──────────►│ :18789           │                │
│  └──────────────┘           └────────┬─────────┘                │
│                                      │                          │
│                              ┌───────▼───────┐                  │
│                              │ WhatsApp Web  │                  │
│                              │ (Baileys)     │                  │
│                              └───────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

### Production - Same Host

```
┌─────────────────────────────────────────────────────────────────┐
│                        Production Server                         │
│                                                                  │
│  ┌──────────────┐           ┌──────────────────┐                │
│  │ Our Backend  │ localhost │ OpenClaw Gateway │                │
│  │              ├──────────►│ :18789           │                │
│  │ (systemd)    │           │ (systemd)        │                │
│  └──────────────┘           └──────────────────┘                │
└─────────────────────────────────────────────────────────────────┘

# No auth token needed for localhost
OPENCLAW_GATEWAY_HOST=127.0.0.1
OPENCLAW_GATEWAY_PORT=18789
```

### Production - Separate Hosts

```
┌────────────────────┐         ┌────────────────────┐
│  App Server        │   WS    │  OpenClaw Server   │
│                    │  (TLS)  │                    │
│  Our Backend ──────┼────────►│ Gateway :18789     │
│                    │         │                    │
│  OPENCLAW_TOKEN=xxx│         │ auth.token=xxx     │
└────────────────────┘         └────────────────────┘

# Auth token required for non-loopback
OPENCLAW_GATEWAY_HOST=openclaw.internal
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_TOKEN=secure-random-token
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  backend:
    build: .
    environment:
      - OPENCLAW_GATEWAY_HOST=openclaw
      - OPENCLAW_GATEWAY_PORT=18789
      - OPENCLAW_TOKEN=${OPENCLAW_TOKEN}
    depends_on:
      - openclaw
    networks:
      - internal

  openclaw:
    image: clawdbot/clawdbot:latest
    volumes:
      - openclaw-data:/root/.clawdbot
      - openclaw-workspace:/root/clawd
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    ports:
      - "18789:18789"  # Gateway
    networks:
      - internal

volumes:
  openclaw-data:
  openclaw-workspace:

networks:
  internal:
```

---

## Testing Strategy

### Unit Tests - Mock Service

```typescript
// __tests__/OpenClawBridgeAgent.test.ts
describe('OpenClawBridgeAgent', () => {
  let mockService: jest.Mocked<OpenClawService>;
  let agent: OpenClawBridgeAgent;
  
  beforeEach(() => {
    mockService = {
      ensureConnected: jest.fn().mockResolvedValue(undefined),
      invokeAgent: jest.fn(),
      sendMessage: jest.fn(),
    } as any;
    
    // Inject mock
    jest.spyOn(OpenClawService, 'getInstance').mockReturnValue(mockService);
    
    agent = new OpenClawBridgeAgent(testDefinition);
  });
  
  it('should forward messages to OpenClaw', async () => {
    mockService.invokeAgent.mockReturnValue(async function* () {
      yield { type: 'message', content: 'Hello!' };
      yield { type: 'done', output: 'Completed' };
    }());
    
    const events: AgentEvent[] = [];
    for await (const event of agent.execute({ message: 'Hi', threadId: 'test' })) {
      events.push(event);
    }
    
    expect(events).toHaveLength(2);
    expect(mockService.invokeAgent).toHaveBeenCalledWith('Hi', expect.any(Object));
  });
});
```

### Integration Tests - Local Gateway

```typescript
// __tests__/integration/OpenClawService.integration.test.ts
describe('OpenClawService Integration', () => {
  let service: OpenClawService;
  
  beforeAll(async () => {
    // Requires local OpenClaw running
    service = OpenClawService.getInstance();
    await service.ensureConnected();
  });
  
  it('should get gateway status', async () => {
    const status = await service.request('status');
    expect(status.status).toBe('running');
  });
  
  it('should list agents', async () => {
    const result = await service.request('agents.list', {});
    expect(result.agents).toBeInstanceOf(Array);
    expect(result.defaultId).toBeDefined();
  });
});
```

---

## Configuration

### Environment Variables

```bash
# .env
OPENCLAW_GATEWAY_HOST=localhost
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_TOKEN=your-auth-token
```

### Agent Factory Registration

```typescript
// src/worker/agent/AgentFactory.ts
import { OpenClawBridgeAgent } from './external/openclaw/OpenClawBridgeAgent.js';

// In factory registration
case 'external':
  if (definition.config.protocol === 'openclaw-gateway-v3') {
    return new OpenClawBridgeAgent(definition);
  }
  return new GenericExternalAgent(definition);
```

---

## Implementation Plan

### Phase 1: Gateway Client (Week 1)
- [ ] Implement `OpenClawGatewayClient` with connect/request/events
- [ ] Add connection lifecycle management
- [ ] Unit tests with mock WebSocket

### Phase 2: Bridge Agent (Week 2)
- [ ] Implement `OpenClawBridgeAgent` extending `BaseAgent`
- [ ] Event transformation layer
- [ ] Integration tests with local Gateway

### Phase 3: Registration & Orchestration (Week 3)
- [ ] YAML definition for openclaw-bridge agent
- [ ] AgentFactory registration
- [ ] AgentManager integration
- [ ] Socket streaming through SocketServerV2

### Phase 4: Advanced Features (Week 4)
- [ ] Multi-agent routing via OpenClaw bindings
- [ ] Node capability invocation
- [ ] Session management
- [ ] Health monitoring

---

---

## Design Pattern Analysis

### Pattern Comparison: Agent-Owned vs Service Layer

#### Option A: Agent-Owned Connection (Initial Proposal)

```
Agent → WebSocket → OpenClaw Gateway
```

**Issues:**
1. **Connection lifecycle coupled to agent** - If agent stops, connection drops
2. **No connection pooling** - Multiple agents = multiple connections
3. **Reconnection logic duplicated** in each agent
4. **Health monitoring scattered** across agents

#### Option B: Service Layer Pattern (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                      AgentManager                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │InternalAgent │ │InternalAgent │ │ OpenClawBridgeAgent  │ │
│  │  (planner)   │ │  (coder)     │ │   (messaging)        │ │
│  └──────────────┘ └──────────────┘ └──────────┬───────────┘ │
└──────────────────────────────────────────────┼──────────────┘
                                               │ uses
                    ┌──────────────────────────▼──────────────┐
                    │         OpenClawService (singleton)      │
                    │  • Connection pooling                    │
                    │  • Auto-reconnect                        │
                    │  • Health monitoring                     │
                    │  • Request queuing                       │
                    └──────────────────────────┬───────────────┘
                                               │ WebSocket
                                   ┌───────────▼───────────┐
                                   │   OpenClaw Gateway    │
                                   │     (port 18789)      │
                                   └───────────────────────┘
```

#### Comparison Matrix

| Aspect | Agent-Owned Connection | Service Layer |
|--------|----------------------|---------------|
| Connection reuse | ❌ One per agent | ✅ Shared |
| Reconnection | ❌ Each agent handles | ✅ Centralized |
| Health checks | ❌ Scattered | ✅ One place |
| Testing | ❌ Need full agent | ✅ Mock service |
| Consistency | ❌ New pattern | ✅ Matches `services/` |
| Complexity | ⚠️ Lower initially | ⚠️ Slightly more |

#### Recommended File Structure

```
src/worker/
├── services/
│   └── openclaw/
│       ├── OpenClawService.ts      # Singleton, connection management
│       ├── OpenClawClient.ts       # Low-level WebSocket client
│       ├── OpenClawEventMapper.ts  # Event transformation
│       └── types.ts                # OpenClaw-specific types
├── agent/
│   └── external/
│       └── OpenClawBridgeAgent.ts  # Thin wrapper using service
```

#### Service Implementation Pattern

```typescript
// services/openclaw/OpenClawService.ts
export class OpenClawService {
  private static instance: OpenClawService;
  private client: OpenClawClient | null = null;
  private connectionPromise: Promise<void> | null = null;
  
  static getInstance(): OpenClawService {
    if (!OpenClawService.instance) {
      OpenClawService.instance = new OpenClawService();
    }
    return OpenClawService.instance;
  }
  
  async ensureConnected(): Promise<OpenClawClient> {
    if (this.client?.isConnected) return this.client;
    
    // Singleton connection promise prevents race conditions
    if (!this.connectionPromise) {
      this.connectionPromise = this.connect();
    }
    await this.connectionPromise;
    return this.client!;
  }
  
  async invokeAgent(message: string, options: InvokeOptions): Promise<AsyncGenerator<AgentEvent>> {
    const client = await this.ensureConnected();
    return client.invokeAgent(message, options);
  }
  
  async sendMessage(channel: string, target: string, text: string): Promise<void> {
    const client = await this.ensureConnected();
    return client.sendMessage(channel, target, text);
  }
}
```

#### Thin Agent Wrapper

```typescript
// agent/external/OpenClawBridgeAgent.ts
export class OpenClawBridgeAgent extends BaseAgent {
  private service = OpenClawService.getInstance();
  
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    // Agent is now just orchestration logic
    // Connection management delegated to service
    yield* this.service.invokeAgent(input.message, {
      agentId: this.config.agentId,
      sessionKey: this.buildSessionKey(input)
    });
  }
}
```

#### Decision: Service Layer

**Service Layer is the recommended pattern** because:

1. **Separation of concerns** - Connection management ≠ Agent logic
2. **Testability** - Mock `OpenClawService` in agent tests
3. **Reliability** - Centralized reconnection and health monitoring
4. **Efficiency** - Connection pooling across multiple agents
5. **Consistency** - Matches existing `services/` folder pattern

---

## Detailed RPC Method Reference

Based on the Gateway Protocol, here are the key methods we can leverage:

### Agent Execution Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `agent` | Execute agent turn with message, returns streaming events | Primary integration point |
| `agent.wait` | Wait for agent run completion | Sync operations |
| `agents.list` | List configured agents | Discovery |
| `models.list` | List available AI models | Model selection |

**Agent Invocation Example:**

```typescript
// Invoke OpenClaw agent
const response = await service.request('agent', {
  message: 'Send WhatsApp message to +15551234567: Hello!',
  sessionKey: 'agent:main:channel:api:orchestrator',
  idempotencyKey: randomUUID(),
  timeout: 60000
});
// Returns: { status: 'accepted', runId: 'xxx' }
// Then streams 'agent' events via EventFrame
```

### Session Management Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `sessions.list` | List sessions with filters | Browse active conversations |
| `sessions.patch` | Update session metadata | Configure thinking level, model |
| `sessions.reset` | Clear session history | Fresh start |
| `sessions.delete` | Delete session | Cleanup |
| `sessions.compact` | Reduce session size | Memory management |

### Messaging Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `send` | Send message without agent | Direct channel messaging |
| `chat.send` | WebChat-style messaging | Web interface integration |
| `chat.history` | Get conversation history | Context retrieval |
| `chat.abort` | Cancel running agent | Timeout handling |

**Direct Send Example:**

```typescript
// Send without invoking agent AI
await service.request('send', {
  to: '+15551234567',
  message: 'Hello from orchestrator!',
  provider: 'whatsapp',
  idempotencyKey: randomUUID()
});
```

### System Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `health` | System health snapshot | Monitoring |
| `status` | Gateway status | Health checks |
| `config.get` | Get configuration | Runtime inspection |
| `providers.status` | Messaging provider status | Channel availability |

### Node Bridge Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `node.list` | List connected nodes | Device discovery |
| `node.describe` | Get node capabilities | Feature detection |
| `node.invoke` | Execute node command | Camera, screen, etc. |

**Node Invocation Example:**

```typescript
// Capture screen via paired macOS node
const result = await service.request('node.invoke', {
  nodeId: 'macbook-pro',
  command: 'screen.record',
  params: { duration: 5000 },
  idempotencyKey: randomUUID()
});
```

### Cron/Scheduling Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `cron.list` | List scheduled jobs | View schedules |
| `cron.add` | Create cron job | Scheduled tasks |
| `cron.run` | Manually trigger job | Testing |

---

## OpenClaw Tool Capabilities

When invoking the OpenClaw agent, it has access to these powerful tools:

### File System Tools
- `read`, `write`, `edit`, `apply_patch`, `grep`, `find`, `ls`

### Execution Tools
- `exec` - Run shell commands (supports PTY, background, elevated)
- `process` - Manage background processes

### Web Tools
- `web_search` - Brave Search API
- `web_fetch` - Fetch and extract web content

### Browser Tools
- `browser` - Playwright-based browser automation (navigate, click, type, screenshot)

### Messaging Tools
- `message` - Send messages, reactions, edits, polls across channels

### Multi-Agent Tools
- `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`
- `agents_list`, `session_status`

### System Tools
- `gateway` - Restart, apply config, updates
- `cron` - Schedule recurring tasks

### Device Tools
- `canvas` - Present/eval/snapshot web UIs
- `nodes` - Camera, screen recording, notifications on paired devices

### Memory Tools
- `memory_search` - Vector + keyword hybrid search
- `memory_get` - Retrieve indexed file contents

---

## Integration Patterns

### Pattern 1: Messaging Gateway

Use OpenClaw as a messaging gateway - our orchestrator delegates all channel communication:

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────┐
│  Our Agent      │   RPC   │  OpenClaw       │  API    │  WhatsApp   │
│  (task focus)   ├────────►│  Gateway        ├────────►│  Telegram   │
│                 │         │                 │         │  Discord    │
└─────────────────┘         └─────────────────┘         └─────────────┘
```

**Service API:**

```typescript
interface OpenClawService {
  // Messaging
  sendMessage(channel: string, target: string, text: string): Promise<void>;
  sendReaction(channel: string, messageId: string, emoji: string): Promise<void>;
  
  // Channel status
  getProviderStatus(): Promise<ProviderStatusResult>;
}
```

### Pattern 2: Capability Extension

Extend our agents with OpenClaw's tools (browser, exec, memory):

```typescript
// Our orchestrator delegates complex tasks
async function handleBrowserTask(url: string, action: string) {
  const events = await openClawService.invokeAgent(
    `Use browser to navigate to ${url} and ${action}`,
    { sessionKey: 'browser-worker' }
  );
  
  for await (const event of events) {
    if (event.type === 'tool_result' && event.tool === 'browser') {
      return event.result;
    }
  }
}
```

### Pattern 3: Bidirectional Bridge

Register our system as an OpenClaw agent endpoint, allowing OpenClaw users to trigger our orchestrator:

```
User (WhatsApp) ──► OpenClaw ──► Our Orchestrator ──► Task Execution
                        ▲              │
                        └──────────────┘
                         Results back
```

**OpenClaw Binding Configuration:**

```json
{
  "agents": {
    "bindings": {
      "list": [
        {
          "channel": "whatsapp",
          "target": "+15559999999",
          "agentId": "external-orchestrator"
        }
      ]
    },
    "list": [
      {
        "id": "external-orchestrator",
        "model": { "primary": "external" },
        "externalEndpoint": "http://our-server:3000/openclaw-webhook"
      }
    ]
  }
}
```

### Pattern 4: Device Capability Access

Use OpenClaw nodes for physical device actions:

```typescript
class DeviceCapabilityService {
  constructor(private openclaw: OpenClawService) {}
  
  async captureScreen(nodeId: string): Promise<Buffer> {
    const result = await this.openclaw.invokeNode(nodeId, 'screen.record', {
      duration: 1000,
      format: 'png'
    });
    return Buffer.from(result.data, 'base64');
  }
  
  async takePhoto(nodeId: string): Promise<Buffer> {
    const result = await this.openclaw.invokeNode(nodeId, 'camera.snap', {});
    return Buffer.from(result.data, 'base64');
  }
  
  async sendNotification(nodeId: string, title: string, body: string): Promise<void> {
    await this.openclaw.invokeNode(nodeId, 'system.notify', { title, body });
  }
}
```

---

## Event Streaming Architecture

OpenClaw emits events during agent execution. Our service must handle these:

### Event Types

| Event Type | Description | Data |
|------------|-------------|------|
| `agent` | Agent lifecycle events | `{ runId, stream, data }` |
| `chat` | WebChat message events | `{ sessionKey, ... }` |
| `tick` | Periodic tick | `{ ts }` |
| `shutdown` | Gateway stopping | `{ reason }` |
| `node.invoke.request` | Node action requested | `{ nodeId, command }` |

### Agent Event Streams

The `agent` event has a `stream` field indicating the event type:

```typescript
type AgentEventStream = 
  | 'start'        // Agent run started
  | 'text'         // Text output chunk (streaming)
  | 'tool'         // Tool invocation started
  | 'tool_result'  // Tool completed
  | 'thinking'     // Reasoning/thinking content
  | 'end'          // Run completed
  | 'error';       // Error occurred
```

### Event Transformation

Map OpenClaw events to our AgentEvent format:

```typescript
// services/openclaw/OpenClawEventMapper.ts
export function mapOpenClawEvent(oclEvent: any): AgentEvent | null {
  const { stream, data } = oclEvent;
  
  switch (stream) {
    case 'start':
      return { type: 'thinking', content: 'Starting...' };
    
    case 'text':
      return { type: 'message_delta', delta: data };
    
    case 'tool':
      return { 
        type: 'tool_start', 
        tool: data.name, 
        args: data.args 
      };
    
    case 'tool_result':
      return { 
        type: 'tool_result', 
        tool: data.name, 
        result: data.result,
        error: data.error 
      };
    
    case 'thinking':
      return { type: 'thinking', content: data };
    
    case 'end':
      return { 
        type: 'done', 
        output: data.summary,
        summary: data.summary 
      };
    
    case 'error':
      return { 
        type: 'error', 
        error: data.message, 
        recoverable: data.retryable ?? false 
      };
    
    default:
      return null; // Unknown event type
  }
}
```

---

## Related Files

- [agent/types.ts](../../../src/worker/agent/types.ts) - Agent type definitions
- [agent/BaseAgent.ts](../../../src/worker/agent/BaseAgent.ts) - Base agent class
- [api/SocketServerV2.ts](../../../src/worker/api/SocketServerV2.ts) - Real-time event streaming

## References

- [ClawdBot Core Concepts](https://deepwiki.com/clawdbot/clawdbot/1.1-core-concepts)
- [ClawdBot Protocol Specification](https://deepwiki.com/clawdbot/clawdbot/6.1-protocol-specification)
- [ClawdBot RPC Methods](https://deepwiki.com/clawdbot/clawdbot/6.2-rpc-methods)
- [ClawdBot Agent Tools](https://deepwiki.com/clawdbot/clawdbot/4.5-agent-tools)
- [ClawdBot Multi-Agent System](https://deepwiki.com/clawdbot/clawdbot/2.3-multi-agent-system)
- [ClawdBot GitHub](https://github.com/clawdbot/clawdbot)

---

## Open Questions & Exploration Areas

### 1. Session Isolation Strategy

**Question**: Should each of our agents get its own OpenClaw session, or share one?

| Approach | Pros | Cons |
|----------|------|------|
| **Shared session** | Single conversation context | Agent responses intermix |
| **Per-agent sessions** | Clean isolation | More sessions to manage |
| **Per-task sessions** | Perfect isolation | Session overhead |

**Recommendation**: Start with per-agent sessions using pattern:
```
agent:<openclaw-agent>:channel:api:<our-agent-role>
```

### 2. Bidirectional Integration

**Question**: Should OpenClaw be able to call back into our system?

**Options**:
a) **One-way (us → OpenClaw)**: Simpler, we control all flows
b) **Bidirectional (us ↔ OpenClaw)**: Full integration, OpenClaw users can trigger our agents

For bidirectional, we'd need to:
- Expose a webhook endpoint for OpenClaw to call
- Register as an external agent in OpenClaw config
- Handle inbound messages from OpenClaw channels

### 3. Tool Exposure

**Question**: Which OpenClaw tools should our agents be able to invoke?

**Priority Levels**:
- **P0 (Must Have)**: `send`, `message` (messaging), `web_search`, `web_fetch`
- **P1 (Should Have)**: `browser`, `exec`, `read`, `write`
- **P2 (Nice to Have)**: `nodes`, `canvas`, `memory_search`
- **P3 (Future)**: `cron`, `gateway`, `sessions_spawn`

### 4. Model Routing

**Question**: Should we use OpenClaw's model or our own?

| Approach | When to Use |
|----------|-------------|
| **OpenClaw's model** | Leverage their optimizations, prompt caching |
| **Our model via agent param** | Custom model needs, cost control |
| **Hybrid** | Use OpenClaw for tools, our model for planning |

### 5. Streaming vs Polling

**Question**: How to handle long-running operations?

**OpenClaw Pattern**:
```typescript
// 1. Submit request
const { runId } = await request('agent', { message, idempotencyKey });
// Returns immediately with runId

// 2. Either:
// a) Listen for 'agent' events with matching runId (streaming)
// b) Poll with agent.wait (simpler but higher latency)
const result = await request('agent.wait', { runId, timeoutMs: 60000 });
```

**Recommendation**: Use event streaming for real-time UX, with `agent.wait` as fallback.

---

## Alternative Integration Approaches (Not Recommended, But Documented)

### Alt 1: MCP Tool Server

Wrap OpenClaw as an MCP tool server our LangChain agents can invoke.

```typescript
// NOT RECOMMENDED - Limited to tool calls, no streaming
const mcpTools = await loadMcpTools({
  server: 'openclaw-mcp',
  transport: 'stdio'
});
```

**Why Not**: MCP tools don't support streaming; OpenClaw's value is in its agent runtime.

### Alt 2: Direct Library Import

Import `@mariozechner/pi-agent-core` directly.

```typescript
// NOT RECOMMENDED - Tight coupling
import { runEmbeddedPiAgent } from '@mariozechner/pi-agent-core';
```

**Why Not**: 
- Creates version lock between systems
- OpenClaw manages its own deps/config
- Would need to duplicate workspace/session setup

### Alt 3: HTTP Proxy

Wrap OpenClaw in a REST API.

**Why Not**:
- Loses WebSocket streaming
- Extra hop and complexity
- Gateway already has WebSocket RPC

---

## Plugin Architecture: General Analysis

### What Is Plugin Architecture?

A **plugin architecture** (also called extension architecture) is a software design pattern where a host application exposes extension points that allow third-party code to add functionality without modifying the core system.

```
┌─────────────────────────────────────────────────────┐
│                   Host Application                   │
│  ┌───────────────────────────────────────────────┐  │
│  │            Plugin Manager / Loader             │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐       │  │
│  │  │Plugin A │  │Plugin B │  │Plugin C │  ...  │  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘       │  │
│  └───────┼────────────┼────────────┼────────────┘  │
│          ▼            ▼            ▼               │
│  ┌───────────────────────────────────────────────┐  │
│  │         Extension Points (Hooks/APIs)          │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Core Components of Plugin Systems

| Component | Description | Examples |
|-----------|-------------|----------|
| **Plugin Manifest** | Metadata file declaring plugin identity, version, capabilities | `package.json`, `plugin.json`, `manifest.yaml` |
| **Extension Points** | Well-defined interfaces/hooks where plugins can attach | Lifecycle hooks, event handlers, capability interfaces |
| **Plugin Loader** | Runtime that discovers, loads, and registers plugins | Startup scan, dynamic import, package discovery |
| **Plugin SDK** | Library providing interfaces, utilities, and types for plugin authors | `from "host/plugin-sdk"` |
| **Plugin Registry** | Catalog of installed/available plugins | Marketplace, NPM scope, local directory |
| **Namespace/Isolation** | Prevents conflicts between plugins | Scoped names (`@scope/plugin`), sandboxing |

### Plugin Discovery Patterns

| Pattern | Description | Use When |
|---------|-------------|----------|
| **Directory Scan** | Scan folder (e.g., `plugins/`, `extensions/`) at startup | Bundled plugins, development |
| **Package Discovery** | Find packages by naming convention (`@scope/*`) | NPM/package ecosystems |
| **Manifest Registry** | Central file lists enabled plugins | Explicit control needed |
| **Dynamic Registration** | Plugins register at runtime via API | Hot-loading, remote plugins |

```typescript
// Pattern 1: Directory Scan
const plugins = fs.readdirSync('./plugins')
  .filter(d => fs.existsSync(`./plugins/${d}/plugin.json`))
  .map(d => loadPlugin(`./plugins/${d}`));

// Pattern 2: Package Discovery
const packages = await findPackages('@myapp/*');
const plugins = packages.filter(p => p.myapp?.plugin);

// Pattern 3: Manifest Registry
const enabled = JSON.parse(fs.readFileSync('./plugins.json'));
const plugins = enabled.map(name => loadPlugin(name));

// Pattern 4: Dynamic Registration
app.registerPlugin(myPlugin);  // Runtime API
```

### Plugin Lifecycle Hooks

Most plugin systems define lifecycle hooks for initialization and cleanup:

```typescript
interface PluginLifecycle {
  // Called when plugin is loaded
  onLoad?(context: PluginContext): void | Promise<void>;
  
  // Called when plugin is activated (after all plugins loaded)
  onActivate?(context: PluginContext): void | Promise<void>;
  
  // Called when plugin is being unloaded
  onDeactivate?(context: PluginContext): void | Promise<void>;
  
  // Called on host shutdown
  onShutdown?(): void | Promise<void>;
}
```

### Event Hook Patterns

Plugins commonly hook into host events:

```typescript
// Pattern A: Event Emitter
host.on('beforeRequest', (ctx) => plugin.intercept(ctx));
host.on('afterResponse', (ctx) => plugin.transform(ctx));

// Pattern B: Middleware Chain
host.use(plugin.middleware());

// Pattern C: Named Hook Points
interface Hooks {
  'PreToolUse': (tool: Tool, input: any) => void;
  'PostToolUse': (tool: Tool, output: any) => void;
  'OnMessage': (message: Message) => void;
}
```

### Capability Registration

Plugins declare what they provide:

```typescript
// Approach A: Interface Implementation
interface ChannelPlugin {
  id: string;
  sendMessage(to: string, text: string): Promise<void>;
  receiveMessage(): AsyncIterable<Message>;
}

// Approach B: Capability Declaration
{
  "capabilities": ["messaging", "file-access", "browser"],
  "provides": {
    "tools": ["send_whatsapp", "browse_web"],
    "commands": ["/message", "/browse"]
  }
}

// Approach C: Dynamic Registration
host.registerTool('my-tool', myToolHandler);
host.registerCommand('/my-cmd', myCmdHandler);
```

---

## When to Use Plugin Architecture

### ✅ Plugin Architecture Is Good For:

| Use Case | Why It Works |
|----------|--------------|
| **Core extensions** | Channels, auth providers, storage backends - things that extend host capabilities |
| **Shared ecosystem** | Marketplaces, community contributions, reusable across projects |
| **Versioned releases** | Semantic versioning, changelogs, update management |
| **Deep integration** | Plugins need access to host internals, same runtime |
| **Consistent interface** | All plugins follow same contract - easy to reason about |
| **Startup composition** | System composed from plugins at boot time |

### ❌ Plugin Architecture Is Not Ideal For:

| Use Case | Why It's Problematic |
|----------|----------------------|
| **Independent services** | Plugins share host lifecycle - can't scale independently |
| **Multi-language** | Most plugin systems are single-language (TypeScript, Python) |
| **External APIs** | Wrapping existing services as plugins adds unnecessary coupling |
| **Runtime flexibility** | Plugins typically loaded at startup, not hot-swappable |
| **Isolation requirements** | Plugins run in-process - harder to sandbox |
| **Organizational boundaries** | External teams may not want to learn your plugin SDK |

---

## Plugin Architecture vs Service Architecture

| Aspect | Plugin Architecture | Service Architecture |
|--------|---------------------|---------------------|
| **Coupling** | Tight (same process) | Loose (network API) |
| **Language** | Same as host | Any language |
| **Lifecycle** | Tied to host | Independent |
| **Scaling** | Scales with host | Independent scaling |
| **Deployment** | Deploy with host | Deploy separately |
| **Discovery** | Startup scan | Service registry |
| **Communication** | Function calls | HTTP/gRPC/WebSocket |
| **Isolation** | Limited | Strong (process/container) |
| **Latency** | Nanoseconds | Milliseconds |
| **Failure** | Can crash host | Isolated failures |

### Hybrid: Service-Backed Plugins

Some systems combine both - plugins that wrap external services:

```typescript
// Plugin that proxies to external service
class ExternalServicePlugin implements Plugin {
  private client: ServiceClient;
  
  async onLoad(ctx: PluginContext) {
    this.client = new ServiceClient(this.config.endpoint);
  }
  
  async execute(input: Input): Promise<Output> {
    // Plugin interface, but delegates to external service
    return this.client.call(input);
  }
}
```

---

## What Plugin Components Should Ping Support?

Based on general plugin patterns and Ping's use cases:

### Component Analysis

| Component | Relevance to Ping | Recommendation |
|-----------|-------------------|----------------|
| **Skills** | High - agents need tools/capabilities | ✅ Already have MCP tools, could add Skills SDK |
| **Agents** | High - core offering | ✅ Already have YAML definitions |
| **Hooks** | Medium - event handling | 🔶 Consider for PreTask/PostTask hooks |
| **Commands** | Low - not a CLI tool | ❌ Not applicable |
| **Channels** | Low - not a messaging platform | ❌ Leave to OpenClaw |

### Recommended Plugin Surface for Ping

```typescript
// Ping Plugin Interface (if we built one)
interface PingPlugin {
  // Identity
  id: string;
  name: string;
  version: string;
  
  // What this plugin provides
  provides?: {
    agents?: AgentDefinition[];      // Agent definitions
    skills?: SkillDefinition[];      // Agent skills/tools
    hooks?: HookDefinition[];        // Event hooks
  };
  
  // Lifecycle
  onLoad?(context: PingContext): Promise<void>;
  onUnload?(): Promise<void>;
}

// Skill Definition (agent capability)
interface SkillDefinition {
  name: string;
  description: string;
  tool: Tool;  // LangChain tool or MCP tool
}

// Hook Definition
interface HookDefinition {
  event: 'PreTaskExecution' | 'PostTaskExecution' | 'OnAgentMessage' | 'OnError';
  handler: (context: HookContext) => void | Promise<void>;
}
```

### Directory Structure (If We Built It)

```
plugins/
├── my-plugin/
│   ├── plugin.json           # Manifest
│   ├── agents/               # Agent YAML definitions
│   │   └── research-agent.yaml
│   ├── skills/               # Skills for agents
│   │   └── web-search/
│   │       └── SKILL.md
│   └── hooks/                # Event hooks
│       └── hooks.json
```

---

## Decision: Should Ping Adopt Plugin Architecture?

### Current State

Ping already has plugin-like mechanisms:

| Capability | Current Implementation |
|------------|------------------------|
| **Agents** | YAML definitions in `agents/` directory |
| **Tools** | MCP tools via `@langchain/mcp-adapters` |
| **External Agents** | `external` type with HTTP endpoints |
| **Skills** | Planned in Evolving Agent feature |

### Analysis

| Factor | Plugin Architecture | Current Approach | Winner |
|--------|---------------------|------------------|--------|
| **Onboarding internal agents** | Plugin SDK + YAML | YAML definitions | Tie |
| **Onboarding external agents** | Plugin wrapping HTTP | Direct HTTP registration | Current |
| **Tool distribution** | Plugin packages | MCP servers | MCP |
| **Team sharing** | Marketplace | Git + imports | Depends |
| **Learning curve** | New SDK to learn | YAML + HTTP | Current |
| **Community ecosystem** | Enables contributions | Manual integration | Plugin |

### Recommendation

**Don't adopt full plugin architecture now. Instead:**

1. **Keep YAML-based agent definitions** - Already plugin-like, simpler
2. **Use MCP for tools** - Standard protocol, existing ecosystem
3. **Use HTTP/WebSocket for external agents** - Loose coupling, any language
4. **Consider lightweight hooks** - PreTask/PostTask for automation

**Future consideration**: If Ping grows a community wanting to share:
- Add plugin manifest (`plugin.json`) to agent directories
- Build a discovery mechanism (scan `plugins/` or find `@ping/*` packages)
- Create Ping Plugin SDK for hooks and lifecycle

### Immediate Actions

For OpenClaw integration specifically:

```yaml
# agents/external/openclaw-bridge.yaml
# This IS the "plugin" - just simpler
id: openclaw-bridge
name: OpenClaw Bridge
type: external
role: messaging-specialist
config:
  type: openclaw-gateway
  gateway:
    host: localhost
    port: 18789
```

No plugin SDK needed - the YAML definition + Service pattern achieves the same goal with less complexity.

---

## Generalized Pattern: External Agent Onboarding

The YAML + Service Layer pattern isn't OpenClaw-specific—it's Ping's **standard approach for integrating any external agent**. Here's the reusable template:

### Pattern Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ping Platform                             │
│                                                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │  YAML Definition │───▶│  Agent Factory  │───▶│ Bridge Agent │ │
│  │  (agents/*.yaml) │    │  (creates agent)│    │  (thin proxy)│ │
│  └─────────────────┘    └─────────────────┘    └──────┬───────┘ │
│                                                        │         │
│  ┌─────────────────────────────────────────────────────▼───────┐ │
│  │                    Service Layer                             │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │ Connection  │  │   Event     │  │   Error Handling    │  │ │
│  │  │ Management  │  │   Mapping   │  │   & Retry Logic     │  │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │ │
│  └─────────┼────────────────┼────────────────────┼─────────────┘ │
│            │                │                    │               │
└────────────┼────────────────┼────────────────────┼───────────────┘
             │                │                    │
             ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Agent / Service                      │
│         (OpenClaw, Custom API, Third-party AI, etc.)            │
└─────────────────────────────────────────────────────────────────┘
```

### Step 1: Define Agent in YAML

Create a YAML file describing the external agent:

```yaml
# Template: agents/external/{agent-name}.yaml
id: "{agent-id}"
name: "{Human-Readable Name}"
type: external
role: "{role-in-team}"  # e.g., "researcher", "coder", "reviewer"
goal: "{What this agent does}"

config:
  # Connection details
  endpoint: "{protocol}://{host}:{port}/{path}"
  
  # Authentication (if needed)
  auth:
    type: "{none|bearer|api-key|basic|custom}"
    # type-specific fields...
  
  # Timeouts and retries
  timeout: 30000        # ms
  retryAttempts: 3
  retryDelay: 1000      # ms
  
  # Capabilities this agent provides
  capabilities:
    - "{capability-1}"
    - "{capability-2}"
  
  # Protocol-specific config (optional)
  protocol:
    type: "{http|websocket|grpc|custom}"
    # type-specific options...
```

### Step 2: Create Service Layer (Once Per Protocol Type)

```typescript
// src/worker/services/{protocol}/index.ts

/**
 * Service Layer Template
 * - Handles connection lifecycle
 * - Manages retries and errors
 * - Transforms events to Ping format
 */
export class ExternalAgentService {
  private client: ProtocolClient;
  private config: ExternalServiceConfig;
  
  constructor(config: ExternalServiceConfig) {
    this.config = config;
    this.client = new ProtocolClient(config);
  }
  
  // Connection management
  async connect(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
  async healthCheck(): Promise<boolean> { /* ... */ }
  
  // Core operation - send message, get response
  async invoke(input: AgentInput): Promise<AgentOutput> {
    const request = this.transformRequest(input);
    const response = await this.client.call(request);
    return this.transformResponse(response);
  }
  
  // Event streaming (if supported)
  async *stream(input: AgentInput): AsyncGenerator<AgentEvent> {
    for await (const event of this.client.stream(input)) {
      yield this.mapEvent(event);
    }
  }
  
  // Transform Ping format ↔ External format
  private transformRequest(input: AgentInput): ExternalRequest { /* ... */ }
  private transformResponse(response: ExternalResponse): AgentOutput { /* ... */ }
  private mapEvent(event: ExternalEvent): AgentEvent { /* ... */ }
}
```

### Step 3: Create Bridge Agent (Thin Wrapper)

```typescript
// src/worker/agent/external/{AgentName}BridgeAgent.ts

export class ExternalBridgeAgent extends BaseAgent {
  private service: ExternalAgentService;
  
  constructor(definition: AgentDefinition) {
    super(definition);
    this.service = ServiceRegistry.get(definition.config.endpoint);
  }
  
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    // Simply delegate to service layer
    for await (const event of this.service.stream(input)) {
      yield event;
    }
  }
}
```

### Step 4: Register with Agent Factory

```typescript
// In AgentFactory
class AgentFactory {
  async create(definition: AgentDefinition): Promise<IAgent> {
    switch (definition.type) {
      case 'internal':
        return new InternalAgent(definition);
      
      case 'external':
        // Get or create service for this endpoint
        const service = await ServiceRegistry.getOrCreate(definition.config);
        return new ExternalBridgeAgent(definition, service);
      
      case 'agentic-ui':
        return new AgenticUIAgent(definition);
    }
  }
}
```

---

## Example: Onboarding Different External Agents

### Example 1: OpenClaw (WebSocket Gateway)

```yaml
# agents/external/openclaw.yaml
id: openclaw-bridge
name: OpenClaw Bridge
type: external
role: messaging-specialist
goal: Send and receive messages via OpenClaw channels

config:
  endpoint: ws://localhost:18789
  auth:
    type: custom
    handshake:
      protocol: 3
      role: operator
      scopes: [operator.admin]
  protocol:
    type: websocket-rpc
    frameFormat: json
  capabilities:
    - messaging
    - file-system
    - browser-control
```

### Example 2: Custom Python Agent (HTTP REST)

```yaml
# agents/external/python-analyst.yaml
id: python-analyst
name: Python Data Analyst
type: external
role: data-analyst
goal: Analyze datasets and generate insights

config:
  endpoint: http://localhost:8000/api/chat
  auth:
    type: bearer
    token: ${PYTHON_AGENT_TOKEN}
  timeout: 60000  # Data analysis can be slow
  protocol:
    type: http
    method: POST
  capabilities:
    - data-analysis
    - visualization
    - statistics
```

### Example 3: Cloud AI Service (API Gateway)

```yaml
# agents/external/perplexity.yaml
id: perplexity-search
name: Perplexity Search Agent
type: external
role: researcher
goal: Search the web and synthesize information

config:
  endpoint: https://api.perplexity.ai/chat/completions
  auth:
    type: bearer
    token: ${PERPLEXITY_API_KEY}
  protocol:
    type: http
    method: POST
    headers:
      Content-Type: application/json
  capabilities:
    - web-search
    - research
    - summarization
```

### Example 4: Local LLM (Ollama)

```yaml
# agents/external/local-llm.yaml
id: local-ollama
name: Local Ollama Agent
type: external
role: general-assistant
goal: Answer questions using local LLM

config:
  endpoint: http://localhost:11434/api/chat
  auth:
    type: none
  timeout: 120000  # Local inference can be slow
  protocol:
    type: http-streaming
    method: POST
  capabilities:
    - chat
    - code-generation
    - reasoning
```

### Example 5: gRPC Microservice

```yaml
# agents/external/code-review-service.yaml
id: code-review-grpc
name: Code Review Service
type: external
role: reviewer
goal: Review code for quality and security issues

config:
  endpoint: grpc://code-review.internal:50051
  auth:
    type: mtls
    certPath: ${GRPC_CERT_PATH}
  protocol:
    type: grpc
    service: CodeReviewService
    method: ReviewCode
  capabilities:
    - code-review
    - security-scan
    - best-practices
```

---

## Service Layer Templates by Protocol

### HTTP Service Template

```typescript
// src/worker/services/http/HttpAgentService.ts
export class HttpAgentService extends ExternalAgentService {
  async invoke(input: AgentInput): Promise<AgentOutput> {
    const response = await fetch(this.config.endpoint, {
      method: this.config.method || 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        message: input.message,
        thread_id: input.threadId,
        context: input.context
      })
    });
    return this.parseResponse(await response.json());
  }
}
```

### WebSocket RPC Service Template

```typescript
// src/worker/services/websocket-rpc/WebSocketRpcService.ts
export class WebSocketRpcService extends ExternalAgentService {
  private ws: WebSocket;
  private requestId = 0;
  
  async invoke(input: AgentInput): Promise<AgentOutput> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify({
        id,
        method: 'agent',
        params: { message: input.message }
      }));
      this.waitForResponse(id).then(resolve).catch(reject);
    });
  }
}
```

### Streaming HTTP Service Template

```typescript
// src/worker/services/http-streaming/HttpStreamingService.ts
export class HttpStreamingService extends ExternalAgentService {
  async *stream(input: AgentInput): AsyncGenerator<AgentEvent> {
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { ...this.buildHeaders(), 'Accept': 'text/event-stream' },
      body: JSON.stringify({ message: input.message })
    });
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* this.parseSSEChunk(decoder.decode(value));
    }
  }
}
```

---

## Benefits of This Pattern

| Benefit | Description |
|---------|-------------|
| **No SDK required** | External agent authors just implement HTTP/WS endpoint |
| **Language agnostic** | Any language can be an external agent |
| **Simple onboarding** | Just create a YAML file |
| **Separation of concerns** | Protocol handling in Service Layer, agent logic separate |
| **Reusable services** | Same service can back multiple agents |
| **Easy testing** | Mock service layer for unit tests |
| **Gradual complexity** | Start with HTTP, add WebSocket/gRPC later |
| **Consistent interface** | All agents look the same to AgentManager |

---

## File Structure

```
src/worker/
├── agent/
│   ├── types.ts                    # AgentDefinition, IAgent
│   ├── BaseAgent.ts                # Abstract base
│   ├── AgentFactory.ts             # Creates agents from YAML
│   ├── AgentLoader.ts              # Loads YAML files
│   ├── internal/                   # InternalAgent
│   └── external/                   # ExternalBridgeAgent (generic)
│
├── services/                       # Service Layer (one per protocol)
│   ├── ServiceRegistry.ts          # Singleton registry
│   ├── http/
│   │   └── HttpAgentService.ts
│   ├── websocket-rpc/
│   │   └── WebSocketRpcService.ts
│   ├── http-streaming/
│   │   └── HttpStreamingService.ts
│   └── openclaw/                   # OpenClaw-specific (extends websocket-rpc)
│       ├── OpenClawService.ts
│       └── OpenClawEventMapper.ts
│
└── agents/                         # YAML definitions (loaded at startup)
    ├── internal/
    │   ├── role-builder.yaml
    │   └── plan-builder.yaml
    └── external/
        ├── openclaw.yaml
        ├── python-analyst.yaml
        └── perplexity.yaml
```

---

## Summary: Onboarding Any External Agent

| Step | Action | Files |
|------|--------|-------|
| 1 | **Create YAML definition** | `agents/external/{name}.yaml` |
| 2 | **Identify protocol** | HTTP, WebSocket, gRPC, etc. |
| 3 | **Use/create service** | `services/{protocol}/` |
| 4 | **Restart** | AgentLoader discovers new YAML |
| 5 | **Use agent** | Available via AgentManager |

This pattern scales to **any number of external agents** with:
- **Zero plugin SDK** for external developers
- **Minimal code** for new protocol types
- **Consistent experience** across all agents

---

## OpenClaw Plugin System Analysis

### What Are OpenClaw Plugins?

OpenClaw uses a **plugin system** to modularize integrations. Plugins are TypeScript modules that implement standardized interfaces exposed by the Plugin SDK (`openclaw/plugin-sdk`).

#### Plugin Types in OpenClaw

| Type | Purpose | Interface | Examples |
|------|---------|-----------|----------|
| **Channel Plugins** | Messaging platform integrations | `ChannelPlugin<TAccount>` | WhatsApp, Telegram, Discord, Matrix, Signal |
| **Auth Providers** | OAuth/credential providers | Custom interfaces | Google Gemini CLI Auth, Copilot Proxy |
| **Voice Call Plugins** | Telephony integrations | VoiceCallPlugin | Twilio, Telnyx |
| **Skill Extensions** | Agent capability modules | Tool definitions | Memory backends, diagnostics |

#### Plugin Structure

```typescript
// Example: Channel Plugin (from OpenClaw SDK)
import { ChannelPlugin, buildChannelConfigSchema } from "openclaw/plugin-sdk";

export const myChannelPlugin: ChannelPlugin<MyAccountType> = {
  id: "my-channel",
  meta: { id: "my-channel", label: "My Channel", aliases: ["mc"] },
  capabilities: { chatTypes: ["direct", "group"], media: true },
  configSchema: buildChannelConfigSchema(MyConfigSchema),
  config: {
    listAccountIds: (cfg) => [...],
    resolveAccount: (cfg, accountId) => {...},
  },
  security: { resolveDmPolicy: (...) => {...} },
  messaging: { normalizeTarget: (raw) => raw.trim() },
  outbound: {
    sendText: async ({ to, text }) => { /* send logic */ },
    sendMedia: async ({ to, mediaUrl }) => { /* send logic */ },
  },
};
```

#### Plugin Discovery & Loading

OpenClaw dynamically loads plugins at startup:
1. **Bundled**: Scans `extensions/` directory for disk-tree plugins
2. **NPM**: Discovers installed `@openclaw/*` packages
3. **Registration**: Loads modules and registers with Gateway

```
// Plugin metadata in package.json
{
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "matrix",
      "label": "Matrix",
      "order": 70
    },
    "install": {
      "npmSpec": "@openclaw/matrix",
      "localPath": "extensions/matrix"
    }
  }
}
```

---

## Can External Agents Be Added as Plugins in Ping?

### Current Ping Agent Architecture

Ping currently uses a **unified agent architecture** with three agent types:

```typescript
type AgentType = "internal" | "external" | "agentic-ui";

interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  type: AgentType;
  goal: string;
  config: InternalConfig | ExternalConfig | AgenticUIConfig;
}
```

| Type | Description |
|------|-------------|
| `internal` | LangChain-based agents (tools + structured output) |
| `external` | External API agents (user's own HTTP endpoints) |
| `agentic-ui` | UI automation agents (browser, electron, native) |

### External Agents ≠ Plugins (Different Concepts)

| Aspect | OpenClaw Plugins | Ping External Agents |
|--------|------------------|---------------------|
| **Purpose** | Extend OpenClaw's capabilities (channels, auth) | Register external AI agents for chat/tasks |
| **Interface** | TypeScript interfaces (ChannelPlugin, etc.) | HTTP/WebSocket endpoints |
| **Loading** | Startup discovery from extensions/ or NPM | Runtime registration via API |
| **Lifecycle** | Part of Gateway process | Separate processes/services |
| **Coupling** | Tight (same runtime) | Loose (network API) |

**Answer**: External agents in Ping are already pluggable via the `external` agent type. They register via HTTP endpoints and implement a simple contract:

```typescript
// External agent contract (existing in Ping)
interface ExternalAgentEndpoint {
  POST /chat: {
    Request: { message: string; thread_id: string; context?: any }
    Response: { content: string; metadata?: any }
  }
}
```

---

## Is Plugin Architecture Better for Onboarding New Agents?

### Comparison: Plugin Architecture vs Current Ping Approach

| Criteria | Plugin Architecture (OpenClaw-style) | Current Ping Architecture |
|----------|-------------------------------------|---------------------------|
| **Onboarding Complexity** | Implement TypeScript interface, package as NPM | Deploy HTTP endpoint, register via API |
| **Language Lock-in** | TypeScript only | Any language (HTTP API) |
| **Runtime Coupling** | Same process (tight) | Network-separated (loose) |
| **Discovery** | Startup scan | Runtime registration |
| **Hot Reload** | Requires restart | Can add/remove agents live |
| **Testing** | Unit test with mocks | Black-box API testing |
| **Distribution** | NPM package | Docker container, cloud function |
| **Scaling** | Scales with Gateway | Independent scaling |

### When Plugin Architecture Is Better

✅ **Use Plugin Architecture when:**
- Extensions are **core capabilities** (channels, auth providers)
- You need **deep integration** with internals
- Extensions share **same lifecycle** as host
- You control the **developer ecosystem**
- Performance is critical (no network hop)

### When Current Ping Architecture Is Better

✅ **Use External Agent Architecture when:**
- Agents are **independent services**
- Agents may be in **different languages** (Python, Go, etc.)
- Need **horizontal scaling** per agent
- Want **loose coupling** and independent deployments
- External teams contribute agents (no access to core)
- Agents already exist as services (wrap existing APIs)

---

## Hybrid Approach: Plugin SDK for Ping

If we wanted plugin-style convenience with external flexibility, we could build a **Ping Plugin SDK**:

### Option A: TypeScript Plugin SDK (OpenClaw-style)

```typescript
// ping/plugin-sdk
export interface PingAgentPlugin {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  
  // Called when agent receives message
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;
  
  // Optional: tools this agent provides
  tools?: Tool[];
  
  // Optional: configuration schema
  configSchema?: ZodSchema;
}

// Usage in extensions/my-agent/index.ts
export const myAgentPlugin: PingAgentPlugin = {
  id: "my-agent",
  name: "My Custom Agent",
  role: "specialist",
  capabilities: ["research", "analysis"],
  
  async *execute(input) {
    yield { type: "thinking", content: "Analyzing..." };
    const result = await doWork(input.message);
    yield { type: "response", content: result };
  }
};
```

**Discovery:**
```
src/worker/plugins/
├── my-agent/
│   ├── package.json  // "ping": { "extensions": ["./index.ts"] }
│   └── index.ts      // export const myAgentPlugin: PingAgentPlugin
```

### Option B: Configuration-Driven Registration

Instead of TypeScript plugins, use YAML agent definitions (current pattern):

```yaml
# agents/my-external-agent.yaml
id: my-external-agent
name: My External Agent
type: external
role: specialist
config:
  endpoint: http://localhost:8000/chat
  auth:
    type: bearer
    token: ${MY_AGENT_TOKEN}
  timeout: 30000
  capabilities:
    - research
    - code-review
```

**Loader at startup:**
```typescript
class AgentLoader {
  async loadFromDirectory(dir: string): Promise<AgentDefinition[]> {
    const files = await glob(`${dir}/**/*.yaml`);
    return Promise.all(files.map(f => this.parseDefinition(f)));
  }
}
```

### Option C: NPM-Style Distribution (Best of Both)

Allow agents to be distributed as NPM packages with discovery:

```typescript
// Discovery: find @ping/* packages
async function discoverPluginAgents(): Promise<AgentDefinition[]> {
  const packages = await findPackages('@ping/*');
  const agents: AgentDefinition[] = [];
  
  for (const pkg of packages) {
    const meta = pkg.ping; // Read from package.json
    if (meta?.agent) {
      agents.push(await loadAgentFromPackage(pkg));
    }
  }
  return agents;
}
```

**Package structure:**
```json
{
  "name": "@ping/research-agent",
  "ping": {
    "agent": {
      "id": "research-agent",
      "type": "internal",
      "entry": "./dist/agent.js"
    }
  }
}
```

---

## Recommendation for Ping

### Keep Current Architecture + Add YAML-Based Discovery

The current `internal`/`external`/`agentic-ui` architecture is **already flexible enough**. Plugin architecture adds complexity without clear benefit for the Ping use case.

**Recommended enhancements:**

1. **YAML Agent Definitions** (already planned):
   ```
   agents/
   ├── role-builder.yaml
   ├── research-agent.yaml
   └── external/
       └── openclaw-bridge.yaml  # OpenClaw as external agent
   ```

2. **Auto-Discovery at Startup**:
   ```typescript
   // In AgentFactory initialization
   const definitions = await AgentLoader.loadFromDirectory('./agents');
   definitions.forEach(def => this.register(def));
   ```

3. **Runtime Registration API** (already exists):
   ```typescript
   POST /api/agents/external
   { endpoint: "http://...", capabilities: [...] }
   ```

### OpenClaw Integration: External Agent, Not Plugin

For OpenClaw specifically, integrate as an **external agent** (via Gateway Protocol bridge):

```yaml
# agents/external/openclaw-bridge.yaml
id: openclaw-bridge
name: OpenClaw Bridge
type: external  # Uses ExternalConfig
role: messaging-specialist
config:
  type: openclaw-gateway  # Custom external type
  gateway:
    host: localhost
    port: 18789
    scopes: [operator.admin]
  capabilities:
    - messaging
    - file-system
    - browser-control
    - code-execution
```

**Why not as a plugin?**
- OpenClaw runs as a separate process (Gateway)
- Already has its own plugin system
- Bridge pattern respects separation of concerns
- Can be deployed/scaled independently

---

## Summary: Plugins vs External Agents

| Question | Answer |
|----------|--------|
| **What are plugins?** | TypeScript modules implementing SDK interfaces, loaded at startup (OpenClaw pattern) |
| **Can external agents be plugins?** | They're different concepts. External agents use HTTP/WS APIs, plugins use in-process interfaces |
| **Is plugin architecture better?** | **Not for Ping's use case.** Plugin arch is better for core extensions; external agent arch is better for independent services |
| **Recommendation for OpenClaw** | Integrate as **external agent** via Gateway Protocol bridge, not as a plugin |
| **Recommendation for Ping** | Keep current architecture. Add YAML discovery for convenience. |

---

## Next Steps to Explore

1. **Prototype Connection**: Build minimal `OpenClawClient` and test handshake
2. **Event Mapping**: Verify event transformation with real OpenClaw responses
3. **Channel Testing**: Test `send` to WhatsApp/Telegram with real accounts
4. **Performance Benchmarking**: Measure latency overhead of the bridge
5. **Failure Modes**: Test reconnection, timeouts, auth failures
6. **Security Review**: Audit token handling and scope requirements
