import { StructuredTool } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { Runnable } from "@langchain/core/runnables";
import { AzureChatOpenAI } from "@langchain/openai";
import { createLLMInstance } from "../../llm/azureopenai";
import { StructuredOutputParser } from "langchain/output_parsers";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
/**
 * Create an agent that can run a set of tools.
 */
export async function createAgent(
  systemMessage: string,
  tools?: StructuredTool[],
  schema?: z.ZodSchema
): Promise<Runnable> {
  // const { tools, systemMessage, schema } = props;
  tools ??= [];
  const llm: AzureChatOpenAI = createLLMInstance();
  const toolNames = tools.map((tool) => tool.name).join(", ");
  const formattedTools = tools.map((t) => convertToOpenAITool(t));
  let outputParser = undefined;
  if (schema) {
    outputParser = StructuredOutputParser.fromZodSchema(schema);
  }
  const structured_llm = schema ? llm.withStructuredOutput(schema) : llm;
  // const llmWithTools = structured_llm.bindTools(formattedTools);//not working; find how it works
  let prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "{system_message}" +
        " Use the provided tools to progress towards goal" +
        " If you are unable to fully complete the goal, Execute what you can to make progress." +
        " You have access to the following tools: {tool_names}.\n" +
        "Respond only in valid JSON.Ensure to follow these format instructions: {format_instructions}\n",
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
export const generatePrompt = async (prompt: string) => {
  const systemMessage: string = `
    Given a task description or existing prompt, produce a detailed system prompt to guide a language model in completing the task effectively.

    # Guidelines

    - Understand the Task: Grasp the main objective, goals, requirements, constraints, and expected output.
    - Minimal Changes: If an existing prompt is provided, improve it only if it's simple. For complex prompts, enhance clarity and add missing elements without altering the original structure.
    - Reasoning Before Conclusions**: Encourage reasoning steps before any conclusions are reached. ATTENTION! If the user provides examples where the reasoning happens afterward, REVERSE the order! NEVER START EXAMPLES WITH CONCLUSIONS!
        - Reasoning Order: Call out reasoning portions of the prompt and conclusion parts (specific fields by name). For each, determine the ORDER in which this is done, and whether it needs to be reversed.
        - Conclusion, classifications, or results should ALWAYS appear last.
    - Examples: Include high-quality examples if helpful, using placeholders [in brackets] for complex elements.
      - What kinds of examples may need to be included, how many, and whether they are complex enough to benefit from placeholders.
    - Clarity and Conciseness: Use clear, specific language. Avoid unnecessary instructions or bland statements.
    - Formatting: Use markdown features for readability. DO NOT USE \`\`\` CODE BLOCKS UNLESS SPECIFICALLY REQUESTED.
    - Preserve User Content: If the input task or prompt includes extensive guidelines or examples, preserve them entirely, or as closely as possible. If they are vague, consider breaking down into sub-steps. Keep any details, guidelines, examples, variables, or placeholders provided by the user.
    - Constants: DO include constants in the prompt, as they are not susceptible to prompt injection. Such as guides, rubrics, and examples.
    - Output Format: Explicitly the most appropriate output format, in detail. This should include length and syntax (e.g. short sentence, paragraph, JSON, etc.)
        - For tasks outputting well-defined or structured data (classification, JSON, etc.) bias toward outputting a JSON.
        - JSON should never be wrapped in code blocks (\`\`\`) unless explicitly requested.

    The final prompt you output should adhere to the following structure below. Do not include any additional commentary, only output the completed system prompt. SPECIFICALLY, do not include any additional messages at the start or end of the prompt. (e.g. no "---")

    [Concise instruction describing the task - this should be the first line in the prompt, no section header]

    [Additional details as needed.]

    [Optional sections with headings or bullet points for detailed steps.]

    # Steps [optional]

    [optional: a detailed breakdown of the steps necessary to accomplish the task]

    # Output Format

    [Specifically call out how the output should be formatted, be it response length, structure e.g. JSON, markdown, etc]

    # Tools [optional]
    [optional: Specifically call out tools, list them here with a brief description of their purpose and how they should be used.]

    # Examples [optional]

    [Optional: 1-3 well-defined examples with placeholders if necessary. Clearly mark where examples start and end, and what the input and output are. User placeholders as necessary.]
    [If the examples are shorter than what a realistic example is expected to be, make a reference with () explaining how real examples should be longer / shorter / different. AND USE PLACEHOLDERS! ]

    # Notes [optional]

    [optional: edge cases, details, and an area to call or repeat out specific important considerations]
    `;

  const promptGenAgent = await createAgent(systemMessage);
  return await promptGenAgent.invoke({
    messages: [
      new HumanMessage({
        content: `Task, Goal, or Current Prompt:  ${prompt}`,
      }),
    ],
  });
};

// generatePrompt(
//   "Create a prompt to clearly define a Software Engineer role that as an Agent it can perform tasks such as writing code, debugging, and collaborating with other agents. The prompt should include the role overview, key responsibilities, best practices, essential skills, behavioral qualities, industry context, performance metrics, challenges and solutions, and an explanatory narrative."
// )
//   .then((result) => {
//     console.log("Generated Prompt:", result);
//   })
//   .catch((error) => {
//     console.error("Error generating prompt:", error);
//   });
