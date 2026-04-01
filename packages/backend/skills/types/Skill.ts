/**
 * Skill metadata and configuration type
 */

/**
 * Optional: Common skill categories for reference
 * Use as tags instead of rigid category field: tags: ["security", "code-review"]
 */
export type SkillCategory =
  | "code_analysis"
  | "testing"
  | "documentation"
  | "deployment"
  | "security"
  | "performance"
  | "database"
  | "api"
  | "ui"
  | "devops"
  | "other";

export type SkillSource =
  | "registry"
  | "github"
  | "local"
  | "personal"
  | "project";

/**
 * Skill interface (matches MongoDB schema)
 */
export interface Skill {
  _id?: string; // MongoDB ObjectId (optional for new docs)

  skillId: string; // Unique identifier: "security-review"
  name: string; // Display name: "Security Review"
  description: string; // What & when to use (max 1024 chars, embedded)
  version: string; // "1.0.0"

  // Filesystem paths (NOT content - content lives in SKILL.md)
  skillPath: string; // Path to skill directory
  skillMdPath: string; // Path to SKILL.md file
  supportingFiles?: string[]; // Paths to resources (scripts, docs)

  // Vector embedding (1536 dimensions from text-embedding-3-small)
  embedding?: number[];

  // Metadata
  author: string; // "ping-official" | "community"
  source: SkillSource;
  sourceUrl?: string; // GitHub repo URL
  installCount: number; // Usage tracking
  rating?: number; // 0.0 - 5.0
  tags: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Skill metadata only (Level 1: Discovery phase)
 * Loaded at startup for all skills
 */
export interface SkillMetadata {
  skillId: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[]; // Use tags for filtering: ["security", "code-review", "owasp"]
}

/**
 * Full skill with instructions (Level 2: Activation phase)
 * Loaded when skill is triggered
 */
export interface SkillWithInstructions {
  skillId: string;
  instructions: string; // Markdown body from SKILL.md
  supportingFiles: Map<string, string>; // filename -> content
  metadata?: Record<string, string>; // YAML frontmatter
}
