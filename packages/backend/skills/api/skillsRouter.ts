/**
 * Skills API Routes
 *
 * HTTP endpoints for skill management.
 * Mount at /api/skills
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { Logger } from "tslog";
import { skillRegistry } from "../services/SkillRegistryService.js";
import {
  readSkillMd,
  loadSkillWithInstructions,
  writeSkillToFilesystem,
  listLocalSkills,
  generateSkillTemplate,
} from "../services/SkillFileReader.js";
import type { SkillSource } from "../types/Skill.js";

const logger = new Logger({ name: "SkillsAPI" });
const router = Router();

// Helper to safely get param (Express params are always strings when route matches)
const getParam = (
  params: Record<string, string | string[] | undefined>,
  key: string,
): string => {
  const value = params[key];
  if (!value) throw new Error(`Missing required param: ${key}`);
  if (Array.isArray(value)) {
    if (!value[0]) throw new Error(`Missing required param: ${key}`);
    return value[0];
  }
  return value;
};

// ============================================
// Skill CRUD
// ============================================

/**
 * GET /api/skills
 * List all skills with optional filters
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { tags, source, author, limit, offset, query } = req.query;

    // If query provided, use semantic search
    if (query && typeof query === "string") {
      const results = await skillRegistry.searchSkills({
        query,
        tags: tags
          ? ((Array.isArray(tags) ? tags : [tags]) as string[])
          : undefined,
        source: source as SkillSource | undefined,
        author: author as string | undefined,
        limit: limit ? parseInt(limit as string) : 10,
      });

      res.json({
        success: true,
        data: results.map((r) => ({
          ...r.skill,
          score: r.score,
        })),
        count: results.length,
      });
      return;
    }

    // Otherwise, list with filters
    const skills = await skillRegistry.getAllSkills({
      tags: tags
        ? ((Array.isArray(tags) ? tags : [tags]) as string[])
        : undefined,
      source: source as SkillSource | undefined,
      author: author as string | undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });

    res.json({
      success: true,
      data: skills,
      count: skills.length,
    });
  } catch (error: any) {
    logger.error("Failed to list skills:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/skills/search
 * Semantic search for skills
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const { q, tags, source, limit } = req.query;

    if (!q || typeof q !== "string") {
      res.status(400).json({
        success: false,
        error: "Query parameter 'q' is required",
      });
      return;
    }

    const results = await skillRegistry.searchSkills({
      query: q,
      tags: tags
        ? ((Array.isArray(tags) ? tags : [tags]) as string[])
        : undefined,
      source: source as SkillSource | undefined,
      limit: limit ? parseInt(limit as string) : 10,
    });

    res.json({
      success: true,
      data: results.map((r) => ({
        ...r.skill,
        score: r.score,
      })),
      count: results.length,
    });
  } catch (error: any) {
    logger.error("Search failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/skills/stats
 * Get skill statistics
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await skillRegistry.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error("Failed to get stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/skills/local
 * List skills available on local filesystem
 */
