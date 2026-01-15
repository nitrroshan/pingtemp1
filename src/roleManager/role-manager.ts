import { ServiceRegistry } from "../agentRegistry/agentRegistry";
import { Agent, AgentCapability } from "../../types/agent";
import { AgentAssignment, AgentSuggestion } from "../../types/agent";
import { Task, Subtask } from "../../types/task";
import { Logger } from "tslog";
/*
  RoleManager is responsible for managing agent roles and assignments.
  It handles:
  1) Assigning agents to subtasks based on capabilities.
  2) Tracking agent assignments and statuses.
  3) Suggesting new agents when no suitable ones are available.
  4) Registering and discovering agents in the system.
  It uses the ServiceRegistry to manage agent registrations and capabilities.
*/

const logger = new Logger({ name: "RoleManager" });
export class RoleManager {
  private agentRegistry: ServiceRegistry;
  // private suggestionService: AgentSuggestionService;

  // In-memory assignment tracking
  private assignments: Map<string, AgentAssignment> = new Map();

  constructor(agentRegistry: ServiceRegistry) {
    this.agentRegistry = agentRegistry;
    // this.suggestionService = new AgentSuggestionService();
  }

  /**
   * Assign the best available agent to a subtask
   */
  async assignAgentToSubtask(
    task: Task,
    subtask: Subtask
  ): Promise<AgentAssignment> {
    // 1. Find agents with required capabilities
    const requiredCapabilities = subtask.requiredCapabilities;

    let agents = await this.agentRegistry.discoverAgents(
      requiredCapabilities,
      true
    );

    const numberOfAgentsFound = agents.length;
    const subtaskId = subtask.id;
    const subtaskDescription = subtask.description;
    logger.info(
      `Found ${numberOfAgentsFound} agents for subtask ${subtaskId}: ${subtaskDescription} with capabilities: ${requiredCapabilities.join(
        ", "
      )}`
    );

    // 3. Select the best agent
    let agent = this.selectBestAgent(agents, subtask);

    // 3. If no agents available, get suggestions
    if (agent === undefined || agent.status !== "available") {
      const userAgent: Agent = {
        id: "user-agent",
        name: "User",
        description: "Fallback user agent for manual assignment",
        capabilities: requiredCapabilities,
        status: "available",
        created_at: new Date(),
        last_heartbeat: new Date(),
      };
      agent = userAgent;
      logger.info(
        `No available agents found for subtask ${subtaskId}: ${subtaskDescription}. Assigning to user.`
      );
      return this.createAssignment(task, subtask, userAgent);
      // agents = await this.handleNoAvailableAgents(
      //   subtask,
      //   requiredCapabilities
      // );
    }

    // 5. Create assignment
    return this.createAssignment(task, subtask, agent);
  }

  // /**
  //  * Handle case when no agents are available
  //  */
  // private async handleNoAvailableAgents(
  //   subtask: Subtask,
  //   requiredCapabilities: string[]
  // ): Promise<Agent[]> {
  //   // 1. Get suggestions for new agents
  //   const suggestions = await this.suggestionService.getAgentSuggestions(
  //     subtask.description,
  //     requiredCapabilities
  //   );

  //   // 2. Select best suggestion (in real app, show to user)
  //   const selectedTemplate = this.selectBestSuggestion(suggestions);

  //   // 3. Create new agent
  //   const newAgent = await this.agentRegistry.registerAgent({
  //     name: selectedTemplate.name,
  //     description: selectedTemplate.description,
  //     capabilities: selectedTemplate.capabilities,
  //     metadata: {
  //       source: "dynamic-creation",
  //       template: selectedTemplate.id,
  //     },
  //   });

  //   // 4. Return the new agent
  //   return [newAgent];
  // }

  /**
   * Select the best agent based on multiple factors
   */
  private selectBestAgent(agents: Agent[], subtask: Subtask): Agent {
    // Filter to available agents
    agents = agents.filter((a) => a.status === "available");
    // Get agent suggestions based on subtask capabilities
    return agents[0];
  }

  /**
   * Select the best suggestion
   */
  private selectBestSuggestion(
    suggestions: AgentSuggestion[]
  ): AgentSuggestion {
    // Simple selection strategy - pick first with exact capability match
    return suggestions[0];

    // In real implementation:
    // - Consider creation cost
    // - Estimate initialization time
    // - Match specialization
  }

  /**
   * Create and track new assignment
   */
  private createAssignment(
    task: Task,
    subtask: Subtask,
    agent: Agent
  ): AgentAssignment {
    const assignment: AgentAssignment = {
      id: `assign-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId: task.id,
      subtaskId: subtask.id,
      agentId: agent.id,
      assignedAt: new Date(),
      status: "assigned",
    };

    // Track assignment
    this.assignments.set(assignment.id, assignment);

    // Update agent status
    this.agentRegistry.updateAgentStatus(agent.id, "busy");
    console.log(
      `Assigned agent ${agent.name} (${agent.id}) to subtask ${subtask.id} of task ${task.id}`
    );

    return assignment;
  }

  /**
   * Complete an assignment
   */
  async completeAssignment(assignmentId: string, result: any): Promise<void> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new Error("Assignment not found");

    // Update assignment
    assignment.status = "completed";
    assignment.completedAt = new Date();
    assignment.result = result;

    // Release agent
    await this.agentRegistry.updateAgentStatus(assignment.agentId, "available");

    // // Update agent performance metrics
    // await this.updateAgentPerformance(assignment.agentId, result.success);
  }

  // /**
  //  * Update agent performance metrics
  //  */
  // private async updateAgentPerformance(
  //   agentId: string,
  //   success: boolean
  // ): Promise<void> {
  //   const agent = await this.agentRegistry.getAgentDetails(agentId);
  //   if (!agent) return;

  //   // Initialize metadata if needed
  //   agent.metadata = agent.metadata || {};
  //   agent.metadata.assignmentCount = (agent.metadata.assignmentCount || 0) + 1;
  //   agent.metadata.successCount =
  //     (agent.metadata.successCount || 0) + (success ? 1 : 0);
  //   agent.metadata.successRate =
  //     agent.metadata.successCount / agent.metadata.assignmentCount;

  //   // Update in registry
  //   await this.agentRegistry.updateAgentMetadata(agentId, agent.metadata);
  // }
}
