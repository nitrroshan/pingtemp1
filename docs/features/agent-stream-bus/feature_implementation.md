# Agent Stream Bus — Implementation Log

**Parent:** [feature_implementation_planning.md](./feature_implementation_planning.md)
**Branch:** `user/nitrroshan/fixscheams`
**Status:** **Phase 1 cleanup chain LANDED + Patch #1 callers migrated (May 9 PM-2 → PM-7).** Workers, planner, and ChatAgent all run through `factory.wire()` + `runWithHooks()`. 10 of 12 debt items closed (#2/#4/#5/#6/#7/#8/#9/#10/#11/#12). Patch #1 (physically delete `execute()` AsyncGenerator) is PARTIAL — production callers migrated, deletion needs `runWithHooks` to drive `streamText` callbacks directly. Patch #3 (delete `SocketEventBroadcaster`) deferred — cross-package work.

## Snapshot

- **Tests:** 107 pass / 0 fail (down from 162 due to deletion of obsolete dual-mode tests; observable behavior unchanged).
- **Production runtime:** workers, planner, and ChatAgent ALL go through `factory.wire()` + `agent.runWithHooks()`. The orchestrator owns ALL state mutations via lifecycle hooks. `AgentRuntimeFactory.composeStreamingHooks` is the SOLE per-visitor isolation layer.
- **Removed across PM-2 → PM-7:** `PING_AGENT_RUNTIME_HOOKS` env var, `setRuntimeHooksEnabled` / `isRuntimeHooksActive` / `getWorkerMode` API, `workerWiring` map (replaced with `workerGenerations`), `executionMode` flag (assembler + per-tool branches), agent-side `safeHook`/`safeHookAsync` wrappers, `manager.startTask`/`continueTask` + `handleWorkerMessage` + `sendToWorker` (direct worker chat), per-turn planner `onPlannerStream` extra visitor, `PlannerAgent.execute()` wrapper, `wireStreamingIfConfigured`. ~170 lines of legacy WorkerPool branch, ~370 lines of legacy lifecycle-tool code, ~1,300 lines of dual-mode test code.

## Strangler Status

Step 1 (build new) ✅. Step 2 (parity tests) ✅. **Step 3 (delete old) ✅ for the WorkerPool path AND for all production callers of `agent.execute()`.** PlannerAgent / ChatAgent / GoalManager all migrated to `runWithHooks()` (PM-4). The remaining `IAgent.execute` method is `@deprecated @internal` and only used internally by `runWithHooks` itself; physical removal needs a `streamText` callback refactor. Patch #3 (delete `SocketEventBroadcaster`) is a separate large cross-package refactor.

## Technical Debt Register

