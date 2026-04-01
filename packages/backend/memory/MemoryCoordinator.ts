/**
 * MemoryCoordinator — Central coordinator for all memory layers
 *
 * Plug-and-play architecture: each memory layer (L1, L2, L3) is a plugin
 * that can be registered independently. The coordinator manages their
 * lifecycle and provides a unified API surface for consumers.
 *
 * Usage:
 *   const coordinator = new MemoryCoordinator({ teamId, memoryManager });
 *   coordinator.registerPlugin(new L1WorkspacePlugin(config));
 *   coordinator.registerPlugin(new L2CollaborationPlugin(config));
 *   coordinator.registerPlugin(new L3KnowledgePlugin(config));
 *   await coordinator.initializeAll();
 */

import { Logger } from "tslog";
import { MemoryManager } from "./MemoryManager.js";
import type {
  IMemoryPlugin,
  IL1WorkspacePlugin,
  IL2CollaborationPlugin,
  IL3KnowledgePlugin,
  MemoryLayerId,
} from "./types/plugins.js";

const logger = new Logger({ name: "MemoryCoordinator" });

/**
 * Configuration for MemoryCoordinator
 */
export interface MemoryCoordinatorConfig {
  /** Team identifier for scoping memory */
  teamId: string;
  /** MemoryManager instance for task state */
  memoryManager: MemoryManager;
}

/**
 * MemoryCoordinator — Plug-and-play orchestrator for L1, L2, L3 memory layers.
 *
 * Plugins are registered via registerPlugin() and managed through a uniform lifecycle.
 * Access typed plugins via .L1, .L2, .L3 getters.
 */
export class MemoryCoordinator {
  /** Team this coordinator is scoped to */
  public readonly teamId: string;

  /** Task memory (MemoryManager) */
  public readonly tasks: MemoryManager;

  // ─────────────────────────────────────────────────────────────────────────
  // Plugin registry
  // ─────────────────────────────────────────────────────────────────────────

  private plugins = new Map<MemoryLayerId, IMemoryPlugin>();

  /** Get the L1 workspace plugin (or null if not registered) */
  get L1(): IL1WorkspacePlugin | null {
    return (this.plugins.get("L1") as IL1WorkspacePlugin) ?? null;
  }

  /** Get the L2 collaboration plugin (or null if not registered) */
  get L2(): IL2CollaborationPlugin | null {
    return (this.plugins.get("L2") as IL2CollaborationPlugin) ?? null;
  }

  /** Get the L3 knowledge plugin (or null if not registered) */
  get L3(): IL3KnowledgePlugin | null {
    return (this.plugins.get("L3") as IL3KnowledgePlugin) ?? null;
  }

  constructor(config: MemoryCoordinatorConfig) {
    this.teamId = config.teamId;
    this.tasks = config.memoryManager;

    logger.info(`MemoryCoordinator created for team '${config.teamId}'`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Plugin lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a memory layer plugin.
   * Replaces any existing plugin for that layer.
   */
  registerPlugin(plugin: IMemoryPlugin): void {
    const existing = this.plugins.get(plugin.layerId);
    if (existing) {
      logger.warn(
        `Replacing ${plugin.layerId} plugin: ${existing.name} → ${plugin.name}`,
      );
    }
    this.plugins.set(plugin.layerId, plugin);
    logger.info(`Registered ${plugin.layerId} plugin: ${plugin.name}`);
  }

  /**
   * Unregister a memory layer plugin. Disposes it first.
   */
  async unregisterPlugin(layerId: MemoryLayerId): Promise<void> {
    const plugin = this.plugins.get(layerId);
    if (plugin) {
      await plugin.dispose();
      this.plugins.delete(layerId);
      logger.info(`Unregistered ${layerId} plugin: ${plugin.name}`);
    }
  }

  /**
   * Get a registered plugin by layer ID
   */
  getPlugin<T extends IMemoryPlugin>(layerId: MemoryLayerId): T | null {
    return (this.plugins.get(layerId) as T) ?? null;
  }

  /**
   * Check if a layer is registered and ready
   */
  hasLayer(layerId: MemoryLayerId): boolean {
    const plugin = this.plugins.get(layerId);
    return plugin?.isReady ?? false;
  }

  /**
   * Initialize all registered plugins
   */
  async initializeAll(): Promise<void> {
    for (const [layerId, plugin] of this.plugins) {
      if (!plugin.isReady) {
        await plugin.initialize();
        logger.info(`Initialized ${layerId}: ${plugin.name}`);
      }
    }
  }

  /**
   * Dispose all registered plugins
   */
  async disposeAll(): Promise<void> {
    for (const [layerId, plugin] of this.plugins) {
      await plugin.dispose();
      logger.info(`Disposed ${layerId}: ${plugin.name}`);
    }
    this.plugins.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Task lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get task context for knowledge injection.
   * Queries L3 plugin if available.
   */
  async getTaskContext(taskId: string): Promise<{
    knowledgeContext?: {
      relevantDocs: Array<{
        document: { title: string; content: string };
      }>;
      roleSkills: Array<{ title: string; content: string }>;
      roleRunbooks: Array<{ title: string; content: string }>;
    };
  }> {
    if (!this.L3) {
      logger.debug(
        `[No L3 plugin] getTaskContext(${taskId}) — returning empty context`,
      );
      return {};
    }

    const [relevantDocs, roleSkills, roleRunbooks] = await Promise.all([
      this.L3.relevantDocs(taskId),
      this.L3.roleSkills("*"),
      this.L3.roleRunbooks("*"),
    ]);

    return {
      knowledgeContext: { relevantDocs, roleSkills, roleRunbooks },
    };
  }

  /**
   * Complete a task — delegates to MemoryManager
   */
  async completeTask(taskId: string, output: any): Promise<void> {
    this.tasks.completeTask(taskId, output);
    logger.info(`Task ${taskId} completed`);
  }
}
