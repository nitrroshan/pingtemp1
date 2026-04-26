# Frontend State Refactor — Implementation Plan

> Architecture: [feature_architecture.md](./feature_architecture.md) — **Zustand** chosen.

## Branch
`feature/zustand-migration`

## Scope (v1.0)
Replace custom hooks with Zustand stores. Eliminate prop drilling. Fix structural bugs. Simplify App.tsx from 1099 → ~350 lines.

**This is NOT a 1:1 migration.** We're fixing design flaws while migrating:

| Current Problem | Fix During Migration |
|----------------|---------------------|
| `useChat` has 592 lines doing two things (history + streaming) | Split: `chatStore` (history/persistence) + `streamStore` (stream processing) |
| `useStreamRenderer` (360 lines) + `useChat.processStreamPart` both process streams | Merge into one `streamStore` |
| Tasks duplicated in `currentPlan[]` AND `tasks{}` | Single source: `tasks` only. `currentPlan` becomes a derived selector |
| `restoreFromServer` in useChat returns plan/goal data (wrong boundary) | Move session restore to `orchestrationStore`. Chat store only restores messages |
| localStorage persistence is manual (TTL, capping, JSON.stringify) | Use Zustand `persist` middleware |
| `selectedTaskId` drilled to 6 components | Add `uiStore` for navigation state |
| Role resolution is O(n) per stream event | `roleMap` built into `agentStore` from Step 1 |
| `socketBridge` as separate file adds indirection | Socket wiring lives inside store actions — no bridge file |

## Files Overview

**Create (5 new files):**
- `stores/agentStore.ts` — agent tree, team loading, roleMap cache
- `stores/orchestrationStore.ts` — plans, tasks, session state, session restore
- `stores/chatStore.ts` — chat histories, persistence
- `stores/streamStore.ts` — stream part processing (extracted from useChat + useStreamRenderer)
- `stores/uiStore.ts` — selectedTaskId, activeAgentId, selectedTeamId, viewMode, theme

**Modify (8 files):**
- `App.tsx` (1099 → ~350 lines) — layout + routing only
- `components/Sidebar.tsx` — read from stores
- `components/ChatArea/ChatArea.tsx` — read from stores
- `components/ChatArea/TaskList.tsx` — read from stores
- `components/ChatArea/Header.tsx` — read from stores
- `components/TaskDashboard/TaskDashboard.tsx` — read from stores
- `services/AgentServiceV2.ts` — stays as transport, no changes
- `package.json` — add zustand

**Delete (4 files):**
- `hooks/useOrchestration.ts` (326 lines)
- `hooks/useChat.ts` (592 lines)
- `hooks/useAgentTree.ts` (196 lines)
- `hooks/useStreamRenderer.ts` (360 lines)

**Keep unchanged:**
- `hooks/useDiscussion.ts` — CRDT, separate concern
- `hooks/useFeatureFlags.ts` — trivial, no issues

---

## Implementation Steps

### Step 0: Install + scaffold
- [ ] `cd packages/frontend && bun add zustand`
- [ ] Create `stores/` directory
- [ ] Create `stores/uiStore.ts` — extract `selectedTeamId`, `activeAgentId`, `selectedTaskId`, `viewMode`, `theme` from App.tsx useState calls
- **Why uiStore first:** Every other store and component needs `selectedTeamId`. Extracting it early unblocks everything.

```ts
// stores/uiStore.ts — ~40 lines
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selectedTeamId: null as string | null,
      activeAgentId: '' as string,
      selectedTaskId: null as string | null,
      viewMode: 'chat' as 'chat' | 'tasks' | 'collaborate',
      theme: (localStorage.getItem('ping:theme') || 'dark') as 'dark' | 'light',
      setSelectedTeamId: (id) => set({ selectedTeamId: id }),
      setActiveAgentId: (id) => set({ activeAgentId: id }),
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'ping:ui' }
  )
);
```

**Entry criteria:** Branch created from `dev`
**Exit criteria:** `bun run dev:frontend` starts, uiStore created

---

### Step 1: `agentStore` + roleMap (no Socket.IO)
- [ ] Create `stores/agentStore.ts`
- [ ] State: `agents`, `isLoadingTeams`
- [ ] **Computed: `roleMap: Record<string, string>`** — built automatically when agents change via `subscribe()`
- [ ] Actions: `loadTeams`, `createTeam`, `addLocalSubAgent`, `handleToggleCollapse`, `findAgentById`, `findAgentByRole` (O(1) via roleMap)
- [ ] Update App.tsx: replace `useAgentTree()` with store selectors
- [ ] Update Sidebar: read `agents` from store, not props

