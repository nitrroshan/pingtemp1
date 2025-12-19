import { TaskManager } from "./task-manager";
import { RoleManager } from "../roleManager/role-manager";
import { ServiceRegistry } from "../agentRegistry/agentRegistry";
import { Subtask } from "../../types/task";
import { logger } from "../../utils/logger";

import {
  codingAgent,
  researchAgent,
  dataAgent,
} from "../agentRegistry/sample-agents";

// Initialize the agent registry
const agentRegistry = new ServiceRegistry();

// Register sample agents
agentRegistry.registerAgent(codingAgent);
agentRegistry.registerAgent(researchAgent);
agentRegistry.registerAgent(dataAgent);

const taskManager = new TaskManager();
const roleManager = new RoleManager(agentRegistry);

taskManager
  .createTask("Implement a new feature in the application")
  .then(async (task) => {
    logger.info("Task created:", task);
    // Assign agents to subtasks

    // Process subtasks in the
    //Issue in taskManager: Only one subtask is getting processed. New subtasks are not being assigned after the first one.
    while ((await taskManager.isSubtaskQueueEmpty()) == false) {
      const queueItem = await taskManager.getNextSubtask();
      console.log("Processing queue item:", queueItem);
      // Assign the agent to the subtask.
      if (queueItem) {
        const taskId = queueItem.task_id;
        const subtaskId = queueItem.subtask_id;
        const subtask = await taskManager.getSubtaskById(taskId, subtaskId);
        console.log("Subtask found:", subtask);
        if (subtask) {
          const assignment = await roleManager.assignAgentToSubtask(
            task,
            subtask
          );
          console.log("Assigned agent to subtask:", assignment);
          await roleManager.completeAssignment(assignment.id, "success");
          await taskManager.updateSubtaskStatus(
            taskId,
            subtaskId,
            "completed",
            "success"
          );
          console.log(`Subtask ${subtaskId} result success.`);
        } else {
          console.error("Subtask not found for ID:", subtaskId);
        }
      }
    }
    console.log("All subtasks processed.");
  })
  .catch((error) => {
    console.error("Error creating task:", error);
  });
