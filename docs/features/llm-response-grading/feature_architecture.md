# LLM Response Rating/Grading — Feature Architecture

**Status:** Research + Planning  
**Date:** March 29, 2026

---

## Overview

Implement a system to **automatically evaluate and score LLM responses** for quality, accuracy, relevance, and safety. This enables data-driven improvement of agent prompts, model selection, and overall output quality.

---

## Research Findings

### Evaluation Approaches (Landscape)

| Approach | How It Works | Pros | Cons |
|---|---|---|---|
| **LLM-as-Judge** | Use a stronger/separate LLM to grade responses | Handles nuance, subjective quality | Costs per evaluation, judge model bias |
| **Rule-based scoring** | Regex, keyword checks, format validation | Fast, deterministic, free | Limited to surface-level checks |
| **Reference-based** | Compare to ground truth (BLEU, ROUGE, cosine similarity) | Objective when ground truth exists | Requires curated ground truth |
| **Statistical** | Content similarity, textual difference, keyword coverage | No LLM cost, reproducible | Can't assess reasoning quality |
| **Human feedback** | Thumbs up/down, ratings from users | Gold standard for subjective quality | Slow, doesn't scale |
| **Composite** | Combine multiple approaches, weighted scoring | Best overall signal | Complex to calibrate |

### Mastra Built-in Scorers (Available with `@mastra/evals`)

**Accuracy & Reliability:**
- `answer-relevancy` — How well responses address the input (0-1)
- `answer-similarity` — Compare against ground-truth answers (0-1)
- `faithfulness` — How accurately responses represent context (0-1)
- `hallucination` — Detect unsupported claims (0-1, lower=better)
- `completeness` — All necessary info included (0-1)
- `content-similarity` — Character-level text matching (0-1)
- `tool-call-accuracy` — Correct tool selection (0-1)
- `trajectory-accuracy` — Correct action sequence (0-1)
- `prompt-alignment` — Response aligns with prompt intent (0-1)

**Context Quality:**
- `context-precision` — Context ranking quality via MAP (0-1)
- `context-relevance` — Context utility with gap detection (0-1)

**Output Quality:**
- `tone-consistency` — Formality/style consistency (0-1)
- `toxicity` — Harmful content detection (0-1, lower=better)
- `bias` — Bias detection (0-1, lower=better)
- `keyword-coverage` — Technical terminology usage (0-1)

### Mastra Custom Scorers

4-step pipeline: `preprocess` → `analyze` → `generateScore` → `generateReason`. Each step can be a function (deterministic) or prompt object (LLM-as-judge). Supports live evaluations (async, sampled) and trace evaluations (batch, historical).

### Vercel AI SDK Integration

AI SDK provides `onStepFinish`, `onFinish` callbacks with `usage`, `finishReason`, `steps`, `toolCalls`, `toolResults` — raw data for scoring. Combined with Mastra scorers, we can evaluate every dimension.

---

## Architecture Options

### Option A: Mastra Evals Integration (Recommended)

**Implementation:** Use `@mastra/evals` scorers attached to our agents. Live evaluation with configurable sampling. Results stored in MongoDB. Dashboard for score visualization.

```
Agent Response
  │
  ├── Live Scoring (async, sampled)    ← @mastra/evals
  │   ├── answer-relevancy (LLM judge)
  │   ├── completeness (LLM judge)
  │   ├── hallucination (LLM judge)
  │   ├── tone-consistency (LLM judge)
  │   └── custom: task-adherence (LLM judge)
  │
  ├── Rule-based Scoring (sync, 100%)  ← Custom functions
  │   ├── format-compliance (regex/structural)
  │   ├── response-length (min/max bounds)
  │   ├── tool-usage-efficiency (tool calls vs result)
  │   └── latency-score (response time buckets)
  │
  ├── User Feedback (manual)           ← Frontend UI
  │   ├── thumbs up/down
  │   └── optional text feedback
  │
  └── Composite Score                  ← Weighted aggregate
      ├── quality_score = weighted(relevancy, completeness, faithfulness)
      ├── safety_score = weighted(toxicity, bias)
      ├── efficiency_score = weighted(latency, tool_usage, token_usage)
      └── overall_score = weighted(quality, safety, efficiency, user_feedback)
```

