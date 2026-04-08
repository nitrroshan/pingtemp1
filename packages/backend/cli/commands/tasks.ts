/**
 * Task commands: /tasks, /task, /start, /chat, /complete, /discard, /modify, /stop
 */

import type { Command } from "../types.js";
import { c } from "../colors.js";

export const tasksCommand: Command = {
  name: "tasks",
  aliases: ["t"],
  description: "List all tasks",
  usage: "/tasks",
  category: "tasks",
  requiresInit: true,
  async execute(_args, ctx) {
    const mm = ctx.mgr!.getTaskStore();
    if (!mm) {
      ctx.print(c.error("MemoryManager not available."));
      return;
    }

    ctx.print(`\n${c.header(" TASKS ")}\n`);

    const allTasks = mm.getAllTasks();
    if (allTasks.length === 0) {
      ctx.print(c.dim("No tasks."));
      return;
    }

    const byStatus: Record<string, typeof allTasks> = {};
    for (const task of allTasks) {
      if (!byStatus[task.status]) byStatus[task.status] = [];
      byStatus[task.status]!.push(task);
    }

    const statusOrder = ["in_progress", "ready", "pending", "completed", "failed"];
    for (const status of statusOrder) {
      const tasks = byStatus[status];
      if (!tasks || tasks.length === 0) continue;

      const icon =
        status === "completed" ? "✓" :
        status === "in_progress" ? "▶" :
        status === "ready" ? "○" :
        status === "failed" ? "✗" : "•";

      ctx.print(`${c.cmd(status.toUpperCase())} (${tasks.length})`);
      for (const t of tasks) {
        ctx.print(
          `  ${icon} ${c.info(t.id.slice(0, 8))} [${t.assigned_role}] ${t.description.slice(0, 50)}...`,
        );
      }
      ctx.print("");
    }
  },
};

export const taskCommand: Command = {
  name: "task",
  aliases: [],
  description: "Show task details",
  usage: "/task <id>",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /task <id>"));
      return;
    }

    const mm = ctx.mgr!.getTaskStore();
    if (!mm) {
      ctx.print(c.error("MemoryManager not available."));
      return;
    }

    const allTasks = mm.getAllTasks();
    const task = allTasks.find(
      (t: any) => t.id === args || t.id.startsWith(args),
    );

    if (!task) {
      ctx.print(c.error(`Task not found: ${args}`));
      return;
    }

    ctx.print(`\n${c.header(" TASK DETAILS ")}\n`);
    ctx.print(`ID:          ${task.id}`);
    ctx.print(`Role:        ${task.assigned_role}`);
    ctx.print(`Status:      ${task.status}`);
    ctx.print(`Description: ${task.description}`);
    if ((task as any).context) {
      ctx.print(`\nContext:`);
      ctx.print(JSON.stringify((task as any).context, null, 2));
    }
    if ((task as any).output_data) {
      ctx.print(`\nOutput:`);
      const output = (task as any).output_data;
      ctx.print(
        typeof output === "string"
          ? output.slice(0, 500)
          : JSON.stringify(output, null, 2).slice(0, 500),
      );
    }
  },
};

export const startCommand: Command = {
  name: "start",
  aliases: [],
  description: "Start executing a task",
  usage: "/start <id>",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /start <taskId>"));
      return;
    }

    const mm = ctx.mgr!.getTaskStore();
    if (!mm) return;

    const allTasks = mm.getAllTasks();
    const task = allTasks.find(
      (t: any) => t.id === args || t.id.startsWith(args),
    );

    if (!task) {
      ctx.print(c.error(`Task not found: ${args}`));
      return;
    }

    const fullId = task.id;

    try {
      if (task.status === "pending") {
        ctx.print(c.info("Approving task for chat..."));
        ctx.mgr!.approveTaskForChat(fullId);
      }

      ctx.print(c.info(`Starting task: ${fullId.slice(0, 8)}...`));
      const result = await ctx.mgr!.startTaskExecution(fullId);

      ctx.setActiveTask(fullId);
      ctx.print(c.success(`\n✓ Task started`));
      ctx.print(`\n${c.cmd("Agent Response:")}`);
      ctx.print(result.response);
      ctx.print(
        c.dim(`\nUse /chat <message> to continue, /complete to finish`),
      );
    } catch (error) {
      ctx.print(c.error(`Error: ${(error as Error).message}`));
    }
  },
};

export const chatCommand: Command = {
  name: "chat",
  aliases: [],
  description: "Continue conversation with active task",
  usage: "/chat <message>",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /chat <message>"));
      return;
    }

    if (!ctx.activeTaskId) {
      ctx.print(c.warn("No active task. Use /start <taskId> first."));
      return;
    }

    try {
      ctx.print(c.dim("\nAgent thinking...\n"));
      const response = await ctx.mgr!.continueTask(ctx.activeTaskId, args);
      ctx.print(`${c.cmd("Agent:")}`);
      ctx.print(
        typeof response === "string" ? response : JSON.stringify(response),
      );
    } catch (error) {
      ctx.print(c.error(`Error: ${(error as Error).message}`));
    }
  },
};

export const completeCommand: Command = {
  name: "complete",
  aliases: [],
  description: "Mark task as complete",
  usage: "/complete [id]",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    const id = args || ctx.activeTaskId;
    if (!id) {
      ctx.print(c.warn("No task specified or active."));
      return;
    }

    try {
      const result = await ctx.mgr!.completeTaskByUser(id);
      if (result.success) {
        ctx.print(c.success(`✓ Task completed: ${id.slice(0, 8)}`));
        if (ctx.activeTaskId === id) {
          ctx.setActiveTask(null);
        }
      } else {
        ctx.print(c.error(`Failed: ${result.mergeError}`));
      }
    } catch (error) {
      ctx.print(c.error(`Error: ${(error as Error).message}`));
    }
  },
};

export const discardCommand: Command = {
  name: "discard",
  aliases: [],
  description: "Discard a pending task",
  usage: "/discard <id>",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /discard <taskId>"));
      return;
    }
    try {
      ctx.mgr!.discardTask(args);
      ctx.print(c.success(`Task ${args.slice(0, 8)} discarded`));
    } catch (e) {
      ctx.print(c.error(`Error: ${(e as Error).message}`));
    }
  },
};

export const modifyCommand: Command = {
  name: "modify",
  aliases: [],
  description: "Modify a task description",
  usage: "/modify <id> <desc>",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    const parts = args.split(" ");
    if (parts.length < 2) {
      ctx.print(c.warn("Usage: /modify <taskId> <new description>"));
      return;
    }
    try {
      const taskId = parts[0]!;
      const newDesc = parts.slice(1).join(" ");
      ctx.mgr!.modifyTask(taskId, { description: newDesc });
      ctx.print(c.success(`Task ${taskId.slice(0, 8)} modified`));
    } catch (e) {
      ctx.print(c.error(`Error: ${(e as Error).message}`));
    }
  },
};

export const stopCommand: Command = {
  name: "stop",
  aliases: [],
  description: "Stop an in-progress task",
  usage: "/stop <id>",
  category: "tasks",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /stop <taskId>"));
      return;
    }
    try {
      await ctx.mgr!.stopTask(args);
      ctx.print(c.success(`Task ${args.slice(0, 8)} stopped`));
      if (ctx.activeTaskId === args) ctx.setActiveTask(null);
    } catch (e) {
      ctx.print(c.error(`Error: ${(e as Error).message}`));
    }
  },
};
