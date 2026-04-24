/**
 * PromptLoader — Load and assemble system prompts from XML files
 *
 * Prompts are stored as XML files in agent/prompts/<agentId>/.
 * XML tags make injected sections visible to developers:
 * - <planner-identity> — who the agent is
 * - <cognitive-workflow> — step-by-step behavior
 * - <team-config> — INJECTED AT RUNTIME (team roles, ID)
 * - <rules> — constraints and guardrails
 *
 * Usage:
 *   const prompt = PromptLoader.load('planner', { teamId, teamRoles });
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PromptLoader {
  private static promptsDir = path.resolve(__dirname, "../agent/prompts");

  /**
   * Load and assemble a system prompt from XML files.
   * @param agentId - Agent folder name (e.g., 'planner')
   * @param variables - Template variables to inject (e.g., { teamId, teamRoles })
   */
  static load(agentId: string, variables?: Record<string, string>): string {
    const agentDir = path.join(this.promptsDir, agentId);

    if (!fs.existsSync(agentDir)) {
      throw new Error(`Prompt directory not found: ${agentDir}`);
    }

    // Load base system prompt
    const systemFile = path.join(agentDir, "system.xml");
    if (!fs.existsSync(systemFile)) {
      throw new Error(`System prompt not found: ${systemFile}`);
    }
    let prompt = fs.readFileSync(systemFile, "utf-8");

    // Load and append runtime injection files (e.g., team-config.xml)
    const files = fs.readdirSync(agentDir).filter(
      (f) => f.endsWith(".xml") && f !== "system.xml",
    );

    for (const file of files) {
      const content = fs.readFileSync(path.join(agentDir, file), "utf-8");
      prompt += "\n\n" + content;
    }

    // Replace template variables: {{variableName}} → value
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }
    }

    // Strip XML comments (<!-- ... -->) — they're for developers, not the LLM
    prompt = prompt.replace(/<!--[\s\S]*?-->/g, "").trim();

    return prompt;
  }

  /**
   * Check if an agent has prompt files.
   */
  static has(agentId: string): boolean {
    const agentDir = path.join(this.promptsDir, agentId);
    return fs.existsSync(path.join(agentDir, "system.xml"));
  }

  /**
   * Load a single XML file from an agent's prompt directory.
   * Unlike load(), this does NOT auto-append other XML files in the folder.
   * @param agentId - Agent folder name (e.g., 'planner')
   * @param fileName - Specific XML file to load (e.g., 'team-config-fallback.xml')
   * @param variables - Template variables to inject
   */
  static loadFile(agentId: string, fileName: string, variables?: Record<string, string>): string {
    const filePath = path.join(this.promptsDir, agentId, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }

    let content = fs.readFileSync(filePath, "utf-8");

    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }
    }

    content = content.replace(/<!--[\s\S]*?-->/g, "").trim();
    return content;
  }

  /**
   * Load a named template from an XML file containing <template id="..."> elements.
   * Used for notification messages and other named snippets.
   *
   * Looks for templates in all XML files within the agent's prompt directory.
   * Falls back to returning "[templateId]" if not found (graceful degradation).
   *
   * @param agentId - Agent folder name (e.g., 'orchestrator')
   * @param templateId - Template ID to extract (e.g., 'task-created')
   * @param variables - Template variables to inject
   */
  static loadTemplate(agentId: string, templateId: string, variables?: Record<string, string>): string {
    const agentDir = path.join(this.promptsDir, agentId);

    if (!fs.existsSync(agentDir)) {
      console.warn(`[PromptLoader] Template directory not found: ${agentDir}, using fallback for "${templateId}"`);
      return `[${templateId}]`;
    }

    // Search all XML files in the directory for the template
    const files = fs.readdirSync(agentDir).filter((f) => f.endsWith(".xml"));

    for (const file of files) {
      const content = fs.readFileSync(path.join(agentDir, file), "utf-8");

      // Extract <template id="templateId">...</template>
      const regex = new RegExp(
        `<template\\s+id=["']${templateId}["']\\s*>([\\s\\S]*?)</template>`,
      );
      const match = content.match(regex);

      if (match && match[1]) {
        let template = match[1].trim();

        if (variables) {
          for (const [key, value] of Object.entries(variables)) {
            template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
          }
        }

        template = template.replace(/<!--[\s\S]*?-->/g, "").trim();
        return template;
      }
    }

    console.warn(`[PromptLoader] Template "${templateId}" not found in ${agentDir}, using fallback`);
    return `[${templateId}]`;
  }

  /**
   * Load structured definitions from an XML file.
   * Parses elements matching `<tagName name="..." [tools="..."]>description</tagName>`
   * into typed objects using the provided parser function.
   *
   * @param agentId - Agent folder name (e.g., 'worker')
   * @param fileName - XML file to read (e.g., 'capabilities.xml')
   * @param tagName - Element tag to extract (e.g., 'capability')
   * @param parser - Function to convert raw attributes + content into typed object
   */
  static loadDefinitions<T>(
    agentId: string,
    fileName: string,
    tagName: string,
    parser: (attrs: Record<string, string>, content: string) => T,
  ): T[] {
    const filePath = path.join(this.promptsDir, agentId, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Definitions file not found: ${filePath}`);
    }

    let raw = fs.readFileSync(filePath, "utf-8");
    // Strip XML comments
    raw = raw.replace(/<!--[\s\S]*?-->/g, "");

    const results: T[] = [];
    const regex = new RegExp(
      `<${tagName}([^>]*)>([\\s\\S]*?)</${tagName}>`,
      "g",
    );

    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      const attrString = match[1] || "";
      const content = (match[2] || "").trim();

      // Parse attributes: name="value" tools="value"
      const attrs: Record<string, string> = {};
      const attrRegex = /(\w+)=["']([^"']*)["']/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(attrString)) !== null) {
        attrs[attrMatch[1]!] = attrMatch[2]!;
      }

      results.push(parser(attrs, content));
    }

    return results;
  }
}
