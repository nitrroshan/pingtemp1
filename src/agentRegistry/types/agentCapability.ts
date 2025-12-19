// Extend existing types
export interface IAgentCapability {
  name: string;
  description: string;
  level: "basic" | "intermediate" | "advanced";
}

export class AgentCapability implements IAgentCapability {
  name: string;
  description: string;
  level: "basic" | "intermediate" | "advanced";

  constructor(
    name: string,
    description: string,
    level: "basic" | "intermediate" | "advanced"
  ) {
    this.name = name;
    this.description = description;
    this.level = level;
  }
}