| # | Patch | Status | Notes |
|---|-------|--------|-------|
| 1 | `AiSdkAgent` runs both `execute()` AsyncGenerator AND `runWithHooks()` | ⚠️ **PARTIAL — callers migrated PM-4** | All production callers (PlannerAgent, ChatAgent, GoalManager.executePlannerTurn) now go through `runWithHooks()`. `IAgent.execute` is `@deprecated @internal`; physically removing it needs `runWithHooks` to drive `streamText({ onChunk, onStepFinish, onFinish, onError })` callbacks directly instead of consuming the `execute()` generator internally. Follow-up patch. |
| 2 | `WorkerPool.runTask()` legacy branch | ✅ **CLOSED May 9 PM-2** | Hooks-only path. `runTask` collapsed; `factory.wire()` is required (throws if not injected). |
| 3 | Two accumulators (visitor + SocketEventBroadcaster) | ⚠️ **DEFERRED — bridge mitigated PM-7** | Touches `packages/backend/api/SocketEventBroadcaster.ts` (374 lines). Visitor-owns-persistence is the documented target; cross-package refactor. PM-7: bridge accumulator key now includes `streamGoalId` to prevent cross-goal contamination of concurrent planner/chat runs (previously keyed only on `taskId \|\| agentId`). |
| 4 | `createSubtask` duplicated between tool + adapter | ✅ **CLOSED May 9** | Shared `orchestrator/buildSubtask.ts` helper. |
| 5 | Two-layer mode switching (`executionMode` in assembler + per-tool branches) | ✅ **CLOSED May 9 PM-2** | Removed `executionMode` from `assembleLifecycleTools`, `requestTaskTool`, `bounceTaskTool`. Tool error string when missing: "missing lifecycleHooks/lifecycleCtx — programmer error". |
| 6 | `workerWiring: Map<taskId, { mode, generation }>` for hot toggling | ✅ **CLOSED May 9 PM-2** | Replaced with `workerGenerations: Map<taskId, number>` (factory-swap invalidation only). `setRuntimeHooksEnabled` + `isRuntimeHooksActive` + `getWorkerMode` + `PING_AGENT_RUNTIME_HOOKS` env var deleted. |
| 7 | `wire()` + `wireStreamingOnly()` | ✅ **CLOSED May 9** | Single `wire(config)`; `wireStreamingOnly` kept as deprecated 1-line alias. |
| 8 | Per-visitor wrappers in BOTH AgentRuntimeFactory AND AiSdkAgent | ✅ **CLOSED May 9 PM-2** | Removed `safeHook` + `safeHookAsync` from AiSdkAgent. Composer in `AgentRuntimeFactory.composeStreamingHooks` is the SOLE isolation layer. Custom (non-composed) hook callers handle their own errors per StreamingHooks contract. |
| 9 | `StreamingHooks` mixes back-pressure semantics | ✅ **CLOSED May 9** | Split into `IStreamingObserver` + `IStreamingTerminal`; `StreamingHooks` is the union. |
| 10 | `notifyTaskCreated` optional as a test seam | ✅ **CLOSED May 9** | Required on production interface; tests pass explicit no-op (PM-6: 14 test sites updated to satisfy the contract under strict typecheck). |
| 11 | Tests poke private state via `as any` | ✅ **CLOSED May 9 PM-2** | Replaced obsolete `WorkerPool.runtimeHooks.test.ts` with focused `WorkerPool.runtimeWiring.test.ts`. Replaced `lifecycleHooks.test.ts` (923 lines) + `parity/lifecycleTools.parity.test.ts` (429 lines) with `lifecycleTools.test.ts` (~230 lines, hooks-only). Two-mode parity comparison file (`streamPart.parity.test.ts`) deleted — comparison is meaningless when there's only one mode. |
| 12 | Hooks mode never run end-to-end | ✅ **CLOSED earlier May 9** | Single-goal manual test ✅. Real-factory parity test (`realFactory.parity.test.ts`) covers production visitor stack: StreamPublisher + ChannelB + Crdt + ErrorChannel. |

## Properly Refactored (Wins to Keep)

- `IStreamingAgent` + `StreamingHooks` + `TaskLifecycleHooks` interface separation.
- The three visitors (`StreamPublisherVisitor`, `ChannelBVisitor`, `CrdtStatusVisitor`) — single responsibility, isolated.
- `AgentContext` vs `StreamingAgentContext` type narrowing.
- Composite hook isolation pattern (per-visitor try/catch in `composeStreamingHooks`).
- Lifecycle payload expansion (`producedDocs`, `decisions`, full `SubtaskRequestPayload` parity).
- Per-goal scalar fixes from earlier sessions (`Map<goalId, ...>`).
- ChatAgent goalId filtering (Phase 1.9, May 9).

## Cleanup Sequencing

Forcing-function order (do not reorder):

1. **Phase 1.11 parity tests** — record-and-diff harness against both modes. Until this exists, every cleanup below is theoretical.
2. **Patch #12 → #1 → #2** (chain). Wire native AI SDK hooks, then delete the legacy branch in `WorkerPool.runTask()`. This single deletion forces patches #3, #5, #6, #8 to collapse.
3. **Patch #4 + #7 + #9 + #10** can land in parallel — they're independent and don't require parity tests.
4. **Patch #11** last — tests get rewritten against the post-cleanup public API.

## Risks If We Continue Adding Phases Instead

- 1.10, 2.x, 3.x ship in the same shape: **two systems forever**, both required to keep working, doubled maintenance.
- The `Map<taskId, mode>` and dual-accumulator code calcify into "the way we do it."
- `SocketEventBroadcaster` (374 lines) becomes immortal because nothing forces its removal.

## Live Status (as of May 9)

