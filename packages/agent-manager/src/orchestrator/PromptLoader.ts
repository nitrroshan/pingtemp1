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
}
