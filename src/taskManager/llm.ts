// import { AzureOpenAI } from "@langchain/openai";

// export const azureOpenAI = new AzureOpenAI({
//   azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
//   azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_INSTANCE_NAME,
//   azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
//   azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
// });

import { AzureChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import dotenv from "dotenv";
dotenv.config();

export const llm = new AzureChatOpenAI({
  azureOpenAIEndpoint: process.env.Azure_OPENAI_ENDPOINT_URL,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  // azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_INSTANCE_NAME,
  azureOpenAIApiDeploymentName: "gpt-4o",
  azureOpenAIApiVersion: "2025-01-01-preview",
});

export interface AgentCapability {
  name: string;
  description: string;
  level: "basic" | "intermediate" | "advanced";
  parameters?: Record<string, any>;
}

export const taskDecompositionPrompt = PromptTemplate.fromTemplate(
  `  
You are an expert task decomposer. Break down the following task into atomic subtasks:

Task: {task}

Structured Output only in JSON format:
{{
  "subtasks": [
    {{
      "id": "unique_guid_1",
      "description": "Subtask 1 description",
      "dependencies": [unique_guid_2, unique_guid_3], // List of IDs this subtask depends on
      "requiredCapabilities": [
        {{
          "name": "Capability name",
          "description": "Capability description",
          "level": "basic" | "intermediate" | "advanced",
          "parameters": {{}}
        }}
      ],
      "agent_type": "Type of agent required"
    }},
    ...
  ]
}}
  Do not reply with a chat message. Only the JSON Message. Do Not Add \`\`\` at the start or end of the JSON.
`
);

export async function decomposeTask(task: string): Promise<any> {
  const chain = taskDecompositionPrompt.pipe(llm);
  const response = await chain.invoke({ task });
  console.log("Decomposition response:", response);
  return JSON.parse(response.content.toString());
}