- Backend: PID 67142, port 3002, `PING_AGENT_RUNTIME_HOOKS=true` ✅
- Collab: port 1234 ✅
- Frontend: port 3001 ✅
- Logs: `/tmp/ping-backend.log`, `/tmp/ping-collab.log`
- Single-goal flow: ✅ verified manually
- Parallel-goal flow: not yet exercised
- Known noise: `doc.transact` errors from CRDT (non-fatal best-effort sync) — separate backlog item.

## May 9 PM Session — A → B → C Sequence

The user requested a forward sweep through three things: (A) start parity tests, (B) land the independent debt patches, (C) attempt Phase 1.10 as much as is responsible without forcing premature deletions.

### A — Phase 1.11 parity foundation
- Added `__tests__/parity/harness.ts` — a `FakeAiSdkAgent` whose `execute()` and `runWithHooks()` both drive off the SAME scripted `AgentEvent[]`. Records legacy `WorkerCallbacks` calls vs hooks-mode visitor calls and exposes a `runParity(scripted)` helper that returns normalized event sequences for both modes.
- Added `__tests__/parity/streamPart.parity.test.ts` — 5 tests proving stream parts (text-delta, tool-call/result, finish-step), task transitions (started/completed/failed), and final output text are equivalent in both modes.
- **Pending fixtures** for harness (deliberately deferred — extension points documented in `harness.ts` header):
  - Lifecycle tools (`complete_task` / `bounce_task` / `request_task` / `report_status`)
  - CRDT mutations from `CrdtStatusVisitor`
  - Channel B `progress` / `tool_milestone` cadence

### B — Independent debt patches (4 closed, 0 added)
- **Patch #10** — `notifyTaskCreated` made required on `AgentRuntimeOrchestrator` and on `GoalManagerOrchestratorAdapterDeps`. Removed the runtime `if (orchestrator.notifyTaskCreated)` guard. Tests that previously relied on optionality now provide explicit `async () => {}` no-ops. Renamed misleading test cases.
- **Patch #7** — Collapsed `wire()` and `wireStreamingOnly()` into a single `wire()` where presence of `context.taskId` decides whether lifecycle tools get assembled. `wireStreamingOnly()` kept as a deprecated 1-line alias for back-compat. `WiredAgent.agentState` now `| undefined` for stream-only mode. The "throws when taskId missing" test was replaced with a "stream-only returns empty lifecycleTools + undefined agentState" test.
- **Patch #4** — Extracted `orchestrator/buildSubtask.ts` and routed BOTH the legacy `requestTaskTool` branch and `GoalManagerOrchestratorAdapter.createSubtask` through it. ~80 lines of duplicated id-generation + cycle-check + rollback collapsed into the helper. When the legacy tool branch is later deleted (Patch #2), only the adapter calls into the helper.
- **Patch #9** — Split `StreamingHooks` into `IStreamingObserver` (fire-and-forget: onStart/onChunk/onStepFinish) + `IStreamingTerminal` (awaited: onFinish/onError). `StreamingHooks` is now `IStreamingObserver & IStreamingTerminal` — fully back-compatible. Visitors can declare which subset they own via `implements`.

### C — Phase 1.10 (planner streaming via visitors) — minimum-useful seam only
- Added `agentRuntimeFactory?: AgentRuntimeFactory` and `goalId?: string` to `PlannerAgentConfig`.
- `PlannerAgent.initialize()` now calls `factory.wire({ agent, context: { teamId, goalId, agentId: 'planner' } })` in stream-only mode (no `taskId`) when both are provided. Best-effort: failures are logged but don't abort init.
- Added 6 tests in `__tests__/PlannerAgent.test.ts` covering: omitted factory, omitted goalId, both provided (correct context), legacy IAgent without `runWithHooks` (skips wire), wire throw is swallowed.
- **CAVEAT (deliberately documented in code):** the wiring is **inert today** because the planner is invoked via `agent.execute()` (legacy AsyncGenerator) which bypasses `agent.onStreaming`. Full activation requires switching `OrchestratorService` to `runWithHooks()` AFTER Patch #2 lands. The seam is added now so that activation is a one-line config change later.
- **Caller wiring NOT done.** `AgentManagerV2`/`OrchestratorService` are not yet passing `agentRuntimeFactory` + `goalId` into `new PlannerAgent(...)`. That's a follow-up — once OrchestratorService starts using `runWithHooks` (post Patch #2), wire it then. Doing it before Patch #2 would just add another conditional branch nobody reads.

