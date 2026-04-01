# LLM Response Grading — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 7 (Intelligence & Quality)  
**Approach:** Option A — Mastra Evals Integration

---

## Branch
- `feature/llm-response-grading`

## Scope
Automatic scoring of agent outputs using `@mastra/evals` built-in scorers + custom rule-based scorers. User feedback UI. Composite scoring. MongoDB storage.

## Implementation Steps

### Step 1: Install Dependencies
**Files to modify:**
- `packages/backend/package.json` — Add `@mastra/evals`

**Exit criteria:** Dependency installed, imports work

### Step 2: Create ResponseScorer Service
**Files to create:**
- `packages/backend/services/scoring/ResponseScorer.ts` — Orchestrate scoring pipeline: receive agent response → run applicable scorers → compute composite scores → store
- `packages/backend/services/scoring/types.ts` — `ResponseScore`, `ScorerConfig`, composite score interfaces

**Scoring pipeline:**
1. Rule-based scorers (sync, 100% sampling): format compliance, response length, token efficiency, latency
2. LLM-as-judge scorers (async, configurable sampling %): relevancy, completeness, hallucination, faithfulness, toxicity, task adherence
3. Composite scores: quality, safety, efficiency, overall

**Exit criteria:** Scorer pipeline runs, returns composite scores

### Step 3: Implement Rule-Based Scorers
**Files to create:**
- `packages/backend/services/scoring/scorers/formatCompliance.ts` — Check JSON/markdown format adherence
- `packages/backend/services/scoring/scorers/responseMetrics.ts` — Response length bounds, token efficiency, latency score

**Exit criteria:** Rule-based scorers run on 100% of responses, return 0-1 scores

### Step 4: Integrate Mastra LLM-Judge Scorers
**Files to create:**
- `packages/backend/services/scoring/scorers/mastraScorers.ts` — Configure `@mastra/evals` built-in scorers: `answer-relevancy`, `completeness`, `hallucination`, `faithfulness`, `toxicity`, `tool-call-accuracy`

**Sampling configuration:** Per scorer, configurable % (default: relevancy 50%, toxicity 100%, hallucination 30%)  
**Exit criteria:** LLM judge scorers run asynchronously with sampling

### Step 5: Create Custom Task-Adherence Scorer
**Files to create:**
- `packages/backend/services/scoring/scorers/taskAdherence.ts` — Custom 4-step pipeline: preprocess (extract acceptance criteria) → analyze (compare output to criteria) → generateScore → generateReason

**Exit criteria:** Task adherence scored against acceptance criteria from plan

### Step 6: Wire Scoring into Agent Execution
**Files to modify:**
- `packages/backend/agent/streaming/StreamBridge.ts` — After stream completes, pass response + context to `ResponseScorer.score()`. Run async (don't block agent response).

**Exit criteria:** Every agent response gets scored (async, non-blocking)

### Step 7: Create MongoDB Storage
**Files to create:**
- `packages/backend/db/models/ResponseScore.ts` — Mongoose model for `ResponseScore`. Indexes on `agentId`, `taskId`, `timestamp`.

**Exit criteria:** Scores persisted, queryable by agent/task/time

### Step 8: Add User Feedback API
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add `POST /api/v2/scores/:responseId/feedback` for thumbs up/down + optional comment
- `packages/backend/api/SocketServerV2.ts` — Handle `response:feedback` event

**Exit criteria:** Users can submit feedback, stored alongside auto scores

### Step 9: Add Score Query API
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add `GET /api/v2/scores?agentId=&taskId=&since=` endpoint. Aggregation endpoints for per-role, per-team averages.

**Exit criteria:** Frontend can query scores for dashboards

## Testing Strategy
- Unit test: each scorer returns valid 0-1 scores
- Integration test: agent response → scoring pipeline → MongoDB storage
- Test: sampling works (50% means ~50% of responses scored by LLM judge)
- Test: user feedback stored and retrieved
- Test: composite score calculation correct

## Research Added to Architecture
- **Cost estimation:** With 50% sampling and gpt-4o-mini as judge, scoring cost is ~$0.001-0.005 per scored response. For 100 responses/day: ~$0.10-0.50/day.
- **Latency:** LLM judge scoring adds 1-3s per scored response, but runs async — no user-visible impact.

## Complexity
Medium — 2-3 weeks for core + dashboard integration.
