/**
 * Skill schema — stores skill metadata and optional vector embeddings.
 */

import mongoose from "mongoose";

export interface ISkill {
  skillId: string;
  name: string;
  description: string;
  version: string;
  skillPath: string;
  skillMdPath: string;
  supportingFiles?: string[];
  embedding?: number[];
  author: string;
  source: "registry" | "github" | "local" | "personal" | "project";
  sourceUrl?: string;
  installCount: number;
  rating?: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const skillSchema = new mongoose.Schema<ISkill>(
  {
    skillId: {
      type: String, required: true, unique: true,
      lowercase: true, trim: true,
      match: /^[a-z][a-z0-9-]*[a-z0-9]$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    description: { type: String, required: true, maxlength: 1024 },
    version: { type: String, required: true, default: "1.0.0", match: /^\d+\.\d+\.\d+$/ },
    skillPath: { type: String, required: true },
    skillMdPath: { type: String, required: true },
    supportingFiles: { type: [String], default: [] },
    embedding: {
      type: [Number], required: false,
      validate: {
        validator: (v: number[]) => !v || v.length === 1536,
        message: "Embedding must be 1536 dimensions",
      },
    },
    author: { type: String, required: true, default: "ping-official" },
    source: {
      type: String, required: true,
      enum: ["registry", "github", "local", "personal", "project"],
      default: "registry",
    },
    sourceUrl: {
      type: String, required: false,
      validate: {
        validator: (v: string) => !v || /^https?:\/\/.+/.test(v),
        message: "Source URL must be valid HTTP(S) URL",
      },
    },
    installCount: { type: Number, default: 0, min: 0 },
    rating: { type: Number, required: false, min: 0.0, max: 5.0 },
    tags: { type: [String], default: [], lowercase: true },
  },
  { timestamps: true, versionKey: false },
);

skillSchema.index({ rating: -1 });
skillSchema.index({ tags: 1 });
skillSchema.index({ author: 1 });
skillSchema.index({ source: 1 });

export const SkillModel =
  (mongoose.models.Skill as mongoose.Model<ISkill>) ||
  mongoose.model<ISkill>("Skill", skillSchema);
