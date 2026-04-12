/**
 * PluginRegistry — Register, lookup, and resolve tools/skills from plugins
 *
 * Central registry for all IPlugin instances. Provides:
 * - Plugin registration and lifecycle management
 * - Tool resolution per context (planner vs worker, per-role)
 * - Skill resolution for system prompt injection
 */

import { rootLogger } from "../logging.js";
import type {
  IPlugin,
  IPluginStorage,
  ToolContext,
  SkillContext,
  ISkill,
} from "./types.js";

const logger = rootLogger.child({ module: "PluginRegistry" });

export class PluginRegistry {
  private plugins = new Map<string, IPlugin>();

  /** Register a plugin. Replaces existing plugin with same ID. */
  register(plugin: IPlugin): void {
    const existing = this.plugins.get(plugin.id);
    if (existing) {
      logger.warn(`Replacing plugin: ${existing.name} → ${plugin.name}`);
    }
    this.plugins.set(plugin.id, plugin);
    logger.info(`Registered plugin: ${plugin.id} (${plugin.name})`);
  }

  /** Get a plugin by ID */
  get(pluginId: string): IPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /** List all registered plugins */
  list(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Initialize all registered plugins */
  async initializeAll(): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      try {
        await plugin.initialize();
        logger.info(`Initialized plugin: ${id}`);
      } catch (error: any) {
        logger.error(`Failed to initialize plugin ${id}: ${error.message}`);
        throw error;
      }
    }
  }

  /** Dispose all registered plugins */
  async disposeAll(): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      try {
        await plugin.dispose();
        logger.debug(`Disposed plugin: ${id}`);
      } catch (error: any) {
        logger.warn(`Failed to dispose plugin ${id}: ${error.message}`);
      }
    }
    this.plugins.clear();
  }

  /**
   * Prepare plugins for a task — async setup before getTools.
   * e.g. WorkspacePlugin creates the git branch workspace here.
   */
  async prepareForTask(context: ToolContext): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      if (plugin.prepareForTask) {
        try {
          await plugin.prepareForTask(context);
        } catch (error: any) {
          logger.warn(`Plugin ${id} prepareForTask failed: ${error.message}`);
        }
      }
    }
  }

  /**
   * Notify all plugins that a task completed.
   * e.g. WorkspacePlugin publishes outputs and merges the branch.
   *
   * @returns Merged result — success only if all plugins succeed (or have no handler)
   */
  async onTaskComplete(taskId: string, goalId?: string): Promise<{ success: boolean; error?: string }> {
    const errors: string[] = [];
    for (const [id, plugin] of this.plugins) {
      if (plugin.onTaskComplete) {
        try {
          const result = await plugin.onTaskComplete(taskId, goalId);
          if (!result.success) {
            errors.push(`${id}: ${result.error}`);
          }
        } catch (error: any) {
          errors.push(`${id}: ${error.message}`);
          logger.warn(`Plugin ${id} onTaskComplete failed: ${error.message}`);
        }
      }
    }
    return errors.length === 0
      ? { success: true }
      : { success: false, error: errors.join("; ") };
  }

  /**
   * Notify all plugins that a task failed.
   * e.g. WorkspacePlugin cleans up the failed workspace.
   */
  async onTaskFailed(taskId: string): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      if (plugin.onTaskFailed) {
        try {
          await plugin.onTaskFailed(taskId);
        } catch (error: any) {
          logger.warn(`Plugin ${id} onTaskFailed failed: ${error.message}`);
        }
      }
    }
  }

  /**
   * Collect all tools from registered plugins for a given context.
   *
   * @param context - Who is requesting tools (planner vs worker, role, taskId)
   * @param pluginIds - Optional: only collect from these plugins. If omitted, all plugins.
   * @returns Flat array of AI SDK tool objects
   */
  getTools(context: ToolContext, pluginIds?: string[]): any[] {
    const tools: any[] = [];
    const sources = pluginIds
      ? pluginIds.map((id) => this.plugins.get(id)).filter(Boolean) as IPlugin[]
      : Array.from(this.plugins.values());

    for (const plugin of sources) {
      for (const server of plugin.getMcpServers()) {
        try {
          const serverTools = server.getTools(context);
          tools.push(...serverTools);
        } catch (error: any) {
          logger.warn(
            `Failed to get tools from ${plugin.id}/${server.id}: ${error.message}`,
          );
        }
      }
    }

    return tools;
  }

  /**
   * Collect all skill instructions from registered plugins for a given context.
   *
   * @param context - Skill context (role, taskId, goalId)
   * @param pluginIds - Optional: only collect from these plugins
   * @returns Array of instruction strings to inject into system prompt
   */
  getSkillInstructions(context: SkillContext, pluginIds?: string[]): string[] {
    const instructions: string[] = [];
    const sources = pluginIds
      ? pluginIds.map((id) => this.plugins.get(id)).filter(Boolean) as IPlugin[]
      : Array.from(this.plugins.values());

    for (const plugin of sources) {
      for (const skill of plugin.getSkills()) {
        try {
          if (skill.loadMode === "always") {
            instructions.push(skill.getInstructions(context));
          } else {
            // on-demand: just add the description for discovery
            instructions.push(
              `Available skill: ${skill.name} — ${skill.description}. Use invoke_skill('${skill.id}') when needed.`,
            );
          }
        } catch (error: any) {
          logger.warn(
            `Failed to get instructions from skill ${skill.id}: ${error.message}`,
          );
        }
      }
    }

    return instructions;
  }

  /**
   * Get all on-demand skills (for creating invoke_skill tools)
   */
  getOnDemandSkills(pluginIds?: string[]): ISkill[] {
    const skills: ISkill[] = [];
    const sources = pluginIds
      ? pluginIds.map((id) => this.plugins.get(id)).filter(Boolean) as IPlugin[]
      : Array.from(this.plugins.values());

    for (const plugin of sources) {
      for (const skill of plugin.getSkills()) {
        if (skill.loadMode === "on-demand") {
          skills.push(skill);
        }
      }
    }

    return skills;
  }

  /**
   * Get plugin storage by plugin ID.
   * Used for persistence upgrades (e.g., L2 provides CrdtPlanStore).
   */
  getPluginStorage(pluginId: string): IPluginStorage | undefined {
    const plugin = this.plugins.get(pluginId);
    return plugin?.getStorage?.();
  }
}
