/**
 * Skill Integration for AgentWorker
 *
 * Agent-Driven approach (v1.1) following Anthropic's pattern:
 * - Agent decides when to load skills via tools
 * - No pre-loading into context
 * - Progressive disclosure: metadata → instructions → supporting files → scripts
 *
 * @see https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
 *
 * @example
 * ```typescript
 * import { enhanceAgentWithSkills } from "./skillRegistry";
 *
 * const config = await enhanceAgentWithSkills({
 *   systemPrompt: "You are a helpful assistant.",
 *   tools: [myTool1, myTool2],
 *   preloadMetadata: true, // Optional: include skill list in prompt
 * });
 *
 * const agent = await new Agent(config).initAgent();
 * ```
 */

import { Logger } from "tslog";
import { skillRegistry } from "./services/index.js";
import { getSkillTools, buildSkillSystemPrompt } from "./tools/index.js";
import type { Skill, SkillMetadata } from "./types/Skill.js";

const logger = new Logger({ name: "SkillIntegration" });

/**
 * Configuration for skill-enabled agents
 */
export interface SkillAgentConfig {
  /**
   * Base system prompt (skills section will be appended)
   */
  systemPrompt: string;

  /**
   * Existing tools to combine with skill tools
   */
  tools?: any[];

  /**
   * Optional: Pre-load skill metadata into system prompt
   * - true: Load all available skills
   * - string[]: Load specific skill IDs
   * - false/undefined: No pre-loading (agent discovers via tools)
   */
  preloadMetadata?: boolean | string[];

  /**
   * Optional: Agent ID to filter skills (only show assigned skills)
   */
  agentId?: string | undefined;
}

/**
 * Result of enhancing agent with skills
 */
export interface SkillEnhancedConfig {
  systemPrompt: string;
  tools: any[];
}

/**
 * Enhance an agent configuration with skill tools
 *
 * This adds:
 * 1. Skill tools: `list_available_skills`, `read_skill`, `read_skill_file`, `run_skill_script`
 * 2. Skill awareness section to system prompt
 * 3. Optionally: pre-loaded skill metadata for quick reference
 *
 * @example
 * ```typescript
 * // Minimal - agent discovers skills dynamically
 * const config = await enhanceAgentWithSkills({
 *   systemPrompt: "You are a code reviewer.",
 * });
 *
 * // With metadata pre-loaded (shows available skills in prompt)
 * const config = await enhanceAgentWithSkills({
 *   systemPrompt: "You are a security specialist.",
 *   preloadMetadata: true,
 * });
 *
 * // With specific skills only
 * const config = await enhanceAgentWithSkills({
 *   systemPrompt: "You review code for security.",
 *   preloadMetadata: ["security-review", "code-analysis"],
 * });
 * ```
 */
export async function enhanceAgentWithSkills(
  config: SkillAgentConfig,
): Promise<SkillEnhancedConfig> {
  const { systemPrompt, tools = [], preloadMetadata, agentId } = config;

  logger.info("Enhancing agent with skill tools");

  // Get skill tools
  const skillToolsArray = getSkillTools();
  logger.debug(`Adding ${skillToolsArray.length} skill tools`);

  // Combine tools
  const combinedTools = [...tools, ...skillToolsArray];

  // Build skill section for system prompt
  let skillMetadata: SkillMetadata[] | undefined;

  if (preloadMetadata === true) {
    // Load all skills (or agent's skills if agentId provided)
    if (agentId) {
      logger.debug(`Loading skills for agent: ${agentId}`);
      const agentSkills = await skillRegistry.getAgentSkills(agentId);
      skillMetadata = agentSkills.map((s) => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        version: s.version,
        author: s.author,
        tags: s.tags,
      }));
    } else {
      logger.debug("Loading all available skills");
      const allSkills = await skillRegistry.getAllSkills({ limit: 100 });
      skillMetadata = allSkills.map((s: Skill) => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        version: s.version,
        author: s.author,
        tags: s.tags,
      }));
    }
    logger.info(`Pre-loaded metadata for ${skillMetadata.length} skills`);
  } else if (Array.isArray(preloadMetadata)) {
    // Load specific skills by ID
    logger.debug(`Loading specific skills: ${preloadMetadata.join(", ")}`);
    const skills = await Promise.all(
      preloadMetadata.map((id) => skillRegistry.getSkill(id)),
    );
    skillMetadata = skills
      .filter((s): s is Skill => s !== null)
      .map((s) => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        version: s.version,
        author: s.author,
        tags: s.tags,
      }));
    logger.info(`Pre-loaded metadata for ${skillMetadata.length} skills`);
  }

  // Build enhanced system prompt
  const skillSection = buildSkillSystemPrompt(skillMetadata);
  const enhancedPrompt = `${systemPrompt}\n\n${skillSection}`;

  return {
    systemPrompt: enhancedPrompt,
    tools: combinedTools,
  };
}

/**
 * Auto-assign relevant skills to an agent based on their role description
 *
 * Uses semantic search to find matching skills and assigns them.
 *
 * @param agentId - The agent to assign skills to
 * @param roleDescription - Description of the agent's role/purpose
 * @param maxSkills - Maximum number of skills to assign (default: 3)
 * @returns Array of assigned skills
 */
export async function autoAssignSkillsForRole(
  agentId: string,
  roleDescription: string,
  maxSkills: number = 3,
): Promise<Skill[]> {
  logger.info(`Auto-assigning skills for agent ${agentId}`);
  logger.debug(`Role: "${roleDescription.slice(0, 100)}..."`);

  // Find relevant skills via semantic search
  const results = await skillRegistry.searchSkills({
    query: roleDescription,
    limit: maxSkills,
  });

  const assigned: Skill[] = [];
  const MIN_SCORE = 0.25;

  for (const result of results) {
    if (result.score >= MIN_SCORE) {
      try {
        await skillRegistry.assignSkillToAgent(agentId, result.skill.skillId);
        assigned.push(result.skill);
        logger.info(
          `Assigned "${result.skill.skillId}" (score: ${result.score.toFixed(2)})`,
        );
      } catch (error: any) {
        // Ignore duplicate assignment errors
        if (error.code !== 11000) {
          throw error;
        }
        logger.debug(`Skill "${result.skill.skillId}" already assigned`);
      }
    }
  }

  logger.info(`Assigned ${assigned.length} skills to agent ${agentId}`);
  return assigned;
}

// Re-export tools for convenience
export { getSkillTools, buildSkillSystemPrompt } from "./tools/index.js";
