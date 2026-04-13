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
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Menu, PanelRight, Search, Sun, Moon, LogOut } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import AgentModal from './components/AgentModal/AgentModal';
import { DetailPanel } from './components/DetailPanel/DetailPanel';
import { PlanApproval } from './components/PlanApproval';
import GoalInput from './components/GoalInput/GoalInput';
import TaskDashboard from './components/TaskDashboard/TaskDashboard';
import { ToastContainer, useToast } from './components/Toast/Toast';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/layout/StatusBar';

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
import { API_BASE_URL } from './constants';
import { useSession, signOut } from './lib/auth-client';
import { LoginPage } from './components/Auth/LoginPage';
import { Skeleton } from './components/ui/skeleton';
import { TeamsPage } from './components/TeamsPage/TeamsPage';
import { DiscussionThread } from './components/DiscussionThread/DiscussionThread';
import { DecisionPanel } from './components/DecisionPanel/DecisionPanel';
import { useDiscussion, useDiscussionNotifications } from './hooks/useDiscussion';
import type { DiscussionThread as DiscussionThreadType } from './hooks/useDiscussion';

// ─────────────────────────────────────────────────────────────────────────────
// CollabFileTree — lightweight CRDT doc browser
// ─────────────────────────────────────────────────────────────────────────────

