# Agent Security Hardening — Implementation Plan

> **Parent:** [feature_architecture.md](feature_architecture.md)  
> **Status:** Planning  
> **Branch:** `feature/agent-security-p0`  
> **Priority:** CRITICAL — blocks production deployment  
> **Depends on:** Nothing — all fixes are in existing files

## Branch
- `feature/agent-security-p0`

## Scope

Fix all CRITICAL and HIGH vulnerabilities identified in the security audit (April 30, 2026). Phase 1 only — code-level hardening, no sandbox infrastructure.

## Implementation Steps

- [ ] **Step 1: Strip `process.env` from skill scripts** (V1, CRITICAL, 10 min)  
  File: `packages/backend/agentManager/plugins/SkillPlugin.ts` line ~167  
  Entry: `execFile` passes `env: { ...process.env, SKILL_NAME: entry.id }` — leaks all API keys  
  Exit: Only pass `SKILL_NAME`, `PATH`, `HOME`. No secrets reachable by child process.  
  ```typescript
  // BEFORE:
  env: { ...process.env, SKILL_NAME: entry.id },
  // AFTER:
  env: { SKILL_NAME: entry.id, PATH: "/usr/bin:/bin:/usr/local/bin", HOME: "/tmp" },
  ```

- [ ] **Step 2: Fix `FsWorkspaceStorage` path traversal** (V2, CRITICAL, 15 min)  
  File: `packages/backend/storage/WorkspaceStorage.ts` lines 39-67  
  Entry: `path.join(baseDir, filePath)` with no validation — `../../etc/passwd` works  
  Exit: All file ops validate resolved path stays within `baseDir`.  
  ```typescript
  private safePath(filePath: string): string {
    const resolved = path.resolve(this.baseDir, filePath);
    if (!resolved.startsWith(path.resolve(this.baseDir) + path.sep) && resolved !== path.resolve(this.baseDir)) {
      throw new Error("Path traversal blocked");
    }
    return resolved;
  }
  ```

- [ ] **Step 3: Fix GitHub token in `.git/config`** (V11, CRITICAL, 30 min)  
  File: `packages/workspace/src/L1/workspace/AgentWorkspace.ts` line ~270  
  Entry: Token embedded in clone URL: `https://oauth2:TOKEN@github.com/...` — persists in `.git/config`  
  Exit: Use `GIT_ASKPASS` env var — token never in URL, never in `.git/config`.  
  ```typescript
  // Write a temp script that provides the token via GIT_ASKPASS
  const askPassScript = path.join(os.tmpdir(), `git-askpass-${this.taskId}.sh`);
  await fs.promises.writeFile(askPassScript, `#!/bin/sh\necho "${options.authToken}"`, { mode: 0o700 });
  try {
    await this.gitManager.clone(options.repoUrl!, this.basePath, {
      branch: options.repoBranch,
      sparse: options.sparse,
      env: { GIT_ASKPASS: askPassScript },
    });
  } finally {
    await fs.promises.unlink(askPassScript).catch(() => {});
  }
  ```
  Also update `GitBranchManager.clone()` to accept optional `env` parameter and pass to `simpleGit`.

- [ ] **Step 4: Validate `cleanupPlan` planId** (V12, HIGH, 10 min)  
  File: `packages/workspace/src/L1/workspace/WorkspaceManager.ts` `cleanupPlan()`  
  Entry: `planId` not validated — path traversal via `../../../sensitive`  
  Exit: Regex validation + resolved path containment check.  
  ```typescript
  async cleanupPlan(planId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(planId)) {
      throw new Error(`Invalid planId: ${planId}`);
    }
    const planDir = path.resolve(this.workspacesRoot, `plan-${planId}`);
    if (!planDir.startsWith(path.resolve(this.workspacesRoot))) {
      throw new Error("Path escape in cleanupPlan");
    }
    // ...rest of cleanup
  }
  ```

- [ ] **Step 5: Add symlink detection to `sanitizePath`** (V4, HIGH, 15 min)  
  File: `packages/workspace/src/L1/workspace/AgentWorkspace.ts` `sanitizePath()`  
  Entry: No symlink check — agent can create `workspace/link → /etc/` then read through it  
  Exit: After path normalization, resolve via `fs.realpathSync` and verify still within basePath.  
  ```typescript
  private sanitizePath(relativePath: string): string {
    const normalized = path.normalize(relativePath).replace(/\\/g, "/");
    if (normalized.startsWith("..") || normalized.startsWith("/")) {
      throw new Error(`Invalid path: '${relativePath}'`);
    }
    const clean = normalized.replace(/^\.\//, "");
    // Symlink check: resolve actual path and verify containment
    const fullPath = path.join(this.basePath, clean);
    try {
      const realPath = fs.realpathSync(fullPath);
      if (!realPath.startsWith(fs.realpathSync(this.basePath))) {
        throw new Error(`Symlink escape: '${relativePath}' resolves outside workspace`);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err; // File doesn't exist yet — OK
    }
    return clean;
  }
  ```

- [ ] **Step 6: Validate `repoUrl` in SubmitPlanSchema** (V13, MEDIUM, 10 min)  
  File: `packages/agent-manager/src/orchestrator/tools/submitPlan.ts` line ~28  
  Entry: `repoUrl` is `z.string()` — no SSRF protection  
  Exit: Validate HTTPS scheme, reject internal IPs.  
  ```typescript
  repoUrl: z.string()
    .refine(url => /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//.test(url),
      "Only HTTPS URLs from GitHub, GitLab, or Bitbucket are allowed")
  ```

- [ ] **Step 7: Add secret scrubbing to logger** (V10, MEDIUM, 15 min)  
  File: `packages/backend/logging/index.ts`  
  Entry: API keys could appear in log output (from skill args, error messages)  
  Exit: Logger sanitizes known patterns (`sk-*`, `ghp_*`, `Bearer *`) before writing.

## Testing

- V1: Run skill script, verify `echo $AZURE_OPENAI_API_KEY` returns empty
- V2: Attempt `read("../../etc/passwd")` on FsWorkspaceStorage — expect error
- V3: Clone private repo, verify `.git/config` has no token
- V4: Verify `cleanupPlan("../../../tmp")` throws
- V5: Create symlink in workspace `link → /etc/`, attempt `readFile("link/passwd")` — expect error
- V6: Submit plan with `repoUrl: "http://localhost:27017"` — expect rejection
- V7: Run skill script, check logs for any secret patterns

## Rollback

Each fix is independent — revert individual commits if needed. No database migrations. No breaking changes to APIs.

## Estimated Total: 2 hours (Steps 1-7)
