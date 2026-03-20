# Task 001: InternalAgent Implementation

**Status:** `in-progress`
**Assignee:** Copilot
**Estimated:** 2-3 days
**Priority:** 🔴 Critical (Foundation)
**Branch:** `feature/internal-agent`
**Started:** 2025-01-19

## Description

Implement the `InternalAgent` class - a LangGraph-based agent that serves as the foundation for all internal agents in Ping. This is the core execution engine that workers, builders, and the orchestrator all depend on.

## Context

Currently the codebase has:
- ✅ `BaseAgent` - Abstract base class
- ✅ `InternalAgent` - **UNIFIED AGENT** (handles both tool and structured output modes)
- ✅ `AgentFactory` - Agent creation from YAML definitions
- ❌ `BuilderAgent` - **DELETED** (merged into InternalAgent)

The documented architecture shows `InternalAgent` as the runtime for:
- Workers (task execution) - Tool mode
- Orchestrator (tool-calling brain) - Tool mode
- Builders (RoleBuilder, ConfigBuilder, PlanBuilder) - Structured output mode

## Acceptance Criteria

- [x] Create `src/worker/agent/internal/InternalAgent.ts`
- [x] Implement `IAgent` interface from `src/worker/agent/types.ts`
- [x] Use LangGraph for agent execution with tool support
- [x] Support streaming execution via `AsyncGenerator<AgentEvent>`
- [x] Emit events: `thinking`, `tool_start`, `tool_result`, `message`, `error`, `done`
- [x] Support `task:complete` and `task:failed` event handlers
- [x] Integrate with Azure OpenAI (existing `llm/azureopenai.ts` pattern)
- [x] Support conversation memory via `thread_id`
- [x] Register in `AgentFactory` for `type: internal`
- [x] **MERGED:** Support structured output mode (responseFormat) for builders
- [x] **CLEANUP:** Deleted BuilderAgent (functionality merged)
- [ ] Write unit tests
- [ ] Integration test with Azure OpenAI

## Implementation Notes

**Files created/modified:**
- ✅ Created: `src/worker/agent/internal/InternalAgent.ts` (~600 lines, unified)
- ✅ Created: `src/worker/agent/internal/index.ts`
- ✅ Created: `src/worker/agent/internal/schemas/` (AgentRoleSchema, AgentConfigSchema, AgentPlanSchema)
- ✅ Modified: `src/worker/agent/AgentFactory.ts` - Simplified to use InternalAgent only
- ✅ Modified: `src/worker/agent/index.ts` - Removed builder exports
- ✅ Modified: `src/worker/roleManager/RoleManager.ts` - Use InternalAgent
- ✅ Modified: `src/worker/agentManager/agentManager.ts` - Use InternalAgent
- ❌ Deleted: `src/worker/agent/builder/` folder (merged into internal)

**Implementation Summary:**

InternalAgent is a **unified agent** that handles both modes:

| Mode | Trigger | Use Case | Temperature |
|------|---------|----------|-------------|
| Tool Mode | No `responseFormat` | Workers, Orchestrator | 0.7 |
| Structured Output | Has `responseFormat` | Builders | 0.3 |

```typescript
export class InternalAgent extends BaseAgent {
  // Dual-mode support
  private isStructuredOutputMode: boolean = false;
  private outputSchema: z.ZodSchema | null = null;
  
  // LangGraph agent with MemorySaver for conversation memory
  private agent: any;
  private memory: MemorySaver;
  private mcpClient: MultiServerMCPClient | null = null;
  private loadedTools: any[] = [];
  
  // Mode-specific execution
  private async *executeToolMode(input): AsyncGenerator<AgentEvent>
  private async *executeStructuredOutput(input): AsyncGenerator<AgentEvent>
  
  // Unified run() returns any (structured) or string (tool mode)
  async run(prompt: string, threadId?: string): Promise<any>
  
  // Check mode
  isBuilderMode(): boolean
}
```

**Key Features:**
- **Tool Mode:** Streaming events, tool_start/tool_result, MCP integration
- **Structured Output Mode:** Schema validation, providerStrategy, JSON parsing
- **Shared:** Conversation memory, Azure/Anthropic/OpenAI support, error handling

**AgentFactory Selection Logic (Simplified):**
- All `type: internal` → InternalAgent
- InternalAgent detects mode from `config.responseFormat` in constructor

## Code TODOs

```typescript
// src/worker/agent/internal/InternalAgent.ts
// TODO: [TASK-001] Add retry logic for transient API errors
// TODO: [TASK-001] Implement tool timeout handling
// TODO: [TASK-001] Add metrics collection for execution time
```

## Testing

**Unit tests:**
- Agent initialization from definition
- Tool registration and execution
- Event emission during execution
- Error handling and recovery
- Stop/cancel functionality

**Integration tests:**
- Full execution with Azure OpenAI
- Tool calling roundtrip
- Conversation memory persistence

## Blockers

None - implementation complete, pending tests.

## Progress Log

| Date | Update |
|------|--------|
| 2025-01-19 | Created InternalAgent.ts (357 lines), index.ts, updated AgentFactory |
| 2025-01-19 | TypeScript build passes with no errors |
| 2025-01-19 | Status: Core implementation complete, needs tests |
| 2025-01-25 | **MERGED BuilderAgent into InternalAgent** - unified dual-mode agent |
| 2025-01-25 | Created internal/schemas/ with all builder schemas |
| 2025-01-25 | Deleted builder/ folder (cleanup complete) |
| 2025-01-25 | Updated RoleManager and AgentManager to use InternalAgent |
| 2025-01-25 | InternalAgent now ~600 lines with both modes |

## Notes

This task is the foundation for all subsequent AgentManager redesign work. The Orchestrator, TaskQueue, and Chat Mode all depend on a working InternalAgent.

---

**Related Tasks:**
- Task-002: TaskQueue (depends on this)
- Task-003: Orchestrator (depends on this)
