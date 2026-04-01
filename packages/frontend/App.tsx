/**
 * App — main application entry point (Phase 1 refactor)
 *
 * Uses extracted hooks:
 *   useOrchestration — plan/task state, socket events
 *   useChat          — per-agent message histories
 *   useAgentTree     — agent hierarchy, team loading
 *
 * Routes (React Router):
 *   /*  → InnerApp (handles all navigation internally)
 */

import React, { useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';

import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import AgentModal from './components/AgentModal/AgentModal';
import AgentManagerPanel from './components/AgentManagerPanel/AgentManagerPanel';
import { PlanApproval } from './components/PlanApproval';
import GoalInput from './components/GoalInput/GoalInput';
import TaskDashboard from './components/TaskDashboard/TaskDashboard';
import { ToastContainer, useToast } from './components/Toast/Toast';

const CollaborativeEditor = lazy(() => import('./components/CollaborativeEditor').catch(() => ({
  default: () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", color: "#64748b", padding: "40px" }}>
      <div style={{ fontSize: "48px" }}>⚠️</div>
      <div style={{ fontSize: "16px", fontWeight: 600, color: "#ef4444" }}>Failed to load Collaborative Editor</div>
      <div style={{ fontSize: "13px" }}>Check browser console for details.</div>
    </div>
  )
})));

import { useOrchestration } from './hooks/useOrchestration';
import { useChat } from './hooks/useChat';
import { useAgentTree } from './hooks/useAgentTree';
import { agentServiceV2, type Task as BackendTask } from './services/AgentServiceV2';
import type { Agent, Message } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// CollabFileTree — lightweight CRDT doc browser
// ─────────────────────────────────────────────────────────────────────────────

