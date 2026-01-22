# Agent — Unified Agent Architecture

**Status:** Implementing  
**Replaces:** `Agent.ts`, `AgentWorker.ts`, Evolving Agent feature  
**Last Updated:** January 22, 2026

---

## Executive Summary

This document defines the **unified Agent architecture** for Ping. It replaces the fragmented agent implementation with a single, cohesive system.

**Key Concepts:**
- `AgentType` determines how an agent runs (internal/external/agentic-ui)
- Builders are `internal` agents with `responseFormat` for structured output
- Central **TaskQueue** managed by Orchestrator — agents poll for their role's tasks

**Implementation Status:**

| Component | Status | Location |
|-----------|--------|----------|
| Core types | ✅ Done | `src/worker/agent/types.ts` |
| BaseAgent | ✅ Done | `src/worker/agent/BaseAgent.ts` |
| TaskList | ✅ Done | `src/worker/agent/TaskList.ts` |
| AgentFactory | ✅ Done | `src/worker/agent/AgentFactory.ts` |
| YAML definitions | ✅ Done | `src/worker/agent/agents/` |
| InternalAgent | ⏳ Pending | `src/worker/agent/internal/` |
| ExternalAgent | ⏳ Pending | `src/worker/agent/external/` |
| AgenticUIAgent | ⏳ Pending | `src/worker/agent/agentic-ui/` |

---

## Architecture Overview

```
                     AgentDefinition (YAML/JSON)
                              │
                              ▼
                        AgentFactory
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   InternalAgent        ExternalAgent        AgenticUIAgent
   (LangGraph)          (HTTP Proxy)         (Vision+App)
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                       IAgent Interface
                              │
                    Polls from TaskQueue
```

**Agent Types:**

| Type | Runtime | Use Case |
|------|---------|----------|
| `internal` | LangGraph + Claude/OpenAI | Workers, builders, orchestrator |
| `external` | User's HTTP API | Customer's existing agents |
| `agentic-ui` | Headless app + vision | Control desktop/web apps |

---

## Core Interface

```typescript
type AgentType = 'internal' | 'external' | 'agentic-ui';

interface IAgent {
  readonly id: string;
  readonly type: AgentType;
  readonly role: string;
  
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;
  pollTask(taskQueue: TaskQueue): Task | null;
  
  on(event: 'task:complete' | 'task:failed', handler: Function): void;
  getStatus(): AgentStatus;
  stop(): Promise<void>;
}

type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; tool: string; args: any }
  | { type: 'tool_result'; tool: string; result: any }
  | { type: 'message'; content: string }
  | { type: 'error'; error: string; recoverable: boolean }
  | { type: 'done'; summary?: string };
```

---

## Task Polling Model

> **Architecture (Jan 22, 2026):** Central TaskQueue managed by Orchestrator. Agents poll for their role's tasks.

```
Orchestrator ──queue_task──▶ TaskQueue (by role)
                                   │
                                   │ polls
                                   ▼
                              Agent Instance
                                   │
                                   │ emits
                                   ▼
Orchestrator ◀──task:complete── Events
```

**Task Interface:**

```typescript
interface TaskWithContext {
  id: string;
  description: string;
  status: TaskStatus;
  assigned_role: string;
  context: {
    previousOutputs: Array<{ taskId: string; output: any }>;
    artifacts: string[];
  };
}
```

Agent's internal TaskList is **optional** — for local tracking only. Dependency resolution happens in MemoryManager.

---

## Agent Definition Schema

Every agent is defined declaratively in YAML:

```typescript
interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  type: AgentType;
  goal: string;
  systemPrompt?: string;
  config: InternalConfig | ExternalConfig | AgenticUIConfig;
}

// Internal agents (workers + builders)
interface InternalConfig {
  model: { provider: string; model: string };
  tools?: string[];
  responseFormat?: string;  // For structured output (builders)
}

// External agents
interface ExternalConfig {
  endpoint: string;
  auth?: AuthConfig;
  timeout?: number;
}

// AgenticUI agents
interface AgenticUIConfig {
  appType: 'browser' | 'electron' | 'native';
  appUrl?: string;
  hotspotDetection: 'dom' | 'vision' | 'hybrid';
}
```

