/**
 * Skill Tools for Agent-Driven Dynamic Loading
 *
 * Following Anthropic's Agent Skills pattern:
 * - Agents decide when to load skills (not pre-loaded)
 * - Progressive disclosure: metadata → instructions → supporting files → code execution
 * - Tools allow agents to navigate skill content dynamically
 *
 * @see https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { rootLogger } from "../../logging/index.js";
import { skillRegistry } from "../services/index.js";
import {
  readSkillMd,
  readSkillFiles,
  parseSkillMd,
  getSkillsBaseDir,
  listLocalSkills,
} from "../services/SkillFileReader.js";
import type { Skill, SkillMetadata } from "../types/Skill.js";

const logger = rootLogger.child({ module: "SkillTools" });
const execAsync = promisify(exec);

/**
 * Script execution timeout (30 seconds)
 */
const SCRIPT_TIMEOUT_MS = 30000;

/**
 * Allowed script extensions for security
 */
const ALLOWED_SCRIPT_EXTENSIONS = [".py", ".js", ".ts", ".sh", ".bash"];

// =============================================================================
// Tool 1: List Available Skills
// =============================================================================

const listAvailableSkillsSchema = z.object({
  category: z
    .string()
    .optional()
    .describe("Optional category filter (e.g., 'security', 'testing')"),
});

/**
 * List all installed skills with their name and description
 * Returns skill metadata only (30-50 tokens each) for context efficiency
 */
export const listAvailableSkills = tool(
  async (input): Promise<string> => {
    logger.info(
      `Listing available skills${input.category ? ` (category: ${input.category})` : ""}`,
    );

    try {
      // Get skills from database (metadata only)
      const skills = await skillRegistry.getAllSkills({ limit: 100 });

      let filtered = skills;
      if (input.category) {
        filtered = skills.filter((s: Skill) =>
          s.tags.includes(input.category!),
        );
      }

      if (filtered.length === 0) {
        return input.category
          ? `No skills found in category "${input.category}". Try listing all skills without a filter.`
          : "No skills are currently installed.";
      }

      // Format as concise list
      const skillList = filtered
        .map((s: Skill) => `• **${s.name}** (${s.skillId}): ${s.description}`)
        .join("\n");

      return `## Available Skills (${filtered.length})\n\n${skillList}\n\nUse \`read_skill\` to load full instructions for any skill.`;
    } catch (error) {
      logger.error("Failed to list skills:", error);
      return `Error listing skills: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "list_available_skills",
    description:
      "List all installed skills with their name and description. Use this to discover which skills are available before loading full instructions. Returns lightweight metadata only.",
    schema: listAvailableSkillsSchema,
  },
);

// =============================================================================
// Tool 2: Read Skill (Full Instructions)
// =============================================================================

const readSkillSchema = z.object({
  skillId: z
    .string()
    .describe("The skill ID to read (e.g., 'security-review')"),
});

/**
 * Read a skill's SKILL.md file to get full instructions
 * This is Level 1 activation - agent loads instructions when needed
 */
export const readSkill = tool(
  async (input): Promise<string> => {
    const { skillId } = input;
    logger.info(`Reading skill: ${skillId}`);

    try {
      // Get skill from database to find path
      const skill = await skillRegistry.getSkill(skillId);

      if (!skill) {
        // Try reading directly from filesystem
        const localSkills = await listLocalSkills();
        if (!localSkills.includes(skillId)) {
          return `Skill "${skillId}" not found. Use \`list_available_skills\` to see available skills.`;
        }
        // Read from default location
        const content = await readSkillMd(skillId);
        if (!content) {
          return `Could not read SKILL.md for "${skillId}".`;
        }
        const { instructions } = parseSkillMd(content);
        return instructions;
      }

      // Read from skill path
      const content = await readSkillMd(skill.skillMdPath);
      if (!content) {
        return `Could not read SKILL.md for "${skillId}" at ${skill.skillMdPath}`;
      }

      const { frontmatter, instructions } = parseSkillMd(content);

      // Include metadata summary
      const metaSummary =
        Object.keys(frontmatter).length > 0
          ? `**Skill:** ${frontmatter.name || skillId} (v${frontmatter.version || "1.0.0"})\n\n`
          : "";

      // List supporting files if any
      const files = await readSkillFiles(skill.skillPath);
      const fileList =
        files && files.supportingFiles.size > 0
          ? `\n\n**Supporting Files:** ${Array.from(files.supportingFiles.keys()).join(", ")}\nUse \`read_skill_file\` to read any of these.`
          : "";

      return `${metaSummary}${instructions}${fileList}`;
    } catch (error) {
      logger.error(`Failed to read skill ${skillId}:`, error);
      return `Error reading skill "${skillId}": ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "read_skill",
    description:
      "Read a skill's SKILL.md file to get full instructions. Use after `list_available_skills` to load detailed guidance for a specific skill. Returns the complete instruction markdown.",
    schema: readSkillSchema,
  },
);

// =============================================================================
// Tool 3: Read Skill File (Supporting Documentation)
// =============================================================================

const readSkillFileSchema = z.object({
  skillId: z.string().describe("The skill ID"),
  filePath: z
    .string()
    .describe(
      "The file path within the skill directory (e.g., 'owasp-rules.md')",
    ),
});

/**
 * Read a supporting file from a skill directory
 * Level 2 deep dive - agent navigates to additional context as needed
 */
export const readSkillFile = tool(
  async (input): Promise<string> => {
    const { skillId, filePath } = input;
    logger.info(`Reading skill file: ${skillId}/${filePath}`);

    try {
      // Get skill from database
      const skill = await skillRegistry.getSkill(skillId);
      const basePath = skill?.skillPath || join(getSkillsBaseDir(), skillId);

      // Security: Prevent path traversal
      const normalizedPath = filePath.replace(/\.\./g, "").replace(/^\//, "");
      const fullPath = join(basePath, normalizedPath);

      // Ensure we're still within the skill directory
      if (!fullPath.startsWith(basePath)) {
        return `Error: Invalid file path. Cannot access files outside the skill directory.`;
      }

      if (!existsSync(fullPath)) {
        // List available files
        const files = await readSkillFiles(basePath);
        if (files && files.supportingFiles.size > 0) {
          const available = Array.from(files.supportingFiles.keys()).join(", ");
          return `File "${filePath}" not found in skill "${skillId}". Available files: ${available}`;
        }
        return `File "${filePath}" not found in skill "${skillId}".`;
      }

      // Read from cached files if available
      const files = await readSkillFiles(basePath);
      if (files?.supportingFiles.has(normalizedPath)) {
        return files.supportingFiles.get(normalizedPath)!;
      }

      // Direct file read
      const { readFile } = await import("fs/promises");
      const content = await readFile(fullPath, "utf-8");
      return content;
    } catch (error) {
      logger.error(`Failed to read skill file ${skillId}/${filePath}:`, error);
      return `Error reading file: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "read_skill_file",
    description:
      "Read a supporting file from a skill directory (documentation, examples, configs). Use after `read_skill` reveals available supporting files. Provide the filename relative to the skill directory.",
    schema: readSkillFileSchema,
  },
);

