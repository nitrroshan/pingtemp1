
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import AgentModal from './components/AgentModal/AgentModal';
import AgentManagerPanel from './components/AgentManagerPanel/AgentManagerPanel';
import { PlanApproval } from './components/PlanApproval';
const CollaborativeEditor = lazy(() => import('./components/CollaborativeEditor').catch(() => ({
  default: () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", color: "#64748b", padding: "40px" }}>
      <div style={{ fontSize: "48px" }}>⚠️</div>
      <div style={{ fontSize: "16px", fontWeight: 600, color: "#ef4444" }}>Failed to load Collaborative Editor</div>
      <div style={{ fontSize: "13px" }}>Check browser console for details. Dependencies may need reinstalling.</div>
      <div style={{ fontSize: "12px", background: "#1e293b", padding: "12px 16px", borderRadius: "6px", fontFamily: "monospace", color: "#94a3b8" }}>
        cd src/AgentChat && yarn install
      </div>
    </div>
  )
})));
import { Agent, ChatSession, Message, Task, TaskStatus, ActiveAgentState, OrchestrationEvent } from './types';
import { INITIAL_AGENTS } from './dummyData/constants';
import { v4 as uuidv4 } from 'uuid';
// V2 API Service - HTTP + Socket
import { agentServiceV2, Task as BackendTask } from './services/AgentServiceV2';
import { getIconForRole } from './assets/icons';

const generateId = () => uuidv4();

// ═══════════════════════════════════════════════════════════════════════════════
// Collab File Tree — shows CRDT documents as a folder/file tree
// ═══════════════════════════════════════════════════════════════════════════════

function CollabFileTree({ teamId, activeDoc, onSelectDoc }: {
  teamId: string | null;
  activeDoc: string;
  onSelectDoc: (doc: string) => void;
}) {
  const [docs, setDocs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [newDocName, setNewDocName] = useState("");

  // Fetch docs from API
  const fetchDocs = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3002/api/collab/${teamId}/docs`);
      const data = await res.json();
      setDocs(data.docs || []);
    } catch {
      setDocs([]);
    }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    fetchDocs();
    // Poll every 10s for new docs
    const interval = setInterval(fetchDocs, 10000);
    return () => clearInterval(interval);
  }, [fetchDocs]);

  // Build tree structure from paths like "goalId/docName"
  const tree = React.useMemo(() => {
    const folders = new Map<string, string[]>();
    for (const doc of docs) {
      const parts = doc.split("/");
      if (parts.length >= 2) {
        const folder = parts.slice(0, -1).join("/");
        const file = parts[parts.length - 1];
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder)!.push(file);
      } else {
        if (!folders.has("")) folders.set("", []);
        folders.get("")!.push(doc);
      }
    }
    return folders;
  }, [docs]);

  return (
    <div className="w-60 border-r border-nexus-800 bg-nexus-950 flex flex-col shrink-0">
      <div className="p-3 border-b border-nexus-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">CRDT Documents</span>
        <button onClick={fetchDocs} className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer" title="Refresh">↻</button>
      </div>

      <div className="flex-1 overflow-auto p-2 text-sm">
        {loading && docs.length === 0 ? (
          <div className="text-slate-500 text-xs p-2">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="text-slate-500 text-xs p-2">No documents yet. Agents create them via the collab tool.</div>
        ) : (
          Array.from(tree.entries()).map(([folder, files]) => (
            <div key={folder} className="mb-2">
              {folder && (
                <div className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 truncate" title={folder}>
                  <span>📂</span>
                  <span className="truncate">{folder.length > 20 ? folder.slice(0, 20) + "..." : folder}</span>
                </div>
              )}
              {files.map((file) => {
                const fullPath = folder ? `${folder}/${file}` : file;
                const isActive = fullPath === activeDoc;
                return (
                  <button
                    key={fullPath}
                    onClick={() => onSelectDoc(fullPath)}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs truncate cursor-pointer transition-colors ${
                      isActive
                        ? "bg-blue-600/20 text-blue-400"
                        : "text-slate-300 hover:bg-nexus-800 hover:text-slate-100"
                    }`}
                    title={fullPath}
                  >
                    📄 {file}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Create new doc */}
      <div className="p-2 border-t border-nexus-800">
        <div className="flex gap-1">
          <input
            type="text"
            value={newDocName}
            onChange={(e) => setNewDocName(e.target.value)}
            placeholder="new-doc-name"
            className="flex-1 px-2 py-1 text-xs bg-nexus-800 border border-nexus-700 rounded text-slate-200 focus:outline-none focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newDocName.trim()) {
                onSelectDoc(newDocName.trim());
                setNewDocName("");
              }
            }}
          />
          <button
            onClick={() => {
              if (newDocName.trim()) {
                onSelectDoc(newDocName.trim());
                setNewDocName("");
              }
            }}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

