# Agentic Streaming — Feature Architecture

**Status:** ✅ Complete (Phase 1: Streaming) + 🔄 Phase 2: Autonomous Loop  
**Date:** March 29, 2026 (updated April 10, 2026)  
**Depends on:** Vercel AI SDK v6 (`ai` ^6.0.143)

---

## Overview

Replace current batch-response agent execution with **true agentic streaming** — real-time token-by-token text, tool call lifecycle events, reasoning traces, and step progression streamed to the frontend via Socket.IO.

### Current State

- `InternalAgent.executeToolMode()` calls `agent.invoke()` (LangGraph) — waits for full completion
- Yields a single `message` event with the complete response
- No visibility into tool calls, reasoning, or intermediate steps
- Frontend receives one blob after the agent finishes

### Target State

- Agent uses AI SDK `streamText` with `fullStream` — async iterable of granular events
- Each event (`text-delta`, `tool-call`, `tool-result`, `reasoning-delta`, `start-step`, etc.) forwarded to Socket.IO
- Frontend renders tokens incrementally, shows tool call cards, displays reasoning

---

## Architecture Options

### Option A: AI SDK `streamText` + Socket.IO Bridge (Recommended)

**Implementation:** Replace `agent.invoke()` with AI SDK `streamText()`. Iterate over `result.fullStream` in the worker. Emit each part type as a typed Socket.IO event.

```
streamText() → fullStream → Worker → SocketServerV2 → Frontend
                              │
                    Emits per-event:
                    - text-delta → socket "stream:text"
                    - tool-call → socket "stream:tool-call"
                    - tool-result → socket "stream:tool-result"
                    - start-step → socket "stream:step-start"
                    - reasoning-delta → socket "stream:reasoning"
                    - finish → socket "stream:done"
```

**Pros:**
- Native async iterable — no callback gymnastics
- `fullStream` provides 15+ event types (text, reasoning, tool lifecycle, sources, files)
- Lifecycle callbacks (`onStepFinish`, `onChunk`, `experimental_onToolCallStart/Finish`) for logging
- `smoothStream()` transform for UX-friendly text delivery
- Built-in backpressure

**Cons:**
- Must rework InternalAgent execution model from sync-invoke to async-stream
- Socket.IO event schema needs design for all stream part types
- Frontend needs new stream rendering components

**Effort:** Medium (2-3 weeks including frontend)

### Option B: Server-Sent Events (SSE) Instead of Socket.IO

**Implementation:** Use AI SDK's built-in `result.toUIMessageStreamResponse()` as HTTP SSE endpoint. Frontend uses `useChat` or custom SSE client.

**Pros:**
- Zero bridging code — AI SDK handles the SSE format natively
- `toUIMessageStreamResponse()` produces protocol-compliant stream
- Works with AI SDK UI's `useChat` hook directly

**Cons:**
- Requires adding SSE endpoints alongside existing Socket.IO
- Would need to maintain two communication channels or migrate entirely
- Socket.IO already handles reconnection, rooms, subscriptions

**Effort:** Medium (2 weeks) but adds architectural split

### Option C: LangChain Streaming Callbacks

**Implementation:** Keep LangChain, use callback handlers for streaming.

**Pros:**
- No migration needed

**Cons:**
- LangChain streaming uses callbacks, not async iterables — complex to bridge
- Limited event granularity compared to AI SDK fullStream
- No native tool lifecycle hooks

**Effort:** Medium but inferior result

## Recommendation

**Option A + AI SDK Data Stream Protocol format.** Socket.IO as transport (bidirectional, rooms, reconnection), but adopt AI SDK's [Data Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) event schema as the wire format for every event.

This gives us:
- **Battle-tested schema** — Vercel designed this for exactly our use case (streaming agentic responses with tools, reasoning, steps)
- **Future SSE fallback** — If we ever need SSE for lightweight clients, the format is already compatible
- **Frontend compatibility** — AI SDK's `useChat` and `UIMessage` parts model maps directly to our events
- **No custom protocol design** — We adopt a standard instead of inventing our own event names

---

## Stream Protocol Design: AI SDK Data Stream Format over Socket.IO

### Why Adopt the AI SDK Protocol Format

AI SDK's `toUIMessageStreamResponse()` produces a Data Stream Protocol — a sequence of typed JSON events over SSE. The protocol is well-designed:

- **Start/delta/end pattern** for text and reasoning (supports incremental rendering + cleanup)
- **Tool lifecycle** as 3 distinct events: `tool-input-start` → `tool-input-delta` → `tool-input-available` → `tool-output-available`
- **Step boundaries** (`start-step` / `finish-step`) for multi-step agent loops
- **Message lifecycle** (`start` → parts → `finish`) for clean message boundaries
- **Custom data parts** (`data-*` prefix) for app-specific events
- **Abort** for cancellation

We use the **exact same JSON payloads** — but emit them as Socket.IO events instead of SSE `data:` lines.

### Socket.IO Event: Single Channel, Typed Payloads

Instead of one Socket.IO event per part type (which bloats the event namespace), we use a **single `stream` event** with the protocol's `type` field for dispatch:

