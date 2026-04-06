#!/usr/bin/env npx tsx
/**
 * Agent Manager CLI — Interactive Tool
 *
 * Modular CLI with slash commands and per-worker context switching.
 *
 * Run: npx tsx src/worker/cli/index.ts
 * Or:  npm run cli
 *
 * Commands use / prefix: /plan, /tasks, /worker backend, /back
 * Bare text routes to orchestrator or active worker.
 */

import * as readline from "readline";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { CommandRegistry } from "./CommandRegistry.js";
import { c } from "./colors.js";
import type { CommandContext } from "./types.js";

// Commands
import { initCommand, statusCommand } from "./commands/setup.js";
import {
  planCommand,
  showPlanCommand,
  approveCommand,
  resetPlanCommand,
} from "./commands/planning.js";
import {
  tasksCommand,
  taskCommand,
  startCommand,
  chatCommand,
  completeCommand,
  discardCommand,
  modifyCommand,
  stopCommand,
} from "./commands/tasks.js";
import {
  workerCommand,
  backCommand,
  workersCommand,
  workspaceCommand,
} from "./commands/worker.js";
import { autoExecCommand, autoApproveCommand } from "./commands/config.js";
import {
  eventsCommand,
  memoryCommand,
  memTasksCommand,
  sayCommand,
  runCommand,
  eventLog,
} from "./commands/debug.js";
import {
  createHelpCommand,
  clearCommand,
  exitCommand,
} from "./commands/system.js";