const App: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const agentsRef = useRef<Agent[]>(agents); // Ref to access current agents in callbacks
  const [activeAgentId, setActiveAgentId] = useState<string>(INITIAL_AGENTS[0].id);
  const activeAgentIdRef = useRef<string>(activeAgentId); // Ref for socket callbacks
  const selectedTeamIdRef = useRef<string | null>(null); // Ref for team scoping in callbacks
  const [chatHistories, setChatHistories] = useState<Record<string, Message[]>>({});
  const [tasks, setTasks] = useState<Record<string, Task[]>>({});

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalParentId, setModalParentId] = useState<string | undefined>(undefined);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isWorkflowsExpanded, setIsWorkflowsExpanded] = useState(false);

  // V2 Socket State - deferred connection until team selected
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  // Orchestration State
  const [activeOrchestrationAgents, setActiveOrchestrationAgents] = useState<ActiveAgentState[]>([]);
  const [orchestrationLogs, setOrchestrationLogs] = useState<OrchestrationEvent[]>([]);
  
  // Auto-execute toggle (when true, approved plans execute immediately)
  const [autoExecuteEnabled, setAutoExecuteEnabled] = useState(true);
  
  // Current plan from backend (for display in Tasks view)
  const [currentPlan, setCurrentPlan] = useState<any[] | null>(null);
  
  // Session state from backend - used to show plan approval modal
  const [sessionState, setSessionState] = useState<string | null>(null);

  // View mode: "chat" (default) or "collaborate" (CRDT editor)
  const [viewMode, setViewMode] = useState<"chat" | "collaborate">("chat");
  const [collabDocId, setCollabDocId] = useState("doc-shared");

  // Keep agentsRef in sync with agents state
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  // Keep activeAgentIdRef in sync
  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  // Keep selectedTeamIdRef in sync for socket callbacks
  useEffect(() => {
    selectedTeamIdRef.current = selectedTeamId;
  }, [selectedTeamId]);

  // Helper to find agent by role name (case-insensitive, with fuzzy matching)
  // Handles cases where plan uses "researcher" but agent role is "market-researcher"
  // When teamId is provided, prioritizes agents from that team to avoid cross-team matching
  const findAgentByRole = useCallback((roleName: string, teamId?: string): Agent | undefined => {
    const normalizedRole = roleName.toLowerCase();
    
    const searchList = (list: Agent[], exactOnly: boolean = false): Agent | undefined => {
      // First pass: exact match
      for (const agent of list) {
        if (agent.role.toLowerCase() === normalizedRole) {
          return agent;
        }
        if (agent.subAgents) {
          const found = searchList(agent.subAgents, exactOnly);
          if (found) return found;
        }
      }
      
      // Second pass: fuzzy match (only if not exactOnly)
      if (!exactOnly) {
        for (const agent of list) {
          const agentRole = agent.role.toLowerCase();
          // Match if agent role ends with the search term or contains it as a word
          if (agentRole.endsWith(normalizedRole) || 
              agentRole.includes(`-${normalizedRole}`) ||
              agentRole.includes(`${normalizedRole}-`) ||
              normalizedRole.endsWith(agentRole) ||
              normalizedRole.includes(agentRole)) {
            console.log(`[findAgentByRole] Fuzzy matched "${roleName}" to agent role "${agent.role}"`);
            return agent;
          }
          if (agent.subAgents) {
            const found = searchList(agent.subAgents, false);
            if (found) return found;
          }
        }
      }
      return undefined;
    };
    
    // If teamId provided, search within that team's agents first
    if (teamId) {
      // Find the team orchestrator
      const teamOrchestrator = agentsRef.current.find(a => a.id === teamId);
      if (teamOrchestrator && teamOrchestrator.subAgents) {
        // Search only in team's subAgents
        const found = searchList(teamOrchestrator.subAgents);
        if (found) return found;
      }
    }
    
    // Fallback: search all agents
    const found = searchList(agentsRef.current);
    if (found) return found;
    
    console.warn(`[findAgentByRole] No match found for role: ${roleName}`);
    return undefined;
  }, []);

  // Orchestration Handlers - defined early so useEffect can use them
  const addOrchestrationLog = (source: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', target?: string) => {
    setOrchestrationLogs(prev => [...prev, {
      id: generateId(),
      timestamp: Date.now(),
      type,
      message,
      source,
      target
    }]);
  };

  // V2 Socket Connection - connects when team is selected
  useEffect(() => {
    if (!selectedTeamId) {
      // No team selected, disconnect if connected
      if (isSocketConnected) {
        console.log('[App] No team selected, disconnecting V2 socket...');
        agentServiceV2.disconnect();
        setIsSocketConnected(false);
      }
      return;
    }

    // Connect V2 socket for the selected team
    console.log('[App] Team selected, connecting V2 socket for team:', selectedTeamId);
    agentServiceV2.connect(selectedTeamId);
    setIsSocketConnected(true);

    // Subscribe to V2 events
    const unsubMessage = agentServiceV2.onMessage((data) => {
      console.log('[App] V2 Message received:', data);
      
      // Parse content if it's a JSON string with 'response' field
      let messageContent = data.content;
      try {
        const parsed = JSON.parse(data.content);
        if (parsed.response) {
          messageContent = parsed.response;
        }
      } catch {
        // Content is not JSON, use as-is
      }
      
      addOrchestrationLog(data.agentId, messageContent.substring(0, 100) + '...', 'info');
      
      // Route message to correct chat history
      // - Manager messages go to the team (orchestrator) chat using selectedTeamId
      // - Worker messages need to find the agent by role name WITHIN THE CURRENT TEAM
      let targetAgentId: string;
      
      if (data.agentId === 'manager') {
        targetAgentId = selectedTeamId;
      } else {
        // Find the current team first
        const currentTeam = agentsRef.current.find(a => a.id === selectedTeamId);
        console.log('[App] Current team:', currentTeam?.name, 'subAgents:', currentTeam?.subAgents?.map(s => ({ id: s.id, role: s.role })));
        // Search only within current team's sub-agents
        const matchedAgent = currentTeam?.subAgents?.find(
          sub => sub.role.toLowerCase() === data.agentId.toLowerCase()
        );
        console.log('[App] findAgentByRole in team:', selectedTeamId, 'for role:', data.agentId, ', result:', matchedAgent?.id);
        if (matchedAgent) {
          targetAgentId = matchedAgent.id;
          
          // Auto-switch to the agent that's receiving the message (for task execution)
          if (data.taskId && activeAgentIdRef.current !== matchedAgent.id) {
            console.log('[App] Auto-switching view to agent:', matchedAgent.id, matchedAgent.name);
            setActiveAgentId(matchedAgent.id);
          }
        } else {
          // Fallback to using role name if no match (shouldn't happen normally)
          console.warn('[App] No agent found for role:', data.agentId, 'in team:', selectedTeamId, '- using role as ID');
          targetAgentId = data.agentId;
        }
      }
      console.log('[App] Routing message to targetAgentId:', targetAgentId);
      
      const newMessage: Message = {
        id: generateId(),
        role: 'model' as const,
        content: messageContent,
        timestamp: data.timestamp || Date.now()
      };
      setChatHistories(prev => ({
        ...prev,
        [targetAgentId]: [...(prev[targetAgentId] || []), newMessage]
      }));
    });

    const unsubState = agentServiceV2.onState((data) => {
      console.log('[App] V2 State update:', data);
      addOrchestrationLog('SYSTEM', `State: ${data.sessionState}`, 'info');
      
      // Update plan if present (full plan data)
      if (data.plan) {
        setCurrentPlan(data.plan);
        
        // Convert backend plan to frontend tasks grouped by agent
        const tasksByAgent: Record<string, Task[]> = {};
        console.log('[App] Processing plan with', data.plan.length, 'tasks');
        
        // Debug: Log all agents including nested subAgents
        const flattenAgents = (list: Agent[], prefix = ''): { id: string; role: string; name: string }[] => {
          let result: { id: string; role: string; name: string }[] = [];
          for (const a of list) {
            result.push({ id: a.id, role: a.role, name: a.name });
            if (a.subAgents && a.subAgents.length > 0) {
              result = result.concat(flattenAgents(a.subAgents, prefix + '  '));
            }
          }
          return result;
        };
        console.log('[App] All available agents (flattened):', flattenAgents(agentsRef.current));
        console.log('[App] Current selected team:', selectedTeamIdRef.current);
        
        data.plan.forEach((backendTask) => {
          console.log('[App] Task:', backendTask.id, 'role:', backendTask.assignedRole);
          // Pass selectedTeamIdRef to scope search to current team
          const agent = findAgentByRole(backendTask.assignedRole, selectedTeamIdRef.current ?? undefined);
          if (agent) {
            console.log('[App] Matched agent:', agent.id, agent.name, 'role:', agent.role);
            const frontendTask: Task = {
              id: backendTask.id,
              title: backendTask.title,
              description: backendTask.description,
              status: (backendTask.status || 'pending') as TaskStatus,
              assignedRole: backendTask.assignedRole,
              priority: backendTask.priority,
              dependencies: backendTask.dependencies,
              completed: backendTask.status === 'completed',
              createdAt: Date.now(),
            };
            if (!tasksByAgent[agent.id]) {
              tasksByAgent[agent.id] = [];
            }
            tasksByAgent[agent.id].push(frontendTask);
          } else {
            console.warn('[App] No agent found for role:', backendTask.assignedRole, '- task dropped!');
          }
        });
        console.log('[App] Final tasksByAgent:', Object.keys(tasksByAgent), Object.values(tasksByAgent).map(t => t.length));
        setTasks(tasksByAgent);
      }
      
      // Handle task status updates (partial updates for individual tasks)
      if (data.tasks && Array.isArray(data.tasks)) {
        setTasks(prev => {
          const updated = { ...prev };
          data.tasks!.forEach((taskUpdate: any) => {
            // Find which agent has this task and update it
            for (const agentId in updated) {
              const taskIndex = updated[agentId].findIndex(t => t.id === taskUpdate.id);
              if (taskIndex >= 0) {
                updated[agentId] = [...updated[agentId]];
                updated[agentId][taskIndex] = {
                  ...updated[agentId][taskIndex],
                  status: taskUpdate.status as TaskStatus,
                  completed: taskUpdate.status === 'completed',
                };
                break;
              }
            }
          });
          return updated;
        });
      }
      
      // Update autoExecute if present in response
      if (data.autoExecute !== undefined) {
        setAutoExecuteEnabled(data.autoExecute);
      }
      
      // Track session state for approval modal
      if (data.sessionState) {
        setSessionState(data.sessionState);
      }
    });

    const unsubOutput = agentServiceV2.onOutput((data) => {
      console.log('[App] V2 Output received:', data);
      addOrchestrationLog(data.agentId, `Output: ${data.output.content.substring(0, 100)}...`, 'success');
    });

    const unsubError = agentServiceV2.onError((data) => {
      console.error('[App] V2 Error:', data);
      addOrchestrationLog('ERROR', data.error, 'error');
    });

    // Cleanup on unmount or team change
    return () => {
      console.log('[App] Cleaning up V2 socket subscriptions...');
      unsubMessage();
      unsubState();
      unsubOutput();
      unsubError();
      agentServiceV2.disconnect();
      setIsSocketConnected(false);
    };
  }, [selectedTeamId]);

  // Fetch teams using V2 HTTP API
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        console.log('[App] Fetching teams from backend (V2 API)...');
        const response = await agentServiceV2.getTeams();
        const teams = response.teams;
        console.log('[App] Teams fetched:', teams);
        
        if (teams && Array.isArray(teams)) {
          const orchestrationAgents: ActiveAgentState[] = teams.map(team => ({
            id: team.id,
            name: team.name,
            status: 'completed' as const,
            currentTask: team.goal,
            reasoning: team.description || team.goal,
            assignedAt: Date.now()
          }));
          
          setActiveOrchestrationAgents(orchestrationAgents);
          console.log('[App] Active orchestration agents updated from teams:', orchestrationAgents);
          
          // Also update agents state so Sidebar can display them
          const teamAgentsPromises = teams.map(async (team) => {
            let subAgents: Agent[] = [];
            
            // Fetch agents for this team using V2 API
            try {
              console.log('[App] Fetching agents for team:', team.id);
              const agentsResponse = await agentServiceV2.getAgents(team.id);
              console.log('[App] Agents fetched for team', team.id, ':', agentsResponse.agents);
              
              if (agentsResponse.agents && agentsResponse.agents.length > 0) {
                subAgents = agentsResponse.agents.map(agent => ({
                  id: agent.id,
                  name: agent.name,
                  role: agent.role,
                  description: agent.goal,
                  icon: getIconForRole(agent.role),
                  subAgents: [],
                  collapsed: false,
                  parentId: team.id
                }));
              }
            } catch (agentError) {
              console.error('[App] Failed to fetch agents for team', team.id, ':', agentError);
            }
            
            return {
              id: team.id,
              name: team.name,
              role: 'Manager',
              description: team.description || team.goal,
              systemInstruction: `Backend-managed orchestrator for: "${team.goal}"`,
              icon: 'Cpu',
              subAgents: subAgents,
              collapsed: false
            };
          });
          
          const teamAgents = await Promise.all(teamAgentsPromises);
          
          setAgents(prev => {
            // Merge with existing agents, avoiding duplicates
            const existingIds = new Set(prev.map(a => a.id));
            const newAgents = teamAgents.filter(ta => !existingIds.has(ta.id));
            return [...prev, ...newAgents];
          });
          console.log('[App] Agents state updated with teams and their agents');
        }
      } catch (error) {
        console.error('[App] Failed to fetch teams:', error);
      }
    };

    fetchTeams();
  }, []); // Fetch once on mount

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  const findAgentById = (id: string, list: Agent[]): Agent | undefined => {
    for (const agent of list) {
      if (agent.id === id) return agent;
      if (agent.subAgents) {
        const found = findAgentById(id, agent.subAgents);
        if (found) return found;
      }
    }
    return undefined;
  };

  const updateAgents = (list: Agent[], id: string, updater: (a: Agent) => Agent): Agent[] => {
    return list.map(agent => {
      if (agent.id === id) {
        return updater(agent);
      }
      if (agent.subAgents) {
        return { ...agent, subAgents: updateAgents(agent.subAgents, id, updater) };
      }
      return agent;
    });
  };

 


  const createSubAgent = (agentData: Partial<Agent>): Agent => {
    return {
      id: generateId(),
      name: agentData.name || 'New Agent',
      role: agentData.role || 'Specialist',
      description: agentData.description || '',
      // systemInstruction: agentData.systemInstruction || '',
      icon: agentData.icon || 'Bot',
      subAgents: [],
      collapsed: false,
      parentId: agentData.parentId
    };
  };

  const addSubAgentToParent = (list: Agent[], parentId: string, newAgent: Agent): Agent[] => {
    return list.map(agent => {
      if (agent.id === parentId) {
        return {
          ...agent,
          subAgents: [...(agent.subAgents || []), newAgent],
          collapsed: false
        };
      }
      // if (agent.subAgents) {
      //   return { ...agent, subAgents: addSubAgentToParent(agent.subAgents, parentId, newAgent) };
      // }
      return agent;
    });
  };

  const createAgentFromRole = (role: any): Agent => {
    return {
      id: role.id || generateId(), // Use database ID if available
      name: role.name, // Use role identifier as name since AgentConfig doesn't have name
      role: role.role,
      description: role.goal || 'Backend-managed agent',
      // systemInstruction: role.systemPrompt || `Agent for ${role.role} role`,
      icon: getIconForRole(role.role),
      subAgents: [],
      collapsed: false,
      parentId: role.teamId // Store teamId as parentId for relationship
    };
  };

  const updateOrchestratorWithSubAgents = (
    agentsList: Agent[], 
    subAgents: Agent[]
  ): Agent[] => {
    // Group subAgents by their parentId (teamId)
    const agentsByParent = subAgents.reduce((acc, agent) => {
      const parentId = agent.parentId;
      if (parentId) {
        if (!acc[parentId]) acc[parentId] = [];
        acc[parentId].push(agent);
      }
      return acc;
    }, {} as Record<string, Agent[]>);

    // Update agents list
    let updatedAgents = [...agentsList];
    
    Object.entries(agentsByParent).forEach(([teamId, childAgents]) => {
      const orchestratorIndex = updatedAgents.findIndex(a => a.id === teamId);
      
      if (orchestratorIndex !== -1) {
        updatedAgents[orchestratorIndex] = {
          ...updatedAgents[orchestratorIndex],
          subAgents: childAgents
        };
      } else {
        console.warn(`[App] No orchestrator found for teamId: ${teamId}`);
      }
    });

    return updatedAgents;
  };

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const activeAgent = findAgentById(activeAgentId, agents);
  const isMainAgent = agents.some(a => a.id === activeAgentId);

  // ============================================================================
  // AGENT HANDLERS
  // ============================================================================

  const handleSelectAgent = (agent: Agent) => {
    setActiveAgentId(agent.id);
    
    // If this is a top-level agent (team), update selectedTeamId to trigger socket connection
    const isTeam = agents.some(a => a.id === agent.id);
    if (isTeam) {
      console.log('[App] Team selected, will connect V2 socket:', agent.id);
      setSelectedTeamId(agent.id);
    } else {
      // Sub-agent selected - find parent team
      const parentTeam = agents.find(a => a.subAgents?.some(sub => sub.id === agent.id));
      if (parentTeam) {
        console.log('[App] Sub-agent selected, connecting to parent team:', parentTeam.id);
        setSelectedTeamId(parentTeam.id);
      }
    }
  };

  const handleToggleCollapse = (agentId: string) => {
    setAgents(prev => updateAgents(prev, agentId, (a) => ({ ...a, collapsed: !a.collapsed })));
  };

  const handleOpenAddAgentModal = (parentId?: string) => {
    setModalParentId(parentId);
    setIsModalOpen(true);
  };

  const handleAddAgent = async (agentData: Partial<Agent>) => {
    // Case 1: New Workflow - Create task via backend AgentManager API
    if (!agentData.parentId) {
      const workflowName = agentData.name || "AgentManager";
      const workflowGoal = agentData.description || "General Task";
      
      try {
        console.log('[App] Creating team via V2 API:', workflowGoal);
        
        // Use V2 API for team creation
        const teamResponse = await agentServiceV2.createTeam(
          workflowName,
          workflowGoal,
          workflowGoal
        );
        
        // Create a UI representation of the orchestrator
        const orchestratorAgent = {
          id: teamResponse.team.id,
          name: teamResponse.team.name,
          role: teamResponse.team.name,
          description: teamResponse.team.description || workflowGoal,
          systemInstruction: `Backend-managed orchestrator for: "${workflowGoal}"`,
          icon: 'Cpu',
          subAgents: [],
          collapsed: false
        };
        
        setAgents(prev => [...prev, orchestratorAgent]);
        setActiveAgentId(orchestratorAgent.id);
        // Connect V2 socket for new team
        setSelectedTeamId(orchestratorAgent.id);
        console.log('[App] Team created successfully:', teamResponse);
        addOrchestrationLog('SYSTEM', `Team created: ${workflowGoal}`, 'success');
        
        // Fetch discovered agents from backend using V2 API
        try {
          console.log('[App] Fetching discovered agents...');
          const agentsResponse = await agentServiceV2.getAgents(teamResponse.team.id);
          const agents = agentsResponse.agents;
          console.log('[App] Agents discovered:', agents);
          
          if (agents && Array.isArray(agents) && agents.length > 0) {
            const agentNames = agents.map((a: any) => a.name).join(', ');
            addOrchestrationLog('BACKEND', `Discovered agents: ${agentNames}`, 'success');
            
            // Create agent cards dynamically for each discovered agent
            const newAgents: Agent[] = agents.map(agent => ({
              id: agent.id,
              name: agent.name,
              role: agent.role,
              description: agent.goal,
              icon: getIconForRole(agent.role),
              subAgents: [],
              collapsed: false,
              parentId: teamResponse.team.id
            }));
            
            // Update orchestrator with discovered sub-agents
            setAgents(prev => {
              const updatedAgents = updateOrchestratorWithSubAgents(prev, newAgents);
              console.log('[App] Updated agents with orchestrator');
              return updatedAgents;
            });
            
            console.log('[App] Created agent cards for agents:', agentNames);
          }
        } catch (agentError: any) {
          console.error('[App] Failed to fetch agents:', agentError);
          addOrchestrationLog('SYSTEM', `Failed to fetch agents: ${agentError.message}`, 'warning');
        }
        
      } catch (error: any) {
        console.error('[App] Failed to create team:', error);
        addOrchestrationLog('SYSTEM', `Failed to create team: ${error.message}`, 'error');
        alert(`Failed to create team: ${error.message}`);
      }
    } 
    // Case 2: Adding Sub-Agent to existing Orchestrator
    else {
      const newAgent = createSubAgent(agentData);
      setAgents(prev => addSubAgentToParent(prev, agentData.parentId!, newAgent));
    }
  };

  // ============================================================================
  // MESSAGE HANDLERS
  // ============================================================================

  // Toggle auto-execute mode
  const handleToggleAutoExecute = useCallback(() => {
    const newValue = !autoExecuteEnabled;
    setAutoExecuteEnabled(newValue);
    agentServiceV2.autoExecute(newValue);
    addOrchestrationLog('SYSTEM', `Auto-execute ${newValue ? 'enabled' : 'disabled'}`, 'info');
  }, [autoExecuteEnabled]);

  // Approve the current plan
  const handleApprovePlan = useCallback(() => {
    agentServiceV2.approvePlan();
    addOrchestrationLog('SYSTEM', 'Plan approved, starting execution...', 'success');
    setSessionState('executing');
  }, []);

  // Task lifecycle handlers - call V2 API
  const handleStartTask = useCallback((taskId: string) => {
    agentServiceV2.startTask(taskId);
    addOrchestrationLog('SYSTEM', `Starting task: ${taskId}`, 'info');
  }, []);

  const handleCompleteTask = useCallback((taskId: string) => {
    agentServiceV2.completeTask(taskId);
    addOrchestrationLog('SYSTEM', `Completing task: ${taskId}`, 'success');
  }, []);

  const handleCancelTask = useCallback((taskId: string) => {
    agentServiceV2.cancelTask(taskId);
    addOrchestrationLog('SYSTEM', `Cancelling task: ${taskId}`, 'warning');
  }, []);

  // Overloaded: can accept full array OR single message to append
  // Wrapped in useCallback to prevent recreation on every render (causes useEffect re-runs)
  const handleUpdateMessages = useCallback((agentId: string, messagesOrSingle: Message[] | Message) => {
    setChatHistories(prev => {
      const current = prev[agentId] || [];
      // If it's an array, replace; if single message, append
      const newMessages = Array.isArray(messagesOrSingle) 
        ? messagesOrSingle 
        : [...current, messagesOrSingle];
      return {
        ...prev,
        [agentId]: newMessages
      };
    });
  }, []);

  // ============================================================================
  // TASK HANDLERS
  // ============================================================================

  const handleAddTask = (agentId: string, title: string) => {
    const newTask: Task = {
      id: generateId(),
      title,
      status: 'ready',
      completed: false,
      createdAt: Date.now()
    };
    setTasks(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), newTask]
    }));
    
    if (isMainAgent) {
      addOrchestrationLog('TASK', `Created task: "${title}"`, 'success');
    }
  };

  const handleToggleTask = (agentId: string, taskId: string) => {
    setTasks(prev => ({
      ...prev,
      [agentId]: (prev[agentId] || []).map(t => 
        t.id === taskId ? { ...t, completed: !t.completed } : t
      )
    }));
  };

  const handleDeleteTask = (agentId: string, taskId: string) => {
    setTasks(prev => ({
      ...prev,
      [agentId]: (prev[agentId] || []).filter(t => t.id !== taskId)
    }));
  };

 
  // ============================================================================
  // ORCHESTRATION HANDLERS
  // ============================================================================

  const handleAssignTask = (agentName: string, taskDescription: string, reasoning: string) => {
    const agentId = generateId(); 
    
    setActiveOrchestrationAgents(prev => [
      ...prev, 
      {
        id: agentId,
        name: agentName,
        status: 'working',
        currentTask: taskDescription,
        reasoning: reasoning,
        assignedAt: Date.now()
      }
    ]);

    addOrchestrationLog('ORCHESTRATOR', taskDescription, 'info', agentName.toUpperCase());
    
    setTimeout(() => {
        addOrchestrationLog(agentName.toUpperCase(), `Acknowledged. ${reasoning.substring(0, 30)}...`, 'warning', 'ORCHESTRATOR');
    }, 1200);

    setTimeout(() => {
        setActiveOrchestrationAgents(prev => prev.map(a => 
            a.id === agentId ? { ...a, status: 'completed' } : a
        ));
        addOrchestrationLog(agentName.toUpperCase(), `Task completed: ${taskDescription}`, 'success', 'ORCHESTRATOR');
    }, 4000 + Math.random() * 3000);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex flex-col h-screen w-full bg-nexus-950 font-sans text-slate-200">
      {/* Top tab bar */}
      <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b border-nexus-800 bg-nexus-900 shrink-0">
        <button
          onClick={() => setViewMode("chat")}
          className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
            viewMode === "chat"
              ? "bg-blue-600 text-white"
              : "bg-nexus-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setViewMode("collaborate")}
          className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
            viewMode === "collaborate"
              ? "bg-blue-600 text-white"
              : "bg-nexus-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          Collaborate
        </button>
      </div>

      <div className="flex flex-1 min-h-0">

      {viewMode === "collaborate" ? (
        /* Full-screen collaborative editor with file tree */
        <div className="flex-1 flex min-h-0">
          {/* Document tree sidebar */}
          <CollabFileTree
            teamId={selectedTeamId}
            activeDoc={collabDocId}
            onSelectDoc={setCollabDocId}
          />
          {/* Editor area */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <div className="flex items-center gap-3 p-3 border-b border-nexus-800 bg-nexus-900 shrink-0">
              <span className="text-sm text-slate-400">Document:</span>
              <span className="text-sm text-slate-200 font-mono truncate">{collabDocId || "none selected"}</span>
            </div>
            <div className="flex-1 bg-white overflow-auto min-h-0">
              {collabDocId ? (
                <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading editor...</div>}>
                  <CollaborativeEditor
                    key={collabDocId}
                    docId={`${selectedTeamId || "default"}/${collabDocId}`}
                    userName="User"
                    userColor="#3b82f6"
                    serverUrl={`ws://localhost:${import.meta.env.VITE_COLLAB_PORT || "1234"}`}
                  />
                </Suspense>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  Select a document from the sidebar
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Normal chat view */
        <>
          <Sidebar 
            agents={agents}
            activeAgentId={activeAgentId}
            onSelectAgent={handleSelectAgent}
            onToggleCollapse={handleToggleCollapse}
            onAddAgent={handleOpenAddAgentModal}
            isWorkflowsExpanded={isWorkflowsExpanded}
            onToggleWorkflows={() => setIsWorkflowsExpanded(!isWorkflowsExpanded)}
          />
      
          {activeAgent ? (
            <ChatArea 
              key={activeAgent.id}
              agent={activeAgent}
              messages={chatHistories[activeAgentId] || []}
              tasks={tasks[activeAgentId] || []}
              teamId={selectedTeamId}
              onUpdateMessages={handleUpdateMessages}
              onAddTask={handleAddTask}
              onToggleTask={handleToggleTask}
              onDeleteTask={handleDeleteTask}
              onAssignTask={handleAssignTask}
              apiKey={process.env.API_KEY || ''}
              
              onToggleWorkflows={() => setIsWorkflowsExpanded(!isWorkflowsExpanded)}
              isWorkflowsExpanded={isWorkflowsExpanded}
              
              onToggleOrchestrator={() => setIsPanelOpen(!isPanelOpen)}
              isOrchestratorOpen={isPanelOpen}
              
              autoExecuteEnabled={autoExecuteEnabled}
              onToggleAutoExecute={handleToggleAutoExecute}
              
              currentPlan={currentPlan}
              
              onStartTask={handleStartTask}
              onCompleteTask={handleCompleteTask}
              onCancelTask={handleCancelTask}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              Select an agent to start.
            </div>
          )}

          {isPanelOpen && (
            <AgentManagerPanel 
              activeAgents={activeOrchestrationAgents}
              logs={orchestrationLogs}
              onClose={() => setIsPanelOpen(false)}
            />
          )}
        </>
      )}
      </div>

      {/* Plan Approval Modal - show when awaiting approval */}
      {sessionState === 'awaiting_approval' && currentPlan && currentPlan.length > 0 && (
        <PlanApproval
          plan={currentPlan as BackendTask[]}
          onApprove={handleApprovePlan}
          onDismiss={() => setSessionState(null)}
        />
      )}

      <AgentModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleAddAgent}



        parentAgents={agents}
        initialParentId={modalParentId}
      />
    </div>
  );
};

export default App;
