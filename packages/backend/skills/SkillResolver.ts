/**
 * SkillResolver — Resolve skill names to AI SDK tool objects
 *
 * Converts skill IDs declared in agent YAML to actual AI SDK `tool()` objects
 * that can be passed to `streamText()`.
 *
 * Supports 3 skill types:
 *   1. Tool skills   — Zod schema + execute function (standard agent tools)
 *   2. MCP skills    — server URL + tool name (fetched via MCP protocol)
 *   3. Instruction skills — append system prompt text only (no tool object)
 *
 * Usage:
 *   const resolver = new SkillResolver();
 *   const tools = await resolver.resolve(['web-search', 'code-analysis']);
 */

import { tool } from "ai";
import { z } from "zod";
import { rootLogger } from "../logging/index.js";
import { skillRegistry } from "./services/index.js";
import { readSkillMd, parseSkillMd } from "./services/SkillFileReader.js";
import type { Skill } from "./types/Skill.js";

const logger = rootLogger.child({ module: "SkillResolver" });

export interface ResolvedSkills {
  /** AI SDK tool objects ready to pass to streamText() */
  tools: Record<string, any>;
  /** System prompt additions from instruction skills */
  systemPromptAdditions: string[];
}

export class SkillResolver {
  /**
   * Resolve an array of skill IDs to AI SDK tool objects.
   *
   * @param skillIds - Array of skill IDs to resolve
   * @returns Object with tools map and any system prompt additions
   */
  async resolve(skillIds: string[]): Promise<ResolvedSkills> {
    if (!skillIds || skillIds.length === 0) {
      return { tools: {}, systemPromptAdditions: [] };
    }

    logger.info(`Resolving ${skillIds.length} skills: ${skillIds.join(", ")}`);

    const tools: Record<string, any> = {};
    const systemPromptAdditions: string[] = [];

    await Promise.all(
      skillIds.map(async (skillId) => {
        try {
          const result = await this.resolveOne(skillId);
          if (result.tool) {
            // Use skillId as the key but sanitized — use a unique prefix if collision risk exists
            const toolKey = `skill_${skillId.replace(/[^a-z0-9]/gi, "_")}`;
            tools[toolKey] = result.tool;
          }
          if (result.systemPromptAddition) {
            systemPromptAdditions.push(result.systemPromptAddition);
          }
        } catch (error: any) {
          logger.warn(`Failed to resolve skill "${skillId}": ${error.message}`);
        }
      }),
    );

    logger.info(
      `Resolved ${Object.keys(tools).length} tool skills, ${systemPromptAdditions.length} instruction skills`,
    );
    return { tools, systemPromptAdditions };
  }

  /**
   * Resolve a single skill by ID.
   */
  private async resolveOne(skillId: string): Promise<{
    tool?: any;
    systemPromptAddition?: string;
  }> {
    // Try database first
    const skill = await skillRegistry.getSkill(skillId);

    if (!skill) {
      logger.warn(`Skill not found in registry: ${skillId}`);
      return {};
    }

    // Read skill content from SKILL.md
    const skillContent = await this.readSkillContent(skill);

    if (!skillContent) {
      return {};
    }

    // Parse the skill type from SKILL.md metadata
    const parsed = parseSkillMd(skillContent);
    const skillType = parsed?.frontmatter?.type || "instruction";

    switch (skillType) {
      case "tool":
        return { tool: this.createToolSkill(skill, skillContent) };

      case "mcp":
        // MCP skills are wired separately — return instruction for now
        logger.debug(`Skill ${skillId} is MCP type, using as instruction`);
        return { systemPromptAddition: this.buildInstructionText(skill, skillContent) };

      case "instruction":
      default:
        return { systemPromptAddition: this.buildInstructionText(skill, skillContent) };
    }
  }

  /**
   * Create an AI SDK tool from a tool-type skill.
   * The tool wraps the skill content as a reference tool.
   */
  private createToolSkill(skill: Skill, content: string): any {
    const description =
      skill.description ||
      `Skill: ${skill.name}. Use this when the task requires ${skill.name}.`;

    // Use any cast for AI SDK version compatibility
    const toolDef: any = {
      description,
      inputSchema: z.object({
        query: z.string().describe("What you need from this skill"),
      }),
      execute: async ({ query }: { query: string }) => {
        return `[Skill: ${skill.name}]\n${content}\n\nQuery: ${query}`;
      },
    };

    return tool(toolDef);
  }

  /**
   * Build system prompt addition text for an instruction skill.
   */
  private buildInstructionText(skill: Skill, content: string): string {
    return `## Skill: ${skill.name}\n${content}`;
  }

  /**
   * Read skill content from file system.
   */
  private async readSkillContent(skill: Skill): Promise<string | null> {
    try {
      const path = skill.skillMdPath || skill.skillId;
      return await readSkillMd(path);
    } catch {
      return null;
    }
  }
}

/** Default singleton */
export const skillResolver = new SkillResolver();

// ─────────────────────────────────────────────────────────────────────────────
// Role-based skill presets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default skill IDs per role type.
 * Agents get these skills if no explicit skills are declared in YAML.
 */
export const ROLE_SKILL_PRESETS: Record<string, string[]> = {
  researcher: ["web-search", "read-url", "summarize"],
  developer: ["code-analysis", "run-command"],
  writer: ["grammar-check", "write-copy"],
  reviewer: ["code-analysis", "security-review"],
  tester: ["code-analysis", "run-command"],
};

/**
 * Get default skills for a role.
 */
export function getDefaultSkillsForRole(role: string): string[] {
  const normalized = role.toLowerCase().split("/").pop() || role;
  for (const [key, skills] of Object.entries(ROLE_SKILL_PRESETS)) {
    if (normalized.includes(key)) {
      return skills;
    }
  }
  return [];
}
