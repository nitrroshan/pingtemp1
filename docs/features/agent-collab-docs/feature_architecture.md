# Agent ↔ Collab Docs: Real-Time Bidirectional Information Flow

## Core Goal

**Work and discussion are parallel streams. An agent never stops working because there's a conversation happening.**

The feature should enable:

1. **Users see agent work live** — visibility into what agents are doing, what they've decided, what they're stuck on
2. **Users can converse** — edit collaborative documents, comment on current info, get task updates
3. **Agents work on tasks and can be interrupted** — but ONLY when:
   - There's an **actual diversion** from current work (user changed requirements)
   - Human **explicitly asks to stop**
   - NOT every time a human asks a question or makes a comment
4. **Discussions do NOT stop agents** — discussions happen in parallel to task execution. An agent keeps coding/researching while a conversation thread is active
5. **Agent-to-agent discussions** — agents can discuss with each other to unblock. These discussions also don't pause work
6. **Agents start doing known things immediately** — don't wait for every unknown to be resolved before beginning. Work on what's clear NOW
7. **Unknowns are resolved in parallel** — while the Task Agent works on known parts, the Communication Agent can seek answers to unknowns (from humans, other agents, or its own research)
8. **Real-time discussions between agents and humans for decisions** — all in the same collaborative space where the work product lives

### The Principle

```
Traditional:    Think → Discuss → Decide → Work → Discuss → Decide → Work
                [blocked]         [blocked]        [blocked]

Our approach:   Work on known ──────────────────────────────────────────►
                    │ in parallel │              │
                    ▼             ▼              ▼
                Discuss unknown₁  Discuss unknown₂  Decision arrives
                (with human/agent) (agent-to-agent)  → redirect work
```

An agent that's building an API doesn't stop coding because someone asked "should we use OAuth or API keys?" — it starts building with what it knows (REST structure, endpoints, validation) and the Communication Agent handles the discussion. When the decision arrives, the Task Agent adjusts.

---

## Discussion: Dual-Agent Per Node (Task + Communication)

### The Idea

Every worker node should have **two agents** running in parallel:

1. **Task Agent** — works on the actual task (coding, researching, designing, etc.)
2. **Communication Agent** — runs in parallel, handling:
   - Posting status/findings to collab docs
   - Reading user edits from collab docs
   - Participating in group discussions & decisions
   - Updating agent-statuses CRDT doc

They are conceptually **one entity** — they share context (same memory, same CRDT docs, same conversation history). But they operate as **two concurrent threads** so the task agent never needs to pause to communicate, and the communication agent never waits for the task to finish.

```
┌─────────────────────────────────────────────────┐
│                Worker Node (role: "researcher")  │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │   Task Agent      │  │  Communication Agent  │ │
│  │   (System 2)      │  │  (System 1)           │ │
│  │                   │  │                       │ │
│  │  - Deep work      │  │  - Read user edits    │ │
│  │  - Tool calls     │  │  - Post to collab doc │ │
│  │  - Code/research  │  │  - Status updates     │ │
│  │  - Analysis       │  │  - Group chat replies  │ │
│  └────────┬──────────┘  └───────────┬───────────┘ │
│           │     Shared Context      │             │
│           └────────────┬────────────┘             │
│                        │                          │
│           ┌────────────┴────────────┐             │
│           │  Shared State:          │             │
│           │  - CRDT docs (Yjs)     │             │
│           │  - Task context         │             │
│           │  - LangGraph thread     │             │
│           │  - Workspace files      │             │
│           └─────────────────────────┘             │
└─────────────────────────────────────────────────┘
```

### Academic Validation: DPT-Agent (ACL 2025) — Almost Exactly This Pattern