```typescript
// Backend emits:
socket.emit('stream', { type: 'start', messageId: 'msg_001' });
socket.emit('stream', { type: 'text-delta', id: 'msg_001', delta: 'Hello' });
socket.emit('stream', { type: 'tool-input-start', toolCallId: 'call_abc', toolName: 'search' });
socket.emit('stream', { type: 'finish' });

// Frontend handles:
socket.on('stream', (part: StreamPart) => {
  switch (part.type) {
    case 'text-delta': appendText(part.delta); break;
    case 'tool-input-start': showToolCard(part.toolName); break;
    // ...
  }
});
```

This matches how AI SDK's frontend processes the SSE stream — iterating parts and switching on `type`.

### Full Stream Part Schema

Adopted from AI SDK Data Stream Protocol v1, carried over Socket.IO:

#### Message Lifecycle

| Part Type | Payload | When |
|---|---|---|
| `start` | `{ type: "start", messageId: string }` | Beginning of a new message |
| `finish` | `{ type: "finish" }` | Message complete |
| `abort` | `{ type: "abort", reason?: string }` | Stream cancelled |

#### Text (start/delta/end pattern)

| Part Type | Payload | When |
|---|---|---|
| `text-start` | `{ type: "text-start", id: string }` | Text block begins |
| `text-delta` | `{ type: "text-delta", id: string, delta: string }` | Incremental text chunk |
| `text-end` | `{ type: "text-end", id: string }` | Text block complete |

#### Reasoning (start/delta/end pattern)

| Part Type | Payload | When |
|---|---|---|
| `reasoning-start` | `{ type: "reasoning-start", id: string }` | Reasoning block begins |
| `reasoning-delta` | `{ type: "reasoning-delta", id: string, delta: string }` | Incremental reasoning chunk |
| `reasoning-end` | `{ type: "reasoning-end", id: string }` | Reasoning block complete |

#### Tool Lifecycle (4-event sequence)

| Part Type | Payload | When |
|---|---|---|
| `tool-input-start` | `{ type: "tool-input-start", toolCallId: string, toolName: string }` | LLM starts generating tool call |
| `tool-input-delta` | `{ type: "tool-input-delta", toolCallId: string, inputTextDelta: string }` | Incremental tool args |
| `tool-input-available` | `{ type: "tool-input-available", toolCallId: string, toolName: string, input: object }` | Tool args complete, execution begins |
| `tool-output-available` | `{ type: "tool-output-available", toolCallId: string, output: object }` | Tool execution finished |

#### Steps

| Part Type | Payload | When |
|---|---|---|
| `start-step` | `{ type: "start-step" }` | New LLM call in agent loop |
| `finish-step` | `{ type: "finish-step" }` | LLM call complete |

#### Sources & Files

| Part Type | Payload | When |
|---|---|---|
| `source-url` | `{ type: "source-url", sourceId: string, url: string }` | External URL reference |
| `source-document` | `{ type: "source-document", sourceId: string, mediaType: string, title: string }` | Document reference |
| `file` | `{ type: "file", url: string, mediaType: string }` | File attachment |

#### Error

| Part Type | Payload | When |
|---|---|---|
| `error` | `{ type: "error", errorText: string }` | Agent error |

#### Ping-Specific Extensions: Tools First, Semantic Events for the Rest

##### The Key Insight: Most "Ping Events" Are Already Tool Calls

The planner and workers are AI SDK agents that call tools. AI SDK already streams tool calls with full lifecycle events (`tool-input-start` → `tool-input-delta` → `tool-input-available` → `tool-output-available`). When the planner calls `create_plan`, the plan IS the tool output. We don't need a separate `data-plan` stream part — the tool result already carries the plan.

```
❌ BEFORE: Invented data-* parts that duplicate tool calls

  Planner stream:
    → text-delta: "Here's the plan:"
    → data-plan: { planId, tasks... }        ← custom part (why?)
    → data-task: { id: "T-001"... }          ← custom part (why?)
    → data-risk: { overallRisk: "medium" }   ← custom part (why?)

  But the planner CALLED create_plan as a tool. The tool output
  already contains the plan, tasks, and risks. We're duplicating it.

✅ AFTER: Tool calls carry the structured data natively

  Planner stream:
    → text-delta: "Let me plan this out..."
    → tool-input-start: { toolCallId: "call_001", toolName: "create_plan" }
    → tool-input-delta: { inputTextDelta: '{"goal":"Build campaign"...' }
    → tool-input-available: { toolCallId: "call_001", toolName: "create_plan",
        input: { goal: "Build marketing campaign", audience: "B2B SaaS" } }
    → tool-output-available: { toolCallId: "call_001", output: {
        planId: "plan_001",
        strategy: "Research-first approach with parallel execution",
        tasks: [
          { id: "T-001", title: "Market Research", role: "researcher", deps: [] },
          { id: "T-002", title: "Competitive Analysis", role: "researcher", deps: [] },
          { id: "T-003", title: "Product Positioning", role: "strategist", deps: ["T-001","T-002"] },
          { id: "T-004", title: "Copy Writing", role: "writer", deps: ["T-003"] },
          { id: "T-005", title: "Visual Design", role: "designer", deps: ["T-003"] },
          { id: "T-006", title: "Landing Page", role: "developer", deps: ["T-004","T-005"] }
        ],
        risks: { overallRisk: "medium", items: [...], criticalPath: ["T-001","T-003","T-004","T-006"] }
      }}
    → text-delta: "T-001 and T-002 run in parallel. Critical path goes through Research → Positioning → Copy → Landing Page. Approve?"
    → finish
```

