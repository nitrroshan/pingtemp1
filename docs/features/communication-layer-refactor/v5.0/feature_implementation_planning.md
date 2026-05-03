# v5.0 — Communication Contracts + Service Layer

## Branch
`user/nitrroshan/fixplans`

## Scope
Split SocketServerV2 (1641 lines) into focused services. Move frontend event wiring from App.tsx (1228 lines) into Zustand middleware. Use `@ping/shared` as the single source of truth for typed Socket.IO event contracts. Preserve the current callback topology and defer callback-chain cleanup to later work.

## Prerequisites
- [x] v3.0 Backend persistence
- [x] v4.0 Server-owned sessions

## Context
v2.0 created goalSessionStore (replacing chatStore + orchestrationStore + GoalCoordinator). Several frontend refactoring items were deferred from v2.0: App.tsx is still 1228 lines with manual Socket.IO wiring, and the Zustand store structure could benefit from middleware patterns. This version addresses those deferred items.

Callback cleanup is deferred. v5 should keep the current callback ownership and event flow intact while improving contracts, service boundaries, and frontend state wiring around that existing runtime behavior.

## Steps

- [x] **Step 1: Typed Socket.IO contracts — package-local types**
  - Each package owns its own `socketEvents.ts` with `ClientToServerEvents` and `ServerToClientEvents`
  - Backend: `packages/backend/api/types/socketEvents.ts` (imports `StreamPayload` from local `streamTypes.ts`)
  - Frontend: `packages/frontend/types/socketEvents.ts` (imports `StreamPayload` from local `types.ts`)
  - `@ping/shared` dependency removed from both `package.json` files
  - **Decision:** Package-local types eliminate cross-package coupling. Each side owns its types independently. Type drift is caught by build failures (both sides define the same Socket.IO event shapes). The `@ping/shared` package still exists in the workspace but is no longer referenced by backend or frontend.

- [x] **Step 2: Split SocketServerV2 into services**
  - Original: 1641 lines → split into 5 files:
  - `socket-types.ts` (402 lines) — shared types, schemas, validation, helpers
  - `SocketEventBroadcaster.ts` (350 lines) — manager callbacks → Socket.IO room broadcasts
  - `SocketMessageHandler.ts` (303 lines) — message routing (orchestrator, chat agent, worker)
  - `SocketActionHandler.ts` (270 lines) — action routing (approve, start, complete, cancel, get-state)
  - `SocketServerV2.ts` (260 lines) — slim orchestrator (auth, connections, rooms, lifecycle)
  - Each service independently testable. No external API changes.

- [x] **Step 3: Frontend event wiring refactor**
  - `bindSocketMiddleware(agentServiceV2, teamId)` in `stores/socketMiddleware.ts` owns all Socket.IO → Zustand state updates
  - `onGoalCreated` room subscription handled by middleware
  - `onDiscussionActivity` state moved to `stores/discussionStore.ts` Zustand store
  - `App.tsx` reduced from ~1228 to ~1067 lines (–161 lines)
  - Removed 6 unused variables/refs from App.tsx (`uuidv4`, `agentsRef`, `activeAgentIdRef`, `selectedTeamIdRef`, `addMessage`, `processStreamPart`)

- [x] **Step 4: Global error interceptor**
  - `bindErrorBoundaryService(agentServiceV2, { showToast })` in `services/ErrorBoundaryService.ts`
  - Absorbs `onHttpError` subscription from App.tsx
  - Wired into App.tsx alongside `bindSocketMiddleware`

## Design Decisions

**Why package-local types instead of `@ping/shared`:** Each package owns its own `socketEvents.ts` with `ClientToServerEvents`/`ServerToClientEvents`. This eliminates the cross-package type dependency that required both packages to build together. Type drift is caught by build failures (if backend adds an event the frontend doesn't handle, the frontend code will fail to compile when it tries to use the new event). The `@ping/shared` package still exists but is no longer imported by backend or frontend.

**Why split SocketServerV2 into 5 files (not 4):** The original plan proposed StreamBroadcaster + StateBroadcaster + MessageHandler + SocketServer. Implementation chose a different factoring: shared types/helpers were large enough (~400 lines) to warrant `socket-types.ts`. Event broadcasting (stream + state + task + plan + goal) stayed unified in `SocketEventBroadcaster.ts` because the callbacks share accumulator state. Actions got their own handler. This produced 5 cleaner files instead of 4.

**Why callback cleanup is deferred:** The 8-hop callback chain touches 5 files across 2 packages. WorkerPool and OrchestratorService are NOT pure forwarders — they synthesize Channel B events, track blocked status, and spawn collab workers. v5 should not change that ownership yet.

**Why Zustand middleware:** v2.0 focused on store unification. The manual App.tsx wiring was kept to minimize blast radius. v5.0 completes that vision: `bindSocketMiddleware` owns all Socket.IO → store updates, `bindErrorBoundaryService` owns HTTP error → toast flow. App.tsx keeps only view composition.