**Paper:** [arXiv:2502.11882](https://arxiv.org/abs/2502.11882) — "Leveraging Dual Process Theory in Language Agent Framework for Real-time Simultaneous Human-AI Collaboration"
**Authors:** Zhang, Wang, et al. (SJTU + Tencent)
**Venue:** ACL 2025 Main Conference (top-tier NLP venue)
**Code:** [github.com/sjtu-marl/DPT-Agent](https://github.com/sjtu-marl/DPT-Agent)

**What they built:** DPT-Agent — the first language agent framework that achieves real-time simultaneous human-AI collaboration. It's based on **Dual Process Theory** from cognitive psychology (Kahneman's "Thinking, Fast and Slow"):

- **System 1 (Fast, Intuitive):** Uses a Finite-state Machine (FSM) + code-as-policy for fast, reactive decisions. Handles immediate responses without waiting for deep reasoning. **This maps to your Communication Agent.**

- **System 2 (Slow, Deliberative):** Uses Theory of Mind (ToM) + asynchronous reflection for deeper reasoning, strategy inference, and complex decisions. Runs in parallel. **This maps to your Task Agent.**

**Key findings:**
- **Both systems run concurrently** — System 1 provides real-time responsiveness while System 2 does heavy thinking
- **Shared context** — System 2's reasoning results feed back into System 1's decision-making via a shared state
- **Significant performance improvements** over single-process agents in real-time tasks
- Without the dual process, agents either respond too slowly (all System 2) or make poor decisions (all System 1)
- **System 2's asynchronous reflection** doesn't block System 1's fast reactions — exactly the non-blocking property you want

**Why this validates your idea:**
- They proved that splitting one agent into fast (communication) + slow (task) processes with shared state **works better** than either alone
- It's accepted at ACL 2025 (top venue) — this isn't speculative, it's peer-reviewed
- Their domain is different (game collaboration) but the architectural pattern is identical to what you're proposing

---

### Related Work: Parallelized Planning-Acting (Mar 2025)

**Paper:** [arXiv:2503.03505](https://arxiv.org/abs/2503.03505) — "Parallelized Planning-Acting for Efficient LLM-based Multi-Agent Systems in Minecraft"

**Architecture: Dual-thread design:**
- **Planning thread** — driven by centralized memory, handles dynamic decision-making and agent communication
- **Acting thread** — executes tasks via a skill library, does recursive decomposition

**Key design:** The threads run concurrently with an **interruptible execution** mechanism — the planning thread can interrupt the acting thread when conditions change. This maps to: Communication Agent detects user edit → interrupts/redirects Task Agent.

### Related Work: Dual-Loop Edge-Terminal Collaboration (Sep 2025)

**Paper:** [arXiv:2509.04993](https://arxiv.org/abs/2509.04993) — "LLM Enabled Multi-Agent System for 6G Networks: Dual-Loop Edge-Terminal Collaboration"
**Venue:** IEEE Communications Magazine

**Architecture:**
- **Outer loop:** Global agent coordinates sub-agents — task decomposition + parallel distribution
- **Inner loop:** Sub-agents with dedicated roles cyclically reason, execute, and replan

Validates the dual-loop concept in production systems (networking/telecom), showing it scales.

---

### Analysis: Pros, Cons, Benefits

#### Pros

| Benefit | Explanation |
|---------|-------------|
| **Non-blocking communication** | Task Agent never pauses to post updates. Communication Agent handles all I/O with collab docs, user edits, group chat — task execution throughput stays maximum. |
| **Real-time responsiveness** | User edits a doc → Communication Agent sees it immediately and can react (update context, post acknowledgment) without waiting for Task Agent to finish its current tool call. |
| **Better user experience** | Users see continuous activity — the Communication Agent posts status updates ("Analyzing OAuth2 patterns..."), while Task Agent works. No long silences. |
| **Cognitive science backing** | Dual Process Theory (Kahneman) is well-established. DPT-Agent (ACL 2025) empirically validates that splitting fast/slow processes improves both speed and quality. |
| **Clean separation of concerns** | Task logic stays clean — no communication code interleaved. Communication logic is centralized — consistent behavior across all roles. |
| **Scalable pattern** | Each role gets the same dual-agent structure. Communication Agent behavior can be standardized (same system prompt template) while Task Agent is role-specific. |
| **Graceful degradation** | If Communication Agent fails or stalls, Task Agent keeps working. If Task Agent stalls, Communication Agent can report the issue to the user/orchestrator. |
| **Conflict-free CRDT writes** | Communication Agent handles all doc writes for its role — no race conditions between task execution and status updates since one agent manages the doc interface. |

#### Cons

| Risk | Explanation | Mitigation |
|------|-------------|------------|
| **2x LLM cost** | Every worker now makes twice the LLM calls. Each Communication Agent invocation is an API call. | Use a **cheaper/faster model** for Communication Agent (e.g., GPT-4o-mini vs GPT-4o for Task Agent). Communication tasks are simpler — summarizing, status formatting, reading changes. |
| **Context synchronization complexity** | The two agents need shared state but can't corrupt each other's context. Race conditions when both try to update the same LangGraph thread. | Use **CRDT docs as the shared state** (already conflict-free by design). Communication Agent reads CRDT + task progress, writes to CRDT. They share the Y.Doc, not the LangGraph thread. Each has its own thread_id. |
| **Coherence risk** | Communication Agent might summarize Task Agent's work incorrectly if it doesn't have full context of what Task Agent is thinking. | Communication Agent reads Task Agent's outputs from the shared CRDT state (agent-statuses, workspace files, tool call results). It doesn't guess — it reports what's observable. |
| **Added latency for coordination** | Synchronizing two agents adds overhead (reading shared state, deciding when to post). | Communication Agent runs on a **timer or event-driven loop**, not synchronous with Task Agent. Minimal coordination — they share data structures, not control flow. |
| **Complexity in agent lifecycle** | Starting, stopping, error handling for two agents per worker instead of one. Need to ensure both start and both stop. | WorkerPool manages the pair as a unit. `createDualWorker(role)` → returns `{ taskAgent, commAgent }`. Both tied to the same taskId lifecycle. |
| **Potential duplicate work** | Communication Agent might read a doc that Task Agent already read via its `collab` tool — wasted tokens. | Acceptable overlap. Communication Agent's reads serve a different purpose (reactive monitoring) vs Task Agent's reads (on-demand data retrieval). |

#### When This Pattern is MOST Valuable

- **Long-running tasks** (>30 seconds) — user needs status updates during execution
- **Human-in-the-loop workflows** — user is actively editing docs while agent works
- **Multi-agent tasks** — agents need to coordinate with each other via shared docs
- **Time-sensitive decisions** — user's edits should redirect agent work without waiting

#### When This Pattern is OVERKILL

- **Simple chat interactions** — user sends message, agent responds. No parallelism needed.
- **Fast tasks** (<5 seconds) — task finishes before communication agent adds value
- **No shared documents** — if there's nothing to monitor/update, dual agent adds cost for no benefit

---

### Comparison: How Others Approach This

| System | Architecture | Shared State | Parallel? | Human-in-the-loop? |
|--------|-------------|-------------|-----------|---------------------|
| **DPT-Agent (ACL 2025)** | System 1 (FSM) + System 2 (ToM reflection) | Shared observations + reflection results | ✅ Concurrent | ✅ Real-time |
| **Parallelized Planning-Acting** | Planning thread + Acting thread | Centralized memory + skill library | ✅ Concurrent + interruptible | ❌ Agent-only |
| **CrewAI** | Single agent per role, delegate/ask tools | Task output passed as context | ❌ Sequential | ❌ |
| **AutoGen** | Single agent per turn in conversation | Shared conversation history | ❌ Turn-based | ⚠️ Approval only |
| **LangGraph** | Single agent per node, edges = transitions | Graph state | ❌ Sequential nodes | ❌ |
| **Our Proposal** | Task Agent + Communication Agent per node | CRDT docs + workspace + thread context | ✅ Concurrent | ✅ Real-time co-editing |

**Key insight:** Only DPT-Agent has a validated dual-process architecture. Everyone else uses single-agent-per-role. But DPT-Agent is for game environments — **nobody has applied this pattern to document collaboration yet.**

---

### How It Would Work in Our System

```
User types in BlockNote editor
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Hocuspocus onChange → DocWatcher → "doc:userEdit" event │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │  OrchestratorService          │
         │  Routes event to relevant     │
         │  Communication Agent(s)       │
         └───────┬───────────────────────┘
                 │
    ┌────────────┴────────────────────────┐
    │  Worker Node: "researcher"          │
    │                                     │
    │  Communication Agent                │
    │   ├─ Reads user's latest edits      │
    │   ├─ Summarizes what changed        │
    │   ├─ Posts to CRDT: "Noticed you    │
    │   │  added rate limiting needs.     │
    │   │  Adjusting research scope."     │
    │   ├─ Updates agent-statuses doc     │
    │   └─ Optionally: writes a signal    │
    │      to shared state that Task      │
    │      Agent reads on next iteration  │
    │                                     │
    │  Task Agent (running in parallel)   │
    │   ├─ Working on OAuth2 research     │
    │   ├─ On next tool call, checks      │
    │   │  shared state for new context   │
    │   ├─ Sees "rate limiting" signal    │
    │   ├─ Adjusts research direction     │
    │   └─ Continues executing            │
    └─────────────────────────────────────┘
```

### Bottom Line

**The idea is sound, validated by peer-reviewed research (ACL 2025), and nobody has applied it to CRDT document collaboration.** The main trade-off is 2x LLM cost (mitigated by using a cheaper model for Communication Agent) vs significantly better real-time responsiveness and user experience. This is a strong differentiator for the platform.

We'll discuss implementation feasibility against the current codebase (WorkerPool, InternalAgent, LangGraph threads) separately.

---

## Feature Design: Real-Time Discussions + Non-Blocking Work

### Interrupt Classification — When Should an Agent Actually Stop?

Not all user activity is an interrupt. The Communication Agent classifies incoming signals:

```
┌──────────────────────────────────────────────────────────┐
│  Signal from user/agent/doc                               │
│                                                           │
│  Communication Agent classifies:                          │
│                                                           │
│  ┌─────────────────┐   ┌─────────────────────────────┐   │
│  │ INFORMATIONAL    │   │ Examples:                    │   │
│  │ → Don't stop     │   │ - User commented on doc     │   │
│  │ → Log it         │   │ - Agent asked a question    │   │
│  │ → Reply if needed│   │ - User viewing task status  │   │
│  └─────────────────┘   └─────────────────────────────┘   │
│                                                           │
│  ┌─────────────────┐   ┌─────────────────────────────┐   │
│  │ CONTEXTUAL       │   │ Examples:                    │   │
│  │ → Don't stop     │   │ - User added new info to doc│   │
│  │ → Feed into next │   │ - Another agent shared      │   │
│  │   task iteration │   │   findings in CRDT doc      │   │
│  └─────────────────┘   │ - Discussion concluded with  │   │
│                         │   a decision                 │   │
│                         └─────────────────────────────┘   │
│                                                           │
│  ┌─────────────────┐   ┌─────────────────────────────┐   │
│  │ REDIRECT         │   │ Examples:                    │   │
│  │ → Signal Task    │   │ - User changed requirements │   │
│  │   Agent to shift │   │ - Decision made that changes│   │
│  │   direction on   │   │   approach (OAuth→API keys) │   │
│  │   next iteration │   │ - Dependency task output     │   │
│  └─────────────────┘   │   changes scope              │   │
│                         └─────────────────────────────┘   │
│                                                           │
│  ┌─────────────────┐   ┌─────────────────────────────┐   │
│  │ HARD STOP        │   │ Examples:                    │   │
│  │ → Interrupt Task │   │ - User says "stop"          │   │
│  │   Agent NOW      │   │ - Orchestrator cancels task │   │
│  │ → Halt execution │   │ - Critical error detected   │   │
│  └─────────────────┘   └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

Key rule: **Only HARD STOP interrupts the Task Agent mid-execution.** Everything else is handled by the Communication Agent and fed to the Task Agent as context for its next iteration — the Task Agent keeps working.

### Discussion Model — Where Discussions Happen

Discussions live in the **same CRDT space** as the work artifacts. This means:
- Users see discussions and work in one place
- Agents can reference work while discussing
- Discussion history persists and is searchable

```
Collaborative Space (per goal)
├── doc-api-design          ← Work artifact (user + agents co-edit)
├── doc-api-design-comments ← Discussion thread (comments, questions, decisions)
├── agent-statuses          ← Live status (who's working on what)
├── discussion-auth-choice  ← Focused discussion: "OAuth vs API keys?"
└── chat-outcomes           ← Concluded discussion decisions
```

#### Three Discussion Types

**1. Inline Comments (on work artifacts)**
User highlights text in `doc-api-design` and comments: "Should this use rate limiting?"
→ Communication Agent sees comment, responds in thread
→ Task Agent keeps working, gets the comment context on next cycle

**2. Focused Discussions (for decisions)**
A dedicated CRDT doc like `discussion-auth-choice` with structured format:
```markdown
## Discussion: OAuth vs API Key Authentication
**Status:** OPEN | Participants: user, researcher, backend
**Context:** API design task-003 needs auth strategy

### Arguments
- **researcher:** OAuth2 is industry standard for user-facing APIs...
- **backend:** API keys simpler for MVP, OAuth later...
- **user:** Let's start with API keys, switch later.

### Decision: API Keys for MVP (decided by user)
```
→ When decision is reached, Communication Agent writes to `chat-outcomes` and signals Task Agent with a REDIRECT

**3. Agent-to-Agent Discussions (unblocking)**
```markdown
## Discussion: Database Schema for User Roles
**Status:** OPEN | Participants: backend, frontend
**Context:** Both tasks need aligned data model

### Thread
- **backend:** Proposing RBAC with roles table...
- **frontend:** Need role names in JWT claims for UI routing...
- **backend:** Added `role_name` to JWT payload spec.

### Decision: RBAC with role_name in JWT (agents agreed)
```
→ No human needed. Agents self-resolve. If they can't, escalate to user.

### Agent Behavior: Work on Known, Discuss Unknown

```
Task Agent receives: "Build REST API for user management"

What's KNOWN:                    What's UNKNOWN:
├── Need CRUD endpoints          ├── Auth strategy (OAuth vs API key)
├── Need User model              ├── Database choice (Postgres vs Mongo)
├── Need validation              └── Rate limiting requirements
├── Need error handling
└── Need route structure

Task Agent:                      Communication Agent (parallel):
├── Start building endpoints     ├── Opens discussion: "auth-choice"
├── Create User model            │   Posts question to collab doc
├── Add validation logic         ├── Opens discussion: "db-choice"
├── Write error handlers         │   Asks backend agent for opinion
│                                ├── Monitors for decisions
│   [auth decision arrives]      ├── Decision: "API keys"
│   ← REDIRECT signal ──────────┤   Writes to shared state
├── Add API key middleware       │
│   [db decision arrives]        ├── Decision: "Postgres"
│   ← REDIRECT signal ──────────┤   Writes to shared state
├── Switch to Postgres schema    │
└── Continue building            └── Posts status updates throughout
```

The Task Agent built the route structure, model, validation, and error handling while the unknowns were being discussed. Zero wasted time. When decisions arrived, it incorporated them — potentially refactoring some work, but always better than waiting idle.

### What Users See

```
┌─────────────────────────────────────────────────────────────────┐
│  Ping — Team Workspace                                          │
│                                                                  │
│  ┌─────────┐  ┌────────────────────────────────────────────────┐│
│  │ Sidebar  │  │  doc-api-design (collaborative editor)         ││
│  │          │  │                                                 ││
│  │ 📄 Docs  │  │  # API Design                                  ││
│  │  api-     │  │                                                ││
│  │  design  │  │  ## Endpoints (by backend)    ← agent wrote     ││
│  │          │  │  POST /users                                    ││
│  │ 💬 Disc.  │  │  GET /users/:id                                ││
│  │  auth-   │  │  ...                                           ││
│  │  choice  │  │                                                 ││
│  │  db-     │  │  ## Auth Strategy              ← user's section ││
│  │  choice  │  │  Let's use API keys for MVP    ← user typed     ││
│  │          │  │                                                 ││
│  │ 🤖 Status │  │  ## Research Findings (by researcher)           ││
│  │  🔍 resear│  │  API key patterns: ...        ← agent posted   ││
│  │  cher:   │  │                                                 ││
│  │  Working │  │  > 💬 Comment by researcher:                    ││
│  │  on auth │  │  > "Noted API keys choice.                     ││
│  │  patterns│  │  >  Adjusting research to key                  ││
│  │          │  │  >  rotation best practices."                   ││
│  │  🔧 back- │  │                                                 ││
│  │  end:    │  │                                                 ││
│  │  Building│  │                                                 ││
│  │  routes  │  │                                                 ││
│  └─────────┘  └────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

The user sees:
- **Live agent status** in the sidebar (who's doing what)
- **Agent contributions** appearing in the shared doc in real-time
- **Discussions** in dedicated docs or inline comments
- **Their own edits** integrated by agents without needing to "send" anything

---

## What We Already Have

The codebase has significant infrastructure already built:

| Component | Location | Status |
|-----------|----------|--------|
| **Hocuspocus CRDT server** | `memory/L2/collaboration/HocuspocusServer.ts` | ✅ Built — file-backed Yjs server with WebSocket + in-process access |
| **CollabDocument** | `memory/L2/collaboration/CollabDocument.ts` | ✅ Built — typed Y.Doc wrapper with Map, Array, XmlFragment, Text accessors |
| **CollaborationSpace** | `memory/L2/collaboration/CollaborationSpace.ts` | ✅ Built — per-goal namespace with doc isolation |
| **`collab` tool** | `memory/L2/tools/index.ts` | ✅ Built — agents can discover/list/read/write/write-block/read-block |
| **BlockNote helpers** | `memory/L2/tools/index.ts` | ✅ Built — `insertParagraph`, `insertHeading`, `markdownToBlocks`, `xmlFragmentToText` |
| **Frontend editor** | `AgentChat/components/CollaborativeEditor.tsx` | ✅ Built — BlockNote + HocuspocusProvider, presence bar |
| **Filesystem projection** | `HocuspocusServer.ts` (`onChange`) | ✅ Built — CRDT state auto-projects to `.ping/collaboration/` |
| **RemoteCollabClient** | `memory/L2/collaboration/RemoteCollabClient.ts` | ✅ Built — WebSocket-based provider for distributed setups |

### Current Gap

The infrastructure exists but the **workflow integration** is missing. Right now:
- Agents CAN write to collab docs (via `collab` tool) but only do so **when explicitly asked** or during task execution.
- Agents CAN read from collab docs but only **on-demand** (not reactively).
- There's no **automatic push** of agent status/progress into a user's working document.
- There's no **automatic pull** that triggers agent re-evaluation when a user edits a collab doc.

## Architecture Options

### Option A: Event-Driven Reactive Sync (Recommended)

**Implementation:** Use Yjs `observeDeep` on collab documents to detect user edits. When a user modifies a doc, emit an event that wakes the relevant agent(s) to read the latest content. For agent→doc pushes, agents write to designated sections/keys in the doc during task execution lifecycle events (start, progress, complete).

**Data Flow:**

```
┌──────────────────────────────────────────────────────────┐
│                    Hocuspocus Server                      │
│                  (Single Y.Doc instance)                  │
│                                                           │
│   ┌─────────────┐              ┌──────────────────┐      │
│   │  Frontend    │◄────CRDT────►│  Agent Worker    │      │
│   │  BlockNote   │    sync      │  (collab tool)   │      │
│   └─────────────┘              └──────────────────┘      │
│         │                              │                  │
│         │ User types/edits             │ Agent writes     │
│         ▼                              ▼                  │
│   ┌──────────────────────────────────────────────┐       │
│   │              Y.Doc (shared state)             │       │
│   │                                               │       │
│   │  XmlFragment("content")  ← rich text blocks   │       │
│   │  Map("agent-status")     ← agent status data  │       │
│   │  Map("user-context")     ← user's latest edits│       │
│   └──────────────────────────────────────────────┘       │
│         │                              │                  │
│     observeDeep                    observeDeep            │
│         ▼                              ▼                  │
│   Agent reacts to                User sees agent          │
│   user changes                   updates live             │
└──────────────────────────────────────────────────────────┘
```

**How agents POST info to collab docs:**
1. When a task starts → agent writes `{ status: "in_progress", startedAt, description }` to `agent-statuses` doc.
2. During execution → agent periodically calls `collab({ action: "write-block", ... })` to push findings/progress into the shared document.
3. On completion → agent writes final output as a rich text section with heading + results.
4. Agent status map is always kept current so the user can glance at who's doing what.

**How agents PULL info from collab docs:**
1. `DocWatcher` service observes `Y.Doc` changes via `observeDeep`.
2. When user edits a doc, the watcher debounces (500ms) then emits a `doc:userEdit` event with the document name and changed content.
3. OrchestratorService listens for `doc:userEdit` and decides if any running agent needs the updated context.
4. If relevant, the orchestrator injects the latest doc content into the agent's next invocation context (as a system message or tool result).

**Pros:**
- Uses existing Yjs infrastructure — no new server or protocol needed
- Real-time in both directions (CRDT handles conflict resolution)
- Debounced observation prevents agent thrashing on rapid user edits
- BlockNote editor already renders agent-written XmlFragment blocks live
- Filesystem projection (`onChange`) means agents can also read `.ping/collaboration/*.md` files as fallback

**Cons:**
- Needs careful debouncing to avoid overwhelming agents with minor edits
- Agent writes during execution add latency to the agent tool call chain
- Requires clear doc section conventions to avoid agents overwriting user content

**Effort:** Medium — mostly wiring existing components together + DocWatcher service

---

### Option B: Polling-Based Sync with Snapshot Diffs

**Implementation:** Instead of reactive events, agents periodically poll collab docs on a timer (every 5-10 seconds). A `DocSnapshotService` takes snapshots of doc state and diffs them. If significant changes are detected, give the diff to the agent. For agent→doc pushes, same as Option A (direct writes via `collab` tool).

**Data Flow:**

```
┌────────────┐    timer (5s)     ┌──────────────────┐
│  DocSnapshot│──────────────────►│  Diff Engine     │
│  Service    │                   │  (compare states)│
└────────────┘                   └────────┬─────────┘
                                          │ if changed
                                          ▼
                                 ┌──────────────────┐
                                 │  Agent gets new   │
                                 │  context on next   │
                                 │  invocation        │
                                 └──────────────────┘
```

**Pros:**
- Simpler implementation — no event wiring
- Predictable load — agents check on fixed intervals
- Easy to tune frequency per agent/document

**Cons:**
- 5-10 second latency between user edit and agent awareness
- Wasted polls when nothing changed
- Diffing logic adds complexity
- Doesn't leverage Yjs's built-in change observation

**Effort:** Medium — need snapshot storage + diff engine + polling scheduler

---

### Option C: Hybrid Channel Architecture

**Implementation:** Introduce a `CollabChannel` abstraction that wraps a collab doc and exposes two sub-channels: an "agent-feed" (structured JSON writes from agents) and a "user-workspace" (rich text from user). The channel manages bidirectional sync with smart merging rules. Agents subscribe to the channel and receive parsed user content as structured messages.

**Data Flow:**

```
┌─────────────────────────────────────────────┐
│              CollabChannel                   │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │  Agent Feed   │    │  User Workspace    │  │
│  │  (Y.Map)      │    │  (Y.XmlFragment)   │  │
│  │               │    │                    │  │
│  │  status: {}   │    │  [user's rich text]│  │
│  │  findings: [] │    │                    │  │
│  │  suggestions: │    │                    │  │
│  └──────┬───────┘    └────────┬───────────┘  │
│         │                     │               │
│    agents write          user edits           │
│    agents read ◄─────── parsed to agents      │
│         │                     │               │
│         ▼                     ▼               │
│  ┌──────────────────────────────────────┐    │
│  │  CollabChannel.onChange()             │    │
│  │  - Debounce user edits               │    │
│  │  - Parse XmlFragment → text          │    │
│  │  - Emit to subscribed agents         │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Pros:**
- Clean separation between agent data and user content
- Structured agent feed prevents UI clutter
- Channel abstraction is reusable across features
- Agents get parsed/structured user input, not raw CRDT

**Cons:**
- New abstraction layer on top of existing CollabDocument
- More code to maintain
- Risk of over-engineering if needs are simple
- Frontend needs to render both agent feed and user workspace views

**Effort:** High — new abstraction + frontend changes + subscription management

## Recommendation

**Option A: Event-Driven Reactive Sync** — because it builds directly on what exists. The Hocuspocus server, CollabDocument, `collab` tool, and BlockNote editor are already wired up. The main missing piece is a `DocWatcher` that uses Hocuspocus `onChange` hook and Yjs `observeDeep` to detect changes and route them to the orchestrator. Agent writes already work via the `collab` tool's `write-block` action.

> **Research:** See [research.md](research.md) for full external research (AWCP, ViviDoc, MToM, ChatDev, MetaGPT, AutoGen, Devin, DPT-Agent, multi-agent debate papers) and internal codebase analysis (Hocuspocus hooks, Yjs observation, existing collab tool capabilities, WorkerPool status writes).

---

## Solution Design (Option A: Event-Driven Reactive Sync)

### Component 1: `DocWatcher` Service

A new service that bridges Hocuspocus `onChange` events to the orchestrator.

```
Location: src/worker/memory/L2/collaboration/DocWatcher.ts
```

**Responsibilities:**
- Listen to Hocuspocus `onChange` hook
- Distinguish user vs agent changes (via context/origin tracking)
- Debounce rapid edits (configurable, default 1000ms per document)
- Emit `doc:userEdit` events with document name, changed content summary, and space context
- Maintain a set of "watched" documents (not all docs need agent reactivity)

**Key design decision:** The DocWatcher should be a Hocuspocus **extension** (custom class implementing the hook interface), not a standalone observer. This is the Hocuspocus-recommended pattern for extending server behavior.

```typescript
// Pseudocode
class DocWatcherExtension {
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private events: EventEmitter;
  
  async onChange({ documentName, document, context, socketId }) {
    // Skip if change came from an agent (in-process connection)
    if (this.isAgentConnection(socketId)) return;
    
    // Debounce per document
    clearTimeout(this.debounceTimers.get(documentName));
    this.debounceTimers.set(documentName, setTimeout(() => {
      // Read current content and emit
      const content = this.extractContent(document);
      this.events.emit("doc:userEdit", {
        documentName,
        content,
        timestamp: new Date().toISOString(),
      });
    }, 1000));
  }
}
```

### Component 2: Orchestrator Integration — Context Injection

The `OrchestratorService` subscribes to `doc:userEdit` and decides how to act.

**Two strategies:**

**A) Immediate re-prompt (for chat-like interactions):**
When user edits a doc that an agent is actively working on, send the updated content as a new message to the agent's LangGraph thread.

**B) Next-invocation injection (for task-based work):**
Store the latest doc content. When the agent is next invoked (e.g., for a follow-up task), prepend the latest doc state as context.

For MVP, **strategy B is simpler and safer** — it avoids interrupting in-flight agent executions.

```typescript
// In WorkerPool.buildMessageWithContext()
private buildMessageWithContext(task: TaskWithContext): string {
  let msg = task.description;
  
  // NEW: Inject relevant collab doc content
  if (this.watchedDocs.has(task.assigned_role)) {
    const docContent = await this.readCollabDoc(docName);
    if (docContent) {
      msg += `\n\n## Live Document Context (from user's editor):\n${docContent}`;
    }
  }
  
  // ... existing context injection
}
```

### Component 3: Agent System Prompt Enhancement

Agents need clear instructions to:
1. Use the `collab` tool to post findings to the shared document
2. Update their status with descriptive activity messages
3. Write to designated sections to avoid overwriting user content

This is a prompt engineering task — add to the agent's system prompt during worker creation:

```
## Collaboration Protocol
You have access to a shared document that the user is actively editing.
- Use collab({ action: "write-block", docName: "...", key: "Your Section Name", value: "..." }) 
  to post your findings, suggestions, or status updates.
- Always write under a heading with your role name to avoid overwriting user content.
- Use collab({ action: "read-block", docName: "..." }) to check what the user has written.
- Update your status: collab({ action: "write", docName: "agent-statuses", key: "<role>", 
  value: { status: "working", activity: "..." } })
```

### Component 4: Frontend — Already Works

The `CollaborativeEditor.tsx` component already:
- Connects to Hocuspocus via `HocuspocusProvider`
- Syncs `Y.XmlFragment("content")` with BlockNote
- Shows a presence bar with connected users

When an agent writes blocks via `collab write-block`, the CRDT sync automatically propagates to all connected BlockNote editors. **No frontend changes needed for the MVP.**

### Component 5: Agent Status Sidebar (Enhancement)

Currently, the `agent-statuses` CRDT doc is written by `WorkerPool.updateAgentStatus()` but there's no dedicated frontend widget reading it. The `CollabFileTree` in App.tsx lists docs but doesn't render status.

**Enhancement:** A small React component that subscribes to the `agent-statuses` document via Hocuspocus and renders a live list:

```
🔍 researcher — Analyzing OAuth2 patterns (task-003)
🔧 backend    — idle
🎨 frontend   — Building login form (task-005)
```

---

## Integration Points (Detailed)

| Existing Component | What Exists | What's Needed |
|-------------------|-------------|---------------|
| `HocuspocusServer` (onChange) | Projects CRDT → filesystem | Add DocWatcher extension to emit `doc:userEdit` events |
| `HocuspocusServer` (onAuthenticate) | Returns `{ user: token }` | Enhance to tag `{ type: "user"/"agent", id }` for origin detection |
| `WorkerPool.updateAgentStatus()` | Writes status on task start/end | Add intermediate progress writes during execution |
| `WorkerPool.runTask()` | Creates agent with collab tool | Inject collab doc context into task message |
| `collab` tool | Full read/write/discover | Add agent system prompt guidance for proactive doc updates |
| `CollaborativeEditor.tsx` | BlockNote + HocuspocusProvider | No changes needed — agent writes appear automatically |
| `OrchestratorService` | Subscribes to task lifecycle events | Subscribe to `doc:userEdit` for context routing |
| `CollabDocument.getPresence()` | Returns `[]` (stub) | Wire to Hocuspocus awareness for agent cursors |

## New Types Needed

```typescript
// DocWatcher event — emitted when a user edits a watched collab doc
interface DocChangeEvent {
  spaceId: string;           // e.g., "team-1/build-app"
  docName: string;           // e.g., "doc-api-design"
  fullDocName: string;       // e.g., "team-1/build-app/doc-api-design"
  changedBy: "user" | "agent";
  userId?: string;           // If user
  agentRole?: string;        // If agent
  socketId: string;          // Hocuspocus socketId for the connection
  contentSummary: string;    // Plain text excerpt of changed content (truncated)
  timestamp: string;
}

// Agent status entry (already written by WorkerPool.updateAgentStatus)
// Enhanced with activity description
interface AgentStatusEntry {
  role: string;
  taskId: string | null;
  status: "idle" | "working" | "blocked" | "error";
  currentActivity?: string;   // e.g., "Researching API patterns"
  lastUpdated: string;
  progress?: number;          // 0-100 (optional)
  error?: string | null;
}

// Configuration for which docs an agent should watch/write
interface DocContextConfig {
  docName: string;
  watchForChanges: boolean;    // Should agent react to user edits?
  injectOnExecution: boolean;  // Prepend doc content before each agent call?
  writeSections: string[];     // Section headings this agent can write to
}

// DocWatcher configuration
interface DocWatcherConfig {
  debounceMs: number;          // Default: 1000ms
  maxDebounceMs: number;       // Maximum debounce: 5000ms
  watchedPatterns: string[];   // Doc name patterns to watch (e.g., "doc-*")
  ignoreAgentOrigin: boolean;  // Skip events from agent connections (default: true)
}
```

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Agent thrashing on rapid user edits | Debounce at 1000ms, configurable. Don't interrupt in-flight agent calls. |
| Agents overwriting user content | Section convention: agents write under `## SectionName (by role)` headings. BlockNote blocks have unique IDs — agents append, never replace user blocks. |
| Feedback loop (agent writes → triggers user edit event → triggers agent) | Use `transaction.origin` or socketId tracking to distinguish agent-originated changes. DocWatcher ignores in-process connections. |
| Stale context if user edits faster than agent processes | Next-invocation injection (strategy B) ensures agent always gets latest snapshot. Don't cache — read fresh on each invocation. |
| Performance: observeDeep on large docs | Use Hocuspocus `onChange` (post-debounce) instead of raw `observeDeep`. Extract only changed sections, not full doc. |

## Example Workflow

1. User creates a collab doc `"doc-api-design"` and starts writing API requirements.
2. Orchestrator assigns a `"researcher"` agent to help with the task.
3. `DocWatcher` is configured to watch `"doc-*"` documents for user edits.
4. User types: *"We need a REST API for user management with OAuth2"*.
5. After 1000ms debounce, `DocWatcher` emits `doc:userEdit` with content summary.
6. OrchestratorService receives the event, checks which agents are relevant to this doc.
7. Researcher agent's next invocation includes the doc content as context.
8. Researcher calls `collab({ action: "write-block", docName: "doc-api-design", key: "Research Findings", value: "## OAuth2 Patterns\n- Authorization Code flow recommended...\n- Use PKCE for SPAs..." })`.
9. BlockNote editor renders the new heading + paragraphs in real-time — user sees it appear.
10. Researcher also calls `collab({ action: "write", docName: "agent-statuses", key: "researcher", value: { status: "working", currentActivity: "Analyzing OAuth2 implementation patterns" } })`.
11. Frontend status widget shows: `🔍 researcher — Analyzing OAuth2 implementation patterns`.
12. User continues writing, adds *"Also need rate limiting"* — cycle repeats from step 5.

## Implementation Priority

| Priority | Component | Effort | Why |
|----------|-----------|--------|-----|
| **P0** | DocWatcher extension (Hocuspocus onChange hook + EventEmitter) | Small | Core mechanism — everything depends on this |
| **P0** | Agent system prompt enhancement (instruct agents to use collab tool proactively) | Small | No code changes — just prompt text |
| **P1** | Context injection in WorkerPool.buildMessageWithContext() | Small | Reads latest doc content before agent invocation |
| **P1** | OrchestratorService subscribes to `doc:userEdit` | Small | Routes change events to determine which agents need updated context |
| **P2** | Enhanced onAuthenticate for origin tagging | Small | Distinguishes user vs agent changes cleanly |
| **P2** | Agent status sidebar widget (frontend) | Medium | UX improvement — shows live agent activity |
| **P3** | Awareness/presence for agent cursors | Medium | Phase 3 stub already exists in CollabDocument |
| **P3** | Immediate re-prompt strategy (interrupt in-flight agents) | High | Complex — needs careful LangGraph thread management |