The frontend sees `toolName: "create_plan"` and renders an **interactive plan card** with the task tree, risk banner, and approve/modify/reject buttons. No custom `data-*` part needed — the tool output IS the structured data.

##### What the User Experiences (Ping's 6 Moments)

Ping's UX is a journey from goal to done. At each moment, the streaming protocol serves it differently:

```
MOMENT 1: PLANNING      → Tool calls (create_plan, replan, request_approval)
MOMENT 2: EXECUTION     → task-* events (task-started, task-completed, task-failed)
MOMENT 3: ARTIFACT       → Tool calls (present_artifact) + artifact-* (state changes)
MOMENT 4: COLLABORATION  → collab-* events (collab-turn, collab-outcome)
MOMENT 5: INTERRUPTIONS  → Tool calls (ask_user, request_approval, escalate)
MOMENT 6: COMPLETION     → Tool calls (summarize_goal) + system-* (knowledge-captured)
```

##### Where Things Appear (Chat vs Dashboard)

```
┌──────────────────┬──────────────────────────────────────────┐
│                  │                                           │
│   DASHBOARD      │   CHAT (the conversation)                │
│   (sidebar/      │                                           │
│    panels)       │   Tool calls render as RICH CARDS:        │
│                  │   - create_plan → interactive plan tree   │
│   Task states    │   - present_artifact → content preview    │
│   Worker health  │   - ask_user → question with options      │
│   Progress bars  │   - request_approval → approve buttons    │
│   Pending count  │                                           │
│                  │   Notification events render as CHIPS:    │
│   Updated by     │   - task-started/completed/failed          │
│   STANDALONE     │   - collab-turn, collab-outcome            │
│   events         │   - artifact-state changes                 │
│                  │                                           │
└──────────────────┴──────────────────────────────────────────┘
```

##### Tool Output Rendering: `toolName` Drives the UI

The frontend doesn't need 20 custom `data-*` types for structured content. It needs to know **which tool was called** and render accordingly:

| Tool Name | Who Calls It | Tool Output | Frontend Renders |
|---|---|---|---|
| `create_plan` | Planner | `{ planId, strategy, tasks[], risks }` | Interactive plan tree with task cards, dependency arrows, risk banner, approve/modify/reject buttons |
| `replan` | Planner | `{ planId, version, reason, changedTasks[], tasks[] }` | Updated plan card showing diffs from previous version |
| `get_status` | Planner | `{ total, completed, inProgress, failed, blocked, tasks[] }` | Execution progress card with task status chips |
| `get_blocked` | Planner | `{ tasks: [{ id, blockedBy, reason }] }` | Blocked tasks list with dependency info |
| `get_critical_path` | Planner | `{ taskIds[], estimatedRemaining }` | Critical path visualization |
| `request_approval` | Planner / Worker | `{ itemType, targetId, description, options[] }` | Approval card with action buttons |
| `ask_user` | Worker | `{ question, taskId, options[] }` | Question card with answer options |
| `present_artifact` | Worker / Orchestrator | `{ artifactId, name, content, mediaType }` | Rich preview (markdown, code, image, diff) |
| `escalate` | Planner | `{ severity, reason, suggestion, taskId }` | Warning/urgent banner with suggested actions |
| `summarize_goal` | Planner | `{ goalId, summary, duration, metrics }` | Completion card with metrics |

**The pattern:** The tool lifecycle events (`tool-input-start` → `tool-output-available`) carry the structured data. The `toolName` tells the frontend which rich card to render. No custom notification events needed for any of these.

##### Moment 1: Planning — Tool Calls Only

```
User: "Build a marketing campaign for product X"

Planner stream:
  → text-delta: "Let me understand your goal. What's your target audience?"
  
User: "B2B SaaS, mid-market"

Planner stream:
  → reasoning-delta: (analyzing requirements, decomposing goal...)
  → tool-input-start: { toolCallId: "call_001", toolName: "create_plan" }
  → tool-input-delta: { inputTextDelta: '{"goal":"Marketing campaign","audience":"B2B SaaS"...' }
  → tool-input-available: { toolCallId: "call_001", toolName: "create_plan",
      input: { goal: "Marketing campaign for product X", audience: "B2B SaaS, mid-market" } }

  (PlanBuilder agent runs internally, returns structured plan)

  → tool-output-available: { toolCallId: "call_001", output: {
      planId: "plan_001",
      strategy: "Research-first with parallel execution where possible",
      tasks: [
        { id: "T-001", title: "Market Research", role: "researcher", deps: [] },
        { id: "T-002", title: "Competitive Analysis", role: "researcher", deps: [] },
        { id: "T-003", title: "Product Positioning", role: "strategist", deps: ["T-001","T-002"] },
        { id: "T-004", title: "Copy Writing", role: "writer", deps: ["T-003"] },
        { id: "T-005", title: "Visual Design", role: "designer", deps: ["T-003"] },
        { id: "T-006", title: "Landing Page", role: "developer", deps: ["T-004","T-005"] }
      ],
      risks: {
        overallRisk: "medium",
        items: [{ description: "Rate limits on design API", probability: "medium", impact: "low", mitigation: "Batch requests" }],
        criticalPath: ["T-001","T-003","T-004","T-006"],
        parallelGroups: [["T-001","T-002"], ["T-004","T-005"]]
      }
    }}
  → text-delta: "T-001 and T-002 can run in parallel. The critical path is Research → Positioning → Copy → Landing Page. Shall I proceed?"
  → tool-input-start: { toolCallId: "call_002", toolName: "request_approval" }
  → tool-output-available: { toolCallId: "call_002", output: {
      itemType: "plan", targetId: "plan_001", options: ["approve", "modify", "reject"]
    }}
  → finish

Frontend sees:
  1. toolName "create_plan" → renders interactive plan card
  2. toolName "request_approval" → renders approve/modify/reject buttons
  3. Text explanation wraps around the cards naturally
```

