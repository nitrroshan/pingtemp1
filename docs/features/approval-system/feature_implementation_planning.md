# Approval System — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)
**Phase:** 2 (Post-Mastra)
**ID:** A9
**Depends on:** A1 (Mastra Migration — `requireApproval`, `suspend()`, storage provider), A5 Step 1 (types), A5 Step 2 (user interaction bridge)

---

## Branch
- `feature/approval-system` (branches from `dev` after A1 merges)

## Scope
Wire Mastra's native `requireApproval` and `suspend()` to Socket.IO frontend. Add our product layer on top: conditional approval functions, sticky decisions, auto-approve policy per team, plan/replan approval, and audit trail.

**What Mastra gives us (no code needed):**
- Pre-execution approval gate (`requireApproval: true`)
- Mid-execution suspension (`suspend()` / `resume()`)
- State persistence via storage provider (MongoDB)
- Stream events (`tool-call-approval`, `tool-call-suspended`)
- `requireReadBeforeWrite` guardrail

**What we build on top:**
- Stream event → Socket.IO routing
- Conditional approval logic (per-call based on args)
- Sticky decisions ("Approve always" per-run)
- `ApprovalPolicy` per team (auto-approve rules)
- Plan/replan approval (orchestrator-level, not tool-level)
- Audit trail (every decision logged to MongoDB)

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `orchestrator/types/approvalTypes.ts` | `ApprovalRequest`, `ApprovalOption`, `ApprovalDecision`, `ApprovalPolicy`, `ApprovalAuditEntry`, `StickyDecision` |
| `orchestrator/ApprovalSystem.ts` | Policy engine: `requestApproval()`, `shouldAutoApprove()`, sticky decisions, audit logging |
| `orchestrator/approvalStreamHandler.ts` | Catches Mastra stream events (`tool-call-approval`, `tool-call-suspended`) → routes to Socket.IO → feeds user response back to Mastra agent |
| `orchestrator/__tests__/approvalSystem.test.ts` | Unit + integration tests |

**Eliminated by Mastra**: `approvalWrapper.ts` (Mastra's `requireApproval` handles it), `toolSuspend.ts` (Mastra's `suspend()` handles it)

### Modified Files

| File | Change |
|------|--------|
| `orchestrator/schemas.ts` | Add `ApprovalRequestSchema`, `ApprovalDecisionSchema`, `ApprovalPolicySchema`, `SuspendPayloadSchema` |
| `orchestrator/index.ts` | Export `ApprovalSystem`, approval types |
| `api/SocketServerV2.ts` | Add `approval:decided` / `approval:resumed` handlers. Emit `approval:requested` / `approval:auto` / `approval:suspended` / `approval:timeout` |

**Note:** No `WorkerPool.ts` changes — Mastra's `requireApproval` handles the tool wrapping natively. No separate wrapper needed.

---

## Implementation Steps

### Step 1: Approval Types + Schemas
**Deps:** A1 (Mastra types available), A5 Step 1

**Files:** Create `approvalTypes.ts`, modify `schemas.ts`

**Types:** `ApprovalRequest` (4 payloads: plan, replan, tool, artifact), `ApprovalPolicy` per team, `StickyDecision`, `ApprovalAuditEntry`

**Exit:** Types compile, schemas validate

### Step 2: Stream Event → Socket.IO Wiring
**Deps:** Step 1, A1 (Mastra agent streaming works)

**Files:** Create `approvalStreamHandler.ts`, modify `SocketServerV2.ts`

**What it does:**
- Intercept Mastra's `tool-call-approval` stream chunk → check sticky decisions → check auto-approve policy → if needs human: emit `approval:requested` to frontend
- Intercept `tool-call-suspended` stream chunk → emit `approval:suspended` to frontend
- Handle `approval:decided` from frontend → call Mastra's agent approve/reject method
- Handle `approval:resumed` from frontend → call Mastra's agent resume method

**This replaces ~180 lines of custom code** (wrapper + suspend context) with ~50 lines of stream event routing.

**Exit:** Tool with `requireApproval: true` → frontend shows approval card → user approves → tool executes. Tool `suspend()` → frontend shows suspension card → user confirms → tool resumes.

### Step 3: ApprovalSystem Core (Policy + Sticky + Audit)
**Deps:** Step 2

**Files:** Create `ApprovalSystem.ts`

**What it does:**
- `shouldAutoApprove(req, policy)` — match request type against `ApprovalPolicy` settings
- `stickyDecisions: Map<toolName, ApprovalDecision>` — "Approve always" skips future approvals for that tool this run
- Conditional approval functions: `Record<string, (args) => boolean>` — called before Mastra's approval fires (checked in stream handler)
- `auditLog` — every decision (auto, manual, sticky) logged to MongoDB
- Plan/replan approval: uses A5's `ask_user` bridge (planner-level, not tool-level)

**Exit:** Auto-approve rules work per team. Sticky decisions persist per-run. Audit trail queryable.

### Step 4: Tests
**Deps:** Steps 1-3

**Tests:**
- Stream wiring: Mastra `tool-call-approval` → Socket.IO `approval:requested` → user responds → tool executes
- Stream wiring: Mastra `tool-call-suspended` → Socket.IO `approval:suspended` → user confirms → tool resumes
- Auto-approve: policy says `never` → tool runs without asking
- Auto-approve: policy says `destructive-only` → non-destructive runs, destructive asks
- Sticky: "Approve always" → subsequent calls skip approval
- Conditional: function evaluates args → approval only when condition met
- Audit: every decision type logged correctly
- Plan approval: planner requests → user approves → execution starts

**Exit:** All tests pass

---

## Package Dependencies
None new — Mastra provides the primitives; we just wire them.

---

## Complexity Estimate
~2-3 days total (down from 4-5 before Mastra). Most custom code eliminated:

| Step | Estimate | Notes |
|------|----------|-------|
| Step 1: Types | 0.5 day | Straightforward |
| Step 2: Stream wiring | 1 day | Main integration — understanding Mastra's stream event format |
| Step 3: Policy + sticky + audit | 1 day | Business logic, no framework integration |
| Step 4: Tests | 0.5 day | Focused on stream wiring edge cases |
