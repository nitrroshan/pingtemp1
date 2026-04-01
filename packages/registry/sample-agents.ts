import type { IAgent } from "./types/agent";

// Research Agent
export const researchAgent: IAgent = {
  id: "agent-research-001",
  name: "Web Research Specialist",
  description: "Performs in-depth web research on given topics",
  capabilities: [
    {
      name: "web_search",
      description: "Perform web searches",
      level: "advanced",
    },
    {
      name: "summarization",
      description: "Summarize content",
      level: "intermediate",
    },
    {
      name: "data_collection",
      description: "Collect data from sources",
      level: "basic",
    },
  ],
  status: "available",
};

// Coding Agent
export const codingAgent: IAgent = {
  id: "agent-coding-001",
  name: "Full-stack Developer",
  description: "Generates production-ready code for various languages",
  capabilities: [
    {
      name: "javascript",
      description: "JavaScript/TypeScript coding",
      level: "advanced",
    },
    { name: "python", description: "Python scripting", level: "intermediate" },
    { name: "debugging", description: "Code debugging", level: "advanced" },
  ],
  status: "available",
};

// Data Analysis Agent
export const dataAgent: IAgent = {
  id: "agent-data-001",
  name: "Data Analyst",
  description: "Analyzes and visualizes datasets",
  capabilities: [
    {
      name: "data_cleaning",
      description: "Clean and prepare data",
      level: "basic",
    },
    {
      name: "statistical_analysis",
      description: "Perform statistical tests",
      level: "advanced",
    },
    {
      name: "data_visualization",
      description: "Create charts and graphs",
      level: "intermediate",
    },
  ],
  status: "available",
};
