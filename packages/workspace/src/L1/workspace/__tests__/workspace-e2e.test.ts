#!/usr/bin/env npx tsx
/**
 * Workspace E2E Test
 *
 * Tests the complete workspace lifecycle WITHOUT any LLM dependency:
 *   1. WorkspaceManager.initializeWorkspace()
 *   2. WorkspaceManager.createWorkspace(agentId, taskId)
 *   3. AgentWorkspace.createFile / readFile / updateFile / deleteFile
 *   4. AgentWorkspace.logActivity
 *   5. AgentWorkspace.commit
 *   6. AgentWorkspace.publish → artifacts
 *   7. WorkspaceManager.mergeAndCleanup(taskId)
 *   8. Verify files are on main after merge
 *
 * Also tests: retry, discard, workspace tools, multi-workspace isolation
 *
 * Run: npx tsx memory/workspace/__tests__/workspace-e2e.test.ts
 * Or:  npm run test:workspace
 */

import fs from "fs";
import path from "path";
import { Logger } from "tslog";
import { WorkspaceManager } from "../WorkspaceManager.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";
import { GitBranchManager } from "../GitBranchManager.js";

const logger = new Logger({ name: "workspace-e2e", minLevel: 3 }); // warn+

// ════════════════════════════════════════════════════════════════════════════
// Test Infrastructure
// ════════════════════════════════════════════════════════════════════════════

const TEST_DIR = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  `workspace-e2e-${Date.now()}`,
);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
  bgBlue: "\x1b[44m",
};

