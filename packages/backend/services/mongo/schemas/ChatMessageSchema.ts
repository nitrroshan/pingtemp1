/**
 * ChatMessage schema -- per-agent chat history.
 *
 * Indexes:
 * - teamId + timestamp: team-wide message history
 * - teamId + agentId + timestamp: per-agent conversation
 * - teamId + goalId: messages for a specific goal
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export interface IChatMessage extends Document {
  _id: Types.ObjectId;
  teamId: string;
  agentId: string;
  userId: string;
  goalId?: string;
  taskId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  streamParts?: string;
  agentLayer?: "planner" | "chat-agent" | "worker";
  contextMessages?: string;
  timestamp: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    teamId: { type: String, required: true },
    agentId: { type: String, required: true },
    userId: { type: String, required: true },
    goalId: { type: String, default: null },
    taskId: { type: String, default: null },
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true },
    streamParts: { type: String, default: null },
    agentLayer: { type: String, enum: ["planner", "chat-agent", "worker", null], default: null },
    contextMessages: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// Team-wide: get all messages for a team
chatMessageSchema.index({ teamId: 1, timestamp: -1 });
// Per-agent: get conversation history for a specific agent
chatMessageSchema.index({ teamId: 1, agentId: 1, timestamp: -1 });
// Per-goal: get all messages related to a goal
chatMessageSchema.index({ teamId: 1, goalId: 1, timestamp: -1 });

export const ChatMessageModel =
  (mongoose.models.ChatMessage as mongoose.Model<IChatMessage>) ||
  mongoose.model<IChatMessage>("ChatMessage", chatMessageSchema);
