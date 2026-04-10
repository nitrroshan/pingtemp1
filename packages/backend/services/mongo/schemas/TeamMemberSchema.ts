/**
 * TeamMember schema — tracks team membership.
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITeamMember extends Document {
  _id: Types.ObjectId;
  teamId: Types.ObjectId;
  userId: string;
  role: "manager" | "employee";
  joinedAt: Date;
}

const teamMemberSchema = new Schema<ITeamMember>(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "TeamConfig",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["manager", "employee"], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
teamMemberSchema.index({ teamId: 1, role: 1 });

export const TeamMemberModel =
  (mongoose.models.TeamMember as mongoose.Model<ITeamMember>) ||
  mongoose.model<ITeamMember>("TeamMember", teamMemberSchema);
