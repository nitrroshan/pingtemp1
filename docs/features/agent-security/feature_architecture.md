# Agent Security Hardening — Feature Architecture

**Status:** Planning — updated April 30, 2026 (post v2.0 + GitHub Connect audit)  
**Date:** April 26, 2026  
**Updated:** April 30, 2026  
**ID:** S1  
**Priority:** CRITICAL — must ship before enterprise/multi-tenant deployment  
**Related:** [auth-security](../auth-security/feature_architecture.md) (API/HTTP layer), [worker-sandboxing](../worker-sandboxing/feature_architecture.md) (process isolation)

---

## Scope

This document covers **agent-level security** — the risks that arise from LLM-powered agents executing tools, running scripts, and accessing resources. It is distinct from:

- **Auth Security** (covered in `auth-security/`) — HTTP/Socket auth, CORS, CSRF, session management
- **Worker Sandboxing** (covered in `worker-sandboxing/`) — process-level isolation via microsandbox/Docker

Agent Security sits between them: hardening what agents can do *within* the current in-process architecture, independent of whether sandboxing is deployed.

---

## Threat Model

### Who Are the Adversaries?

| Adversary | Vector | Likelihood |
|---|---|---|
| **Prompt injection via user input** | User message contains instructions that hijack agent behavior | HIGH — primary threat |
| **Indirect injection via external data** | Agent reads a file/URL containing hidden instructions | HIGH — agents process external content |
| **Malicious skill/plugin** | Compromised or rogue SKILL.md in registry | MEDIUM — supply chain risk |
| **Insider with API access** | Authorized user sends crafted messages to exploit agent tools | MEDIUM — enterprise scenario |
| **Agent-to-agent poisoning** | One compromised agent writes malicious content to shared CRDT docs, tricking other agents | LOW — requires multi-step exploitation |

### OWASP Top 10 for LLM (2025) — Applicability

| OWASP Risk | Applies to Ping? | Current Mitigation | Gap |
|---|---|---|---|
| **LLM01: Prompt Injection** | 🔴 YES | System prompts constrain behavior | No input filtering, no output validation |
| **LLM02: Sensitive Info Disclosure** | 🔴 YES | None | Skill scripts inherit `process.env` with all API keys |
| **LLM03: Supply Chain** | 🟡 PARTIAL | Skills loaded from local registry | No signature verification, no integrity checks |
| **LLM04: Data/Model Poisoning** | 🟢 LOW | Using hosted models (Azure/OpenAI) | N/A for hosted models |
| **LLM05: Improper Output Handling** | 🟡 PARTIAL | Tool outputs are text, not executed | Skill script output unsanitized |
| **LLM06: Excessive Agency** | 🔴 YES | Tools are role-scoped | No per-tool approval, no action budget |
| **LLM07: System Prompt Leakage** | 🟡 PARTIAL | Prompts contain architecture details | No prompt protection mechanisms |
| **LLM08: Vector/Embedding Weaknesses** | 🟢 LOW | No RAG/vector store yet | N/A |
| **LLM09: Misinformation** | 🟡 PARTIAL | Agent outputs reviewed by planner | No fact-checking layer |
| **LLM10: Unbounded Consumption** | 🟡 PARTIAL | `stepCountIs(200)` cap on agent loops | No per-goal LLM cost budget |

---

## Security Audit: Current Vulnerabilities

### 🔴 CRITICAL — P0

#### V1: Secret Leakage via Skill Scripts

**File:** [SkillPlugin.ts](../../../packages/backend/agentManager/plugins/SkillPlugin.ts) line 167

```typescript
execFile("bash", [entry.scriptPath, ...scriptArgs], {
  env: { ...process.env, SKILL_NAME: entry.id },  // ← LEAKS ALL SECRETS
});
```