##### Moment 2: Execution — `task-*` Events

After approval, execution is **system-driven** — the orchestrator dispatches tasks, workers start/finish. These aren't tool calls by any agent — they're asynchronous events the orchestrator pushes into the chat.

```
User approves plan.

Orchestrator pushes into chat:
  → start: { messageId: "msg_exec_001" }
  → text-delta: "Plan approved. Starting execution..."
  → task-started: { taskId: "T-001", role: "researcher", agent: "Market Researcher" }
  → task-started: { taskId: "T-002", role: "researcher", agent: "Competitive Analyst" }
  → finish

  ... workers execute ...

  → start: { messageId: "msg_exec_002" }
  → task-completed: { taskId: "T-001", summary: "Found 12 competitors, 3 direct threats" }
  → text-delta: "Research complete."
  → finish

  → start: { messageId: "msg_exec_003" }
  → task-completed: { taskId: "T-002", summary: "Top 3 competitor analysis with pricing" }
  → text-delta: "Competitive analysis done. Both research tasks complete — T-003 is unblocked."
  → task-started: { taskId: "T-003", role: "strategist", agent: "Product Strategist" }
  → finish
```

**Why `task-*` here (not tool calls):** No agent is "calling a tool" when a task starts or finishes. The orchestrator is narrating asynchronous events. These are genuine notifications — the system telling the user what happened.

| Event | Payload | Why Not a Tool Call |
|---|---|---|
| `task-started` | `{ taskId, role, agent }` | Orchestrator notification — no agent decides to "call" this |
| `task-completed` | `{ taskId, summary, artifactId? }` | Worker finished. Orchestrator informs the chat. |
| `task-failed` | `{ taskId, error, context?, suggestion? }` | Task failure notification. Planner may follow up with a replan tool call. |

##### Moment 3: Artifacts — Tool Calls for Presentation, `artifact-*` for State

When a worker produces an artifact, the orchestrator presents it via a tool call:

```
Worker "researcher" completes T-001, produces artifact.

Orchestrator (or planner) streams:
  → text-delta: "Market Research Report is ready for review."
  → tool-input-start: { toolCallId: "call_003", toolName: "present_artifact" }
  → tool-output-available: { toolCallId: "call_003", output: {
      artifactId: "art-001", name: "Market Research Report",
      mediaType: "text/markdown", content: "## Market Research\n\n### Competitors\n...",
      taskId: "T-001"
    }}
  → tool-input-start: { toolCallId: "call_004", toolName: "request_approval" }
  → tool-output-available: { toolCallId: "call_004", output: {
      itemType: "artifact", targetId: "art-001",
      options: ["approve", "request-changes", "reject"]
    }}
  → finish

User: "Approved, but add more detail on pricing"

Planner stream:
  → text-delta: "Approved with feedback. Passing to next tasks..."
  → artifact-state: { artifactId: "art-001", state: "approved", feedback: "Add more detail on pricing" }
  → task-started: { taskId: "T-003", role: "strategist", agent: "Product Strategist" }
  → finish
```

`present_artifact` is a tool call (rich content rendering). The state change (`approved`/`rejected`) is an `artifact-*` notification.

##### Moment 4: Collaboration — `collab-*` Events

Group chat turns are neither tool calls nor tool outputs. They're messages from other agents relayed through the orchestrator. Collaboration gets its own prefix:

```
Planner calls request_approval for collaboration:
  → tool-input-start: { toolCallId: "call_005", toolName: "request_approval" }
  → tool-output-available: { toolCallId: "call_005", output: {
      itemType: "collaboration", targetId: "gc-001",
      description: "Writer and Editor need to align on tone",
      participants: ["writer", "editor"],
      options: ["approve", "reject", "join"]
    }}

User: "Approve, I'll observe"

Group chat (collab-* events — relayed messages, not tool calls):
  → collab-turn: { sessionId: "gc-001", speaker: "writer", role: "writer",
      content: "Thinking formal for intro, casual for examples", turnNumber: 1 }
  → collab-turn: { sessionId: "gc-001", speaker: "editor", role: "editor",
      content: "Agree on intro. Casual throughout examples.", turnNumber: 2 }
  → collab-turn: { sessionId: "gc-001", speaker: "writer", role: "writer",
      content: "Deal. I'll draft, you review sections 2-3", turnNumber: 3 }
  → collab-outcome: { sessionId: "gc-001", status: "agreed",
      summary: "Formal intro, casual examples. Writer drafts, Editor reviews sections 2-3.",
      newTasks: ["T-007: Editor review sections 2-3"] }
```

