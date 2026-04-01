# Token & Cost Tracking — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**ID:** D5  
**Phase:** 2 (comes with AI SDK migration — `streamText()` provides usage data)  
**Inspired by:** [Paperclip](../opensource-research/paperclip-research.md) — per-agent budgets, atomic enforcement

---

## Overview

Track every token consumed by every agent — prompt tokens, completion tokens, context window usage, cost in dollars. Display in UI. Essential for production use.

### Current State
- No token tracking anywhere
- No cost visibility
- No budget limits
- LangGraph `agent.invoke()` doesn't expose token usage easily

### Target State
- Every LLM call records: prompt tokens, completion tokens, total tokens
- Context window usage tracked per step (detect when agent is hitting the limit)
- Cost calculated per call (model rate × tokens)
- Aggregated per task, per agent, per goal
- Displayed in frontend (task dashboard, agent settings, admin)
- Optional: budget limits per team/agent with hard-stop

---

## What To Track

### Per LLM Call (raw event — just tokens)

```typescript
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

That's it. AI SDK gives you this after every `streamText()` call. Record it with context (which task, which role, which model) and aggregate up.

### Aggregation Levels

```
Per Call     → { promptTokens, completionTokens, totalTokens }
Per Task     → sum of all calls for that task + cost + duration
Per Worker   → sum of all tasks that worker executed
Per Role     → sum across all workers of that role
Per Team     → sum across all roles
Per Goal     → sum across all tasks in the goal
```

No separate schemas for each level — one usage record per task, aggregated on read:

```typescript
// One record per task — stored in MongoDB
interface TaskUsageRecord {
  taskId: string;
  goalId: string;
  teamId: string;
  role: string;
  model: string;
  
  promptTokens: number;              // total across all LLM calls in this task
  completionTokens: number;
  totalTokens: number;
  costUsd: number;                   // calculated from model pricing
  llmCalls: number;                  // how many streamText() calls
  
  peakContextWindowUsage: number;    // highest prompt/maxContext ratio
  
  startedAt: Date;
  completedAt: Date;
}

// Query for any aggregation level:
// Per role:  db.usage.aggregate({ $group: { _id: "$role", totalTokens: { $sum: "$totalTokens" } } })
// Per team:  db.usage.aggregate({ $group: { _id: "$teamId", ... } })
// Per goal:  db.usage.aggregate({ $group: { _id: "$goalId", ... } })
```

---

## How AI SDK Provides This

AI SDK's `streamText()` returns usage automatically — no extra work:

```typescript
const result = await streamText({ model, messages, tools });

// After streaming completes:
const usage = await result.usage;
// { promptTokens: 1500, completionTokens: 800, totalTokens: 2300 }

// Per step (multi-step agent loops):
const steps = await result.steps;
// steps[0].usage = { promptTokens: 1500, completionTokens: 200 }
// steps[1].usage = { promptTokens: 1700, completionTokens: 300 }  ← context grew
// steps[2].usage = { promptTokens: 2000, completionTokens: 300 }  ← growing!
```

### Where to Capture

In the `streamToSocket` bridge (Phase 2 streaming):

```typescript
async function streamToSocket(result, socket, room, messageId, taskId, role) {
  // ... stream parts to socket ...

  // After stream completes — capture usage
  const usage = await result.usage;
  const steps = await result.steps;
  
  await usageTracker.record({
    taskId,
    agentRole: role,
    model: result.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    steps: steps.map((s, i) => ({
      stepNumber: i,
      usage: s.usage,
      toolsCalled: s.toolCalls?.map(tc => tc.toolName) || [],
    })),
  });
}
```

---

## Model Pricing (for Cost Calculation)

```typescript
const MODEL_PRICING: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  'gpt-4o':              { promptPer1k: 0.0025,  completionPer1k: 0.01 },
  'gpt-4o-mini':         { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'claude-sonnet-4':     { promptPer1k: 0.003,   completionPer1k: 0.015 },
  'claude-haiku-3.5':    { promptPer1k: 0.0008,  completionPer1k: 0.004 },
  // ... add as needed
};

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens / 1000 * pricing.promptPer1k) + 
         (completionTokens / 1000 * pricing.completionPer1k);
}
```

---

## Storage

Uses the `TaskUsageRecord` defined above — one document per task in MongoDB:

```typescript
const UsageSchema = new Schema({
  taskId: { type: String, required: true, unique: true },
  goalId: String,
  teamId: String,
  role: String,
  model: String,
  
  promptTokens: Number,
  completionTokens: Number,
  totalTokens: Number,
  costUsd: Number,
  llmCalls: Number,
  peakContextWindowUsage: Number,
  
  // Per-step detail — from AI SDK result.steps
  steps: [{
    promptTokens: Number,
    completionTokens: Number,
    toolsCalled: [String],
    contextWindowUsage: Number,    // promptTokens / model.maxContext
  }],
  
  startedAt: Date,
  completedAt: Date,
});
```

Everything else (per role, per team, per goal) is a query — not a separate collection.

---

## Frontend Display

### In Task Dashboard (Phase 1+)

```
✅ T-001 Market Research    researcher    2m 15s    $0.12    4.2K tokens
🔄 T-004 Copy Writing       writer        ⏳ 2m     $0.08    3.1K tokens (67% context)
```

### In Admin / Goal Summary (Phase 3+)

```
┌─────────────────────────────────────────────────────────────┐
│  📊 Goal: Marketing Campaign                                │
│                                                              │
│  Total cost: $0.47          Total tokens: 18.4K              │
│                                                              │
│  By Role:                                                    │
│  📎 researcher   $0.15   6.2K tokens   2 tasks              │
│  📎 strategist   $0.08   3.1K tokens   1 task               │
│  📎 writer       $0.12   4.8K tokens   1 task               │
│  📎 designer     $0.07   2.1K tokens   1 task               │
│  📎 developer    $0.05   2.2K tokens   1 task               │
└─────────────────────────────────────────────────────────────┘
```

### Context Window Warning

When an agent's prompt tokens exceed 80% of the model's context window:

```
⚠️ Writer agent at 82% context window (105K / 128K tokens)
   Consider: summarizing conversation, reducing context, or upgrading model
```

---

## Budget Limits (v2 — Optional)

Not for v1, but the tracking enables it later:

```typescript
interface BudgetConfig {
  team?: { monthlyLimitUsd: number };
  perAgent?: Record<string, { monthlyLimitUsd: number }>;
  action: 'warn' | 'pause' | 'stop';  // what to do when limit hit
}

// Before each LLM call:
if (currentMonthSpend + estimatedCost > budget.monthlyLimitUsd) {
  if (budget.action === 'stop') throw new BudgetExceededError();
  if (budget.action === 'pause') await requestApproval('budget_exceeded');
  if (budget.action === 'warn') emitWarning('budget_approaching_limit');
}
```

---

## Implementation Checklist

| Component | Status | Effort |
|---|---|---|
| `UsageTracker` service | ❌ | 1 day |
| Capture usage from `streamText()` result | ❌ | 0.5 day (in streamToSocket bridge) |
| Model pricing table | ❌ | 0.5 day |
| MongoDB usage collection | ❌ | 0.5 day |
| Aggregate per task/goal/team | ❌ | 1 day |
| Task dashboard: show tokens + cost | ❌ | 1 day (Phase 2 frontend) |
| Goal summary: cost breakdown | ❌ | 1 day (Phase 3 frontend) |
| Context window warning | ❌ | 0.5 day |
| Budget limits (v2) | ❌ | 2-3 days (later) |

**Total effort:** ~5-6 days (spread across Phase 2-3)
