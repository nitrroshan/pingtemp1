# Ping MCP Server v1.0 — Implementation Plan

**Architecture**: [feature_architecture.md](./feature_architecture.md)  
**Depends on**: A7 (ExternalAgent class), A3 (Tools as MCP)  
**Status**: Research complete — ready for implementation  
**Updated**: May 3, 2026

## Branch
`feature/ping-mcp-server-v1.0`

## Research Findings

### What's Already Available
- **MCP SDK v2 packages installed**: `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@modelcontextprotocol/express` (all `^2.0.0-alpha.2`) — verified importable
- **Zod**: `3.25.76` — supports `zod/v4` subpath (required by MCP SDK v2 `registerTool`) — verified working
- **Express 5**: Already in use (`express@5.1.0`)
- **Directory exists**: `packages/backend/mcp/` with empty `auth/` and `tools/` subdirs
- **`fastmcp`**: In `package.json` but unused — can be removed

### SDK v2 API (Verified Working)
```typescript
import { McpServer, isInitializeRequest } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import * as z from 'zod/v4';  // zod 3.25+ exports v4 as subpath

// McpServer — register tools, resources, prompts
// NodeStreamableHTTPServerTransport — per-session HTTP transport (stateful via sessionIdGenerator)
// createMcpExpressApp — Express sub-app with DNS rebinding protection + JSON parsing
// isInitializeRequest — detect MCP initialize handshake from POST body
```

All imports tested end-to-end: `McpServer` creation, `registerTool` with `zod/v4` schema — **all OK**.

### Integration Points (Existing Code)

| What | File | How MCP Proxies To It |
|------|------|-----------------------|
| `report_status` callback | `assembleLifecycleTools.ts` → `createReportStatusTool()` | MCP tool → `LifecycleToolCallbacks.onStatusUpdate()` |
| `complete_task` callback | `assembleLifecycleTools.ts` → `createCompleteTaskTool()` | MCP tool → `LifecycleToolCallbacks.onAgentComplete()` |
| Collab tools | `CollaborationPlugin.ts` → `createCollabTool()` | MCP tool → single `collab` tool with action enum (discover/read/write/discuss) |
| Skills | `SkillPlugin.ts` → `SkillMcpServer.getTools()` | MCP tool → `ISkill.getInstructions()` |
| Task context | `TaskStore.get(taskId)` | MCP tool → task description, prerequisites, dependencies |
| HttpServer mount | `HttpServer.ts` → `setupRoutes()` | `app.use('/mcp', mcpApp)` after existing routes |

### Zod v3 vs v4
Internal tools use `import { z } from "zod"` (v3 API). MCP SDK v2 `registerTool` requires `zod/v4` schemas (Standard Schema compliant). The MCP tools are a **separate layer** — they use `zod/v4` internally and proxy to existing callbacks. No conflict.

---

## Scope — MVP

v1.0 delivers: **MCP Streamable HTTP server at `/mcp` that external agents connect to for task coordination, collaboration, context, and skills.**

| In scope | Out of scope (v1.1+) |
|----------|---------------------|
| MCP Streamable HTTP server at `/mcp` | Workspace tools (v1.1) |
| Task lifecycle tools (`report_status`, `complete_task`) | Trust level integration (v1.1, depends A10) |
| Collaboration tools (`collab` with discover/read/write actions) | MCP `initialize` capability negotiation (v2.0) |
| Context tools (`get_context`, `get_capabilities`) | Team stacking (v2.0) |
| Skills tool (`invoke_skill`) | |
| Bearer token authentication | |
| Feature flag `PING_MCP_SERVER_ENABLED` | |

---

## Implementation Steps

### Step 1: PingMcpServer — Server Skeleton + Express Mounting
**Files:** `packages/backend/mcp/PingMcpServer.ts`

The core pattern from the SDK's `simpleStreamableHttp.ts` example — one `McpServer` factory function + per-session transports managed via a `Map<sessionId, transport>`.

