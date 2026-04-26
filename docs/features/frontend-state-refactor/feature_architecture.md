# Frontend State Refactor — Architecture

## Problem Statement

The frontend (`packages/frontend/`) has grown organically and now suffers from structural issues that make it fragile, hard to extend, and prone to bugs like the stale-plan-on-team-switch issue.

### Current State Audit

| Component | useState | useRef | useEffect | Props received |
|-----------|----------|--------|-----------|----------------|
| **App.tsx** | 15 | 5 | 13 | — (root) |
| **useChat** | 2 | 4 | 1 | — (hook) |
| **useOrchestration** | 6 | 0 | 0 | — (hook) |
| **useAgentTree** | 2 | 1 | 1 | — (hook) |
| **Sidebar** | — | — | — | 23 props |
| **ChatArea** | — | — | — | 24 props |
| **DetailPanel** | — | — | — | 16 props |

### Problems Identified

**1. Prop Drilling (depth 4-5)**
- `handleStartTask` drills: App → ChatArea → TaskList → TaskItem
- `selectedTaskId` drilled to 6 components
- `tasks` / `allTasks` passed to 7 components
- No React Context for any orchestration state

**2. State Duplication**
- Tasks exist in BOTH `tasks` (per-agent map) AND `currentPlan` (flat array) — desync risk
- Agent roles resolved O(n) on every stream part instead of cached once per team
- `activeAgentId` state + `activeAgentIdRef` kept in sync via useEffect — stale closure risk

**3. No Team Scoping**
- Orchestration state (`currentPlan`, `tasks`, `sessionState`) persisted across team switches (the bug you just hit)
- Chat histories are global, not scoped to `selectedTeamId`

**4. Concurrent Stream Corruption**
- Global `currentMessageId` in stream renderer — if 2 agents emit simultaneously, messages get mixed

**5. App.tsx is a God Component**
- 15 state vars, 5 refs, 13 effects, 8+ callback wiring points
- Wires together 3 hooks + 1 service + URL routing + Socket.IO lifecycle
- Every state change re-renders the entire tree

---

## Architecture Options

### Option A: React Context (Minimal Refactor)

**Implementation:** Extract the 3 existing hooks into Context providers. Components `useContext()` instead of receiving props.

```
<AgentTreeProvider>
  <OrchestrationProvider teamId={selectedTeamId}>
    <ChatProvider teamId={selectedTeamId}>
      <App />   ← now receives almost nothing via props
    </ChatProvider>
  </OrchestrationProvider>
</AgentTreeProvider>
```

Key changes:
- `OrchestrationContext` wraps `useOrchestration()` — auto-resets on `teamId` change
- `ChatContext` wraps `useChat()` — scoped to team
- `AgentTreeContext` wraps `useAgentTree()` — stable across team switches
- Components like TaskList call `useOrchestration()` directly — zero prop drilling
- App.tsx shrinks from ~1030 lines to ~300 (routing + layout only)

**Pros:**
- Smallest change — hooks stay almost identical, just wrapped in providers
- Zero new dependencies
- Prop drilling eliminated (23-prop Sidebar → ~5 props)
- Team scoping built into provider lifecycle (remount on teamId change)
- Familiar React pattern — no learning curve

**Cons:**
- Context re-renders all consumers on ANY state change (e.g., `orchestrationLogs` update re-renders TaskList)
- Need `useMemo` / split contexts to avoid perf issues
- Still no devtools for state inspection
- Doesn't solve state duplication (tasks in 2 places) — needs manual dedup

**Effort:** Small — 2-3 days. Mostly mechanical prop removal.

---

### Option B: Zustand (Lightweight Store)

**Implementation:** Replace hooks with Zustand stores. Each store is a single function with state + actions. Components select only what they need (no unnecessary re-renders).

```ts
// stores/orchestrationStore.ts
export const useOrchestrationStore = create<OrchestrationState>((set, get) => ({
  sessionState: null,
  currentPlan: null,
  tasks: {},
  plans: [],

  resetForTeam: () => set({ sessionState: null, currentPlan: null, tasks: {}, plans: [] }),
  setCurrentPlan: (plan) => set({ currentPlan: plan }),
  startTask: (taskId) => { agentServiceV2.startTask(taskId); },
  // ...
}));

// In any component — no props needed:
const tasks = useOrchestrationStore(s => s.tasks);
const startTask = useOrchestrationStore(s => s.startTask);
```

Key changes:
- 3 stores: `useAgentStore`, `useOrchestrationStore`, `useChatStore`
- Selector-based: `useOrchestrationStore(s => s.tasks)` — only re-renders when `tasks` changes
- Socket.IO wiring moves into store middleware or `subscribe()` side-effect
- No providers needed — stores are global singletons
- App.tsx becomes pure layout + routing

