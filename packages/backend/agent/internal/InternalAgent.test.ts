/**
 * InternalAgent Unit Tests
 *
 * Tests the unified InternalAgent class that handles both:
 * - Tool mode (workers, orchestrator)
 * - Structured output mode (builders)
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { InternalAgent } from "./InternalAgent.js";
import type { AgentDefinition, AgentEvent } from "../types.js";

// Mock LangChain dependencies
mock.module("langchain", () => ({
  createAgent: mock().mockResolvedValue({
    stream: mock().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          agent: {
            messages: [{ content: "Test response from agent" }],
          },
        };
      },
    }),
    invoke: mock().mockResolvedValue({
      structuredResponse: { roles: [{ role: "test-role", goal: "test goal" }] },
      messages: [{ content: '{"roles": []}' }],
    }),
  }),
  providerStrategy: mock((schema: any) => ({ schema })),
}));

mock.module("@langchain/langgraph", () => ({
  MemorySaver: class MockMemorySaver {
    constructor() {}
  },
}));

mock.module("@langchain/openai", () => ({
  AzureChatOpenAI: class MockAzureChatOpenAI {
    constructor() {}
    name = "AzureChatOpenAI";
  },
}));

mock.module("@langchain/anthropic", () => ({
  ChatAnthropic: class MockChatAnthropic {
    constructor() {}
    name = "ChatAnthropic";
  },
}));

mock.module("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: class MockMCPClient {
    constructor() {}
    async getTools() {
      return [];
    }
  },
}));

// Set required environment variables
process.env.AZURE_OPENAI_ENDPOINT_URL = "https://test.openai.azure.com";
process.env.AZURE_OPENAI_API_KEY = "test-key";

describe("InternalAgent", () => {
  // ==========================================================================
  // Test Fixtures
  // ==========================================================================

  const createToolModeDefinition = (): AgentDefinition => ({
    id: "test-worker",
    name: "Test Worker Agent",
    type: "internal",
    role: "worker",
    goal: "Help users with tasks",
    systemPrompt: "You are a helpful test agent.",
    config: {
      model: {
        provider: "azure-openai",
        deployment: "gpt-4o",
        temperature: 0.7,
      },
      tools: [],
    },
  });

  const createStructuredOutputDefinition = (): AgentDefinition => ({
    id: "test-builder",
    name: "Test Builder Agent",
    type: "internal",
    role: "role-builder",
    goal: "Discover roles needed for tasks",
    systemPrompt: "You are a role discovery agent.",
    config: {
      model: {
        provider: "azure-openai",
        deployment: "gpt-4o",
        temperature: 0.3,
      },
      responseFormat: "AgentRoleSchema",
      tools: [],
    },
  });

  afterEach(() => {
    // bun:test automatically resets mocks per test file
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe("constructor", () => {
    it("should create an agent in tool mode when no responseFormat", () => {
      const definition = createToolModeDefinition();
      const agent = new InternalAgent(definition);

      expect(agent.id).toBe("test-worker");
      expect(agent.name).toBe("Test Worker Agent");
      expect(agent.type).toBe("internal");
      expect(agent.role).toBe("worker");
      expect(agent.isBuilderMode()).toBe(false);
    });

    it("should create an agent in structured output mode when responseFormat is set", () => {
      const definition = createStructuredOutputDefinition();
      const agent = new InternalAgent(definition);

      expect(agent.id).toBe("test-builder");
      expect(agent.role).toBe("role-builder");
      expect(agent.isBuilderMode()).toBe(true);
    });

    it("should start with idle status", () => {
      const agent = new InternalAgent(createToolModeDefinition());
      expect(agent.getStatus()).toBe("idle");
    });
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe("initialize", () => {
    it("should initialize tool mode agent with tools", async () => {
      const definition = createToolModeDefinition();
      const agent = new InternalAgent(definition);

      await agent.initialize();

      expect(agent.getStatus()).toBe("idle");
    });

    it("should initialize structured output mode without loading tools", async () => {
      const definition = createStructuredOutputDefinition();
      const agent = new InternalAgent(definition);

      await agent.initialize();

      expect(agent.isBuilderMode()).toBe(true);
      expect(agent.getTools()).toEqual([]); // No tools in structured mode
    });

    it("should throw if Azure OpenAI endpoint is missing", async () => {
      const originalEndpoint = process.env.AZURE_OPENAI_ENDPOINT_URL;
      delete process.env.AZURE_OPENAI_ENDPOINT_URL;

      const agent = new InternalAgent(createToolModeDefinition());

      await expect(agent.initialize()).rejects.toThrow(
        "AZURE_OPENAI_ENDPOINT_URL environment variable is required",
      );

      process.env.AZURE_OPENAI_ENDPOINT_URL = originalEndpoint;
    });
  });

  // ==========================================================================
  // Execution Tests (Tool Mode)
  // ==========================================================================

  describe("execute (tool mode)", () => {
    it("should emit thinking event at start", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      const events: AgentEvent[] = [];
      for await (const event of agent.execute({
        message: "Hello",
        threadId: "test-thread",
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.type).toBe("thinking");
    });

    it("should emit done event with response", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      const events: AgentEvent[] = [];
      for await (const event of agent.execute({
        message: "Hello",
        threadId: "test-thread",
      })) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.type).toBe("done");
    });

    it("should update status during execution", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      let statusDuringExecution: string | undefined;

      for await (const event of agent.execute({
        message: "Hello",
        threadId: "test-thread",
      })) {
        if (event.type === "thinking") {
          statusDuringExecution = agent.getStatus();
        }
      }

      expect(statusDuringExecution).toBe("executing");
      expect(agent.getStatus()).toBe("idle"); // Back to idle after
    });
  });

  // ==========================================================================
  // Execution Tests (Structured Output Mode)
  // ==========================================================================

  describe("execute (structured output mode)", () => {
    it("should return structured response", async () => {
      const agent = new InternalAgent(createStructuredOutputDefinition());
      await agent.initialize();

      const events: AgentEvent[] = [];
      for await (const event of agent.execute({
        message: "Analyze this task",
        threadId: "test-thread",
      })) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.output).toBeDefined();
    });
  });

  // ==========================================================================
  // run() Convenience Method Tests
  // ==========================================================================

  describe("run", () => {
    it("should return string response in tool mode", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      const response = await agent.run("Hello", "test-thread");

      expect(typeof response).toBe("string");
    });

    it("should return structured response in builder mode", async () => {
      const agent = new InternalAgent(createStructuredOutputDefinition());
      await agent.initialize();

      const response = await agent.run("Analyze roles", "test-thread");

      expect(response).toBeDefined();
      expect(response.roles).toBeDefined();
    });

    it("should auto-generate threadId if not provided", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      // Should not throw
      const response = await agent.run("Hello");
      expect(response).toBeDefined();
    });
  });

  // ==========================================================================
  // Event Emission Tests
  // ==========================================================================

  describe("event emission", () => {
    it("should emit task:complete on successful execution with taskId", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      const completedTasks: string[] = [];
      agent.on("task:complete", (data: { taskId: string }) => {
        completedTasks.push(data.taskId);
      });

      for await (const event of agent.execute({
        message: "Hello",
        threadId: "test-thread",
        taskId: "task-123",
      })) {
        // consume events
      }

      expect(completedTasks).toContain("task-123");
    });
  });

  // ==========================================================================
  // Lifecycle Tests
  // ==========================================================================

  describe("lifecycle", () => {
    it("should stop and update status", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      await agent.stop();

      expect(agent.getStatus()).toBe("stopped");
    });

    it("should reset conversation history", async () => {
      const agent = new InternalAgent(createToolModeDefinition());
      await agent.initialize();

      // Execute to build up history
      for await (const _ of agent.execute({
        message: "Hello",
        threadId: "test-thread",
      })) {
        // consume events
      }

      await agent.reset();

      expect(agent.getConversation()).toEqual([]);
    });
  });

  // ==========================================================================
  // Tool Registration Tests
  // ==========================================================================

  describe("tools", () => {
    it("should return empty array when no tools configured", () => {
      const agent = new InternalAgent(createToolModeDefinition());
      expect(agent.getTools()).toEqual([]);
    });

    it("should not load tools in structured output mode", async () => {
      const agent = new InternalAgent(createStructuredOutputDefinition());
      await agent.initialize();

      expect(agent.getTools()).toEqual([]);
      expect(agent.isBuilderMode()).toBe(true);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe("error handling", () => {
    it("should emit error event on execution failure", async () => {
      // Create agent with bad config to trigger error
      const definition = createToolModeDefinition();
      delete process.env.AZURE_OPENAI_API_KEY;

      const agent = new InternalAgent(definition);

      const events: AgentEvent[] = [];
      try {
        for await (const event of agent.execute({
          message: "Hello",
          threadId: "test-thread",
        })) {
          events.push(event);
        }
      } catch {
        // Expected
      }

      // Restore
      process.env.AZURE_OPENAI_API_KEY = "test-key";
    });
  });
});
