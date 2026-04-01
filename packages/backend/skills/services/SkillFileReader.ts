/**
 * Skill File Reader Service
 *
 * Reads SKILL.md files from the filesystem to load skill instructions.
 * Skills are stored in ~/.ping/skills/<skill-id>/SKILL.md
 */

import { readFile, readdir, stat, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { Logger } from "tslog";
import type { SkillWithInstructions } from "../types/Skill.js";

const logger = new Logger({ name: "SkillFileReader" });

/**
 * Default skills directory
 */
const SKILLS_BASE_DIR = join(homedir(), ".ping", "skills");

/**
 * Skill file structure
 */
export interface SkillFiles {
  skillMd: string; // SKILL.md content
  supportingFiles: Map<string, string>; // filename -> content
}

/**
 * Read a skill's SKILL.md file
 */
export async function readSkillMd(skillPath: string): Promise<string | null> {
  try {
    // Handle both absolute paths and skill IDs
    const fullPath = skillPath.startsWith("~")
      ? skillPath.replace("~", homedir())
      : skillPath.includes("/") || skillPath.includes("\\")
        ? skillPath
        : join(SKILLS_BASE_DIR, skillPath, "SKILL.md");

    const mdPath = fullPath.endsWith("SKILL.md")
      ? fullPath
      : join(fullPath, "SKILL.md");

    if (!existsSync(mdPath)) {
      logger.warn(`SKILL.md not found: ${mdPath}`);
      return null;
    }

    const content = await readFile(mdPath, "utf-8");
    return content;
  } catch (error) {
    logger.error(`Failed to read SKILL.md: ${error}`);
    return null;
  }
}

/**
 * Read all files for a skill (SKILL.md + supporting files)
 */
export async function readSkillFiles(
  skillPath: string,
): Promise<SkillFiles | null> {
  try {
    const basePath = skillPath.startsWith("~")
      ? skillPath.replace("~", homedir())
      : skillPath.includes("/") || skillPath.includes("\\")
        ? skillPath
        : join(SKILLS_BASE_DIR, skillPath);

    const skillDir = basePath.endsWith("SKILL.md")
      ? dirname(basePath)
      : basePath;

    if (!existsSync(skillDir)) {
      logger.warn(`Skill directory not found: ${skillDir}`);
      return null;
    }

    // Read SKILL.md
    const skillMdPath = join(skillDir, "SKILL.md");
    const skillMd = existsSync(skillMdPath)
      ? await readFile(skillMdPath, "utf-8")
      : "";

    // Read supporting files
    const supportingFiles = new Map<string, string>();
    const files = await readdir(skillDir);

    for (const file of files) {
      if (file === "SKILL.md") continue;

      const filePath = join(skillDir, file);
      const fileStat = await stat(filePath);

      // Only read regular files, not directories
      if (fileStat.isFile()) {
        // Only read text-like files
        if (isTextFile(file)) {
          const content = await readFile(filePath, "utf-8");
          supportingFiles.set(file, content);
        }
      }
    }

    return { skillMd, supportingFiles };
  } catch (error) {
    logger.error(`Failed to read skill files: ${error}`);
    return null;
  }
}

/**
 * Parse SKILL.md frontmatter and content
 */
export function parseSkillMd(content: string): {
  frontmatter: Record<string, string>;
  instructions: string;
} {
  const frontmatter: Record<string, string> = {};
  let instructions = content;

  // Check for YAML frontmatter
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      const yamlContent = content.slice(3, endIndex).trim();
      instructions = content.slice(endIndex + 3).trim();

      // Simple YAML parsing (key: value pairs)
      for (const line of yamlContent.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          frontmatter[key] = value;
        }
      }
    }
  }

  return { frontmatter, instructions };
}

/**
 * Load skill with instructions from filesystem
 */
export async function loadSkillWithInstructions(skill: {
  skillId: string;
  skillPath: string;
  skillMdPath: string;
}): Promise<SkillWithInstructions | null> {
  const files = await readSkillFiles(skill.skillPath);
  if (!files) {
    return null;
  }

  const { frontmatter, instructions } = parseSkillMd(files.skillMd);

  return {
    skillId: skill.skillId,
    instructions,
    supportingFiles: files.supportingFiles,
    metadata: frontmatter,
  };
}

/**
 * Write a skill to the filesystem
 */
export async function writeSkillToFilesystem(
  skillId: string,
  skillMd: string,
  supportingFiles?: Map<string, string>,
): Promise<string> {
  const skillDir = join(SKILLS_BASE_DIR, skillId);

  // Create directory
  if (!existsSync(skillDir)) {
    await mkdir(skillDir, { recursive: true });
  }

  // Write SKILL.md
  const skillMdPath = join(skillDir, "SKILL.md");
  await writeFile(skillMdPath, skillMd, "utf-8");

  // Write supporting files
  if (supportingFiles) {
    for (const [filename, content] of supportingFiles) {
      const filePath = join(skillDir, filename);
      await writeFile(filePath, content, "utf-8");
    }
  }

  logger.info(`Skill written to: ${skillDir}`);
  return skillDir;
}

/**
 * List all skills in the skills directory
 */
export async function listLocalSkills(): Promise<string[]> {
  if (!existsSync(SKILLS_BASE_DIR)) {
    return [];
  }

  const entries = await readdir(SKILLS_BASE_DIR, { withFileTypes: true });
  const skillIds: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMdPath = join(SKILLS_BASE_DIR, entry.name, "SKILL.md");
      if (existsSync(skillMdPath)) {
        skillIds.push(entry.name);
      }
    }
  }

  return skillIds;
}

/**
 * Get the skills base directory
 */
export function getSkillsBaseDir(): string {
  return SKILLS_BASE_DIR;
}

/**
 * Check if file is a text file (by extension)
 */
function isTextFile(filename: string): boolean {
  const textExtensions = [
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".py",
    ".sh",
    ".bash",
    ".zsh",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".example",
  ];

  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return textExtensions.includes(ext);
}

/**
 * Generate a template SKILL.md
 */
export function generateSkillTemplate(
  name: string,
  description: string,
): string {
  return `---
name: ${name}
version: 1.0.0
author: user
---

# ${name}

${description}

## Instructions

[Add your skill instructions here]

## Examples

[Add usage examples here]

## Notes

[Add any additional notes here]
`;
}
