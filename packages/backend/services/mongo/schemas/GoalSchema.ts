/**
 * Goal schema — tracks user goals and their execution lifecycle.
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export interface IGoal extends Document {
  _id: Types.ObjectId;
  teamId: string;
  userId: string;
  goal: string;
  goalId?: string;
  status: "pending" | "planning" | "executing" | "completed" | "failed";
  planId?: string;
  result?: string;
  createdAt: Date;
  updatedAt: Date;
}

const goalSchema = new Schema<IGoal>(
  {
    teamId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    goal: { type: String, required: true },
    goalId: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "planning", "executing", "completed", "failed"],
      default: "pending",
    },
    planId: { type: String, default: null },
    result: { type: String, default: null },
  },
  { timestamps: true },
);

goalSchema.index({ teamId: 1, createdAt: -1 });

export const GoalModel =
  (mongoose.models.Goal as mongoose.Model<IGoal>) ||
  mongoose.model<IGoal>("Goal", goalSchema);
