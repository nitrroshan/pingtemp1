/**
 * Planning commands: /plan, /showplan, /approve, /resetplan
 */

import type { Command } from "../types.js";
import { c } from "../colors.js";

export const planCommand: Command = {
  name: "plan",
  aliases: ["p"],
  description: "Create a plan for a task",
  usage: "/plan <description>",
  category: "planning",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /plan <description>"));
      return;
    }

    ctx.print(c.info(`\nCreating plan for: "${args}"`));
    ctx.print(c.dim("Thinking...\n"));

    try {
      const response = await ctx.mgr!.orchestratorMessage(
        `Please create a plan for: ${args}`,
      );
      ctx.print(`\n${c.cmd("Orchestrator:")}`);
      ctx.print(response);
    } catch (error) {
      ctx.print(c.error(`\nError: ${(error as Error).message}`));
    }
  },
};

export const showPlanCommand: Command = {
  name: "showplan",
  aliases: ["sp"],
  description: "Display pending plan details",
  usage: "/showplan",
  category: "planning",
  requiresInit: true,
  async execute(_args, ctx) {
    const plan = ctx.mgr!.getOrchestratorPendingPlan();
    if (!plan) {
      ctx.print(c.dim("No pending plan."));
      return;
    }

    ctx.print(`\n${c.header(" PENDING PLAN ")}\n`);
    ctx.print(`Plan ID: ${plan.planId}`);
    ctx.print(`Tasks: ${plan.tasks?.length || 0}\n`);

    if (plan.tasks) {
      for (const t of plan.tasks) {
        ctx.print(`${c.cmd(`[${t.assignedRole}]`)} ${t.title}`);
        ctx.print(c.dim(`  ${t.description.slice(0, 100)}...`));
        if (t.dependencies?.length > 0) {
          ctx.print(c.dim(`  Deps: ${t.dependencies.join(", ")}`));
        }
        ctx.print("");
      }
    }
  },
};

export const approveCommand: Command = {
  name: "approve",
  aliases: [],
  description: "Approve pending plan",
  usage: "/approve",
  category: "planning",
  requiresInit: true,
  async execute(_args, ctx) {
    if (ctx.mgr!.getOrchestratorState() !== "awaiting_approval") {
      ctx.print(c.warn("No pending plan to approve."));
      return;
    }

    ctx.print(c.info("\nApproving plan..."));
    const result = await ctx.mgr!.approveOrchestratorPlan();

    if (result.success) {
      ctx.print(
        c.success(`✓ Plan approved: ${result.tasksQueued} tasks queued`),
      );
      if (result.autoStarted && result.autoStarted > 0) {
        ctx.print(c.info(`  Auto-started: ${result.autoStarted} tasks`));
      }
    } else {
      ctx.print(c.error(`✗ Approval failed: ${result.error}`));
    }
  },
};

export const resetPlanCommand: Command = {
  name: "resetplan",
  aliases: ["rp"],
  description: "Delete current plan",
  usage: "/resetplan",
  category: "planning",
  requiresInit: true,
  async execute(_args, ctx) {
    try {
      const result = await ctx.mgr!.resetPlan();
      if (result.deleted) {
        ctx.print(c.success(`Plan ${result.planId} deleted`));
      } else {
        ctx.print(c.dim("No active plan to reset"));
      }
      ctx.setActiveTask(null);
    } catch (e) {
      ctx.print(c.error(`Error: ${(e as Error).message}`));
    }
  },
};