**Impact:** Any skill script can read `AZURE_OPENAI_API_KEY`, `MONGODB_URI`, `BETTER_AUTH_SECRET` via `echo $AZURE_OPENAI_API_KEY`. A prompt-injected agent calling a skill with crafted args can exfiltrate all platform secrets.

**Exploit path:** Prompt injection → agent calls skill tool → script does `printenv` → output returned to agent → agent has all secrets.

**Fix:** Strip `process.env`. Only pass explicitly required vars:
```typescript
env: { SKILL_NAME: entry.id, PATH: "/usr/bin:/bin", HOME: "/tmp" }
```

#### V2: Path Traversal in WorkspaceStorage

**File:** [WorkspaceStorage.ts](../../../packages/backend/storage/WorkspaceStorage.ts) line 39

```typescript
async read(filePath: string): Promise<string | null> {
  return await fs.readFile(path.join(this.baseDir, filePath), "utf8");
  // ← No sanitization. path.join("base", "../../etc/passwd") resolves outside base
}
```

**Impact:** Read/write arbitrary files on the host filesystem. Not used by agent workspace tools (those use `AgentWorkspace.sanitizePath()`), but used by backend storage layer.

**Fix:** Add path escape check:
```typescript
const resolved = path.resolve(this.baseDir, filePath);
if (!resolved.startsWith(path.resolve(this.baseDir))) throw new Error("Path escape");
```

#### V3: Network Exfiltration via Skill Scripts

**File:** [SkillPlugin.ts](../../../packages/backend/agentManager/plugins/SkillPlugin.ts) line 160

Child processes spawned by `execFile("bash", ...)` have full network access. A skill script can `curl` to any URL, reach internal services (`localhost:27017` MongoDB, `localhost:3002` backend API), and exfiltrate data.

**Impact:** Data theft, SSRF to internal network, lateral movement.

**Fix:** Network sandboxing (microsandbox/Docker network policy) or restrict child process capabilities via seccomp profile.

### 🟠 HIGH — P1

#### V4: Symlink Escape in AgentWorkspace

**File:** [AgentWorkspace.ts](../../../packages/workspace/src/L1/workspace/AgentWorkspace.ts) line 1228

`sanitizePath()` blocks `../` and `/` prefixes but does **not** check if the resolved path is a symlink pointing outside the workspace.

**Exploit:** Agent creates a symlink `workspace/link → /etc/`, then reads `link/passwd`.

**Fix:** Use `fs.lstat()` to check for symlinks before reading, or use `fs.realpath()` and verify the resolved path stays within `basePath`.

#### V5: Unbounded Task Creation

**File:** [assembleLifecycleTools.ts](../../../packages/agent-manager/src/services/tools/assembleLifecycleTools.ts)

The `request_task` tool lets agents create subtasks with no limit. A prompt-injected agent could create thousands of tasks → resource exhaustion (git branches, memory, LLM API costs).

**Fix:** Add `MAX_TASKS_PER_PLAN` (e.g., 50) in TaskStore. Rate-limit `request_task` calls per agent.

#### V6: Skill Registry Integrity

**File:** Skills loaded from `packages/registry/plugins/<team>/skills/*/SKILL.md`

No signature verification, no integrity checks. If the registry directory is writable or compromised, arbitrary scripts execute with platform privileges.

**Fix:** Read-only registry mount in production. Hash verification of SKILL.md files. Optional GPG signing.

### 🟡 MEDIUM — P2

#### V7: LLM Cost Exhaustion

Agent loops capped at 200 steps (`stepCountIs(200)`) but no per-goal or per-team LLM API cost budget. A compromised agent can burn through API credits.

**Fix:** Per-team token budget. Track `usage.totalTokens` from AI SDK responses. Alert and halt when budget exceeded.

#### V8: System Prompt Leakage

System prompts contain architecture details (role descriptions, team structure, tool names). A prompt-injected agent could be instructed to return its system prompt, revealing internal design to attackers.

**Fix:** Instruct models to refuse prompt disclosure. Mark system prompts as non-returnable.

