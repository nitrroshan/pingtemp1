import { createAgentNode } from "../createagent/createagent";
import { StructuredTool } from "@langchain/core/tools";
import { getTools } from "../../mcp/mcp";
import { AgentState } from "../util/state";
import { generatePrompt } from "../prompt/promptgenerator";
import { z } from "zod";
import { roleAgentOutputSchema } from "../schema/rolemanageroutputschema";

//This will be a capabibility of roleManager to create new roles for agents based on their features and expertise.
const createRoleAgent = async (
  Role: string,
  Tools: [],
  state: typeof AgentState.State,
  outputSchema: z.ZodSchema<any>
) => {
  // Get tools with custom configuration
  const tools = (await getTools()) as StructuredTool[];
  const systemMessage = await generatePrompt(
    `Create a prompt to clearly define a ${Role} role that as an Agent it can perform tasks such as writing code, debugging, and collaborating with other agents. The prompt should include the role overview, key responsibilities, best practices, essential skills, behavioral qualities, industry context, performance metrics, challenges and solutions, and an explanatory narrative.`
  );

  // Create and run the agent
  return await createAgentNode({
    state,
    Role,
    tools,
    systemMessage,
    outputSchema: roleAgentOutputSchema,
  });
};
