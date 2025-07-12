import { createAgentNode } from "../createagent/createagent";
import { AgentState } from "../util/state";
import { roleAgentOutputSchema } from "../schema/rolemanageroutputschema";
import { StructuredTool } from "@langchain/core/tools";

export async function roleManagerNode(state: typeof AgentState.State) {
  const Role = "RoleManager";
  const systemMessage =
    "You decide Agent Roles and their features. Deciding a role to an agent will help assigning tasks based on their features. Features are expertise of agents to do tasks because they have knowledge base or tools with their usage expertise. You help the Agent to gain the expertise by adding tools and knowledge base to the Agent.";
  const outputSchema = roleAgentOutputSchema;
  const tools: StructuredTool[] = [];
  return createAgentNode({
    state,
    Role,
    tools,
    systemMessage,
    outputSchema,
  });
}
