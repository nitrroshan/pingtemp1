/**
 * Frontmatter Parser — Splits .md files into YAML frontmatter + body
 *
 * Uses gray-matter for reliable parsing.
 */

import matter from "gray-matter";

export interface ParsedDefinition {
  frontmatter: Record<string, any>;
  body: string;
  raw: string;
}

/**
 * Parse any markdown file with YAML frontmatter.
 * Returns separated frontmatter (as object) and body (as string).
 */
export function parseFrontmatter(content: string): ParsedDefinition {
  const result = matter(content);
  return {
    frontmatter: result.data as Record<string, any>,
    body: result.content.trim(),
    raw: content,
  };
}

/**
 * Parse an agent .md file. Validates required frontmatter fields.
 */
export function parseAgentMd(content: string): ParsedDefinition {
  const parsed = parseFrontmatter(content);
  const required = ["name", "role", "description"];
  const missing = required.filter((f) => !parsed.frontmatter[f]);
  if (missing.length > 0) {
    throw new Error(`Agent .md missing required frontmatter: ${missing.join(", ")}`);
  }
  return parsed;
}

/**
 * Parse a SKILL.md file. Validates required frontmatter fields.
 */
export function parseSkillMd(content: string): ParsedDefinition {
  const parsed = parseFrontmatter(content);
  const required = ["name", "description"];
  const missing = required.filter((f) => !parsed.frontmatter[f]);
  if (missing.length > 0) {
    throw new Error(`SKILL.md missing required frontmatter: ${missing.join(", ")}`);
  }
  return parsed;
}

/**
 * Parse a plugin.json manifest.
 */
export function parsePluginJson(content: string): Record<string, any> {
  const parsed = JSON.parse(content);
  const required = ["name", "description"];
  const missing = required.filter((f) => !parsed[f]);
  if (missing.length > 0) {
    throw new Error(`plugin.json missing required fields: ${missing.join(", ")}`);
  }
  return parsed;
}
