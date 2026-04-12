/**
 * SkillPlugin — Loads SKILL.md files from registry plugins and exposes them
 * as both callable tools (visible in UI) and system prompt hints.
 *
 * Reads from packages/registry/plugins/<team>/skills/<skillId>/SKILL.md
 *
 * Skills are per-agent: each agent's .md file declares `defaultSkills: [skill-id]`.
 * SkillMcpServer filters tools by role so each agent only sees its assigned skills.
 *
 * Skills appear as:
 *   - Callable tools via SkillMcpServer → visible as tool cards in the UI
 *   - on-demand ISkill entries → agent sees short descriptions in system prompt
 *     and calls the tool when it needs the full instructions
 */

import { z } from "zod";
import { readFile, readdir, stat } from "fs/promises";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { rootLogger } from "../../logging/index.js";
import type {
  IPlugin,
  IMcpServer,
  ISkill,
  IPluginStorage,
  SkillContext,
  ToolContext,
} from "@ping/agent-manager";

const logger = rootLogger.child({ module: "SkillPlugin" });

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  instructions: string;
  /** Absolute path to scripts/run.sh if it exists */
  scriptPath: string | null;
}

/**
 * Parse SKILL.md frontmatter (name, description) + body instructions.
 */
function parseSkillMd(content: string): {
  name: string;
  description: string;
  instructions: string;
} {
  let name = "";
  let description = "";
  let instructions = content;

  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex !== -1) {
      const yaml = content.slice(3, endIndex).trim();
      instructions = content.slice(endIndex + 3).trim();
      for (const line of yaml.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          if (key === "name") name = value;
          if (key === "description") description = value;
        }
      }
    }
  }

  return { name, description, instructions };
}

/**
 * Scan a team's skills directory and load all SKILL.md files.
 */