#### V9: Skill Script Argument Injection

**File:** [SkillPlugin.ts](../../../packages/backend/agentManager/plugins/SkillPlugin.ts) line 155

```typescript
const scriptArgs = args ? args.split(/\s+/) : [];
```

While `execFile` prevents shell expansion (unlike `exec`), the args are still passed as positional parameters to bash scripts. Scripts that use `eval "$@"` or similar patterns could be exploited.

**Fix:** Validate args against `[a-zA-Z0-9._-]` allowlist. Reject args containing shell metacharacters.

#### V10: Logging Sensitive Data

**File:** [SkillPlugin.ts](../../../packages/backend/agentManager/plugins/SkillPlugin.ts) line 158

```typescript
logger.info(`Running skill script: ${entry.scriptPath} ${scriptArgs.join(" ")}`);
```

Script args are logged in cleartext. If args contain tokens or sensitive data, they appear in log files.

**Fix:** Redact args in log output. Add a secret scrubbing filter to the logger.

---

## What Others Do: Industry Reference

| Platform | Isolation Model | Key Security Features |
|---|---|---|
| **OpenHands** (50k+ stars) | Docker container per agent | Full process isolation, sandboxed shell, event stream architecture |
| **SWE-Agent** (15k+ stars) | Docker with interactive shell | Containerized execution, no host access |
| **Devin** (commercial) | Cloud VM per task | Full VM isolation, network controls, ephemeral environments |
| **Claude Code** (Anthropic) | Permission system | Tool approval prompts, file allowlists, bash command review |
| **Cursor** | IDE sandbox | Restricted filesystem access, user-approved commands |
| **Microsandbox** | MicroVM (<100ms boot) | Secret placeholder-swap, network policy, filesystem hooks |
| **E2B** | Cloud sandbox | Ephemeral VMs, API-based file access, network isolation |

### Key Patterns from Industry

1. **Least privilege by default** — Agents start with minimal tools. Dangerous tools require explicit opt-in or user approval.
2. **Secret isolation** — Secrets are never in the agent's environment. They're injected at the infrastructure level (microsandbox placeholder-swap, Vault, etc.).
3. **Process boundary** — Tool execution happens in a separate process/container/VM from the orchestration logic.
4. **Output sanitization** — Agent outputs are filtered for sensitive patterns before being returned to users or other agents.
5. **Action budgets** — Per-task limits on tool calls, LLM tokens, and created resources.
6. **Human-in-the-loop** — Destructive or high-risk actions require user confirmation.

---

## Architecture Options

### Option A: Incremental Hardening (In-Process)

Fix vulnerabilities within the current in-process architecture. No containers or VMs.

**Implementation:**
- Strip `process.env` from skill child processes
- Add path escape checks to `FsWorkspaceStorage`
- Add symlink detection to `sanitizePath()`
- Add task creation limits and LLM cost budgets
- Add secret scrubbing to logger
- Add skill arg validation

**Pros:**
- Zero infrastructure changes — pure code fixes
- Can ship in 2-3 days
- No performance impact
- Eliminates P0 secrets leak and path traversal

**Cons:**
- No process isolation — a Node.js vulnerability still exposes everything
- Network exfiltration not fully solved (child processes still have network)
- Defense in depth is shallow

**Effort:** 3-5 days

### Option B: Sandbox-First (Microsandbox/Docker)

Move all tool execution into sandboxed environments. Implement the full `worker-sandboxing` feature (A4).

**Implementation:**
- Build `SandboxProvider` abstraction
- Route workspace tools through sandbox
- Microsandbox secret placeholder-swap
- Network policy per sandbox
- Resource limits (memory, CPU, duration)

**Pros:**
- Hardware-level isolation (microVM)
- Secrets never enter the sandbox
- Network exfiltration fully blocked
- Industry-standard approach (OpenHands, Devin model)

