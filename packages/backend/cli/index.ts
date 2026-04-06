#!/usr/bin/env npx tsx
/**
 * Agent Manager CLI - Interactive Testing Tool
 *
 * A comprehensive CLI for testing the AgentManager orchestration system.
 *
 * Run: npx tsx src/worker/cli/index.ts
 * Or:  npm run cli (add to package.json)
 */

import * as readline from "readline";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { MemoryManager } from "../memory/MemoryManager.js";

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};

const c = {
  success: (s: string) => `${colors.green}${s}${colors.reset}`,
  error: (s: string) => `${colors.red}${s}${colors.reset}`,
  warn: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  info: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  cmd: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  header: (s: string) =>
    `${colors.bright}${colors.bgBlue} ${s} ${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
};

class AgentManagerCLI {
  private mgr: AgentManager | null = null;
  private rl: readline.Interface;
  private initialized = false;
  private teamId = "cli-team";
  private teamRoles = ["backend", "frontend", "qa"];
  private activeTaskId: string | null = null;
  private eventLog: Array<{ time: string; event: string; data: any }> = [];

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle Ctrl+C
    process.on("SIGINT", () => this.exit());
  }

  private print(msg: string) {
    console.log(msg);
  }

  private printBanner() {
    console.clear();
    this.print(`
${c.header("  AGENT MANAGER CLI  ")}

${c.dim("Interactive testing tool for AgentManager orchestration")}
${c.dim("Type 'help' for available commands")}
`);
  }

  private printHelp() {
    this.print(`
${c.header(" COMMANDS ")}

${c.cmd("Setup & Configuration")}
  init [roles]        Initialize orchestrator (default: backend,frontend,qa)
  status              Show current state and metrics
  
${c.cmd("Planning")}
  plan <description>  Create a plan for a task
  showplan            Display pending plan details
  approve             Approve pending plan
  resetplan           Delete current plan (prevents restore on restart)
  
${c.cmd("Task Management")}
  tasks               List all tasks
  task <id>           Show task details
  start <id>          Start executing a task
  chat <message>      Continue conversation with active task
  complete [id]       Mark task as complete
  
${c.cmd("Auto-Approve & Execution")}
  autoapprove [on|off|role]   Configure auto-approve settings
  autoexec [on|off]   Toggle auto-execute mode
  
${c.cmd("Task Operations")}
  discard <id>        Discard a pending task
  modify <id> <desc>  Modify a task description
  stop <id>           Stop an in-progress task
  
${c.cmd("Memory System")}
  memory              Show memory manager stats
  memtasks [role]     List tasks by role from memory
  
${c.cmd("Direct Orchestrator")}
  say <message>       Send message to orchestrator
  
${c.cmd("Testing & Debug")}
  events              Show event log
  run                 Run full E2E test (orchestration + workspace)
  
${c.cmd("Utilities")}  
  clear               Clear screen
  help                Show this help
  exit                Exit CLI

${c.dim("Shortcuts: 'q' = exit, 's' = status, 't' = tasks")}
`);
  }

  private async prompt(): Promise<string> {
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

    return new Promise((resolve) => {
      this.rl.question(`${prefix}${stateColor} > `, (answer) =>
        resolve(answer.trim()),
      );
    });
  }

  private async initialize(rolesStr?: string) {
    if (rolesStr) {
      this.teamRoles = rolesStr.split(",").map((r) => r.trim());
    }

    this.print(c.info(`\nInitializing orchestrator...`));
    this.print(c.dim(`  Team: ${this.teamId}`));
    this.print(c.dim(`  Roles: ${this.teamRoles.join(", ")}`));

    this.mgr = new AgentManager();

    // Setup event handlers
    this.setupEventHandlers();

    await this.mgr.initializeOrchestrator(this.teamId, this.teamRoles);
    this.initialized = true;

    this.print(c.success(`\n✓ Orchestrator initialized`));
    this.print(c.dim(`  State: ${this.mgr.getOrchestratorState()}`));
  }

  private setupEventHandlers() {
    if (!this.mgr) return;

    const logEvent = (event: string, data: any) => {
      this.eventLog.push({
        time: new Date().toISOString().slice(11, 19),
        event,
        data,
      });
      // Keep only last 50 events
      if (this.eventLog.length > 50) this.eventLog.shift();
    };

    this.mgr.registerStreamCallbacks({
      onPlanProposed: (data) => {
        logEvent("plan:proposed", { tasks: data.plan?.tasks?.length });
        this.print(
          c.info(`\n📋 Plan proposed: ${data.plan?.tasks?.length || 0} tasks`),
        );
        if (data.plan?.tasks) {
          for (const t of data.plan.tasks) {
            this.print(c.dim(`   • [${t.assignedRole}] ${t.title}`));
          }
        }
        this.print(c.warn(`\nType 'approve' to approve the plan`));
      },
      onPlanUpdate: (data) => {
        logEvent("plan:approved", { tasksQueued: data.tasksQueued });
        this.print(
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
        this.print(
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

  private requireInit(): boolean {
    if (!this.initialized || !this.mgr) {
      this.print(c.error("Not initialized. Run 'init' first."));
      return false;
    }
    return true;
  }

  private async showStatus() {
    if (!this.requireInit()) return;

    const state = this.mgr!.getOrchestratorState();
    const workflow = this.mgr!.getWorkflowStatus();
    const agents = this.mgr!.getActiveAgents();
    const autoApprove = this.mgr!.getAutoApproveRoles();

    this.print(`
${c.header(" STATUS ")}

${c.cmd("Orchestrator")}
  State:          ${state}
  Auto-Execute:   ${this.mgr!.getAutoExecute() ? c.success("ON") : c.warn("OFF")}
  Auto-Approve:   ${autoApprove.length > 0 ? autoApprove.join(", ") : c.dim("none")}

${c.cmd("Workflow")}
  State:          ${workflow.state}
  Pending Tasks:  ${workflow.pendingTasks}
  Active Tasks:   ${workflow.activeTasks}
  Completed:      ${workflow.completedTasks}
  ${workflow.currentPlan ? `Current Plan:   ${workflow.currentPlan}` : ""}

${c.cmd("Active Agents")} (${agents.length})
${agents.length === 0 ? c.dim("  None") : agents.map((a) => `  • [${a.status}] ${a.role}: ${a.taskId.slice(0, 8)}`).join("\n")}
`);
  }

  private async createPlan(description: string) {
    if (!this.requireInit()) return;

    this.print(c.info(`\nCreating plan for: "${description}"`));
    this.print(c.dim("Thinking...\n"));

    try {
      const response = await this.mgr!.orchestratorMessage(
        `Please create a plan for: ${description}`,
      );
      this.print(`\n${c.cmd("Orchestrator:")}`);
      this.print(response);
    } catch (error) {
      this.print(c.error(`\nError: ${(error as Error).message}`));
    }
  }

  private async approvePlan() {
    if (!this.requireInit()) return;

    if (this.mgr!.getOrchestratorState() !== "awaiting_approval") {
      this.print(c.warn("No pending plan to approve."));
      return;
    }

    this.print(c.info("\nApproving plan..."));
    const result = await this.mgr!.approveOrchestratorPlan();

    if (result.success) {
      this.print(
        c.success(`✓ Plan approved: ${result.tasksQueued} tasks queued`),
      );
      if (result.autoStarted && result.autoStarted > 0) {
        this.print(c.info(`  Auto-started: ${result.autoStarted} tasks`));
      }
    } else {
      this.print(c.error(`✗ Approval failed: ${result.error}`));
    }
  }

  private showPendingPlan() {
    if (!this.requireInit()) return;

    const plan = this.mgr!.getOrchestratorPendingPlan();
    if (!plan) {
      this.print(c.dim("No pending plan."));
      return;
    }

    this.print(`\n${c.header(" PENDING PLAN ")}\n`);
    this.print(`Plan ID: ${plan.planId}`);
    this.print(`Tasks: ${plan.tasks?.length || 0}\n`);

    if (plan.tasks) {
      for (const t of plan.tasks) {
        this.print(`${c.cmd(`[${t.assignedRole}]`)} ${t.title}`);
        this.print(c.dim(`  ${t.description.slice(0, 100)}...`));
        if (t.dependencies?.length > 0) {
          this.print(c.dim(`  Deps: ${t.dependencies.join(", ")}`));
        }
        this.print("");
      }
    }
  }

  private async listTasks() {
    if (!this.requireInit()) return;

    const mm = this.mgr!.getMemoryManager();
    if (!mm) {
      this.print(c.error("MemoryManager not available."));
      return;
    }

    this.print(`\n${c.header(" TASKS ")}\n`);

    const allTasks = mm.getAllTasks();
    if (allTasks.length === 0) {
      this.print(c.dim("No tasks."));
      return;
    }

    const byStatus: Record<string, typeof allTasks> = {};
    for (const task of allTasks) {
      if (!byStatus[task.status]) byStatus[task.status] = [];
      byStatus[task.status]!.push(task);
    }

    const statusOrder = [
      "in_progress",
      "ready",
      "pending",
      "completed",
      "failed",
    ];
    for (const status of statusOrder) {
      const tasks = byStatus[status];
      if (!tasks || tasks.length === 0) continue;

      const icon =
        status === "completed"
          ? "✓"
          : status === "in_progress"
            ? "▶"
            : status === "ready"
              ? "○"
              : status === "failed"
                ? "✗"
                : "•";

      this.print(`${c.cmd(status.toUpperCase())} (${tasks.length})`);
      for (const t of tasks) {
        this.print(
          `  ${icon} ${c.info(t.id.slice(0, 8))} [${t.assigned_role}] ${t.description.slice(0, 50)}...`,
        );
      }
      this.print("");
    }
  }

  private async showTask(taskId: string) {
    if (!this.requireInit()) return;

    const mm = this.mgr!.getMemoryManager();
    if (!mm) {
      this.print(c.error("MemoryManager not available."));
      return;
    }

    // Find task by partial ID match
    const allTasks = mm.getAllTasks();
    const task = allTasks.find(
      (t) => t.id === taskId || t.id.startsWith(taskId),
    );

    if (!task) {
      this.print(c.error(`Task not found: ${taskId}`));
      return;
    }

    this.print(`\n${c.header(" TASK DETAILS ")}\n`);
    this.print(`ID:          ${task.id}`);
    this.print(`Role:        ${task.assigned_role}`);
    this.print(`Status:      ${task.status}`);
    this.print(`Description: ${task.description}`);
    if ((task as any).context) {
      this.print(`\nContext:`);
      this.print(JSON.stringify((task as any).context, null, 2));
    }
    if ((task as any).output_data) {
      this.print(`\nOutput:`);
      const output = (task as any).output_data;
      this.print(
        typeof output === "string"
          ? output.slice(0, 500)
          : JSON.stringify(output, null, 2).slice(0, 500),
      );
    }
  }

  private async startTask(taskId: string) {
    if (!this.requireInit()) return;

    const mm = this.mgr!.getMemoryManager();
    if (!mm) return;

    // Find task by partial ID
    const allTasks = mm.getAllTasks();
    const task = allTasks.find(
      (t) => t.id === taskId || t.id.startsWith(taskId),
    );

    if (!task) {
      this.print(c.error(`Task not found: ${taskId}`));
      return;
    }

    const fullId = task.id;

    try {
      // First approve for chat if needed
      if (task.status === "pending") {
        this.print(c.info("Approving task for chat..."));
        this.mgr!.approveTaskForChat(fullId);
      }

      this.print(c.info(`Starting task: ${fullId.slice(0, 8)}...`));
      const result = await this.mgr!.startTaskExecution(fullId);

      this.activeTaskId = fullId;
      this.print(c.success(`\n✓ Task started`));
      this.print(`\n${c.cmd("Agent Response:")}`);
      this.print(result.response);
      this.print(
        c.dim(`\nUse 'chat <message>' to continue, 'complete' to finish`),
      );
    } catch (error) {
      this.print(c.error(`Error: ${(error as Error).message}`));
    }
  }

  private async continueChat(message: string) {
    if (!this.requireInit()) return;

    if (!this.activeTaskId) {
      this.print(c.warn("No active task. Use 'start <taskId>' first."));
      return;
    }

    try {
      this.print(c.dim("\nAgent thinking...\n"));
      const response = await this.mgr!.continueTask(this.activeTaskId, message);
      this.print(`${c.cmd("Agent:")}`);
      this.print(
        typeof response === "string" ? response : JSON.stringify(response),
      );
    } catch (error) {
      this.print(c.error(`Error: ${(error as Error).message}`));
    }
  }

  private async completeTask(taskId?: string) {
    if (!this.requireInit()) return;

    const id = taskId || this.activeTaskId;
    if (!id) {
      this.print(c.warn("No task specified or active."));
      return;
    }

    try {
      const result = await this.mgr!.completeTaskByUser(id);
      if (result.success) {
        this.print(c.success(`✓ Task completed: ${id.slice(0, 8)}`));
        if (this.activeTaskId === id) {
          this.activeTaskId = null;
        }
      } else {
        this.print(c.error(`Failed: ${result.mergeError}`));
      }
    } catch (error) {
      this.print(c.error(`Error: ${(error as Error).message}`));
    }
  }

  private configureAutoApprove(arg: string) {
    if (!this.requireInit()) return;

    const lower = arg.toLowerCase();
    if (lower === "on" || lower === "true") {
      this.mgr!.setAutoApproveAllRoles(true);
      this.print(c.success("Auto-approve enabled for ALL roles"));
    } else if (lower === "off" || lower === "false") {
      this.mgr!.setAutoApproveAllRoles(false);
      this.print(c.success("Auto-approve disabled"));
    } else if (lower) {
      // Assume it's a role name
      this.mgr!.setAutoApproveForRole(lower, true);
      this.print(c.success(`Auto-approve enabled for role: ${lower}`));
    } else {
      const roles = this.mgr!.getAutoApproveRoles();
      this.print(
        `Auto-approve: ${roles.length > 0 ? roles.join(", ") : c.dim("none")}`,
      );
    }
  }

  private async showMemoryStats() {
    if (!this.requireInit()) return;

    const mm = this.mgr!.getMemoryManager();
    if (!mm) {
      this.print(c.error("MemoryManager not available."));
      return;
    }

    const allTasks = mm.getAllTasks();
    const byStatus = allTasks.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byRole = allTasks.reduce(
      (acc, t) => {
        acc[t.assigned_role] = (acc[t.assigned_role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    this.print(`\n${c.header(" MEMORY STATS ")}\n`);
    this.print(`Total Tasks: ${allTasks.length}`);
    this.print(`\n${c.cmd("By Status:")}`);
    for (const [status, count] of Object.entries(byStatus)) {
      this.print(`  ${status}: ${count}`);
    }
    this.print(`\n${c.cmd("By Role:")}`);
    for (const [role, count] of Object.entries(byRole)) {
      this.print(`  ${role}: ${count}`);
    }
  }

  private async sendToOrchestrator(message: string) {
    if (!this.requireInit()) return;

    this.print(c.dim("\nOrchestrator thinking...\n"));
    try {
      const response = await this.mgr!.orchestratorMessage(message);
      this.print(`${c.cmd("Orchestrator:")}`);
      this.print(response);
      this.print(c.dim(`\n[State: ${this.mgr!.getOrchestratorState()}]`));
    } catch (error) {
      this.print(c.error(`Error: ${(error as Error).message}`));
    }
  }

  private async exit() {
    this.print(c.dim("\nCleaning up..."));
    if (this.mgr) {
      await this.mgr.dispose();
    }
    this.rl.close();
    this.print(c.success("Goodbye!\n"));
    process.exit(0);
  }

  /**
   * Run automated E2E test flow
   */
  private async runE2ETest() {
    this.print(`\n${c.header(" END-TO-END TEST ")}\n`);
    this.print(
      c.dim("This will run through the complete orchestration flow.\n"),
    );

    const steps = [
      { name: "Initialize", fn: () => this.initialize() },
      {
        name: "Create Plan",
        fn: () => this.createPlan("Create a simple hello world API with tests"),
      },
      { name: "Show Plan", fn: () => this.showPendingPlan() },
      { name: "Approve Plan", fn: () => this.approvePlan() },
      { name: "List Tasks", fn: () => this.listTasks() },
      { name: "Show Status", fn: () => this.showStatus() },
      { name: "Memory Stats", fn: () => this.showMemoryStats() },
    ];

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      this.print(`\n${c.info(`[${i + 1}/${steps.length}]`)} ${step.name}...`);

      try {
        await step.fn();
        this.print(c.success(`✓ ${step.name} passed`));
        passed++;
      } catch (error) {
        this.print(
          c.error(`✗ ${step.name} failed: ${(error as Error).message}`),
        );
        failed++;
      }

      // Small delay between steps
      await new Promise((r) => setTimeout(r, 500));
    }

    // Try to start first task and verify workspace
    const mm = this.mgr?.getMemoryManager();
    if (mm) {
      const tasks = mm.getAllTasks();
      if (tasks.length > 0) {
        const taskId = tasks[0]!.id;

        // Step: Verify workspace is enabled
        this.print(
          `\n${c.info("[Workspace]")} Checking workspace is enabled...`,
        );
        try {
          const wsEnabled = this.mgr!.isWorkspaceEnabled();
          if (wsEnabled) {
            this.print(c.success("✓ Workspace support is enabled"));
            passed++;
          } else {
            this.print(
              c.warn(
                "⚠ Workspace not enabled (WORKSPACE_BASE_DIR may not be set)",
              ),
            );
            passed++; // Not a failure — workspace is optional
          }
        } catch (error) {
          this.print(
            c.error(`✗ Workspace check failed: ${(error as Error).message}`),
          );
          failed++;
        }

        // Step: Start task (creates workspace + branch automatically)
        this.print(
          `\n${c.info("[Task]")} Starting first task: ${taskId.slice(0, 8)}...`,
        );
        try {
          await this.startTask(taskId);
          this.print(c.success("✓ Task execution started"));
          passed++;
        } catch (error) {
          this.print(
            c.error(`✗ Task start failed: ${(error as Error).message}`),
          );
          failed++;
        }

        // Step: Verify workspace was created for this task
        this.print(
          `\n${c.info("[Workspace]")} Verifying workspace created for task...`,
        );
        try {
          const workspace = this.mgr!.getTaskWorkspace(taskId);
          if (workspace) {
            this.print(c.success(`✓ Workspace created: ${workspace.id}`));
            this.print(c.dim(`  Branch: ${workspace.branchName}`));
            this.print(c.dim(`  Agent:  ${workspace.agentId}`));
            this.print(c.dim(`  Status: ${workspace.status}`));
            passed++;

            // Verify workspace is active
            if (workspace.status === "active") {
              this.print(c.success("✓ Workspace is active"));
              passed++;
            } else {
              this.print(
                c.warn(
                  `⚠ Workspace status: ${workspace.status} (expected active)`,
                ),
              );
            }

            // Get workspace status with git info
            try {
              const wsStatus = await workspace.getWorkspaceStatus();
              this.print(
                c.dim(
                  `  Uncommitted: ${wsStatus.uncommittedChanges.length} files`,
                ),
              );
              this.print(
                c.dim(
                  `  Activities:  ${wsStatus.activityStats.totalEntries} entries`,
                ),
              );
              this.print(c.success("✓ Workspace status retrieved"));
              passed++;
            } catch (error) {
              this.print(
                c.error(
                  `✗ Workspace status failed: ${(error as Error).message}`,
                ),
              );
              failed++;
            }
          } else {
            this.print(c.dim("  No workspace (workspace may not be enabled)"));
          }
        } catch (error) {
          this.print(
            c.error(
              `✗ Workspace verification failed: ${(error as Error).message}`,
            ),
          );
          failed++;
        }

        // Step: Complete task (triggers merge + cleanup)
        this.print(`\n${c.info("[Task]")} Completing task...`);
        try {
          await this.completeTask();
          this.print(c.success("✓ Task completed (workspace merged)"));
          passed++;

          // Verify workspace is gone after merge
          const wsAfter = this.mgr!.getTaskWorkspace(taskId);
          if (!wsAfter) {
            this.print(c.success("✓ Workspace cleaned up after merge"));
            passed++;
          } else {
            this.print(
              c.dim(`  Workspace still present (status: ${wsAfter.status})`),
            );
          }
        } catch (error) {
          this.print(
            c.error(`✗ Task completion failed: ${(error as Error).message}`),
          );
          failed++;
        }
      }
    }

    this.print(`\n${c.header(" TEST RESULTS ")}`);
    this.print(
      `${c.success(`Passed: ${passed}`)} | ${failed > 0 ? c.error(`Failed: ${failed}`) : c.dim(`Failed: ${failed}`)}`,
    );
    this.print(`\n${c.dim("Event log:")}`);
    for (const e of this.eventLog.slice(-10)) {
      this.print(`  ${c.dim(e.time)} ${e.event}`);
    }
  }

  async run() {
    this.printBanner();
    this.printHelp();

    while (true) {
      const input = await this.prompt();
      if (!input) continue;

      const parts = input.split(" ");
      const cmd = parts[0] || "";
      const args = parts.slice(1);
      const arg = args.join(" ");

      try {
        switch (cmd.toLowerCase()) {
          // Shortcuts
          case "q":
          case "exit":
          case "quit":
            await this.exit();
            break;
          case "s":
          case "status":
            await this.showStatus();
            break;
          case "t":
          case "tasks":
            await this.listTasks();
            break;
          case "h":
          case "help":
          case "?":
            this.printHelp();
            break;
          case "clear":
          case "cls":
            console.clear();
            break;

          // Setup
          case "init":
            await this.initialize(arg || undefined);
            break;

          // Planning
          case "plan":
            if (!arg) {
              this.print(c.warn("Usage: plan <description>"));
            } else {
              await this.createPlan(arg);
            }
            break;
          case "showplan":
            this.showPendingPlan();
            break;
          case "approve":
            await this.approvePlan();
            break;
          case "resetplan":
            if (!this.requireInit()) break;
            try {
              const result = await this.mgr!.resetPlan();
              if (result.deleted) {
                this.print(c.success(`Plan ${result.planId} deleted`));
              } else {
                this.print(c.dim("No active plan to reset"));
              }
              this.activeTaskId = null;
            } catch (e) {
              this.print(c.error(`Error: ${(e as Error).message}`));
            }
            break;

          // Task Management
          case "task":
            if (!arg) {
              this.print(c.warn("Usage: task <id>"));
            } else {
              await this.showTask(arg);
            }
            break;
          case "start":
            if (!arg) {
              this.print(c.warn("Usage: start <taskId>"));
            } else {
              await this.startTask(arg);
            }
            break;
          case "chat":
            if (!arg) {
              this.print(c.warn("Usage: chat <message>"));
            } else {
              await this.continueChat(arg);
            }
            break;
          case "complete":
            await this.completeTask(arg || undefined);
            break;

          // Auto-approve
          case "autoapprove":
          case "aa":
            this.configureAutoApprove(arg);
            break;
          case "autoexec":
          case "ae":
            if (!this.requireInit()) break;
            if (arg.toLowerCase() === "on" || arg.toLowerCase() === "true") {
              this.mgr!.setAutoExecute(true);
              this.print(c.success("Auto-execute ENABLED"));
            } else if (
              arg.toLowerCase() === "off" ||
              arg.toLowerCase() === "false"
            ) {
              this.mgr!.setAutoExecute(false);
              this.print(
                c.success(
                  "Auto-execute DISABLED - tasks wait for manual start",
                ),
              );
            } else {
              this.print(
                `Auto-execute: ${this.mgr!.getAutoExecute() ? c.success("ON") : c.warn("OFF")}`,
              );
            }
            break;

          // Task operations
          case "discard":
            if (!this.requireInit() || !arg) {
              this.print(c.warn("Usage: discard <taskId>"));
              break;
            }
            try {
              this.mgr!.discardTask(arg);
              this.print(c.success(`Task ${arg.slice(0, 8)} discarded`));
            } catch (e) {
              this.print(c.error(`Error: ${(e as Error).message}`));
            }
            break;
          case "modify":
            if (!this.requireInit()) break;
            const modifyParts = arg.split(" ");
            if (modifyParts.length < 2) {
              this.print(c.warn("Usage: modify <taskId> <new description>"));
              break;
            }
            try {
              const taskIdMod = modifyParts[0]!;
              const newDesc = modifyParts.slice(1).join(" ");
              this.mgr!.modifyTask(taskIdMod, { description: newDesc });
              this.print(c.success(`Task ${taskIdMod.slice(0, 8)} modified`));
            } catch (e) {
              this.print(c.error(`Error: ${(e as Error).message}`));
            }
            break;
          case "stop":
            if (!this.requireInit() || !arg) {
              this.print(c.warn("Usage: stop <taskId>"));
              break;
            }
            try {
              await this.mgr!.stopTask(arg);
              this.print(c.success(`Task ${arg.slice(0, 8)} stopped`));
              if (this.activeTaskId === arg) this.activeTaskId = null;
            } catch (e) {
              this.print(c.error(`Error: ${(e as Error).message}`));
            }
            break;

          // Memory
          case "memory":
          case "mem":
            await this.showMemoryStats();
            break;
          case "memtasks":
            if (!this.requireInit()) break;
            const mm = this.mgr!.getMemoryManager();
            if (mm) {
              const tasks = arg ? mm.getTasks(arg) : mm.getAllTasks();
              this.print(`\nTasks${arg ? ` for ${arg}` : ""}:`);
              for (const t of tasks) {
                this.print(
                  `  • [${t.status}] ${t.id.slice(0, 8)} - ${t.description.slice(0, 50)}...`,
                );
              }
            }
            break;

          // Direct orchestrator
          case "say":
            if (!arg) {
              this.print(c.warn("Usage: say <message>"));
            } else {
              await this.sendToOrchestrator(arg);
            }
            break;

          // Testing & Debug
          case "events":
            this.print(
              `\n${c.header(" EVENT LOG ")} (last ${this.eventLog.length})\n`,
            );
            if (this.eventLog.length === 0) {
              this.print(c.dim("No events yet."));
            } else {
              for (const e of this.eventLog.slice(-20)) {
                this.print(
                  `${c.dim(e.time)} ${c.info(e.event)} ${JSON.stringify(e.data)}`,
                );
              }
            }
            break;
          case "run":
            await this.runE2ETest();
            break;
          default:
            // If initialized and not a command, treat as chat to orchestrator
            if (this.initialized && this.mgr) {
              await this.sendToOrchestrator(input);
            } else {
              this.print(
                c.warn(`Unknown command: ${cmd}. Type 'help' for commands.`),
              );
            }
        }
      } catch (error) {
        this.print(c.error(`Error: ${(error as Error).message}`));
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
