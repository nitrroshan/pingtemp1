/**
 * Integration test for Orchestrator
 * 
 * Tests the full flow: chat → plan → approve → tasks added
 * Uses mocked agents but real MemoryManager
 */

import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { OrchestratorService } from "../OrchestratorService.js";
import { MemoryManager } from "../../memory/MemoryManager.js";

// Mock AgentFactory - must define inline for hoisting
mock.module("../../agent/AgentFactory.js", () => {
  // Mock orchestrator agent responses
  const createMockOrchestrator = () => {
    let callCount = 0;
    return {
      id: "mock-orchestrator",
      name: "Orchestrator",
      type: "internal",
      role: "orchestrator",
      definition: {},
      tasks: { getAll: () => [], get: () => null, add: () => {}, update: () => {}, remove: () => {} },
      assignTask: () => {},
      getActiveTasks: () => [],
      completeTask: () => {},
      failTask: () => {},
      getStatus: () => "ready",
      getConversation: () => [],
      initialize: async () => {},
      waitUntilReady: async () => {},
      stop: async () => {},
      reset: async () => {},
      setTools: () => {},
      execute: async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "message", content: "What tech stack would you like for the blog?" };
          yield { type: "done", output: "What tech stack would you like for the blog?" };
        } else if (callCount === 2) {
          yield { type: "message", content: "I've created a plan for your Next.js blog." };
          yield { type: "done", output: "I've created a plan for your Next.js blog." };
        } else {
          yield { type: "message", content: "Okay, I understand." };
          yield { type: "done", output: "Okay, I understand." };
        }
      },
    };
  };

  // Mock plan builder responses
  const createMockPlanBuilder = () => ({
    id: "mock-plan-builder",
    name: "PlanBuilder",
    type: "internal",
    role: "plan-builder",
    definition: {},
    tasks: { getAll: () => [], get: () => null, add: () => {}, update: () => {}, remove: () => {} },
    assignTask: () => {},
    getActiveTasks: () => [],
    completeTask: () => {},
    failTask: () => {},
    getStatus: () => "ready",
    getConversation: () => [],
    initialize: async () => {},
    waitUntilReady: async () => {},
    stop: async () => {},
    reset: async () => {},
    execute: async function* () {
      yield { type: "done", output: {
        planId: "plan-integration-test",
        goal: "Build a blog with Next.js",
        tasks: [
          {
            id: "task-setup",
            title: "Project Setup",
            description: "Initialize Next.js project with TypeScript",
            assignedRole: "backend",
            priority: 1,
            complexity: "low",
            dependencies: [],
            expectedOutput: "package.json and project structure",
          },
        ],
        estimatedDuration: "3 hours",
        risks: ["API rate limits"],
      }};
    },
  });

  class MockAgentFactory {
    createById(id: string) {
      if (id === "plan-builder") {
        return createMockPlanBuilder();
      }
      if (id === "orchestrator") {
        return createMockOrchestrator();
      }
      throw new Error(`Unknown agent: ${id}`);
    }
  }

  return { AgentFactory: MockAgentFactory };
});

