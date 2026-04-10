/**
 * Skill Registry Service
 *
 * Core service for managing skills - CRUD operations and semantic search.
 * Uses MongoDB Atlas Vector Search for similarity matching.
 */

import { rootLogger } from "../../logging/index.js";
import { SkillModel } from "../../services/mongo/schemas/SkillSchema.js";
import { AgentSkillModel } from "../../services/mongo/schemas/AgentSkillSchema.js";
import { generateEmbedding, cosineSimilarity } from "./EmbeddingService.js";
import type { Skill, SkillSource } from "../types/Skill.js";
import type { AgentSkill } from "../types/AgentSkill.js";

const logger = rootLogger.child({ module: "SkillRegistryService" });

/**
 * Search options for finding skills
 */
export interface SkillSearchOptions {
  query?: string | undefined; // Semantic search query
  tags?: string[] | undefined; // Filter by tags
  source?: SkillSource | undefined; // Filter by source
  author?: string | undefined; // Filter by author
  limit?: number | undefined; // Max results (default: 10)
  minRating?: number | undefined; // Minimum rating filter
}

/**
 * Result from semantic search
 */
export interface SkillSearchResult {
  skill: Skill;
  score: number; // Similarity score (0-1)
}

/**
 * Skill Registry Service
 */
export class SkillRegistryService {
  private static instance: SkillRegistryService;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): SkillRegistryService {
    if (!SkillRegistryService.instance) {
      SkillRegistryService.instance = new SkillRegistryService();
    }
    return SkillRegistryService.instance;
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Create a new skill
   */
  async createSkill(
    skillData: Omit<
      Skill,
      | "_id"
      | "createdAt"
      | "updatedAt"
      | "embedding"
      | "installCount"
      | "rating"
      | "sourceUrl"
      | "supportingFiles"
    > & {
      installCount?: number;
      rating?: number;
      sourceUrl?: string;
      supportingFiles?: string[];
    },
  ): Promise<Skill> {
    logger.info(`Creating skill: ${skillData.skillId}`);

    // Generate embedding from description
    const embedding = await generateEmbedding(skillData.description);

    const skill = await SkillModel.create({
      ...skillData,
      embedding,
    });

    logger.info(`Skill created: ${skill.skillId}`);
    return skill.toObject();
  }

  /**
   * Get skill by ID
   */
  async getSkill(skillId: string): Promise<Skill | null> {
    const skill = await SkillModel.findOne({ skillId }).lean();
    return skill;
  }

  /**
   * Get all skills (with optional filters)
   */
  async getAllSkills(
    options: {
      tags?: string[] | undefined;
      source?: SkillSource | undefined;
      author?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    } = {},
  ): Promise<Skill[]> {
    const { tags, source, author, limit = 50, offset = 0 } = options;

    const query: Record<string, unknown> = {};
    if (tags?.length) query.tags = { $in: tags };
    if (source) query.source = source;
    if (author) query.author = author;

    const skills = await SkillModel.find(query)
      .sort({ rating: -1, installCount: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    return skills;
  }

  /**
   * Update a skill
   */
  async updateSkill(
    skillId: string,
    updates: Partial<
      Omit<Skill, "_id" | "skillId" | "createdAt" | "updatedAt">
    >,
  ): Promise<Skill | null> {
    logger.info(`Updating skill: ${skillId}`);

    // If description changed, regenerate embedding
    if (updates.description) {
      updates.embedding = await generateEmbedding(updates.description);
    }

    const skill = await SkillModel.findOneAndUpdate(
      { skillId },
      { $set: updates },
      { new: true },
    ).lean();

    if (skill) {
      logger.info(`Skill updated: ${skillId}`);
    }
    return skill;
  }

  /**
   * Delete a skill
   */
  async deleteSkill(skillId: string): Promise<boolean> {
    logger.info(`Deleting skill: ${skillId}`);

    const result = await SkillModel.deleteOne({ skillId });

    // Also remove any agent assignments
    await AgentSkillModel.deleteMany({ skillId });

    const deleted = result.deletedCount > 0;
    if (deleted) {
      logger.info(`Skill deleted: ${skillId}`);
    }
    return deleted;
  }

  /**
   * Increment install count
   */
  async incrementInstallCount(skillId: string): Promise<void> {
    await SkillModel.updateOne({ skillId }, { $inc: { installCount: 1 } });
  }

  // ============================================
  // Semantic Search
  // ============================================

  /**
   * Search skills using semantic similarity
   *
   * Uses MongoDB Atlas Vector Search if available,
   * falls back to in-memory cosine similarity.
   */
  async searchSkills(
    options: SkillSearchOptions,
  ): Promise<SkillSearchResult[]> {
    const { query, tags, source, author, limit = 10, minRating } = options;

    // If no query, just filter
    if (!query) {
      const skills = await this.getAllSkills({ tags, source, author, limit });
      return skills.map((skill) => ({ skill, score: 1.0 }));
    }

    logger.info(`Searching skills: "${query}"`);

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Try Atlas Vector Search first
    try {
      const results = await this.atlasVectorSearch(queryEmbedding, {
        tags,
        source,
        author,
        limit,
        minRating,
      });

      if (results.length > 0) {
        logger.info(`Atlas Vector Search returned ${results.length} results`);
        return results;
      }
    } catch (error) {
      logger.warn("Atlas Vector Search not available, using fallback");
    }

    // Fallback: in-memory cosine similarity
    return this.fallbackSearch(queryEmbedding, {
      tags,
      source,
      author,
      limit,
      minRating,
    });
  }

  /**
   * Atlas Vector Search (requires index)
   */
  private async atlasVectorSearch(
    queryEmbedding: number[],
    filters: {
      tags?: string[] | undefined;
      source?: SkillSource | undefined;
      author?: string | undefined;
      limit: number;
      minRating?: number | undefined;
    },
  ): Promise<SkillSearchResult[]> {
    const { tags, source, author, limit, minRating } = filters;

    // Build filter for vector search
    const filter: Record<string, unknown> = {};
    if (tags?.length) filter.tags = { $in: tags };
    if (source) filter.source = source;
    if (author) filter.author = author;
    if (minRating) filter.rating = { $gte: minRating };

    // MongoDB Atlas Vector Search aggregation
    const pipeline = [
      {
        $vectorSearch: {
          index: "skill_vector_search",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: limit * 10,
          limit: limit,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        },
      },
      {
        $project: {
          skillId: 1,
          name: 1,
          description: 1,
          version: 1,
          skillPath: 1,
          skillMdPath: 1,
          supportingFiles: 1,
          author: 1,
          source: 1,
          sourceUrl: 1,
          installCount: 1,
          rating: 1,
          tags: 1,
          createdAt: 1,
          updatedAt: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ];

    const results = await SkillModel.aggregate(pipeline);

    return results.map((doc) => ({
      skill: doc as Skill,
      score: doc.score as number,
    }));
  }

  /**
   * Fallback search using in-memory cosine similarity
   */
  private async fallbackSearch(
    queryEmbedding: number[],
    filters: {
      tags?: string[] | undefined;
      source?: SkillSource | undefined;
      author?: string | undefined;
      limit: number;
      minRating?: number | undefined;
    },
  ): Promise<SkillSearchResult[]> {
    const { tags, source, author, limit, minRating } = filters;

    // Build query
    const query: Record<string, unknown> = {};
    if (tags?.length) query.tags = { $in: tags };
    if (source) query.source = source;
    if (author) query.author = author;
    if (minRating) query.rating = { $gte: minRating };

    // Get all matching skills with embeddings
    const skills = await SkillModel.find(query).lean();

    // Calculate similarity scores
    const scored = skills
      .filter((skill) => skill.embedding?.length === 1536)
      .map((skill) => ({
        skill,
        score: cosineSimilarity(queryEmbedding, skill.embedding!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logger.info(`Fallback search returned ${scored.length} results`);
    return scored;
  }

  /**
   * Find similar skills to a given skill
   */
  async findSimilarSkills(
    skillId: string,
    limit: number = 5,
  ): Promise<SkillSearchResult[]> {
    const skill = await this.getSkill(skillId);
    if (!skill?.embedding) {
      return [];
    }

    // Search using the skill's embedding
    const results = await this.fallbackSearch(skill.embedding, {
      limit: limit + 1,
    });

    // Filter out the original skill
    return results.filter((r) => r.skill.skillId !== skillId).slice(0, limit);
  }

  // ============================================
  // Agent Skill Assignments
  // ============================================

  /**
   * Assign a skill to an agent
   */
  async assignSkillToAgent(
    agentId: string,
    skillId: string,
  ): Promise<AgentSkill> {
    logger.info(`Assigning skill ${skillId} to agent ${agentId}`);

    const assignment = await AgentSkillModel.create({
      agentId,
      skillId,
    });

    return assignment.toObject();
  }

  /**
   * Remove skill from agent
   */
  async removeSkillFromAgent(
    agentId: string,
    skillId: string,
  ): Promise<boolean> {
    const result = await AgentSkillModel.deleteOne({ agentId, skillId });
    return result.deletedCount > 0;
  }

  /**
   * Get all skills for an agent
   */
  async getAgentSkills(agentId: string): Promise<Skill[]> {
    const assignments = await AgentSkillModel.find({ agentId }).lean();
    const skillIds = assignments.map((a) => a.skillId);

    if (skillIds.length === 0) {
      return [];
    }

    const skills = await SkillModel.find({ skillId: { $in: skillIds } }).lean();
    return skills;
  }

  /**
   * Get all agents with a specific skill
   */
  async getAgentsWithSkill(skillId: string): Promise<string[]> {
    const assignments = await AgentSkillModel.find({ skillId }).lean();
    return assignments.map((a) => a.agentId);
  }

  /**
   * Find best matching skill for a task description
   */
  async findSkillForTask(
    taskDescription: string,
  ): Promise<SkillSearchResult | null> {
    const results = await this.searchSkills({
      query: taskDescription,
      limit: 1,
    });

    return results[0] || null;
  }

  // ============================================
  // Stats & Utilities
  // ============================================

  /**
   * Get skill statistics
   */
  async getStats(): Promise<{
    totalSkills: number;
    bySource: Record<string, number>;
    byTag: Record<string, number>;
    topRated: Skill[];
    mostInstalled: Skill[];
  }> {
    const totalSkills = await SkillModel.countDocuments();

    // Count by source
    const sourceCounts = await SkillModel.aggregate([
      { $group: { _id: "$source", count: { $sum: 1 } } },
    ]);
    const bySource: Record<string, number> = {};
    sourceCounts.forEach((s) => {
      bySource[s._id] = s.count;
    });

    // Count by tag
    const tagCounts = await SkillModel.aggregate([
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);
    const byTag: Record<string, number> = {};
    tagCounts.forEach((t) => {
      byTag[t._id] = t.count;
    });

    // Top rated
    const topRated = await SkillModel.find({ rating: { $exists: true } })
      .sort({ rating: -1 })
      .limit(5)
      .lean();

    // Most installed
    const mostInstalled = await SkillModel.find()
      .sort({ installCount: -1 })
      .limit(5)
      .lean();

    return {
      totalSkills,
      bySource,
      byTag,
      topRated,
      mostInstalled,
    };
  }
}

// Export singleton accessor
export const skillRegistry = SkillRegistryService.getInstance();