class AgentManagerCLI {
  private mgr: AgentManager | null = null;
  private rl: readline.Interface;
  private initialized = false;
  private teamId = "cli-team";
  private teamRoles = ["backend", "frontend", "qa"];
  private activeTaskId: string | null = null;
  private activeWorkerRole: string | null = null;
  private registry: CommandRegistry;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line: string) => this.tabComplete(line),
    });

    // Handle Ctrl+C
    process.on("SIGINT", () => this.exit());

    // Build command registry
    this.registry = new CommandRegistry();
    this.registerCommands();
  }

  private registerCommands() {
    // Setup
    this.registry.register(initCommand);
    this.registry.register(statusCommand);

    // Planning
    this.registry.register(planCommand);
    this.registry.register(showPlanCommand);
    this.registry.register(approveCommand);
    this.registry.register(resetPlanCommand);

    // Tasks
    this.registry.register(tasksCommand);
    this.registry.register(taskCommand);
    this.registry.register(startCommand);
    this.registry.register(chatCommand);
    this.registry.register(completeCommand);
    this.registry.register(discardCommand);
    this.registry.register(modifyCommand);
    this.registry.register(stopCommand);

    // Worker
    this.registry.register(workerCommand);
    this.registry.register(backCommand);
    this.registry.register(workersCommand);
    this.registry.register(workspaceCommand);

    // Config
    this.registry.register(autoExecCommand);
    this.registry.register(autoApproveCommand);

    // Debug
    this.registry.register(eventsCommand);
    this.registry.register(memoryCommand);
    this.registry.register(memTasksCommand);
    this.registry.register(sayCommand);
    this.registry.register(runCommand);

    // System (help needs registry reference)
    this.registry.register(createHelpCommand(this.registry));
    this.registry.register(clearCommand);
    this.registry.register(exitCommand);
  }

  /** Build the context object passed to every command */
  private buildContext(): CommandContext {
    return {
      mgr: this.mgr,
      initialized: this.initialized,
      activeTaskId: this.activeTaskId,
      activeWorkerRole: this.activeWorkerRole,
      teamId: this.teamId,
      teamRoles: this.teamRoles,
      print: (msg: string) => console.log(msg),
      setActiveTask: (id) => {
        this.activeTaskId = id;
      },
      setActiveWorker: (role) => {
        this.activeWorkerRole = role;
      },
      setInitialized: (v) => {
        this.initialized = v;
      },
      setManager: (mgr) => {
        this.mgr = mgr;
        this.setupEventHandlers();
      },
      exit: () => this.exit(),
    };
  }

  /** Tab completion for slash commands */
  private tabComplete(line: string): [string[], string] {
    if (line.startsWith("/")) {
      const completions = this.registry.completions();
      const hits = completions.filter((c) =>
        c.toLowerCase().startsWith(line.toLowerCase()),
      );
      return [hits.length ? hits : completions, line];
    }
    return [[], line];
  }

  private setupEventHandlers() {
    if (!this.mgr) return;

    const logEvent = (event: string, data: any) => {
      eventLog.push({
        time: new Date().toISOString().slice(11, 19),
        event,
        data,
      });
      if (eventLog.length > 50) eventLog.shift();
    };

    this.mgr.registerStreamCallbacks({
      onPlanProposed: (data) => {
        logEvent("plan:proposed", { tasks: data.plan?.tasks?.length });
        console.log(
          c.info(`\n📋 Plan proposed: ${data.plan?.tasks?.length || 0} tasks`),
        );
        if (data.plan?.tasks) {
          for (const t of data.plan.tasks) {
            console.log(c.dim(`   • [${t.assignedRole}] ${t.title}`));
          }
        }
        console.log(c.warn(`\nType /approve to approve the plan`));
      },
      onPlanUpdate: (data) => {
        logEvent("plan:approved", { tasksQueued: data.tasksQueued });
        console.log(
          c.success(`\n✓ Plan approved: ${data.tasksQueued} tasks queued`),
        );
      },
      onTaskUpdate: (data) => {
        logEvent("task:update", {
          taskId: data.taskId?.slice(0, 8),
          status: data.status,
        });
        const icon =
          data.status === "completed"
            ? "✓"
            : data.status === "in_progress"
              ? "▶"
              : "•";
        console.log(
          c.dim(`\n${icon} Task ${data.taskId.slice(0, 8)}: ${data.status}`),
        );
      },
      onEvent: ({ taskId: _taskId, event }) => {
        if ((event as any).type === "message_delta") {
          process.stdout.write((event as any).delta || "");
        }
      },
    });
  }

  /** Render the prompt string */
  private getPrompt(): string {
    if (this.activeWorkerRole) {
      // Worker mode prompt
      const taskBit = this.activeTaskId
        ? c.dim(`[task:${this.activeTaskId.slice(0, 8)}]`)
        : "";
      return `${c.role(this.activeWorkerRole)}${taskBit} » `;
    }

    // Orchestrator mode prompt
    const prefix = this.activeTaskId
      ? c.info(`[task:${this.activeTaskId.slice(0, 8)}]`)
      : "";
    const state = this.mgr?.getOrchestratorState() || "not-init";
    const stateColor =
      state === "awaiting_approval"
        ? c.warn(state)
        : state === "executing"
          ? c.success(state)
          : c.dim(state);

    return `${prefix}${stateColor} > `;
  }

  private async prompt(): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(this.getPrompt(), (answer) => resolve(answer.trim()));
    });
  }

  private printBanner() {
    console.clear();
    console.log(`
${c.header("  AGENT MANAGER CLI  ")}

${c.dim("Interactive tool for AgentManager orchestration")}
${c.dim("Commands use / prefix: /help for list")}
${c.dim("Bare text → orchestrator. /worker <role> → worker CLI.")}
`);
  }

  private async exit() {
    console.log(c.dim("\nCleaning up..."));
    if (this.mgr) {
      await this.mgr.dispose();
    }
    this.rl.close();
    console.log(c.success("Goodbye!\n"));
    process.exit(0);
  }

  async run() {
    this.printBanner();
    // Show help on start
    this.registry.printHelp(this.buildContext());

    while (true) {
      const input = await this.prompt();
      if (!input) continue;

      const ctx = this.buildContext();

      try {
        // Try slash command dispatch first
        if (input.startsWith("/")) {
          const handled = await this.registry.dispatch(input, ctx);
          if (!handled) {
            console.log(
              c.warn(`Unknown command: ${input.split(" ")[0]}. Type /help`),
            );
          }
          continue;
        }

        // Bare text without / — also try as a command for backward compat
        const handled = await this.registry.dispatch(input, ctx);
        if (handled) continue;

        // If in worker mode, send to worker's agent
        if (
          this.activeWorkerRole &&
          this.activeTaskId &&
          this.initialized &&
          this.mgr
        ) {
          try {
            console.log(c.dim("\nAgent thinking...\n"));
            const response = await this.mgr.continueTask(
              this.activeTaskId,
              input,
            );
            console.log(`${c.cmd(`${this.activeWorkerRole}:`)}`);
            console.log(
              typeof response === "string"
                ? response
                : JSON.stringify(response),
            );
          } catch (error) {
            console.log(c.error(`Error: ${(error as Error).message}`));
          }
          continue;
        }

        // If initialized, send to orchestrator
        if (this.initialized && this.mgr) {
          console.log(c.dim("\nOrchestrator thinking...\n"));
          try {
            const response = await this.mgr.orchestratorMessage(input);
            console.log(`${c.cmd("Orchestrator:")}`);
            console.log(response);
            console.log(c.dim(`\n[State: ${this.mgr.getOrchestratorState()}]`));
          } catch (error) {
            console.log(c.error(`Error: ${(error as Error).message}`));
          }
          continue;
        }

        // Not initialized
        console.log(c.warn(`Unknown command. Type /help or /init to start.`));
      } catch (error) {
        console.log(c.error(`Error: ${(error as Error).message}`));
      }
    }
  }
}

// Main
const cli = new AgentManagerCLI();
cli.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
