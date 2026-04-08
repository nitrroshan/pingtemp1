/**
 * ChatMessage — Persists user and assistant messages per team.
 *
 * Messages are saved on send (user) and on stream completion (assistant).
 * Queried by teamId with cursor-based pagination (before timestamp).
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export interface IChatMessage extends Document {
  _id: Types.ObjectId;
  teamId: string;
  sessionId: string;
  role: "user" | "assistant";
  agentId: string;
  taskId?: string;
  content: string;
  timestamp: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    teamId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    agentId: { type: String, required: true },
    taskId: { type: String, default: null },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

chatMessageSchema.index({ teamId: 1, timestamp: -1 });

export const ChatMessageModel =
  (mongoose.models.ChatMessage as mongoose.Model<IChatMessage>) ||
  mongoose.model<IChatMessage>("ChatMessage", chatMessageSchema);