### Tests + status
- **137 pass / 0 fail** (was 119 / 0 fail). Typecheck clean.
- Open debt items: #1 (AiSdkAgent dual-path), #2 (legacy WorkerPool branch), #3 (dual accumulators), #5 (mode-switching layers), #6 (workerWiring map), #8 (try/catch layers), #11 (private-state test pokes).
- Cleanup chain that unlocks 5 closures at once: **#1 → #2 → cascading collapse of #3, #5, #6, #8**. Patch #11 follows.

## May 9 Late Review — Four Findings Closed

A second review pass surfaced four findings; all closed in-flight (separate from the debt register):

- **Review fix #1 — hooks mode dropped the Socket.IO `error` channel.** Legacy mode emitted `error` via `WorkerCallbacks.onError → SocketEventBroadcaster`; hooks mode rethrew without that emission, so the frontend's `error` subscription silently received only coarse `task_update: failed`. Added `ErrorChannelVisitor` ([packages/agent-manager/src/agent/streaming/visitors/ErrorChannelVisitor.ts](packages/agent-manager/src/agent/streaming/visitors/ErrorChannelVisitor.ts)) — pure `onError` forwarder to `WorkerCallbacks.onError` shape. Wired into `OrchestratorService.installAgentRuntimeFactory` `defaultStreamingHooks`. 3 unit tests + 1 real-factory parity test.
- **Review fix #2 — `buildSubtask` could leave a persisted task behind on DAG-rebuild failure.** Cycle failures already rolled back; rebuild failures returned `{ accepted: false }` without removing the just-persisted task, leaving an orphan with no planner notification + no dispatch. Added the symmetric `updateStatus("discarded") + remove()` rollback in [orchestrator/buildSubtask.ts](packages/agent-manager/src/orchestrator/buildSubtask.ts). 4 new unit tests in `__tests__/buildSubtask.test.ts` cover happy path + cycle rollback + global-rebuild rollback + per-goal-rebuild rollback.
- **Review fix #3 — parity harness bypassed production wiring.** Original 5 stream-part tests injected a fake factory and pre-assigned `agent.onStreaming`. Added `__tests__/parity/realFactory.parity.test.ts` (4 tests) that builds a real `AgentRuntimeFactory` with the actual production visitors (StreamPublisher + ChannelB + Crdt + ErrorChannel), wires through `factory.wire()`, and asserts: stream parts reach StreamPublisher, ChannelB synthesizes started/completed transitions, ErrorChannelVisitor bridges failures, and a throwing extra visitor doesn't take out production visitors (composer isolation). This lifts the parity foundation from "smoke test" to "deletion gate candidate" — still needs lifecycle-tool fixtures before Patch #2 deletion is safe.
- **Review fix #4 — feature docs stale against May 9 code.** [feature_architecture.md](docs/features/agent-stream-bus/feature_architecture.md) said `wire()` throws without `taskId` (now stream-only when omitted) and `notifyTaskCreated` is optional (now required). [feature_implementation_planning.md](docs/features/agent-stream-bus/feature_implementation_planning.md) Phase 1.7 + 1.8a rows had the same drift. All updated; both rows now reference the May 9 collapse + required-hook + buildSubtask helper + DAG-rebuild rollback.

Test count: 137 → **148 pass / 0 fail** (+ErrorChannelVisitor x3, +buildSubtask x4, +realFactory parity x4).

## May 9 Evening — Lifecycle-Tool Parity (Patch #2 Deletion Gate)

Extended the Phase 1.11 parity foundation with the last gap before Patch #2 (delete legacy `WorkerPool.runTask()` branch) becomes safe: per-tool parity for `complete_task` / `bounce_task` / `request_task` / `report_status`.

Added [packages/agent-manager/src/__tests__/parity/lifecycleTools.parity.test.ts](packages/agent-manager/src/__tests__/parity/lifecycleTools.parity.test.ts) — 14 tests asserting the **single-orchestration-owner invariant**: for the same LLM tool invocation, legacy mode fires its typed callback exactly once and the hook is NOT invoked, while hooks mode fires the hook exactly once and the typed callback is NOT invoked. Both modes share the LLM-facing return strings.