**Why roleMap here (not Step 6):** Stream events need role→agentId mapping immediately. Without it, Steps 2-5 run with the O(n) bug.

```ts
// Role resolution: O(1) instead of O(n) tree walk
findAgentByRole: (role: string, teamId?: string) => {
  const key = `${teamId || ''}:${role.toLowerCase()}`;
  return get().roleMap[key] ?? null;
},
```

**Files:** `stores/agentStore.ts` (new ~200 lines), `App.tsx`, `Sidebar.tsx`
**Exit criteria:** Agent tree loads, collapses, team creates. roleMap populates.

---

### Step 2: `orchestrationStore` + session restore
- [ ] Create `stores/orchestrationStore.ts`
- [ ] State: `sessionState`, `tasks` (Record<string, Task[]>), `autoExecuteEnabled`, `orchestrationLogs`, `plans`
- [ ] **Remove `currentPlan`** — derive it: `getCurrentPlan = () => Object.values(get().tasks).flat()`
- [ ] Actions: `approvePlan`, `startTask`, `completeTask`, `cancelTask`, `toggleAutoExecute`
- [ ] **Move `restoreFromServer` here** — it returns plan/goal data, not chat data. Chat restore is separate.
- [ ] Add `resetForTeam()` — auto-clears when `uiStore.selectedTeamId` changes (via `subscribe`)
- [ ] Wire Socket.IO: `onState`, `onGoalStateChange`, `onTaskUpdate` handlers call store actions directly
- [ ] Update App.tsx: remove `useOrchestration()`, remove 23+ props from Sidebar, remove task props from ChatArea

**Key refactor — task dedup + role-keyed storage:**
```ts
// Before: two sources of truth, keyed by agentId (requires role→agentId resolution at write time)
currentPlan: BackendTask[] | null  // flat list from server
tasks: Record<agentId, Task[]>    // per-agent, drops tasks if role can't resolve

// After: one source, keyed by assignedRole (no cross-store dependency)
tasks: Task[]                      // flat list from state events
// Selectors (resolve role→agentId at read time, never drops data):
getAllTasks: () => get().tasks
getTasksForAgent: (agentId: string) => {
  const role = agentStore.getState().agentRoleMap[agentId];
  return get().tasks.filter(t => t.assignedRole === role);
}
```

**Files:** `stores/orchestrationStore.ts` (new ~300 lines), `App.tsx`, `Sidebar.tsx`, `ChatArea.tsx`, `TaskList.tsx`, `Header.tsx`, `TaskDashboard.tsx`
**Exit criteria:** Plan approval, task lifecycle, team switch reset — all work. No stale plans.

---

### Step 3: `streamStore` (extracted from useChat + useStreamRenderer)
- [ ] Create `stores/streamStore.ts`
- [ ] **Combine** `useStreamRenderer` (360 lines) + `useChat.processStreamPart` (~200 lines) into one store
- [ ] State: `streamingAgents: Record<agentId, StreamingState>` — one entry per actively streaming agent
- [ ] Each `StreamingState` has: `messageId`, `parts: RenderedPart[]`, `textPartId`, `reasoningPartId`
- [ ] **Fix concurrent streams:** Each agent has independent streaming state. No shared `currentMessageId`.
- [ ] Actions: `processStreamPart(agentId, part)`, `finishStream(agentId)`, `clearStream(agentId)`
- [ ] On `finish`: push completed message into `chatStore.addMessage()`, clear streaming state

**Why separate from chatStore:** Stream processing is high-frequency (dozens of events/second). Keeping it in its own store means text-delta updates don't re-render the full chat history. Only `StreamMessage` subscribes to `streamStore`.

```ts
// stores/streamStore.ts — stream processing isolated from history
interface StreamingState {
  messageId: string;
  parts: RenderedPart[];
  activeTextPartId: string;
  activeReasoningPartId: string;
}

interface StreamStore {
  streams: Record<string, StreamingState>;  // keyed by agentId
  processStreamPart: (agentId: string, part: StreamPart) => void;
  finishStream: (agentId: string) => void;
}
```

**Files:** `stores/streamStore.ts` (new ~350 lines), `ChatArea.tsx`, `StreamMessage.tsx`
**Exit criteria:** Streaming works for text, tool cards, reasoning. Two agents can stream concurrently without corruption.

---

