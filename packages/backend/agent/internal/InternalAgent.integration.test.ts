/**
 * InternalAgent Integration Tests
 *
 * Tests real execution with Azure OpenAI.
 * Requires valid Azure OpenAI credentials in environment.
 *
 * Run with: npm run test:integration
 * Or: vitest run --config vitest.integration.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { InternalAgent } from "./InternalAgent.js";
import type { AgentDefinition, AgentEvent } from "../types.js";
import dotenv from "dotenv";

dotenv.config();

// Skip integration tests if no Azure credentials
const hasAzureCredentials =
  process.env.AZURE_OPENAI_ENDPOINT_URL && process.env.AZURE_OPENAI_API_KEY;

describe.skipIf(!hasAzureCredentials)(
  "InternalAgent Integration (Azure OpenAI)",
  () => {
    // ==========================================================================
    // Test Fixtures
    // ==========================================================================

    const createToolModeAgent = (): AgentDefinition => ({
      id: "integration-worker",
      name: "Integration Test Worker",
      type: "internal",
      role: "assistant",
      goal: "Help users with test queries",
      systemPrompt:
        "You are a helpful assistant. Keep responses brief (1-2 sentences).",
      config: {
        model: {
          provider: "azure-openai",
          deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || "gpt-4o",
          temperature: 0.3,
          maxTokens: 100,
        },
        tools: [],
      },
    });

    const createBuilderModeAgent = (): AgentDefinition => ({
      id: "integration-builder",
      name: "Integration Test Builder",
      type: "internal",
      role: "role-builder",
      goal: "Discover roles needed for tasks",
      systemPrompt: `You are a role discovery agent. Analyze the task and suggest appropriate roles.
Always respond with valid JSON matching the schema.`,
      config: {
        model: {
          provider: "azure-openai",
          deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || "gpt-4o",
          temperature: 0.2,
          maxTokens: 500,
        },
        responseFormat: "AgentRoleSchema",
        tools: [],
      },
    });

    // ==========================================================================
    // Tool Mode Integration Tests
    // ==========================================================================

    describe("Tool Mode (Worker)", () => {
      let agent: InternalAgent;

      beforeAll(async () => {
        agent = new InternalAgent(createToolModeAgent());
        await agent.initialize();
      }, 30000);

      afterAll(async () => {
        await agent.stop();
      });

      it("should execute a simple prompt and get response", async () => {
        const events: AgentEvent[] = [];

        for await (const event of agent.execute({
          message: "What is 2 + 2? Answer in one word.",
          threadId: `integration-${Date.now()}`,
        })) {
          events.push(event);
          console.log(`Event: ${event.type}`, event);
        }

        // Verify event sequence
        expect(events.length).toBeGreaterThan(0);
        expect(events[0]!.type).toBe("thinking");

        const doneEvent = events.find((e) => e.type === "done");
        expect(doneEvent).toBeDefined();
        expect(doneEvent?.output?.response).toBeDefined();
        expect(doneEvent?.output?.response.toLowerCase()).toContain("four");
      }, 60000);

      it("should maintain conversation context across messages", async () => {
        const threadId = `context-test-${Date.now()}`;

        // First message
        await agent.run("My name is TestBot. Remember that.", threadId);

        // Second message should remember
        const response = await agent.run("What is my name?", threadId);

        expect(response.toLowerCase()).toContain("testbot");
      }, 60000);

      it("should stream message_delta events", async () => {
        const deltas: string[] = [];

        for await (const event of agent.execute({
          message: "Say hello",
          threadId: `stream-test-${Date.now()}`,
        })) {
          if (event.type === "message_delta") {
            deltas.push(event.delta);
          }
        }

        // Should have received at least one delta
        expect(deltas.length).toBeGreaterThan(0);
      }, 60000);
    });

    // ==========================================================================
    // Structured Output Mode Integration Tests
    // ==========================================================================

    describe("Structured Output Mode (Builder)", () => {
      let agent: InternalAgent;

      beforeAll(async () => {
        agent = new InternalAgent(createBuilderModeAgent());
        await agent.initialize();
      }, 30000);

      afterAll(async () => {
        await agent.stop();
      });

      it("should return structured roles output", async () => {
        const result = await agent.run(
          "Task: Build a web application with user authentication and a dashboard.",
          `builder-${Date.now()}`,
        );

        console.log("Builder result:", JSON.stringify(result, null, 2));

        // Should have roles array
        expect(result).toBeDefined();
        expect(result.roles).toBeDefined();
        expect(Array.isArray(result.roles)).toBe(true);
        expect(result.roles.length).toBeGreaterThan(0);

        // Each role should have required fields
        for (const role of result.roles) {
          expect(role.role).toBeDefined();
          expect(role.goal).toBeDefined();
          expect(Array.isArray(role.skills)).toBe(true);
        }
      }, 60000);

      it("should emit events in correct sequence", async () => {
        const events: AgentEvent[] = [];

        for await (const event of agent.execute({
          message: "Task: Create a simple CLI tool",
          threadId: `events-${Date.now()}`,
        })) {
          events.push(event);
        }

        // First event should be thinking
        expect(events.length).toBeGreaterThan(0);
        expect(events[0]!.type).toBe("thinking");

        // Should have message event
        const messageEvent = events.find((e) => e.type === "message");
        expect(messageEvent).toBeDefined();

        // Last event should be done
        const lastEvent = events[events.length - 1];
        expect(lastEvent).toBeDefined();
        expect(lastEvent!.type).toBe("done");
      }, 60000);
    });

    // ==========================================================================
    // Error Handling Integration Tests
    // ==========================================================================

    describe("Error Handling", () => {
      it("should handle invalid prompt gracefully", async () => {
        const agent = new InternalAgent(createToolModeAgent());
        await agent.initialize();

        // Empty string should still work
        const response = await agent.run("", `error-test-${Date.now()}`);
        expect(response).toBeDefined();

        await agent.stop();
      }, 60000);
    });

    // ==========================================================================
    // Performance Tests
    // ==========================================================================

    describe("Performance", () => {
      it("should complete simple request within 30 seconds", async () => {
        const agent = new InternalAgent(createToolModeAgent());
        await agent.initialize();

        const startTime = Date.now();
        await agent.run("Hi", `perf-test-${Date.now()}`);
        const duration = Date.now() - startTime;

        console.log(`Request completed in ${duration}ms`);
        expect(duration).toBeLessThan(30000);

        await agent.stop();
      }, 60000);
    });
  },
);

// ==========================================================================
// Credentials Check
// ==========================================================================

describe("Environment Check", () => {
  it("should have Azure OpenAI credentials for integration tests", () => {
    if (!hasAzureCredentials) {
      console.warn(
        "⚠️ Azure OpenAI credentials not found. Integration tests skipped.",
      );
      console.warn(
        "Set AZURE_OPENAI_ENDPOINT_URL and AZURE_OPENAI_API_KEY to run integration tests.",
      );
    }
    expect(true).toBe(true); // Always passes, just logs warning
  });
});