router.get("/local", async (_req: Request, res: Response) => {
  try {
    const skillIds = await listLocalSkills();

    res.json({
      success: true,
      data: skillIds,
      count: skillIds.length,
    });
  } catch (error: any) {
    logger.error("Failed to list local skills:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/skills/:skillId
 * Get a skill by ID
 */
router.get("/:skillId", async (req: Request, res: Response) => {
  try {
    const skillId = getParam(req.params, "skillId");
    const { includeInstructions } = req.query;

    const skill = await skillRegistry.getSkill(skillId);

    if (!skill) {
      res.status(404).json({
        success: false,
        error: "Skill not found",
      });
      return;
    }

    // Optionally load instructions from filesystem
    if (includeInstructions === "true") {
      const withInstructions = await loadSkillWithInstructions(skill);
      if (withInstructions) {
        res.json({
          success: true,
          data: {
            ...skill,
            instructions: withInstructions.instructions,
            supportingFiles: Array.from(
              withInstructions.supportingFiles.keys(),
            ),
          },
        });
        return;
      }
    }

    res.json({
      success: true,
      data: skill,
    });
  } catch (error: any) {
    logger.error(`Failed to get skill ${req.params.skillId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/skills/:skillId/instructions
 * Get skill instructions (SKILL.md content)
 */
router.get("/:skillId/instructions", async (req: Request, res: Response) => {
  try {
    const skillId = getParam(req.params, "skillId");

    const skill = await skillRegistry.getSkill(skillId);

    if (!skill) {
      res.status(404).json({
        success: false,
        error: "Skill not found",
      });
      return;
    }

    const instructions = await readSkillMd(skill.skillMdPath);

    if (!instructions) {
      res.status(404).json({
        success: false,
        error: "Instructions not found (SKILL.md missing)",
      });
      return;
    }

    res.json({
      success: true,
      data: {
        skillId,
        instructions,
      },
    });
  } catch (error: any) {
    logger.error(
      `Failed to get instructions for ${req.params.skillId}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/skills/:skillId/similar
 * Find similar skills
 */
router.get("/:skillId/similar", async (req: Request, res: Response) => {
  try {
    const skillId = getParam(req.params, "skillId");
    const { limit } = req.query;

    const results = await skillRegistry.findSimilarSkills(
      skillId,
      limit ? parseInt(limit as string) : 5,
    );

    res.json({
      success: true,
      data: results.map((r) => ({
        ...r.skill,
        score: r.score,
      })),
      count: results.length,
    });
  } catch (error: any) {
    logger.error(
      `Failed to find similar skills for ${req.params.skillId}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/skills
 * Create a new skill
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      skillId,
      name,
      description,
      version,
      tags,
      author,
      source,
      sourceUrl,
      instructions, // Optional: SKILL.md content to write
    } = req.body;

    // Validate required fields
    if (!skillId || !name || !description) {
      res.status(400).json({
        success: false,
        error: "skillId, name, and description are required",
      });
      return;
    }

    // Check if skill already exists
    const existing = await skillRegistry.getSkill(skillId);
    if (existing) {
      res.status(409).json({
        success: false,
        error: "Skill with this ID already exists",
      });
      return;
    }

    // Write SKILL.md to filesystem if instructions provided
    let skillPath: string;
    let skillMdPath: string;

    if (instructions) {
      skillPath = await writeSkillToFilesystem(skillId, instructions);
      skillMdPath = `${skillPath}/SKILL.md`;
    } else {
      // Generate template and write
      const template = generateSkillTemplate(name, description);
      skillPath = await writeSkillToFilesystem(skillId, template);
      skillMdPath = `${skillPath}/SKILL.md`;
    }

    // Create skill in database
    const skill = await skillRegistry.createSkill({
      skillId,
      name,
      description,
      version: version || "1.0.0",
      skillPath,
      skillMdPath,
      tags: tags || [],
      author: author || "user",
      source: source || "local",
      sourceUrl,
    });

    res.status(201).json({
      success: true,
      data: skill,
    });
  } catch (error: any) {
    logger.error("Failed to create skill:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/skills/:skillId
 * Update a skill
 */
router.put("/:skillId", async (req: Request, res: Response) => {
  try {
    const skillId = getParam(req.params, "skillId");
    const updates = req.body;

    // Don't allow changing skillId
    delete updates.skillId;

    const skill = await skillRegistry.updateSkill(skillId, updates);

    if (!skill) {
      res.status(404).json({
        success: false,
        error: "Skill not found",
      });
      return;
    }

    res.json({
      success: true,
      data: skill,
    });
  } catch (error: any) {
    logger.error(`Failed to update skill ${req.params.skillId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/skills/:skillId
 * Delete a skill
 */
router.delete("/:skillId", async (req: Request, res: Response) => {
  try {
    const skillId = getParam(req.params, "skillId");

    const deleted = await skillRegistry.deleteSkill(skillId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: "Skill not found",
      });
      return;
    }

    res.json({
      success: true,
      message: "Skill deleted",
    });
  } catch (error: any) {
    logger.error(`Failed to delete skill ${req.params.skillId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// Agent Skill Assignments
// ============================================

/**
 * GET /api/skills/agent/:agentId
 * Get all skills for an agent
 */
router.get("/agent/:agentId", async (req: Request, res: Response) => {
  try {
    const agentId = getParam(req.params, "agentId");

    const skills = await skillRegistry.getAgentSkills(agentId);

    res.json({
      success: true,
      data: skills,
      count: skills.length,
    });
  } catch (error: any) {
    logger.error(
      `Failed to get skills for agent ${req.params.agentId}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/skills/agent/:agentId/:skillId
 * Assign a skill to an agent
 */
router.post("/agent/:agentId/:skillId", async (req: Request, res: Response) => {
  try {
    const agentId = getParam(req.params, "agentId");
    const skillId = getParam(req.params, "skillId");

    // Check skill exists
    const skill = await skillRegistry.getSkill(skillId);
    if (!skill) {
      res.status(404).json({
        success: false,
        error: "Skill not found",
      });
      return;
    }

    const assignment = await skillRegistry.assignSkillToAgent(agentId, skillId);

    // Increment install count
    await skillRegistry.incrementInstallCount(skillId);

    res.status(201).json({
      success: true,
      data: assignment,
    });
  } catch (error: any) {
    // Handle duplicate assignment
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        error: "Skill already assigned to this agent",
      });
      return;
    }

    logger.error(
      `Failed to assign skill ${req.params.skillId} to agent ${req.params.agentId}:`,
      error,
    );
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/skills/agent/:agentId/:skillId
 * Remove a skill from an agent
 */
router.delete(
  "/agent/:agentId/:skillId",
  async (req: Request, res: Response) => {
    try {
      const agentId = getParam(req.params, "agentId");
      const skillId = getParam(req.params, "skillId");

      const removed = await skillRegistry.removeSkillFromAgent(
        agentId,
        skillId,
      );

      if (!removed) {
        res.status(404).json({
          success: false,
          error: "Assignment not found",
        });
        return;
      }

      res.json({
        success: true,
        message: "Skill removed from agent",
      });
    } catch (error: any) {
      logger.error(
        `Failed to remove skill ${req.params.skillId} from agent ${req.params.agentId}:`,
        error,
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// ============================================
// Task Matching
// ============================================

/**
 * POST /api/skills/match-task
 * Find the best skill for a task description
 */
router.post("/match-task", async (req: Request, res: Response) => {
  try {
    const { taskDescription, limit } = req.body;

    if (!taskDescription) {
      res.status(400).json({
        success: false,
        error: "taskDescription is required",
      });
      return;
    }

    const results = await skillRegistry.searchSkills({
      query: taskDescription,
      limit: limit || 1,
    });

    if (results.length === 0) {
      res.json({
        success: true,
        data: null,
        message: "No matching skill found",
      });
      return;
    }

    res.json({
      success: true,
      data:
        limit === 1 || !limit
          ? { ...results[0]!.skill, score: results[0]!.score }
          : results.map((r) => ({ ...r.skill, score: r.score })),
    });
  } catch (error: any) {
    logger.error("Failed to match task:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