---

## YAML Examples

### Internal Agent (Worker)

```yaml
id: code-reviewer
name: "Code Reviewer"
role: code-reviewer
type: internal
goal: "Review code for bugs, security, and best practices"
systemPrompt: |
  You are a senior code reviewer. Analyze code for bugs,
  security vulnerabilities, and style issues.
config:
  model:
    provider: anthropic
    model: claude-sonnet-4-20250514
  tools: [read_file, grep_search]
```

### Internal Agent (Builder)

```yaml
id: plan-builder
name: "Plan Builder"
role: system/plan-builder
type: internal
goal: "Decompose goals into tasks with dependencies"
config:
  model:
    provider: azure-openai
    model: gpt-4o-2
  responseFormat: AgentPlanSchema  # ← Structured output
```

### External Agent

```yaml
id: customer-support
name: "Customer Support"
role: customer-support
type: external
goal: "Handle customer inquiries"
config:
  endpoint: "https://my-company.com/agents/support/chat"
  auth:
    type: bearer
    tokenEnvVar: SUPPORT_AGENT_TOKEN
```

---

## Builder Agents

Builders are `internal` agents with `responseFormat`. They produce structured output for system use.

| Builder | Purpose | Output Schema |
|---------|---------|---------------|
| RoleBuilder | Discover roles for a task | `AgentRoleSchema` |
| ConfigBuilder | Generate agent configs | `AgentConfigSchema` |
| PlanBuilder | Decompose goals into tasks | `AgentPlanSchema` |

Orchestrator calls builders via tools:
- `discover_roles` → RoleBuilder
- `generate_config` → ConfigBuilder
- `create_plan` → PlanBuilder

---

## AgentFactory

Creates agents from definitions:

```typescript
class AgentFactory {
  static async create(definition: AgentDefinition): Promise<IAgent> {
    switch (definition.type) {
      case 'internal': return new InternalAgent(definition);
      case 'external': return new ExternalAgent(definition);
      case 'agentic-ui': return new AgenticUIAgent(definition);
    }
  }
  
  static async fromYAML(path: string): Promise<IAgent>;
  static async getBuilder(type: 'role' | 'config' | 'plan'): Promise<IAgent>;
}
```

---

## Migration Summary

| Current | Replacement |
|---------|-------------|
| `Agent.ts` + `AgentWorker.ts` | `InternalAgent` |
| `AgentConfig` | `AgentDefinition` |
| `AgentBuilderFactory.getBuilder()` | `AgentFactory.getBuilder()` |
| `IAgentWorker` | `IAgent` |

**Before:**
```typescript
const agent = new Agent(config);
const worker = new AgentWorker(agent);
await worker.execute(task);
```

**After:**
```typescript
const agent = await AgentFactory.create(definition);
for await (const event of agent.execute(input)) {
  // Handle events
}
```

---

## File Structure

```
src/worker/agent/
├── types.ts           # ✅ All interfaces
├── BaseAgent.ts       # ✅ Abstract base
├── TaskList.ts        # ✅ Optional local tracking
├── AgentFactory.ts    # ✅ Creates agents
├── AgentLoader.ts     # ✅ Loads YAML
├── agents/            # ✅ YAML definitions
│   ├── role-builder.yaml
│   ├── config-builder.yaml
│   └── plan-builder.yaml
├── builder/           # ✅ Builder implementation
│   └── schemas/       # Output schemas
├── internal/          # ⏳ InternalAgent
├── external/          # ⏳ ExternalAgent
└── agentic-ui/        # ⏳ AgenticUIAgent
```

---

## Benefits

| Benefit | How |
|---------|-----|
| **Unified interface** | All agent types implement `IAgent` |
| **Declarative** | YAML definitions, not hardcoded |
| **Model flexibility** | Claude, OpenAI, Azure via providers |
| **External agents** | First-class via `type: external` |
| **Event-driven** | `AsyncGenerator<AgentEvent>` for streaming |
| **Testable** | Mock models and agents easily |

---

## Related Documents

- [Architecture](./architecture.md) — System overview
- [AgenticUI](./agentic-ui.md) — Vision-based app control
- [Orchestrator](../developer-guide/modules/orchestrator.md) — Task coordination
