import mongoose, { Document } from "mongoose";

/**
 * Agent Role interface - defines runtime agent configuration
 */
export interface AgentRole {
  name: string;
  role: string;
  goal: string;
  systemPrompt?: string;
  tools?: any[];
  mcpClientConfigs?: {};
}

// Define agent document type with teamId
export interface IAgentDocument extends AgentRole, Document {
  teamId: mongoose.Types.ObjectId;
}

// Define agent schema for team members (AgentManager orchestration)
const agentRoleSchema = new mongoose.Schema<IAgentDocument>(
  {
    name: { type: String, required: true, index: true },
    role: { type: String, required: true },
    goal: { type: String, required: true },
    systemPrompt: { type: String, required: true },
    tools: [{ type: mongoose.Schema.Types.Mixed }],
    mcpClientConfigs: { type: mongoose.Schema.Types.Mixed },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamConfig",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Create index for efficient team queries
agentRoleSchema.index({ teamId: 1, name: 1 });

// Create the model - use "AgentRole" to avoid collision with TeamService's "Agent" model
const AgentRoleModel =
  (mongoose.models.AgentRole as mongoose.Model<IAgentDocument>) ||
  mongoose.model<IAgentDocument>("AgentRole", agentRoleSchema);

export { agentRoleSchema, AgentRoleModel };
// Backward compatibility alias
export { AgentRoleModel as AgentModel };