function CollabFileTree({ teamId, activeDoc, onSelectDoc }: {
  teamId: string | null; activeDoc: string; onSelectDoc: (d: string) => void;
}) {
  const [docs, setDocs] = React.useState<string[]>([]);
  const [newDocName, setNewDocName] = React.useState('');

  const loadDocs = React.useCallback(() => {
    if (!teamId) return;
    fetch(`${API_BASE_URL}/api/collab/${teamId}/docs`)
      .then(r => r.json()).then(d => setDocs(d.docs || [])).catch(() => {});
  }, [teamId]);

  React.useEffect(() => {
    if (!teamId) return;
    loadDocs();
    const iv = setInterval(loadDocs, 10000);
    return () => clearInterval(iv);
  }, [teamId, loadDocs]);

  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const deleteDoc = (doc: string) => {
    if (!teamId) return;
    fetch(`${API_BASE_URL}/api/collab/${teamId}/docs/${encodeURIComponent(doc)}`, { method: 'DELETE' })
      .then(() => {
        setDocs(prev => prev.filter(d => d !== doc));
        if (activeDoc === doc) onSelectDoc('');
        setConfirmDelete(null);
      })
      .catch(() => { setConfirmDelete(null); });
  };

  return (
    <div className="w-60 border-r border-border bg-card flex flex-col shrink-0">
      <div className="p-3 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">CRDT Documents</span>
      </div>
      <div className="flex-1 overflow-auto p-2 text-sm">
        {docs.length === 0
          ? <div className="text-muted-foreground text-xs p-2">No documents yet.</div>
          : docs.map(doc => (
            <div key={doc} className="flex items-center group">
              {confirmDelete === doc ? (
                <div className="flex items-center gap-1 w-full px-2 py-1 bg-red-500/10 rounded text-xs">
                  <span className="flex-1 truncate text-red-400">Delete?</span>
                  <button onClick={() => deleteDoc(doc)}
                    className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-medium hover:bg-red-600 cursor-pointer">Yes</button>
                  <button onClick={() => setConfirmDelete(null)}
                    className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px] font-medium hover:bg-accent cursor-pointer">No</button>
                </div>
              ) : (
                <>
                  <button onClick={() => onSelectDoc(doc)}
                    className={`flex-1 text-left px-3 py-1.5 rounded-l text-xs truncate transition-colors cursor-pointer ${doc === activeDoc ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-accent'}`}>
                    📄 {doc}
                  </button>
                  <button onClick={() => setConfirmDelete(doc)} title="Delete document"
                    className="px-1.5 py-1.5 rounded-r text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-accent transition-all cursor-pointer">
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
      </div>
      <div className="p-2 border-t border-border flex gap-1">
        <input value={newDocName} onChange={e => setNewDocName(e.target.value)} placeholder="new-doc"
          onKeyDown={e => { if (e.key === 'Enter' && newDocName.trim()) { onSelectDoc(newDocName.trim()); setNewDocName(''); } }}
          className="flex-1 px-2 py-1 text-xs bg-muted border border-border rounded text-foreground focus:outline-none" />
        <button onClick={() => { if (newDocName.trim()) { onSelectDoc(newDocName.trim()); setNewDocName(''); } }}
          className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 cursor-pointer">+</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActiveDiscussionView — renders a single discussion thread with decisions
// ─────────────────────────────────────────────────────────────────────────────

function ActiveDiscussionView({ teamId, goalId, taskId, title, onBack }: {
  teamId: string; goalId: string; taskId: string; title: string; onBack: () => void;
}) {
  const { blocks, decisions, config, status, postBlock } = useDiscussion({
    teamId, goalId, taskId,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header with back button */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 shrink-0 bg-card/50">
        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
          ← Back
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
          <p className="text-[10px] text-muted-foreground">
            {teamId}/{goalId}/{taskId} ·{' '}
            {status === 'connected' ? '🟢 live' : status === 'connecting' ? '🟡 connecting...' : '🔴 error'}
          </p>
        </div>
      </div>

      {/* Content: thread + decisions side by side on wide screens */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-h-0">
          <DiscussionThread
            blocks={blocks}
            config={config}
            title={title}
            subtitle={`Task: ${taskId}`}
            onPost={postBlock}
            compact
          />
        </div>
        {Object.keys(decisions).length > 0 && (
          <div className="w-64 border-l border-border overflow-y-auto shrink-0 hidden lg:block">
            <DecisionPanel decisions={decisions} compact />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InnerApp
// ─────────────────────────────────────────────────────────────────────────────

function InnerApp() {
  const { toasts, showToast, dismissToast } = useToast();

  // ── Theme ────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('ping:theme') as 'dark' | 'light' | null;
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    // Enable smooth transition for theme switch
    document.documentElement.classList.add('theme-transition');
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('ping:theme', theme);
    // Remove transition class after animation completes to avoid interfering with normal transitions
    const timeout = setTimeout(() => document.documentElement.classList.remove('theme-transition'), 350);
    return () => clearTimeout(timeout);
  }, [theme]);
  // ─────────────────────────────────────────────────────────────────────────

  const { agents, isLoadingTeams, agentsRef, findAgentById, handleToggleCollapse, loadTeams, createTeam, addLocalSubAgent } = useAgentTree();
  const { chatHistories, addMessage, updateMessages, processStreamPart, loadAgentChat, clearAllHistories } = useChat();
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
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);
  const [viewMode, setViewMode] = useState<'chat' | 'tasks' | 'collaborate' | 'discussions'>('chat');
  const [collabDocId, setCollabDocId] = useState('doc-shared');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Discussion state — selected thread for full-view rendering
  const [activeDiscussion, setActiveDiscussion] = useState<{ teamId: string; goalId: string; taskId: string; title: string } | null>(null);
  const [discussionThreads, setDiscussionThreads] = useState<DiscussionThreadType[]>([]);

  // Discussion notifications (Socket.IO badges)
  const { unreadCount: discussionUnreadCount, mentions: discussionMentions } = useDiscussionNotifications(agentServiceV2);

  // Track discussion activity from Socket.IO → build thread list
  useEffect(() => {
    const unsub = agentServiceV2.onDiscussionActivity?.((data: any) => {
      setDiscussionThreads(prev => {
        const idx = prev.findIndex(t => t.docName === data.docName);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            blockCount: data.blockCount,
            lastActivity: new Date(data.timestamp).toISOString(),
            unreadCount: updated[idx].unreadCount + 1,
          };
          return updated;
        }
        // New thread discovered via activity
        return [...prev, {
          docName: data.docName,
          taskId: data.taskId,
          title: `Discussion: ${data.taskId}`,
          participants: [],
          blockCount: data.blockCount,
          status: 'active' as const,
          unreadCount: 1,
          lastActivity: new Date(data.timestamp).toISOString(),
        }];
      });
    });
    return () => unsub?.();
  }, []);

  // Close menu on click outside
  useEffect(() => {
    if (!activeMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-menu-bar]')) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeMenu]);
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);

  const parseRouteState = useCallback((pathname: string) => {
    const segments = pathname.split('/').filter(Boolean);
    const validViews = new Set(['chat', 'tasks', 'collaborate', 'discussions']);

    let nextView: 'chat' | 'tasks' | 'collaborate' | 'discussions' = 'chat';
    let nextTeamId: string | null = null;

    if (segments[0] === 'teams') {
      if (segments[1]) {
        nextTeamId = decodeURIComponent(segments[1]);
      }
      if (segments[2] && validViews.has(segments[2])) {
        nextView = segments[2] as 'chat' | 'tasks' | 'collaborate' | 'discussions';
      }
    } else if (segments[0] && validViews.has(segments[0])) {
      nextView = segments[0] as 'chat' | 'tasks' | 'collaborate' | 'discussions';
    }

    return { nextView, nextTeamId };
  }, []);

  useEffect(() => { activeAgentIdRef.current = activeAgentId; }, [activeAgentId]);
  useEffect(() => { selectedTeamIdRef.current = selectedTeamId; }, [selectedTeamId]);

  // Persist active team ID to localStorage whenever it changes
  useEffect(() => {
    if (selectedTeamId) {
      localStorage.setItem('ping:activeTeamId', selectedTeamId);
    }
  }, [selectedTeamId]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobileViewport(mobile);
      if (!mobile) {
        setIsMobileSidebarOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const pushRoute = useCallback((path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  }, []);

  // Route is the source of truth for shell view and selected team (Option C foundation).
  useEffect(() => {
    if (currentPath === '/manage-teams') return; // handled separately
    if (currentPath === '/') {
      const storedTeamId = localStorage.getItem('ping:activeTeamId');
      if (storedTeamId) {
        pushRoute(`/teams/${encodeURIComponent(storedTeamId)}/chat`);
      } else {
        pushRoute('/chat');
      }
      return;
    }
    const { nextView, nextTeamId } = parseRouteState(currentPath);
    if (viewMode !== nextView) setViewMode(nextView);
    if (selectedTeamId !== nextTeamId) setSelectedTeamId(nextTeamId);
  }, [currentPath, parseRouteState, pushRoute, selectedTeamId, viewMode]);

  // Keep active agent in scope for deep-linked team routes.
  useEffect(() => {
    if (!selectedTeamId) return;

    const selectedTeam = agents.find(agent => agent.id === selectedTeamId);
    if (!selectedTeam) return;

    const inTeamScope =
      activeAgentId === selectedTeam.id ||
      (selectedTeam.subAgents?.some(subAgent => subAgent.id === activeAgentId) ?? false);

    if (!inTeamScope) {
      setActiveAgentId(selectedTeam.id);
    }
  }, [activeAgentId, agents, selectedTeamId]);

  // Cmd/Ctrl+K global command palette shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(open => !open);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      // Rich stream part processor — builds streamParts on Message objects
      (agentId, part) => {
        processStreamPart(agentId, part);
      },
    );
    return unsub;
  }, [selectedTeamId, subscribeToTeam, agentsRef, addMessage, processStreamPart, showToast]);

  // Error toasts from orchestration logs
  const prevLogsLen = useRef(0);

  // Load chat history from backend when team is selected
  useEffect(() => {
    if (!selectedTeamId) return;
    // Load orchestrator/manager chat
    loadAgentChat(selectedTeamId, 'manager');
    // Load sub-agent chats
    const team = agents.find(a => a.id === selectedTeamId);
    if (team?.subAgents) {
      for (const sub of team.subAgents) {
        loadAgentChat(selectedTeamId, sub.id);
      }
    }
  }, [selectedTeamId, agents, loadAgentChat]);

  useEffect(() => {
    const newLogs = orchestrationLogs.slice(prevLogsLen.current);
    prevLogsLen.current = orchestrationLogs.length;
    newLogs.filter(l => l.type === 'error').forEach(l => showToast(l.message, 'error'));
  }, [orchestrationLogs, showToast]);

  const handleSelectAgent = useCallback((agent: Agent) => {
    setActiveAgentId(agent.id);
    if (isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
    const isTeam = agents.some(a => a.id === agent.id);
    if (isTeam) {
      setSelectedTeamId(agent.id);
      pushRoute(`/teams/${encodeURIComponent(agent.id)}/${viewMode}`);
    } else {
      const parent = agents.find(a => a.subAgents?.some(s => s.id === agent.id));
      if (parent) {
        setSelectedTeamId(parent.id);
        pushRoute(`/teams/${encodeURIComponent(parent.id)}/${viewMode}`);
      }
    }
  }, [agents, isMobileViewport, pushRoute, viewMode]);

  const handleSelectView = useCallback((mode: 'chat' | 'tasks' | 'collaborate' | 'discussions') => {
    setViewMode(mode);
    if (mode !== 'discussions') setActiveDiscussion(null);
    if (isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
    if (selectedTeamId) {
      pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/${mode}`);
    } else {
      pushRoute(`/${mode}`);
    }
  }, [isMobileViewport, pushRoute, selectedTeamId]);

  const handleOpenDiscussion = useCallback((thread: DiscussionThreadType) => {
    // Parse docName: "{teamId}/{goalId}/{taskId}/discussion"
    const parts = thread.docName.split('/');
    if (parts.length >= 3) {
      setActiveDiscussion({
        teamId: parts[0],
        goalId: parts[1],
        taskId: parts[2],
        title: thread.title,
      });
      setViewMode('discussions');
      // Mark as read
      setDiscussionThreads(prev =>
        prev.map(t => t.docName === thread.docName ? { ...t, unreadCount: 0 } : t)
      );
    }
  }, []);

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
  const showTaskSkeleton = (sessionState === 'planning' || sessionState === 'executing') && allTasks.length === 0;
  const selectedTeam = selectedTeamId ? agents.find(a => a.id === selectedTeamId) : undefined;
  const selectedTeamAgentCount = selectedTeam ? 1 + (selectedTeam.subAgents?.length ?? 0) : 0;

  const sidebarNode = (
    <Sidebar
      agents={agents}
      activeAgentId={activeAgentId}
      viewMode={viewMode}
      onSelectAgent={handleSelectAgent}
      onSelectView={handleSelectView}
      onToggleCollapse={handleToggleCollapse}
      onAddAgent={(parentId) => { setModalParentId(parentId); setIsModalOpen(true); }}
      isExpanded={isMobileViewport ? true : isSidebarExpanded}
      onToggleExpanded={() => setIsSidebarExpanded(v => !v)}
      teams={agents}
      activeTeamId={selectedTeamId}
      onSelectTeam={handleSelectAgent}
      onNavigateToTeams={() => { pushRoute('/manage-teams'); if (isMobileViewport) setIsMobileSidebarOpen(false); }}
    />
  );

  const appShellLoading = isLoadingTeams && !selectedTeamId;

  // /manage-teams route — render full-page TeamsPage
  if (currentPath === '/manage-teams') {
    return (
      <TeamsPage
        onBack={() => pushRoute(selectedTeamId ? `/teams/${encodeURIComponent(selectedTeamId)}/chat` : '/chat')}
        onTeamCreated={(team) => {
          setActiveAgentId(team.id);
          setSelectedTeamId(team.id);
          pushRoute(`/teams/${encodeURIComponent(team.id)}/chat`);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background font-sans text-foreground">
      {/* ── Title Bar ── */}
      <div className="flex items-center h-9 border-b border-border bg-card shrink-0 z-30">
        {/* Left section: logo + menus */}
        <div className="flex items-center gap-1 px-2 shrink-0">
        <button
          onClick={() => setIsMobileSidebarOpen(v => !v)}
          className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
        <div className="flex items-center gap-2 select-none">
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
            <defs>
              <linearGradient id="ping-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0ea5e9" />
                <stop offset="50%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
              <radialGradient id="ping-glow" cx="50%" cy="50%" r="15%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="50%" stopColor="#7dd3fc" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect x="2" y="2" width="96" height="96" rx="22" fill="#0c1425" />
            <circle cx="50" cy="50" r="42" stroke="url(#ping-gradient)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="60 20" opacity="0.9" />
            <circle cx="50" cy="50" r="33" stroke="url(#ping-gradient)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="50 18" opacity="0.8" />
            <circle cx="50" cy="50" r="24" stroke="url(#ping-gradient)" strokeWidth="3" strokeLinecap="round" strokeDasharray="38 16" opacity="0.7" />
            <circle cx="50" cy="50" r="15" stroke="url(#ping-gradient)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="24 14" opacity="0.6" />
            <circle cx="50" cy="50" r="6" fill="url(#ping-glow)" />
            <circle cx="50" cy="50" r="3" fill="white" opacity="0.95" />
          </svg>
        </div>

        {/* Menu bar */}
        <div data-menu-bar className="hidden sm:flex items-center gap-0">
          {[
            { label: 'File', items: [
              { label: 'New Team', action: () => { setActiveMenu(null); document.querySelector<HTMLButtonElement>('[aria-label="New Team"]')?.click(); } },
              { label: 'separator' },
              { label: theme === 'dark' ? 'Light Mode' : 'Dark Mode', action: () => { setActiveMenu(null); setTheme(t => t === 'dark' ? 'light' : 'dark'); }, shortcut: '⌘,' },
              { label: 'separator' },
              { label: 'Sign Out', action: () => { setActiveMenu(null); signOut().then(() => window.location.reload()); } },
            ]},
            { label: 'Edit', items: [
              { label: 'Undo', action: () => { setActiveMenu(null); document.execCommand('undo'); }, shortcut: 'Ctrl+Z' },
              { label: 'Redo', action: () => { setActiveMenu(null); document.execCommand('redo'); }, shortcut: 'Ctrl+Y' },
              { label: 'separator' },
              { label: 'Cut', action: () => { setActiveMenu(null); document.execCommand('cut'); }, shortcut: 'Ctrl+X' },
              { label: 'Copy', action: () => { setActiveMenu(null); document.execCommand('copy'); }, shortcut: 'Ctrl+C' },
              { label: 'Paste', action: () => { setActiveMenu(null); document.execCommand('paste'); }, shortcut: 'Ctrl+V' },
              { label: 'Select All', action: () => { setActiveMenu(null); document.execCommand('selectAll'); }, shortcut: 'Ctrl+A' },
            ]},
            { label: 'View', items: [
              { label: 'Command Palette', action: () => { setActiveMenu(null); setIsCommandPaletteOpen(true); }, shortcut: '⌘K' },
              { label: 'separator' },
              { label: 'Toggle Sidebar', action: () => { setActiveMenu(null); setIsMobileSidebarOpen(v => !v); } },
              { label: 'separator' },
              { label: 'Zoom In', action: () => { setActiveMenu(null); document.body.style.zoom = String(parseFloat(document.body.style.zoom || '1') + 0.1); }, shortcut: 'Ctrl+=' },
              { label: 'Zoom Out', action: () => { setActiveMenu(null); document.body.style.zoom = String(Math.max(0.5, parseFloat(document.body.style.zoom || '1') - 0.1)); }, shortcut: 'Ctrl+-' },
              { label: 'Reset Zoom', action: () => { setActiveMenu(null); document.body.style.zoom = '1'; }, shortcut: 'Ctrl+0' },
            ]},
            { label: 'Help', items: [
              { label: 'About Ping', action: () => { setActiveMenu(null); alert('Ping Desktop\nAI Agent Orchestration Platform'); } },
            ]},
          ].map(menu => (
            <div key={menu.label} className="relative">
              <button
                className={`px-2.5 py-1 text-xs transition-colors cursor-pointer rounded-sm ${activeMenu === menu.label ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}
                onClick={() => setActiveMenu(activeMenu === menu.label ? null : menu.label)}
                onMouseEnter={() => activeMenu && setActiveMenu(menu.label)}
              >
                {menu.label}
              </button>
              {activeMenu === menu.label && (
                <div className="absolute left-0 top-full bg-popover border border-border rounded-md shadow-xl py-1 min-w-[220px] z-50">
                  {menu.items.map((item, i) => 
                    item.label === 'separator' 
                      ? <div key={i} className="h-px bg-border my-1 mx-2" />
                      : <button
                          key={item.label}
                          onClick={() => item.action?.()}
                          className="w-full text-left px-3 py-1.5 text-xs text-popover-foreground hover:bg-accent flex items-center justify-between cursor-pointer transition-colors"
                        >
                          <span>{item.label}</span>
                          {'shortcut' in item && item.shortcut && <span className="text-muted-foreground text-[10px] ml-6 font-mono">{item.shortcut}</span>}
                        </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        </div>

        {/* Center: draggable area with search */}
        <div className="flex-1 flex justify-center items-center min-w-0" style={(window as any).ping?.isDesktop ? { WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}>
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="flex items-center gap-2 px-3 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border transition-all cursor-pointer w-full max-w-xs"
            style={(window as any).ping?.isDesktop ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
            aria-label="Open command palette"
          >
            <Search size={13} className="shrink-0 text-muted-foreground/60" />
            <span className="flex-1 text-left truncate">Search or jump to…</span>
            <kbd className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
          </button>
        </div>

        {/* Right: app controls + window controls */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => signOut().then(() => window.location.reload())}
            className="p-1.5 mr-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors cursor-pointer"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
          {/* Window controls — only in Electron desktop */}
          {(window as any).ping?.isDesktop && (
            <div className="flex items-center h-9 ml-1">
              <button onClick={() => (window as any).ping.minimize()} className="h-9 w-12 flex items-center justify-center text-muted-foreground hover:bg-muted-foreground/10 transition-colors" title="Minimize">
                <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
              </button>
              <button onClick={() => (window as any).ping.maximize()} className="h-9 w-12 flex items-center justify-center text-muted-foreground hover:bg-muted-foreground/10 transition-colors" title="Maximize">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/></svg>
              </button>
              <button onClick={() => (window as any).ping.close()} className="h-9 w-12 flex items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors" title="Close">
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {!isMobileViewport && sidebarNode}

        <AnimatePresence>
          {isMobileViewport && isMobileSidebarOpen && (
            <>
              <motion.button
                key="sidebar-backdrop"
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setIsMobileSidebarOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                aria-label="Close sidebar"
              />
              <motion.div
                key="sidebar-drawer"
                className="fixed left-0 top-0 h-full z-50"
                initial={{ x: -320 }}
                animate={{ x: 0 }}
                exit={{ x: -320 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {sidebarNode}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Main content column ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Context Bar */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/80 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">
                {activeAgent?.name ?? 'Ping'}
              </span>
              {activeAgent?.role && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wider shrink-0">
                  {activeAgent.role}
                </span>
              )}
              {sessionState && sessionState !== 'idle' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">
                  {sessionState.replace('_', ' ')}
                </span>
              )}
            </div>

            <div className="flex-1" />

            <button
              onClick={() => setIsPanelOpen(v => !v)}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                isPanelOpen
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
              aria-label="Toggle detail panel"
            >
              <PanelRight size={16} />
            </button>
          </div>

        {appShellLoading ? (
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {viewMode === 'collaborate' ? (
              <motion.div
                key="collaborate-view"
                className="flex-1 flex min-h-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <CollabFileTree teamId={selectedTeamId} activeDoc={collabDocId} onSelectDoc={setCollabDocId} />
                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                  <div className="flex items-center gap-3 p-3 border-b border-border bg-card shrink-0">
                    <span className="text-sm text-muted-foreground">Document:</span>
                    <span className="text-sm text-foreground font-mono truncate">{collabDocId || "none"}</span>
                  </div>
                  <div className="flex-1 overflow-auto min-h-0">
                    {collabDocId ? (
                      <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading editor...</div>}>
                        <CollaborativeEditor key={collabDocId}
                          docId={`${selectedTeamId || "default"}/${collabDocId}`}
                          userName="User" userColor="#3b82f6"
                          serverUrl={`ws://localhost:${"1234"}`} />
                      </Suspense>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">Select a document</div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : viewMode === 'tasks' ? (
              <motion.div
                key="tasks-view"
                className="flex-1 overflow-y-auto p-6"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <div className="max-w-4xl mx-auto">
                  <div className="mb-6">
                    <h1 className="text-xl font-semibold text-foreground mb-1">Task Dashboard</h1>
                    <p className="text-sm text-muted-foreground">Real-time status of all tasks across all agents</p>
                  </div>
                  {selectedTeamId && (
                    <div className="mb-6">
                      <GoalInput onSubmit={handleGoalSubmit} sessionState={sessionState}
                        disabled={sessionState === 'executing' || sessionState === 'planning'} />
                    </div>
                  )}
                  <TaskDashboard allTasks={allTasks}
                    isLoading={showTaskSkeleton}
                    onStartTask={handleStartTask} onCompleteTask={handleCompleteTask} onCancelTask={handleCancelTask} />
                </div>
              </motion.div>
            ) : viewMode === 'discussions' ? (
              <motion.div
                key="discussions-view"
                className="flex-1 flex min-h-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {activeDiscussion ? (
                  <ActiveDiscussionView
                    teamId={activeDiscussion.teamId}
                    goalId={activeDiscussion.goalId}
                    taskId={activeDiscussion.taskId}
                    title={activeDiscussion.title}
                    onBack={() => setActiveDiscussion(null)}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm p-6">
                    <p className="text-lg mb-2">💬 Discussions</p>
                    {discussionThreads.length > 0 ? (
                      <div className="w-full max-w-md space-y-2 mt-4">
                        <p className="text-xs text-center mb-3">Active discussions — click to open</p>
                        {discussionThreads.filter(t => t.status === 'active').map(thread => (
                          <button
                            key={thread.docName}
                            onClick={() => handleOpenDiscussion(thread)}
                            className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                              <span className="text-xs font-semibold truncate">{thread.title}</span>
                              {thread.unreadCount > 0 && (
                                <span className="text-[10px] bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 px-1.5 py-0.5 rounded-full font-medium ml-auto">
                                  {thread.unreadCount} new
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1 pl-4">
                              {thread.blockCount} blocks · {thread.participants.join(' ↔ ') || 'awaiting input'}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <>
                        <p>Select a discussion from the Detail Panel's Discussions tab</p>
                        <p className="text-xs mt-1">Agent discussions appear here when collaboration tasks are active</p>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="chat-view"
                className="flex-1 flex min-h-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {activeAgent ? (
                  <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    {isGoalInputVisible && (
                      <div className="px-6 py-4 border-b border-border bg-card/50">
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
                        isLoading={isLoadingTeams && activeAgentMessages.length === 0}
                        onOpenDiscussions={() => handleSelectView('discussions')}
                        discussionUnreadCount={discussionUnreadCount}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    Select a team to start.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
        </div>
        {/* ── end main content column ── */}

        {/* ── Detail Panel (320px, optional) ── */}
        <AnimatePresence>
          {isPanelOpen && (
            <DetailPanel
              logs={orchestrationLogs}
              activeAgents={[]}
              allTasks={allTasks}
              discussionThreads={discussionThreads}
              onOpenDiscussion={handleOpenDiscussion}
              agentName={activeAgent?.name}
              agentId={activeAgent?.id}
              teamId={selectedTeamId ?? undefined}
              onClose={() => setIsPanelOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>

      {sessionState === 'awaiting_approval' && currentPlan && currentPlan.length > 0 && (
        <PlanApproval plan={currentPlan as BackendTask[]} onApprove={handleApprove} onDismiss={() => setSessionState(null)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        agents={agents}
        onSelectAgent={handleSelectAgent}
        onSelectView={handleSelectView}
        onNewTeam={() => {
          setModalParentId(undefined);
          setIsModalOpen(true);
        }}
      />

      <StatusBar
        isConnected={agentServiceV2.isConnected()}
        activeAgentCount={selectedTeamAgentCount}
        teamName={selectedTeam?.name}
        sessionState={sessionState}
      />

      <AgentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleAddAgent}
        parentAgents={agents} initialParentId={modalParentId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const isDesktop = !!(window as any).ping?.isDesktop;
  const { data: session, isPending } = useSession();

  // Desktop mode — skip auth, go straight to app
  if (isDesktop) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/*" element={<InnerApp />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (isPending) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0f172a' }}>
        <Skeleton className="w-[200px] h-[40px]" />
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<InnerApp />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
