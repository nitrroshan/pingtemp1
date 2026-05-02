/**
 * App — main application entry point (Phase 1 refactor)
 *
 * Uses extracted hooks:
 *   useGoalSessionStore — unified goal-scoped state (messages, tasks, plans)
 *   useAgentStore    — agent hierarchy, team loading (Zustand store)
 *   useAgentStore    — agent hierarchy, team loading (Zustand store)
 *
 * Routes (React Router):
 *   /*  → InnerApp (handles all navigation internally)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Menu, PanelRight, Search, Sun, Moon, LogOut } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import AgentModal from './components/AgentModal/AgentModal';
import { DetailPanel } from './components/DetailPanel/DetailPanel';
import { PlanApproval } from './components/PlanApproval';
import { GoalScreen } from './components/GoalScreen';
import { makePlanId } from './lib/planId';
import { PlanSwitcher } from './components/PlanSwitcher';
import { ToastContainer, useToast } from './components/Toast/Toast';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/layout/StatusBar';
import { DevCollabButton } from './components/DevCollabButton';

import { useGoalSessionStore } from './stores/goalSessionStore';
import { useAgentStore } from './stores/agentStore';
import { useUiStore } from './stores/uiStore';
import { agentServiceV2, type Task as BackendTask } from './services/AgentServiceV2';
import type { Agent, Message } from './types';
import type { PlanSummary as PlanListSummary } from './components/GoalScreen/PlanList';
import { useSession, signOut } from './lib/auth-client';
import { LoginPage } from './components/Auth/LoginPage';
import { FEATURES } from './lib/features';
import { Skeleton } from './components/ui/skeleton';
import { TeamsPage } from './components/TeamsPage/TeamsPage';
import { PlanViewerPage } from './components/PlanViewer/PlanViewerPage';
import { useDiscussionNotifications } from './hooks/useDiscussion';
import type { DiscussionThread as DiscussionThreadType } from './hooks/useDiscussion';

// ─────────────────────────────────────────────────────────────────────────────
// InnerApp
// ─────────────────────────────────────────────────────────────────────────────

function InnerApp() {
  const { toasts, showToast, dismissToast } = useToast();

  // ── Theme (from uiStore Zustand) ────────────────────────────────────────
  const theme = useUiStore(s => s.theme);
  const toggleTheme = useUiStore(s => s.toggleTheme);

  useEffect(() => {
    document.documentElement.classList.add('theme-transition');
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    const timeout = setTimeout(() => document.documentElement.classList.remove('theme-transition'), 350);
    return () => clearTimeout(timeout);
  }, [theme]);
  // ─────────────────────────────────────────────────────────────────────────

  const agents = useAgentStore(s => s.agents);
  const isLoadingTeams = useAgentStore(s => s.isLoadingTeams);
  const findAgentById = useAgentStore(s => s.findAgentById);
  const handleToggleCollapse = useAgentStore(s => s.handleToggleCollapse);
  // agentsRef: kept in sync with store for Socket.IO callbacks that need fresh agent data
  const agentsRef = useRef<Agent[]>(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  const chatHistories = useGoalSessionStore(s => s.chatHistories);
  const addMessage = useGoalSessionStore(s => s.addMessage);
  const processStreamPart = useGoalSessionStore(s => s.processStreamPart);

  // Orchestration state (from goalSessionStore — unified)
  const sessionState = useGoalSessionStore(s => s.sessionState);
  const tasks = useGoalSessionStore(s => s.tasks);
  const autoExecuteEnabled = useGoalSessionStore(s => s.autoExecuteEnabled);
  const orchestrationLogs = useGoalSessionStore(s => s.orchestrationLogs);
  const plans = useGoalSessionStore(s => s.plans);
  const handleStartTask = useGoalSessionStore(s => s.startTask);
  const handleToggleAutoExecute = useGoalSessionStore(s => s.toggleAutoExecute);

  // Goal-scoped state (from goalSessionStore — replaces uiStore for goal identity)
  const activeGoalId = useGoalSessionStore(s => s.activeGoalId);
  const activePlanId = useGoalSessionStore(s => s.activePlanId);
  const selectedTaskId = useGoalSessionStore(s => s.selectedTaskId);

  // ── Navigation state (from uiStore Zustand) ────────────────────────────
  const activeAgentId = useUiStore(s => s.activeAgentId);
  const setActiveAgentId = useUiStore(s => s.setActiveAgentId);
  const activeAgentIdRef = useRef(activeAgentId);
  const selectedTeamId = useUiStore(s => s.selectedTeamId);
  const setSelectedTeamId = useUiStore(s => s.setSelectedTeamId);
  const selectedTeamIdRef = useRef<string | null>(selectedTeamId);
  const connectedTeamRef = useRef<string | null>(null);

  // ── Layout state (from uiStore Zustand) ───────────────────────────────
  const isModalOpen = useUiStore(s => s.isModalOpen);
  const modalParentId = useUiStore(s => s.modalParentId);
  const openModal = useUiStore(s => s.openModal);
  const closeModal = useUiStore(s => s.closeModal);
  const isPanelOpen = useUiStore(s => s.isPanelOpen);
  const setIsPanelOpen = useUiStore(s => s.setIsPanelOpen);
  const isSidebarExpanded = useUiStore(s => s.isSidebarExpanded);
  const toggleSidebar = useUiStore(s => s.toggleSidebar);
  const isMobileSidebarOpen = useUiStore(s => s.isMobileSidebarOpen);
  const setIsMobileSidebarOpen = useUiStore(s => s.setIsMobileSidebarOpen);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);
  const isCommandPaletteOpen = useUiStore(s => s.isCommandPaletteOpen);
  const setIsCommandPaletteOpen = useUiStore(s => s.setIsCommandPaletteOpen);
  const activeMenu = useUiStore(s => s.activeMenu);
  const setActiveMenu = useUiStore(s => s.setActiveMenu);

  // Discussion state — selected thread for full-view rendering
  const [discussionThreads, setDiscussionThreads] = useState<DiscussionThreadType[]>([]);

  // Discussion notifications (Socket.IO badges)
  // Subscribe to discussion notification badges (unread count surfaces in DetailPanel discussion tab)
  useDiscussionNotifications(agentServiceV2);

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
    let nextTeamId: string | null = null;
    let nextPlanId: string | null = null;

    if (segments[0] === 'teams') {
      if (segments[1]) nextTeamId = decodeURIComponent(segments[1]);
      // /teams/{id}/p/{planId}
      if (segments[2] === 'p' && segments[3]) {
        nextPlanId = decodeURIComponent(segments[3]);
      }
    }

    return { nextTeamId, nextPlanId };
  }, []);

  useEffect(() => { activeAgentIdRef.current = activeAgentId; }, [activeAgentId]);
  useEffect(() => { selectedTeamIdRef.current = selectedTeamId; }, [selectedTeamId]);

  // selectedTeamId now persisted via uiStore Zustand persist (ping:ui key)

  useEffect(() => {
    useAgentStore.getState().loadTeams().then((backendTeams) => {
      // Auto-select first backend team if none selected (Issue 23: use return value, not getState().agents)
      if (backendTeams.length > 0 && !useUiStore.getState().selectedTeamId) {
        setSelectedTeamId(backendTeams[0].id);
        setActiveAgentId(backendTeams[0].id);
        pushRoute(`/teams/${encodeURIComponent(backendTeams[0].id)}`);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Route drives selectedTeamId only. Goal/plan state is set by store actions.
  useEffect(() => {
    if (currentPath === '/manage-teams') return;
    if (currentPath === '/') return;
    const { nextTeamId } = parseRouteState(currentPath);
    if (nextTeamId !== null) setSelectedTeamId(nextTeamId);
  }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Clear stale state from previous team
    useGoalSessionStore.getState().resetForTeam();

    connectedTeamRef.current = selectedTeamId;

    agentServiceV2.connect(selectedTeamId)
      .catch(err => { connectedTeamRef.current = null; showToast(`Connection failed: ${err.message}`, 'error'); });

    // Wire global HTTP error handler → toast notifications
    const unsubHttpError = agentServiceV2.onHttpError((message, status) => {
      if (status === 401) {
        showToast(message, 'error');
        // Optionally redirect to login — uncomment when login page is ready:
        // window.location.href = '/login';
      } else {
        showToast(message, 'error');
      }
    });

    // Wire Socket.IO events → stores
    const findAgentByRole = (roleName: string): Agent | undefined => {
      return useAgentStore.getState().findAgentByRole(roleName, selectedTeamIdRef.current);
    };

    const unsubMessage = agentServiceV2.onMessage((data) => {
      const content = data.content;
      if (!content) return;

      useGoalSessionStore.getState().addLog(data.agentId, content.length > 100 ? content.substring(0, 100) + '...' : content, 'info');

      const isManager = data.agentId === 'manager' || data.agentId === 'orchestrator' || data.agentId === 'planner';
      // Goal-scoped key for planner messages
      const targetAgentId = isManager
        ? (data.goalId ? `${selectedTeamId}:goal:${data.goalId}` : selectedTeamId)
        : (findAgentByRole(data.agentId)?.id ?? data.agentId);

      addMessage(targetAgentId, { id: uuidv4(), role: 'model', content, timestamp: data.timestamp ?? Date.now() });
      if (data.taskId && activeAgentIdRef.current !== targetAgentId) setActiveAgentId(targetAgentId);
    });

    const unsubState = agentServiceV2.onState((data) => {
      useGoalSessionStore.getState().addLog('SYSTEM', `State: ${data.sessionState}`, 'info');
      useGoalSessionStore.getState().handleStateEvent(data);
    });

    const unsubOutput = agentServiceV2.onOutput((data) => {
      const outputPreview = data.output.content.length > 100 ? data.output.content.substring(0, 100) + '...' : data.output.content;
      useGoalSessionStore.getState().addLog(data.agentId, `Output: ${outputPreview}`, 'success');
    });

    const unsubError = agentServiceV2.onError((data) => {
      useGoalSessionStore.getState().addLog('ERROR', data.error, 'error');
    });

    const unsubStream = agentServiceV2.onStream((payload: any) => {
      if (!payload?.part) return;
      const { part, agentId: streamAgentId, taskId: streamTaskId, goalId: streamGoalId } = payload;

      // Goal isolation handled by Socket.IO rooms (server-side) — no client-side filter needed.

      // ChatAgent responses → route to "chat:{resolvedAgentId}"
      if (streamAgentId?.startsWith('chat-')) {
        const role = streamAgentId.replace('chat-', '');
        const resolved = findAgentByRole(role);
        if (resolved) processStreamPart(`chat:${resolved.id}`, part);
        return;
      }

      // Map role-based agentId to MongoDB agent ID
      const isOrchestrator = streamAgentId === 'manager' || streamAgentId === 'orchestrator' || streamAgentId === 'planner';
      const resolved = isOrchestrator ? null : findAgentByRole(streamAgentId);
      if (!isOrchestrator && !resolved) {
        // Don't silently drop — use role key directly so messages aren't lost
        const fallbackKey = streamTaskId ? `${streamAgentId}:task:${streamTaskId}` : streamAgentId;
        processStreamPart(fallbackKey, part);
        return;
      }

      const targetAgentId = isOrchestrator ? selectedTeamId : resolved!.id;

      // Chat key routing:
      // - Planner/orchestrator: goal-scoped "teamId:goal:goalId" (each goal has its own planner chat)
      // - Workers: task-scoped "agentId:task:taskId" (each task has its own worker chat)
      // - Fallback: plain agentId
      let chatKey: string;
      if (isOrchestrator && streamGoalId) {
        chatKey = `${selectedTeamId}:goal:${streamGoalId}`;
      } else if (!isOrchestrator && streamTaskId) {
        chatKey = `${targetAgentId}:task:${streamTaskId}`;
      } else {
        chatKey = targetAgentId;
      }
      processStreamPart(chatKey, part);
    });

    const TASK_UPDATE_LOG: Record<string, { fmt: (u: any) => string; type: string }> = {
      started:        { fmt: (u) => `${u.taskId}: Started`,                                    type: 'info' },
      progress:       { fmt: (u) => `${u.taskId}: ${u.note || `Step ${u.stepIdx}`}`,            type: 'info' },
      tool_milestone: { fmt: (u) => `${u.taskId}: ${u.tool} — ${u.summary?.slice(0, 100) || 'done'}`, type: 'info' },
      completed:      { fmt: (u) => `${u.taskId}: Completed — ${u.summary?.slice(0, 100) || ''}`, type: 'success' },
      failed:         { fmt: (u) => `${u.taskId}: Failed — ${u.error?.slice(0, 100) || ''}`,     type: 'error' },
      blocked:        { fmt: (u) => `${u.taskId}: Blocked — ${u.reason?.slice(0, 100) || ''}`,   type: 'warning' },
    };

    const unsubTaskUpdate = agentServiceV2.onTaskUpdate((update: any) => {
      if (!update?.taskId) return;
      const config = TASK_UPDATE_LOG[update.type] || { fmt: () => update.type, type: 'info' };
      useGoalSessionStore.getState().addLog(`${update.taskId} [${update.role || 'worker'}]`, config.fmt(update), config.type as any);

      // Auto-select first executing task so worker output is visible
      if (update.type === 'started' && !useGoalSessionStore.getState().selectedTaskId) {
        useGoalSessionStore.setState({ selectedTaskId: update.taskId });
      }
    });

    const unsubGoalState = agentServiceV2.onGoalStateChange((data: any) => {
      useGoalSessionStore.getState().handleGoalStateChange(data);
    });

    // Server-generated goalId — auto-subscribe to the goal's Socket.IO room
    const unsubGoalCreated = agentServiceV2.onGoalCreated(({ goalId }) => {
      if (selectedTeamId) {
        agentServiceV2.subscribeToGoal(selectedTeamId, goalId);
      }
    });

    return () => {
      unsubMessage();
      unsubState();
      unsubOutput();
      unsubError();
      unsubStream();
      unsubTaskUpdate();
      unsubGoalState();
      unsubGoalCreated();
      unsubHttpError();
    };
  }, [selectedTeamId, agentsRef, addMessage, processStreamPart, showToast]);

  // Error toasts from orchestration logs
  const prevLogsLen = useRef(0);

  // Load chat history from backend when team is selected
  useEffect(() => {
    if (!selectedTeamId) return;
    const team = agents.find(a => a.id === selectedTeamId);
    const subAgents = team?.subAgents ?? [];

    // Set planner view as default when loading a team (matches restored chat key)
    if (activeAgentId !== selectedTeamId) {
      setActiveAgentId(selectedTeamId);
    }

    // Restore team via goalSessionStore — URL planId passed as parameter for resolution
    const { nextPlanId: urlPlanId } = parseRouteState(window.location.pathname);
    const store = useGoalSessionStore.getState();
    store.restoreTeam(
      selectedTeamId,
      subAgents.map(s => ({ id: s.id, role: s.role })),
      urlPlanId ?? undefined,
    );
  // Restore fires on team change only. Goal-switch restore is handled by switchGoal().
  }, [selectedTeamId, agents]);

  useEffect(() => {
    const newLogs = orchestrationLogs.slice(prevLogsLen.current);
    prevLogsLen.current = orchestrationLogs.length;
    newLogs.filter(l => l.type === 'error').forEach(l => showToast(l.message, 'error'));
  }, [orchestrationLogs, showToast]);

  const handleSelectAgent = useCallback((agent: Agent) => {
    setActiveAgentId(agent.id);
    useGoalSessionStore.setState({ selectedTaskId: null }); // Clear task selection
    if (isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
    const isTeam = agents.some(a => a.id === agent.id);
    const teamId = isTeam ? agent.id : agents.find(a => a.subAgents?.some(s => s.id === agent.id))?.id;
    if (teamId) {
      setSelectedTeamId(teamId);
      // Preserve planId in URL when switching agents within a plan
      if (activePlanId) {
        pushRoute(`/teams/${encodeURIComponent(teamId)}/p/${encodeURIComponent(activePlanId)}`);
      } else {
        pushRoute(`/teams/${encodeURIComponent(teamId)}`);
      }
    }
  }, [agents, isMobileViewport, pushRoute, activePlanId]);

  const handleOpenDiscussion = useCallback((thread: DiscussionThreadType) => {
    // Mark as read — the discussion content is now reachable from the task-scoped DetailPanel.
    setDiscussionThreads(prev =>
      prev.map(t => t.docName === thread.docName ? { ...t, unreadCount: 0 } : t)
    );
  }, []);

  // remapChatKey removed — goalSessionStore uses atomic switchGoal

  const handleGoalSubmit = useCallback(async (goal: string) => {
    if (!selectedTeamId) { showToast('Please select a team first', 'warning'); return; }

    // Server generates goalId — wait for it before navigating
    let serverGoalId: string;
    try {
      const result = await agentServiceV2.sendToManagerAsync(goal);
      serverGoalId = result.goalId;
    } catch (err: any) {
      showToast(`Failed to send goal: ${err.message}`, 'error');
      return;
    }

    const planId = makePlanId(selectedTeamId, goal, Date.now());
    useGoalSessionStore.getState().newGoal(selectedTeamId, serverGoalId, planId, goal);
    useGoalSessionStore.getState().sendUserMessage({
      teamId: selectedTeamId, agentId: selectedTeamId, goalId: serverGoalId,
      taskId: null, isChatAgent: false, isTeamView: true, content: goal,
    });
    pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
  }, [selectedTeamId, showToast, pushRoute]);

  /** Goal submitted from GoalScreen (teamId provided explicitly) */
  const handleGoalScreenSubmit = useCallback(async (teamId: string, goal: string, repoUrl?: string, repoBranch?: string) => {
    // Ensure connected to the right team
    if (selectedTeamId !== teamId) setSelectedTeamId(teamId);

    // Always ensure socket is connected to the target team (handles team switch)
    try {
      await agentServiceV2.connect(teamId);
    } catch (err: any) {
      showToast(`Connection failed: ${err.message}`, 'error');
      return;
    }

    // Server generates goalId — wait for it before navigating
    let serverGoalId: string;
    try {
      const result = await agentServiceV2.sendToManagerAsync(goal, repoUrl, repoBranch);
      serverGoalId = result.goalId;
    } catch (err: any) {
      showToast(`Failed to send goal: ${err.message}`, 'error');
      return;
    }

    const planId = makePlanId(teamId, goal, Date.now());
    useGoalSessionStore.getState().newGoal(teamId, serverGoalId, planId, goal);
    useGoalSessionStore.getState().sendUserMessage({
      teamId, agentId: teamId, goalId: serverGoalId,
      taskId: null, isChatAgent: false, isTeamView: true, content: goal,
    });
    pushRoute(`/teams/${encodeURIComponent(teamId)}/p/${encodeURIComponent(planId)}`);
  }, [selectedTeamId, showToast, pushRoute]);

  const handleApprove = useCallback((_tasks?: BackendTask[]) => {
    useGoalSessionStore.getState().approvePlan();
  }, []);

  const handleAddAgent = useCallback(async (agentData: Partial<Agent>) => {
    if (!agentData.parentId) {
      try {
        const team = await useAgentStore.getState().createTeam(agentData.name ?? 'New Team', agentData.description ?? 'General task', agentData.description ?? '');
        if (team) {
          setActiveAgentId(team.id);
          setSelectedTeamId(team.id);
          showToast(`Team "${team.name}" created`, 'success');
          useGoalSessionStore.getState().addLog('SYSTEM', `Team created: ${team.name}`, 'success');
        }
      } catch (err: any) {
        showToast(`Failed to create team: ${err.message}`, 'error');
      }
    } else {
      useAgentStore.getState().addLocalSubAgent(agentData.parentId, agentData);
    }
  }, [showToast]);

  const allTasks = tasks; // tasks is a flat array from goalSessionStore
  // Filter tasks by active plan's goalId — each plan shows only its own tasks
  const planTasks = activeGoalId
    ? allTasks.filter(t => t.goalId === activeGoalId)
    : allTasks;
  const activeAgent = findAgentById(activeAgentId);
  // Get tasks assigned to the active agent's role
  const activeAgentRole = activeAgent?.role?.toLowerCase();
  const activeAgentTasks = activeAgentRole
    ? allTasks.filter(t => t.assignedRole?.toLowerCase() === activeAgentRole)
    : [];
  const showTaskSkeleton = (sessionState === 'planning' || sessionState === 'executing') && allTasks.length === 0;
  const selectedTeam = selectedTeamId ? agents.find(a => a.id === selectedTeamId) : undefined;
  const selectedTeamAgentCount = selectedTeam ? 1 + (selectedTeam.subAgents?.length ?? 0) : 0;

  // Chat key logic:
  // - Click agent (sidebar AGENTS) → ChatAgent R1 chat: "chat:{agentId}"
  // - Click task (sidebar PLAN)   → Worker stream:     "{agentId}:task:{taskId}"
  // - Click team/orchestrator     → Planner chat:       "teamId:goal:{goalId}" (goal-scoped)
  const isChatAgent = !!(activeAgent?.parentId && FEATURES.chatAgentChat);
  const isTeamView = activeAgentId === selectedTeamId;
  const chatKey = selectedTaskId
    ? `${activeAgentId}:task:${selectedTaskId}`  // task selected → worker stream
    : isChatAgent
      ? `chat:${activeAgentId}`                  // agent clicked → ChatAgent R1
      : isTeamView && activeGoalId
        ? `${selectedTeamId}:goal:${activeGoalId}`  // planner → goal-scoped
        : activeAgentId;                            // fallback
  const activeAgentMessages = chatHistories[chatKey] ?? [];

  // Click task → switch main area to that role's agent + select the task
  const handleTaskClick = useCallback((taskId: string) => {
    useGoalSessionStore.setState({ selectedTaskId: taskId });
    // Find the task to get its role
    const task = allTasks.find(t => t.id === taskId);
    if (task?.assignedRole && selectedTeam?.subAgents) {
      const roleAgent = selectedTeam.subAgents.find(
        a => a.role.toLowerCase() === task.assignedRole!.toLowerCase()
      );
      if (roleAgent) {
        setActiveAgentId(roleAgent.id);
      }
    }
    setIsPanelOpen(true);
  }, [allTasks, selectedTeam, setActiveAgentId]);

  // Plans list for switcher (from goalSessionStore — map to PlanList format)
  const storedPlans: PlanListSummary[] = React.useMemo(() =>
    plans.map(p => ({
      planId: p.planId ?? p.goalId,
      goal: p.title,
      goalId: p.goalId,
      createdAt: p.createdAt,
      status: (p.state === 'done' ? 'completed' : p.state === 'executing' ? 'active' : 'unknown') as PlanListSummary['status'],
      taskCount: p.taskCount,
      completedCount: p.completedCount,
    })),
    [plans],
  );

  // Filter out built-in agents (meta-agent) from team list — only show backend teams
  const backendTeams = React.useMemo(
    () => agents.filter(a => a.id !== 'meta-agent'),
    [agents]
  );

  const sidebarNode = (
    <Sidebar
      agents={agents}
      activeAgentId={activeAgentId}
      onSelectAgent={handleSelectAgent}
      onToggleCollapse={handleToggleCollapse}
      onAddAgent={(parentId) => openModal(parentId)}
      isExpanded={isMobileViewport ? true : isSidebarExpanded}
      onToggleExpanded={() => toggleSidebar()}
      teams={backendTeams}
      activeTeamId={selectedTeamId}
      onSelectTeam={handleSelectAgent}
      onNavigateToTeams={() => { pushRoute('/manage-teams'); if (isMobileViewport) setIsMobileSidebarOpen(false); }}
      planTasks={planTasks}
      planName={allTasks[0]?.title ?? undefined}
      selectedTaskId={selectedTaskId}
      onSelectTask={handleTaskClick}
      activePlanId={activePlanId}
      sessionState={sessionState}
      onBackToGoals={() => {
        useGoalSessionStore.getState().clearGoal();
        if (selectedTeamId) pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}`);
        else pushRoute('/');
      }}
      plans={plans}
      onSelectPlan={(goalId) => {
        // Switch to a different plan via goalSessionStore.switchGoal()
        const plan = plans.find(p => p.goalId === goalId);
        if (plan?.planId && selectedTeamId) {
          setActiveAgentId(selectedTeamId);
          pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(plan.planId)}`);
          const selectedTeam = agents.find(a => a.id === selectedTeamId);
          const subAgents = selectedTeam?.subAgents ?? [];
          useGoalSessionStore.getState().switchGoal(selectedTeamId, goalId, plan.planId, subAgents.map(s => ({ id: s.id, role: s.role })));
        }
      }}
      onNewPlan={() => {
        useGoalSessionStore.getState().clearGoal();
        if (selectedTeamId) pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}`);
        else pushRoute('/');
      }}
    />
  );

  const appShellLoading = isLoadingTeams && !selectedTeamId;

  // /manage-teams route — render full-page TeamsPage
  if (currentPath === '/manage-teams') {
    return (
      <TeamsPage
        onBack={() => {
          if (selectedTeamId && activePlanId) {
            pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(activePlanId)}`);
          } else if (selectedTeamId) {
            pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}`);
          } else {
            pushRoute('/');
          }
        }}
        onTeamCreated={(team) => {
          setActiveAgentId(team.id);
          setSelectedTeamId(team.id);
          pushRoute(`/teams/${encodeURIComponent(team.id)}`);
        }}
      />
    );
  }

  // /plans route — render full-page PlanViewerPage
  if (currentPath === '/plans') {
    return (
      <div className="h-screen w-full bg-background font-sans text-foreground">
        <PlanViewerPage
          teams={backendTeams}
          selectedTeamId={selectedTeamId}
          allTasks={allTasks}
          activePlanId={activePlanId}
          orchestrationLogs={orchestrationLogs}
          sessionState={sessionState}
          autoExecuteEnabled={autoExecuteEnabled}
          onBack={() => {
            if (selectedTeamId && activePlanId) {
              pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(activePlanId)}`);
            } else if (selectedTeamId) {
              pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}`);
            } else {
              pushRoute('/');
            }
          }}
          onSelectTeam={(teamId) => {
            setSelectedTeamId(teamId);
          }}
          onOpenPlanChat={(teamId, planId) => {
            setSelectedTeamId(teamId);
            const match = useGoalSessionStore.getState().plans.find(p => p.planId === planId);
            if (match?.goalId) {
              const team = agents.find(a => a.id === teamId);
              const subAgents = team?.subAgents ?? [];
              useGoalSessionStore.getState().switchGoal(teamId, match.goalId, planId, subAgents.map(s => ({ id: s.id, role: s.role })));
            } else {
              useGoalSessionStore.setState({ activePlanId: planId });
            }
            pushRoute(`/teams/${encodeURIComponent(teamId)}/p/${encodeURIComponent(planId)}`);
          }}
          onStartTask={handleStartTask}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // GoalScreen — default landing page. Shown when no plan is actively loaded.
  // Uses store state (activePlanId), not URL — stale URLs don't bypass GoalScreen.
  const showGoalScreen = !activePlanId && (currentPath === '/' || currentPath.match(/^\/teams\/[^/]+/));

  if (showGoalScreen) {
    return (
      <div className="flex h-screen w-full bg-background font-sans text-foreground">
        <Sidebar
          agents={agents}
          activeAgentId={activeAgentId}
          onSelectAgent={handleSelectAgent}
          onToggleCollapse={handleToggleCollapse}
          onAddAgent={(parentId) => openModal(parentId)}
          isExpanded={isSidebarExpanded}
          onToggleExpanded={() => toggleSidebar()}
          teams={backendTeams}
          activeTeamId={selectedTeamId}
          onSelectTeam={handleSelectAgent}
          onNavigateToTeams={() => pushRoute('/manage-teams')}
          goals={storedPlans}
          onSelectGoal={(planId) => {
            if (selectedTeamId) {
              // Resolve goalId from store plans (no sessionStorage dependency)
              const match = plans.find(p => p.planId === planId);
              if (match?.goalId) {
                const selectedTeam = agents.find(a => a.id === selectedTeamId);
                const subAgents = selectedTeam?.subAgents ?? [];
                pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
                useGoalSessionStore.getState().switchGoal(selectedTeamId, match.goalId, planId, subAgents.map(s => ({ id: s.id, role: s.role })));
              } else {
                useGoalSessionStore.setState({ activePlanId: planId });
                pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
              }
            }
          }}
        />
        <GoalScreen
          teams={backendTeams}
          activeTeamId={selectedTeamId}
          activePlanId={activePlanId}
          onSelectTeam={(teamId) => {
            setSelectedTeamId(teamId);
            pushRoute(`/teams/${encodeURIComponent(teamId)}`);
          }}
          onSubmitGoal={handleGoalScreenSubmit}
          onSelectPlan={(planId) => {
            if (selectedTeamId) {
              // Resolve goalId from store plans (no sessionStorage dependency)
              const match = plans.find(p => p.planId === planId);
              if (match?.goalId) {
                const selectedTeam = agents.find(a => a.id === selectedTeamId);
                const subAgents = selectedTeam?.subAgents ?? [];
                pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
                useGoalSessionStore.getState().switchGoal(selectedTeamId, match.goalId, planId, subAgents.map(s => ({ id: s.id, role: s.role })));
              } else {
                useGoalSessionStore.setState({ activePlanId: planId });
                pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
              }
            }
          }}
          onNavigateToTeams={() => pushRoute('/manage-teams')}
          onSignOut={() => signOut().then(() => window.location.reload())}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
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
              { label: theme === 'dark' ? 'Light Mode' : 'Dark Mode', action: () => { setActiveMenu(null); toggleTheme(); }, shortcut: '⌘,' },
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
            onClick={() => toggleTheme()}
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
              {/* Plan switcher (when plan is active) */}
              {activePlanId ? (
                <PlanSwitcher
                  plans={storedPlans}
                  activePlanId={activePlanId}
                  planName={storedPlans.find(p => p.planId === activePlanId)?.goal ?? 'Plan'}
                  sessionState={sessionState}
                  onSelectPlan={(planId) => {
                    const match = storedPlans.find(p => p.planId === planId);
                    if (match?.goalId && selectedTeamId) {
                      const selectedTeam = agents.find(a => a.id === selectedTeamId);
                      const subAgents = selectedTeam?.subAgents ?? [];
                      pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
                      useGoalSessionStore.getState().switchGoal(selectedTeamId, match.goalId, planId, subAgents.map(s => ({ id: s.id, role: s.role })));
                    } else {
                      useGoalSessionStore.setState({ activePlanId: planId });
                      if (selectedTeamId) pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}/p/${encodeURIComponent(planId)}`);
                    }
                  }}
                  onNewGoal={() => {
                    useGoalSessionStore.getState().clearGoal();
                    if (selectedTeamId) pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}`);
                    else pushRoute('/');
                  }}
                />
              ) : (
                <span className="text-sm font-medium text-foreground truncate">
                  {activeAgent?.name ?? 'Ping'}
                </span>
              )}
              {/* Show task info when a task is selected (worker view) */}
              {selectedTaskId && (() => {
                const task = allTasks.find(t => t.id === selectedTaskId);
                return task ? (
                  <>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-xs font-medium text-foreground truncate">
                      {task.title || task.id}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${
                      task.status === 'in_progress' ? 'bg-emerald-500/20 text-emerald-400' :
                      task.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
                      task.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {task.status.replace('_', ' ')}
                    </span>
                  </>
                ) : null;
              })()}
              {!activePlanId && !selectedTaskId && activeAgent?.role && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wider shrink-0">
                  {activeAgent.role}
                </span>
              )}
              {!activePlanId && !selectedTaskId && sessionState && sessionState !== 'idle' && (
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
        ) : activeAgent ? (
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <div className="flex-1 min-h-0">
              <ChatArea
                key={activeAgent.id}
                agent={activeAgent}
                messages={activeAgentMessages}
                tasks={activeAgentTasks}
                teamId={selectedTeamId}
                onUpdateMessages={(agentId, msg) => {
                  const content = Array.isArray(msg) ? msg[msg.length - 1]?.content : msg.content;
                  if (content) {
                    useGoalSessionStore.getState().sendUserMessage({
                      teamId: selectedTeamId ?? '',
                      agentId,
                      goalId: activeGoalId,
                      taskId: selectedTaskId,
                      isChatAgent,
                      isTeamView,
                      content,
                    });
                  }
                }}
                onAddTask={() => { /* tasks come from backend plan only */ }}
                onToggleTask={() => { /* status managed by backend */ }}
                onDeleteTask={() => { /* deletion not yet supported */ }}
                apiKey={process.env.API_KEY || process.env.GEMINI_API_KEY || ''}
                onTogglePanel={() => setIsPanelOpen(v => !v)}
                isPanelOpen={isPanelOpen}
                autoExecuteEnabled={autoExecuteEnabled}
                onToggleAutoExecute={handleToggleAutoExecute}
                currentPlan={allTasks}
                onStartTask={handleStartTask}
                onCompleteTask={(taskId: string) => useGoalSessionStore.getState().completeTask(taskId)}
                onCancelTask={(taskId: string) => useGoalSessionStore.getState().cancelTask(taskId)}
                isLoading={isLoadingTeams && activeAgentMessages.length === 0}
                compactHeader={!!activePlanId}
                taskScope={!activeAgent.parentId ? 'plan' : 'agent'}
                allTasks={allTasks}
                onSelectTask={handleTaskClick}
                selectedTaskId={selectedTaskId}
                goalId={activeGoalId}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a team to start.
          </div>
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
              currentPlanName={allTasks[0]?.title ?? undefined}
              activePlanId={activeGoalId}
              discussionThreads={discussionThreads}
              onOpenDiscussion={handleOpenDiscussion}
              agentName={activeAgent?.name}
              agentId={activeAgent?.id}
              teamId={selectedTeamId ?? undefined}
              isManager={!!activeAgent && !activeAgent.parentId}
              onClose={() => { setIsPanelOpen(false); useGoalSessionStore.setState({ selectedTaskId: null }); }}
              selectedTask={selectedTaskId ? allTasks.find(t => t.id === selectedTaskId) ?? null : null}
              onSelectTask={(taskId) => useGoalSessionStore.setState({ selectedTaskId: taskId })}
              onStartTask={handleStartTask}
              autoExecuteEnabled={autoExecuteEnabled}
            />
          )}
        </AnimatePresence>
      </div>

      {sessionState === 'awaiting_approval' && allTasks.length > 0 && (
        <PlanApproval plan={allTasks as unknown as BackendTask[]} onApprove={handleApprove} onDismiss={() => useGoalSessionStore.getState().setSessionState(null)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        agents={agents}
        onSelectAgent={handleSelectAgent}
        onNewTeam={() => {
          openModal();
        }}
        onViewPlans={() => {
          pushRoute('/plans');
        }}
      />

      <StatusBar
        isConnected={agentServiceV2.isConnected()}
        activeAgentCount={selectedTeamAgentCount}
        teamName={selectedTeam?.name}
        sessionState={sessionState}
      />

      {/* Dev-only: collab inspector — stripped from production bundle at compile time */}
      <DevCollabButton teamId={selectedTeamId} goalId={activeGoalId} />

      <AgentModal isOpen={isModalOpen} onClose={() => closeModal()} onSave={handleAddAgent}
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

  // Desktop mode — use auth if available, fall back to local identity
  // NOTE: Desktop still needs auth for production (browser-auth feature).
  // For now, desktop uses session if available, else a stable local ID.
  if (isDesktop && !isPending) {
    if (session?.user?.id) {
      agentServiceV2.setUserId(session.user.id);
    } else {
      // Local desktop without cloud auth — use machine-stable ID
      agentServiceV2.setUserId(`desktop-${window.location.hostname}`);
    }
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

  // Wire authenticated user identity to AgentServiceV2
  agentServiceV2.setUserId(session.user.id);

  // Clear stale session data if user changed (new login or different account)
  const lastUserId = sessionStorage.getItem('ping:lastUserId');
  if (lastUserId && lastUserId !== session.user.id) {
    // Different user — goalSessionStore.resetForTeam() handles state cleanup on next team load
  }
  sessionStorage.setItem('ping:lastUserId', session.user.id);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<InnerApp />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
