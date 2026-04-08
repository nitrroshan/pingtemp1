/**
 * Debug commands: /events, /memory, /memtasks, /run, /say
 */

import type { Command } from "../types.js";
import { c } from "../colors.js";

/** Shared event log — the main CLI pushes events here */
export const eventLog: Array<{ time: string; event: string; data: any }> = [];

export const eventsCommand: Command = {
  name: "events",
  aliases: [],
  description: "Show event log",
  usage: "/events",
  category: "debug",
  requiresInit: false,
  async execute(_args, ctx) {
    ctx.print(`\n${c.header(" EVENT LOG ")} (last ${eventLog.length})\n`);
    if (eventLog.length === 0) {
      ctx.print(c.dim("No events yet."));
    } else {
      for (const e of eventLog.slice(-20)) {
        ctx.print(
          `${c.dim(e.time)} ${c.info(e.event)} ${JSON.stringify(e.data)}`,
        );
      }
    }
  },
};

export const memoryCommand: Command = {
  name: "memory",
  aliases: ["mem"],
  description: "Show memory manager stats",
  usage: "/memory",
  category: "debug",
  requiresInit: true,
  async execute(_args, ctx) {
    const mm = ctx.mgr!.getTaskStore();
    if (!mm) {
      ctx.print(c.error("MemoryManager not available."));
      return;
    }

    const allTasks = mm.getAllTasks();
    const byStatus = allTasks.reduce(
      (acc: Record<string, number>, t: any) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byRole = allTasks.reduce(
      (acc: Record<string, number>, t: any) => {
        acc[t.assigned_role] = (acc[t.assigned_role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    ctx.print(`\n${c.header(" MEMORY STATS ")}\n`);
    ctx.print(`Total Tasks: ${allTasks.length}`);
    ctx.print(`\n${c.cmd("By Status:")}`);
    for (const [status, count] of Object.entries(byStatus)) {
      ctx.print(`  ${status}: ${count}`);
    }
    ctx.print(`\n${c.cmd("By Role:")}`);
    for (const [role, count] of Object.entries(byRole)) {
      ctx.print(`  ${role}: ${count}`);
    }
  },
};

export const memTasksCommand: Command = {
  name: "memtasks",
  aliases: ["mt"],
  description: "List tasks by role from memory",
  usage: "/memtasks [role]",
  category: "debug",
  requiresInit: true,
  async execute(args, ctx) {
    const mm = ctx.mgr!.getTaskStore();
    if (!mm) {
      ctx.print(c.error("TaskStore not available."));
      return;
    }
    const tasks = args
      ? mm.getAllTasks().filter((t: any) => t.assigned_role === args.toLowerCase())
      : mm.getAllTasks();
    ctx.print(`\nTasks${args ? ` for ${args}` : ""}:`);
    for (const t of tasks) {
      ctx.print(
        `  • [${t.status}] ${t.id.slice(0, 8)} - ${t.description.slice(0, 50)}...`,
      );
    }
  },
};

export const sayCommand: Command = {
  name: "say",
  aliases: [],
  description: "Send message to orchestrator",
  usage: "/say <message>",
  category: "debug",
  requiresInit: true,
  async execute(args, ctx) {
    if (!args) {
      ctx.print(c.warn("Usage: /say <message>"));
      return;
    }

    ctx.print(c.dim("\nOrchestrator thinking...\n"));
    try {
      const response = await ctx.mgr!.orchestratorMessage(args);
      ctx.print(`${c.cmd("Orchestrator:")}`);
      ctx.print(response);
      ctx.print(c.dim(`\n[State: ${ctx.mgr!.getOrchestratorState()}]`));
    } catch (error) {
      ctx.print(c.error(`Error: ${(error as Error).message}`));
    }
  },
};

export const runCommand: Command = {
  name: "run",
  aliases: [],
  description: "Run full E2E test",
  usage: "/run",
  category: "debug",
  requiresInit: false,
  async execute(_args, ctx) {
    ctx.print(c.dim("\nE2E test — use the standalone test suite for full workspace tests."));
    ctx.print(c.dim("This command is reserved for future inline testing.\n"));
  },
};
