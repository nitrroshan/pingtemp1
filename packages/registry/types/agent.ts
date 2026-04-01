import type { AgentCapability } from "./agentCapability";
export type { AgentCapability } from "./agentCapability";
export interface IAgent {
  id?: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  status: "available" | "busy" | "offline";
  embedding?: Number[];
  mcpEndpoint?: string;
}

export class Agent implements IAgent {
  id?: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  status: "available" | "busy" | "offline";
  embedding?: Number[];
  mcpEndpoint?: string;

  constructor(params: {
    id?: string;
    name: string;
    description: string;
    capabilities: AgentCapability[];
    status: "available" | "busy" | "offline";
    embedding?: Number[];
    mcpEndpoint?: string;
  }) {
    const { id, name, description, capabilities, status, embedding, mcpEndpoint } =
      params;
    this.id = id;
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