**Cons:**
- 2-3 weeks to build
- Requires microsandbox runtime (macOS Apple Silicon or Linux KVM)
- Adds latency to tool calls (guest agent communication)
- Some microsandbox features still "coming soon"

**Effort:** 2-3 weeks

### Option C: Layered — Quick Fixes Now, Sandbox Later (Recommended)

Ship Option A immediately (2-3 days). Then build Option B as a follow-up (2-3 weeks). This gives you defense-in-depth: code-level hardening + process-level isolation.

**Implementation:**

**Phase 1 (days, ship now):**
- V1: Strip `process.env` from skill `execFile`
- V2: Path escape check in `FsWorkspaceStorage`
- V4: Symlink detection in `sanitizePath()`
- V5: `MAX_TASKS_PER_PLAN` limit
- V9: Skill arg validation
- V10: Secret scrubbing in logs

**Phase 2 (weeks, ship with worker-sandboxing):**
- V3: Network isolation via microsandbox/Docker
- V6: Skill registry signing
- V7: LLM cost budgets
- V8: System prompt protection
- Full `SandboxProvider` from `worker-sandboxing` feature

**Pros:**
- P0 vulnerabilities closed immediately
- No enterprise deployment blocked
- Full isolation ships as enhancement, not blocker
- Each phase is independently valuable

**Cons:**
- Two phases of work
- Phase 1 doesn't solve network exfiltration

**Effort:** 3-5 days (Phase 1) + 2-3 weeks (Phase 2)

## Recommendation

