/**
 * Setup commands: /init
 */

import type { Command } from "../types.js";
import { c } from "../colors.js";
import { AgentManager } from "../../agentManager/AgentManagerV2.js";

export const initCommand: Command = {
  name: "init",
  aliases: [],
  description: "Initialize orchestrator with roles",
  usage: "/init [roles]",
  category: "setup",
  requiresInit: false,
  async execute(args, ctx) {
    if (args) {
      ctx.teamRoles = args.split(",").map((r) => r.trim());
    }

    ctx.print(c.info(`\nInitializing orchestrator...`));
    ctx.print(c.dim(`  Team: ${ctx.teamId}`));
    ctx.print(c.dim(`  Roles: ${ctx.teamRoles.join(", ")}`));

    const plannerMode = (process.env.PLANNER_MODE || "legacy") as "agent" | "legacy";
    const mgr = new AgentManager({ plannerMode });
    ctx.setManager(mgr);

    await mgr.initializeOrchestrator(ctx.teamId, ctx.teamRoles);
    ctx.setInitialized(true);

    ctx.print(c.success(`\n✓ Orchestrator initialized`));
    ctx.print(c.dim(`  State: ${mgr.getOrchestratorState()}`));
  },
};

export const statusCommand: Command = {
  name: "status",
  aliases: ["s"],
  description: "Show current state and metrics",
  usage: "/status",
  category: "setup",
  requiresInit: true,
  async execute(_args, ctx) {
    const mgr = ctx.mgr!;
    const state = mgr.getOrchestratorState();
    const workflow = mgr.getWorkflowStatus();
    const agents = mgr.getActiveAgents();
    const autoApprove = mgr.getAutoApproveRoles();

    ctx.print(`\n${c.header(" STATUS ")}\n`);
    ctx.print(`${c.cmd("Orchestrator")}`);
    ctx.print(`  State:          ${state}`);
    ctx.print(`  Auto-Execute:   ${mgr.getAutoExecute() ? c.success("ON") : c.warn("OFF")}`);
    ctx.print(`  Auto-Approve:   ${autoApprove.length > 0 ? autoApprove.join(", ") : c.dim("none")}`);
    ctx.print("");
    ctx.print(`${c.cmd("Workflow")}`);
    ctx.print(`  State:          ${workflow.state}`);
    ctx.print(`  Pending Tasks:  ${workflow.pendingTasks}`);
    ctx.print(`  Active Tasks:   ${workflow.activeTasks}`);
    ctx.print(`  Completed:      ${workflow.completedTasks}`);
    if (workflow.currentPlan) {
      ctx.print(`  Current Plan:   ${workflow.currentPlan}`);
    }
    ctx.print("");
    ctx.print(`${c.cmd("Active Agents")} (${agents.length})`);
    if (agents.length === 0) {
      ctx.print(c.dim("  None"));
    } else {
      for (const a of agents) {
        ctx.print(`  • [${a.status}] ${c.role(a.role)}: ${a.taskId.slice(0, 8)}`);
      }
    }
    ctx.print("");
  },
};
