/**
 * agentStore — Agent tree state + role resolution cache.
 *
 * Replaces useAgentTree hook. Adds O(1) roleMap for stream event routing.
 *
 * State:
 *   agents       — hierarchical agent tree (teams → sub-agents)
 *   isLoadingTeams — loading indicator
 *   roleMap      — Record<"teamId:role", agentId> for O(1) lookup
 *
 * The roleMap is rebuilt automatically whenever agents change.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2 } from '../services/AgentServiceV2';
import { logger } from '../utils/logger';
import { getIconForRole } from '../assets/icons';
import { INITIAL_AGENTS } from '../dummyData/constants';
import type { Agent } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AgentState {
  agents: Agent[];
  isLoadingTeams: boolean;
  /** O(1) role→agentId lookup. Key: "teamId:role" (lowercase). */
  roleMap: Record<string, string>;

  // Actions
  loadTeams: () => Promise<Agent[]>;
  createTeam: (name: string, goal: string, description: string) => Promise<Agent | null>;
  addLocalSubAgent: (parentId: string, agentData: Partial<Agent>) => void;
  handleToggleCollapse: (agentId: string) => void;
  findAgentById: (id: string) => Agent | undefined;
  /**
   * Resolve a role name to an Agent. O(1) via roleMap.
   * @param role - Role name (case-insensitive)
   * @param teamId - Optional team scope (uses first match if omitted)
   */
  findAgentByRole: (role: string, teamId?: string | null) => Agent | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Recursively search for an agent by ID. */
function findById(id: string, list: Agent[]): Agent | undefined {
  for (const agent of list) {
    if (agent.id === id) return agent;
    if (agent.subAgents) {
      const found = findById(id, agent.subAgents);
      if (found) return found;
    }
  }
}

/** Immutably update one agent in a tree. */
function updateInTree(list: Agent[], id: string, updater: (a: Agent) => Agent): Agent[] {
  return list.map(agent => {
    if (agent.id === id) return updater(agent);
    if (agent.subAgents) return { ...agent, subAgents: updateInTree(agent.subAgents, id, updater) };
    return agent;
  });
}

/** Build roleMap from agent tree. Key: "teamId:role" → agentId. */
function buildRoleMap(agents: Agent[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const team of agents) {
    if (!team.subAgents) continue;
    for (const sub of team.subAgents) {
      const key = `${team.id}:${sub.role.toLowerCase()}`;
      map[key] = sub.id;
      // Also add without team prefix for fallback lookups
      const globalKey = `:${sub.role.toLowerCase()}`;
      if (!map[globalKey]) map[globalKey] = sub.id;
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentState>()(devtools((set, get) => ({
  agents: INITIAL_AGENTS,
  isLoadingTeams: false,
  roleMap: buildRoleMap(INITIAL_AGENTS),

  loadTeams: async () => {
    set({ isLoadingTeams: true });
    try {
      const response = await agentServiceV2.getTeams();
      const teams = response.teams;
      if (!teams || !Array.isArray(teams)) return [];

      const teamAgentsPromises = teams.map(async (team: any) => {
        let subAgents: Agent[] = [];
        try {
          const agentsResponse = await agentServiceV2.getAgents(team.id);
          if (agentsResponse.agents?.length > 0) {
            subAgents = agentsResponse.agents.map((agent: any) => ({
              id: agent.id,
              name: agent.name,
              role: agent.role,
              description: agent.goal,
              icon: getIconForRole(agent.role),
              subAgents: [],
              collapsed: false,
              parentId: team.id,
            }));
          }
        } catch { /* no agents */ }

        return {
          id: team.id,
          name: team.name,
          role: 'Manager',
          description: team.description || team.goal,
          systemInstruction: `Backend-managed orchestrator for: "${team.goal}"`,
          icon: 'Cpu',
          subAgents,
          collapsed: false,
        } as Agent;
      });

      const teamAgents = await Promise.all(teamAgentsPromises);

      set(prev => {
        const existingIds = new Set(prev.agents.map(a => a.id));
        const newAgents = teamAgents.filter(ta => !existingIds.has(ta.id));
        const nextAgents = [...prev.agents, ...newAgents];
        return { agents: nextAgents, roleMap: buildRoleMap(nextAgents) };
      });

      return teamAgents;
    } catch (err) {
      logger.error('[agentStore] Failed to load teams:', err);
      return [];
    } finally {
      set({ isLoadingTeams: false });
    }
  },

  createTeam: async (name, goal, description) => {
    try {
      const teamResponse = await agentServiceV2.createTeam(name, goal, description);
      const team = teamResponse.team;

      const orchestratorAgent: Agent = {
        id: team.id,
        name: team.name,
        role: team.name,
        description: team.description || goal,
        systemInstruction: `Backend-managed orchestrator for: "${goal}"`,
        icon: 'Cpu',
        subAgents: [],
        collapsed: false,
      };

      set(prev => {
        const nextAgents = [...prev.agents, orchestratorAgent];
        return { agents: nextAgents, roleMap: buildRoleMap(nextAgents) };
      });

      // Fetch discovered agents
      try {
        const agentsResponse = await agentServiceV2.getAgents(team.id);
        if (agentsResponse.agents?.length > 0) {
          const subAgents: Agent[] = agentsResponse.agents.map((agent: any) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            description: agent.goal,
            icon: getIconForRole(agent.role),
            subAgents: [],
            collapsed: false,
            parentId: team.id,
          }));

          set(prev => {
            const nextAgents = prev.agents.map(a =>
              a.id === team.id ? { ...a, subAgents } : a
            );
            return { agents: nextAgents, roleMap: buildRoleMap(nextAgents) };
          });

          return { ...orchestratorAgent, subAgents };
        }
      } catch { /* no agents yet */ }

      return orchestratorAgent;
    } catch (err) {
      logger.error('[agentStore] Failed to create team:', err);
      throw err;
    }
  },

  addLocalSubAgent: (parentId, agentData) => {
    const newAgent: Agent = {
      id: uuidv4(),
      name: agentData.name || 'New Agent',
      role: agentData.role || 'Specialist',
      description: agentData.description || '',
      icon: agentData.icon || 'Bot',
      subAgents: [],
      collapsed: false,
      parentId,
    };
    set(prev => {
      const nextAgents = prev.agents.map(agent => {
        if (agent.id === parentId) {
          return { ...agent, subAgents: [...(agent.subAgents ?? []), newAgent], collapsed: false };
        }
        return agent;
      });
      return { agents: nextAgents, roleMap: buildRoleMap(nextAgents) };
    });
  },

  handleToggleCollapse: (agentId) => {
    set(prev => ({
      agents: updateInTree(prev.agents, agentId, a => ({ ...a, collapsed: !a.collapsed })),
    }));
    // roleMap doesn't change on collapse — skip rebuild
  },

  findAgentById: (id) => findById(id, get().agents),

  findAgentByRole: (role, teamId) => {
    const { roleMap, agents } = get();
    // Try team-scoped first
    if (teamId) {
      const key = `${teamId}:${role.toLowerCase()}`;
      const agentId = roleMap[key];
      if (agentId) return findById(agentId, agents);
    }
    // Fallback: global (first match)
    const globalKey = `:${role.toLowerCase()}`;
    const agentId = roleMap[globalKey];
    if (agentId) return findById(agentId, agents);
    return undefined;
  },
}), { name: 'AgentStore' }));