Coverage:
- **report_status** (3 tests) — typed `onStatusUpdate` vs `onStatusChange` hook + `agentState.lastStatus` invariant in both modes (used by the `complete_task` blocked-guard).
- **complete_task** (5 tests) — report-doc precondition rejected identically in both modes; `report_status('blocked')` → blocked-guard rejection; full `TaskCompletePayload` (`producedDocs`, `decisions`) round-trips through the hook with `onTerminated('complete')`; rejected ack does NOT terminate.
- **bounce_task** (3 tests) — single-owner invariant; legacy owns `taskStore.updateStatus(failed)` while hooks mode delegates entirely to the orchestrator (no direct `taskStore` writes); suggested-role validation surfaces the same warning in both modes.
## May 9 PM-2 — Cleanup Chain Landed

User direction: "while deletion we should also make sure we convert all patches to proper solutions". The Patch #2 deletion was paired with the cascading collapse of #5, #6, #8, #11 in a single chain.

### What changed
- **Patch #2** — `WorkerPool.runTask()` legacy branch deleted. ~170 lines of dual-mode plumbing gone. Workers always go through `factory.wire()` + `agent.runWithHooks()`. `runTask` now throws if no factory was injected via `setRuntimeFactory()`.
- **Patch #6** — `PING_AGENT_RUNTIME_HOOKS` env var, `setRuntimeHooksEnabled()`, `isRuntimeHooksActive()`, `getWorkerMode()` all deleted from WorkerPool. `workerWiring: Map<taskId, { mode, generation }>` collapsed to `workerGenerations: Map<taskId, number>` (factory-swap invalidation only). The `OrchestratorService.installAgentRuntimeFactory` log + boot banner stripped accordingly.
- **Patch #5** — `executionMode` flag removed from `assembleLifecycleTools` + `requestTaskTool` + `bounceTaskTool`. The legacy local-mutation branches deleted (~270 lines across 3 files). `assembleLifecycleTools` now throws if `lifecycleHooks` is missing — there is no fallback.
- **Patch #8** — Agent-side `safeHook`/`safeHookAsync` wrappers deleted from `AiSdkAgent.runWithHooks`. The composer in `AgentRuntimeFactory.composeStreamingHooks` is the SOLE per-visitor isolation layer. The `AiSdkAgent.runWithHooks > does not break the loop when a visitor throws` test was rewritten to wire raw hooks through the production composer (matches reality).
- **Patch #11** — Three obsolete test files deleted (`WorkerPool.runtimeHooks.test.ts`, `lifecycleHooks.test.ts`, `parity/lifecycleTools.parity.test.ts`, `parity/streamPart.parity.test.ts` — total ~1,800 lines). Replaced with `WorkerPool.runtimeWiring.test.ts` (focused on factory-swap invariant) and `lifecycleTools.test.ts` (~230 lines, hooks-only integration). Parity harness slimmed to just `FakeAiSdkAgent` (no two-mode comparison surface).

### What was deferred and why
- **Patch #1** — `AiSdkAgent.execute()` AsyncGenerator stays for now. Workers are the only consumer that's been migrated to `runWithHooks()`. PlannerAgent (`return this.agent.execute(params)`), ChatAgent (`yield* agent.execute(input)`), and `GoalManager.ts:234` still iterate `execute()` directly. Deleting `execute()` requires migrating all three to `runWithHooks()` first — a separate cross-package effort. The forward dependency is documented; once those three migrate, `execute()` becomes deletable in one commit.
- **Patch #3** — `SocketEventBroadcaster` delete (~374 lines in `packages/backend/api/`) is a separate large cross-package refactor. Visitor-owns-persistence is the documented target shape but the migration touches Socket.IO event contracts and frontend channel subscriptions. Deferred to its own session.

### Test count
- Was 162 (with two-mode comparison tests); now **113 pass / 0 fail** after deleting ~1,800 lines of obsolete test code. Observable behavior coverage is unchanged — the deleted tests were asserting the two-path duality that no longer exists.

### Net code delta in this session
- `WorkerPool.ts`: 770 → ~600 lines.
- `assembleLifecycleTools.ts`: simpler (only one path).
- `requestTaskTool.ts` + `bounceTaskTool.ts`: legacy branches deleted.
- `AiSdkAgent.ts`: `safeHook` + `safeHookAsync` removed.
- Tests: -1,800 + 230 = ~-1,570 lines.