##### Moment 5: Interruptions — Tool Calls

Workers asking questions and planners escalating are agent-initiated actions — tool calls:

```
Worker needs help:
  → tool-input-start: { toolCallId: "call_006", toolName: "ask_user" }
  → tool-output-available: { toolCallId: "call_006", output: {
      question: "Should the landing page use dark or light theme?",
      from: "developer", taskId: "T-006",
      options: ["dark", "light", "both"]
    }}

Planner escalates:
  → tool-input-start: { toolCallId: "call_007", toolName: "escalate" }
  → tool-output-available: { toolCallId: "call_007", output: {
      severity: "warning", taskId: "T-004",
      reason: "Copy writing taking longer than expected. 8 LLM cycles.",
      suggestion: "Simplify scope or add a second writer",
      options: ["continue", "simplify-scope", "add-resource", "abort-task"]
    }}

Task fails (notification + planner replan):
  → task-failed: { taskId: "T-005", error: "Design API 429: rate limit", context: "3 retries" }
  → tool-input-start: { toolCallId: "call_008", toolName: "replan" }
  → tool-output-available: { toolCallId: "call_008", output: {
      planId: "plan_001", version: 2, reason: "T-005 rate limited",
      changedTasks: ["T-005a", "T-005b"],
      tasks: [
        { id: "T-005a", title: "Visual Design - Icons", role: "designer", deps: ["T-003"] },
        { id: "T-005b", title: "Visual Design - Layout", role: "designer", deps: ["T-005a"] }
      ]
    }}
```

##### Moment 6: Completion — Tool Call for Summary

```
Planner stream:
  → tool-input-start: { toolCallId: "call_009", toolName: "summarize_goal" }
  → tool-output-available: { toolCallId: "call_009", output: {
      goalId: "goal_001",
      summary: "Marketing campaign ready for launch",
      duration: "2h 15m",
      tasksCompleted: 6,
      artifactsProduced: 5,
      artifacts: [
        { id: "art-001", name: "Market Research Report", type: "document" },
        { id: "art-002", name: "Product Positioning", type: "document" },
        { id: "art-003", name: "Marketing Copy", type: "document" },
        { id: "art-004", name: "Visual Design Pack", type: "image" },
        { id: "art-005", name: "Landing Page", type: "code" }
      ]
    }}
  → text-delta: "All artifacts approved and merged. Knowledge captured in L2."
  → system-knowledge-captured: { insights: 3, patterns: 1, l2DocsWritten: 8 }
  → finish
```

##### The Final Split: Tools vs `data-*` vs Standalone

Three layers, each with a clear purpose:

```
TOOL CALLS (AI SDK native — richest rendering):
  Agent-initiated, structured output, frontend renders rich cards by toolName.
  → create_plan, replan, get_status, get_blocked, get_critical_path
  → request_approval, ask_user, present_artifact, escalate, summarize_goal

NOTIFICATION EVENTS (semantic prefixes — lightweight inline):
  System-initiated or relay events. No agent "called" these.
  Each prefix tells you exactly what domain it belongs to:
  → task-started, task-completed, task-failed          (task lifecycle)
  → artifact-state                                     (artifact lifecycle)
  → collab-turn, collab-outcome                        (collaboration relay)
  → system-knowledge-captured                          (system events)

STANDALONE EVENTS (dashboard telemetry — background):
  Continuous signals. Not part of any message.
  → state, progress, heartbeat, watchdog:alert, worker:registered
```

| Layer | Count | Prefix | Purpose | Required? | Frontend Surface |
|---|---|---|---|---|---|
| **Tool calls** | ~10 | `tool-*` | Agent decisions with structured output | **Yes** — core UX | Rich interactive cards in chat |
| **Task events** | 3 | `task-*` | Task lifecycle notifications | **Yes** — execution visibility | Inline chips/banners in chat |
| **Artifact events** | 1 | `artifact-*` | Artifact state changes | **Yes** — approval workflow | State badges in chat |
| **Collaboration events** | 2 | `collab-*` | Agent discussion relay | **Optional** — only with group chat | Threaded bubbles in chat |
| **System events** | 1 | `system-*` | System-level notifications | **Optional** — nice-to-have | Summary badges |
| **Standalone events** | ~6 | (various) | Background telemetry | **Yes** — dashboard | Dashboard sidebar |

##### Frontend: Tool-Aware Rendering

