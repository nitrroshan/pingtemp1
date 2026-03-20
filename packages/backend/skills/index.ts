/**
 * Skill Registry Module
 *
 * Central module for managing agent skills.
 *
 * Features:
 * - CRUD operations for skills
 * - Semantic search using vector embeddings
 * - Agent skill assignments
 * - Official skill registry
 * - Filesystem-based SKILL.md storage
 * - HTTP API for frontend integration
 *
 * Usage:
 * ```typescript
 * import { skillRegistry } from "./skillRegistry";
 *
 * // Search for skills
 * const results = await skillRegistry.searchSkills({
 *   query: "security vulnerabilities",
 *   tags: ["security"],
 *   limit: 5,
 * });
 *
 * // Assign skill to agent
 * await skillRegistry.assignSkillToAgent("agent-1", "security-review");
 *
 * // Find best skill for a task
 * const bestSkill = await skillRegistry.findSkillForTask("Review code for SQL injection");
 * ```
 */

// Services
export {
  SkillRegistryService,
  skillRegistry,
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  readSkillMd,
  readSkillFiles,
  loadSkillWithInstructions,
  writeSkillToFilesystem,
  listLocalSkills,
  getSkillsBaseDir,
  generateSkillTemplate,
} from "./services/index.js";
export type { SkillSearchOptions, SkillSearchResult, SkillFiles } from "./services/index.js";

// Types
export type { Skill, SkillMetadata, SkillWithInstructions, SkillSource } from "./types/index.js";
export type { AgentSkill } from "./types/index.js";

// API
export { skillsRouter } from "./api/index.js";

// Tools (Agent-driven skill loading - Anthropic pattern)
export {
  listAvailableSkills,
  readSkill,
  readSkillFile,
  runSkillScript,
  searchSkills,
  skillTools,
  getSkillTools,
  buildSkillSystemPrompt,
} from "./tools/index.js";

// Integration helpers for AgentWorker
export {
  enhanceAgentWithSkills,
  autoAssignSkillsForRole,
} from "./SkillIntegration.js";
export type { SkillAgentConfig, SkillEnhancedConfig } from "./SkillIntegration.js";

// Models (for direct DB access if needed)
export { SkillModel } from "./schema/skillSchema.js";
export { AgentSkillModel } from "./schema/agentSkillSchema.js";

