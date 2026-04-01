# Agent ↔ Collab Docs — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (research phase, complex dual-agent architecture)

---

## Branch
- `feature/agent-collab-docs` (when unparked)

## Scope
Dual-Agent per worker node: Task Agent (System 2 — deep work) + Communication Agent (System 1 — fast I/O). Parallel execution with shared CRDT state.

## Pre-Implementation Research Required

### Research Gap 1: LLM Cost Impact
The dual-agent pattern doubles LLM calls per worker. Need benchmarking:
- Measure token cost of Communication Agent per task (simple status formatting)
- Estimate: if Communication Agent uses gpt-4o-mini and Task Agent uses gpt-4o, what's the cost ratio?
- Define sampling/throttle for Communication Agent (not every CRDT change triggers a call)

### Research Gap 2: Shared Context Mechanics
- How do two concurrent LangGraph/AI SDK agents share state without corrupting threads?
- Proposed: each has own `thread_id`, share data via CRDT docs (conflict-free by design)
- Need prototype to verify: concurrent writes to same Y.Doc from two agent process loops

### Research Gap 3: When to Activate Dual-Agent Mode
- Short tasks (<30s): dual-agent adds cost for no benefit
- Long tasks (>30s): dual-agent valuable for status updates and interrupt handling
- **Research needed:** Threshold determination — automatic or per-team configurable?

## Implementation Steps (After Research)

### Step 1: Create DualWorker Container
**Files to create:**
- `packages/backend/services/DualWorker.ts` — Container managing Task Agent + Communication Agent pair. Shared context: same CRDT docs, same workspace, different thread_ids. Lifecycle: both start with task, both stop on completion.

**Exit criteria:** DualWorker starts/stops both agents as one unit

### Step 2: Create Communication Agent
**Files to create:**
- `packages/backend/agent/internal/CommunicationAgent.ts` — System 1 (fast). Smaller model (gpt-4o-mini). Tools: `read_collab_doc`, `write_status`, `post_update`, `check_user_edits`. Runs on timer/event loop (not synchronous with Task Agent).

**Instructions:** "You are a communication liaison. Post status updates to shared docs. Watch for user edits. Never block the task agent."

**Exit criteria:** Communication Agent runs in parallel, posts updates, reads user edits

### Step 3: Implement DocWatcher
**Files to create:**
- `packages/backend/memory/L2/watchers/DocWatcher.ts` — Hocuspocus `onChange` hook that detects user edits (vs agent edits). Emits `doc:userEdit` events to relevant Communication Agents.

**Exit criteria:** User edits trigger Communication Agent reactions

### Step 4: Implement Interrupt Mechanism
**Files to create:**
- `packages/backend/services/InterruptService.ts` — Communication Agent can signal "requirement changed" to Task Agent. Task Agent checks for interrupts at tool-call boundaries (between steps).

**Exit criteria:** Communication Agent can redirect Task Agent on user requirement changes

### Step 5: Wire into WorkerPool
**Files to modify:**
- `packages/backend/services/WorkerPool.ts` — For long-running tasks: spawn DualWorker instead of single worker. Config: `dualAgentThreshold: 30000` (ms).

**Exit criteria:** Long tasks automatically get dual-agent mode

## Testing Strategy
- Benchmark: measure token cost with/without Communication Agent
- Test: Task Agent works while Communication Agent posts updates
- Test: user edits CRDT doc → Communication Agent detects → Task Agent redirects
- Test: Communication Agent failure doesn't crash Task Agent

## Research References
- DPT-Agent (ACL 2025) — validated dual-process pattern
- Parallelized Planning-Acting (Mar 2025) — interruptible execution
- Architecture doc has full academic analysis

## Complexity
High — 3-4 weeks (after research). Novel architecture, needs prototyping before full implementation.