```typescript
socket.on('stream', (part: StreamPart) => {
  switch (part.type) {
    // --- AI SDK standard parts ---
    case 'text-delta': appendText(part.delta); break;
    case 'reasoning-delta': appendReasoning(part.delta); break;

    // --- Tool lifecycle: render by toolName ---
    case 'tool-input-start':
      showToolCard(part.toolCallId, part.toolName, 'calling');
      break;

    case 'tool-output-available':
      renderToolResult(part.toolCallId, part.output);
      // renderToolResult dispatches by toolName:
      //   "create_plan"       → PlanCard with task tree, risk banner
      //   "replan"            → UpdatedPlanCard with diff
      //   "request_approval"  → ApprovalButtons (approve/modify/reject)
      //   "ask_user"          → QuestionCard with options
      //   "present_artifact"  → ArtifactPreview (markdown/code/image)
      //   "escalate"          → EscalationBanner (warning/urgent)
      //   "get_status"        → ProgressCard
      //   "summarize_goal"    → CompletionCard with metrics
      break;

    // --- task-* (execution lifecycle) ---
    case 'task-started':
      showInlineChip(`${part.agent} started ${part.taskId}`);
      break;
    case 'task-completed':
      showInlineChip(`${part.taskId} complete: ${part.summary}`);
      break;
    case 'task-failed':
      showFailureCard(part.taskId, part.error);
      break;

    // --- artifact-* (artifact lifecycle) ---
    case 'artifact-state':
      showArtifactBadge(part.artifactId, part.state);
      break;

    // --- collab-* (collaboration relay) ---
    case 'collab-turn':
      showCollaborationBubble(part.sessionId, part.speaker, part.content);
      break;
    case 'collab-outcome':
      showOutcomeBanner(part.sessionId, part.status, part.summary);
      break;

    // --- system-* (system events) ---
    case 'system-knowledge-captured':
      showKnowledgeBadge(part.insights, part.patterns);
      break;

    case 'finish': finalizeMessage(); break;
  }
});
```

##### Why This Is Better

| Concern | Before (21 `data-*` parts) | After (tools + 7 semantic events) |
|---|---|---|
| **Plan rendering** | Custom `data-plan` + `data-task` + `data-risk` parts | `create_plan` tool output — one object, one render |
| **Approval UI** | Custom `data-decision-required` with 8 decision types | `request_approval` tool — one tool, one card |
| **Questions** | Custom `data-question` part | `ask_user` tool — native tool lifecycle |
| **Artifact preview** | Custom `data-artifact-view` part | `present_artifact` tool output |
| **Escalation** | Custom `data-escalation` part | `escalate` tool output |
| **Status query** | Custom `data-execution-progress` etc. | `get_status` / `get_blocked` tool outputs |
| **Protocol compliance** | Custom format, must document each | AI SDK tool events, already standardized |
| **Frontend complexity** | 21 type-specific handlers | ~10 tool renderers + 7 notification handlers |
| **Naming** | Generic `data-*` — tells you nothing | Semantic prefixes — `task-*`, `artifact-*`, `collab-*`, `system-*` |
| **Required vs optional** | All look the same | Prefix tells you: `task-*` required, `collab-*` optional |

**The principle: Don't invent stream parts for what tools already express.** AI SDK gave us a rich tool lifecycle protocol. Use it. Reserve notification events (`task-*`, `artifact-*`, `collab-*`, `system-*`) for the few things that are genuinely system-initiated — task state changes, collaboration relay, and knowledge events.

### TypeScript Types