```typescript
import { McpServer, isInitializeRequest } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export interface PingMcpDeps {
  getCallbacks: (sessionId: string) => LifecycleToolCallbacks;
  pluginRegistry: PluginRegistry;
  taskStore?: TaskStore;
  teamId?: string;
  roleKey?: string;
}

export class PingMcpServer {
  private transports = new Map<string, NodeStreamableHTTPServerTransport>();

  constructor(private deps: PingMcpDeps) {}

  /** Create a fresh McpServer instance with all tools registered (one per session) */
  private createServer(): McpServer {
    const server = new McpServer(
      { name: 'ping', version: '1.0.0' },
      {
        instructions: [
          'You are an external worker in a Ping team.',
          'Use get_context to understand your task.',
          'Use report_status to update progress.',
          'Use complete_task when finished.',
        ].join(' '),
        capabilities: { logging: {} },
      }
    );
    registerTaskTools(server, this.deps);
    registerContextTools(server, this.deps);
    registerCollabTools(server, this.deps);
    registerSkillTools(server, this.deps);
    return server;
  }

  /** Build Express sub-app for mounting at /mcp */
  createApp() {
    const app = createMcpExpressApp({
      host: '0.0.0.0',
      allowedHosts: ['localhost', '127.0.0.1'],
    });

    // --- POST / — all client→server JSON-RPC messages ---
    app.post('/', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && this.transports.has(sessionId)) {
        // Existing session — forward to its transport
        await this.transports.get(sessionId)!.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        // New session — create transport + connect server
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            this.transports.set(sid, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) this.transports.delete(transport.sessionId);
        };
        const server = this.createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad request: missing session ID or not an initialize request' },
        id: null,
      });
    });

    // --- GET / — SSE stream (server→client notifications) ---
    app.get('/', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(404).send('Session not found');
        return;
      }
      await this.transports.get(sessionId)!.handleRequest(req, res);
    });

    // --- DELETE / — session termination ---
    app.delete('/', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(404).send('Session not found');
        return;
      }
      await this.transports.get(sessionId)!.handleRequest(req, res);
    });

    return app;
  }

  /** Cleanup all sessions on server shutdown */
  async close(): Promise<void> {
    for (const [sid, transport] of this.transports) {
      await transport.close();
      this.transports.delete(sid);
    }
  }
}
```

**Key design decisions:**
- **One McpServer per session** — isolates tool state per external agent (matches SDK example)
- **`createMcpExpressApp`** — Express sub-app with DNS rebinding protection built in
- **Routes are `POST /`, `GET /`, `DELETE /`** on the sub-app — mounted at `/mcp` in parent, so they become `POST /mcp`, `GET /mcp`, `DELETE /mcp`
- **`onsessioninitialized`** callback stores transport AFTER handshake completes (avoids race condition)

**Tests:** `npx @modelcontextprotocol/inspector http://localhost:3002/mcp`  
**Depends on:** Nothing

---

### Step 2: Task Lifecycle Tools
**Files:** `packages/backend/mcp/tools/taskTools.ts`

These mirror the existing `createReportStatusTool` / `createCompleteTaskTool` but output MCP `CallToolResult` format instead of LangChain strings.