function CollabFileTree({ teamId, activeDoc, onSelectDoc }: {
  teamId: string | null; activeDoc: string; onSelectDoc: (d: string) => void;
}) {
  const [docs, setDocs] = React.useState<string[]>([]);
  const [newDocName, setNewDocName] = React.useState('');

  React.useEffect(() => {
    if (!teamId) return;
    const load = () =>
      fetch(`http://localhost:3002/api/collab/${teamId}/docs`)
        .then(r => r.json()).then(d => setDocs(d.docs || [])).catch(() => {});
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [teamId]);

  return (
    <div className="w-60 border-r border-nexus-800 bg-nexus-950 flex flex-col shrink-0">
      <div className="p-3 border-b border-nexus-800">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">CRDT Documents</span>
      </div>
      <div className="flex-1 overflow-auto p-2 text-sm">
        {docs.length === 0
          ? <div className="text-slate-500 text-xs p-2">No documents yet.</div>
          : docs.map(doc => (
            <button key={doc} onClick={() => onSelectDoc(doc)}
              className={`w-full text-left px-3 py-1.5 rounded text-xs truncate transition-colors cursor-pointer ${doc === activeDoc ? 'bg-blue-600/20 text-blue-400' : 'text-slate-300 hover:bg-nexus-800'}`}>
              📄 {doc}
            </button>
          ))}
      </div>
      <div className="p-2 border-t border-nexus-800 flex gap-1">
        <input value={newDocName} onChange={e => setNewDocName(e.target.value)} placeholder="new-doc"
          onKeyDown={e => { if (e.key === 'Enter' && newDocName.trim()) { onSelectDoc(newDocName.trim()); setNewDocName(''); } }}
          className="flex-1 px-2 py-1 text-xs bg-nexus-800 border border-nexus-700 rounded text-slate-200 focus:outline-none" />
        <button onClick={() => { if (newDocName.trim()) { onSelectDoc(newDocName.trim()); setNewDocName(''); } }}
          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer">+</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InnerApp
// ─────────────────────────────────────────────────────────────────────────────

function InnerApp() {
  const navigate = useNavigate();
  const { toasts, showToast, dismissToast } = useToast();

  const { agents, agentsRef, findAgentById, handleToggleCollapse, loadTeams, createTeam, addLocalSubAgent } = useAgentTree();
  const { chatHistories, addMessage, updateMessages } = useChat();
  const {
    sessionState, currentPlan, tasks, autoExecuteEnabled, orchestrationLogs,
    handleApprovePlan, handleStartTask, handleCompleteTask, handleCancelTask,
    handleToggleAutoExecute, addOrchestrationLog, setSessionState, subscribeToTeam,
  } = useOrchestration();

  const [activeAgentId, setActiveAgentId] = useState<string>(agents[0]?.id ?? '');
  const activeAgentIdRef = useRef(activeAgentId);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const selectedTeamIdRef = useRef<string | null>(null);
  const connectedTeamRef = useRef<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalParentId, setModalParentId] = useState<string | undefined>(undefined);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isWorkflowsExpanded, setIsWorkflowsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'tasks' | 'collaborate'>('chat');
  const [collabDocId, setCollabDocId] = useState('doc-shared');

  useEffect(() => { activeAgentIdRef.current = activeAgentId; }, [activeAgentId]);
  useEffect(() => { selectedTeamIdRef.current = selectedTeamId; }, [selectedTeamId]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  // Socket connection + orchestration event subscriptions
  useEffect(() => {
    if (!selectedTeamId) {
      if (connectedTeamRef.current) {
        agentServiceV2.disconnect();
        connectedTeamRef.current = null;
      }
      return;
    }
    if (connectedTeamRef.current === selectedTeamId) return;
    connectedTeamRef.current = selectedTeamId;

    agentServiceV2.connect(selectedTeamId)
      .catch(err => { connectedTeamRef.current = null; showToast(`Connection failed: ${err.message}`, 'error'); });

    const unsub = subscribeToTeam(
      selectedTeamId, agentsRef, selectedTeamIdRef,
      (agentId, content, taskId, timestamp) => {
        addMessage(agentId, { id: uuidv4(), role: 'model', content, timestamp: timestamp ?? Date.now() });
        if (taskId && activeAgentIdRef.current !== agentId) setActiveAgentId(agentId);
      },
    );
    return unsub;
  }, [selectedTeamId, subscribeToTeam, agentsRef, addMessage, showToast]);

  // Error toasts from orchestration logs
  const prevLogsLen = useRef(0);
  useEffect(() => {
    const newLogs = orchestrationLogs.slice(prevLogsLen.current);
    prevLogsLen.current = orchestrationLogs.length;
    newLogs.filter(l => l.type === 'error').forEach(l => showToast(l.message, 'error'));
  }, [orchestrationLogs, showToast]);

  const handleSelectAgent = useCallback((agent: Agent) => {
    setActiveAgentId(agent.id);
    const isTeam = agents.some(a => a.id === agent.id);
    if (isTeam) {
      setSelectedTeamId(agent.id);
    } else {
      const parent = agents.find(a => a.subAgents?.some(s => s.id === agent.id));
      if (parent) setSelectedTeamId(parent.id);
    }
  }, [agents]);

  const handleGoalSubmit = useCallback(async (goal: string) => {
    if (!selectedTeamId) { showToast('Please select a team first', 'warning'); return; }
    addMessage(selectedTeamId, { id: uuidv4(), role: 'user', content: goal, timestamp: Date.now() });
    try {
      agentServiceV2.sendToManager(goal);
    } catch (err: any) {
      showToast(`Failed to send goal: ${err.message}`, 'error');
    }
  }, [selectedTeamId, addMessage, showToast]);

  const handleApprove = useCallback((_tasks?: BackendTask[]) => {
    handleApprovePlan();
  }, [handleApprovePlan]);

  const handleAddAgent = useCallback(async (agentData: Partial<Agent>) => {
    if (!agentData.parentId) {
      try {
        const team = await createTeam(agentData.name ?? 'New Team', agentData.description ?? 'General task', agentData.description ?? '');
        if (team) {
          setActiveAgentId(team.id);
          setSelectedTeamId(team.id);
          showToast(`Team "${team.name}" created`, 'success');
          addOrchestrationLog('SYSTEM', `Team created: ${team.name}`, 'success');
        }
      } catch (err: any) {
        showToast(`Failed to create team: ${err.message}`, 'error');
      }
    } else {
      addLocalSubAgent(agentData.parentId, agentData);
    }
  }, [createTeam, addLocalSubAgent, showToast, addOrchestrationLog]);

  const allTasks = Object.values(tasks).flat();
  const activeAgent = findAgentById(activeAgentId);
  const activeAgentTasks = tasks[activeAgentId] ?? [];
  const activeAgentMessages = chatHistories[activeAgentId] ?? [];
  const isGoalInputVisible = agents.some(a => a.id === activeAgentId) && !!selectedTeamId;

  return (
    <div className="flex flex-col h-screen w-full bg-nexus-950 font-sans text-slate-200">
      {/* Tab bar */}
      <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b border-nexus-800 bg-nexus-900 shrink-0">
        {(['chat', 'tasks', 'collaborate'] as const).map(mode => (
          <button key={mode} onClick={() => setViewMode(mode)}
            className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${viewMode === mode ? 'bg-blue-600 text-white' : 'bg-nexus-800 text-slate-400 hover:text-slate-200'}`}>
            {mode === 'tasks' ? 'Task Dashboard' : mode === 'collaborate' ? 'Collaborate' : 'Chat'}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">

        {viewMode === 'collaborate' ? (
          <div className="flex-1 flex min-h-0">
            <CollabFileTree teamId={selectedTeamId} activeDoc={collabDocId} onSelectDoc={setCollabDocId} />
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div className="flex items-center gap-3 p-3 border-b border-nexus-800 bg-nexus-900 shrink-0">
                <span className="text-sm text-slate-400">Document:</span>
                <span className="text-sm text-slate-200 font-mono truncate">{collabDocId || "none"}</span>
              </div>
              <div className="flex-1 bg-white overflow-auto min-h-0">
                {collabDocId ? (
                  <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading editor...</div>}>
                    <CollaborativeEditor key={collabDocId}
                      docId={`${selectedTeamId || "default"}/${collabDocId}`}
                      userName="User" userColor="#3b82f6"
                      serverUrl={`ws://localhost:${"1234"}`} />
                  </Suspense>
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400">Select a document</div>
                )}
              </div>
            </div>
          </div>

        ) : viewMode === 'tasks' ? (
          <div className="flex-1 flex min-h-0">
            <Sidebar agents={agents} activeAgentId={activeAgentId}
              onSelectAgent={handleSelectAgent} onToggleCollapse={handleToggleCollapse}
              onAddAgent={parentId => { setModalParentId(parentId); setIsModalOpen(true); }}
              isWorkflowsExpanded={isWorkflowsExpanded} onToggleWorkflows={() => setIsWorkflowsExpanded(v => !v)} />
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                  <h1 className="text-xl font-semibold text-slate-100 mb-1">Task Dashboard</h1>
                  <p className="text-sm text-slate-500">Real-time status of all tasks across all agents</p>
                </div>
                {selectedTeamId && (
                  <div className="mb-6">
                    <GoalInput onSubmit={handleGoalSubmit} sessionState={sessionState}
                      disabled={sessionState === 'executing' || sessionState === 'planning'} />
                  </div>
                )}
                <TaskDashboard allTasks={allTasks}
                  onStartTask={handleStartTask} onCompleteTask={handleCompleteTask} onCancelTask={handleCancelTask} />
              </div>
            </div>
          </div>

        ) : (
          <>
            <Sidebar agents={agents} activeAgentId={activeAgentId}
              onSelectAgent={handleSelectAgent} onToggleCollapse={handleToggleCollapse}
              onAddAgent={parentId => { setModalParentId(parentId); setIsModalOpen(true); }}
              isWorkflowsExpanded={isWorkflowsExpanded} onToggleWorkflows={() => setIsWorkflowsExpanded(v => !v)} />

            {activeAgent ? (
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                {isGoalInputVisible && (
                  <div className="px-6 py-4 border-b border-nexus-800 bg-nexus-900/30">
                    <GoalInput onSubmit={handleGoalSubmit} sessionState={sessionState}
                      disabled={sessionState === 'executing' || sessionState === 'planning'} />
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <ChatArea
                    key={activeAgent.id}
                    agent={activeAgent}
                    messages={activeAgentMessages}
                    tasks={activeAgentTasks}
                    teamId={selectedTeamId}
                    onUpdateMessages={(agentId, msg) => updateMessages(agentId, msg)}
                    onAddTask={() => { /* Phase 1: tasks come from backend plan only */ }}
                    onToggleTask={() => { /* Phase 1: status managed by backend */ }}
                    onDeleteTask={() => { /* Phase 1: deletion not yet supported */ }}
                    apiKey={process.env.API_KEY || process.env.GEMINI_API_KEY || ''}
                    onTogglePanel={() => setIsPanelOpen(v => !v)}
                    isPanelOpen={isPanelOpen}
                    autoExecuteEnabled={autoExecuteEnabled}
                    onToggleAutoExecute={handleToggleAutoExecute}
                    currentPlan={currentPlan}
                    onStartTask={handleStartTask}
                    onCompleteTask={handleCompleteTask}
                    onCancelTask={handleCancelTask}
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                Select a team to start.
              </div>
            )}

            {isPanelOpen && (
              <AgentManagerPanel activeAgents={[]} logs={orchestrationLogs} onClose={() => setIsPanelOpen(false)} />
            )}
          </>
        )}
      </div>

      {sessionState === 'awaiting_approval' && currentPlan && currentPlan.length > 0 && (
        <PlanApproval plan={currentPlan as BackendTask[]} onApprove={handleApprove} onDismiss={() => setSessionState(null)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <AgentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleAddAgent}
        parentAgents={agents} initialParentId={modalParentId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────────────────────

const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/*" element={<InnerApp />} />
    </Routes>
  </BrowserRouter>
);

export default App;
