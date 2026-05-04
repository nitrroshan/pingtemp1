import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITask extends Document {
  _id: Types.ObjectId;
  taskId: string;
  goalId: string;
  teamId: string;
  title?: string;
  description: string;
  status: string;
  assignedRole: string;
  priority: number;
  output?: any;
  planId?: string;
  dependencies: string[];
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    taskId: { type: String, required: true, index: true },
    goalId: { type: String, required: true, index: true },
    teamId: { type: String, required: true },
    title: { type: String },
    description: { type: String, required: true },
    status: { type: String, required: true, default: "pending" },
    assignedRole: { type: String, required: true },
    priority: { type: Number, default: 3 },
    output: { type: Schema.Types.Mixed },
    planId: { type: String },
    dependencies: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: "tasks",
  },
);

TaskSchema.index({ teamId: 1, status: 1 });
TaskSchema.index({ teamId: 1, goalId: 1, taskId: 1 }, { unique: true });

export const TaskModel = mongoose.model<ITask>("Task", TaskSchema);