## May 9 PM-3 — Review Follow-ups

A second-pass review surfaced four items, all closed in-flight:

- **#1 — Direct worker-message path broken after hooks-only deletion.** `SocketMessageHandler.handleWorkerMessage` routed worker messages with no `taskId` to `manager.startTask(agentId, content)`, which created a synthetic task with no `goalId`. The new hooks-only `WorkerPool.runTask` requires both. **Resolution (CLI is being deprecated, so no fallback needed):** deleted `manager.startTask` + `manager.continueTask` + `handleWorkerMessage` + frontend `agentServiceV2.sendToWorker` + the legacy `else` branch in `ChatArea.tsx`. The chat-agent layer (`agentServiceV2.sendToChatAgent`) is the only path for talking to a specific worker role. Direct worker chat now returns an error string pointing to the chat-agent path.
- **#2 — Planning doc still referenced retired flag/dual-mode.** Updated Phase 1.6 / 1.7 / 1.8b / 1.8c rows in [feature_implementation_planning.md](feature_implementation_planning.md) with explicit "POST-CLEANUP" notes describing what shipped vs the original strangler design.
- **#3 — Stale `executionMode` comments in source + arch doc.** Fixed `AgentRuntimeFactory.ts` header docstring + `buildLifecycleHooks` JSDoc + `agent/index.ts` + `agent/runtime/index.ts` + `__tests__/AgentRuntimeFactory.test.ts` header + `feature_architecture.md` section "System Wiring".
- **#4 — `ErrorChannelVisitor` not exported from visitors barrel.** Added export to [packages/agent-manager/src/agent/streaming/visitors/index.ts](packages/agent-manager/src/agent/streaming/visitors/index.ts).

Test count unchanged: 113 pass / 0 fail. Typecheck clean.

## May 9 PM-4 — Patch #1 (execute() AsyncGenerator deprecation)

Migrated all production callers off `agent.execute()` to `runWithHooks()`. The AsyncGenerator method is now `@deprecated @internal` on the IAgent interface (kept for backwards compat + the FakeAiSdkAgent test override pattern).

