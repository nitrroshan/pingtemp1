#!/usr/bin/env npx tsx
/**
 * Collaboration E2E Test
 *
 * Tests the complete collaboration lifecycle WITHOUT any LLM or server dependency:
 *   1. In-memory ICollabProvider (pure Y.js docs, no Hocuspocus)
 *   2. discuss post → cursor tracking → discuss read
 *   3. onMentionedRoles callback fires on mention
 *   4. waitForResponse → simulated responder → response received
 *   5. Guard rails: token limit, round limit, timeout
 *   6. decide operation
 *   7. Two-agent discussion cycle
 *
 * Run: npx tsx packages/collaboration/src/__tests__/collab-e2e.test.ts
 */

import * as Y from "yjs";
import { CollaborationSpace } from "../L2/collaboration/CollaborationSpace.js";
import { createCollabTool, type CollabToolCallbacks } from "../L2/tools/index.js";
import type { ICollabProvider } from "../L2/collaboration/types/collab-provider.types.js";
import type { IL2CollaborationPlugin } from "../types/plugins.js";

// ════════════════════════════════════════════════════════════════════════════
// Test Infrastructure
// ════════════════════════════════════════════════════════════════════════════

interface TestResult { name: string; passed: boolean; error?: string; durationMs: number }
const results: TestResult[] = [];

