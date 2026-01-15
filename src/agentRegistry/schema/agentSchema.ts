import mongoose from "mongoose";
import type { Agent } from "../types/agent";
import type { AgentCapability } from "../types/agentCapability";

type Vector = Float32Array;
// Define capability schema separately for reusability
const capabilitySchema = new mongoose.Schema<AgentCapability>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    level: {
      type: String,
      enum: ["basic", "intermediate", "advanced"],
      required: true,
    },
  },
  { _id: false } // Disable auto _id for subdocuments
);

// Define main agent schema
const agentSchema = new mongoose.Schema<Agent>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    capabilities: [capabilitySchema],
    status: {
      type: String,
      enum: ["available", "busy", "offline"],
      default: "available",
      required: true,
    },
    embedding: { type: [Number], required: false },
  },
  {
    timestamps: true,
    versionKey: false, // Disable the version key
  }
);

// Create the model
const AgentModel = mongoose.model<Agent>("Agent", agentSchema);

export { agentSchema, AgentModel };
