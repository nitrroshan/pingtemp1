/**
 * useAgentTree — manages the agent hierarchy
 *
 * Handles:
 * - Loading teams and their agents from backend
 * - Agent selection
 * - Collapse/expand
 * - Adding new agents and teams
 * - Creating local sub-agents
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2 } from '../services/AgentServiceV2';
import { getIconForRole } from '../assets/icons';
import { INITIAL_AGENTS } from '../dummyData/constants';
import type { Agent } from '../types';

export function useAgentTree() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const agentsRef = useRef<Agent[]>(agents);

  // Keep ref in sync
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const findAgentById = useCallback((id: string, list: Agent[] = agentsRef.current): Agent | undefined => {
    for (const agent of list) {
      if (agent.id === id) return agent;
      if (agent.subAgents) {
        const found = findAgentById(id, agent.subAgents);
        if (found) return found;
      }
    }
  }, []);

  const updateAgents = useCallback((list: Agent[], id: string, updater: (a: Agent) => Agent): Agent[] => {
    return list.map(agent => {
      if (agent.id === id) return updater(agent);
      if (agent.subAgents) return { ...agent, subAgents: updateAgents(agent.subAgents, id, updater) };
      return agent;
    });
  }, []);

  const handleToggleCollapse = useCallback((agentId: string) => {
    setAgents(prev => updateAgents(prev, agentId, a => ({ ...a, collapsed: !a.collapsed })));
  }, [updateAgents]);

  const addSubAgentToParent = useCallback((list: Agent[], parentId: string, newAgent: Agent): Agent[] => {
    return list.map(agent => {
      if (agent.id === parentId) {
        return { ...agent, subAgents: [...(agent.subAgents ?? []), newAgent], collapsed: false };
      }
      return agent;
    });
  }, []);

  /**
   * Load teams from backend and merge into agent tree
   */
  const loadTeams = useCallback(async () => {
    setIsLoadingTeams(true);
    try {
      const response = await agentServiceV2.getTeams();
      const teams = response.teams;
      if (!teams || !Array.isArray(teams)) return [];

      const teamAgentsPromises = teams.map(async (team) => {
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

      setAgents(prev => {
        const existingIds = new Set(prev.map(a => a.id));
        const newAgents = teamAgents.filter(ta => !existingIds.has(ta.id));
        return [...prev, ...newAgents];
      });

      return teamAgents;
    } catch (err) {
      console.error('[useAgentTree] Failed to load teams:', err);
      return [];
    } finally {
      setIsLoadingTeams(false);
    }
  }, []);

  /**
   * Create a new team (workflow) on the backend and add to tree
   */
  const createTeam = useCallback(async (name: string, goal: string, description: string): Promise<Agent | null> => {
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

      setAgents(prev => [...prev, orchestratorAgent]);

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

          setAgents(prev => prev.map(a =>
            a.id === team.id ? { ...a, subAgents } : a
          ));

          return { ...orchestratorAgent, subAgents };
        }
      } catch { /* no agents yet */ }

      return orchestratorAgent;
    } catch (err) {
      console.error('[useAgentTree] Failed to create team:', err);
      throw err;
    }
  }, []);

  /**
   * Add a local sub-agent to an existing parent
   */
  const addLocalSubAgent = useCallback((parentId: string, agentData: Partial<Agent>) => {
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
    setAgents(prev => addSubAgentToParent(prev, parentId, newAgent));
  }, [addSubAgentToParent]);

  return {
    agents,
    isLoadingTeams,
    agentsRef,
    findAgentById,
    handleToggleCollapse,
    loadTeams,
    createTeam,
    addLocalSubAgent,
  };
}
