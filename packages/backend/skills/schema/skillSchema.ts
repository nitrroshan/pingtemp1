import mongoose from "mongoose";
import type { Skill } from "../types/Skill.js";

/**
 * Skills Collection Schema
 *
 * Stores skill metadata and vector embeddings for semantic search.
 * Actual skill content lives in filesystem (SKILL.md files).
 */

const skillSchema = new mongoose.Schema<Skill>(
  {
    skillId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z][a-z0-9-]*[a-z0-9]$/, // lowercase-with-hyphens
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    description: {
      type: String,
      required: true,
      maxlength: 1024, // Limit for embedding
    },
    version: {
      type: String,
      required: true,
      default: "1.0.0",
      match: /^\d+\.\d+\.\d+$/, // Semantic versioning
    },

    // Filesystem paths (content NOT stored in DB)
    skillPath: {
      type: String,
      required: true,
    },
    skillMdPath: {
      type: String,
      required: true,
    },
    supportingFiles: {
      type: [String],
      default: [],
    },

    // Vector embedding for semantic search (1536 dimensions)
    embedding: {
      type: [Number],
      required: false, // Optional until generated
      validate: {
        validator: (v: number[]) => !v || v.length === 1536,
        message: "Embedding must be 1536 dimensions (text-embedding-3-small)",
      },
    },

    // Metadata
    author: {
      type: String,
      required: true,
      default: "ping-official",
    },
    source: {
      type: String,
      required: true,
      enum: ["registry", "github", "local", "personal", "project"],
      default: "registry",
    },
    sourceUrl: {
      type: String,
      required: false,
      validate: {
        validator: (v: string) => !v || /^https?:\/\/.+/.test(v),
        message: "Source URL must be valid HTTP(S) URL",
      },
    },
    installCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    rating: {
      type: Number,
      required: false,
      min: 0.0,
      max: 5.0,
    },
    tags: {
      type: [String],
      default: [],
      lowercase: true,
    },
  },
  {
    timestamps: true, // Adds createdAt, updatedAt
    versionKey: false,
  },
);

// Indexes (skillId unique already defined in schema field)
skillSchema.index({ rating: -1 });
skillSchema.index({ tags: 1 }); // Primary filter (replaces category)
skillSchema.index({ author: 1 });
skillSchema.index({ source: 1 });

// Vector search index (Atlas only - created via Atlas UI or mongosh)
// db.skills.createSearchIndex({
//   name: "skill_vector_search",
//   type: "vectorSearch",
//   definition: {
//     fields: [{
//       type: "vector",
//       path: "embedding",
//       numDimensions: 1536,
//       similarity: "cosine"
//     }]
//   }
// })

// Use existing model if already compiled, otherwise create new
const SkillModel =
  (mongoose.models.Skill as mongoose.Model<Skill>) ||
  mongoose.model<Skill>("Skill", skillSchema);

export { skillSchema, SkillModel };