**Pros:**
- Granular re-renders via selectors (TaskList only re-renders when tasks change, not when logs change)
- Built-in devtools (zustand/devtools middleware)
- No provider nesting / context hell
- ~2KB bundle, zero boilerplate
- Easy to test — stores are plain functions
- Solves team scoping: `resetForTeam()` called on team switch
- Can derive computed state: `getReadyTasks = () => Object.values(get().tasks).flat().filter(t => t.status === 'ready')`

**Cons:**
- New dependency (though tiny — 2KB)
- Need to migrate 3 hooks → 3 stores
- Socket.IO wiring in stores is less "React-ish" (side effects outside components)
- Team might not be familiar with Zustand patterns

**Effort:** Medium — 3-5 days. Rewrite hooks as stores, update all consumers.

---

### Option C: Redux Toolkit (Full State Management)

**Implementation:** Redux store with slices for each domain. RTK Query for API calls. Middleware for Socket.IO.

```ts
// store/orchestrationSlice.ts
const orchestrationSlice = createSlice({
  name: 'orchestration',
  initialState: { sessionState: null, currentPlan: null, tasks: {}, plans: [] },
  reducers: {
    resetForTeam: () => initialState,
    setPlan: (state, action) => { state.currentPlan = action.payload; },
    updateTaskStatus: (state, action) => { /* immer mutation */ },
  },
});

// Socket.IO middleware
const socketMiddleware = (store) => (next) => (action) => {
  if (action.type === 'socket/connect') {
    socket.on('state', (data) => store.dispatch(setPlan(data.plan)));
  }
  return next(action);
};
```

**Pros:**
- Industry standard, well-documented
- Redux DevTools — time-travel debugging, action log, state diff
- Immer mutations (no spread hell)
- RTK Query handles API caching, deduplication, refetching
- Middleware cleanly handles Socket.IO side effects
- Easy to test — pure reducers

**Cons:**
- Heavy — ~11KB + boilerplate (actions, reducers, selectors, middleware)
- Overkill for this app's complexity (~25 state vars total)
- Steep learning curve if team is unfamiliar
- Action/reducer indirection adds cognitive overhead
- RTK Query not needed — we use Socket.IO, not REST polling

**Effort:** Large — 5-8 days. Significant boilerplate and conceptual shift.

---

## Recommendation: **Option B (Zustand)**

Zustand is the right fit because:

1. **Granular re-renders** — the #1 perf problem. Context re-renders everything; Zustand's selectors don't.
2. **Zero boilerplate** — stores read like the existing hooks, just with `set()` instead of `setState()`.
3. **Built-in devtools** — critical for debugging streaming state (task status, chat messages, plan lifecycle).
4. **No providers** — cleaner than wrapping 3 contexts in App.tsx.
5. **Team scoping solved** — `resetForTeam()` is a one-liner, called on team switch.
6. **Redux is overkill** — we have ~25 state vars, not hundreds. No complex action chains. Socket.IO isn't a good fit for middleware.

### Migration Plan (if chosen)

| Step | What | Lines Changed |
|------|------|---------------|
| 1 | Install zustand | 1 line |
| 2 | `useOrchestrationStore` — migrate useOrchestration | ~200 lines |
| 3 | `useChatStore` — migrate useChat | ~300 lines |
| 4 | `useAgentStore` — migrate useAgentTree | ~100 lines |
| 5 | Update consumers (Sidebar, ChatArea, etc.) | ~200 lines |
| 6 | Strip props from App.tsx | ~300 lines removed |
| 7 | Deduplicate task state | ~50 lines |
| 8 | Add devtools middleware | ~10 lines |

**Total: ~1200 lines changed, ~400 lines net reduction.**

### What About Option A (Context)?

Context is viable if you want **zero new dependencies**. But you'll immediately need `useMemo`, split contexts, and `React.memo` to avoid perf regressions — which adds the same complexity Zustand solves out of the box.

### What NOT To Do

- **Don't add Redux** — the app has 25 state vars across 3 domains. Redux's ceremony (actions, reducers, middleware, selectors) would triple the code for no benefit.
- **Don't add MobX** — observable-based reactivity is a paradigm shift. Not worth it for this codebase.
- **Don't keep the current architecture** — the prop drilling and state duplication will keep producing bugs like the stale-plan issue.

---

## Vision Alignment Analysis

The recommendation must hold up against where the product is heading, not just today's 25 state vars.

### What the Frontend Must Become

