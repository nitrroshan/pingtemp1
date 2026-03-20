import type { AgentCapability } from "./agentCapability";
export interface IAgent {
  name: string;
  description: string;
  capabilities: AgentCapability[];
  status: "available" | "busy" | "offline";
  embedding: Number[];
  mcpEndpoint: string;
}

export class Agent implements IAgent {
  name: string;
  description: string;
  capabilities: AgentCapability[];
  status: "available" | "busy" | "offline";
  embedding: Number[];
  mcpEndpoint: string;

  constructor(params: {
    id?: string;
    name: string;
    description: string;
    capabilities: AgentCapability[];
    status: "available" | "busy" | "offline";
    embedding: Number[];
    mcpEndpoint: string;
  }) {
    const { name, description, capabilities, status, embedding, mcpEndpoint } =
      params;
    this.name = name;
    this.description = description;
    this.capabilities = capabilities;
    this.status = status;
    this.embedding = embedding;
    this.mcpEndpoint = mcpEndpoint;
  }

  addCapability(capability: AgentCapability): void {
    this.capabilities.push(capability);
  }
}