**Pros:**
- Battle-tested scorers out of the box (15+ built-in)
- Custom scorer pipeline for domain-specific evals
- Live evaluation with sampling (don't score every response — configurable %)
- Trace evaluation for batch analysis
- Async evaluation — doesn't block agent responses
- Natural fit if we adopt Mastra/AI SDK (Feature 1)

**Cons:**
- LLM-as-judge cost — each scored response costs additional LLM calls
- Requires `@mastra/evals` dependency
- Need to define scoring criteria per agent role

**Effort:** Medium (2-3 weeks for core + dashboard)

### Option B: Custom Scoring Engine (No Framework)

**Implementation:** Build our own scoring pipeline with LLM-as-judge calls using AI SDK `generateText` with structured output. Store scores in MongoDB. No framework dependency.

**Pros:**
- Full control over scoring logic
- No additional framework dependency
- Can use any model as judge

**Cons:**
- Must build what Mastra already provides (scorer pipeline, sampling, storage)
- More code to maintain
- Miss out on Mastra's prebuilt scorers

**Effort:** Medium-High (3-4 weeks)

### Option C: Third-party Eval Platform (Langfuse/Braintrust)

**Implementation:** Send traces to Langfuse or Braintrust for evaluation. Use their SDK for scoring, dashboards, and analysis.

**Pros:**
- Rich dashboards and analytics out of the box
- No scoring infrastructure to maintain
- Team collaboration features

**Cons:**
- External dependency — data leaves our system
- Cost per evaluation
- Less customizable scoring criteria
- Adds latency for trace ingestion

**Effort:** Low-Medium (1-2 weeks)

## Recommendation

**Option A** — Mastra Evals. Aligns with the broader Mastra/AI SDK migration (Feature 1). Built-in scorers cover most needs, custom scorers handle the rest. Async/sampled execution minimizes cost. Scoring results stored locally in MongoDB.

**Decision Required:** Please choose Option A, B, or C.

---

## Scoring Dimensions (Option A)

| Dimension | Scorer | Type | Sampling |
|---|---|---|---|
| Answer relevancy | `@mastra/evals` built-in | LLM judge | 50% |
| Completeness | `@mastra/evals` built-in | LLM judge | 50% |
| Hallucination | `@mastra/evals` built-in | LLM judge | 30% |
| Faithfulness | `@mastra/evals` built-in | LLM judge | 30% |
| Toxicity | `@mastra/evals` built-in | LLM judge | 100% |
| Tool-call accuracy | `@mastra/evals` built-in | LLM judge | 50% |
| Format compliance | Custom (rule-based) | Function | 100% |
| Response latency | Custom (rule-based) | Function | 100% |
| Token efficiency | Custom (rule-based) | Function | 100% |
| Task adherence | Custom (LLM judge) | LLM judge | 50% |
| User feedback | Frontend thumbs up/down | Manual | N/A |

## Data Model

```typescript
interface ResponseScore {
  id: string;
  agentId: string;
  taskId?: string;
  threadId: string;
  timestamp: Date;
  
  // Raw scores (0-1)
  scores: {
    relevancy?: number;
    completeness?: number;
    hallucination?: number;
    faithfulness?: number;
    toxicity?: number;
    toolCallAccuracy?: number;
    formatCompliance: number;
    latencyScore: number;
    tokenEfficiency: number;
    taskAdherence?: number;
  };
  
  // Composite scores
  qualityScore: number;    // weighted(relevancy, completeness, faithfulness)
  safetyScore: number;     // weighted(toxicity, bias)
  efficiencyScore: number; // weighted(latency, tokenUsage)
  overallScore: number;    // weighted aggregate
  
  // Metadata
  userFeedback?: { rating: 'up' | 'down'; comment?: string; };
  reasons?: Record<string, string>;  // human-readable explanations per dimension
  usage: { promptTokens: number; completionTokens: number; };
  responseTimeMs: number;
}
```

## Key Files

- `packages/backend/evals/` — new directory for evaluation system
- `packages/backend/evals/scorers/` — custom scorer definitions
- `packages/backend/evals/EvalService.ts` — orchestrate scoring per response
- `packages/backend/evals/types.ts` — ResponseScore, ScoringConfig types
- `packages/backend/db/models/ResponseScore.ts` — MongoDB schema
- `packages/frontend/components/ScorePanel/` — score visualization UI
