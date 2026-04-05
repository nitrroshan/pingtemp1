# Sub-Agent Protocol — Direct Streaming, Human-in-the-Loop, External Agents

**Status:** Draft  
**Date:** April 6, 2026  
**Parent:** [A10 — Persistent Agents & Three-Layer Hierarchy](feature_architecture.md)  
**Refines:** Sections 6 (Task Sub-Agents), 7 (Communication Model), and adds External Agent support

---

## Table of Contents

1. [Summary of Refinements](#1-summary-of-refinements)
2. [Direct Sub-Agent Streaming](#2-direct-sub-agent-streaming)
3. [Human-in-the-Loop: ask_user](#3-human-in-the-loop-ask_user)
4. [User Pinging Sub-Agents](#4-user-pinging-sub-agents)
5. [External Agents as Sub-Agents](#5-external-agents-as-sub-agents)
6. [SubAgentAdapter Interface](#6-subagentadapter-interface)
7. [Adapter Implementations](#7-adapter-implementations)
8. [Context Delivery to External Agents](#8-context-delivery-to-external-agents)
9. [Two-Channel Communication Model](#9-two-channel-communication-model)
10. [Frontend Impact](#10-frontend-impact)
11. [Architecture Options](#11-architecture-options)
12. [Team Stacking Integration (B3 Alignment)](#12-team-stacking-integration-b3-alignment)
13. [Open Decisions](#13-open-decisions)

---

## 1. Summary of Refinements

The parent doc (A10) describes a three-layer hierarchy where sub-agents `yield` through the parent chat agent to reach the UI. After review, three refinements improve this design:

| Refinement | What Changes | Why |
|---|---|---|
| **Direct streaming** | Sub-agents stream directly to UI via Socket.IO, bypassing the parent chat agent | Parent was just proxying bytes — wasted latency, unnecessary coupling |
| **Human-in-the-loop** | Sub-agents can pause and ask users questions directly via `ask_user` tool | Tasks need user input at decision points without going through chat agent |
| **User pinging** | Users can send messages to running sub-agents at any time (ping, redirect, cancel) | Users need to course-correct, add context, or redirect sub-agents mid-execution |
| **External agents** | Sub-agents can be ANY agent (Claude, OpenClaw, Copilot CLI, etc.) via a universal adapter interface | Future-proofs task execution; unifies internal and external agent invocation |

---

## 2. Direct Sub-Agent Streaming

### The Problem with Yield-Through-Parent

The original A10 design routes sub-agent output through the parent chat agent:

```
Sub-agent → yield → Chat Agent (LLM waiting) → Socket.IO → UI
```

The parent chat agent is an LLM call that's *waiting* on the sub-agent tool. It's not doing anything useful — just forwarding bytes. That's wasted latency and unnecessary coupling.

### The Better Design: Direct Streaming

Sub-agents get their own **stream channel** (Socket.IO room) and emit directly to the UI:

```
Sub-agent ──stream──→ Socket.IO → UI         (live tokens, tool calls, questions)
                │
                └──summary──→ Chat Agent      (only the final result, ~2k tokens)
```

The parent chat agent **never sees** the 100k tokens of workspace exploration. It only receives a summary string when the sub-agent completes.

### Why This Is Not a New Pattern

This is how the **current WorkerPool already works** — workers stream via `worker:stream` directly to Socket.IO. The direct streaming model preserves what already works rather than adding a proxy layer.

### Stream Channel Keying

Each sub-agent gets a unique stream channel:

```
Channel format: stream:{teamId}:{goalId}:{taskId}
Example:        stream:team-001:goal-005:T-003
```

The frontend subscribes to this channel when viewing task execution. When the task completes, the channel is cleaned up.

### What the Parent Gets

When the sub-agent finishes, the chat agent receives a `SubAgentResult`:

```typescript
type SubAgentResult = {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary: string;       // ~2k tokens — what was done
  artifacts?: string[];  // files created/modified, branches, etc.
  output?: string;       // structured output if applicable
};
```

This is ALL the parent sees. The full execution trace (100k+ tokens) is only in the stream channel and optionally persisted in an execution log.

---

## 3. Human-in-the-Loop: ask_user

### The Requirement

Sub-agents work autonomously but sometimes need user input:
- "Should I use Passport.js or custom JWT middleware?"
- "This file has 500 lines — should I refactor it first?"
- "The test suite has 3 failures. Fix them or skip?"

### How It Works

```
Sub-agent working autonomously...
  │
  │ Hits a decision point
  │ Calls ask_user tool
  │
  ├── Emits to stream channel:
  │   {
  │     type: 'ask_user',
  │     questionId: 'q-001',
  │     question: 'Passport.js or custom JWT?',
  │     options: ['Passport.js', 'Custom JWT'],
  │     default: 'Passport.js',
  │     timeout: 60000
  │   }
  │
  ├── UI shows question inline in the task execution panel
  │   User clicks "Passport.js"
  │
  ├── Socket.IO sends answer back:
  │   { questionId: 'q-001', answer: 'Passport.js' }
  │
  └── Sub-agent RESUMES with answer
      Continues execution with Passport.js approach
```

The question goes **directly to the UI** through the task stream channel. The parent chat agent is not involved.

### Two Modes

| Mode | Behavior | Use Case |
|---|---|---|
| **Auto mode** | Sub-agent waits for `timeout` ms. If no answer, uses `default` value. Logs the auto-decision. | Background tasks, batch execution, user not watching |
| **Interactive mode** | Sub-agent blocks indefinitely until user answers. No timeout. | User is actively watching the task, high-stakes decisions |

Mode is set per-task when the sub-agent is spawned.

### ask_user Tool Definition

```typescript
const askUserTool = tool({
  description: 'Ask the user a question and wait for their answer. Use when you need input on a decision.',
  parameters: z.object({
    question: z.string().describe('The question to ask the user'),
    options: z.array(z.string()).optional().describe('Predefined answer options'),
    default: z.string().optional().describe('Default answer if user does not respond in time (auto mode)'),
    context: z.string().optional().describe('Why you are asking this question'),
  }),
  execute: async ({ question, options, default: defaultAnswer, context }, { abortSignal }) => {
    const questionId = generateId();

    // Emit question to stream channel → UI
    streamChannel.emit({
      type: 'ask_user',
      questionId,
      question,
      options,
      default: defaultAnswer,
      context,
    });

    // Wait for answer (respects mode + timeout)
    const answer = await waitForAnswer(questionId, {
      mode: taskConfig.mode,         // 'auto' | 'interactive'
      timeout: taskConfig.askTimeout, // e.g., 60_000ms
      default: defaultAnswer,
      abortSignal,
    });

    return `User answered: "${answer}"`;
  },
});
```

### What Happens When User Doesn't Answer (Auto Mode)

```
1. Sub-agent calls ask_user with default: "Passport.js"
2. Question appears in UI
3. 60 seconds pass... no answer
4. ask_user resolves with "Passport.js" (the default)
5. Sub-agent logs: "Auto-decided: Passport.js (user timeout after 60s)"
6. UI shows: "⏱ Auto-decided: Passport.js"
7. Execution continues
```

The user can scroll back and see what was auto-decided. If they disagree, they can interrupt the task or discuss with the chat agent after completion.

---

## 4. User Pinging Sub-Agents

### The Problem

`ask_user` is agent-initiated — the sub-agent decides when to ask. But sometimes the **user** wants to proactively message a running sub-agent:
- "Hey, make sure you use Zod for validation"
- "Skip the tests for now, just get the endpoint working"
- "Stop — wrong approach. Use Passport.js instead of custom JWT"

The sub-agent needs to see these messages without breaking its execution flow.

### Three Levels of User → Sub-Agent Communication

| Level | What | When Sub-Agent Sees It | Urgency |
|---|---|---|---|
| **Answer** | Reply to `ask_user` question | Immediately (resolves Promise) | Synchronous — agent is already waiting |
| **Ping** | Proactive message from user | At next step boundary (between tool calls) | Low — advisory, agent continues its approach |
| **Redirect** | "Stop what you're doing and do X" | Aborts current step, injected before next step | High — changes the agent's direction |

### How Ping Works

AI SDK's `streamText()` is a single prompt → response cycle with tool loops. You can't inject a message mid-token-generation. But you CAN inject **between steps**.

```
Sub-agent working on step 3 of 10...
  │
  │ User sends: "Hey, make sure you use Zod for validation"
  │   → Message queued in sub-agent's inbox
  │
  │ Step 3 completes (tool call finishes)
  │
  │ Before step 4 starts:
  │   → Check inbox → found message
  │   → Inject into conversation: "User message: make sure you use Zod for validation"
  │
  │ Step 4 now runs with awareness of user's message
  │ Sub-agent: "Got it, switching to Zod validation..."
```

The sub-agent sees user pings at **natural breakpoints** — between tool calls, not mid-generation. This is safe and doesn't corrupt the streaming state.

### How Redirect Works

Redirect is a stronger signal — it aborts the current step and forces re-evaluation:

```
Sub-agent generating step 5 response...
  │
  │ User sends redirect: "Wrong approach. Use Express not Fastify."
  │   → AbortController.abort() on current streamText() call
  │   → Current step cancelled
  │   → New AbortController created
  │   → Redirect message injected as high-priority user message
  │
  │ Step 5 (restarted) sees:
  │   "[REDIRECT - User changed direction]: Wrong approach. Use Express not Fastify."
  │
  │ Sub-agent: "Understood, switching to Express. Let me undo the Fastify setup..."
```

### Implementation: Message Queue Between Steps

```typescript
class AiSdkSubAgent implements SubAgentAdapter {
  private messageQueue: Array<{ type: 'ping' | 'redirect'; message: string }> = [];
  private abortController = new AbortController();

  send(message: SubAgentMessage) {
    if (message.type === 'ping') {
      // Queue for injection at next step boundary
      this.messageQueue.push({ type: 'ping', message: message.message });
    } else if (message.type === 'redirect') {
      // Abort current step + queue redirect
      this.abortController.abort();
      this.abortController = new AbortController();
      this.messageQueue.unshift({ type: 'redirect', message: message.message });
    }
  }

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    const messages: CoreMessage[] = [
      { role: 'user', content: task.instructions }
    ];

    // Multi-step loop (manual control for ping support)
    for (let step = 0; step < (task.maxSteps ?? 10); step++) {

      // Check for user pings/redirects BETWEEN steps
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        const prefix = msg.type === 'redirect'
          ? '[REDIRECT - User changed direction]'
          : '[User message]';
        messages.push({ role: 'user', content: `${prefix}: ${msg.message}` });
        yield { type: 'progress', message: `User ${msg.type}: ${msg.message}` };
      }

      // Run one step with current abort controller
      try {
        const result = await streamText({
          model: this.model,
          messages,
          tools: this.tools,
          maxSteps: 1,  // single step for ping support
          abortSignal: this.abortController.signal,
        });

        // Yield stream parts to UI
        for await (const part of result.fullStream) {
          yield { type: 'stream_part', part };
        }

        // Append assistant response to conversation
        messages.push(...result.response.messages);

        // Check if agent is done (no more tool calls)
        if (!result.toolCalls?.length) break;
      } catch (err) {
        if (err.name === 'AbortError') {
          // Step was aborted by redirect — loop continues, redirect message is queued
          yield { type: 'progress', message: 'Step aborted — processing redirect...' };
          continue;
        }
        throw err;
      }
    }
  }
}
```

### What the User Sees

```
┌─ Active Task: T-003 ──────────────────── [auto] ──────────┐
│                                                             │
│ Creating /api/auth/login endpoint...                        │
│ Using Express with custom validation...                     │
│                                                             │
│ ┌─ You pinged ──────────────────────────────────────────┐  │
│ │ "Hey, make sure you use Zod for validation"           │  │
│ └───────────────────────────────────────────────────────┘  │
│                                                             │
│ Got it! Switching to Zod for request validation.            │
│ Installing zod package...                                   │
│ Updating /api/auth/login with z.object() schema...          │
│                                                             │
│ ┌─ You redirected ──────────────────────────────────────┐  │
│ │ "Stop — use Passport.js instead of custom auth"       │  │
│ └───────────────────────────────────────────────────────┘  │
│                                                             │
│ ⚡ Aborting current approach...                              │
│ Understood. Switching to Passport.js for authentication.    │
│ Removing custom JWT middleware...                           │
│                                                             │
│ [Type a message to this task agent...]           [⏸ Pause]  │
└─────────────────────────────────────────────────────────────┘
```

The task panel has its own **input field** — separate from the chat input. Messages typed here are sent to the sub-agent via the task stream channel.

### Ping vs Chat — When to Use Which

| | Chat (with Chat Agent) | Ping (with Sub-Agent) |
|---|---|---|
| **Target** | Persistent chat agent (Layer 2) | Running task sub-agent (Layer 3) |
| **Delivery** | Immediate (new LLM call) | Next step boundary (between tool calls) |
| **Persistence** | Saved to conversation history | Ephemeral (dies with sub-agent) |
| **Always available?** | Yes | Only while task is running |
| **Input field** | Chat panel input (bottom) | Task panel input (inside task card) |
| **Use case** | "What did you do?" / "What's the plan?" | "Use Zod" / "Skip that file" / "Be careful with X" |

### Ping Support per Adapter

| Adapter | Ping | Redirect | How |
|---|---|---|---|
| **AiSdkSubAgent** | Between steps (message queue) | Abort + re-inject | Manual step loop with `maxSteps: 1` |
| **ClaudeSubAgent** | Between tool calls | Abort + new request with redirect context | Append user message to Anthropic conversation |
| **OpenClawSubAgent** | Via session API | Via session API with priority flag | `POST /sessions/{id}/message` |
| **CopilotCliSubAgent** | Via stdin | Via stdin with prefix marker | Write `[PING] message` or `[REDIRECT] message` to stdin |
| **AgentProtocolSubAgent** | Limited (step input) | Not supported natively | Step input field if agent protocol supports it |

---

## 5. External Agents as Sub-Agents

### The Key Insight

The sub-agent interface IS the external agent invocation interface. The feature list already has "External Agent Invocation" planned. If the sub-agent adapter is designed correctly, external agent support comes for free.

The chat agent doesn't care **what** the sub-agent is — it only cares about the communication protocol.

### How It Maps

```
Chat Agent (persistent, Layer 2)
│
│  execute_task(taskId, instructions, agentType?)
│       │
│       ├─ agentType: "internal" → AiSdkSubAgent      (current AiSdkAgent)
│       ├─ agentType: "claude"   → ClaudeSubAgent      (Anthropic API)
│       ├─ agentType: "openclaw" → OpenClawSubAgent     (OpenClaw HTTP API)
│       ├─ agentType: "copilot"  → CopilotCliSubAgent   (CLI process)
│       ├─ agentType: "custom"   → AgentProtocolSubAgent (any agent)
│       └─ agentType: "team"     → TeamSubAgent          (MCP to child team)
│
│  All adapters implement SubAgentAdapter
│  All stream directly to UI via streamChannel
│  All support ask_user (each adapter translates for its protocol)
│  Chat agent only gets the summary on completion
```

### What This Gives Us

- Internal and external agents are interchangeable at the task level
- Users can assign specific agent types to roles ("use Claude for code review")
- The planner can choose agent types based on task characteristics
- New agent integrations = new adapter, no core changes

---

## 6. SubAgentAdapter Interface

The universal interface for all sub-agents — internal or external:

```typescript
// ─── Core Interface ───

interface SubAgentAdapter {
  /** Start the agent with a task. Returns an async event stream. */
  start(task: SubAgentTask): AsyncGenerator<SubAgentEvent>;

  /** Send a message to the agent mid-execution (user answer, interrupt). */
  send(message: SubAgentMessage): void;

  /** Cancel the agent gracefully. */
  cancel(): Promise<void>;

  /** Check if the agent is still running. */
  isRunning(): boolean;
}

// ─── Task Input ───

type SubAgentTask = {
  taskId: string;
  instructions: string;          // what to do
  context: string;               // dependency outputs, plan context, relevant code
  workspace?: WorkspaceConfig;   // git branch, path for code tasks
  skills?: ToolDefinition[];     // additional tools available
  mode: 'auto' | 'interactive';  // how ask_user behaves
  askTimeout?: number;            // ms before auto-deciding (auto mode only)
  streamChannel: string;          // Socket.IO room for direct streaming
  maxSteps?: number;              // step limit for the sub-agent
};

type WorkspaceConfig = {
  repoPath: string;
  branch: string;                // isolated task branch
  readPaths?: string[];          // allowed read paths
  writePaths?: string[];         // allowed write paths
};

// ─── Events (output stream) ───

type SubAgentEvent =
  | { type: 'stream_part'; part: StreamPart }
  | { type: 'ask_user'; questionId: string; question: string; options?: string[]; default?: string; context?: string }
  | { type: 'progress'; message: string; percent?: number }
  | { type: 'tool_call'; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: string }
  | { type: 'complete'; result: SubAgentResult }
  | { type: 'error'; error: string; recoverable: boolean }

type SubAgentResult = {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary: string;               // ~2k tokens — what was done
  artifacts?: string[];          // files created/modified
  output?: string;               // structured output if applicable
};

// ─── Messages (input to running agent) ───

type SubAgentMessage =
  | { type: 'answer'; questionId: string; answer: string }  // reply to ask_user
  | { type: 'ping'; message: string }                        // non-urgent user message (injected between steps)
  | { type: 'redirect'; message: string }                    // urgent direction change (aborts current step)
  | { type: 'cancel'; reason?: string }                      // kill the sub-agent
```

### Why AsyncGenerator

The `start()` method returns `AsyncGenerator<SubAgentEvent>` because:

1. It's the pattern AI SDK v6 already uses for tool streaming
2. The caller can iterate events at its own pace
3. Backpressure is natural (generator pauses when consumer isn't reading)
4. Clean cancellation via `generator.return()` or AbortSignal
5. Works identically for internal and external agents

### How the Chat Agent Consumes It

```typescript
// Inside the chat agent's execute_task tool
async function* executeTask(task: SubAgentTask) {
  const adapter = createAdapter(task.agentType);  // factory
  const events = adapter.start(task);

  // Listen for user pings/redirects from Socket.IO task channel
  socketIO.on(`${task.streamChannel}:ping`, (msg: string) => {
    adapter.send({ type: 'ping', message: msg });
  });
  socketIO.on(`${task.streamChannel}:redirect`, (msg: string) => {
    adapter.send({ type: 'redirect', message: msg });
  });

  for await (const event of events) {
    switch (event.type) {
      case 'stream_part':
        // Forward to Socket.IO stream channel (direct to UI)
        socketIO.to(task.streamChannel).emit('stream', event.part);
        break;

      case 'ask_user':
        // Forward to UI, wait for answer, send back to agent
        socketIO.to(task.streamChannel).emit('ask_user', event);
        const answer = await waitForUserAnswer(event.questionId, task);
        adapter.send({ type: 'answer', questionId: event.questionId, answer });
        break;

      case 'complete':
        // This is the ONLY thing the parent chat agent retains
        return event.result;

      case 'error':
        if (!event.recoverable) throw new Error(event.error);
        break;
    }
  }
}
```

---

## 7. Adapter Implementations

### 7.1 AiSdkSubAgent (Internal — Default)

The current `AiSdkAgent` wrapped as a `SubAgentAdapter`.

```typescript
class AiSdkSubAgent implements SubAgentAdapter {
  private agent: AiSdkAgent;
  private abortController = new AbortController();
  private answerResolvers = new Map<string, (answer: string) => void>();
  private messageQueue: Array<{ type: 'ping' | 'redirect'; message: string }> = [];

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    this.agent = new AiSdkAgent({
      model: azure.chat('gpt-4o'),
      tools: {
        ...buildWorkspaceTools(task.workspace),
        ...task.skills,
        ask_user: this.buildAskUserTool(),
      },
      stopWhen: stepCountIs(task.maxSteps ?? 10),
    });

    // Execute and convert AgentEvents to SubAgentEvents
    for await (const event of this.agent.execute(task.instructions)) {
      if (event.type === 'stream_part') {
        yield { type: 'stream_part', part: event.part };
      } else if (event.type === 'done') {
        yield {
          type: 'complete',
          result: {
            taskId: task.taskId,
            status: 'completed',
            summary: event.summary ?? 'Task completed.',
            artifacts: event.artifacts,
          },
        };
      }
    }
  }

  send(message: SubAgentMessage) {
    if (message.type === 'answer') {
      this.answerResolvers.get(message.questionId)?.(message.answer);
    } else if (message.type === 'ping') {
      this.messageQueue.push({ type: 'ping', message: message.message });
    } else if (message.type === 'redirect') {
      this.abortController.abort();
      this.abortController = new AbortController();
      this.messageQueue.unshift({ type: 'redirect', message: message.message });
    } else if (message.type === 'cancel') {
      this.abortController.abort();
    }
  }

  async cancel() {
    this.abortController.abort();
  }

  isRunning() {
    return !this.abortController.signal.aborted;
  }

  private buildAskUserTool() {
    return tool({
      parameters: z.object({
        question: z.string(),
        options: z.array(z.string()).optional(),
        default: z.string().optional(),
      }),
      execute: async ({ question, options, default: defaultAnswer }) => {
        const questionId = generateId();
        // Yield the ask_user event (parent handles routing to UI)
        // Then block until answer comes via send()
        return new Promise<string>((resolve) => {
          this.answerResolvers.set(questionId, resolve);
          // The event loop picks up this event via the generator
        });
      },
    });
  }
}
```

### 7.2 ClaudeSubAgent (Anthropic API)

Uses the Anthropic SDK with streaming. Maps Claude's tool_use events to SubAgentEvents.

```typescript
class ClaudeSubAgent implements SubAgentAdapter {
  private stream: Stream<MessageStreamEvent> | null = null;
  private abortController = new AbortController();
  private answerResolvers = new Map<string, (answer: string) => void>();

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    const anthropic = new Anthropic();

    // Build tool definitions (proxy tools that call back to our backend)
    const tools = buildProxyToolDefinitions(task);

    // Start streaming
    this.stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      system: buildSystemPrompt(task),
      messages: [{ role: 'user', content: task.instructions }],
      tools,
    });

    for await (const event of this.stream) {
      // Convert Anthropic events → SubAgentEvents
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          type: 'stream_part',
          part: { type: 'text-delta', textDelta: event.delta.text },
        };
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const toolName = event.content_block.name;
        if (toolName === 'ask_user') {
          // Handle ask_user — route to UI, wait for answer, continue
          yield {
            type: 'ask_user',
            questionId: event.content_block.id,
            question: event.content_block.input.question,
            options: event.content_block.input.options,
            default: event.content_block.input.default,
          };
        } else {
          yield { type: 'tool_call', toolName, args: event.content_block.input };
        }
      }
    }

    // Extract final summary
    yield {
      type: 'complete',
      result: {
        taskId: task.taskId,
        status: 'completed',
        summary: extractSummary(this.stream.finalMessage()),
      },
    };
  }

  send(message: SubAgentMessage) {
    if (message.type === 'answer') {
      this.answerResolvers.get(message.questionId)?.(message.answer);
    }
  }

  async cancel() {
    this.abortController.abort();
    this.stream?.controller.abort();
  }

  isRunning() {
    return !this.abortController.signal.aborted;
  }
}
```

### 7.3 OpenClawSubAgent (HTTP API)

Communicates with an OpenClaw agent running remotely. Uses HTTP + SSE for streaming.

```typescript
class OpenClawSubAgent implements SubAgentAdapter {
  private eventSource: EventSource | null = null;
  private sessionId: string | null = null;

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    // 1. Create a session on the OpenClaw agent
    const res = await fetch(`${this.openclawUrl}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        instructions: task.instructions,
        context: task.context,
        tools: buildProxyToolManifest(task),  // tools that call back to our backend
        callbackUrl: `${ourBackendUrl}/api/v2/subagent/${task.taskId}/callback`,
      }),
    });
    this.sessionId = (await res.json()).sessionId;

    // 2. Subscribe to SSE stream from OpenClaw
    this.eventSource = new EventSource(
      `${this.openclawUrl}/sessions/${this.sessionId}/stream`
    );

    // 3. Convert SSE events to SubAgentEvents
    yield* this.consumeSSE();
  }

  private async *consumeSSE(): AsyncGenerator<SubAgentEvent> {
    // EventSource → AsyncGenerator adapter
    // Each SSE event gets mapped to a SubAgentEvent
    // ask_user events come as tool calls to our callback URL
    // We handle them in the send() method
  }

  send(message: SubAgentMessage) {
    if (message.type === 'answer' && this.sessionId) {
      // POST answer back to OpenClaw session
      fetch(`${this.openclawUrl}/sessions/${this.sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ questionId: message.questionId, answer: message.answer }),
      });
    }
  }

  async cancel() {
    if (this.sessionId) {
      await fetch(`${this.openclawUrl}/sessions/${this.sessionId}`, { method: 'DELETE' });
    }
    this.eventSource?.close();
  }

  isRunning() {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
```

### 7.4 CopilotCliSubAgent (Local CLI Process)

Spawns a local CLI process. Parses stdout for events.

```typescript
class CopilotCliSubAgent implements SubAgentAdapter {
  private process: ChildProcess | null = null;

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    // Spawn copilot CLI with task instructions
    this.process = spawn('copilot', ['--task', task.instructions], {
      cwd: task.workspace?.repoPath,
      env: { ...process.env, TASK_CONTEXT: task.context },
    });

    // Parse stdout line-by-line
    const lines = createInterface({ input: this.process.stdout! });

    for await (const line of lines) {
      const event = parseCopilotOutput(line);
      if (event) yield event;
    }

    // Process exited — emit completion
    const exitCode = await waitForExit(this.process);
    yield {
      type: 'complete',
      result: {
        taskId: task.taskId,
        status: exitCode === 0 ? 'completed' : 'failed',
        summary: await readOutputFile(task.workspace),
      },
    };
  }

  send(message: SubAgentMessage) {
    if (message.type === 'answer') {
      // Write answer to stdin
      this.process?.stdin?.write(message.answer + '\n');
    }
  }

  async cancel() {
    this.process?.kill('SIGTERM');
  }

  isRunning() {
    return this.process !== null && this.process.exitCode === null;
  }
}
```

### 7.5 AgentProtocolSubAgent (Generic Standard)

For any agent that speaks the Agent Protocol (REST-based standard at agentprotocol.ai):

```typescript
class AgentProtocolSubAgent implements SubAgentAdapter {
  private agentTaskId: string | null = null;

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    // Create task on the remote agent
    const res = await fetch(`${this.agentUrl}/ap/v1/agent/tasks`, {
      method: 'POST',
      body: JSON.stringify({ input: task.instructions }),
    });
    this.agentTaskId = (await res.json()).task_id;

    // Poll for steps (Agent Protocol is request-response per step)
    while (true) {
      const step = await fetch(
        `${this.agentUrl}/ap/v1/agent/tasks/${this.agentTaskId}/steps`,
        { method: 'POST' }
      );
      const stepData = await step.json();

      yield { type: 'progress', message: stepData.output };

      if (stepData.is_last) {
        yield {
          type: 'complete',
          result: {
            taskId: task.taskId,
            status: 'completed',
            summary: stepData.output,
          },
        };
        break;
      }
    }
  }

  send(message: SubAgentMessage) {
    // Agent Protocol doesn't have native ask_user
    // Would need to use artifacts or step input for this
  }

  async cancel() {
    // Agent Protocol doesn't have native cancel — best effort
  }

  isRunning() {
    return this.agentTaskId !== null;
  }
}
```

### 7.6 TeamSubAgent (Child Team Delegation)

A child team wrapped as a SubAgentAdapter. The parent team doesn't know (or care) that its "sub-agent" is an entire team with its own three-layer hierarchy. Uses MCP Streamable HTTP (same protocol as B3 team-stacking).

```typescript
class TeamSubAgent implements SubAgentAdapter {
  private mcpClient: StreamableHttpClient;
  private sessionId: string | null = null;
  private goalId: string | null = null;

  constructor(
    private childTeamId: string,
    private parentTeamId: string,
    private endpoint: string,      // child team's MCP server URL
    private authToken: string,     // bearer token from child team operator
  ) {
    this.mcpClient = new StreamableHttpClient(endpoint, { auth: authToken });
  }

  async *start(task: SubAgentTask): AsyncGenerator<SubAgentEvent> {
    // Connect to child team's MCP server
    const stream = this.mcpClient.callTool('submit_goal', {
      goal: task.instructions,
      context: task.context,
      delegationChain: [...(task.delegationChain ?? []), this.parentTeamId],
      mode: task.mode,  // auto or interactive — propagates down
    });

    this.sessionId = stream.sessionId;  // MCP session for pinging

    // Translate MCP SSE events → SubAgentEvents
    for await (const event of stream) {
      if (event.type === 'progress') {
        yield { type: 'progress', message: event.params.status };
      } else if (event.type === 'stream_part') {
        // Child team only sends planner-level updates (not sub-agent streams)
        yield { type: 'stream_part', part: event.params.part };
      } else if (event.type === 'ask_user') {
        // Child planner decided to bubble up this question
        yield {
          type: 'ask_user',
          questionId: event.params.questionId,
          question: event.params.question,
          options: event.params.options,
          default: event.params.default,
          context: `[From child team ${this.childTeamId}] ${event.params.context ?? ''}`,
        };
      } else if (event.type === 'result') {
        yield {
          type: 'complete',
          result: {
            taskId: task.taskId,
            status: event.params.status,
            summary: event.params.summary,
            artifacts: event.params.artifacts,
          },
        };
      }
    }
  }

  send(message: SubAgentMessage) {
    if (message.type === 'answer') {
      // Forward user's answer to child team via MCP
      this.mcpClient.callTool('answer_question', {
        questionId: message.questionId,
        answer: message.answer,
      });
    } else if (message.type === 'ping') {
      // Forward ping to child team's planner (it decides what to do)
      this.mcpClient.sendNotification('user_message', {
        message: message.message,
        urgency: 'low',
      });
    } else if (message.type === 'redirect') {
      // Forward redirect to child team's planner — it decides how to cascade
      this.mcpClient.sendNotification('user_message', {
        message: message.message,
        urgency: 'high',  // child planner should abort + replan
      });
    } else if (message.type === 'cancel') {
      this.mcpClient.callTool('cancel', { goalId: this.goalId });
    }
  }

  async cancel() {
    await this.mcpClient.callTool('cancel', { goalId: this.goalId });
  }

  isRunning() {
    return this.sessionId !== null;
  }
}
```

**Key behaviors:**
- **Black box** — parent team never sees child team's internal agents, tasks, or sub-agents. Only planner-level status updates.
- **ask_user bubbling** — configurable per child team. Child planner decides whether to handle locally (ask Person B) or bubble up to parent (ask Person A).
- **Ping → child planner** — pings from the parent user go to the child planner, not directly to child sub-agents. The child planner is the authority.
- **Redirect → child planner replan** — redirects signal the child planner to re-evaluate. It decides whether to abort sub-agents, modify the plan, or ignore.
- **Distributed deployment** — the child team can run on a different server, operated by a different person. Communication is entirely over MCP Streamable HTTP.

### Adapter Comparison

| Adapter | Streaming | ask_user | Ping/Redirect | Tool Calling | Workspace Access | Maturity |
|---|---|---|---|---|---|---|
| **AiSdkSubAgent** | Native stream_part events | Via tool (Promise-based) | Message queue between steps / abort + re-inject | AI SDK native tools | Direct (same machine) | Production ready |
| **ClaudeSubAgent** | Anthropic streaming API | Via tool_use → callback | Append to conversation / abort + new request | Anthropic tool definitions | Via proxy tools (HTTP) | Ready to build |
| **OpenClawSubAgent** | SSE from remote endpoint | Via callback URL → response | POST to session API / POST with priority flag | Remote tool manifest | Via proxy tools (HTTP) | Needs OpenClaw API spec |
| **CopilotCliSubAgent** | stdout line parsing | stdin/stdout | Write to stdin with prefix markers | CLI-managed | Direct (local process) | Experimental |
| **AgentProtocolSubAgent** | Step polling | Not native (workaround) | Step input (limited) / not supported | Agent-managed | Via artifacts | Experimental |
| **TeamSubAgent** | MCP SSE (planner-level only) | Bubble-up via MCP (configurable) | MCP notification to child planner | Child team's own tools | Isolated (child team owns) | Needs B3 v1.1 |

---

## 8. Context Delivery to External Agents

External agents don't have direct access to L1/L2/L3 memory. Four strategies, in order of simplicity:

### Strategy A: Context Injection (Simplest)

Pack relevant context into the task instructions. External agent gets everything upfront.

```typescript
const task: SubAgentTask = {
  instructions: "Create a REST API for user authentication",
  context: `
## Dependency Outputs
- T-001 (DB Schema): Created users table with email, password_hash, created_at
- T-002 (Config): JWT secret in .env, token expiry 24h

## Relevant Files
- src/db/schema.ts (50 lines): ${fileContents}
- src/config.ts (20 lines): ${fileContents}

## Knowledge Base Findings
- Team convention: Express + Zod validation
- Auth pattern: bcrypt for passwords, jsonwebtoken for JWT
  `,
  // ...
};
```

**Pros:** Works with ANY agent, zero integration effort.  
**Cons:** Large payloads, no incremental access, stale context.

### Strategy B: Proxy Tools (Recommended Default)

Define tools in the sub-agent task that call back to our backend. External agent calls them via HTTP.

```typescript
function buildProxyToolManifest(task: SubAgentTask): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file from the workspace',
      parameters: { path: { type: 'string' } },
      // When external agent calls this, it hits our API:
      // POST /api/v2/subagent/{taskId}/tool/read_file
      // Our backend reads from the workspace and returns content
    },
    {
      name: 'search_files',
      description: 'Search workspace files by pattern or content',
      parameters: { query: { type: 'string' }, pattern: { type: 'string' } },
    },
    {
      name: 'search_knowledge',
      description: 'Search the knowledge base for domain information',
      parameters: { query: { type: 'string' } },
    },
    // ... workspace write tools if authorized
  ];
}
```

**Pros:** Incremental access, up-to-date context, works with tool-calling agents.  
**Cons:** Requires HTTP callback infrastructure, adds latency per tool call.

### Strategy C: MCP Server Exposure (Long-term)

Expose our workspace/collab/knowledge as MCP servers. External agents connect and self-serve.

```
Our Backend → exposes MCP server at mcp://workspace.ping.local
External Agent → connects to MCP → calls tools (read_file, search, etc.)
```

**Pros:** Most flexible, standard protocol, agent drives its own discovery.  
**Cons:** Requires external agent to support MCP client. Not all agents do.

### Strategy D: Artifact Bundle (For Dumb Agents)

Create a zip/tarball of relevant files + a context document. Pass URL to external agent.

**Pros:** Works with agents that don't support tools at all.  
**Cons:** No incremental access, no write capability, stale by definition.

### Recommended Approach

Start with **A (context injection) + B (proxy tools)**. Use context injection for the task overview and proxy tools for on-demand file access. This works with most tool-calling agents immediately.

Add MCP exposure (Strategy C) when we build the MCP server feature — it becomes the default for agents that support it.

---

## 9. Two-Channel Communication Model

A key architectural decision: separate the **chat channel** from the **task stream channel**.

### The Two Channels

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  CHAT CHANNEL (persistent, conversational)                       │
│                                                                   │
│  User ↔ Chat Agent                                               │
│  - Always available, regardless of task status                   │
│  - Discuss past work, ask questions, plan                        │
│  - No sub-agent involvement                                     │
│  - Persisted conversation history                                │
│                                                                   │
│  Socket.IO room: chat:{teamId}:{agentRole}                      │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  TASK STREAM CHANNEL (transient, per-task)                       │
│                                                                   │
│  Sub-Agent → User (streaming)                                    │
│  User → Sub-Agent (ask_user answers, interrupts)                 │
│  - Live ONLY during task execution                               │
│  - Tokens, tool calls, progress bars, ask_user questions         │
│  - Dies when task completes                                      │
│  - NOT persisted in chat agent context                           │
│                                                                   │
│  Socket.IO room: task:{teamId}:{goalId}:{taskId}                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Why Two Channels

The chat agent **does not proxy** the task stream. It just knows "a task is running" and gets the summary when it's done.

| Concern | Single Channel (Proxy) | Two Channels (Direct) |
|---|---|---|
| Chat agent context | Grows with every task token | Only grows with summaries |
| Stream latency | Extra hop through parent | Direct to UI |
| Chat during task | Blocked (agent is waiting on sub-agent) | Independent (chat agent handles chat; sub-agent handles task) |
| User can ask chat agent questions while task runs? | No | Yes |
| Complexity | Simpler routing | Two channels to manage |

### Frontend Routing

```
User opens Backend Dev agent:
  UI subscribes to: chat:team-001:backend-dev

  Chat area shows conversation history.
  User can type messages → go to chat channel → chat agent responds.

  If a task is running for this agent:
    UI also subscribes to: task:team-001:goal-005:T-003
    Task panel shows live execution stream.
    ask_user questions appear inline in the task panel.
    User answers → go through task channel → sub-agent resumes.

  When task completes:
    Task panel shows completion summary.
    Chat agent receives summary → can discuss it in chat.
    UI unsubscribes from task channel.
```

---

## 10. Frontend Impact

### New UI Components

| Component | Description | Channel |
|---|---|---|
| **TaskStreamPanel** | Live view of sub-agent execution. Shows streamed text, tool calls, progress. | task:{teamId}:{goalId}:{taskId} |
| **AskUserInline** | Question card that appears in TaskStreamPanel when sub-agent calls ask_user. Has option buttons + freeform input. | task channel (emit answer back) |
| **AutoDecisionChip** | Small indicator when ask_user timed out and auto-decided. Shows what was decided with an icon. | task channel |
| **AgentTypeSelector** | In agent settings, choose which sub-agent type to use for tasks (internal, Claude, OpenClaw, custom). | HTTP API |
| **TaskModeToggle** | Toggle auto/interactive mode per task or globally. | HTTP API |
| **TaskPingInput** | Text input inside the task panel for sending pings/redirects to running sub-agents. Has normal send (ping) and redirect button (⚡). | task channel |

### Updated Chat Area Layout

```
┌────────────────────────────────────────────────────────────┐
│ Backend Developer                                     [⚙]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Chat History (persistent conversation)                    │
│  ┌────────────────────────────────────────────────────┐   │
│  │ You: What approach did you use for auth?           │   │
│  │ Agent: I used Passport.js with bcrypt. The...      │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌─ Active Task: T-003 ──────────────────── [auto] ──┐   │
│  │ Creating /api/auth/login endpoint...               │   │
│  │ ██████████░░ 70%                                   │   │
│  │                                                    │   │
│  │ ┌─ Question ─────────────────────────────────┐    │   │
│  │ │ Should I add rate limiting to the login     │    │   │
│  │ │ endpoint?                                   │    │   │
│  │ │ [Yes] [No] [Add it as a separate task]      │    │   │
│  │ │                         ⏱ Auto in 45s: Yes  │    │   │
│  │ └────────────────────────────────────────────┘    │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ [Ping this agent...]                     [⚡ Redirect] │   │
│  │ Messages appear inline. Redirects abort current step.│   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  [Type a message to chat with Backend Developer...]        │
│  ───────────────────────────────────────────────────────── │
│  Chat input is ALWAYS active. Messages go to chat agent.   │
│  Task pings/questions handled in the task panel above.     │
└────────────────────────────────────────────────────────────┘
```

### Socket.IO Event Changes

| Event | Current | Updated |
|---|---|---|
| `subscribe` | `{ teamId, agentId }` | `{ teamId, agentRole, channel: 'chat' \| 'task', goalId?, taskId? }` |
| `stream` | Flat stream for all agents | Scoped to channel: `chat:{team}:{role}` or `task:{team}:{goal}:{task}` |
| **NEW** `ask_user` | — | `{ questionId, question, options?, default?, timeout? }` on task channel |
| **NEW** `answer` | — | `{ questionId, answer }` from frontend to backend on task channel |
| **NEW** `auto_decided` | — | `{ questionId, answer, reason: 'timeout' }` notifies UI of auto-decision |
| **NEW** `ping` | — | `{ message }` from frontend to backend on task channel — user pings sub-agent |
| **NEW** `redirect` | — | `{ message }` from frontend to backend on task channel — user redirects sub-agent (aborts current step) |
| **NEW** `ping_ack` | — | `{ message }` from backend to frontend — confirms redirect received (ping is fire-and-forget) |
| `state` | Single plan state | Per-goalId plan state (unchanged from A10) |

---

## 11. Architecture Options

### Option A: Full Protocol (Recommended)

Implement the complete SubAgentAdapter interface with direct streaming, ask_user, and the adapter factory.

**Pros:** Future-proof, external agents work immediately when adapters are built, clean separation of channels.  
**Cons:** Most complex. Requires ask_user infrastructure, adapter factory, two-channel routing.  
**Effort:** Add ~2 weeks to Phase 2 of A10 migration path.

### Option B: Direct Streaming Only (No ask_user, No External)

Sub-agents stream directly to UI. No ask_user. No adapter interface (internal only).

**Pros:** Simplest. Gets the main benefit (direct streaming) without complexity.  
**Cons:** No user interaction during tasks. No path to external agents. Would need rework later.  
**Effort:** Add ~1 week to Phase 2 of A10 migration path.

### Option C: Adapter Interface Only (External Support, No ask_user)

Build the SubAgentAdapter interface and factory. External agents supported. But no ask_user — agents are fully autonomous.

**Pros:** External agents work. Clean interface. Simpler than Option A.  
**Cons:** No user interaction during tasks. Auto-mode only. Some tasks may produce bad results without user guidance.  
**Effort:** Add ~1.5 weeks to Phase 2 of A10 migration path.

### Recommendation: Option A

User interaction during task execution is a core UX differentiator. The adapter interface is the right abstraction regardless. Building both together is more effort but avoids rework. Start with AiSdkSubAgent adapter only — add external adapters as needed.

---

## 12. Team Stacking Integration (B3 Alignment)

The `TeamSubAgent` adapter unifies A10 (Persistent Agents) with B3 (Team Stacking). A child team IS a sub-agent from the parent's perspective.

### Key Decisions (Resolved)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | **Child team visibility** | **Black box (Option A)** | Parent sees only planner-level status updates. No drill-in to child agents. Child team may run on a different server owned by a different person. |
| 2 | **ask_user routing** | **Configurable — child planner decides (Option C)** | Child planner evaluates: is the child operator online? Is this within my authority? Should the parent user weigh in? Per-team policy: `handle_locally \| bubble_up \| auto`. |
| 3 | **Redirect propagation** | **Only to child planner (Option A)** | Parent user shouldn't kill another person's running agents. Child planner receives the redirect and decides how to cascade internally. |
| 4 | **Child team agents** | **Full persistent agents (Option A)** | Each child team has its own complete three-layer hierarchy. Same capabilities as any top-level team. |

### Distributed Multi-User Model

Child teams can run on **different servers, operated by different people**. This is a natural extension of the black-box model:

```
Person A's Machine (or server)                Person B's Machine (or server)
┌──────────────────────────┐                 ┌──────────────────────────┐
│ Parent Team (Product)     │                 │ Child Team (Engineering)  │
│                           │                 │                           │
│ L1: Planner              │  MCP/HTTP       │ L1: Planner              │
│ L2: Chat Agents          │ ◄──────────────►│ L2: Chat Agents          │
│ L3: Task Sub-Agents      │  (Streamable)   │ L3: Task Sub-Agents      │
│                           │                 │                           │
│ Person A's UI             │                 │ Person B's UI             │
│ (sees black box for       │                 │ (sees full hierarchy for  │
│  Engineering team)        │                 │  their own team)          │
└──────────────────────────┘                 └──────────────────────────┘
```

Each team is a **self-contained deployment** with:
- Its own backend server (agents run on server, not on the person's local machine)
- Its own three-layer agent hierarchy (planner + chat agents + task sub-agents)
- Its own MCP server (for accepting delegated goals from parent teams)
- Its own frontend UI (for the team's operator)
- Its own database/persistence

### MCP Server Interface (Per Team)

| MCP Tool | Direction | Purpose |
|---|---|---|
| `submit_goal` | Parent → Child | Delegate a goal with context |
| `get_status` | Parent → Child | Poll current progress |
| `answer_question` | Parent → Child | Answer a bubbled-up ask_user |
| `send_message` | Parent → Child | Ping or redirect (urgency: low/high) |
| `cancel` | Parent → Child | Cancel a delegated goal |
| SSE events | Child → Parent | Stream progress updates, ask_user bubbling, completion |

### Who Controls What (Multi-User)

| Control | Person A (Parent Operator) | Person B (Child Operator) |
|---|---|---|
| Submit goals | Yes (via MCP) | No (receives them) |
| See internal agents | No (black box) | Yes (full hierarchy) |
| Answer ask_user | Only if child planner bubbles up | Yes (directly) |
| Redirect child team | Yes (sends to child planner) | Yes (directly controls agents) |
| Cancel delegated goal | Yes (via MCP) | Yes (locally) |
| Configure agents/skills | No | Yes |
| Add/remove roles | No | Yes |
| Chat with child agents | No | Yes |

### ask_user Flow Across Teams

```
Child task sub-agent (L3)
  → calls ask_user tool
  → emits ask_user event to child stream channel

Child Planner evaluates (per askUserPolicy):
  - handle_locally: route to Person B's UI
  - bubble_up: forward via MCP SSE to parent
  - auto: if Person B is online → local; else → bubble up

If bubbled up:
  Parent's TeamSubAgent adapter
    → receives SSE event
    → yields { type: 'ask_user', context: '[From Engineering Team] ...' }
  Parent chat agent's executeTask consumer
    → emits to parent's task stream channel → Person A's UI
  Person A answers → TeamSubAgent.send({ type: 'answer' })
    → MCP callTool('answer_question') → child resolves Promise
    → child sub-agent resumes
```

### Ping Propagation Across Teams

| Scenario | What Happens |
|---|---|
| Person A pings parent chat agent | Normal ping — goes to parent L2 chat agent |
| Person A pings parent's child-team task | Ping → TeamSubAgent.send() → MCP notification → **child planner** decides what to do |
| Person A redirects child-team task | Redirect → MCP notification (urgent) → child planner **replans** (may abort sub-agents, modify plan, etc.) |
| Person B pings child agent directly | Normal ping — direct access, goes to child chat agent or sub-agent |

### What Person A Sees in Their UI (Black Box View)

```
┌─ Engineering Team (child) ────────── [Running] ──────────┐
│                                                           │
│ Status: 3/5 tasks complete                                │
│ Last update: "Backend API done. Starting auth service."   │
│                                                           │
│ Updates from child planner:                               │
│  ✅ T-001: Database schema created                        │
│  ✅ T-002: REST API endpoints implemented                 │
│  🔄 T-003: Auth service (in progress)                     │
│  ⏳ T-004: Frontend integration (pending)                 │
│  ⏳ T-005: E2E tests (pending)                            │
│                                                           │
│ [No access to internal agents — managed by Person B]      │
│                                                           │
│ [Ping child team...]                         [⚡ Redirect] │
└───────────────────────────────────────────────────────────┘
```

### Updated B3 Phases with A10 Alignment

| Phase | B3 Original | Updated for A10 |
|---|---|---|
| **v1.0** | ExternalAgent class + registry | `TeamSubAgent` adapter (implements SubAgentAdapter) + registry |
| **v1.1** | Team-as-MCP-server | Team MCP server exposes `submit_goal`, `answer_question`, `cancel` + SSE streaming (incl. ask_user) |
| **v2.0** | Recursive composition | Three-layer hierarchy at each level. Child planner handles pings/redirects. Delegation chain prevents cycles. |
| **v2.1** | Cross-team shared docs | Child team's L2 collab accessible to parent via read-only MCP tools |

---

## 13. Open Decisions

| # | Question | Options | Notes |
|---|---|---|---|
| 1 | **ask_user default mode** — should tasks default to auto or interactive? | A) Auto (agent decides if no answer). B) Interactive (agent blocks). C) Per-task configurable. | Auto is safer for batch execution. Interactive is better for watched tasks. |
| 2 | **Auto-mode timeout** — default timeout before auto-deciding? | A) 30 seconds. B) 60 seconds. C) Configurable per task/team. | Too short = user can't read. Too long = task stalls. |
| 3 | **Task panel placement** — where does the task execution stream appear? | A) Inline in chat (embedded card). B) Separate panel (split view). C) Expandable overlay. | Inline keeps context. Separate panel avoids cluttering chat. |
| 4 | **First external adapter** — which to build first? | A) ClaudeSubAgent (easiest — Anthropic SDK). B) OpenClawSubAgent (most strategic). C) CopilotCliSubAgent (most pragmatic). D) AgentProtocol (most standard). | Claude is the fastest path to proving the adapter pattern works. |
| 5 | **Proxy tool security** — how to authenticate external agents calling proxy tools? | A) Short-lived token per task session. B) Signed URLs per tool call. C) mTLS between agents. | Short-lived tokens are simplest and sufficient for now. |
| 6 | **ask_user routing** — if user is chatting with the chat agent while a task asks a question, how to avoid confusion? | A) Task questions appear in a separate panel (never in chat). B) Task questions appear in chat with a clear visual distinction. C) Notification banner linking to task. | Option A (separate panel) is cleanest — keeps channels truly independent. |
| 7 | **Ping delivery guarantee** — should the sub-agent acknowledge receiving a ping? | A) Yes — emit `ping_received` event back to UI. B) No — fire-and-forget, user sees effect in subsequent output. C) Acknowledgment only for redirects. | Option C — redirects are disruptive enough to warrant confirmation. |
| 8 | **Redirect safety** — should redirect abort immediately or wait for current tool call to finish? | A) Abort immediately (may leave partial file writes). B) Wait for current tool call, then inject redirect. C) Configurable per tool (safe tools abort, filesystem tools complete first). | Option C is safest — filesystem writes should complete, but LLM generation can abort. |
| 9 | **Cross-team auth** — how does Person A authenticate with Person B's child team MCP server? | A) Bearer token (Person B generates, shares with Person A). B) OAuth 2.0 (proper identity). C) Mutual TLS. | Bearer token for MVP. OAuth for production multi-user. |
| 10 | **Child team offline** — what happens when the child team's server is unreachable? | A) Task fails immediately. B) Retry with backoff. C) Queue and wait. | Retry with backoff + timeout. After timeout, fail and notify parent planner. |

---

## References

- [A10 — Persistent Agents & Three-Layer Hierarchy](feature_architecture.md) — Parent architecture doc
- [B3 — Team Stacking](../team-stacking/feature_architecture.md) — Team composition architecture
- [External Agent Invocation feature](../external-agent-invocation/) — Will use SubAgentAdapter
- [A5 — Planner as Agent](../planner-as-agent/feature_architecture.md) — Planner design
- AI SDK v6 Sub-Agents — `ToolLoopAgent`, `async function*` execute, `toModelOutput()`
- [Agent Protocol](https://agentprotocol.ai) — Open standard for agent communication
