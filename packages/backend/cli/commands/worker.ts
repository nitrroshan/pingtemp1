/**
 * Worker CLI commands: /worker, /back, /workers
 *
 * /worker <role>  — Switch into a worker's CLI context
 * /back           — Return to orchestrator context
 * /workers        — List active workers and their status
 */

import type { Command } from "../types.js";
import { c } from "../colors.js";

export const workerCommand: Command = {
  name: "worker",
  aliases: ["w"],
  description: "Switch to a worker's CLI (direct chat with agent)",
  usage: "/worker <role>",
  category: "worker",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /worker <role>"));
      ctx.print(c.dim(`Available roles: ${ctx.teamRoles.join(", ")}`));
      return;
    }

    const role = args.toLowerCase().trim();

    // Verify the role exists
    if (!ctx.teamRoles.includes(role)) {
      ctx.print(c.error(`Unknown role: ${role}`));
      ctx.print(c.dim(`Available: ${ctx.teamRoles.join(", ")}`));
      return;
    }

    // Find an active task for this role
    const mm = ctx.mgr!.getTaskStore();
    if (!mm) {
      ctx.print(c.error("MemoryManager not available."));
      return;
    }

    const roleTasks = mm.getAllTasks().filter(
      (t: any) =>
        t.assigned_role === role &&
        (t.status === "in_progress" || t.status === "ready"),
    );

    if (roleTasks.length === 0) {
      ctx.print(c.warn(`No active/ready tasks for role: ${role}`));
      ctx.print(c.dim("Use /tasks to see all tasks, /start <id> to start one first."));
      return;
    }

    // If there's an in_progress task, use it; otherwise pick the first ready one
    const activeTask = roleTasks.find((t: any) => t.status === "in_progress") || roleTasks[0]!;

    // If the task is ready but not started, start it
    if (activeTask.status === "ready") {
      ctx.print(c.info(`Starting task ${activeTask.id.slice(0, 8)} for ${role}...`));
      try {
        if (activeTask.status === "ready") {
          ctx.mgr!.approveTaskForChat(activeTask.id);
        }
        const result = await ctx.mgr!.startTaskExecution(activeTask.id);
        ctx.print(c.success(`✓ Task started`));
        ctx.print(`\n${c.cmd("Agent Response:")}`);
        ctx.print(result.response);
      } catch (error) {
        ctx.print(c.error(`Failed to start task: ${(error as Error).message}`));
        return;
      }
    }

    // Switch context
    ctx.setActiveWorker(role);
    ctx.setActiveTask(activeTask.id);

    // Show workspace info if available
    try {
      const workspace = ctx.mgr!.getTaskWorkspace(activeTask.id);
      if (workspace) {
        ctx.print(c.dim(`  Workspace: ${workspace.branchName}`));
      }
    } catch {
      // workspace may not be enabled
    }

    ctx.print("");
    ctx.print(c.workerHeader(` WORKER: ${role.toUpperCase()} `));
    ctx.print(c.dim(`Task: ${activeTask.id.slice(0, 8)} — ${activeTask.description.slice(0, 60)}`));
    ctx.print(c.dim(`Type messages to chat directly with this worker's agent.`));
    ctx.print(c.dim(`Use /back to return to orchestrator. /complete to finish task.\n`));
  },
};

export const backCommand: Command = {
  name: "back",
  aliases: ["b"],
  description: "Return to orchestrator context",
  usage: "/back",
  category: "worker",
  requiresInit: false,
  async execute(_args, ctx) {
    if (!ctx.activeWorkerRole) {
      ctx.print(c.dim("Already in orchestrator mode."));
      return;
    }

    const prevRole = ctx.activeWorkerRole;
    ctx.setActiveWorker(null);
    ctx.print(c.success(`← Left ${prevRole} worker. Back in orchestrator mode.\n`));
  },
};

export const workersCommand: Command = {
  name: "workers",
  aliases: ["ws"],
  description: "List active workers and their status",
  usage: "/workers",
  category: "worker",
  requiresInit: true,
  async execute(_args, ctx) {
    const agents = ctx.mgr!.getActiveAgents();

    ctx.print(`\n${c.header(" WORKERS ")}\n`);

    if (agents.length === 0) {
      ctx.print(c.dim("No active workers."));
      ctx.print(c.dim("Use /start <taskId> to start a task, or /worker <role> to connect.\n"));
      return;
    }

    for (const a of agents) {
      const icon = a.status === "active" || a.status === "in_progress" ? "▶" : "○";
      const taskShort = a.taskId.slice(0, 8);

      // Try to get workspace info
      let wsInfo = "";
      try {
        const workspace = ctx.mgr!.getTaskWorkspace(a.taskId);
        if (workspace) {
          wsInfo = c.dim(` [${workspace.branchName}]`);
        }
      } catch {
        // ignore
      }

      const marker = ctx.activeWorkerRole === a.role ? c.success(" ← active") : "";
      ctx.print(`  ${icon} ${c.role(a.role.padEnd(12))} task:${c.info(taskShort)}${wsInfo}${marker}`);
    }
    ctx.print("");
    ctx.print(c.dim("Use /worker <role> to switch into a worker's CLI.\n"));
  },
};

export const workspaceCommand: Command = {
  name: "workspace",
  aliases: ["wsp"],
  description: "Show workspace status for active task",
  usage: "/workspace",
  category: "worker",
  requiresInit: true,
  async execute(_args, ctx) {
    const taskId = ctx.activeTaskId;
    if (!taskId) {
      ctx.print(c.warn("No active task. Use /start or /worker first."));
      return;
    }

    try {
      const workspace = ctx.mgr!.getTaskWorkspace(taskId);
      if (!workspace) {
        ctx.print(c.dim("No workspace for this task (workspace may not be enabled)."));
        return;
      }

      ctx.print(`\n${c.header(" WORKSPACE ")}\n`);
      ctx.print(`ID:      ${workspace.id}`);
      ctx.print(`Branch:  ${workspace.branchName}`);
      ctx.print(`Agent:   ${workspace.agentId}`);
      ctx.print(`Status:  ${workspace.status}`);

      try {
        const wsStatus = await workspace.getWorkspaceStatus();
        ctx.print(`\nFiles:   ${wsStatus.uncommittedChanges.length} uncommitted`);
        if (wsStatus.uncommittedChanges.length > 0) {
          for (const f of wsStatus.uncommittedChanges) {
            ctx.print(c.dim(`  • ${f}`));
          }
        }
        ctx.print(`Activities: ${wsStatus.activityStats.totalEntries} entries`);
      } catch (e) {
        ctx.print(c.dim(`(Could not get detailed status: ${(e as Error).message})`));
      }
      ctx.print("");
    } catch (error) {
      ctx.print(c.error(`Error: ${(error as Error).message}`));
    }
  },
};