### Changes
- **`GoalManager.executePlannerTurn`** ([packages/agent-manager/src/orchestrator/GoalManager.ts](packages/agent-manager/src/orchestrator/GoalManager.ts)): replaced `for await (const event of agent.execute(...))` with `await agent.runWithHooks(...)` + a per-turn streaming visitor wired via `factory.wire({ extraStreamingHooks: [{ onChunk }] })`. The visitor calls `streamCallbacks.onPlannerStream` with the same `(stream_part, agentId, taskId)` payload shape consumers see today.
- **`AgentManagerV2.chatAgentMessage` + `ChatAgent.handleUserMessage`** ([packages/agent-manager/src/AgentManagerV2.ts](packages/agent-manager/src/AgentManagerV2.ts) + [packages/agent-manager/src/chatAgent/ChatAgent.ts](packages/agent-manager/src/chatAgent/ChatAgent.ts)): replaced AsyncGenerator-yielding signatures with callback-driven `(content, opts: { onStream }) => Promise<void>` shape. Backend `SocketMessageHandler.handleChatAgentMessage` updated to pass an `onStream` callback. ChatAgent now requires `agentRuntimeFactory` injected at construction; AgentManagerV2 passes it through from `workerPool.getRuntimeFactory()`.
- **`PlannerAgent.execute()` wrapper** deleted. The only caller (`GoalManager.executePlannerTurn`) now reaches into `planner.getAgent()` and drives `runWithHooks` directly. Also deleted the now-redundant `wireStreamingIfConfigured` method (per-turn wire in GoalManager replaces it). Cleaned up unused `agentRuntimeFactory` + `goalId` config fields and unused `IStreamingAgent` / `AgentRuntimeFactory` imports.
- **`IAgent.execute`** marked `@deprecated @internal` ([packages/agent-manager/src/agent/types.ts](packages/agent-manager/src/agent/types.ts)). All production callers now go through `IStreamingAgent.runWithHooks`. The method is retained because `runWithHooks` itself drives `execute()` internally and the `FakeAiSdkAgent` test pattern overrides it. Future patch: replace `runWithHooks`'s internal `execute()` consumption with direct `streamText({ onChunk, onStepFinish, onFinish, onError })` callback wiring, then remove `execute()` from the interface.
- **WorkerPool**: added `getRuntimeFactory()` getter so callers (specifically AgentManagerV2's planner closure) can read the installed factory after `OrchestratorService.initialize()` has run.
- **NotificationQueue + PlannerAgent docstrings**: stale `agent.execute()` references updated to `agent.runWithHooks()`.
- **Stale test deleted**: `__tests__/PlannerAgent.test.ts` (covered the removed `wireStreamingIfConfigured` seam — not replaced; per-turn wire is exercised through `executePlannerTurn`).

### What this enables
- Direct per-turn visitor isolation for planner streams (StreamPublisher wiring goes through the same factory the workers use).
- Single execution surface (`runWithHooks`) for all production agents — workers, planner, chat-agent.
- `execute()` AsyncGenerator can be removed in one commit when `runWithHooks` is refactored to drive `streamText` callbacks directly.

### Status
- agent-manager: typecheck clean, **107 pass / 0 fail** (was 113; -6 obsolete PlannerAgent seam tests).
- backend: no new typecheck errors from this change (pre-existing PgGoalService / knowledge / workspace errors unrelated).

## May 9 PM-6 — Architecture-aligned ChatAgent + Planner stream fixes

A second-pass review against the architecture doc surfaced two real runtime bugs introduced during PM-4 / PM-5:

### Fix #1 (PM-5) was correct — planner stream double-delivery
Deleted the per-turn `plannerStreamVisitor` extra in `GoalManager.executePlannerTurn` + the `onPlannerStream` plumbing it routed through. The factory's default `StreamPublisherVisitor` already publishes planner streams to the goal room with `agentId="planner"`. PM-5 fix verified correct against architecture: "one visitor stack for ALL agents."

### Fix #2 redo (PM-6) — ChatAgent dual-path was the WRONG fix
PM-5 made ChatAgent bypass `factory.wire()` and use a per-call consumer with `socket.emit("stream")`. That's the unicast pattern the architecture doc explicitly says is the bug being fixed:
> ChatAgent: Unicast Bug → Broadcast Fixed
> BEFORE: socket.emit("stream") — only requesting socket sees response
> AFTER:  StreamPublisherVisitor → io.to(goalRoom).emit("stream") — all team members see it

Reverted to the architecture-correct shape:
- `ChatAgent.handleUserMessage` uses `factory.wire()` like workers and planner. The factory's default visitor stack is the SOLE owner of stream emission + persistence.
- `context.agentId = "chat-${role}"` so the visitor downstream can distinguish chat-agent runs from worker runs.
- `SocketEventBroadcaster.onStream` now sets `agentLayer = "chat-agent"` when `agentId` starts with `chat-`.
- `SocketMessageHandler.handleChatAgentMessage` no longer takes `onStreamPart` or persists the assistant message — both are owned by the visitor pipeline.
- `ChatAgentStreamConsumer` slimmed to `onFinish` / `onError` only (caller-side observation, not emission).

### Fix #3 + #4 — stale comments
- Implementation log Patch #1 status updated: PARTIAL (callers migrated, IAgent.execute marked @deprecated @internal).
- `OrchestratorService.installAgentRuntimeFactory` docstring no longer claims `PING_AGENT_RUNTIME_HOOKS` activation; the env flag was deleted PM-2.
- `diagrams.md` — `assembleLifecycleTools` notes updated: hooks is the only mode after Patch #5.

Test count unchanged: 107 pass / 0 fail. Typecheck clean.

## Recommended Next Action

**Patch #3 chain.** Decide `StreamPublisherVisitor` ownership: visitor-owns-persistence → delete `SocketEventBroadcaster.ts` (~374 lines) and rewire frontend Socket.IO channel mapping. Separate session — touches `packages/backend` + `packages/frontend`. The PM-6 fixes set up the right foundation: ChatAgent is now wired through the same single visitor stack, so the visitor-owns-persistence migration treats all three agent types uniformly.

Or: refactor `runWithHooks` to drive `streamText({ onChunk, onStepFinish, onFinish, onError })` callbacks directly so the `execute()` AsyncGenerator can finally be removed from `IAgent` and `AiSdkAgent`. ~270 lines of dual-path code in `AiSdkAgent` collapse.
