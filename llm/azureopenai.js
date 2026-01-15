"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLLMInstance = void 0;
const openai_1 = require("@langchain/openai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// export const llm = new AzureChatOpenAI({
//   azureOpenAIEndpoint: process.env.ENDPOINT_URL,
//   azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
//   azureOpenAIApiDeploymentName: "gpt-4o",
//   azureOpenAIApiVersion: "2025-01-01-preview",
// });
const createLLMInstance = () => {
    return new openai_1.AzureChatOpenAI({
        azureOpenAIEndpoint: process.env.ENDPOINT_URL,
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiDeploymentName: "gpt-4o",
        azureOpenAIApiVersion: "2025-01-01-preview",
    });
};
exports.createLLMInstance = createLLMInstance;