// =============================================================================
// Tool 4: Run Skill Script (Code Execution)
// =============================================================================

const runSkillScriptSchema = z.object({
  skillId: z.string().describe("The skill ID"),
  scriptPath: z
    .string()
    .describe(
      "The script path within the skill (e.g., 'scripts/run_semgrep.py')",
    ),
  args: z
    .array(z.string())
    .optional()
    .describe("Arguments to pass to the script"),
});

/**
 * Execute a script bundled with a skill
 * Level 3 execution - agent runs code for deterministic operations
 *
 * Security:
 * - Only allowed extensions (.py, .js, .sh, etc.)
 * - Timeout enforcement (30s)
 * - Path traversal prevention
 * - Scripts must be within skill directory
 */
export const runSkillScript = tool(
  async (input): Promise<string> => {
    const { skillId, scriptPath, args = [] } = input;
    logger.info(
      `Running skill script: ${skillId}/${scriptPath} ${args.join(" ")}`,
    );

    try {
      // Get skill from database
      const skill = await skillRegistry.getSkill(skillId);
      const basePath = skill?.skillPath || join(getSkillsBaseDir(), skillId);

      // Security: Prevent path traversal
      const normalizedPath = scriptPath.replace(/\.\./g, "").replace(/^\//, "");
      const fullPath = join(basePath, normalizedPath);

      // Ensure we're still within the skill directory
      if (!fullPath.startsWith(basePath)) {
        return `Error: Invalid script path. Cannot execute scripts outside the skill directory.`;
      }

      // Check file exists
      if (!existsSync(fullPath)) {
        return `Script "${scriptPath}" not found in skill "${skillId}".`;
      }

      // Check allowed extension
      const ext = scriptPath
        .substring(scriptPath.lastIndexOf("."))
        .toLowerCase();
      if (!ALLOWED_SCRIPT_EXTENSIONS.includes(ext)) {
        return `Error: Script type "${ext}" is not allowed. Allowed types: ${ALLOWED_SCRIPT_EXTENSIONS.join(", ")}`;
      }

      // Determine interpreter
      let command: string;
      switch (ext) {
        case ".py":
          command = `python "${fullPath}"`;
          break;
        case ".js":
          command = `node "${fullPath}"`;
          break;
        case ".ts":
          command = `npx tsx "${fullPath}"`;
          break;
        case ".sh":
        case ".bash":
          command = `bash "${fullPath}"`;
          break;
        default:
          return `Error: No interpreter configured for "${ext}" files.`;
      }

      // Add arguments
      if (args.length > 0) {
        const escapedArgs = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`);
        command += " " + escapedArgs.join(" ");
      }

      // Execute with timeout
      logger.debug(`Executing: ${command}`);
      const { stdout, stderr } = await execAsync(command, {
        timeout: SCRIPT_TIMEOUT_MS,
        cwd: basePath,
        env: {
          ...process.env,
          SKILL_DIR: basePath,
          SKILL_ID: skillId,
        },
      });

      // Combine output
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += `\n[stderr]\n${stderr}`;

      // Truncate very long output
      const MAX_OUTPUT_LENGTH = 8000;
      if (output.length > MAX_OUTPUT_LENGTH) {
        output =
          output.substring(0, MAX_OUTPUT_LENGTH) + "\n\n[Output truncated...]";
      }

      return output || "[Script completed with no output]";
    } catch (error: any) {
      logger.error(
        `Failed to run skill script ${skillId}/${scriptPath}:`,
        error,
      );

      // Handle timeout
      if (error.killed) {
        return `Error: Script execution timed out after ${SCRIPT_TIMEOUT_MS / 1000} seconds.`;
      }

      // Handle execution error
      if (error.stderr) {
        return `Script error:\n${error.stderr}`;
      }

      return `Error executing script: ${error.message}`;
    }
  },
  {
    name: "run_skill_script",
    description:
      "Execute a script bundled with a skill (Python, JavaScript, Shell). Use for deterministic operations like code scanning, data processing, or report generation. Scripts run in a sandboxed environment with a 30-second timeout.",
    schema: runSkillScriptSchema,
  },
);

// =============================================================================
// Tool 5: Search Skills (Semantic)
// =============================================================================

const searchSkillsSchema = z.object({
  query: z
    .string()
    .describe(
      "Natural language description of what you need (e.g., 'security vulnerability scanning')",
    ),
  limit: z.number().optional().default(5).describe("Maximum number of results"),
});

/**
 * Semantic search for skills matching a natural language query
 */
export const searchSkills = tool(
  async (input): Promise<string> => {
    const { query, limit = 5 } = input;
    logger.info(`Searching skills: "${query}"`);

    try {
      const results = await skillRegistry.searchSkills({
        query,
        limit,
      });

      if (results.length === 0) {
        return `No skills found matching "${query}". Try a different search term or use \`list_available_skills\` to see all.`;
      }

      const skillList = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.skill.name}** (${r.skill.skillId}) - ${(r.score * 100).toFixed(0)}% match\n   ${r.skill.description}`,
        )
        .join("\n\n");

      return `## Search Results for "${query}"\n\n${skillList}\n\nUse \`read_skill\` to load full instructions.`;
    } catch (error) {
      logger.error("Failed to search skills:", error);
      return `Error searching skills: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "search_skills",
    description:
      "Search for skills using natural language. Returns skills ranked by relevance to your query. Use when you need to find a skill for a specific task.",
    schema: searchSkillsSchema,
  },
);

// =============================================================================
// Export All Tools
// =============================================================================

/**
 * All skill tools for agent use
 */
export const skillTools = [
  listAvailableSkills,
  readSkill,
  readSkillFile,
  runSkillScript,
  searchSkills,
];

/**
 * Get skill tools array for agent initialization
 */
export function getSkillTools() {
  return skillTools;
}

/**
 * Build system prompt section for skill awareness
 *
 * @param installedSkills - Optional pre-loaded skill metadata for the prompt
 * @returns System prompt section describing skill tools
 */
export function buildSkillSystemPrompt(
  installedSkills?: SkillMetadata[],
): string {
  const skillListSection =
    installedSkills && installedSkills.length > 0
      ? `\n### Installed Skills\n${installedSkills
          .map((s) => `- **${s.name}** (${s.skillId}): ${s.description}`)
          .join("\n")}\n`
      : "";

  return `## Skills

You have access to a library of skills that provide specialized knowledge and capabilities.
${skillListSection}
### How to Use Skills

1. **Discover**: Use \`list_available_skills\` or \`search_skills\` to find relevant skills
2. **Load**: Use \`read_skill\` to load full instructions when you need specialized guidance
3. **Deep Dive**: Use \`read_skill_file\` to access supporting documentation
4. **Execute**: Use \`run_skill_script\` to run bundled scripts for deterministic operations

**Important**: Only load skills when needed. Keep context lean by using skills progressively.
`;
}
