# Untrusted Code Review — Feature Architecture

**Status:** Architecture Draft  
**Date:** April 1, 2026  
**ID:** A10  
**Depends on:** Worker Sandboxing (A4)  
**Feeds into:** Production Readiness

---

## Overview

When agents review or execute code from untrusted sources (user PRs, public repos, external contributions), that code must never run in the main backend process. This feature ensures untrusted code is evaluated inside an isolated sandbox with no access to host secrets, network, or other agents' data.

### Current State
- Workers run in-process — no isolation from the backend
- `AgentWorkspace` provides filesystem path separation but no process/network isolation
- Worker sandboxing feature (A4) designed but not built — Microsandbox primary, Docker fallback
- No distinction between "trusted" and "untrusted" tasks

### Target State
- Tasks tagged with trust level: `trusted` (internal) or `untrusted` (external input)
- Untrusted tasks automatically routed to sandboxed execution
- Sandbox has: filesystem isolation, process isolation, no host network, no secrets access
- Review output (lint results, test output, security scan) returned as structured data
- Trusted tasks can optionally run sandboxed for extra safety

---

## Threat Model

| Threat | Example | Mitigation |
|---|---|---|
| **Malicious code execution** | PR contains `rm -rf /` or crypto miner | Sandbox — no host access |
| **Secret exfiltration** | Code reads env vars / Azure keys | Sandbox has no secrets mounted |
| **Network abuse** | Code phones home, DDoS, or SSRF | Sandbox network disabled or restricted |
| **Resource exhaustion** | Infinite loop, memory bomb | Sandbox CPU/memory limits + timeout |
| **Cross-agent data access** | Code reads another agent's workspace | Sandbox mounted with only task workspace |

---

## Architecture Options

### Option A: Sandbox-Only (Leverage Worker Sandboxing A4)

**Implementation:** Untrusted tasks get routed to a sandboxed worker (Microsandbox or Docker from A4). The sandbox runs the same `ping-worker` image but with restricted permissions. No new infrastructure — just a trust-level flag that triggers sandbox mode.

```
Task created with trustLevel: 'untrusted'
  → Orchestrator assigns to WorkerPool
  → WorkerPool sees trustLevel → spawns sandboxed worker
  → Sandbox: no secrets, no host network, CPU/mem limits, timeout
  → Agent reviews code using sandbox tools (read files, run linter, run tests)
  → Output returned as structured review result
  → Sandbox destroyed
```

```typescript
interface TaskTrustConfig {
  trustLevel: 'trusted' | 'untrusted';
  sandbox?: {
    networkAccess: boolean;    // default: false for untrusted
    maxMemoryMb: number;       // default: 512
    maxCpus: number;           // default: 1
    timeoutMs: number;         // default: 300_000 (5 min)
    mountSecrets: boolean;     // default: false for untrusted
  };
}
```

**Pros:**
- Zero new infrastructure — uses Worker Sandboxing (A4) directly
- Simple — one flag decides execution mode
- Same agent code, same tools, different permissions
- Integrates with existing `SandboxProvider` abstraction

**Cons:**
- Depends on A4 being built first
- Agent inside sandbox has limited capabilities (no network = can't call LLM unless proxied)

**Effort:** Low — after A4 ships, this is a trust-level flag + sandbox config defaults

### Option B: Dedicated Review Container

**Implementation:** A separate Docker image (`ping-reviewer`) purpose-built for code review. Contains only static analysis tools (ESLint, Semgrep, tree-sitter) — no LLM access, no agent runtime. The orchestrator sends code to it and gets back a structured report.

```
Untrusted PR submitted
  → Orchestrator creates review task
  → Spawns ping-reviewer container with PR files mounted
  → Container runs: lint, type-check, security scan, test suite
  → Returns JSON report: { issues: [...], passed: boolean, risk: 'low'|'medium'|'high' }
  → Agent (running trusted, in-process) interprets report and comments on PR
```

**Pros:**
- Maximum isolation — reviewer has no LLM, no secrets, no agent logic
- Deterministic — same code always produces same report
- Fast — no LLM calls, just static analysis
- Could run without A4 (just Docker)

**Cons:**
- Two images to maintain (`ping-worker` + `ping-reviewer`)
- No AI reasoning — purely mechanical analysis
- Separate workflow from normal agent execution

**Effort:** Medium — new Docker image, new analysis pipeline, result schema

### Option C: Hybrid — Sandboxed Agent + Static Analysis Pre-filter

**Implementation:** Two stages. First, run static analysis tools (linters, security scanners) inside a minimal container — fast, no LLM. If the code passes basic checks, then run a sandboxed agent (from A4) for deeper AI-powered review. If static analysis finds critical issues, skip the expensive LLM step.

```
Untrusted PR submitted
  → Stage 1: Static analysis in minimal container (no LLM, no secrets)
     ← { criticalIssues: 0, warnings: 3, risk: 'low' }
  → Stage 2 (if risk ≤ medium): Sandboxed agent reviews with AI reasoning
     ← { review: "Code looks good, minor style issues...", approve: true }
  → Combined result returned to orchestrator
```

**Pros:**
- Fast rejection of obviously bad code (no LLM cost)
- AI reasoning for nuanced review
- Cost-efficient — static analysis is free, LLM calls are expensive
- Best of both worlds

**Cons:**
- Two stages = more complexity
- Needs both A4 (sandboxed agent) and a static analysis container
- Stage routing logic to maintain

**Effort:** Medium-High — builds on both A and B

## Recommendation

**Option A (Sandbox-Only)** — it's the simplest path and it's mostly "free" once Worker Sandboxing (A4) ships. The LLM proxy problem (agent in sandbox needs to call Azure OpenAI) is solvable: mount only the OpenAI endpoint URL + key, nothing else. The agent can reason about code while being isolated from everything else.

Option C is better but only worth the complexity when you have real untrusted code volume. Start with A, add the static pre-filter later if needed.

**Decision Required:** Please choose Option A, B, or C.

---

## Trust Level Assignment

How tasks get tagged:

| Source | Default Trust | Override? |
|---|---|---|
| User via chat UI | `trusted` | No — user is authenticated |
| External PR (webhook) | `untrusted` | Yes — allowlisted repos can be trusted |
| External agent (MCP) | `untrusted` | Yes — registered agents in registry can be trusted |
| Child team (team stacking) | `trusted` | No — Ping-to-Ping is trusted |
| Scheduled/recurring task | `trusted` | No — internally generated |

## Incremental Delivery

| Version | What | Independently Useful? |
|---|---|---|
| **v1.0** | `trustLevel` field on Task type + sandbox routing in WorkerPool | Yes — untrusted tasks sandboxed |
| **v1.1** | LLM proxy for sandboxed agents (mount only OpenAI endpoint) | Yes — sandboxed agents can reason |
| **v2.0** | Static analysis pre-filter (optional stage 1) | Yes — fast rejection, cost savings |