async function loadSkillsFromDir(
  teamDir: string,
): Promise<SkillEntry[]> {
  const skillsDir = join(teamDir, "skills");
  if (!existsSync(skillsDir)) return [];

  const entries: SkillEntry[] = [];
  const dirs = await readdir(skillsDir);

  for (const dir of dirs) {
    const skillMdPath = join(skillsDir, dir, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    try {
      const raw = await readFile(skillMdPath, "utf-8");
      const parsed = parseSkillMd(raw);

      // Detect executable script (scripts/run.sh)
      const scriptPath = join(skillsDir, dir, "scripts", "run.sh");
      const hasScript = existsSync(scriptPath);

      entries.push({
        id: dir,
        name: parsed.name || dir,
        description: parsed.description || `Skill: ${dir}`,
        instructions: parsed.instructions,
        scriptPath: hasScript ? scriptPath : null,
      });
    } catch (err: any) {
      logger.warn(`Failed to read ${skillMdPath}: ${err.message}`);
    }
  }

  return entries;
}

/**
 * ISkill implementation — on-demand mode so the agent sees a short description
 * and calls the tool when it needs full instructions.
 */
class FileBackedSkill implements ISkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly loadMode = "on-demand" as const;

  private readonly instructions: string;

  constructor(entry: SkillEntry) {
    this.id = entry.id;
    this.name = entry.name;
    this.description = entry.description;
    this.instructions = entry.instructions;
  }

  getInstructions(_context: SkillContext): string {
    return `## Skill: ${this.name}\n${this.instructions}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIPT EXECUTION — runs skill scripts (e.g. test-runner, lint-check)
// ═══════════════════════════════════════════════════════════════════════════════

const SCRIPT_TIMEOUT_MS = 60_000; // 60s max
const MAX_OUTPUT_CHARS = 10_000;

function runSkillScript(
  entry: SkillEntry,
  args?: string,
  cwd?: string,
): Promise<string> {
  return new Promise((resolvePromise) => {
    if (!entry.scriptPath) {
      resolvePromise(`Skill "${entry.name}" has no executable script.`);
      return;
    }

    const scriptArgs = args ? args.split(/\s+/) : [];
    const workDir = cwd || process.cwd();

    logger.info(`Running skill script: ${entry.scriptPath} ${scriptArgs.join(" ")} (cwd: ${workDir})`);

    const child = execFile(
      "bash",
      [entry.scriptPath, ...scriptArgs],
      {
        cwd: workDir,
        timeout: SCRIPT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env, SKILL_NAME: entry.id },
      },
      (error, stdout, stderr) => {
        const output = (stdout || "").slice(0, MAX_OUTPUT_CHARS);
        const errOutput = (stderr || "").slice(0, 2000);
        const exitCode = error?.code ?? 0;

        let result = `## Skill Script: ${entry.name}\n`;
        result += `Exit code: ${exitCode}\n\n`;

        if (output) {
          result += `### Output\n\`\`\`\n${output}\n\`\`\`\n`;
        }
        if (errOutput) {
          result += `### Errors\n\`\`\`\n${errOutput}\n\`\`\`\n`;
        }
        if (error && (error as any).killed) {
          result += `\n**Timed out** after ${SCRIPT_TIMEOUT_MS / 1000}s\n`;
        }

        resolvePromise(result);
      },
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER — Exposes each skill as a callable tool (visible in UI)
// ═══════════════════════════════════════════════════════════════════════════════

class SkillMcpServer implements IMcpServer {
  readonly id = "skill-tools";
  readonly name = "Skill Tools";

  private skillEntries: SkillEntry[] = [];
  /** Map role → skill IDs this role should receive. Empty map = all skills to all roles. */
  private roleSkillMap = new Map<string, string[]>();

  setSkills(entries: SkillEntry[]): void {
    this.skillEntries = entries;
  }

  setRoleSkillMap(map: Map<string, string[]>): void {
    this.roleSkillMap = map;
  }

  getTools(context: ToolContext): any[] {
    // Only workers get skill tools, not the planner
    if (context.consumer === "planner") return [];

    // Filter by role's assigned skills (from agent .md defaultSkills)
    let entries = this.skillEntries;
    if (context.role && this.roleSkillMap.size > 0) {
      const allowedIds = this.roleSkillMap.get(context.role);
      if (allowedIds && allowedIds.length > 0) {
        const allowed = new Set(allowedIds);
        entries = entries.filter((e) => allowed.has(e.id));
      }
      // If role has no entry in map, it gets no skills (explicit assignment required)
      else if (allowedIds !== undefined) {
        return [];
      }
      // If role is not in map at all, fall back to all skills (backward compat)
    }

    return entries.map((entry) => {
      const toolName = `skill_${entry.id.replace(/[^a-z0-9]/gi, "_")}`;
      const hasScript = !!entry.scriptPath;

      const descParts = [
        `[Skill: ${entry.name}] ${entry.description}.`,
        `Actions: "read" (get instructions/checklist)`,
      ];
      if (hasScript) {
        descParts.push(`or "run" (execute the skill's script in the workspace)`);
      }

      return {
        name: toolName,
        description: descParts.join(" "),
        schema: z.object({
          action: z
            .enum(hasScript ? ["read", "run"] : ["read"])
            .describe(
              hasScript
                ? '"read" for instructions, "run" to execute the skill script'
                : '"read" to get instructions and checklists',
            ),
          query: z
            .string()
            .optional()
            .describe("What aspect of this skill you need help with (for read action)"),
          args: z
            .string()
            .optional()
            .describe("Arguments to pass to the script (for run action)"),
          cwd: z
            .string()
            .optional()
            .describe("Working directory for script execution (defaults to workspace root)"),
        }),
        invoke: async (input: { action: string; query?: string; args?: string; cwd?: string }) => {
          if (input.action === "run" && entry.scriptPath) {
            return runSkillScript(entry, input.args, input.cwd);
          }
          return `## Skill: ${entry.name}\n\n${entry.instructions}\n\n---\nApply the above instructions to: ${input.query || "the current task"}`;
        },
      };
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

export interface SkillPluginConfig {
  /** Absolute path to the "plugins" directory (e.g. packages/registry/plugins) */
  pluginsDir: string;
  /**
   * Optional: only load skills for these team folder names.
   * If omitted, loads from all team directories.
   */
  teams?: string[];
  /**
   * Optional: map of role → skill IDs from agent .md defaultSkills.
   * When set, each role only gets its declared skills as tools.
   * When omitted, all skills are available to all roles (backward compat).
   */
  roleSkillMap?: Map<string, string[]>;
}

export class SkillPlugin implements IPlugin {
  readonly id = "skills";
  readonly name = "Skills (SKILL.md)";

  private skills: ISkill[] = [];
  private mcpServer = new SkillMcpServer();
  private config: SkillPluginConfig;
  private loadedEntries: SkillEntry[] = [];

  constructor(config: SkillPluginConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const pluginsDir = resolve(this.config.pluginsDir);
    if (!existsSync(pluginsDir)) {
      logger.warn(`Skills plugins directory not found: ${pluginsDir}`);
      return;
    }

    const entries: SkillEntry[] = [];

    // Load team-specific skills
    const teamDirs = this.config.teams
      ? this.config.teams
      : (await readdir(pluginsDir)).filter((d) => !d.startsWith("_"));

    for (const teamFolder of teamDirs) {
      const teamDir = join(pluginsDir, teamFolder);
      const s = await stat(teamDir).catch(() => null);
      if (!s?.isDirectory()) continue;

      const teamSkills = await loadSkillsFromDir(teamDir);
      entries.push(...teamSkills);
    }

    // Deduplicate by skill ID (first wins)
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      this.skills.push(new FileBackedSkill(entry));
      this.loadedEntries.push(entry);
    }

    // Wire entries into MCP server so skills appear as callable tools
    this.mcpServer.setSkills(this.loadedEntries);

    // Wire per-role skill filtering from agent .md defaultSkills
    if (this.config.roleSkillMap) {
      this.mcpServer.setRoleSkillMap(this.config.roleSkillMap);
      logger.info(
        `Role-skill map: ${Array.from(this.config.roleSkillMap.entries()).map(([r, s]) => `${r}=[${s.join(",")}]`).join(", ")}`,
      );
    }

    logger.info(
      `Loaded ${this.skills.length} skills as tools: ${this.skills.map((s) => s.id).join(", ")}`,
    );
  }

  async dispose(): Promise<void> {
    this.skills = [];
  }

  getMcpServers(): IMcpServer[] {
    return [this.mcpServer];
  }

  getSkills(): ISkill[] {
    return this.skills;
  }
}