```typescript
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { PingMcpDeps } from '../PingMcpServer.js';

export function registerTaskTools(server: McpServer, deps: PingMcpDeps): void {
  // --- report_status ---
  // Mirrors: packages/agent-manager/src/agent/internal/tools/reportStatusTool.ts
  server.registerTool('report_status', {
    title: 'Report Status',
    description: 'Report your task progress to the Ping orchestrator. Call this periodically.',
    inputSchema: z.object({
      status: z.enum(['in_progress', 'blocked', 'ready_for_review', 'need_clarification'])
        .describe('Current task status'),
      summary: z.string().describe('Brief summary of progress or what you need'),
      progress: z.number().min(0).max(100).optional()
        .describe('Optional progress percentage (0-100)'),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ status, summary, progress }): Promise<CallToolResult> => {
    // Forward to the same callback chain as internal agents:
    // callback → WorkerPool → OrchestratorService → SocketServerV2 → Frontend
    deps.getCallbacks('session').onStatusUpdate?.({
      taskId: deps.currentTaskId ?? 'unknown',
      role: deps.roleKey ?? 'external',
      status, summary, progress, timestamp: Date.now(),
    });
    return { content: [{ type: 'text', text: `Status reported: ${status} - ${summary}` }] };
  });

  // --- complete_task ---
  // Mirrors: packages/agent-manager/src/agent/internal/tools/completeTaskTool.ts
  server.registerTool('complete_task', {
    title: 'Complete Task',
    description: 'Mark your current task as complete. Include a summary of what was accomplished.',
    inputSchema: z.object({
      summary: z.string().describe('Summary of what was accomplished'),
      deliverables: z.array(z.string()).optional().describe('List of deliverables produced'),
      nextSteps: z.array(z.string()).optional().describe('Recommended next steps'),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false },
  }, async ({ summary, deliverables, nextSteps }): Promise<CallToolResult> => {
    deps.getCallbacks('session').onAgentComplete?.({
      taskId: deps.currentTaskId ?? 'unknown',
      role: deps.roleKey ?? 'external',
      summary, deliverables: deliverables ?? [], nextSteps: nextSteps ?? [],
      timestamp: Date.now(),
    });
    return { content: [{ type: 'text', text: `Task completed: ${summary}` }] };
  });
}
```

**Data flow:** `MCP client → POST /mcp → tools/call → registerTool handler → LifecycleToolCallbacks → WorkerPool → OrchestratorService → SocketServerV2 → Frontend UI`. Same pipeline as internal agents, different entry point.

**Depends on:** Step 1  
**Tests:** Call `report_status` via MCP Inspector → verify UI shows update

---

### Step 3: Context Tools
**Files:** `packages/backend/mcp/tools/contextTools.ts`

```typescript
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';

export function registerContextTools(server: McpServer, deps: PingMcpDeps): void {
  server.registerTool('get_context', {
    title: 'Get Task Context',
    description: 'Get your assigned task details including description, prerequisites, and shared context.',
    inputSchema: z.object({
      taskId: z.string().optional().describe('Task ID (defaults to your current task)'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ taskId }): Promise<CallToolResult> => {
    const resolvedId = taskId ?? deps.currentTaskId;
    const task = deps.taskStore?.get(resolvedId);
    if (!task) {
      return { content: [{ type: 'text', text: 'No task context available' }], isError: true };
    }
    const context = {
      taskId: task.id, title: task.title, description: task.description,
      status: task.status, priority: task.priority,
      prerequisites: Object.fromEntries(task.prerequisites ?? new Map()),
      expectedOutput: task.expectedOutput,
      goalContext: task.context,
    };
    return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
  });

  server.registerTool('get_capabilities', {
    title: 'Get Capabilities',
    description: 'Get information about your team, role, and available skills.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async (): Promise<CallToolResult> => {
    const skills = deps.pluginRegistry?.getOnDemandSkills?.() ?? [];
    const caps = {
      teamId: deps.teamId, role: deps.roleKey,
      availableSkills: skills.map((s: any) => ({ id: s.id, name: s.name })),
    };
    return { content: [{ type: 'text', text: JSON.stringify(caps, null, 2) }] };
  });
}
```

**Depends on:** Step 1  
**Tests:** Call `get_context` → returns task description and prerequisites

---

### Step 4: Collaboration Tools
**Files:** `packages/backend/mcp/tools/collabTools.ts`

The internal `createCollabTool()` uses a single tool with `action` enum. MCP keeps the same pattern — one `collab` tool with action-based routing. Cleaner for external agents than 5+ separate tools.

