/**
 * User Interaction Tools
 *
 * Tools for planner↔user and worker↔user communication.
 * - ask_user: blocks until user responds (clarification, decisions)
 * - tell_user: fire-and-forget updates (progress, findings, warnings)
 * - discuss_approach: presents options, blocks until user selects
 *
 * Both planner and worker versions share the same schemas but emit
 * different Socket.IO events and are scoped differently.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { UserInteractionManager } from "../UserInteractionManager.js";
import { PromptLoader } from "../PromptLoader.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const AskUserSchema = z.object({
  question: z
    .string()
    .describe("The question to ask the user. Be specific and concise."),
  category: z
    .enum(["clarification", "decision", "approval", "feedback"])
    .default("clarification")
    .describe("Category of question — helps the UI render appropriately"),
});

export const TellUserSchema = z.object({
  message: z
    .string()
    .describe("The message to send to the user"),
  category: z
    .enum(["finding", "progress", "warning", "status"])
    .default("progress")
    .describe("Category of update — finding (research result), progress (milestone), warning (risk), status (state change)"),
});

export const DiscussApproachSchema = z.object({
  summary: z
    .string()
    .describe("Summary of the situation and why you need the user's input"),
  options: z.array(z.object({
    label: z.string().describe("Short label for this option"),
    description: z.string().optional().describe("Longer explanation of trade-offs"),
  })).min(2).describe("At least 2 options for the user to choose from"),
  recommendation: z
    .string()
    .optional()
    .describe("Which option you recommend and why (optional)"),
});

// ─── Tool Factories ───────────────────────────────────────────────────────────

export interface UserToolContext {
  manager: UserInteractionManager;
  sourceId: string;
  from: "planner" | "worker";
}

/**
 * Create the ask_user tool.
 * Blocks the calling agent until the user responds or timeout occurs.
 */
export function createAskUserTool(ctx: UserToolContext) {
  return tool(
    async (input) => {
      const response = await ctx.manager.askQuestion({
        from: ctx.from,
        sourceId: ctx.sourceId,
        question: input.question,
        category: input.category,
      });
      return response.answer;
    },
    {
      name: "ask_user",
      description: PromptLoader.loadTemplate("tools", "ask_user"),
      schema: AskUserSchema,
    },
  );
}

/**
 * Create the tell_user tool.
 * Fire-and-forget — does NOT block the agent.
 */
export function createTellUserTool(ctx: UserToolContext) {
  return tool(
    async (input) => {
      // tell_user is fire-and-forget — the tool input/output flows through the
      // existing stream channel as tool-input-*/tool-output-* stream parts.
      // Frontend renders a ToolCard showing the message. No separate event needed.
      return `Message sent to user: "${input.message.substring(0, 100)}..."`;
    },
    {
      name: "tell_user",
      description: PromptLoader.loadTemplate("tools", "tell_user"),
      schema: TellUserSchema,
    },
  );
}

/**
 * Create the discuss_approach tool.
 * Presents options to the user, blocks until they select one.
 */
export function createDiscussApproachTool(ctx: UserToolContext) {
  return tool(
    async (input) => {
      const response = await ctx.manager.askQuestion({
        from: ctx.from,
        sourceId: ctx.sourceId,
        question: `${input.summary}\n\nOptions:\n${input.options.map((o, i) => `${i + 1}. **${o.label}**${o.description ? `: ${o.description}` : ""}`).join("\n")}${input.recommendation ? `\n\nRecommendation: ${input.recommendation}` : ""}`,
        options: input.options,
        category: "decision",
      });
      return `User chose: ${response.answer}`;
    },
    {
      name: "discuss_approach",
      description: PromptLoader.loadTemplate("tools", "discuss_approach"),
      schema: DiscussApproachSchema,
    },
  );
}