```typescript
// Core stream parts — matches AI SDK Data Stream Protocol v1
type StreamPart =
  // Message lifecycle
  | { type: 'start'; messageId: string }
  | { type: 'finish' }
  | { type: 'abort'; reason?: string }

  // Text
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }

  // Reasoning
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }

  // Tool lifecycle (carries structured data: plans, artifacts, approvals, questions)
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool-output-available'; toolCallId: string; output: Record<string, unknown> }

  // Steps
  | { type: 'start-step' }
  | { type: 'finish-step' }

  // Sources & files
  | { type: 'source-url'; sourceId: string; url: string }
  | { type: 'source-document'; sourceId: string; mediaType: string; title: string }
  | { type: 'file'; url: string; mediaType: string }

  // Error
  | { type: 'error'; errorText: string }

  // ── Ping notification events (semantic prefixes, system-initiated) ──

  // task-* : Task lifecycle (orchestrator pushes these — REQUIRED for execution visibility)
  | { type: 'task-started'; taskId: string; role: string; agent: string }
  | { type: 'task-completed'; taskId: string; summary: string; artifactId?: string }
  | { type: 'task-failed'; taskId: string; error: string; context?: string; suggestion?: string }

  // artifact-* : Artifact state changes (REQUIRED for approval workflow)
  | { type: 'artifact-state'; artifactId: string; state: 'approved' | 'rejected' | 'changes-requested'; feedback?: string }

  // collab-* : Collaboration relay (OPTIONAL — only when group chat is enabled)
  | { type: 'collab-turn'; sessionId: string; speaker: string; role: string; content: string; turnNumber: number }
  | { type: 'collab-outcome'; sessionId: string; status: 'agreed' | 'partial' | 'no_agreement'; summary: string; newTasks?: string[] }

  // system-* : System-level notifications (OPTIONAL — nice-to-have)
  | { type: 'system-knowledge-captured'; insights: number; patterns: number; l2DocsWritten: number };

// ── Tool output schemas (frontend renders rich cards by toolName) ──

interface PlanToolOutput {
  planId: string;
  strategy: string;
  tasks: Array<{ id: string; title: string; description: string; role: string; deps: string[]; acceptanceCriteria?: string }>;
  risks: { overallRisk: string; items: Array<{ description: string; probability: string; impact: string; mitigation: string }>; criticalPath: string[]; parallelGroups?: string[][] };
}

interface ReplanToolOutput extends PlanToolOutput {
  version: number;
  reason: string;
  changedTasks: string[];
}

interface ApprovalToolOutput {
  itemType: 'plan' | 'artifact' | 'merge' | 'collaboration' | 'action';
  targetId: string;
  description?: string;
  options: string[];
}

interface AskUserToolOutput {
  question: string;
  from: string;
  taskId: string;
  options?: string[];
}

interface PresentArtifactToolOutput {
  artifactId: string;
  name: string;
  content: string;
  mediaType: string;
  taskId: string;
  diffFrom?: string;
}

interface EscalateToolOutput {
  severity: 'warning' | 'urgent';
  reason: string;
  suggestion?: string;
  taskId?: string;
  options: string[];
}

interface SummarizeGoalToolOutput {
  goalId: string;
  summary: string;
  duration: string;
  tasksCompleted: number;
  artifactsProduced: number;
  artifacts: Array<{ id: string; name: string; type: string }>;
}

interface StatusToolOutput {
  total: number;
  completed: number;
  inProgress: number;
  failed: number;
  blocked: number;
  tasks: Array<{ id: string; title: string; status: string; role: string }>;
}

// Map of toolName → output type for typed rendering
interface PingToolOutputs {
  create_plan: PlanToolOutput;
  replan: ReplanToolOutput;
  request_approval: ApprovalToolOutput;
  ask_user: AskUserToolOutput;
  present_artifact: PresentArtifactToolOutput;
  escalate: EscalateToolOutput;
  summarize_goal: SummarizeGoalToolOutput;
  get_status: StatusToolOutput;
  get_blocked: { tasks: Array<{ id: string; blockedBy: string; reason: string }> };
  get_critical_path: { taskIds: string[]; estimatedRemaining: string };
}

// Standalone events — dashboard/telemetry, NOT part of any message stream
interface StandaloneEvents {
  state: OrchestratorState;
  progress: { taskId: string; status: string; role: string };
  heartbeat: { workerId: string; taskId: string; progress: string; mode: string };
  'watchdog:alert': { alertType: 'dead' | 'stalled' | 'runaway' | 'stale-plan'; workerId?: string; taskId?: string; detail: string };
  'worker:registered': { role: string; workerId: string };
  'execution:complete': { goalId: string; summary: string };
}
```

### Backend Bridge: `fullStream` → Socket.IO

```typescript
// In InternalAgent or WorkerPool — the bridge between AI SDK and Socket.IO
async function streamToSocket(
  result: StreamTextResult,
  socket: SocketIO.Server,
  room: string,
  messageId: string,
): Promise<string> {
  // Emit message start
  socket.to(room).emit('stream', { type: 'start', messageId });

  let fullText = '';

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        socket.to(room).emit('stream', {
          type: 'text-delta',
          id: messageId,
          delta: part.textDelta,
        });
        fullText += part.textDelta;
        break;

      case 'reasoning':
        socket.to(room).emit('stream', {
          type: 'reasoning-delta',
          id: messageId,
          delta: part.textDelta,
        });
        break;

      case 'tool-call':
        // AI SDK fullStream gives the complete tool call after streaming
        socket.to(room).emit('stream', {
          type: 'tool-input-available',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.args,
        });
        break;

      case 'tool-result':
        socket.to(room).emit('stream', {
          type: 'tool-output-available',
          toolCallId: part.toolCallId,
          output: part.result,
        });
        break;

      case 'step-start':
        socket.to(room).emit('stream', { type: 'start-step' });
        break;

      case 'step-finish':
        socket.to(room).emit('stream', { type: 'finish-step' });
        break;

      case 'error':
        socket.to(room).emit('stream', {
          type: 'error',
          errorText: String(part.error),
        });
        break;
    }
  }

  // Emit message finish
  socket.to(room).emit('stream', { type: 'finish' });
  return fullText;
}
```

### Frontend: Stream Part Renderer

The frontend processes the single `stream` event, matching AI SDK's `UIMessage` parts model:

```typescript
// Accumulator — builds UIMessage-compatible parts from stream events
interface StreamState {
  messageId: string | null;
  parts: UIMessagePart[];          // text, reasoning, tool-invocation, etc.
  activeTextId: string | null;
  activeReasoningId: string | null;
  activeTools: Map<string, ToolState>;
}

socket.on('stream', (part: StreamPart) => {
  switch (part.type) {
    case 'start':
      initMessage(part.messageId);
      break;

    case 'text-delta':
      appendToTextPart(part.id, part.delta);   // renders incrementally
      break;

    case 'reasoning-delta':
      appendToReasoningPart(part.id, part.delta);
      break;

    case 'tool-input-start':
      addToolCard(part.toolCallId, part.toolName, 'calling');
      break;

    case 'tool-input-delta':
      appendToolArgs(part.toolCallId, part.inputTextDelta);
      break;

    case 'tool-input-available':
      updateToolCard(part.toolCallId, 'executing', part.input);
      break;

    case 'tool-output-available':
      updateToolCard(part.toolCallId, 'complete', part.output);
      break;

    case 'error':
      showError(part.errorText);
      break;

    case 'finish':
      finalizeMessage();
      break;

    default:
      // Notification events dispatch by prefix
      if (part.type.startsWith('task-')) handleTaskEvent(part);
      else if (part.type.startsWith('artifact-')) handleArtifactEvent(part);
      else if (part.type.startsWith('collab-')) handleCollabEvent(part);
      else if (part.type.startsWith('system-')) handleSystemEvent(part);
  }
});
```

