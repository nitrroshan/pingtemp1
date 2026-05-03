# Callback Refactoring — Architecture

## Overview

This feature separates callback safety work from v5 communication-layer cleanup. The goal is to preserve current runtime behavior while making callback ownership explicit across `WorkerPool`, `OrchestratorService`, `GoalManager`, `AgentManagerV2`, `SocketServerV2`, `ChatAgent`, and the frontend socket wiring.

Today the callback chain is not just transport. It also synthesizes Channel B task updates, escalates planner notifications, updates state, persists streamed messages, triggers collab workers, and joins goal rooms. Treating that path as a pure forwarding chain is the main regression risk.

## Integration Points

- Backend runtime: `packages/agent-manager/src/services/WorkerPool.ts`, `packages/agent-manager/src/orchestrator/OrchestratorService.ts`, `packages/agent-manager/src/orchestrator/GoalManager.ts`, `packages/agent-manager/src/AgentManagerV2.ts`
- Backend edge: `packages/backend/api/SocketServerV2.ts`
- ChatAgent layer: `packages/agent-manager/src/chatAgent/ChatAgent.ts`
- Frontend transport: `packages/frontend/services/AgentServiceV2.ts`
- Frontend UI wiring: `packages/frontend/App.tsx`, `packages/frontend/stores/goalSessionStore.ts`
- Related feature dependency: `docs/features/communication-layer-refactor/v5.0/feature_implementation_planning.md`
- Detailed callback audit: `callback_research.md`

## Audit Reference

The concrete callback-chain diagrams, ownership matrix, planner-escalation split, and frontend subscription classification live in `callback_research.md`. This architecture doc stays intentionally short and decision-focused.

## Architecture Options

### Option A: Audit-Only Guard Rails

**Implementation:** Keep the current runtime topology. Add a callback ownership matrix, sequence diagrams, invariants, and regression tests before touching any production wiring. v5 stays blocked on those artifacts.

**Pros:**
- Lowest implementation risk
- Clarifies current behavior before refactor
- Creates a test baseline for later changes

**Cons:**
- Does not reduce callback depth yet
- Leaves `SocketServerV2` and `App.tsx` complexity in place
- Delays structural cleanup

**Effort:** Small

### Option B: Callback Gateway Layer

**Implementation:** Introduce one dedicated callback feature that centralizes callback ownership before any flattening. Add typed runtime callback interfaces plus a `RuntimeEventGateway`/`CallbackRouter` layer that becomes the single fan-out point for:
- Channel A stream forwarding
- Channel B task update synthesis and routing
- planner escalation
- frontend state/task_update emission
- ChatAgent ingestion

`WorkerPool`, `GoalManager`, and `SocketServerV2` keep current behavior initially, but publish through the gateway. After parity tests pass, v5 can simplify layers behind that stable gateway.

**Pros:**
- Preserves behavior while creating a safe seam for later refactors
- Makes callback ownership explicit in code, not just docs
- Reduces risk of duplicate planner escalation or dropped events

**Cons:**
- Adds one intermediate abstraction before removing others
- Requires careful parity testing to avoid two competing routes

**Effort:** Medium

### Option C: Direct v5 Flattening

**Implementation:** Skip a standalone callback feature. Fold callback cleanup directly into v5 by splitting `SocketServerV2`, flattening the chain, and moving frontend wiring at the same time.

**Pros:**
- Fastest path to final target architecture
- Avoids a transitional layer

**Cons:**
- Highest regression risk
- Hardest to prove callback parity during rollout
- Mixes transport refactor, callback semantics, and frontend subscription changes in one step

**Effort:** Large

## New Types / Interfaces

- `RuntimeStreamEvent` — canonical Channel A payload owner inside backend
- `RuntimeTaskUpdate` — canonical Channel B payload owner inside backend
- `PlannerEscalationEvent` — explicit planner-notification contract
- `CallbackOwnershipMatrix` — documented mapping of producer, owner, side effects, and consumers
- `FrontendSocketEffectBoundary` — categorizes store updates vs local UI reactions

## API / Frontend Impact

- No REST API changes required for Option A or B
- Socket.IO event names can remain unchanged initially
- Frontend impact should be limited to clearer ownership of `state`, `stream`, `task_update`, `goal:stateChange`, and discussion events
- No database schema changes required

## Recommendation

Option B is recommended because it creates a safe feature boundary for callback behavior before v5 starts deleting layers. The current system still uses callbacks for business logic, not just forwarding, so a dedicated callback refactor feature should first stabilize ownership and parity.

**Decision Required:** Please choose Option A, B, or C.