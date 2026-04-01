# Untrusted Code Review — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 6 (Isolation & Security)  
**ID:** A10  
**Approach:** Option A — Sandbox-Only (leverage A4)

---

## Branch
- `feature/untrusted-code-review`

## Scope (v1.0)
Add `trustLevel` field to Task type. Untrusted tasks automatically routed to sandboxed execution with restricted permissions. LLM proxy for sandboxed agents.

## Implementation Steps

### Step 1: Add Trust Level to Task Type
**Files to modify:**
- `packages/backend/orchestrator/types/taskTypes.ts` — Add `trustLevel: 'trusted' | 'untrusted'` to Task type
- `packages/backend/orchestrator/types/taskTypes.ts` — Add `TaskTrustConfig` with sandbox overrides: `networkAccess`, `maxMemoryMb`, `maxCpus`, `timeoutMs`, `mountSecrets`

**Exit criteria:** Tasks carry trust level, type system updated

### Step 2: Implement Trust Level Assignment
**Files to create:**
- `packages/backend/orchestrator/TrustAssigner.ts` — Assign trust level based on source:
  - User via chat → `trusted`
  - External PR (webhook) → `untrusted`
  - External agent (MCP) → `untrusted` (unless registered)
  - Child team → `trusted`
  - Scheduled task → `trusted`

**Exit criteria:** Tasks auto-tagged with correct trust level

### Step 3: Configure Sandbox for Untrusted Tasks
**Files to modify:**
- `packages/backend/services/WorkerPool.ts` — Check task `trustLevel` before dispatch. Untrusted → spawn sandbox with: no secrets, no host network, CPU/memory limits, timeout.

**Untrusted sandbox config:**
```typescript
{ networkAccess: false, maxMemoryMb: 512, maxCpus: 1, timeoutMs: 300_000, mountSecrets: false }
```

**Exit criteria:** Untrusted tasks execute in restricted sandbox

### Step 4: Implement LLM Proxy for Sandboxed Agents (v1.1)
**Files to create:**
- `packages/backend/services/sandbox/LlmProxy.ts` — Mount ONLY Azure OpenAI endpoint + key into sandbox. Agent inside sandbox can call LLM for reasoning but has no access to other secrets or internal services.

**Exit criteria:** Sandboxed agents can reason about code (not just static analysis)

### Step 5: Add Trust Level Override API
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add `PUT /api/v2/tasks/:taskId/trust` endpoint for admin override
- `packages/backend/api/HttpServer.ts` — Add allowlist config for trusted repos/agents

**Exit criteria:** Admins can override trust levels, configure allowlists

### Step 6: Return Structured Review Results
**Files to create:**
- `packages/backend/orchestrator/types/reviewTypes.ts` — `ReviewResult` type: `{ issues: Issue[], passed: boolean, risk: 'low' | 'medium' | 'high' }`

**Exit criteria:** Untrusted code review tasks return structured results

## Testing Strategy
- Test: untrusted task runs in sandbox with no secrets
- Test: trusted task runs normally (no extra restrictions)
- Test: trust level override API works
- Test: sandboxed agent can call LLM via proxy
- Test: sandboxed agent CANNOT access host network or secrets

## Complexity
Low (after A4 ships) — mostly a trust-level flag + sandbox config defaults. v1.1 LLM proxy adds ~2-3 days.
