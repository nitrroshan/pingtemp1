/**
 * AgentManagerV2 Queue Integration Test (Interactive)
 *
 * ⚠️  DEPRECATED: This test uses the legacy RoleTaskQueue flow which is deprecated.
 * Use agentManagerV2.orchestrator.test.ts for the new orchestrator flow with MemoryManager.
 *
 * Tests the complete workflow with TaskQueue integration:
 * - configureWorkflow → createPlan → queueAllPlannedTasks
 * - Approval flow: getPendingApproval → approveTask / skipTask / pickTask
 * - Dependency chain handling
 * - Queue statistics
 *
 * User interacts via command line to approve, skip, or pick tasks.
 */

import { AgentManager } from "./AgentManagerV2.js";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function printSeparator(char = "=", length = 70): void {
  console.log(char.repeat(length));
}

async function testQueueWorkflow(): Promise<void> {
  printSeparator();
  console.log("AgentManagerV2 Queue Integration Test (Interactive)");
  printSeparator();

  const mgr = new AgentManager();

  // Get task from user
  const taskInput = await ask(
    "\nEnter your task description (or press Enter for default): ",
  );
  const task = taskInput || "Build a simple REST API with user authentication";
  console.log(`\nTask: "${task}"\n`);

  try {
    // =========================================================================
    // Step 1: Configure Workflow
    // =========================================================================
    console.log("\n>>> Step 1: Configure Workflow (DefinitionBuilder)");
    console.log("    Discovering roles for your task...\n");
    const agents = await mgr.configureWorkflow(task);
    console.log(`✓ Configured ${agents.length} agents:`);
    for (const agent of agents) {
      console.log(`  - ${agent.role}: ${agent.goal?.slice(0, 60)}...`);
    }

    await ask("\nPress Enter to continue to planning...");

    // =========================================================================
    // Step 2: Create Plan
    // =========================================================================
    console.log("\n>>> Step 2: Create Plan (PlanBuilder)");
    console.log("    Creating execution plan...\n");
    const plan = await mgr.createPlan(task);
    console.log(`✓ Created ${plan.tasks.length} tasks:`);
    for (const t of plan.tasks) {
      const deps =
        t.dependencies.length > 0
          ? ` (deps: ${t.dependencies.join(", ")})`
          : "";
      console.log(
        `  - [${t.id}] ${t.assignedRole}: ${t.title || t.description.slice(0, 40)}${deps}`,
      );
    }
    if (plan.rationale) {
      console.log(`\n  Rationale: ${plan.rationale.slice(0, 150)}...`);
    }

    await ask("\nPress Enter to queue tasks...");

    // =========================================================================
    // Step 3: Queue All Planned Tasks
    // =========================================================================
    console.log("\n>>> Step 3: Queue All Planned Tasks");
    mgr.queueAllPlannedTasks();

    const stats = mgr.getQueueStats();
    console.log(`✓ Queue Stats:`);
    console.log(`  Total pending: ${stats.total}`);
    console.log(`  By role:`, stats.byRole);

    // =========================================================================
    // Step 4: Subscribe to events
    // =========================================================================
    console.log("\n>>> Setting up event listeners...");

    mgr.events.on("worker:event", ({ taskId, event }) => {
      if (event.type === "message_delta") {
        process.stdout.write((event as any).delta || "");
      }
    });

    mgr.events.on("worker:done", ({ taskId }) => {
      console.log(`\n\n✓ Task completed: ${taskId}`);
    });

    mgr.events.on("worker:error", ({ taskId, error }) => {
      console.log(`\n\n✗ Task failed: ${taskId} - ${error}`);
    });

    // =========================================================================
    // Step 5: Interactive Approval Loop
    // =========================================================================
    console.log("\n>>> Starting Interactive Approval Loop");
    printSeparator("-");
    console.log("Commands:");
    console.log("  [a] approve  - Approve next task for a role");
    console.log("  [s] skip     - Skip a task");
    console.log("  [p] pick     - Pick a specific task by ID");
    console.log("  [l] list     - Show pending tasks");
    console.log("  [q] queue    - Show queue stats");
    console.log("  [x] exit     - Exit the test");
    printSeparator("-");

    let running = true;
    while (running) {
      console.log();
      const command = await ask("Command (a/s/p/l/q/x): ");

      switch (command.toLowerCase()) {
        case "a":
        case "approve": {
          // Collect roles with pending tasks
          const rolesWithTasks: Array<{ role: string; task: any }> = [];
          for (const role of mgr.configuredRoles) {
            const pending = mgr.getPendingApproval(role);
            if (pending) {
              rolesWithTasks.push({ role, task: pending });
            }
          }

          if (rolesWithTasks.length === 0) {
            console.log("\nNo pending tasks to approve.");
            break;
          }

          console.log("\nRoles with pending tasks:");
          rolesWithTasks.forEach((r, idx) => {
            console.log(
              `  ${idx + 1}. ${r.role}: [${r.task.id}] ${r.task.description.slice(0, 50)}...`,
            );
          });

          const choice = await ask(
            "\nEnter number to approve (or 'c' to cancel): ",
          );
          if (choice.toLowerCase() === "c" || !choice) {
            console.log("Cancelled.");
            break;
          }

          const index = parseInt(choice) - 1;
          if (isNaN(index) || index < 0 || index >= rolesWithTasks.length) {
            console.log("Invalid selection.");
            break;
          }

          const selected = rolesWithTasks[index];
          if (!selected) {
            console.log("Invalid selection.");
            break;
          }

          const pendingTask = selected.task;
          console.log(`\nApproving task: [${pendingTask.id}]`);
          console.log(`Role: ${selected.role}`);
          console.log(`Description: ${pendingTask.description}`);

          const confirm = await ask("\nConfirm? (y/n): ");
          if (confirm.toLowerCase() === "y") {
            console.log("\n--- Agent Output ---");
            mgr.approveTask(pendingTask.id);

            // Wait for task to complete
            await new Promise<void>((resolve) => {
              const checkDone = setInterval(() => {
                const task = mgr["taskQueue"].getTask(pendingTask.id);
                if (
                  task &&
                  (task.status === "completed" || task.status === "failed")
                ) {
                  clearInterval(checkDone);
                  resolve();
                }
              }, 500);

              // Timeout after 2 minutes
              setTimeout(() => {
                clearInterval(checkDone);
                resolve();
              }, 120000);
            });
            console.log("--- End Output ---\n");
          } else {
            console.log("Cancelled.");
          }
          break;
        }

        case "s":
        case "skip": {
          // Collect all pending tasks
          const pendingTasks: Array<{
            id: string;
            role: string;
            description: string;
          }> = [];
          for (const role of mgr.configuredRoles) {
            const pending = mgr.getPendingApproval(role);
            if (pending) {
              pendingTasks.push({
                id: pending.id,
                role,
                description: pending.description,
              });
            }
          }

          if (pendingTasks.length === 0) {
            console.log("\nNo pending tasks to skip.");
            break;
          }

          console.log("\nPending tasks:");
          pendingTasks.forEach((t, idx) => {
            console.log(
              `  ${idx + 1}. [${t.id}] ${t.role}: ${t.description.slice(0, 50)}...`,
            );
          });

          const choice = await ask(
            "\nEnter number to skip (or 'c' to cancel): ",
          );
          if (choice.toLowerCase() === "c" || !choice) {
            console.log("Cancelled.");
            break;
          }

          const index = parseInt(choice) - 1;
          if (isNaN(index) || index < 0 || index >= pendingTasks.length) {
            console.log("Invalid selection.");
            break;
          }

          const taskToSkip = pendingTasks[index];
          if (!taskToSkip) {
            console.log("Invalid selection.");
            break;
          }

          try {
            mgr.skipTask(taskToSkip.id);
            console.log(
              `✓ Skipped task: [${taskToSkip.id}] ${taskToSkip.role}`,
            );
          } catch (error: any) {
            console.log(`✗ Error: ${error.message}`);
          }
          break;
        }

        case "p":
        case "pick": {
          // Collect all queued tasks
          const queuedTasks: Array<{
            id: string;
            role: string;
            title: string;
            status: string;
          }> = [];
          for (const t of plan.tasks) {
            const queuedTask = mgr["taskQueue"].getTask(t.id);
            const status = queuedTask?.status || "waiting";
            queuedTasks.push({
              id: t.id,
              role: t.assignedRole,
              title: t.title || t.description.slice(0, 30),
              status,
            });
          }

          // Filter to only show queued tasks
          const pickableTasks = queuedTasks.filter(
            (t) => t.status === "queued",
          );

          if (pickableTasks.length === 0) {
            console.log("\nNo queued tasks available to pick.");
            console.log("\nAll tasks status:");
            queuedTasks.forEach((t) => {
              console.log(`  [${t.id}] ${t.role}: ${t.title} (${t.status})`);
            });
            break;
          }

          console.log("\nQueued tasks (available to pick):");
          pickableTasks.forEach((t, idx) => {
            console.log(`  ${idx + 1}. [${t.id}] ${t.role}: ${t.title}`);
          });

          const choice = await ask(
            "\nEnter number to pick (or 'c' to cancel): ",
          );
          if (choice.toLowerCase() === "c" || !choice) {
            console.log("Cancelled.");
            break;
          }

          const index = parseInt(choice) - 1;
          if (isNaN(index) || index < 0 || index >= pickableTasks.length) {
            console.log("Invalid selection.");
            break;
          }

          const selectedTask = pickableTasks[index];
          if (!selectedTask) {
            console.log("Invalid selection.");
            break;
          }

          const taskId = selectedTask.id;
          try {
            console.log(`\nPicking task: [${taskId}] ${selectedTask.role}`);
            console.log("\n--- Agent Output ---");
            mgr.pickTask(taskId);

            // Wait for task to complete
            await new Promise<void>((resolve) => {
              const checkDone = setInterval(() => {
                const task = mgr["taskQueue"].getTask(taskId);
                if (
                  task &&
                  (task.status === "completed" || task.status === "failed")
                ) {
                  clearInterval(checkDone);
                  resolve();
                }
              }, 500);

              // Timeout after 2 minutes
              setTimeout(() => {
                clearInterval(checkDone);
                resolve();
              }, 120000);
            });
            console.log("--- End Output ---\n");
          } catch (error: any) {
            console.log(`✗ Error: ${error.message}`);
          }
          break;
        }

        case "l":
        case "list": {
          console.log("\nPending Tasks by Role:");
          let hasPending = false;
          for (const role of mgr.configuredRoles) {
            const pending = mgr.getPendingApproval(role);
            if (pending) {
              hasPending = true;
              console.log(`  ${role}:`);
              console.log(
                `    [${pending.id}] ${pending.description.slice(0, 60)}...`,
              );
              console.log(
                `    Priority: ${pending.priority}, Status: ${pending.status}`,
              );
            }
          }
          if (!hasPending) {
            console.log("  No pending tasks in queue.");
          }

          console.log("\nAll Tasks Status:");
          for (const t of plan.tasks) {
            const queuedTask = mgr["taskQueue"].getTask(t.id);
            const status = queuedTask?.status || "waiting";
            const deps =
              t.dependencies.length > 0
                ? ` (deps: ${t.dependencies.join(", ")})`
                : "";
            console.log(`  [${t.id}] ${t.assignedRole}: ${status}${deps}`);
          }
          break;
        }

        case "q":
        case "queue": {
          const currentStats = mgr.getQueueStats();
          console.log("\nQueue Statistics:");
          console.log(`  Total pending: ${currentStats.total}`);
          console.log("  By role:");
          for (const [role, count] of Object.entries(currentStats.byRole)) {
            console.log(`    - ${role}: ${count}`);
          }
          break;
        }

        case "x":
        case "exit": {
          running = false;
          console.log("\nExiting...");
          break;
        }

        default:
          console.log("Unknown command. Use: a, s, p, l, q, x");
      }
    }

    // =========================================================================
    // Summary
    // =========================================================================
    printSeparator();
    console.log("Test Summary");
    printSeparator();
    console.log(`  Agents configured: ${agents.length}`);
    console.log(`  Tasks planned: ${plan.tasks.length}`);

    // Count task statuses
    let completed = 0,
      failed = 0,
      pending = 0;
    for (const t of plan.tasks) {
      const queuedTask = mgr["taskQueue"].getTask(t.id);
      if (queuedTask?.status === "completed") completed++;
      else if (queuedTask?.status === "failed") failed++;
      else if (
        queuedTask?.status === "queued" ||
        queuedTask?.status === "in_progress"
      )
        pending++;
    }

    console.log(`  Tasks completed: ${completed}`);
    console.log(`  Tasks failed: ${failed}`);
    console.log(`  Tasks pending: ${pending}`);
    printSeparator();
  } catch (error) {
    console.error("\n✗ Test failed:", error);
    throw error;
  } finally {
    rl.close();
    await mgr.dispose();
    console.log("\n✓ AgentManager disposed");
  }
}

// Run the test
console.log("\nStarting Interactive Queue Test...\n");

testQueueWorkflow()
  .then(() => {
    console.log("\n✓ Test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Test failed:", error);
    process.exit(1);
  });