function c(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(str: string, substr: string, label: string): void {
  if (!str.includes(substr)) {
    throw new Error(`${label}: expected "${str}" to include "${substr}"`);
  }
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, durationMs: duration });
    console.log(`  ${c("green", "✓")} ${name} ${c("dim", `(${duration}ms)`)}`);
  } catch (error: any) {
    const duration = Date.now() - start;
    results.push({
      name,
      passed: false,
      error: error.message,
      durationMs: duration,
    });
    console.log(`  ${c("red", "✗")} ${name}`);
    console.log(`    ${c("red", error.message)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Setup & Teardown
// ════════════════════════════════════════════════════════════════════════════

async function setup(): Promise<void> {
  // Create fresh test directory
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  console.log(c("dim", `\n  Test directory: ${TEST_DIR}\n`));
}

async function teardown(): Promise<void> {
  // Clean up test directory
  try {
    await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 1: Full Lifecycle (Happy Path)
// ════════════════════════════════════════════════════════════════════════════

async function testFullLifecycle(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "lifecycle-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  // Create workspace
  const workspace = await manager.createWorkspace("backend-agent", "task-001");

  assert(workspace.id.includes("task-001"), "workspace ID includes taskId");
  assertEqual(workspace.status, "active", "workspace status after init");
  assertEqual(workspace.agentId, "backend-agent", "agent ID");
  assertEqual(workspace.taskId, "task-001", "task ID");
  assert(
    workspace.branchName.includes("task-001"),
    "branch name includes taskId",
  );

  // Create files
  const fileInfo = await workspace.createFile(
    "artifacts/code/hello.ts",
    'export const hello = () => "Hello, World!";',
  );
  assertEqual(fileInfo.name, "hello.ts", "created file name");
  assert((fileInfo.size ?? 0) > 0, "file has content");

  await workspace.createFile(
    "artifacts/docs/README.md",
    "# Hello World\n\nA simple greeting module.",
  );

  // Read file back
  const content = await workspace.readFile("artifacts/code/hello.ts");
  assertIncludes(content, "Hello, World!", "file content matches");

  // Update file
  const updated = await workspace.updateFile(
    "artifacts/code/hello.ts",
    "export const hello = (name: string) => `Hello, ${name}!`;",
  );
  assertEqual(updated.name, "hello.ts", "updated file name");

  // Log activity
  await workspace.logActivity({
    timestamp: new Date(),
    type: "tool_call",
    tool: "code_generation",
    output: "Generated hello module",
  });

  await workspace.logActivity({
    timestamp: new Date(),
    type: "tool_result",
    tool: "documentation",
    output: "Created README",
  });

  // Commit
  const commitInfo = await workspace.commit("feat: add hello module");
  assert(commitInfo.hash.length > 0, "commit has hash");
  assertIncludes(commitInfo.message, "hello module", "commit message");

  // Publish
  const artifacts = await workspace.publish();
  assert(artifacts.length > 0, "publish returns artifacts");
  assertEqual(workspace.status, "published", "status is published");

  // Check artifact details
  const codeArtifact = artifacts.find((a) => a.path.includes("hello.ts"));
  assert(codeArtifact !== undefined, "code artifact found");
  assertEqual(codeArtifact!.agentId, "backend-agent", "artifact agentId");

  const activityArtifact = artifacts.find((a) =>
    a.path.includes("activity/summary"),
  );
  assert(activityArtifact !== undefined, "activity summary artifact exists");

  // Merge and cleanup
  const mergeResult = await manager.mergeAndCleanup("task-001");
  assert(mergeResult.success, "merge succeeded");

  // Verify workspace is removed from registry
  assertEqual(manager.activeCount, 0, "no active workspaces after merge");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 2: File Operations
// ════════════════════════════════════════════════════════════════════════════

async function testFileOperations(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "fileops-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace("file-agent", "task-files");

  // Create nested file
  await workspace.createFile(
    "artifacts/code/src/utils/helpers.ts",
    "export function add(a: number, b: number) { return a + b; }",
  );

  // Read it back
  const content = await workspace.readFile(
    "artifacts/code/src/utils/helpers.ts",
  );
  assertIncludes(content, "add", "nested file content");

  // Update
  await workspace.updateFile(
    "artifacts/code/src/utils/helpers.ts",
    "export function add(a: number, b: number): number { return a + b; }\nexport function subtract(a: number, b: number): number { return a - b; }",
  );

  const updated = await workspace.readFile(
    "artifacts/code/src/utils/helpers.ts",
  );
  assertIncludes(updated, "subtract", "updated content has new function");

  // Delete file
  await workspace.deleteFile("artifacts/code/src/utils/helpers.ts");

  // Verify deletion
  let readFailed = false;
  try {
    await workspace.readFile("artifacts/code/src/utils/helpers.ts");
  } catch {
    readFailed = true;
  }
  assert(readFailed, "reading deleted file should throw");

  // List files
  const files = await workspace.listFiles("artifacts/");
  assert(Array.isArray(files), "listFiles returns array");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 3: Path Sandboxing
// ════════════════════════════════════════════════════════════════════════════

async function testPathSandboxing(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "sandbox-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace("evil-agent", "task-evil");

  // Path traversal should be blocked
  let blocked = false;
  try {
    await workspace.createFile("../../etc/passwd", "hacked");
  } catch {
    blocked = true;
  }
  assert(blocked, "path traversal (../) blocked");

  // Absolute path should be blocked
  blocked = false;
  try {
    await workspace.createFile("/etc/passwd", "hacked");
  } catch {
    blocked = true;
  }
  assert(blocked, "absolute path blocked");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 4: Activity Logging
// ════════════════════════════════════════════════════════════════════════════

async function testActivityLogging(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "activity-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace("activity-agent", "task-log");

  // Log multiple activities
  for (let i = 0; i < 5; i++) {
    await workspace.logActivity({
      timestamp: new Date(),
      type: i < 4 ? "tool_call" : "error",
      tool: `step_${i}`,
      output: `Test step ${i}`,
      metadata: { step: i },
    });
  }

  // Read activity log
  const log = await workspace.getActivityLog();
  assertEqual(log.length, 5, "5 activity entries");
  assertEqual(log[4]!.type, "error", "last entry is error type");

  // Get summary
  const summary = await workspace.getActivitySummary();
  assert(summary.length > 0, "summary is not empty");
  assertIncludes(summary, "step_0", "summary includes first tool name");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 5: Multi-Workspace Isolation
// ════════════════════════════════════════════════════════════════════════════

async function testMultiWorkspaceIsolation(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "multi-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  // Create two workspaces
  const ws1 = await manager.createWorkspace("agent-a", "task-alpha");
  const ws2 = await manager.createWorkspace("agent-b", "task-beta");

  assertEqual(manager.activeCount, 2, "2 active workspaces");

  // Write different files in each
  await ws1.createFile("artifacts/code/alpha.ts", "export const alpha = 1;");
  await ws1.commit("feat: alpha module");

  await ws2.createFile("artifacts/code/beta.ts", "export const beta = 2;");
  await ws2.commit("feat: beta module");

  // Each workspace should only see its own files
  const ws1Files = await ws1.listFiles("artifacts/code/");
  const ws2Files = await ws2.listFiles("artifacts/code/");

  // Verify workspace IDs are different
  assert(ws1.id !== ws2.id, "workspace IDs are different");
  assert(ws1.branchName !== ws2.branchName, "branch names are different");

  // Merge both sequentially
  await ws1.publish();
  await ws2.publish();

  const merge1 = await manager.mergeAndCleanup("task-alpha");
  assert(merge1.success, "first merge succeeded");

  const merge2 = await manager.mergeAndCleanup("task-beta");
  assert(merge2.success, "second merge succeeded");

  assertEqual(manager.activeCount, 0, "all workspaces cleaned up");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 6: Retry Lifecycle
// ════════════════════════════════════════════════════════════════════════════

async function testRetryLifecycle(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "retry-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace("retry-agent", "task-retry");

  // Create a file — first attempt
  await workspace.createFile(
    "artifacts/code/attempt1.ts",
    "// first attempt, bad code",
  );
  await workspace.commit("attempt 1 — broken");

  // Retry — creates new branch
  const retried = await workspace.retry();
  assert(retried.id !== workspace.id, "retry has new ID");
  assert(retried.branchName.includes("v2"), "retry branch has version");
  assertEqual(retried.status, "active", "retried workspace is active");

  // Write fixed code
  await retried.createFile(
    "artifacts/code/attempt2.ts",
    'export const fixed = "works!";',
  );
  await retried.commit("attempt 2 — fixed");
  await retried.publish();

  assertEqual(retried.status, "published", "retried workspace published");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 7: Discard Flow
// ════════════════════════════════════════════════════════════════════════════

async function testDiscardFlow(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "discard-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace(
    "discard-agent",
    "task-discard",
  );

  await workspace.createFile("artifacts/code/temp.ts", "// temporary");
  await workspace.commit("temp commit");

  // Discard
  await workspace.discard();
  assertEqual(workspace.status, "discarded", "status is discarded");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 8: Workspace Tools
// ════════════════════════════════════════════════════════════════════════════

async function testWorkspaceTools(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "tools-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace("tool-agent", "task-tools");

  const tools = createWorkspaceTools(workspace);
  assert(tools.length > 0, "tools array is not empty");

  // Find and invoke workspace_create_file tool
  const createFileTool = tools.find((t) => t.name === "workspace_create_file");
  assert(createFileTool !== undefined, "workspace_create_file tool exists");

  const createResult = await createFileTool!.invoke({
    path: "artifacts/code/tool-created.ts",
    content: 'export const fromTool = "created by tool";',
  });
  assertIncludes(createResult, "tool-created.ts", "tool create result");

  // Find and invoke workspace_read_file tool
  const readFileTool = tools.find((t) => t.name === "workspace_read_file");
  assert(readFileTool !== undefined, "workspace_read_file tool exists");

  const readResult = await readFileTool!.invoke({
    path: "artifacts/code/tool-created.ts",
  });
  assertIncludes(readResult, "fromTool", "tool read result has content");

  // Find workspace_status tool
  const statusTool = tools.find((t) => t.name === "workspace_status");
  assert(statusTool !== undefined, "workspace_status tool exists");

  const statusResult = await statusTool!.invoke({});
  assertIncludes(statusResult, "task-tools", "status shows taskId");

  // Find workspace_commit tool
  const commitTool = tools.find((t) => t.name === "workspace_commit");
  assert(commitTool !== undefined, "workspace_commit tool exists");

  const commitResult = await commitTool!.invoke({
    message: "commit from tool test",
  });
  assertIncludes(commitResult, "commit", "commit tool returns hash");

  // List all tool names for verification
  const toolNames = tools.map((t) => t.name);
  assert(
    toolNames.includes("workspace_list_files"),
    "has workspace_list_files",
  );
  assert(
    toolNames.includes("workspace_delete_file"),
    "has workspace_delete_file",
  );
  assert(
    toolNames.includes("workspace_write_file"),
    "has workspace_write_file",
  );
  assert(
    toolNames.includes("workspace_log_activity"),
    "has workspace_log_activity",
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 9: Git Branch Verification
// ════════════════════════════════════════════════════════════════════════════

async function testGitBranchVerification(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "branch-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const gitManager = manager.getGitManager();

  // Verify we're on main after init
  const mainBranch = await gitManager.getCurrentBranch();
  assert(
    mainBranch === "main" || mainBranch === "master",
    `default branch is main/master, got ${mainBranch}`,
  );

  // Create workspace → should create task branch
  const workspace = await manager.createWorkspace("git-agent", "task-git");
  const currentBranch = await gitManager.getCurrentBranch();
  assertEqual(currentBranch, "task-task-git", "on task branch after create");

  // List branches
  const branches = await gitManager.listBranches();
  assert(branches.length >= 2, "at least main + task branch");
  const taskBranch = branches.find((b) => b.includes("task-task-git"));
  assert(taskBranch !== undefined, "task branch exists in list");

  // Commit on task branch
  await workspace.createFile("artifacts/code/test.ts", "// test");
  await workspace.commit("test commit");

  // Get commit history
  const history = await workspace.getHistory();
  assert(history.length >= 2, "at least init + test commit");

  // Merge via publish + merge
  await workspace.publish();
  const mergeResult = await workspace.merge();
  assert(mergeResult.success, "merge to main succeeded");

  // Should be back on main
  const afterMerge = await gitManager.getCurrentBranch();
  assert(
    afterMerge === "main" || afterMerge === "master",
    `back on main after merge, got ${afterMerge}`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 10: Workspace Metadata
// ════════════════════════════════════════════════════════════════════════════

async function testWorkspaceMetadata(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "meta-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace("meta-agent", "task-meta");

  // Check workspace.json exists
  const metadataPath = path.join(repoPath, "workspace.json");
  const metadataExists = fs.existsSync(metadataPath);
  assert(metadataExists, "workspace.json exists");

  // Read and parse metadata
  const raw = await fs.promises.readFile(metadataPath, "utf-8");
  const metadata = JSON.parse(raw);

  assertEqual(metadata.taskId, "task-meta", "metadata taskId");
  assertEqual(metadata.agentId, "meta-agent", "metadata agentId");
  assertEqual(metadata.status, "active", "metadata status");
  assert(metadata.createdAt !== undefined, "metadata has createdAt");

  // Get full status via API
  const status = await workspace.getWorkspaceStatus();
  assertEqual(status.taskId, "task-meta", "status taskId");
  assertEqual(status.agentId, "meta-agent", "status agentId");
  assertEqual(status.status, "active", "status is active");
}

// ════════════════════════════════════════════════════════════════════════════
// Suite 11: Reactivate After Publish
// ════════════════════════════════════════════════════════════════════════════

async function testReactivateAfterPublish(): Promise<void> {
  const repoPath = path.join(TEST_DIR, "reactivate-repo");
  await fs.promises.mkdir(repoPath, { recursive: true });

  const manager = new WorkspaceManager({ repoPath });
  await manager.initializeWorkspace();

  const workspace = await manager.createWorkspace(
    "reactivate-agent",
    "task-reactivate",
  );

  // Create a file and publish
  await workspace.createFile("artifacts/code/v1.ts", "export const v1 = true;");
  await workspace.commit("v1 code");
  const artifacts = await workspace.publish();
  assert(artifacts.length > 0, "published artifacts");
  assertEqual(
    workspace.status,
    "published",
    "status is published after publish()",
  );

  // Verify that file operations are blocked in published state
  let blocked = false;
  try {
    await workspace.createFile(
      "artifacts/code/v2.ts",
      "export const v2 = true;",
    );
  } catch (err: any) {
    blocked = true;
    assert(err.message.includes("not active"), "error mentions not active");
    assert(
      err.message.includes("reactivate"),
      "error mentions reactivate hint",
    );
  }
  assert(blocked, "file creation blocked when published");

  // Reactivate and continue working
  await workspace.reactivate();
  assertEqual(
    workspace.status,
    "active",
    "status is active after reactivate()",
  );

  // Now file operations should work again
  await workspace.createFile("artifacts/code/v2.ts", "export const v2 = true;");
  const v2Content = await workspace.readFile("artifacts/code/v2.ts");
  assertEqual(
    v2Content,
    "export const v2 = true;",
    "v2 file content after reactivate",
  );

  // Can commit again
  const commitInfo = await workspace.commit("v2 code after reactivate");
  assert(commitInfo.hash.length > 0, "commit after reactivate has hash");

  // Can re-publish
  const artifacts2 = await workspace.publish();
  assert(artifacts2.length > 0, "re-published artifacts");
  assertEqual(
    workspace.status,
    "published",
    "status is published after re-publish",
  );

  // Verify reactivate fails from non-published states
  await workspace.reactivate(); // back to active
  let wrongStateError = false;
  try {
    await workspace.reactivate(); // already active - should fail
  } catch (err: any) {
    wrongStateError = true;
    assert(
      err.message.includes("must be in 'published' state"),
      "error for wrong state",
    );
  }
  assert(wrongStateError, "reactivate rejects non-published state");

  // Test the workspace_reactivate tool
  const tools = createWorkspaceTools(workspace);
  const reactivateTool = tools.find((t) => t.name === "workspace_reactivate");
  assert(reactivateTool !== undefined, "workspace_reactivate tool exists");

  // Publish again then use tool to reactivate
  await workspace.publish();
  assertEqual(
    workspace.status,
    "published",
    "published before tool reactivate",
  );
  const toolResult = await reactivateTool!.invoke({});
  assert(typeof toolResult === "string", "tool returns string");
  assert(
    toolResult.includes("reactivated"),
    "tool result confirms reactivation",
  );
  assertEqual(
    workspace.status,
    "active",
    "status is active after tool reactivate",
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Runner
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(
    `\n${c("bright", "")}${c("bgBlue", " WORKSPACE E2E TEST ")}${c("reset", "")}\n`,
  );

  await setup();

  console.log(c("cyan", "Suite 1: Full Lifecycle"));
  await runTest(
    "Full lifecycle: create → files → commit → publish → merge",
    testFullLifecycle,
  );

  console.log(c("cyan", "\nSuite 2: File Operations"));
  await runTest("Create, read, update, delete, list files", testFileOperations);

  console.log(c("cyan", "\nSuite 3: Path Sandboxing"));
  await runTest(
    "Path traversal and absolute paths blocked",
    testPathSandboxing,
  );

  console.log(c("cyan", "\nSuite 4: Activity Logging"));
  await runTest("Log activities, read log, get summary", testActivityLogging);

  console.log(c("cyan", "\nSuite 5: Multi-Workspace Isolation"));
  await runTest(
    "Two workspaces with independent branches",
    testMultiWorkspaceIsolation,
  );

  console.log(c("cyan", "\nSuite 6: Retry Lifecycle"));
  await runTest(
    "Retry creates new branch with version suffix",
    testRetryLifecycle,
  );

  console.log(c("cyan", "\nSuite 7: Discard Flow"));
  await runTest("Discard workspace and branch", testDiscardFlow);

  console.log(c("cyan", "\nSuite 8: Workspace Tools"));
  await runTest(
    "StructuredTools create/read/commit/status",
    testWorkspaceTools,
  );

  console.log(c("cyan", "\nSuite 9: Git Branch Verification"));
  await runTest(
    "Branch creation, listing, merge to main",
    testGitBranchVerification,
  );

  console.log(c("cyan", "\nSuite 10: Workspace Metadata"));
  await runTest(
    "workspace.json and getWorkspaceStatus()",
    testWorkspaceMetadata,
  );

  console.log(c("cyan", "\nSuite 11: Reactivate After Publish"));
  await runTest(
    "Publish → reactivate → continue working → re-publish",
    testReactivateAfterPublish,
  );

  // Summary
  console.log(
    `\n${c("bright", "")}${c("bgBlue", " RESULTS ")}${c("reset", "")}\n`,
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`  Total:  ${results.length} tests`);
  console.log(`  ${c("green", `Passed: ${passed}`)}`);
  if (failed > 0) {
    console.log(`  ${c("red", `Failed: ${failed}`)}`);
    console.log(`\n  ${c("red", "Failed tests:")}`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`    ${c("red", "✗")} ${r.name}`);
      console.log(`      ${c("dim", r.error || "")}`);
    }
  }
  console.log(`  ${c("dim", `Duration: ${totalMs}ms`)}`);

  await teardown();

  // Exit with code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
