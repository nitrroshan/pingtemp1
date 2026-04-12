/**
 * DiscoveryService — Vector search over the registry index
 *
 * Embeds a goal/query, computes cosine similarity against all index entries,
 * and returns ranked suggestions.
 */

import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import type { RegistryIndex, AgentIndexEntry, SkillIndexEntry, PluginIndexEntry } from "../index/IndexBuilder.js";

// ── Result types ──

export interface AgentSuggestion {
  name: string;
  description: string;
  role: string;
  score: number;
  suggestedSkills: string[];
  source: string;
}

export interface SkillSuggestion {
  name: string;
  description: string;
  score: number;
  source: string;
}

export interface PluginSuggestion {
  name: string;
  description: string;
  score: number;
  agents: AgentSuggestion[];
}

export interface Suggestion {
  plugins: PluginSuggestion[];
  standaloneAgents: AgentSuggestion[];
  standaloneSkills: SkillSuggestion[];
}

// ── Cosine similarity ──

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Service ──

export class DiscoveryService {
  private index: RegistryIndex;

  constructor(index: RegistryIndex) {
    this.index = index;
  }

  /**
   * Update the in-memory index (e.g., after a rebuild).
   */
  setIndex(index: RegistryIndex): void {
    this.index = index;
  }

  /**
   * Suggest plugins, agents, and skills matching a goal.
   */
  async suggest(goal: string, options?: { limit?: number }): Promise<Suggestion> {
    const limit = options?.limit ?? 5;

    // Embed the goal
    const { embedding: goalEmbedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: goal,
    });

    // Score plugins
    const scoredPlugins = this.index.plugins
      .map((p: PluginIndexEntry) => ({ ...p, score: cosineSimilarity(goalEmbedding, p.embedding) }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, limit);

    // Score agents
    const scoredAgents = this.index.agents
      .map((a: AgentIndexEntry) => ({ ...a, score: cosineSimilarity(goalEmbedding, a.embedding) }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, limit);

    // Score skills
    const scoredSkills = this.index.skills
      .map((s: SkillIndexEntry) => ({ ...s, score: cosineSimilarity(goalEmbedding, s.embedding) }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, limit);

    // Group agents by their plugin source for plugin suggestions
    const pluginAgentMap = new Map<string, AgentSuggestion[]>();
    for (const agent of scoredAgents) {
      const existing = pluginAgentMap.get(agent.source) ?? [];
      existing.push({
        name: agent.name,
        description: agent.description,
        role: agent.role,
        score: agent.score,
        suggestedSkills: agent.defaultSkills,
        source: agent.source,
      });
      pluginAgentMap.set(agent.source, existing);
    }

    return {
      plugins: scoredPlugins.map((p: PluginIndexEntry & { score: number }) => ({
        name: p.name,
        description: p.description,
        score: p.score,
        agents: pluginAgentMap.get(p.name) ?? [],
      })),
      standaloneAgents: scoredAgents.map((a: AgentIndexEntry & { score: number }) => ({
        name: a.name,
        description: a.description,
        role: a.role,
        score: a.score,
        suggestedSkills: a.defaultSkills,
        source: a.source,
      })),
      standaloneSkills: scoredSkills.map((s: SkillIndexEntry & { score: number }) => ({
        name: s.name,
        description: s.description,
        score: s.score,
        source: s.source,
      })),
    };
  }
}
