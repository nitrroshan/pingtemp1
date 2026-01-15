import { AzureChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
dotenv.config();

// export const llm = new AzureChatOpenAI({
//   azureOpenAIEndpoint: process.env.ENDPOINT_URL,
//   azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
//   azureOpenAIApiDeploymentName: "gpt-4o",
//   azureOpenAIApiVersion: "2025-01-01-preview",
// });
export const createLLMInstance = () => {
  return new AzureChatOpenAI({
    azureOpenAIEndpoint: process.env.ENDPOINT_URL,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiDeploymentName: "gpt-4o",
    azureOpenAIApiVersion: "2025-01-01-preview",
  });
};


