# Frontend Phase 2: Streaming & Live Experience — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**Phase:** 2  
**Depends on:** Phase 1 (refactored frontend), Agentic Streaming (A2), AI SDK Migration (A1)

---

## Overview

Transform the chat from "submit and wait for a blob" to "watch agents think and work in real-time." Process the single `stream` Socket.IO event, render text token-by-token, show tool calls as expandable cards, display reasoning in collapsible sections, and render Ping notification events as inline chips.

### Current State
- `onProgress()` events received but **never rendered** — UI ignores them
- `onOutput()` events received but **not rendered** — invisible to user
- Messages arrive as complete blobs — no incremental rendering
- No tool call visualization
- No reasoning/thinking display

### Target State
- Token-by-token text streaming
- Tool call cards with lifecycle (calling → args streaming → executing → result)
- Collapsible reasoning sections
- Ping notification chips (`task-started`, `task-completed`, `task-failed`)
- Artifact preview cards rendered inline by `toolName`
- Smooth text delivery (word-boundary chunking)

---

## Stream Renderer Architecture

### Single Event, Switch on Type

All streaming comes through one Socket.IO event: `stream`. Frontend switches on `part.type`:

```typescript
// hooks/useStreamRenderer.ts
function useStreamRenderer() {
  const [streamState, setStreamState] = useState<StreamState>({
    messageId: null,
    parts: [],
    activeTextId: null,
    activeTools: new Map(),
  });

  useEffect(() => {
    socket.on('stream', (part: StreamPart) => {
      setStreamState(prev => processStreamPart(prev, part));
    });
    return () => socket.off('stream');
  }, [socket]);

  return streamState;
}
```

### Stream State Accumulator

```typescript
interface StreamState {
  messageId: string | null;
  parts: RenderedPart[];           // Ordered list of rendered parts
  activeTextId: string | null;     // Currently streaming text block
  activeReasoningId: string | null;
  activeTools: Map<string, ToolCardState>;
}

type RenderedPart =
  | { type: 'text'; id: string; content: string }
  | { type: 'reasoning'; id: string; content: string; collapsed: boolean }
  | { type: 'tool-card'; toolCallId: string; toolName: string; state: ToolCardState }
  | { type: 'notification'; notificationType: string; data: any }
  | { type: 'error'; text: string };

interface ToolCardState {
  toolName: string;
  status: 'calling' | 'streaming-args' | 'executing' | 'complete' | 'error';
  input?: Record<string, unknown>;
  inputText?: string;              // Streaming args text
  output?: Record<string, unknown>;
}
```

---

## Components

### StreamMessage

The container that renders a streaming message — replaces the current flat text bubble:

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 Planner                                                  │
│                                                              │
│ Let me plan this out...                          ← text     │
│                                                              │
│ ▶ Thinking... (click to expand)                  ← reasoning│
│   Analyzing requirements, considering 3 approaches...       │
│                                                              │
│ ┌─ 🔧 create_plan ─────────────────────────────┐ ← tool   │
│ │ Status: ✅ Complete                            │           │
│ │ Input: { goal: "Marketing campaign", ... }     │           │
│ │ ▶ Output (click to expand)                     │           │
│ │   { planId: "plan_001", tasks: [...] }         │           │
│ └────────────────────────────────────────────────┘           │
│                                                              │
│ Here's the plan with 6 tasks. T-001 and T-002    ← text    │
│ can run in parallel...                                       │
│                                                              │
│ ┌─ 🔧 request_approval ────────────────────────┐ ← tool   │
│ │ [✓ Approve]  [✏️ Modify]  [✕ Reject]          │           │
│ └────────────────────────────────────────────────┘           │
│                                                              │
│ 🟢 T-001 started (researcher)                    ← notif   │
│ 🟢 T-002 started (researcher)                    ← notif   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### ToolCard

Renders differently based on `toolName`:

| `toolName` | Renders As |
|---|---|
| `create_plan` | Interactive plan tree with tasks, deps, risk banner |
| `replan` | Updated plan card showing diffs |
| `request_approval` | Action buttons (approve/modify/reject) |
| `ask_user` | Question card with answer options |
| `present_artifact` | Rich preview (markdown/code/image) |
| `escalate` | Warning/urgent banner with actions |
| `get_status` | Execution progress card |
| `summarize_goal` | Completion card with metrics |
| (default) | Generic tool card with input/output JSON |

```typescript
function ToolCard({ toolCallId, toolName, state }: ToolCardProps) {
  // Render by toolName
  switch (toolName) {
    case 'create_plan':
      return <PlanCard plan={state.output} status={state.status} />;
    case 'request_approval':
      return <ApprovalButtons options={state.output?.options} onAction={handleAction} />;
    case 'present_artifact':
      return <ArtifactPreview artifact={state.output} />;
    default:
      return <GenericToolCard {...state} />;
  }
}
```

### ReasoningSection

Collapsible "thinking" block:

```
▶ Thinking...                          ← collapsed (default)

▼ Thinking...                          ← expanded
  Analyzing the goal: user wants a marketing campaign.
  Need roles: researcher, writer, designer, developer.
  Research should come first to inform positioning.
  Writer and designer can work in parallel after positioning...
```

### NotificationChip

Inline chips for `task-*`, `artifact-*`, `collab-*` events:

```
🟢 Market Researcher started T-001          ← task-started
✅ T-001 complete: "Found 12 competitors"    ← task-completed  
❌ T-005 failed: "API rate limit"            ← task-failed
📄 Research Report approved                   ← artifact-state
💬 Writer & Editor agreed on tone             ← collab-outcome
```

### ArtifactPreview

Renders artifact content by media type:

| Media Type | Renderer |
|---|---|
| `text/markdown` | Markdown renderer (react-markdown) |
| `application/typescript`, `text/javascript` | Syntax-highlighted code block |
| `image/png`, `image/jpeg` | Image with zoom |
| `text/csv` | Table view |
| (default) | Raw text with download link |

### SkillSelector

In agent settings — pick which skills an agent has:

```
┌─────────────────────────────────────────────┐
│ Agent: Market Researcher                     │
│                                              │
│ Skills:                                      │
│  ✅ web-search          (default for role)   │
│  ✅ read-url            (default for role)   │
│  ✅ summarize           (default for role)   │
│  ☐  academic-search    (available)           │
│  ☐  data-analysis      (available)           │
│                                              │
│  [+ Browse skill catalog]                    │
└─────────────────────────────────────────────┘
```

---

## Implementation Checklist

| Component | Status | Effort |
|---|---|---|
| `useStreamRenderer` hook | ❌ | 2 days |
| `StreamMessage` component | ❌ | 2 days |
| `ToolCard` component (generic) | ❌ | 1 day |
| `PlanCard` (for `create_plan` tool) | ❌ | 2 days |
| `ApprovalButtons` (for `request_approval`) | ❌ | 1 day |
| `ArtifactPreview` (by media type) | ❌ | 2 days |
| `ReasoningSection` (collapsible) | ❌ | 0.5 day |
| `NotificationChip` (task/artifact/collab) | ❌ | 1 day |
| `SkillSelector` component | ❌ | 1-2 days |
| Smooth text streaming (word boundary) | ❌ | 0.5 day |
| Wire `stream` event to renderer | ❌ | 1 day |

**Total effort:** ~12-15 days frontend work (parallel with backend Phase 2)