| Capability | Current | Phase 4 (weeks) | Phase 6 (months) |
|------------|---------|-----------------|-------------------|
| **Goals** | 1 active | Multiple goals, serial execution | Full parallel — N goals streaming simultaneously |
| **Streams** | 1 agent stream at a time | Per-goal streams, goal-scoped routing | N concurrent streams, per-goal chat threads |
| **Collaboration** | None | CRDT editing, agent cursors, group discussions | Multi-user + multi-agent real-time |
| **Platform** | Web only | Web + desktop (Electron, local-first) | Offline-capable, sync-on-connect |
| **Teams** | Single team switch | Multi-team, per-team state | Cross-team knowledge sharing |
| **Knowledge** | Ephemeral task outputs | Wiki with promotion queue, artifact browser | Searchable knowledge base |
| **Admin** | None | — | MCP servers, worker health, agent metrics dashboards |

### The Key State Shape Change: Goal-Scoped Everything

Today's state is flat:
```ts
{ currentPlan: Task[], tasks: Record<agentId, Task[]>, sessionState: string }
```

Phase 4+ needs goal-scoped state:
```ts
{
  goals: Record<goalId, {
    status: 'planning' | 'executing' | 'completed',
    plan: Task[],
    tasks: Record<agentId, Task[]>,
    messages: Message[],       // per-goal chat thread
    activeWorkers: string[],
    streamParts: Map<taskId, RenderedPart[]>,
  }>,
  activeGoalId: string | null,
}
```

This is the shape that must work with concurrent streams (Phase 6) and CRDT collaboration (Phase 4).

### How Each Option Handles the Future

**Context — breaks at scale.**
- Phase 4 (multiple goals): need dynamic `<GoalProvider goalId={id}>` per goal. If 3 goals execute concurrently, 3 providers. A state update in Goal A re-renders Goal B and C.
- CRDT: separate system (Yjs/Hocuspocus). Context doesn't help.
- Desktop: no impact.
- Verdict: works for Phase 3, painful by Phase 4, unworkable at Phase 6.

**Zustand — scales cleanly.**
- Phase 4: `useGoalStore(s => s.goals[goalId])` — only the active goal's UI re-renders. Add goals without touching existing ones.
- Phase 6 (concurrent): each goal's stream updates independently via selectors. No cross-goal re-renders.
- CRDT: Zustand coexists — CRDT state lives in Yjs docs, Zustand holds UI state (which doc is open, cursor position overlay). No conflict.
- Desktop: works identically — no server dependency, stores are in-memory.
- Knowledge base: add `useKnowledgeStore` — isolated, no impact on existing stores.
- Admin dashboards: each dashboard gets its own small store. Lazy-loaded.
- Verdict: handles every phase without architectural changes.

**Redux — handles it but costs too much.**
- Same capability as Zustand for goal-scoped state (normalized entities, selectors).
- But: 3x more boilerplate per feature. Every new goal operation = action + reducer + selector + type.
- RTK Query doesn't help — we use Socket.IO, not REST.
- Verdict: technically capable, but the ceremony tax compounds as features grow.

### CRDT Integration (the Real Complexity)

CRDT state (Yjs documents) lives outside React entirely — in the Hocuspocus provider. The frontend state manager only needs to track:
- Which documents are open
- Connection status per document
- Presence/cursors (from Yjs Awareness)
- Promotion queue items (from backend events)

This is **metadata about CRDT state**, not the CRDT state itself. Zustand handles this perfectly — small, isolated store slices. Context or Redux would work too, but Zustand's selector model means the collaboration panel only re-renders when its specific metadata changes.

### Desktop / Local-First

No impact on state management choice. The desktop app uses the same frontend bundle — only the backend switches from MongoDB to file-based storage via ServiceRegistry. Zustand stores are in-memory with no server dependency.

### Revised Recommendation

**Zustand remains the right choice**, and the vision analysis strengthens the case:

1. **Goal-scoped selectors** are the killer feature for Phase 4-6. Context can't match this without splitting into N dynamic providers.
2. **Store-per-domain** (orchestration, chat, agents, knowledge, admin) scales horizontally. Each new feature is an isolated store — no god-store risk.
3. **CRDT coexistence** is clean — Zustand for UI state, Yjs for document state. No overlap.
4. **Desktop-ready** out of the box — no server dependencies in stores.
5. **~25 state vars today → ~60-80 by Phase 6** — still well within Zustand's sweet spot. Redux's threshold is 200+ vars with complex action chains.

The one scenario where Redux would win: if you plan to add **time-travel debugging for agent decisions** (replay what each agent saw, step through tool calls). Redux DevTools does this natively. But that's an agent-debugging feature, not a state management need — and Zustand's devtools middleware supports basic time-travel too.
