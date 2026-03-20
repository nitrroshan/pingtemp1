# Research — Agent ↔ Collab Docs & Non-Blocking Discussions

Research findings for the agent-collab-docs feature. Covers external projects, academic papers, and internal codebase analysis.

---

## External Research — Existing Projects & Academic Work

### The Landscape: Nobody Has Solved This Well Yet

The specific pattern we want — **agents bidirectionally collaborating on CRDT documents in real-time while a human works in the same editor** — is essentially **novel**. Here's what exists and where each falls short:

---

### 1. AWCP — Agent Workspace Collaboration Protocol (Feb 2026)

**Paper:** [arXiv:2602.20493](https://arxiv.org/abs/2602.20493)
**Code:** [github.com/SII-Holos/awcp](https://github.com/SII-Holos/awcp) (TypeScript, Apache 2.0)

**What it does:** A protocol for one agent (Delegator) to project its workspace (files, build systems, version history) to a remote agent (Executor) who works on those files directly. Uses a "files-as-interface" paradigm inspired by Unix. Supports SSHFS, ZIP archive, cloud storage, and Git transports.

**Key architecture:**
```
Delegator ──INVITE──> Executor
         <──ACCEPT──
         ──START───>
         [Executor works on files]
         <──SSE status updates──
         <──SSE snapshots──
         <──DONE (summary)──
```

**What's relevant to us:**
- Demonstrates that workspace delegation (not just message passing) is the right model for deep agent collaboration
- Their SSE status updates pattern is similar to our agent→doc push
- Their roadmap includes "CRDT-based conflict resolution for concurrent workspace access" — they haven't built it yet
- MCP integration as an npm package (`@awcp/mcp`)

**What's different from our needs:**
- AWCP is agent-to-agent ONLY — no human-in-the-loop editing. It's about one agent handing files to another agent
- No CRDT/real-time co-editing — their transports are batch-oriented (copy files, work, return files)
- No shared document model — it's a file system, not a structured collaborative doc
- Their roadmap lists CRDT support as a "long-term" goal

**Takeaway:** AWCP validates that "agents need more than messages" but solves a different problem (workspace delegation, not real-time co-editing). Our CRDT-based approach is more advanced for the specific use case of human+agent document collaboration.

---

### 2. ViviDoc — Human-Agent Collaborative Document Generation (Mar 2026)

**Paper:** [arXiv:2603.01912](https://arxiv.org/abs/2603.01912)

**What it does:** A multi-agent pipeline (Planner, Executor, Evaluator) that generates interactive educational documents from a topic. Uses "DocSpec" as a human-readable intermediate representation that humans review before code generation.

**What's relevant to us:**
- Multi-agent pipeline where agents contribute to a shared document
- Human reviews & refines generation plans before execution (similar to our plan approval step)
- Structured intermediate representation between agents and final output

**What's different:**
- Not real-time — it's a batch pipeline: plan → review → generate
- Human involvement is in the review phase, not live co-editing
- No CRDT, no shared document state

**Takeaway:** Good validation of the "agents contribute to docs, humans review" pattern, but missing the real-time bidirectional loop we want.

---

### 3. Mutual Theory of Mind in Human-AI Collaboration (Sep 2024)

**Paper:** [arXiv:2409.08811](https://arxiv.org/abs/2409.08811) — Zhang et al.

**What it does:** Empirical study of LLM-driven AI agents collaborating with humans in a **real-time shared workspace task**. Tests whether an agent's "Theory of Mind" (ability to model what the human is thinking) improves collaboration.

**Key findings from the study:**
- Agent's ToM capability **did NOT significantly impact team performance** but **enhanced human understanding of the agent** and feeling of being understood
- **Bidirectional communication led to LOWER team performance** (surprising!) — verbal back-and-forth increased human cognitive burden
- Most participants felt verbal communication increased their burden

**What's relevant to us — critical design insight:**
- Agents posting status updates to the doc is GOOD (increases human understanding of agent behavior)
- But agents asking the user questions via the doc could DECREASE performance (cognitive overload)
- **Implication for our design:** Agent→doc writes should be **informational** (findings, status, suggestions), NOT conversational (questions, back-and-forth). Keep the chat channel for interactive dialogue.

**Takeaway:** This is the most directly relevant research. It empirically validates that shared workspace collaboration works, but warns against adding too much bidirectional communication via the workspace. Status updates > dialogue in docs.

---

### 4. CrewAI Collaboration — Message-Passing Pattern

**What it does:** CrewAI's collaboration model gives agents two tools: `Delegate work to coworker` and `Ask question to coworker`. Agents pass messages to each other to collaborate.

**Limitations:**
- Pure message-passing — no shared document, no CRDT, no human-visible workspace
- Human sees only final output, not intermediate collaboration
- No real-time updates while agents work
- Context sharing between tasks via `context=[previous_task]` — sequential, not live

**What's relevant:** Their "hierarchical process" pattern (manager delegates to specialists) is similar to our orchestrator→worker pattern. But they have no shared artifact concept.

---

### 5. Microsoft AutoGen — Conversation Patterns

**What it does:** Multi-agent conversation framework. Agents communicate via a shared conversation thread (like a group chat). Pattern types: two-agent chat, sequential chat, group chat, nested chat.

**Limitations:**
- Communication is purely message-based
- No shared workspace/document concept
- No CRDT, no real-time co-editing
- Human-in-the-loop is for approval/feedback on messages, not co-editing artifacts

**What's relevant:** Their "shared conversation" model is analogous to a simpler version of what we have with the `collab` tool, but text-only with no structured document.

---

### 6. LangGraph Shared State

LangGraph (which we use) supports shared state between nodes in a graph. Our agents already share state via `MemoryManager` and the `collab` tool + CRDT docs. But LangGraph's native shared state is graph-internal — it doesn't project to a human-editable document. Our Hocuspocus + BlockNote layer bridges that gap.

---

### Summary Matrix — Agent ↔ Document Collaboration

| Project/Research | Agent↔Agent Collab | Agent↔Human Collab | Shared Document | Real-time CRDT | Human co-editing |
|-----------------|--------------------|--------------------|-----------------|----------------|------------------|
| **Our System** | ✅ via collab tool | ✅ via BlockNote | ✅ Y.Doc | ✅ Hocuspocus | ✅ BlockNote editor |
| **AWCP** | ✅ workspace delegation | ❌ | ❌ (files only) | ❌ (roadmap) | ❌ |
| **ViviDoc** | ✅ pipeline | ⚠️ review only | ⚠️ DocSpec (batch) | ❌ | ❌ |
| **MToM Study** | ❌ | ✅ real-time task | ✅ shared workspace | ❌ | ✅ |
| **CrewAI** | ✅ message passing | ❌ | ❌ | ❌ | ❌ |
| **AutoGen** | ✅ conversation | ⚠️ approval only | ❌ | ❌ | ❌ |
| **LangGraph** | ✅ graph state | ❌ | ❌ | ❌ | ❌ |

### Key Insight

**We are building something genuinely novel.** No existing project combines:
1. Real-time CRDT documents (Yjs/Hocuspocus)
2. Multiple AI agents reading from AND writing to those documents
3. A human user co-editing the same document in a rich text editor
4. Agents reacting to human edits and vice versa

The closest is the **Mutual Theory of Mind study**, which validates the concept but uses a simpler shared workspace (not CRDT). AWCP validates that agents need more than messages but doesn't have real-time co-editing. Everything else is message-passing only.

**Design principle from MToM research:** Keep agent→doc writes **informational and non-intrusive**. Status updates, findings, and suggestions work well. Avoid making the doc a conversation channel — use chat for that.

---

## External Research — Non-Blocking Discussion + Parallel Work

### The Specific Question: Has Anyone Built Discussions That Don't Stop Agent Work?

We searched for projects and papers where:
- Agents discuss with humans/other agents in real-time
- Discussions happen **in parallel** with task execution (not blocking)
- Agents start working on known items while unknowns are being resolved
- Humans can converse without interrupting agent work

### What Exists Today

#### 1. ChatDev — Agent Discussions for Software Development (ACL 2024)

**Paper:** [arXiv:2307.07924](https://arxiv.org/abs/2307.07924)
**Code:** [github.com/OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)

**What it does:** Agents play roles (CEO, CTO, Programmer, Tester) and use "chat chains" — multi-turn dialogues between pairs of agents in sequence. A "communicative dehallucination" mechanism detects when discussions go off-track.

**Discussion model:** Agent pairs have structured conversations to make decisions at each phase (design → coding → testing). The conversations are the primary mechanism — agents don't DO anything while discussing.

**Limitation for our use case:**
- ❌ **Discussions ARE the work** — there's no parallel execution. When agents discuss a design, no code is being written.
- ❌ **Sequential phases** — you can't code while still discussing design decisions
- ❌ **No human involvement** — fully autonomous, no human-in-the-loop during execution
- ❌ **No shared document** — discussions are message chains, not in a collaborative doc

**Takeaway:** Validates that structured agent-agent discussion improves output quality, but the blocking sequential model is exactly what we want to avoid.

#### 2. MetaGPT — SOPs as Discussion Structure (ICLR 2024)

**Paper:** [arXiv:2308.00352](https://arxiv.org/abs/2308.00352)
**Code:** [github.com/geekan/MetaGPT](https://github.com/geekan/MetaGPT)

**What it does:** Encodes "Standardized Operating Procedures" (SOPs) into prompts. Agents follow a waterfall process: Product Manager → Architect → Engineer → QA. Each agent produces structured artifacts (PRDs, system designs, code) verified by the next agent.

**Discussion model:** Not really discussions — each role produces an artifact, and the next role reviews/transforms it. More like an assembly line than a conversation. The "review" is implicit in the role transition.

**Limitation for our use case:**
- ❌ **Assembly line, not discussion** — no back-and-forth dialogue between agents
- ❌ **Sequential** — must complete design before coding starts
- ❌ **No human interaction during execution** — human provides initial requirement only
- ✅ **Shared artifacts between phases** — useful pattern — each agent reads previous artifacts

**Takeaway:** The structured artifact pattern (agent produces doc → next agent reads it) is good. But there's no real discussion and no parallelism.

#### 3. AutoGen — Group Chat with Human-in-the-Loop

**How it works:** AutoGen supports `GroupChat` with a `GroupChatManager` that selects who speaks next. Strategies include `round_robin`, `random`, `manual` (human picks), and `auto` (LLM picks). Supports `human_input_mode` settings: `ALWAYS`, `TERMINATE`, `NEVER`.

**Discussion model:** All agents share a single conversation thread. The GroupChatManager moderates. In `manual` mode, a human can be in the loop selecting who speaks. Sequential chats carry summaries forward.

**Limitation for our use case:**
- ❌ **Turn-based** — only one agent speaks at a time. Everyone waits.
- ❌ **Discussion IS the task** — there's no work happening in background while agents chat
- ⚠️ **Human-in-the-loop is approval-based** — human approves/rejects, doesn't have parallel conversations
- ❌ **No shared workspace** — just message threads
- ✅ **Constrained speaker transitions** — useful pattern for structuring who can talk to whom

**Takeaway:** Good for synchronous deliberation. Not designed for "discuss while working."

#### 4. Devin — Interaction While Agent Works

**How it works:** Devin runs autonomously on coding tasks. Users can:
- Watch Devin work in real-time (IDE, shell, browser)
- Send messages in a chat thread while Devin executes
- "Take over" in the IDE to make direct code edits

**Discussion model:** Conversational — user chats with Devin. But Devin processes messages **sequentially**. When a user sends a message, Devin reads it and may adjust, but there's no true parallel discussion happening alongside task execution.

**Limitation for our use case:**
- ✅ **Visibility** — user watches agent work in real-time (our collab doc model)
- ⚠️ **Chat alongside work** — user can talk, but Devin processes it as part of its serial loop
- ❌ **Not truly parallel** — Devin doesn't have a separate "discussion agent" running concurrently
- ❌ **Single agent** — no multi-agent discussions
- ❌ **No shared document editing** — IDE view is read-only for observation (takeover switches control)

**Takeaway:** Closest commercial product to our vision. But it's one agent + one human, sequentially processed. No parallel discussion thread. No multi-agent discussions.

#### 5. DPT-Agent — Dual Process (ACL 2025)

**Paper:** [arXiv:2502.11882](https://arxiv.org/abs/2502.11882) — "Leveraging Dual Process Theory in Language Agent Framework for Real-time Simultaneous Human-AI Collaboration"
**Authors:** Zhang, Wang, et al. (SJTU + Tencent)
**Venue:** ACL 2025 Main Conference
**Code:** [github.com/sjtu-marl/DPT-Agent](https://github.com/sjtu-marl/DPT-Agent)

**What they built:** DPT-Agent — the first language agent framework that achieves real-time simultaneous human-AI collaboration. Based on **Dual Process Theory** (Kahneman's "Thinking, Fast and Slow"):

- **System 1 (Fast, Intuitive):** Uses FSM + code-as-policy for fast, reactive decisions. Handles immediate responses without heavy reasoning.
- **System 2 (Slow, Deliberative):** Uses Theory of Mind (ToM) + asynchronous reflection for deeper reasoning, strategy inference, and complex decisions. Runs in parallel.

**Key findings:**
- Both systems run concurrently — System 1 provides real-time responsiveness while System 2 does heavy thinking
- Shared context — System 2's reasoning results feed back into System 1's decision-making
- Significant performance improvements over single-process agents in real-time tasks

**Most relevant for our dual-agent architecture (Communication Agent = System 1, Task Agent = System 2).**

#### 6. Multi-Agent Debate / Deliberation (Various Papers)

Several papers explore agents debating to improve reasoning:
- **LLM Debate** (Du et al., 2023) — Multiple agents debate to reach consensus. Improves factuality.
- **Finding Common Ground** (Heller et al., 2025) — LLMs detect agreement in multi-agent decision conferences.

**Limitation for our use case:**
- ❌ **Debate is the task** — used for reasoning improvement, not alongside a coding/building task
- ❌ **No parallel work** — agents discuss until convergence, then output the answer
- ❌ **No human participation** — purely agent-to-agent

**Takeaway:** Validates that multi-agent discussion improves decision quality. But these are "think together" systems, not "work and discuss in parallel" systems.

#### 7. Parallelized Planning-Acting (Mar 2025)

**Paper:** [arXiv:2503.03505](https://arxiv.org/abs/2503.03505) — "Parallelized Planning-Acting for Efficient LLM-based Multi-Agent Systems in Minecraft"

**Architecture: Dual-thread design:**
- **Planning thread** — driven by centralized memory, handles dynamic decision-making and agent communication
- **Acting thread** — executes tasks via a skill library, does recursive decomposition

**Key design:** The threads run concurrently with an **interruptible execution** mechanism — the planning thread can interrupt the acting thread when conditions change.

#### 8. Dual-Loop Edge-Terminal Collaboration (Sep 2025)

**Paper:** [arXiv:2509.04993](https://arxiv.org/abs/2509.04993) — "LLM Enabled Multi-Agent System for 6G Networks"
**Venue:** IEEE Communications Magazine

**Architecture:**
- **Outer loop:** Global agent coordinates sub-agents — task decomposition + parallel distribution
- **Inner loop:** Sub-agents with dedicated roles cyclically reason, execute, and replan

Validates the dual-loop concept in production systems (networking/telecom).

---

### Summary Matrix — Non-Blocking Discussion + Parallel Work

| Capability | ChatDev | MetaGPT | AutoGen | Devin | DPT-Agent | **Our Goal** |
|-----------|---------|---------|---------|-------|-----------|-------------|
| Agent discussions | ✅ pairs | ⚠️ artifact relay | ✅ group chat | ❌ | ❌ | ✅ in CRDT docs |
| Human in discussion | ❌ | ❌ | ⚠️ approval | ✅ chat | ❌ | ✅ real-time co-edit |
| Discussions don't block work | ❌ | ❌ | ❌ | ⚠️ serial | ✅ | ✅ |
| Agent-agent discussions | ✅ | ⚠️ | ✅ | ❌ | ❌ | ✅ |
| Work on known, discuss unknown | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| Shared persistent artifact | ❌ | ✅ files | ❌ | ✅ code | ❌ | ✅ CRDT docs |
| Structured decisions | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ discussion docs |
| Real-time visibility | ❌ | ❌ | ❌ | ✅ IDE | ❌ | ✅ BlockNote |

**The novel combination is:**
1. Discussions happen in **persistent CRDT documents** (not ephemeral chat)
2. Discussions are **non-blocking** — the Task Agent keeps working
3. Both **humans and agents** participate in the same discussion
4. Discussions produce **structured decisions** that redirect agent work
5. Agents **work on known items** while unknowns are discussed in parallel
6. All of this is **visible in a shared editor** in real-time

No existing system combines more than 2-3 of these. Most combine zero.

### Why This Is Hard (And Why Nobody Has Done It)

1. **LLMs are inherently synchronous** — one prompt in, one completion out. Making "parallel discussion" work requires architectural tricks (dual agents, event loops, async reflection).

2. **Context window management** — if the Communication Agent and Task Agent share context, you're burning tokens twice. If they don't share enough, they're incoherent.

3. **Interrupt classification is unsolved** — deciding "is this comment worth interrupting the agent for?" is itself an LLM judgment call, adding latency and cost.

4. **CRDT + LLM integration is rare** — very few systems connect LLM agents to CRDT-based collaborative editors. Our Hocuspocus + BlockNote + collab tool stack is unusually mature for this.

5. **Discussion convergence** — when does a discussion end? Who decides? In human teams, the senior person decides or there's a timeout. Agent discussions need similar governance.

---

## Internal Research — Current Codebase Capabilities

### 1. Hocuspocus `onChange` Hook — Primary Change Detection Mechanism

The Hocuspocus server already fires an `onChange` hook every time a document is modified. The hook payload includes:

```typescript
{
  clientsCount: number,    // How many connected clients
  context: any,            // Auth context from onAuthenticate (e.g., { user: "agent:researcher" })
  document: Y.Doc,         // The Yjs document
  documentName: string,    // e.g., "team-1/build-app/doc-api-design"
  update: Uint8Array,      // The raw Yjs update binary
  socketId: string,        // Which connection made the change
}
```

**Key insight:** The `context` field contains whatever `onAuthenticate` returned. Our server currently returns `{ user: token || "anonymous" }`. If we pass structured tokens like `"agent:researcher"` vs `"user:john"`, we can distinguish agent vs user changes **at the Hocuspocus level** without needing Yjs-level observation.

**Current code** (HocuspocusServer.ts):
```typescript
async onChange({ document, documentName }) {
  await projectToFilesystem(documentName, document, repoPath);
}
```

This already fires on every change — we just need to add event emission here.

**Hocuspocus recommendation:** Debounce `onChange` handlers (they suggest 4000ms for heavy ops). For our use case, 500-1000ms is appropriate since we're just emitting events, not doing I/O.

### 2. Yjs `observeDeep` — Fine-Grained Change Detection

For more granular tracking (which keys changed in a Y.Map, which blocks were edited in XmlFragment), we can use `observeDeep`:

```typescript
// Observe all nested changes in a Y.Doc
const fragment = doc.getXmlFragment("content");
fragment.observeDeep((events, transaction) => {
  // events: Array<Y.Event> — each event describes one change
  // transaction.origin — can be set to identify source (e.g., "agent:researcher")
  for (const event of events) {
    if (event instanceof Y.YXmlEvent) {
      // event.changes.delta — insert/delete operations on children
      // event.changes.keys — Map of attribute changes
    }
  }
});
```

**Yjs event order** (from docs):
1. `ydoc.on('beforeTransaction')`
2. Transaction executes
3. `ytype.observe()` — type-level
4. `ytype.observeDeep()` — deep nested
5. `ydoc.on('afterTransaction')`
6. `ydoc.on('update')` — binary update

**Important:** `observeDeep` is synchronous and fires immediately during the transaction. For agent-to-orchestrator routing, we should use `ydoc.on('update')` or the Hocuspocus `onChange` hook which is post-transaction and debounce-friendly.

### 3. Distinguishing User vs Agent Changes — `transaction.origin`

Yjs transactions support an `origin` parameter:

```typescript
// Agent writes with origin tag
doc.transact(() => {
  map.set("status", { ... });
}, "agent:researcher");  // ← origin tag

// In observer, check origin
doc.on('update', (update, origin) => {
  if (typeof origin === 'string' && origin.startsWith('agent:')) {
    // Agent-originated change — don't re-trigger agent
  } else {
    // User or unknown origin — notify agents
  }
});
```

**However**, our agents write via `openDirectConnection` (in-process), which doesn't go through Hocuspocus's `onChange` hook in the same way as WebSocket clients. The Hocuspocus `onChange` hook includes a `socketId` — in-process connections have a synthetic socketId. We can track which socketIds belong to agents vs users.

**Better approach:** Use Hocuspocus `onAuthenticate` to tag connections:
- Frontend connects with token `"user:<userId>"` → `context = { type: "user", id: userId }`
- Agent `openDirectConnection` doesn't go through auth, but we can track these separately since they're in-process

### 4. Hocuspocus `onAwarenessUpdate` — Presence for Agent Activity

The `onAwarenessUpdate` hook fires when any client's awareness state changes. This is perfect for showing agent presence (cursors, activity status) in the BlockNote editor:

```typescript
// Agent sets awareness state
const awareness = provider.awareness;
awareness.setLocalStateField('user', {
  name: 'researcher',
  color: '#4A90D9',
  type: 'agent',
  activity: 'Analyzing OAuth2 patterns',
});
```

Currently, `CollabDocument.getPresence()` returns `[]` with `// TODO: wire to Hocuspocus awareness states in Phase 3`. This is the hook to implement it.

### 5. Existing `updateAgentStatus` in WorkerPool — Already Writes to CRDT

**WorkerPool.ts already has this:**
```typescript
private async updateAgentStatus(
  roleKey: string,
  status: "working" | "idle" | "error",
  details: { taskId: string; error?: string },
): Promise<void> {
  const l2 = this.memoryCoordinator?.L2;
  if (!l2) return;
  const space = l2.getOrCreateSpace(this.goalId || "default");
  const doc = await space.openDoc("agent-statuses");
  doc.getMap("agent-statuses").set(roleKey, {
    status,
    currentTask: status === "working" ? details.taskId : null,
    lastTask: details.taskId,
    error: details.error || null,
    updatedAt: new Date().toISOString(),
  });
}
```

This is called automatically on task start (`"working"`) and task end (`"idle"` or `"error"`). **Agent→doc push for status is already implemented.** The gap is:
- No intermediate progress updates during execution
- No writing of agent findings/results into user-facing collab docs
- No reading of user edits to inform ongoing agent work

### 6. `collab` Tool — Already Has Full Read/Write Capabilities

The `collab` tool (L2/tools/index.ts) already supports:
- `discover` — browse available CRDT docs, plans, output manifests
- `list` — show keys in a doc
- `read` / `read-block` — read structured data or rich text
- `write` / `write-block` — write structured data or rich text blocks

Agents already have this tool injected when `MemoryCoordinator` is available (WorkerPool.ts line ~300). **The agent CAN read and write collab docs today.** The issue is that:
- Agents don't know WHEN to read (no notification of user changes)
- Agents don't proactively write status/findings unless their system prompt tells them to
- There's no reactive loop connecting user edits → agent context

### 7. Filesystem Projection — Passive Read Path

`HocuspocusServer.onChange` already projects CRDT state to `.ping/collaboration/`:
- Y.Map → `.json` files
- Y.Array → individual `.json` files per item
- Y.Text → `.txt` files
- Y.XmlFragment → `.md` files (via `xmlFragmentToMarkdown`)

This means agents with workspace access can read projected files as a fallback, but the `collab` tool provides direct CRDT access which is real-time and preferred.

---

## Observed Issue — Cross-Agent Collab Visibility (2026-03-11)

### What Happened

User asked the **creator** agent to read the **analyst**'s work from the collab space. The creator found nothing:

```
User: "Can you read the collab document and check analyst"
Creator: "The analyst's output document does not contain any files or findings."

User: "There is nothing by Analyst in collab space. can you..."
Creator: "No findings or outputs from the analyst are currently available."
```

### Root Cause Analysis

The collab space scoping is correct — all agents get the same `CollaborationSpace` (keyed by `{teamId}/{goalId}`). The `goalId` is set by `OrchestratorService.approvePlan()` → `workerPool.setGoalContext()`, shared across all workers.

**The actual problem:** The analyst agent never wrote to the CRDT collab space during its work. Its output lives in:
1. `MemoryManager` → `output_data` field (stored on task completion)
2. Possibly in `.ping/outputs/` as an output manifest (if workspace was published)

But neither of these is visible via the `collab` tool's `discover` → `read` flow for CRDT docs. The `collab` tool CAN read output manifests (via `outputs` category), but only if `AgentWorkspace.publish()` was called.

**Flow that works:**
- Creator → `collab write` → data lands in CRDT → any agent can read it ✅

**Flow that doesn't:**
- Analyst completes task → output stored in MemoryManager → NOT written to CRDT
- Creator → `collab read` → nothing from analyst ❌

### What This Confirms

This is the exact gap documented in the feature architecture:
- Agents don't proactively write status/findings to collab docs unless their system prompt explicitly tells them to
- There's no automatic bridge from task output → CRDT collab space
- Agents can't see each other's work in the collaboration space unless each agent individually calls `collab write`

### Additional Evidence (same session)

Creator agent explored the full collab space and found:

| Category | What's There | Where It Actually Lives |
|----------|-------------|------------------------|
| `agent-statuses` (CRDT) | Some status entries from auto-updates | Written by `WorkerPool.updateAgentStatus()` — ✅ the only auto-write that works |
| `crdt` docs | **Empty** — no entries | Agents never called `collab write` to populate CRDT docs |
| `outputs` → task-1 (analyst) | **No files** | Analyst completed task but output wasn't published as manifest |
| `outputs` → task-2 (strategist) | 1 file: `campaign_strategy.md` | Written via `AgentWorkspace.publish()` → `.ping/outputs/` |
| `plans` | Empty | Plans exist in PlanStore but may not be queryable from this context |

**Three separate storage locations, none connected:**
1. **MemoryManager** → `output_data` (task completion) — invisible to `collab` tool
2. **Output manifests** → `.ping/outputs/` files — visible via `collab discover outputs` but only if published
3. **CRDT docs** → Yjs documents — visible via `collab discover crdt` but **nothing gets auto-written here**

The `agent-statuses` CRDT doc is the ONLY doc that gets auto-populated (by `WorkerPool.updateAgentStatus()`). Everything else requires the agent to explicitly call `collab write` or `collab write-block`.

### Potential Fixes (ranked by effort)

1. **Prompt fix (P0, zero code):** Add to agent system prompts: "After completing significant work, use the `collab` tool to write your findings to the shared space so other agents can see them."

2. **Auto-publish to CRDT (P1, small code):** When `WorkerPool` receives `worker:done`, automatically write the output summary to the collab space as a CRDT entry.

3. **Communication Agent (P2, medium code):** The dual-agent architecture — Communication Agent automatically posts findings to collab space as Task Agent works.

4. **Context injection (P1, small code):** When building task context in `WorkerPool.buildMessageWithContext()`, inject relevant collab doc content alongside dependency outputs.