### Step 4: `chatStore` (history + persistence only)
- [ ] Create `stores/chatStore.ts`
- [ ] State: `chatHistories: Record<agentId, Message[]>`
- [ ] **Use Zustand `persist` middleware** — replaces manual localStorage with TTL/capping
- [ ] Actions: `addMessage`, `loadAgentChat`, `restoreMessages` (subset of old restoreFromServer — messages only)
- [ ] `clearForTeam()` — clears on team switch (subscribe to uiStore)
- [ ] `streamStore.finishStream()` calls `chatStore.addMessage()` to commit completed stream messages
- [ ] Remove `restoreFromServer` from chat — session restore lives in orchestrationStore (Step 2)

```ts
// stores/chatStore.ts — clean history management with persist
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chatHistories: {} as Record<string, Message[]>,
      addMessage: (agentId, msg) => set(s => ({
        chatHistories: {
          ...s.chatHistories,
          [agentId]: [...(s.chatHistories[agentId] ?? []), msg],
        },
      })),
      // ...
    }),
    {
      name: 'ping:chat',
      partialize: (s) => ({ chatHistories: capHistories(s.chatHistories, 50) }),
    }
  )
);
```

**Files:** `stores/chatStore.ts` (new ~150 lines), `ChatArea.tsx`
**Exit criteria:** Messages persist across refresh. Backend restore works. Team switch clears.

---

### Step 5: Slim App.tsx + wire stores
- [ ] App.tsx keeps ONLY: routing (`currentPath`, URL parsing), layout (sidebar/main/detail), theme, `selectedTeamId` change → connect/disconnect
- [ ] Socket.IO connect/disconnect: `useEffect` calls `agentServiceV2.connect(teamId)` + subscribes store actions to Socket.IO events
- [ ] **No `socketBridge.ts` file** — wiring is a `useEffect` in App.tsx (~30 lines) that calls `agentServiceV2.onState(orchestrationStore.handleState)` etc.
- [ ] Remove ALL prop drilling: Sidebar, ChatArea, TaskList, Header, TaskDashboard read from stores directly
- [ ] App.tsx renders: `<Sidebar />`, `<ChatArea />`, `<DetailPanel />` with minimal props (layout-only: `isMobile`, `onCollapse`)

**Why no socketBridge file:** Adding a separate file creates indirection. The wiring is 20-30 lines of `service.onX(store.actionY)`. It's clearest as a single `useEffect` in App.tsx that runs on `selectedTeamId` change.

**Files:** `App.tsx` (1099 → ~350 lines), `Sidebar.tsx`, `ChatArea.tsx`, all child components
**Exit criteria:** App.tsx < 400 lines. Full flow works end-to-end.

---

### Step 6: Cleanup
- [ ] Delete `hooks/useOrchestration.ts`, `hooks/useChat.ts`, `hooks/useAgentTree.ts`, `hooks/useStreamRenderer.ts`
- [ ] Add `devtools` middleware to all stores (dev only)
- [ ] Remove debug `console.log` statements from chat restore
- [ ] Full manual test pass (see matrix below)

**Files:** Delete 4 files (~1474 lines), modify 5 store files (add devtools)
**Exit criteria:** No dead code. DevTools working. All tests pass.

---

## Testing Strategy

| Test Case | What to Verify |
|-----------|---------------|
| Load team | Sidebar shows agents + plan tasks |
| Submit goal | Planner streams response, plan appears |
| Approve plan | Tasks appear with correct statuses |
| Start task | Task transitions to in_progress, stream shows |
| Complete task | Task marked completed, dependents unlock |
| Switch teams | Plan/tasks/chat cleared, new team loads fresh |
| Refresh page | Chat history restored from localStorage + backend |
| Auto-execute toggle | Tasks auto-dispatch when enabled |
| Concurrent streams | Two agents streaming don't corrupt each other |
| DevTools | Redux DevTools shows all 5 stores with named actions |

## Rollback Plan
- Old hooks stay until Step 6. Reverting any step = change imports in App.tsx.
- Feature branch isolates all changes from `dev`.

## Estimated Effort

| Step | What | Complexity | Lines |
|------|------|-----------|-------|
| 0 | Install + uiStore | Trivial | ~50 |
| 1 | agentStore + roleMap | Easy | ~250 |
| 2 | orchestrationStore + session restore | Medium | ~400 |
| 3 | streamStore (fix concurrent bug) | Hard | ~400 |
| 4 | chatStore (history + persist) | Medium | ~200 |
| 5 | Slim App.tsx + strip props | Medium | ~400 |
| 6 | Cleanup + devtools | Easy | ~50 (delete ~1474) |
| **Total** | | | **~1750 changed, ~1474 deleted** |