describe("OrchestratorService Integration", () => {
  let orchestrator: OrchestratorService;
  let memoryManager: MemoryManager;
  let capturedCallbacks: Record<string, any> = {};
  let mockWorkerPool: any;

  beforeEach(async () => {
    capturedCallbacks = {};
    memoryManager = new MemoryManager();

    // Create mock WorkerPool
    mockWorkerPool = {
      registerDefinitions: mock(),
      getDefinition: mock(),
      hasRole: mock(() => true),
      runTask: mock(async () => ({ success: true })),
      dispose: mock(),
      disposeAll: mock(async () => {}),
      setGoalContext: mock(),
      setCallbacks: mock(),
      get workerCount() {
        return 0;
      },
    };

    orchestrator = new OrchestratorService({
      teamId: "team-integration",
      teamRoles: ["backend", "frontend", "devops"],
      memoryManager,
      workerPool: mockWorkerPool,
      callbacks: {
        onPlanApproved: (data) => { capturedCallbacks["plan:approved"] = data; },
        onPlanProposed: (data) => { capturedCallbacks["plan:proposed"] = data; },
        onTaskUpdate: (data) => { capturedCallbacks["task:update"] = data; },
      },
    });

    await orchestrator.initialize();
  });

  afterEach(() => {
    orchestrator.reset();
  });

  describe("Conversation Flow", () => {
    it("should initialize in idle state", () => {
      expect(orchestrator.getState()).toBe("idle");
    });

    it("should transition to gathering on first message", async () => {
      await orchestrator.handleMessage("Build a blog");
      expect(orchestrator.getState()).toBe("gathering");
    });

    it("should handle multiple messages", async () => {
      const response1 = await orchestrator.handleMessage("Build a blog");
      expect(response1).toBeDefined();
      expect(typeof response1).toBe("string");

      const response2 = await orchestrator.handleMessage("Use Next.js");
      expect(response2).toBeDefined();
    });
  });

  describe("Plan Approval Flow", () => {
    it("should reject approval when no plan pending", async () => {
      const result = await orchestrator.approvePlan();
      expect(result.success).toBe(false);
      expect(result.error).toContain("No pending plan");
    });

    // Note: Full plan approval test requires the orchestrator to actually
    // call create_plan tool, which happens via LLM. For integration testing
    // with mocks, we test the OrchestratorService.approvePlan() directly
    // by manually setting a pending plan.
  });

  describe("Callback Invocation", () => {
    it("should invoke onPlanApproved when plan is approved", async () => {
      // Manually set pending plan (simulating create_plan tool call)
      (orchestrator as any).pendingPlan = {
        planId: "plan-test",
        goal: "Test goal",
        tasks: [{
          id: "t1",
          title: "Test task",
          description: "Do something",
          assignedRole: "backend",
          priority: 1,
          complexity: "low",
          dependencies: [],
          expectedOutput: "Done",
        }],
      };
      (orchestrator as any).state = "awaiting_approval";

      const result = await orchestrator.approvePlan();
      expect(result.success).toBe(true);
      expect(result.tasksQueued).toBe(1);

      const event = capturedCallbacks["plan:approved"] as any;
      expect(event).toBeDefined();
      expect(event.teamId).toBe("team-integration");
      expect(event.tasksQueued).toBe(1);
    });
  });

  describe("MemoryManager Integration", () => {
    it("should add tasks to MemoryManager on approval", async () => {
      // Setup pending plan
      (orchestrator as any).pendingPlan = {
        planId: "plan-memory-test",
        goal: "Test memory integration",
        tasks: [
          {
            id: "task-1",
            title: "First",
            description: "First task",
            assignedRole: "backend",
            priority: 1,
            complexity: "medium",
            dependencies: [],
            expectedOutput: "Output 1",
          },
          {
            id: "task-2",
            title: "Second",
            description: "Second task",
            assignedRole: "frontend",
            priority: 2,
            complexity: "low",
            dependencies: ["task-1"],
            expectedOutput: "Output 2",
          },
        ],
      };
      (orchestrator as any).state = "awaiting_approval";

      // Approve
      const result = await orchestrator.approvePlan();
      expect(result.success).toBe(true);
      expect(result.tasksQueued).toBe(2);

      // Verify tasks in MemoryManager
      // Note: getTasks() only returns READY tasks (tasks with no pending prerequisites)
      const backendTasks = memoryManager.getTasks("backend");

      expect(backendTasks.length).toBe(1);
      expect(backendTasks[0]!.id).toBe("task-1");
      expect(backendTasks[0]!.status).toBe("pending");

      // Frontend task exists but has dependency on task-1, so it's not "ready" yet
      // getTasks("frontend") returns empty because task-2 depends on task-1
      const frontendTasks = memoryManager.getTasks("frontend");
      expect(frontendTasks.length).toBe(0); // Not ready because task-1 not complete
    });

    it("should set correct task dependencies", async () => {
      (orchestrator as any).pendingPlan = {
        planId: "plan-deps-test",
        goal: "Test dependencies",
        tasks: [
          {
            id: "a",
            title: "A",
            description: "Task A",
            assignedRole: "backend",
            priority: 1,
            dependencies: [],
          },
          {
            id: "b",
            title: "B",
            description: "Task B",
            assignedRole: "frontend",
            priority: 2,
            dependencies: ["a"],
          },
          {
            id: "c",
            title: "C",
            description: "Task C",
            assignedRole: "devops",
            priority: 3,
            dependencies: ["a", "b"],
          },
        ],
      };
      (orchestrator as any).state = "awaiting_approval";

      await orchestrator.approvePlan();

      // Only Task A is "ready" because it has no dependencies
      // getTasks() only returns ready tasks
      const backendTasks = memoryManager.getTasks("backend");
      expect(backendTasks.length).toBe(1);
      expect(backendTasks[0]!.id).toBe("a");
      // Task A should have B and C as dependants
      expect(backendTasks[0]!.dependants).toContain("b");
      expect(backendTasks[0]!.dependants).toContain("c");

      // Frontend and devops tasks exist but are not "ready" (have dependencies)
      const frontendTasks = memoryManager.getTasks("frontend");
      expect(frontendTasks.length).toBe(0); // b depends on a (not complete)

      const devopsTasks = memoryManager.getTasks("devops");
      expect(devopsTasks.length).toBe(0); // c depends on a,b (not complete)
    });
  });

  describe("State Management", () => {
    it("should transition from awaiting_approval to executing on approve", async () => {
      (orchestrator as any).pendingPlan = {
        planId: "p1",
        goal: "g",
        tasks: [{ id: "t", title: "T", description: "D", assignedRole: "backend", dependencies: [] }],
      };
      (orchestrator as any).state = "awaiting_approval";

      await orchestrator.approvePlan();

      expect(orchestrator.getState()).toBe("executing");
    });

    it("should clear pending plan after approval", async () => {
      (orchestrator as any).pendingPlan = {
        planId: "p2",
        goal: "g",
        tasks: [{ id: "t", title: "T", description: "D", assignedRole: "backend", dependencies: [] }],
      };
      (orchestrator as any).state = "awaiting_approval";

      await orchestrator.approvePlan();

      expect(orchestrator.getPendingPlan()).toBeNull();
    });

    it("should reset to idle state on reset()", () => {
      (orchestrator as any).state = "executing";
      (orchestrator as any).pendingPlan = { planId: "p" };

      orchestrator.reset();

      expect(orchestrator.getState()).toBe("idle");
      expect(orchestrator.getPendingPlan()).toBeNull();
    });
  });
});
