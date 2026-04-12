/**
 * PluginLoader - Loads team plugins from any storage backend
 *
 * A plugin folder follows the Claude Code format:
 *   .claude-plugin/plugin.json  (manifest)
 *   agents/*.md                 (agent definitions)
 *   skills/SKILL_NAME/SKILL.md  (skill definitions)
 *
 * The folder structure IS the team. All agents in agents/ are team members.
 *
 * Storage backends:
 * - LocalPluginStorage (default) - reads from local filesystem
 * - S3PluginStorage - reads from AWS S3 bucket
 * - AzureBlobPluginStorage - reads from Azure Blob Storage
 *
 * Usage:
 *   // Local (backward compatible - pass a directory path string)
 *   const loader = new PluginLoader("/path/to/plugins");
 *
 *   // Cloud
 *   const storage = new S3PluginStorage({ bucket: "my-plugins" });
 *   const loader = new PluginLoader(storage);
 */

import type { IPluginStorage } from "../storage/IPluginStorage.js";
import { LocalPluginStorage } from "../storage/LocalPluginStorage.js";
import { parseAgentMd, parseSkillMd, parsePluginJson } from "../parser/frontmatterParser.js";
import { agentMdToDefinition, type AgentDefinition } from "../converter/agentConverter.js";

// -- Types --

export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: { name: string };
  tags?: string[];
  modes?: Record<string, TeamMode>;
  settings?: {
    executionMode?: "sequential" | "parallel" | "hybrid";
    maxConcurrency?: number;
  };
}

export interface TeamMode {
  description: string;
  activeAgents: string[];
  icon?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  body: string;
  tags: string[];
  loadMode: "always" | "on-demand";
  allowedTools?: string[];
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  modes?: Record<string, TeamMode>;
  pluginDir: string;
}

// -- Loader --

export class PluginLoader {
  private storage: IPluginStorage;

  /**
   * @param storageOrDir - Either an IPluginStorage instance (cloud) or a local directory path (string).
   *                       String paths are wrapped in LocalPluginStorage for backward compatibility.
   */
  constructor(storageOrDir: IPluginStorage | string) {
    this.storage = typeof storageOrDir === "string"
      ? new LocalPluginStorage(storageOrDir)
      : storageOrDir;
  }

  /**
   * Load a single plugin by name (subdirectory of the registry root).
   */
  async loadPlugin(pluginName: string): Promise<LoadedPlugin> {
    return this.loadPluginFromPath(pluginName);
  }

  /**
   * Load a plugin from a relative path within the storage.
   */
  async loadPluginFromPath(pluginPath: string): Promise<LoadedPlugin> {
    // 1. Read manifest
    const manifest = await this.readManifest(pluginPath);

    // 2. Load agents from agents/*.md
    const agents = await this.loadAgents(pluginPath);

    // 3. Load skills from skills/*/SKILL.md
    const skills = await this.loadSkills(pluginPath);

    return {
      manifest,
      agents,
      skills,
      modes: manifest.modes,
      pluginDir: pluginPath,
    };
  }

  /**
   * Load all plugins from the storage root.
   */
  async loadAllPlugins(): Promise<LoadedPlugin[]> {
    const entries = await this.storage.listDir("");
    const plugins: LoadedPlugin[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      if (await this.hasManifest(entry.name)) {
        try {
          const plugin = await this.loadPluginFromPath(entry.name);
          plugins.push(plugin);
        } catch (error) {
          console.error(`Failed to load plugin from ${entry.name}:`, error);
        }
      }
    }

    return plugins;
  }

  /**
   * Get manifests for all plugins (lightweight, no agent/skill parsing).
   */
  async getPluginManifests(): Promise<PluginManifest[]> {
    const entries = await this.storage.listDir("");
    const manifests: PluginManifest[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      if (await this.hasManifest(entry.name)) {
        try {
          manifests.push(await this.readManifest(entry.name));
        } catch {
          // skip invalid
        }
      }
    }

    return manifests;
  }

  // -- Private helpers --

  private async hasManifest(pluginPath: string): Promise<boolean> {
    const claudePath = `${pluginPath}/.claude-plugin/plugin.json`;
    const rootPath = `${pluginPath}/plugin.json`;
    return (await this.storage.exists(claudePath)) || (await this.storage.exists(rootPath));
  }

  private async readManifest(pluginPath: string): Promise<PluginManifest> {
    const claudePath = `${pluginPath}/.claude-plugin/plugin.json`;
    const rootPath = `${pluginPath}/plugin.json`;

    const manifestPath = (await this.storage.exists(claudePath)) ? claudePath : rootPath;
    if (!(await this.storage.exists(manifestPath))) {
      throw new Error(`No plugin.json found in ${pluginPath}`);
    }

    const raw = await this.storage.readFile(manifestPath);
    const parsed = parsePluginJson(raw);

    return {
      name: parsed.name,
      description: parsed.description,
      version: parsed.version ?? "1.0.0",
      author: parsed.author,
      tags: parsed.tags,
      modes: parsed.modes,
    };
  }

  private async loadAgents(pluginPath: string): Promise<AgentDefinition[]> {
    const agentsPath = `${pluginPath}/agents`;
    if (!(await this.storage.exists(agentsPath))) return [];

    const files = await this.storage.listDir(agentsPath);
    const agents: AgentDefinition[] = [];

    for (const file of files) {
      if (file.isDirectory || !file.name.endsWith(".md")) continue;
      try {
        const content = await this.storage.readFile(`${agentsPath}/${file.name}`);
        const parsed = parseAgentMd(content);
        const definition = agentMdToDefinition(parsed);
        agents.push(definition);
      } catch (error) {
        console.error(`Failed to parse agent ${file.name}:`, error);
      }
    }

    return agents;
  }

  private async loadSkills(pluginPath: string): Promise<SkillDefinition[]> {
    const skillsPath = `${pluginPath}/skills`;
    if (!(await this.storage.exists(skillsPath))) return [];

    const entries = await this.storage.listDir(skillsPath);
    const skills: SkillDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      const skillMdPath = `${skillsPath}/${entry.name}/SKILL.md`;
      if (!(await this.storage.exists(skillMdPath))) continue;

      try {
        const content = await this.storage.readFile(skillMdPath);
        const parsed = parseSkillMd(content);
        const fm = parsed.frontmatter;

        skills.push({
          id: fm.name,
          name: fm.name,
          description: fm.description,
          body: parsed.body,
          tags: fm.tags ?? [],
          loadMode: fm["disable-model-invocation"] ? "on-demand" : "always",
          allowedTools: fm["allowed-tools"]?.split?.(" "),
        });
      } catch (error) {
        console.error(`Failed to parse skill ${entry.name}:`, error);
      }
    }

    return skills;
  }
}
