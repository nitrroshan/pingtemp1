import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StructuredTool, StructuredToolInterface } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import type { RunnableConfig, Runnable } from "@langchain/core/runnables";
import { AgentState } from "../util/state";
import { RunnableSequence } from "@langchain/core/runnables";
import { StructuredOutputParser } from "langchain/output_parsers";
import { tool } from "@langchain/core/tools";

import { string, z } from "zod";
import { createLLMInstance } from "../../llm/azureopenai";

/**
 * Create an agent that can run a set of tools.
 */
export async function createAgent(props: {
  tools: StructuredTool[];
  systemMessage: string;
  schema?: z.ZodSchema;
}): Promise<Runnable> {
  const { tools, systemMessage, schema } = props;
  const llm: AzureChatOpenAI = createLLMInstance();
  const toolNames = tools.map((tool) => tool.name).join(", ");
  const formattedTools = tools.map((t) => convertToOpenAITool(t));
  let outputParser = undefined;
  if (schema) {
    outputParser = StructuredOutputParser.fromZodSchema(schema);
  }
  const structured_llm = schema ? llm.withStructuredOutput(schema) : llm;
  let prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "{system_message}" +
        " Use the provided tools to progress towards goal" +
        " If you are unable to fully complete the goal, seek help from Manager." +
        " Manager can help you connect to new agents that can help you complete the task " +
        " Comunnicate with other agent using Communication manager. Provide proper context and help you need." +
        " Agents will help where you left off. Execute what you can to make progress." +
        " If you or any of the other assistants have the final answer or deliverable," +
        " prefix your response with FINAL ANSWER so the team knows to stop." +
        " You have access to the following tools: {tool_names}.\n" +
        "Respond only in valid JSON fenced by a markdown code block. Do not return any additional text. .Ensure to follow these format instructions: {format_instructions}\n",
    ],
    new MessagesPlaceholder("messages"),
  ]);
  prompt = await prompt.partial({
    system_message: systemMessage,
    tool_names: toolNames,
    format_instructions: outputParser?.getFormatInstructions() || "",
  });

  const chain = RunnableSequence.from([prompt, structured_llm]);

  return chain;
}

// Helper function to run a node for a given agent
export async function runAgentNode(props: {
  state: typeof AgentState.State;
  agent: Runnable;
  name: string;
  config?: RunnableConfig;
}) {
  const { state, agent, name, config } = props;
  let result = await agent.invoke(state, config);
  // We convert the agent output into a format that is suitable
  // to append to the global state
  if (!result?.tool_calls || result.tool_calls.length === 0) {
    // If the agent is NOT calling a tool, we want it to
    // look like a human message.
    result = new HumanMessage({ ...result, name: name });
  }
  return {
    messages: [result],
    // Since we have a strict workflow, we can
    // track the sender so we know who to pass to next.
    sender: name,
  };
}

export async function createAgentNode(props: {
  state: typeof AgentState.State;
  Role: string;
  tools: StructuredTool[];
  systemMessage: string;
  outputSchema: z.ZodSchema;
}) {
  const { state, Role, tools, systemMessage, outputSchema } = props;
  const roleAgent = await createAgent({
    tools,
    systemMessage: systemMessage,
    schema: outputSchema,
  });
  return runAgentNode({
    state: state,
    agent: roleAgent,
    name: Role,
  });
}
