# Token & Cost Tracking — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 7 (Intelligence & Quality — but data capture starts in Phase 2 with streaming)  
**ID:** D5

---

## Branch
- `feature/cost-tracking`

## Scope
Track token usage per task from AI SDK `streamText()`. Calculate cost from model pricing. Store in MongoDB. Aggregate queries for frontend dashboards.

## Implementation Steps

### Step 1: Create Usage Types & Model Pricing
**Files to create:**
- `packages/backend/services/usage/types.ts` — `TaskUsageRecord`, `TokenUsage`, `ModelPricing` types
- `packages/backend/services/usage/pricing.ts` — Model pricing table: `gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4`, `claude-haiku-3.5`, etc. `calculateCost(model, promptTokens, completionTokens)` function.

**Exit criteria:** Pricing calculates correctly for all supported models

### Step 2: Create UsageTracker Service
**Files to create:**
- `packages/backend/services/usage/UsageTracker.ts` — `record(taskId, role, model, usage, steps)` method. Accumulates per-task across multiple `streamText()` calls. Calculates cost. Tracks peak context window usage from step data.

**Exit criteria:** Usage tracked per task, accumulates across multi-step agent loops

### Step 3: Create MongoDB Model
**Files to create:**
- `packages/backend/db/models/TaskUsage.ts` — Mongoose model for `TaskUsageRecord`. Unique on `taskId`. Indexes on `goalId`, `teamId`, `role`, `model`.

**Exit criteria:** Usage records persist to MongoDB

### Step 4: Wire into StreamBridge
**Files to modify:**
- `packages/backend/agent/streaming/StreamBridge.ts` — After stream completes, capture `result.usage` and `result.steps`. Call `UsageTracker.record()`.

**Where:** This hooks into the same spot as response scoring (Step 6 of LLM Response Grading).  
**Exit criteria:** Every `streamText()` call records token usage

### Step 5: Add Usage Query API
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add endpoints:
  - `GET /api/v2/usage?teamId=&goalId=&since=` — usage records
  - `GET /api/v2/usage/aggregate?groupBy=role|team|goal` — aggregated stats

**Exit criteria:** Frontend can query usage for dashboards

### Step 6: Add Budget Limits (Optional)
**Files to create:**
- `packages/backend/services/usage/BudgetEnforcer.ts` — Per-team configurable budget. Check before `streamText()`. Hard-stop if exceeded.

**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — Check budget before execution

**Exit criteria:** Teams can set token budgets, exceeded budget stops agent execution

### Step 7: Add Usage Display to Frontend
**Files to modify/create:**
- Task Dashboard: Show per-task `$cost`, `tokens`, `duration`
- Agent Settings: Show cumulative usage per agent
- Admin dash: Total usage by team, trending charts

**Exit criteria:** Token/cost data visible in UI

## Testing Strategy
- Unit test: cost calculation for each model
- Integration test: streamText → usage captured → MongoDB stored
- Test: multi-step agent loop accumulates correctly
- Test: budget enforcement stops execution when exceeded
- Test: aggregation queries return correct totals

## Complexity
Low-Medium — 1-2 weeks. AI SDK provides usage data natively.