### Why Single `stream` Event (Not Per-Type Events)

| Approach | Pros | Cons |
|---|---|---|
| **Single `stream` event** (chosen) | One listener, one handler. Matches AI SDK's protocol iteration pattern. Easy to log/intercept all parts. Trivial to add new part types (`data-*`) without new listeners. | Switch statement in handler |
| **Per-type events** (`stream:text`, `stream:tool-call`, etc.) | Explicit event names. Each component subscribes to just what it needs. | Event namespace bloat. Must register/unregister N listeners. Adding a new part type requires a new event + listener. Harder to log all parts centrally. |

The single-event approach mirrors how AI SDK processes the SSE stream — one iterable, switch on `type`. It's simpler and more extensible.

### Smooth Streaming

AI SDK provides `smoothStream()` — a transform that chunks text deltas into word-boundary groups for smoother UX (avoids single-character jitter). We can apply this server-side before emitting:

```typescript
import { streamText, smoothStream } from 'ai';

const result = streamText({
  model,
  messages,
  experimental_transform: smoothStream(),  // word-boundary chunking
});

// fullStream now yields smoother text-delta events
for await (const part of result.fullStream) { /* ... */ }
```

Or client-side as a post-processor on the `text-delta` events.

---

## Stream Event Schema Summary (Option A + AI SDK Protocol)

### Three Layers of Events

**Layer 1: AI SDK Core Parts** (standard streaming protocol)

| Part Type | Frontend Renders |
|---|---|
| `start` / `finish` / `abort` | Message lifecycle |
| `text-start` / `text-delta` / `text-end` | Incremental text |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | Collapsible thinking section |
| `tool-input-start` / `tool-input-delta` / `tool-input-available` | Tool card: calling → streaming args → executing |
| `tool-output-available` | Tool result → **rendered by `toolName`** (see below) |
| `start-step` / `finish-step` | Step indicator |
| `source-url` / `source-document` / `file` | Citations, file previews |
| `error` | Error display |

**Layer 2: Tool Output Rendering** (frontend renders rich cards by `toolName`)

| Tool Name | Output Becomes | Rich Card |
|---|---|---|
| `create_plan` | Plan + tasks + risks | Interactive plan tree, risk banner, approve buttons |
| `replan` | Updated plan + diffs | Plan card showing what changed |
| `request_approval` | Approval request | Action buttons (approve/modify/reject) |
| `ask_user` | Question + options | Question card with answer options |
| `present_artifact` | Artifact content | Rich preview (markdown/code/image/diff) |
| `escalate` | Warning + suggestion | Escalation banner with action options |
| `summarize_goal` | Goal summary + metrics | Completion card |
| `get_status` | Execution progress | Status card with task chips |
| `get_blocked` | Blocked tasks | Blocked list with dependency info |
| `get_critical_path` | Critical path | Path visualization |

**Layer 3: Ping Notification Events** (semantic prefixes — 7 types, grouped by domain)

| Prefix | Event | Required? | Frontend Renders |
|---|---|---|---|
| `task-*` | `task-started` | **Yes** | Inline chip: "Agent started task" |
| | `task-completed` | **Yes** | Completion chip with summary |
| | `task-failed` | **Yes** | Failure card with context |
| `artifact-*` | `artifact-state` | **Yes** | Approved/rejected/changes badge |
| `collab-*` | `collab-turn` | Optional | Speaker bubble in threaded view |
| | `collab-outcome` | Optional | Outcome banner |
| `system-*` | `system-knowledge-captured` | Optional | Knowledge summary badge |

**Layer 4: Standalone Events** (dashboard telemetry — NOT in chat)

| Socket Event | Dashboard Surface |
|---|---|
| `state` | Full dashboard refresh |
| `progress` | Task status panel |
| `heartbeat` | Worker health indicators |
| `watchdog:alert` | System health banner |
| `worker:registered` | Agent roster |
| `execution:complete` | Goal status badge |

## Key Files to Modify

- `packages/backend/agent/internal/InternalAgent.ts` — replace `executeToolMode` with `streamText` + `fullStream` iteration
- `packages/backend/agent/BaseAgent.ts` — new `StreamPart` type union
- `packages/backend/api/SocketServerV2.ts` — `streamToSocket` bridge function
- `packages/backend/services/WorkerPool.ts` — propagate stream events per worker room
- `packages/frontend/types.ts` — `StreamPart` type, `StreamState` accumulator
- `packages/frontend/components/ChatArea/` — stream part renderer (text, tool cards, reasoning)
- `packages/frontend/services/AgentServiceV2.ts` — single `stream` event listener + dispatch
