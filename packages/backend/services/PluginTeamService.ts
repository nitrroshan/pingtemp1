/**
 * PluginTeamService - Teams are projections of plugins. No database.
 *
 * Team ID is derived deterministically from plugin name using SHA-256.
 * Agents/skills loaded from plugin .md files via PluginLoader.
 *
 * No lowdb, no JSON files. Plugin folder IS the team.
 */

import { createHash } from "crypto";
import type { PluginLoader, LoadedPlugin, PluginManifest } from "@ping/registry/src/loader/PluginLoader";
import type { AgentDefinition } from "@ping/registry/src/converter/agentConverter";

/**
 * Generate a deterministic UUID-like ID from a plugin name.
 * Same input always produces same output.
 */
function pluginNameToTeamId(pluginName: string): string {
  const hash = createHash("sha256").update(pluginName).digest("hex");
  // Format as UUID v4-like: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

// Virtual team object — projected from a plugin manifest
export interface TeamInfo {
  id: string;
  name: string;
  description: string;
  pluginName: string;
  settings: {
    executionMode: "sequential" | "parallel" | "hybrid";
    maxConcurrency: number;
  };
}

// Lightweight agent info returned by getTeamAgents()
export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  description: string;
  goal: string;
  skills: string[];
}

// Lightweight skill info returned by getTeamSkills()
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export class PluginTeamService {
  readonly pluginLoader: PluginLoader;

  constructor(pluginLoader: PluginLoader) {
    this.pluginLoader = pluginLoader;
  }

  // ── Team projection (read-only, derived from plugins) ──

  /** Get a team by ID. Scans plugins for matching deterministic ID. */
  async getTeam(teamId: string): Promise<TeamInfo | null> {
    const manifests = await this.pluginLoader.getPluginManifests();
    for (const m of manifests) {
      if (pluginNameToTeamId(m.name) === teamId) {
        return this.manifestToTeam(m);
      }
    }
    return null;
  }

  /** List all teams (one per plugin). */
  async listTeams(): Promise<TeamInfo[]> {
    const manifests = await this.pluginLoader.getPluginManifests();
    return manifests.map(m => this.manifestToTeam(m));
  }

  /** Get team by plugin name. */
  async getByPluginName(pluginName: string): Promise<TeamInfo | null> {
    try {
      const manifest = (await this.pluginLoader.getPluginManifests())
        .find(m => m.name === pluginName);
      return manifest ? this.manifestToTeam(manifest) : null;
    } catch {
      return null;
    }
  }

  /** Convert plugin name to deterministic team ID. */
  getTeamId(pluginName: string): string {
    return pluginNameToTeamId(pluginName);
  }

  /** Find which plugin name a team ID maps to. */
  async getPluginName(teamId: string): Promise<string | null> {
    const manifests = await this.pluginLoader.getPluginManifests();
    for (const m of manifests) {
      if (pluginNameToTeamId(m.name) === teamId) return m.name;
    }
    return null;
  }

  // ── Agent resolution (delegates to PluginLoader) ──

  async getTeamAgents(teamId: string): Promise<AgentInfo[]> {
    const pluginName = await this.getPluginName(teamId);
    if (!pluginName) return [];
    try {
      const plugin = await this.pluginLoader.loadPlugin(pluginName);
      return plugin.agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        description: a.description ?? "",
        goal: a.goal ?? a.description ?? "",
        skills: (a.config as any)?.skills ?? [],
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get full agent definitions (with systemPrompt, config) for AgentManagerRegistry.
   */
  async getTeamAgentDefinitions(teamId: string): Promise<AgentDefinition[]> {
    const pluginName = await this.getPluginName(teamId);
    if (!pluginName) return [];
    const plugin = await this.pluginLoader.loadPlugin(pluginName);
    return plugin.agents;
  }

  /**
   * Load the full plugin for a team (manifest, agents, skills, modes).
   */
  async loadTeamPlugin(teamId: string): Promise<LoadedPlugin | null> {
    const pluginName = await this.getPluginName(teamId);
    if (!pluginName) return null;
    return this.pluginLoader.loadPlugin(pluginName);
  }

  /**
   * Load a plugin by name directly (for POST /teams creation flow).
   */
  async loadPluginByName(pluginName: string): Promise<LoadedPlugin> {
    return this.pluginLoader.loadPlugin(pluginName);
  }

  // ── Skill resolution (delegates to PluginLoader) ──

  async getTeamSkills(teamId: string): Promise<SkillInfo[]> {
    const pluginName = await this.getPluginName(teamId);
    if (!pluginName) return [];
    try {
      const plugin = await this.pluginLoader.loadPlugin(pluginName);
      return plugin.skills.map(s => ({ id: s.id, name: s.name, description: s.description }));
    } catch {
      return [];
    }
  }

  // ── Private helpers ──

  private manifestToTeam(manifest: PluginManifest): TeamInfo {
    return {
      id: pluginNameToTeamId(manifest.name),
      name: manifest.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      description: manifest.description ?? "",
      pluginName: manifest.name,
      settings: (manifest as any).settings ?? {
        executionMode: "sequential" as const,
        maxConcurrency: 1,
      },
    };
  }
}
