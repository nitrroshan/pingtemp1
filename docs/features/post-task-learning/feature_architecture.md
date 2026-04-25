# Post-Task Learning Extraction — Feature Architecture

> **Status:** ⚠️ NEEDS RETHINKING — DO NOT IMPLEMENT  
> **ID:** C4  
> **Depends on:** Chat Agent Layer (Phase 1 ✅), A8 Git Task Context (Phase 3)  
> **Related:** [git-task-context](../git-task-context/feature_architecture.md), [MASTER-ARCHITECTURE](../MASTER-ARCHITECTURE.md)  
> **Note:** Architecture options below are a first draft and have NOT been reviewed. Do not proceed to implementation planning until the review model (per-task vs per-goal extraction, cost/value, what triggers it) is resolved.

## Problem Statement

When a task completes or fails, valuable knowledge is lost. The agent discovered things during execution — API quirks, approaches that worked/failed, domain facts — but none of it persists beyond the task output string. Failed tasks are especially wasteful: the agent spent tokens learning something, then that learning evaporates.

Today `ChatAgent.onMyTaskCompleted()` only checks if all role tasks are done and notifies the planner. It doesn't inspect *what* the worker produced or learned.

---

## What Gets Extracted

| Source | What's There | Example |
|--------|-------------|---------|
| **Task output** (string) | Worker's summary of what it did | "Implemented auth middleware using JWT" |
| **Workspace branch diff** (Phase 3) | Actual files created/modified | 3 new files, 2 modified, 150 lines added |
| **Task failure reason** | Why it failed | "API rate limited after 50 calls" |
| **Tool call history** | What the agent tried | 12 tool calls, 3 retries on web_search |
| **Worker's final message** | Reflections, caveats | "Note: batch endpoint undocumented but works" |

Two destinations for extracted knowledge:

| Destination | What goes there | Who benefits |
|-------------|----------------|--------------|
| **L2 Team Memory (CRDT)** | Team-relevant facts, anti-patterns, domain knowledge | All agents on the team |
| **ChatAgent conversation** | Role-specific observations, task context for future dispatch | This role's ChatAgent |

---

## Architecture Options

### Option A: LLM-Powered Extraction (Background ChatAgent Call)

**Implementation:** After a task completes, ChatAgent sends the task output + diff summary to its LLM with a structured extraction prompt. The LLM returns categorized learnings. ChatAgent writes team-relevant ones to L2 via `collab` tool.

```
Task completes → onMyTaskCompleted()
  → Build extraction prompt (output + diff + failure reason)
  → ChatAgent LLM call (background, non-blocking)
  → LLM returns: { teamLearnings: [...], personalNotes: [...] }
  → Team learnings → L2 CRDT via collab tool
  → Personal notes → appended to ChatAgent conversation context
```

**Pros:**
- High-quality extraction — LLM understands nuance, context, implicit knowledge
- Catches things the worker didn't explicitly state
- Especially strong for failure analysis ("tried X, failed because Y")
- Natural fit — ChatAgent already has LLM, conversation context, and `collab` tool access

**Cons:**
- Extra LLM call per task completion (~500-2000 tokens, ~$0.01-0.05)
- Latency (~2-5 seconds) — but background, doesn't block anything
- Could extract noise (irrelevant "learnings") if prompt isn't tuned
- Needs workspace diff access (Phase 3 dependency)

**Effort:** 2-3 days (prompt engineering + wiring)

---

### Option B: Rule-Based Extraction (No LLM)

**Implementation:** Pattern-match on task output and failure reasons. Extract structured data without an LLM call. Heuristic categories: API limits, file patterns, error types, tool usage stats.

```
Task completes → onMyTaskCompleted()
  → Parse output for keywords (error, limit, rate, failed, retry)
  → Extract tool call stats (N calls, M retries, top tools)
  → If failed: capture error category + message
  → Write structured summary to L2 + conversation
```

**Pros:**
- Zero cost (no LLM call)
- Instant (no latency)
- Deterministic — same input always produces same output
- No prompt engineering needed

**Cons:**
- Low quality — misses nuance, implicit knowledge, domain context
- Only catches what patterns look for — blind to novel insights
- Failure analysis is shallow ("error: rate limit" vs understanding *why* the approach hit limits)
- Basically a logging upgrade, not real knowledge extraction

**Effort:** 1 day

---

### Option C: Hybrid — Rules First, LLM on Failures

**Implementation:** Use rule-based extraction for successful tasks (cheap, fast). Use LLM extraction only for failed tasks (where the learning is most valuable and nuanced).

```
Task completes → onMyTaskCompleted()
  → Always: extract tool stats, file counts, output summary (rules)
  → If FAILED or PARTIAL:
    → LLM extraction prompt with failure context
    → Extract anti-patterns, root cause, what to avoid
  → Write to L2 + conversation
```

**Pros:**
- Cost-efficient — LLM only on failures (minority of tasks)
- Failures get the deep analysis they need
- Successes still get basic metrics
- Progressive — can expand LLM to all tasks later if valuable

**Cons:**
- Two code paths to maintain
- Misses valuable insights from successful tasks ("batch API is 10x faster" only captured if it fails first)
- Inconsistent quality across success/failure

**Effort:** 2 days

---

## Recommendation

**Option A (LLM-Powered Extraction)** because:

1. The cost is trivial (~$0.01 per extraction) vs the value of accumulated team knowledge
2. ChatAgent already has an LLM — it's one additional call in `onMyTaskCompleted`
3. Failure analysis is the primary use case, and only LLM does it well
4. The extraction runs background (non-blocking) — latency doesn't matter
5. Team Memory compounds — after 50 tasks, agents have real institutional knowledge

Option B is too shallow to justify the feature. Option C adds complexity for marginal savings.

**Decision Required:** Please choose Option A, B, or C.
