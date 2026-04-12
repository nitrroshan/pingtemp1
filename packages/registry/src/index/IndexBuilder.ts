/**
 * IndexBuilder — Builds index.json with embeddings for all discoverable items
 *
 * Scans all plugins via PluginLoader, generates embeddings for descriptions,
 * and writes a searchable index file.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import type { PluginLoader } from "../loader/PluginLoader.js";

// ── Index entry types ──

export interface IndexEntry {
  name: string;
  description: string;
  tags: string[];
  source: string; // plugin name
  embedding: number[];
}

export interface PluginIndexEntry extends IndexEntry {
  pluginDir: string;
}

export interface AgentIndexEntry extends IndexEntry {
  role: string;
  defaultSkills: string[];
}

export interface SkillIndexEntry extends IndexEntry {
  loadMode: "always" | "on-demand";
}

export interface RegistryIndex {
  version: string;
  buildTimestamp: string;
  plugins: PluginIndexEntry[];
  agents: AgentIndexEntry[];
  skills: SkillIndexEntry[];
}

// ── Builder ──

export class IndexBuilder {
  private registryDir: string;

  constructor(registryDir: string) {
    this.registryDir = registryDir;
  }

  /**
   * Build the full index from all plugins. Generates embeddings for each item.
   */
  async build(loader: PluginLoader): Promise<RegistryIndex> {
    const plugins = await loader.loadAllPlugins();

    // Collect all items with their description text for embedding
    const items: Array<{ type: "plugin" | "agent" | "skill"; text: string; data: any }> = [];

    for (const plugin of plugins) {
      // Plugin entry
      items.push({
        type: "plugin",
        text: `${plugin.manifest.name} ${plugin.manifest.description} ${(plugin.manifest.tags ?? []).join(" ")}`,
        data: {
          name: plugin.manifest.name,
          description: plugin.manifest.description,
          tags: plugin.manifest.tags ?? [],
          source: plugin.manifest.name,
          pluginDir: plugin.pluginDir,
        },
      });

      // Agent entries
      for (const agent of plugin.agents) {
        const skills = (agent.config as any).skills ?? [];
        items.push({
          type: "agent",
          text: `${agent.name} ${agent.description ?? ""} ${agent.role} ${skills.join(" ")}`,
          data: {
            name: agent.name,
            description: agent.description ?? "",
            tags: [],
            source: plugin.manifest.name,
            role: agent.role,
            defaultSkills: skills,
          },
        });
      }

      // Skill entries
      for (const skill of plugin.skills) {
        items.push({
          type: "skill",
          text: `${skill.name} ${skill.description} ${skill.tags.join(" ")}`,
          data: {
            name: skill.name,
            description: skill.description,
            tags: skill.tags,
            source: plugin.manifest.name,
            loadMode: skill.loadMode,
          },
        });
      }
    }

    // Generate embeddings in batch
    const texts = items.map((i) => i.text);
    let embeddingResults: number[][] = [];

    if (texts.length > 0) {
      const { embeddings } = await embedMany({
        model: openai.embedding("text-embedding-3-small"),
        values: texts,
      });
      embeddingResults = embeddings;
    }

    // Build index
    const index: RegistryIndex = {
      version: "1.0",
      buildTimestamp: new Date().toISOString(),
      plugins: [],
      agents: [],
      skills: [],
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const embedding = embeddingResults[i] ?? [];

      switch (item.type) {
        case "plugin":
          index.plugins.push({ ...item.data, embedding });
          break;
        case "agent":
          index.agents.push({ ...item.data, embedding });
          break;
        case "skill":
          index.skills.push({ ...item.data, embedding });
          break;
      }
    }

    return index;
  }

  /**
   * Write index to a JSON file.
   */
  async save(index: RegistryIndex, outputPath: string): Promise<void> {
    writeFileSync(outputPath, JSON.stringify(index, null, 2), "utf-8");
  }

  /**
   * Load a previously built index from a JSON file.
   */
  static load(indexPath: string): RegistryIndex {
    if (!existsSync(indexPath)) {
      throw new Error(`Index file not found: ${indexPath}`);
    }
    const raw = readFileSync(indexPath, "utf-8");
    return JSON.parse(raw) as RegistryIndex;
  }
}
