import { StateGraph } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { TaskManager } from "../src/taskManager/task-manager";
import { Subtask, TaskQueueItem } from "../types/task";
import { json } from "stream/consumers";

// Define state structure
interface AgentState {
  subtask: Subtask;
  messages: BaseMessage[];
  result?: any;
}

export class AgentExecutor {
  private taskManager: TaskManager;
  private roleManager: RoleManager;

  constructor(taskManager: TaskManager, roleManager: RoleManager) {
    this.taskManager = taskManager;
    this.roleManager = roleManager;
  }

  async executeSubtask(queueItem: TaskQueueItem): Promise<void> {
    const taskKey = `task:${queueItem.task_id}`;
    const task = await this.taskManager.getTaskFromKey(taskKey);

    if (!task) throw new Error("Task not found");

    const subtask = task.subtasks.find((st) => st.id === queueItem.subtask_id);

    if (!subtask) throw new Error("Subtask not found");

    // Update status to in-progress
    await this.taskManager.updateSubtaskStatus(
      queueItem.task_id,
      queueItem.subtask_id,
      "in-progress"
    );

    try {
      // Get agent capabilities
      const agent = await this.roleManager.getAgent(agentId);
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      // Create workflow based on agent capabilities
      const workflow = this.createWorkflowForAgent(agent);

      // Execute workflow
      const result = await workflow.invoke({
        subtask,
        agent,
        input: subtask.description,
      });
      if (!result) throw new Error("Workflow execution failed");

      // Update with result
      await this.taskManager.updateSubtaskStatus(
        queueItem.task_id,
        queueItem.subtask_id,
        "completed",
        result.result
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error executing subtask ${subtask.id}:`, errorMsg);
      await this.taskManager.updateSubtaskStatus(
        queueItem.task_id,
        queueItem.subtask_id,
        "failed",
        { error: errorMsg }
      );
    }
  }

  private createAgentWorkflow(agentType: string): StateGraph<AgentState> {
    const graph = new StateGraph<AgentState>({
      channels: {
        subtask: { value: null },
        messages: { value: [] },
        result: { value: null },
      },
    });

    // Add nodes based on agent type
    graph.addNode("plan", this.planNode);

    if (agentType === "research") {
      graph.addNode("research", this.researchNode);
      graph.addEdge("plan", "research");
      graph.addEdge("research", END);
    } else if (agentType === "coding") {
      graph.addNode("code", this.codeNode);
      graph.addEdge("plan", "code");
      graph.addEdge("code", END);
    } else {
      graph.addEdge("plan", END);
    }

    graph.setEntryPoint("plan");
    return graph.compile();
  }

  private async planNode(state: AgentState): Promise<Partial<AgentState>> {
    // Use LLM to plan the execution
    return {
      messages: [...state.messages, new SystemMessage("Planning execution...")],
    };
  }

  private async researchNode(state: AgentState): Promise<Partial<AgentState>> {
    // Perform research tasks
    return {
      result: { findings: "Research completed" },
    };
  }

  private async codeNode(state: AgentState): Promise<Partial<AgentState>> {
    // Generate code
    return {
      result: { code: "// Generated code here" },
    };
  }
}
