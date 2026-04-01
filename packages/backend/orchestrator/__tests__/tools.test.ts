/**
 * Unit tests for Orchestrator tools
 *
 * Tests each tool in isolation with mocked dependencies
 */

import { describe, it, expect, beforeEach, mock, type Mock } from "bun:test";
import { EventEmitter } from "events";
import { createOrchestratorTools } from "../tools/index.js";
import { PlanStore } from "../../memory/L2/collaboration/PlanStore.js";
import type { OrchestratorContext } from "../types.js";
import type { StructuredTool } from "@langchain/core/tools";

// Mock MemoryManager
const createMockMemoryManager = () => ({
  addTask: mock(),
  getTasks: mock().mockReturnValue([]),
  updateTaskStatus: mock(),
  completeTask: mock(),
  isComplete: mock().mockReturnValue(false),
});

// Mock PlanBuilder
const createMockPlanBuilder = () => ({
  invoke: mock().mockResolvedValue({
    planId: "plan-123",
    goal: "Test goal",
    tasks: [
      {
        id: "task-1",
        title: "First task",
        description: "Do the first thing",
        assignedRole: "backend",
        priority: 1,
        complexity: "medium",
        dependencies: [],
        expectedOutput: "Code done",
      },
      {
        id: "task-2",
        title: "Second task",
        description: "Do the second thing",
        assignedRole: "frontend",
        priority: 2,
        complexity: "low",
        dependencies: ["task-1"],
        expectedOutput: "UI done",
      },
    ],
    estimatedDuration: "2 hours",
    risks: ["Time constraint"],
  }),
});

// Helper to call a tool by name
async function callTool(
  tools: StructuredTool[],
  name: string,
  input: Record<string, any>,
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const result = await tool.call(input);
  // LangChain tools may return string or ToolMessage, handle both
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return JSON.stringify(result);
  return JSON.stringify(result);
}

describe("Orchestrator Tools", () => {
  let context: OrchestratorContext;
  let mockMemoryManager: ReturnType<typeof createMockMemoryManager>;
  let mockPlanBuilder: ReturnType<typeof createMockPlanBuilder>;
  let mockPlanStore: any;
  let mockArtifactRegistry: any;
  let events: EventEmitter;
  let pendingPlan: any;
  let state: string;
  let tools: StructuredTool[];

  beforeEach(() => {
    mockMemoryManager = createMockMemoryManager();
    mockPlanBuilder = createMockPlanBuilder();
    mockPlanStore = {
      savePlan: mock(),
      loadPlan: mock(),
      updatePlanStatus: mock(),
    };
    mockArtifactRegistry = {
      registerArtifact: mock(),
      getArtifact: mock(),
      queryArtifacts: mock().mockReturnValue([]),
      getTaskContext: mock().mockReturnValue("No artifacts found"),
    };
    events = new EventEmitter();
    pendingPlan = null;
    state = "idle";

    context = {
      memoryManager: mockMemoryManager as any,
      events,
      planStore: mockPlanStore,
      artifactRegistry: mockArtifactRegistry,
      teamId: "team-test",
      teamRoles: ["backend", "frontend", "devops"],
      planBuilder: mockPlanBuilder,
      getState: () => state as any,
      setState: (s) => {
        state = s;
      },
      getPendingPlan: () => pendingPlan,
      setPendingPlan: (p) => {
        pendingPlan = p;
      },
    };

    tools = createOrchestratorTools(context);
  });

  describe("create_plan tool", () => {
    it("should invoke PlanBuilder with requirements", async () => {
      const result = await callTool(tools, "create_plan", {
        goal: "Build a blog",
        context: "User wants Next.js",
        constraints: ["Must be fast"],
        roles: ["backend", "frontend"],
      });

      expect(mockPlanBuilder.invoke).toHaveBeenCalled();
      expect(result).toContain("awaiting_approval");
    });

    it("should set state to awaiting_approval", async () => {
      await callTool(tools, "create_plan", {
        goal: "Build something",
        context: "Context here",
        constraints: [],
        roles: ["backend"],
      });

      expect(state).toBe("awaiting_approval");
    });

    it("should emit plan:proposed event", async () => {
      const eventPromise = new Promise((resolve) => {
        events.on("plan:proposed", resolve);
      });

      await callTool(tools, "create_plan", {
        goal: "Build something",
        context: "Context here",
        constraints: [],
        roles: ["backend"],
      });

      const event = await eventPromise;
      expect(event).toHaveProperty("plan");
      expect(event).toHaveProperty("teamId", "team-test");
    });

    it("should store pending plan in context", async () => {
      await callTool(tools, "create_plan", {
        goal: "Build something",
        context: "Context here",
        constraints: [],
        roles: ["backend"],
      });

      expect(pendingPlan).not.toBeNull();
      expect(pendingPlan.planId).toBe("plan-123");
    });
  });

  describe("approve_plan tool", () => {
    beforeEach(() => {
      // Set up a pending plan
      pendingPlan = {
        planId: "plan-456",
        goal: "Test goal",
        tasks: [
          {
            id: "t1",
            title: "Task 1",
            description: "Do task 1",
            assignedRole: "backend",
            priority: 1,
            complexity: "low",
            dependencies: [],
            expectedOutput: "Done",
          },
        ],
      };
      state = "awaiting_approval";
    });

    it("should add tasks to MemoryManager", async () => {
      await callTool(tools, "approve_plan", {});

      expect(mockMemoryManager.addTask).toHaveBeenCalledTimes(1);
      expect(mockMemoryManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "t1",
          assigned_role: "backend",
          status: "pending",
        }),
      );
    });

    it("should set state to executing", async () => {
      await callTool(tools, "approve_plan", {});

      expect(state).toBe("executing");
    });

    it("should clear pending plan", async () => {
      await callTool(tools, "approve_plan", {});

      expect(pendingPlan).toBeNull();
    });

    it("should emit plan:approved event", async () => {
      const eventPromise = new Promise((resolve) => {
        events.on("plan:approved", resolve);
      });

      await callTool(tools, "approve_plan", {});

      const event = await eventPromise;
      expect(event).toHaveProperty("tasksQueued", 1);
    });

    it("should return error if no pending plan", async () => {
      pendingPlan = null;

      const result = await callTool(tools, "approve_plan", {});

      // Result is JSON string from tool
      expect(result).toContain("no_pending_plan");
    });
  });

  describe("get_status tool", () => {
    it("should return task counts by status", async () => {
      mockMemoryManager.getTasks.mockReturnValue([
        { id: "t1", status: "pending" },
        { id: "t2", status: "in_progress" },
        { id: "t3", status: "completed" },
      ]);

      const result = await callTool(tools, "get_status", {});

      // Result is JSON string containing task status info
      expect(result).toContain("total");
      expect(result).toContain("completed");
    });

    it("should call getTasks for each role", async () => {
      await callTool(tools, "get_status", {});

      // Should query each role
      expect(mockMemoryManager.getTasks).toHaveBeenCalledWith("backend");
      expect(mockMemoryManager.getTasks).toHaveBeenCalledWith("frontend");
      expect(mockMemoryManager.getTasks).toHaveBeenCalledWith("devops");
    });
  });
});