```typescript
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';

export function registerCollabTools(server: McpServer, deps: PingMcpDeps): void {
  server.registerTool('collab', {
    title: 'Collaboration',
    description: 'Read and write shared team documents (CRDT). Actions: discover, read, write, discuss.',
    inputSchema: z.object({
      action: z.enum(['discover', 'read', 'write', 'discuss'])
        .describe('Action to perform on CRDT documents'),
      docName: z.string().optional().describe('Document name (required for read/write/discuss)'),
      key: z.string().optional().describe('Key within document (for read/write)'),
      value: z.any().optional().describe('Value to write (for write action)'),
      message: z.string().optional().describe('Discussion message (for discuss action)'),
    }),
  }, async ({ action, docName, key, value, message }): Promise<CallToolResult> => {
    // Proxy to CollaborationPlugin's L2 operations
    // Same action routing as createCollabTool() in packages/collaboration/src/L2/tools/index.ts
    const collabStorage = deps.pluginRegistry?.getPluginStorage?.('collaboration');
    const l2 = collabStorage?.crdt;
    if (!l2) {
      return { content: [{ type: 'text', text: 'Collaboration not available' }], isError: true };
    }

    switch (action) {
      case 'discover':
        // Return list of available CRDT docs
        return { content: [{ type: 'text', text: JSON.stringify(await l2.listDocs()) }] };
      case 'read':
        if (!docName || !key) return { content: [{ type: 'text', text: 'docName and key required' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(await l2.read(docName, key)) }] };
      case 'write':
        if (!docName || !key) return { content: [{ type: 'text', text: 'docName and key required' }], isError: true };
        await l2.write(docName, key, value);
        return { content: [{ type: 'text', text: `Written to ${docName}/${key}` }] };
      case 'discuss':
        if (!docName || !message) return { content: [{ type: 'text', text: 'docName and message required' }], isError: true };
        await l2.discuss(docName, message, deps.roleKey ?? 'external');
        return { content: [{ type: 'text', text: `Message posted to ${docName}` }] };
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  });
}
```

**Depends on:** Step 1, CollaborationPlugin L2 initialized  
**Tests:** External agent writes to shared doc → internal agents can read it

---

### Step 5: Skills Tool
**Files:** `packages/backend/mcp/tools/skillTools.ts`

```typescript
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';

export function registerSkillTools(server: McpServer, deps: PingMcpDeps): void {
  server.registerTool('invoke_skill', {
    title: 'Invoke Skill',
    description: 'Load a Ping skill and get its instructions. Use get_capabilities to see available skills.',
    inputSchema: z.object({
      skillId: z.string().describe('Skill ID (e.g., "api-design", "test-runner")'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ skillId }): Promise<CallToolResult> => {
    // Find skill in PluginRegistry → return SKILL.md body
    const skills = deps.pluginRegistry?.getOnDemandSkills?.() ?? [];
    const skill = skills.find((s: any) => s.id === skillId);
    if (!skill) {
      return { content: [{ type: 'text', text: `Skill "${skillId}" not found` }], isError: true };
    }
    const instructions = skill.getInstructions();
    return { content: [{ type: 'text', text: instructions }] };
  });
}
```

**Depends on:** Step 1, SkillPlugin loaded  
**Tests:** Call `invoke_skill("api-design")` → returns SKILL.md content

---

### Step 6: Bearer Token Authentication
**Files:** `packages/backend/mcp/auth/mcpAuth.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import { rootLogger } from '../../logging/index.js';

const logger = rootLogger.child({ module: 'mcpAuth' });

/** Express middleware: validates Bearer token for MCP endpoint */
export function mcpBearerAuth() {
  const expectedToken = process.env.PING_MCP_AUTH_TOKEN;

  return (req: Request, res: Response, next: NextFunction) => {
    // If no token configured, skip auth (local dev mode)
    if (!expectedToken) return next();

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      logger.warn('[mcpAuth] Missing bearer token');
      return res.status(401).json({ error: 'Bearer token required' });
    }

    const token = auth.slice(7);
    if (token !== expectedToken) {
      logger.warn('[mcpAuth] Invalid bearer token');
      return res.status(403).json({ error: 'Invalid token' });
    }

    next();
  };
}
```