**Option C** — layered approach. Ship Phase 1 code fixes immediately (they're trivial, high-impact). Build Phase 2 sandbox when you start onboarding external users/teams.

**Decision Required:** Please choose Option A, B, or C.

---

## Vulnerability × Fix Matrix

| ID | Vulnerability | Severity | Phase 1 Fix | Phase 2 Fix |
|---|---|---|---|---|
| V1 | Secret leak via skill `execFile` | 🔴 CRITICAL | Strip `process.env` | Microsandbox `secretEnv()` |
| V2 | Path traversal in `FsWorkspaceStorage` | 🔴 CRITICAL | `path.resolve()` + escape check | Sandbox filesystem isolation |
| V3 | Network exfiltration via scripts | 🔴 CRITICAL | — | Microsandbox network policy |
| V4 | Symlink escape in workspace | 🟠 HIGH | `fs.lstat()` symlink check | Sandbox filesystem isolation |
| V5 | Unbounded task creation | ✅ FIXED | Max 5 tasks per agent per plan | — |
| V6 | Skill registry integrity | 🟠 HIGH | Read-only mount | Hash verification + signing |
| V7 | LLM cost exhaustion | 🟡 MEDIUM | — | Per-team token budget |
| V8 | System prompt leakage | 🟡 MEDIUM | Prompt refusal instruction | — |
| V9 | Skill arg injection | 🟡 MEDIUM | Arg allowlist validation | Sandbox execution |
| V10 | Logging secrets | 🟡 MEDIUM | Secret scrubbing filter | — |
| V11 | GitHub token in `.git/config` | 🔴 CRITICAL | Use `GIT_ASKPASS` instead of URL embedding | Microsandbox secret isolation |
| V12 | `cleanupPlan` path traversal | 🟠 HIGH | Validate planId format | — |
| V13 | `repoUrl` SSRF | 🟡 MEDIUM | Validate HTTPS + allowlist hosts | — |

### New Vulnerabilities (April 30, 2026 — Post v2.0 + GitHub Connect)

#### V11: GitHub Token Embedded in Clone URL (CRITICAL)

**File:** [AgentWorkspace.ts](../../../packages/workspace/src/L1/workspace/AgentWorkspace.ts) line ~270

```typescript
cloneUrl = cloneUrl.replace("https://", `https://oauth2:${options.authToken}@`);
```

**Impact:** Token persists in `.git/config` as `url = https://oauth2:TOKEN@github.com/...`. Exposed in:
- `.git/config` plaintext (any file read in workspace)
- Git error messages on clone/push failure
- `GIT_TRACE` output
- Agent could read `.git/config` and exfiltrate the token

**Fix:** Use `GIT_ASKPASS` environment variable instead of URL embedding:
```typescript
// Create a temporary script that echoes the token
const askPassScript = path.join(os.tmpdir(), `git-askpass-${taskId}.sh`);
await fs.writeFile(askPassScript, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
// Clone with GIT_ASKPASS — token never in URL or .git/config
await git.env({ GIT_ASKPASS: askPassScript }).clone(repoUrl, targetDir);
// Delete the script after clone
await fs.unlink(askPassScript);
```

#### V12: cleanupPlan Path Traversal (HIGH)

**File:** [WorkspaceManager.ts](../../../packages/workspace/src/L1/workspace/WorkspaceManager.ts) `cleanupPlan()`

```typescript
const planDir = path.join(this.workspacesRoot, `plan-${planId}`);
await fs.promises.rm(planDir, { recursive: true, force: true });
```

**Impact:** `planId = "../../../sensitive"` → deletes `{workspacesRoot}/../../../sensitive`.

**Fix:** Validate planId and verify resolved path stays within workspacesRoot:
```typescript
if (!/^[a-zA-Z0-9_-]+$/.test(planId)) throw new Error("Invalid planId");
const resolved = path.resolve(this.workspacesRoot, `plan-${planId}`);
if (!resolved.startsWith(path.resolve(this.workspacesRoot))) throw new Error("Path escape");
```

#### V13: repoUrl SSRF via SubmitPlanSchema (MEDIUM)

**File:** [submitPlan.ts](../../../packages/agent-manager/src/orchestrator/tools/submitPlan.ts) line ~28

`repoUrl` is `z.string()` with no validation. A prompt-injected agent could set:
- `repoUrl: "http://169.254.169.254/latest/meta-data/"` (AWS metadata)
- `repoUrl: "http://localhost:27017"` (MongoDB)
- `repoUrl: "https://host/repo --upload-pack=evil"` (git option injection)

**Fix:** Validate URL scheme and host:
```typescript
repoUrl: z.string()
  .refine(url => url.startsWith("https://github.com/") || url.startsWith("https://gitlab.com/"),
    "Only GitHub and GitLab HTTPS URLs are allowed")
```

---

## What Existing Security Covers (No Action Needed)

| Component | Status | Details |
|---|---|---|
| **AgentWorkspace.sanitizePath()** | ✅ Solid | Blocks `../`, absolute paths. Normalizes via `path.normalize()` |
| **SafeAgentWorkspace** | ✅ Solid | `requireReadBeforeWrite`, `readOnlyPaths`, `maxFileSizeBytes` (1MB) |
| **HTTP auth** | ✅ Implemented | better-auth session validation, 7-day expiry |
| **Socket.IO auth** | ✅ Implemented | Per-connection session validation |
| **Rate limiting (HTTP)** | ✅ Implemented | 200 req/60s per IP, covers GitHub endpoints |
| **Rate limiting (Socket)** | ✅ Implemented | Token bucket: 5 burst, 1/sec per user |
| **MongoDB queries** | ✅ Safe | Mongoose ODM, parameterized queries |
| **CORS** | ✅ Allowlist | Specific origins (not `*`) |
| **Message validation** | ✅ Partial | Zod schemas on Socket.IO, 100KB limit |
| **Git operations** | ✅ Safe | Array args (no shell string eval) |
| **Tool injection** | ✅ Controlled | Only PluginRegistry-registered tools reach agents |
| **Task creation limits** | ✅ Fixed | Max 5 tasks per agent per plan via `request_task` tool |
| **GitHub API endpoints** | ✅ Authenticated | Behind `/api/v2` auth middleware |
| **GitHub token in service** | ✅ Safe | Not logged, retrieved safely from account table |