const colors = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", bright: "\x1b[1m",
};
function c(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertIncludes(str: string, substr: string, label: string): void {
  if (!str.includes(substr)) throw new Error(`${label}: expected "${str}" to include "${substr}"`);
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
    results.push({ name, passed: false, error: error.message, durationMs: duration });
    console.log(`  ${c("red", "✗")} ${name}`);
    console.log(`    ${c("red", error.message)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// In-memory ICollabProvider (no Hocuspocus needed)
// ════════════════════════════════════════════════════════════════════════════

class InMemoryCollabProvider implements ICollabProvider {
  private docs = new Map<string, Y.Doc>();

  async openDoc(docName: string): Promise<Y.Doc> {
    if (!this.docs.has(docName)) {
      this.docs.set(docName, new Y.Doc());
    }
    return this.docs.get(docName)!;
  }

  async getDocNames(): Promise<string[]> {
    return Array.from(this.docs.keys());
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Mock L2 Plugin (minimal — only fields used by collab tool)
// ════════════════════════════════════════════════════════════════════════════

function createMockL2(): IL2CollaborationPlugin {
  return {
    layerId: "L2" as const,
    name: "Mock L2",
    isReady: true,
    isCollabAvailable: true,
    planStore: {
      listAllPlans: async () => [],
      loadPlan: async () => null,
    },
    async getOutputManifest() { return null; },
    async getAllManifests() { return []; },
    async queryOutputs() { return []; },
    getOrCreateSpace() { return null as any; },
    async archiveSpace() {},
    getGroupChatManager() { return null as any; },
    createTools() { return []; },
    async initialize() {},
    async dispose() {},
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Helper: invoke tool (extracts the underlying function)
// ════════════════════════════════════════════════════════════════════════════

async function invokeTool(
  tool: any,
  input: Record<string, any>,
): Promise<string> {
  return tool.invoke(input) as Promise<string>;
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 1: Discuss Post & Read (cursor-based)
// ════════════════════════════════════════════════════════════════════════════

async function testDiscussPostAndRead(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-1", "test", "goal-1", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-1");

  // Post a message
  const postResult = await invokeTool(tool, {
    action: "discuss",
    docName: "task-1/discussion",
    key: "post",
    value: { content: "I need help with the API design", type: "message" },
  });

  assertIncludes(postResult, "Posted discussion block", "post confirms success");
  assertIncludes(postResult, "Round 1/10", "post shows round count");

  // Read from a different agent — should see the post
  const tool2 = createCollabTool(space, "frontend", l2, "/tmp/repo", "task-1");
  const readResult = await invokeTool(tool2, {
    action: "discuss",
    docName: "task-1/discussion",
    key: "read",
  });

  assertIncludes(readResult, "1 new block", "frontend sees 1 new block");
  assertIncludes(readResult, "backend", "block shows backend role");
  assertIncludes(readResult, "API design", "block contains the content");

  // Read again — should have no new blocks (cursor was advanced)
  const readAgain = await invokeTool(tool2, {
    action: "discuss",
    docName: "task-1/discussion",
    key: "read",
  });

  assertIncludes(readAgain, "No new discussion blocks", "second read shows nothing new");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 2: onMentionedRoles callback
// ════════════════════════════════════════════════════════════════════════════

async function testOnMentionedRoles(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-2", "test", "goal-2", provider);
  const l2 = createMockL2();

  let callbackFired = false;
  let capturedRoles: string[] = [];
  let capturedTaskId = "";
  let capturedDocName = "";

  const callbacks: CollabToolCallbacks = {
    onMentionedRoles: (roles, taskId, docName) => {
      callbackFired = true;
      capturedRoles = roles;
      capturedTaskId = taskId;
      capturedDocName = docName;
    },
  };

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-2", callbacks);

  // Post with mentions
  await invokeTool(tool, {
    action: "discuss",
    docName: "task-2/discussion",
    key: "post",
    value: {
      content: "Hey frontend, can you review the component structure?",
      mentions: ["frontend", "designer"],
    },
  });

  assert(callbackFired, "onMentionedRoles callback was fired");
  assertEqual(capturedRoles.length, 2, "two roles mentioned");
  assertEqual(capturedRoles[0], "frontend", "first mentioned role");
  assertEqual(capturedRoles[1], "designer", "second mentioned role");
  assertEqual(capturedTaskId, "task-2", "task ID passed to callback");
  assertEqual(capturedDocName, "task-2/discussion", "doc name passed to callback");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 3: No callback fires without mentions
// ════════════════════════════════════════════════════════════════════════════

async function testNoCallbackWithoutMentions(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-3", "test", "goal-3", provider);
  const l2 = createMockL2();

  let callbackFired = false;
  const callbacks: CollabToolCallbacks = {
    onMentionedRoles: () => { callbackFired = true; },
  };

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-3", callbacks);

  // Post WITHOUT mentions
  await invokeTool(tool, {
    action: "discuss",
    docName: "task-3/discussion",
    key: "post",
    value: { content: "Just thinking out loud here..." },
  });

  assert(!callbackFired, "callback should NOT fire when no mentions");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 4: waitForResponse with simulated responder
// ════════════════════════════════════════════════════════════════════════════

async function testWaitForResponse(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-4", "test", "goal-4", provider);
  const l2 = createMockL2();

  // When onMentionedRoles fires, simulate a response after a short delay
  const callbacks: CollabToolCallbacks = {
    onMentionedRoles: async (roles, _taskId, docName) => {
      // Simulate the mentioned role responding after 1 second
      setTimeout(async () => {
        const responderTool = createCollabTool(space, roles[0], l2, "/tmp/repo", "task-4");
        await invokeTool(responderTool, {
          action: "discuss",
          docName,
          key: "post",
          value: {
            content: "Sure, I suggest we use a REST API with versioned endpoints.",
            type: "message",
          },
        });
      }, 500);
    },
  };

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-4", callbacks);

  // Post with waitForResponse = true
  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-4/discussion",
    key: "post",
    value: {
      content: "Frontend, what API pattern should we use?",
      mentions: ["frontend"],
      waitForResponse: true,
    },
  });

  // Should get the response (not timeout)
  assertIncludes(result, "Response from frontend", "got response from frontend");
  assertIncludes(result, "REST API", "response contains expected content");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 5: Guard Rails — Token limit
// ════════════════════════════════════════════════════════════════════════════

async function testGuardRailTokenLimit(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-5", "test", "goal-5", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-5");

  // Pre-initialize with a very low token limit
  const doc = await space.openDoc("task-5/discussion");
  const configMap = doc.getMap("config");
  configMap.set("maxRounds", 100);
  configMap.set("maxTokens", 10); // Very low — will trigger on first real post
  configMap.set("totalTokensUsed", 10); // Already at limit
  configMap.set("roundsPerAgent", {});
  configMap.set("timeoutMinutes", 60);
  configMap.set("status", "active");
  configMap.set("lastActivity", new Date().toISOString());

  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-5/discussion",
    key: "post",
    value: { content: "This should be rejected" },
  });

  assertIncludes(result, "Token limit reached", "rejected due to token limit");
  assertIncludes(result, "closed", "status set to closed");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 6: Guard Rails — Round limit per agent
// ════════════════════════════════════════════════════════════════════════════

async function testGuardRailRoundLimit(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-6", "test", "goal-6", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-6");

  // Pre-initialize with rounds at limit for backend
  const doc = await space.openDoc("task-6/discussion");
  const configMap = doc.getMap("config");
  configMap.set("maxRounds", 3);
  configMap.set("maxTokens", 999999);
  configMap.set("totalTokensUsed", 0);
  configMap.set("roundsPerAgent", { backend: 3 }); // Already at limit
  configMap.set("timeoutMinutes", 60);
  configMap.set("status", "active");
  configMap.set("lastActivity", new Date().toISOString());

  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-6/discussion",
    key: "post",
    value: { content: "One more message" },
  });

  assertIncludes(result, "round limit", "rejected due to round limit");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 7: Guard Rails — Timeout enforcement
// ════════════════════════════════════════════════════════════════════════════

async function testGuardRailTimeout(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-7", "test", "goal-7", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-7");

  // Pre-initialize with lastActivity way in the past
  const doc = await space.openDoc("task-7/discussion");
  const configMap = doc.getMap("config");
  configMap.set("maxRounds", 10);
  configMap.set("maxTokens", 999999);
  configMap.set("totalTokensUsed", 0);
  configMap.set("roundsPerAgent", {});
  configMap.set("timeoutMinutes", 1); // 1 minute timeout
  configMap.set("status", "active");
  configMap.set("lastActivity", new Date(Date.now() - 120_000).toISOString()); // 2 minutes ago

  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-7/discussion",
    key: "post",
    value: { content: "Too late" },
  });

  assertIncludes(result, "timed out", "rejected due to timeout");
  assertIncludes(result, "escalated", "status set to escalated");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 8: Guard Rails — Closed discussion
// ════════════════════════════════════════════════════════════════════════════

async function testGuardRailClosedDiscussion(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-8", "test", "goal-8", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-8");

  // Pre-initialize as closed
  const doc = await space.openDoc("task-8/discussion");
  const configMap = doc.getMap("config");
  configMap.set("maxRounds", 10);
  configMap.set("maxTokens", 999999);
  configMap.set("totalTokensUsed", 0);
  configMap.set("roundsPerAgent", {});
  configMap.set("timeoutMinutes", 60);
  configMap.set("status", "closed");
  configMap.set("lastActivity", new Date().toISOString());

  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-8/discussion",
    key: "post",
    value: { content: "Can I still post?" },
  });

  assertIncludes(result, "closed", "rejected because discussion is closed");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 9: Decide operation
// ════════════════════════════════════════════════════════════════════════════

async function testDecideOperation(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-9", "test", "goal-9", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-9");

  // Initialize discussion first (auto-init happens on first action)
  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-9/discussion",
    key: "decide",
    value: {
      key: "api-pattern",
      decision: "Use REST with /api/v2 prefix",
      agreedBy: ["backend", "frontend"],
    },
  });

  assertIncludes(result, "Decision recorded", "decision was recorded");

  // Verify the decision is in the CRDT
  const doc = await space.openDoc("task-9/discussion");
  const decisions = doc.getMap("decisions");
  const decision = decisions.get("api-pattern") as any;
  assert(decision !== undefined, "decision exists in CRDT");
  assertEqual(decision.decision, "Use REST with /api/v2 prefix", "decision content");
  assertEqual(decision.decidedBy, "backend", "decided by backend");
  assertEqual(decision.agreedBy.length, 2, "agreed by 2 roles");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 10: Two-agent discussion cycle (full E2E)
// ════════════════════════════════════════════════════════════════════════════

async function testTwoAgentDiscussionCycle(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-10", "test", "goal-10", provider);
  const l2 = createMockL2();

  const mentionLog: Array<{ roles: string[]; taskId: string; docName: string }> = [];
  const callbacks: CollabToolCallbacks = {
    onMentionedRoles: (roles, taskId, docName) => {
      mentionLog.push({ roles, taskId, docName });
    },
  };

  const backendTool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-10", callbacks);
  const frontendTool = createCollabTool(space, "frontend", l2, "/tmp/repo", "task-10", callbacks);

  // Step 1: Backend posts and mentions frontend
  await invokeTool(backendTool, {
    action: "discuss",
    docName: "task-10/discussion",
    key: "post",
    value: { content: "What component framework should we use?", mentions: ["frontend"] },
  });

  assertEqual(mentionLog.length, 1, "1 mention callback fired");

  // Step 2: Frontend reads the message
  const readResult = await invokeTool(frontendTool, {
    action: "discuss",
    docName: "task-10/discussion",
    key: "read",
  });

  assertIncludes(readResult, "component framework", "frontend reads backend's message");

  // Step 3: Frontend responds and mentions backend
  await invokeTool(frontendTool, {
    action: "discuss",
    docName: "task-10/discussion",
    key: "post",
    value: { content: "I recommend React 19 with server components", mentions: ["backend"] },
  });

  assertEqual(mentionLog.length, 2, "2 mention callbacks fired total");

  // Step 4: Backend reads the response
  const backendRead = await invokeTool(backendTool, {
    action: "discuss",
    docName: "task-10/discussion",
    key: "read",
  });

  assertIncludes(backendRead, "React 19", "backend reads frontend's response");
  assertIncludes(backendRead, "frontend", "block attributed to frontend role");

  // Step 5: Record a decision
  await invokeTool(backendTool, {
    action: "discuss",
    docName: "task-10/discussion",
    key: "decide",
    value: {
      key: "framework",
      decision: "React 19 with server components",
      agreedBy: ["backend", "frontend"],
    },
  });

  // Step 6: Verify CRDT state
  const doc = await space.openDoc("task-10/discussion");
  const discussion = doc.getArray("discussion");
  assertEqual(discussion.length, 2, "2 discussion blocks in Y.Array");

  const decisions = doc.getMap("decisions");
  const fw = decisions.get("framework") as any;
  assertEqual(fw.decision, "React 19 with server components", "decision recorded correctly");

  const config = doc.getMap("config");
  const rounds = config.get("roundsPerAgent") as any;
  assertEqual(rounds.backend, 1, "backend posted 1 round");
  assertEqual(rounds.frontend, 1, "frontend posted 1 round");

  const tokens = config.get("totalTokensUsed") as number;
  assert(tokens > 0, "token counter incremented");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 11: Discussion auto-initialization
// ════════════════════════════════════════════════════════════════════════════

async function testAutoInitialization(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-11", "test", "goal-11", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-11");

  // Read on an un-initialized discussion — should auto-init and return empty
  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "task-11/discussion",
    key: "read",
  });

  assertIncludes(result, "No new discussion blocks", "empty discussion returns no blocks");

  // Verify config was auto-initialized
  const doc = await space.openDoc("task-11/discussion");
  const config = doc.getMap("config");
  assertEqual(config.get("status"), "active", "auto-initialized status");
  assertEqual(config.get("maxRounds"), 10, "auto-initialized maxRounds");
  assertEqual(config.get("maxTokens"), 50000, "auto-initialized maxTokens");
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite 12: Invalid docName rejected
// ════════════════════════════════════════════════════════════════════════════

async function testInvalidDocNameRejected(): Promise<void> {
  const provider = new InMemoryCollabProvider();
  const space = new CollaborationSpace("test/goal-12", "test", "goal-12", provider);
  const l2 = createMockL2();

  const tool = createCollabTool(space, "backend", l2, "/tmp/repo", "task-12");

  const result = await invokeTool(tool, {
    action: "discuss",
    docName: "random-doc",
    key: "post",
    value: { content: "This should fail" },
  });

  assertIncludes(result, "discuss action requires a discussion doc", "non-discussion doc rejected");
}

// ════════════════════════════════════════════════════════════════════════════
// Runner
// ════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`\n${c("bright", "Collaboration E2E Tests")}\n`);
  console.log(c("cyan", "Suite 1: Discuss Post & Read"));
  await runTest("post creates block and read retrieves it", testDiscussPostAndRead);

  console.log(c("cyan", "\nSuite 2: Mention Routing"));
  await runTest("onMentionedRoles fires on mention", testOnMentionedRoles);
  await runTest("no callback without mentions", testNoCallbackWithoutMentions);

  console.log(c("cyan", "\nSuite 3: waitForResponse"));
  await runTest("waitForResponse receives simulated response", testWaitForResponse);

  console.log(c("cyan", "\nSuite 4: Guard Rails"));
  await runTest("token limit enforced", testGuardRailTokenLimit);
  await runTest("round limit enforced", testGuardRailRoundLimit);
  await runTest("timeout enforced", testGuardRailTimeout);
  await runTest("closed discussion rejects posts", testGuardRailClosedDiscussion);

  console.log(c("cyan", "\nSuite 5: Decide"));
  await runTest("decision recorded in CRDT", testDecideOperation);

  console.log(c("cyan", "\nSuite 6: Full Cycle"));
  await runTest("two-agent discussion with decision", testTwoAgentDiscussionCycle);

  console.log(c("cyan", "\nSuite 7: Edge Cases"));
  await runTest("auto-initialization of discussion", testAutoInitialization);
  await runTest("invalid docName rejected", testInvalidDocNameRejected);

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `  ${c("green", `${passed} passed`)}  ${failed ? c("red", `${failed} failed`) : ""}  ${c("dim", `(${totalMs}ms)`)}`,
  );

  if (failed > 0) {
    console.log(`\n  ${c("red", "Failed tests:")}`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`    ${c("red", "✗")} ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log(`\n  ${c("green", "All tests passed!")}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