Applied in HttpServer.ts:
```typescript
app.use('/mcp', mcpBearerAuth(), mcpServer.createApp());
```

**Depends on:** Step 1  
**Tests:** Missing token → 401, wrong token → 403, valid/no-env → passes

---

### Step 7: Feature Flag + Startup Wiring
**Files:** `packages/backend/api/HttpServer.ts`, `packages/backend/config/featureFlags.ts`

```typescript
// In HttpServer.setupRoutes(), after existing routes:
const config = getConfig();
if (config.featureFlags.pingMcpServer) {
  const { PingMcpServer } = await import('../mcp/PingMcpServer.js');
  const { mcpBearerAuth } = await import('../mcp/auth/mcpAuth.js');
  const mcpServer = new PingMcpServer({
    getCallbacks: (sessionId) => ({ /* wire to WorkerPool callbacks */ }),
    pluginRegistry: options.services?.pluginRegistry,
    taskStore: options.services?.taskStore,
  });
  this.app.use('/mcp', mcpBearerAuth(), mcpServer.createApp());
  this.mcpServer = mcpServer;
  logger.info('[HttpServer] MCP server mounted at /mcp');
}
```

Add to `featureFlags.ts`:
```typescript
pingMcpServer: process.env.PING_MCP_SERVER_ENABLED === 'true',
```

**Depends on:** Steps 1-6  
**Tests:** Flag off → GET /mcp returns 404. Flag on → MCP handshake works.

---

## Recommended Implementation Order

```
Phase 1 — Skeleton (Steps 1 + 7)
  PingMcpServer with one dummy tool → mount at /mcp → verify with MCP Inspector
  
Phase 2 — Core Tools (Steps 2 + 3)
  Task lifecycle + context tools → test full task flow with MCP client
  
Phase 3 — Team Tools (Steps 4 + 5)
  Collab + skills → test cross-agent collaboration
  
Phase 4 — Security (Step 6)
  Bearer token auth → test with/without tokens
```

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `packages/backend/mcp/PingMcpServer.ts` | McpServer factory, per-session transports, Express sub-app |
| `packages/backend/mcp/tools/taskTools.ts` | `report_status`, `complete_task` MCP tools |
| `packages/backend/mcp/tools/contextTools.ts` | `get_context`, `get_capabilities` MCP tools |
| `packages/backend/mcp/tools/collabTools.ts` | `collab` MCP tool (discover/read/write/discuss) |
| `packages/backend/mcp/tools/skillTools.ts` | `invoke_skill` MCP tool |
| `packages/backend/mcp/auth/mcpAuth.ts` | Bearer token middleware |

| Modified files | Change |
|----------------|--------|
| `packages/backend/api/HttpServer.ts` | Mount `/mcp` behind feature flag, store ref for shutdown |
| `packages/backend/config/featureFlags.ts` | Add `pingMcpServer` flag |
| `packages/backend/.env.example` | Add `PING_MCP_SERVER_ENABLED=false`, `PING_MCP_AUTH_TOKEN` |
| `packages/backend/package.json` | Remove unused `fastmcp` |

## Testing Strategy

| Level | What | How |
|-------|------|-----|
| **Smoke** | Server starts, tools listed | `npx @modelcontextprotocol/inspector http://localhost:3002/mcp` |
| **Unit** | Each tool file | Jest with mocked deps |
| **Integration** | MCP client connects → calls tools | MCP Client SDK test script |
| **Auth** | Token validation | curl with/without Authorization header |
| **Session** | Multiple concurrent agents | Two MCP Inspector instances |
| **E2E** | Claude Code as external worker | `{ "ping": { "type": "http", "url": "http://localhost:3002/mcp" } }` in agent config |

## Rollback

- Feature-flagged: `PING_MCP_SERVER_ENABLED=false` (default off)
- MCP server is purely additive — no changes to existing endpoints, tools, or agent runtime
- Remove: delete `packages/backend/mcp/` contents and remove feature flag check
