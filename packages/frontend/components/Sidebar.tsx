
/**
 * Sidebar — Linear/Vercel-style navigation sidebar
 *
 * Sections:
 *   1. Logo + Team Switcher
 *   2. Plan task list (when a plan is active) OR agents tree
 *   3. Footer quick actions
 *
 * Collapsible to icon-only rail (48px) via isExpanded.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronRight, ChevronDown, Plus,
  Cpu, Code, Bug, Palette, PenTool, Search, Bot,
  BarChart3, Workflow, PanelLeftClose, PanelLeft,
  ChevronsUpDown, Check, Settings, ChevronUp,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import type { Agent, Task } from '../types';
import { PlanTaskList } from './Sidebar/PlanTaskList';
import { ModeIndicator } from './Sidebar/ModeIndicator';

// ─── icon helper ─────────────────────────────────────────────────────────────

const getIcon = (iconName: string, size = 15) => {
  switch (iconName) {
    case 'Cpu':      return <Cpu size={size} />;
    case 'Code':     return <Code size={size} />;
    case 'Bug':      return <Bug size={size} />;
    case 'Palette':  return <Palette size={size} />;
    case 'PenTool':  return <PenTool size={size} />;
    case 'Search':   return <Search size={size} />;
    case 'BarChart': return <BarChart3 size={size} />;
    case 'Workflow': return <Workflow size={size} />;
    default:         return <Bot size={size} />;
  }
};

// ─── types ────────────────────────────────────────────────────────────────────

interface SidebarProps {
  agents: Agent[];
  activeAgentId: string;
  onSelectAgent: (agent: Agent) => void;
  onToggleCollapse: (agentId: string) => void;
  onAddAgent: (parentId?: string) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** Top-level teams for the team switcher */
  teams?: Agent[];
  /** Currently active team ID */
  activeTeamId?: string | null;
  /** Called when a team is selected from the switcher */
  onSelectTeam?: (team: Agent) => void;
  /** Called when "Manage teams" is clicked */
  onNavigateToTeams?: () => void;
  /** Plan-scoped task list (shown instead of nav items when plan is active) */
  planTasks?: Task[];
  planName?: string;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  activePlanId?: string | null;
  sessionState?: string | null;
  onBackToGoals?: () => void;
}

// ─── AgentRow ─────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  depth,
  activeAgentId,
  isExpanded,
  onSelectAgent,
  onToggleCollapse,
  onAddAgent,
  planTasks,
}: {
  agent: Agent;
  depth: number;
  activeAgentId: string;
  isExpanded: boolean;
  onSelectAgent: (a: Agent) => void;
  onToggleCollapse: (id: string) => void;
  onAddAgent: (parentId?: string) => void;
  planTasks?: Task[];
}) {
  const isActive = activeAgentId === agent.id;
  const hasChildren = !!agent.subAgents?.length;
  const isCollapsed = agent.collapsed;
  const isTeam = depth === 0;

  // Compute active worker count for this role
  const activeWorkerCount = planTasks
    ? planTasks.filter(t => t.assignedRole?.toLowerCase() === agent.role?.toLowerCase() && t.status === 'in_progress').length
    : 0;

  const row = (
    <div
      key={agent.id}
      className={cn(
        'group flex items-center gap-1.5 rounded-md cursor-pointer transition-colors relative select-none',
        isExpanded ? 'px-2 py-1.5' : 'justify-center p-2',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
      style={isExpanded ? { paddingLeft: `${depth * 12 + 8}px` } : undefined}
      onClick={() => onSelectAgent(agent)}
    >
      {/* Expand/collapse toggle */}
      {isExpanded && (
        <span
          className={cn('p-0.5 rounded flex-shrink-0', hasChildren ? 'visible' : 'invisible')}
          onClick={e => { e.stopPropagation(); onToggleCollapse(agent.id); }}
        >
          {isCollapsed
            ? <ChevronRight size={12} className="text-muted-foreground" />
            : <ChevronDown size={12} className="text-muted-foreground" />}
        </span>
      )}

      {/* Agent icon */}
      <span className="flex-shrink-0">{getIcon(agent.icon, 14)}</span>

      {isExpanded && (
        <>
          <span className="text-xs font-medium truncate flex-1">{agent.name}</span>

          {/* Role chip */}
          {agent.role && (
            <span className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wide flex-shrink-0">
              {agent.role.slice(0, 6)}
            </span>
          )}

          {/* Mode indicator (shown for non-team agents) */}
          {!isTeam && <ModeIndicator />}

          {/* Active worker count badge */}
          {!isTeam && activeWorkerCount > 0 && (
            <span className="text-[9px] px-1 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium flex-shrink-0">
              {activeWorkerCount}
            </span>
          )}

          {/* Add sub-agent button (teams only) */}
          {isTeam && (
            <button
              onClick={e => { e.stopPropagation(); onAddAgent(agent.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent transition-all flex-shrink-0"
              title="Add sub-agent"
            >
              <Plus size={11} />
            </button>
          )}
        </>
      )}
    </div>
  );

  if (!isExpanded) {
    return (
      <Tooltip key={agent.id}>
        <TooltipTrigger asChild>
          <div>
            {row}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{agent.name}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div key={agent.id}>
      {row}
      {!isCollapsed && hasChildren && (
        <div>
          {agent.subAgents!.map(sub => (
            <AgentRow
              key={sub.id}
              agent={sub}
              depth={depth + 1}
              activeAgentId={activeAgentId}
              isExpanded={isExpanded}
              onSelectAgent={onSelectAgent}
              onToggleCollapse={onToggleCollapse}
              onAddAgent={onAddAgent}
              planTasks={planTasks}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SidebarPlanLayout — collapsible PLAN + AGENTS sections ───────────────────

function SidebarPlanLayout({
  planTasks, selectedTaskId, onSelectTask, planName, sessionState,
  activeTeam, activeAgentId, onSelectAgent, onToggleCollapse, onAddAgent,
}: {
  planTasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  planName?: string;
  sessionState?: string | null;
  activeTeam?: Agent;
  activeAgentId: string;
  onSelectAgent: (a: Agent) => void;
  onToggleCollapse: (id: string) => void;
  onAddAgent: (parentId?: string) => void;
}) {
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);

  const completedCount = planTasks.filter(t => t.status === 'completed').length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* PLAN section — collapsible, scrollable, max 60% */}
      <div className={cn('flex flex-col border-b border-border', !planCollapsed && 'max-h-[60%]')}>
        <button
          onClick={() => setPlanCollapsed(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors cursor-pointer shrink-0"
        >
          {planCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <span>Plan</span>
          <span className="text-[9px] font-normal normal-case tracking-normal ml-auto">
            {completedCount}/{planTasks.length}
          </span>
          {sessionState === 'executing' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>
        {!planCollapsed && (
          <div className="overflow-y-auto px-1 pb-1">
            <PlanTaskList
              tasks={planTasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              sessionState={sessionState}
            />
          </div>
        )}
      </div>

      {/* AGENTS section — collapsible, fills remaining space */}
      <div className="flex-1 flex flex-col min-h-0">
        <button
          onClick={() => setAgentsCollapsed(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors cursor-pointer shrink-0"
        >
          {agentsCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <span>Agents</span>
          {activeTeam?.subAgents && (
            <span className="text-[9px] font-normal normal-case tracking-normal ml-auto">
              {activeTeam.subAgents.length}
            </span>
          )}
        </button>
        {!agentsCollapsed && activeTeam && (
          <div className="flex-1 overflow-y-auto p-1.5 min-h-0">
            <AgentRow
              key={activeTeam.id}
              agent={{ ...activeTeam, collapsed: true, subAgents: [] }}
              depth={0}
              activeAgentId={activeAgentId}
              isExpanded={true}
              onSelectAgent={() => onSelectAgent(activeTeam)}
              onToggleCollapse={onToggleCollapse}
              onAddAgent={onAddAgent}
              planTasks={planTasks}
            />
            {activeTeam.subAgents && activeTeam.subAgents.length > 0 && (
              <>
                <div className="border-t border-border my-1 mx-2" />
                {activeTeam.subAgents.map(agent => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    depth={0}
                    activeAgentId={activeAgentId}
                    isExpanded={true}
                    onSelectAgent={onSelectAgent}
                    onToggleCollapse={onToggleCollapse}
                    onAddAgent={onAddAgent}
                    planTasks={planTasks}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const Sidebar: React.FC<SidebarProps> = ({
  agents,
  activeAgentId,
  onSelectAgent,
  onToggleCollapse,
  onAddAgent,
  isExpanded,
  onToggleExpanded,
  teams = [],
  activeTeamId,
  onSelectTeam,
  onNavigateToTeams,
  planTasks,
  planName,
  selectedTaskId,
  onSelectTask,
  activePlanId,
  sessionState,
  onBackToGoals,
}) => {
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeTeam = teams.find(t => t.id === activeTeamId);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsTeamDropdownOpen(false);
      }
    };
    if (isTeamDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isTeamDropdownOpen]);

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          'h-full bg-card border-r border-border flex flex-col flex-shrink-0 transition-all duration-200 ease-in-out',
          isExpanded ? 'w-60' : 'w-12'
        )}
      >
        {/* ── Section 1: Team Switcher ── */}
        {isExpanded ? (
          <div ref={dropdownRef} className="p-2 border-b border-border shrink-0 relative">
            <button
              onClick={() => setIsTeamDropdownOpen(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-sm cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center shrink-0">
                  <Cpu size={11} className="text-primary" />
                </div>
                <span className="truncate font-medium text-foreground text-xs">
                  {activeTeam?.name ?? 'Select team…'}
                </span>
              </div>
              <ChevronsUpDown size={12} className="text-muted-foreground shrink-0" />
            </button>

            {isTeamDropdownOpen && (
              <div className="absolute left-2 right-2 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                {teams.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No teams yet</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto p-1">
                    {teams.map(team => (
                      <button
                        key={team.id}
                        onClick={() => {
                          onSelectTeam?.(team);
                          setIsTeamDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left cursor-pointer',
                          activeTeamId === team.id
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-accent'
                        )}
                      >
                        {getIcon(team.icon, 12)}
                        <span className="truncate flex-1">{team.name}</span>
                        {activeTeamId === team.id && <Check size={11} className="shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-t border-border p-1">
                  <button
                    onClick={() => {
                      onNavigateToTeams?.();
                      setIsTeamDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <Settings size={11} />
                    <span>Manage teams</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Collapsed: show active team icon as a tooltip button */
          <div className="p-1.5 border-b border-border flex justify-center shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectTeam?.(teams[0])}
                  className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center hover:bg-primary/30 transition-colors cursor-pointer"
                >
                  <Cpu size={13} className="text-primary" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {activeTeam?.name ?? 'Select team'}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        {/* ── Navigation / Plan Tasks + Agents ── */}
        {activePlanId && planTasks && isExpanded ? (
          /* Plan-scoped layout: collapsible PLAN + AGENTS sections */
          <SidebarPlanLayout
            planTasks={planTasks}
            selectedTaskId={selectedTaskId ?? null}
            onSelectTask={onSelectTask ?? (() => {})}
            planName={planName}
            sessionState={sessionState}
            activeTeam={activeTeam}
            activeAgentId={activeAgentId}
            onSelectAgent={onSelectAgent}
            onToggleCollapse={onToggleCollapse}
            onAddAgent={onAddAgent}
          />
        ) : (
          <>
            {/* ── Agents section (current team only) ── */}
            <div className="flex-1 overflow-y-auto p-1.5 min-h-0">
          {!activeTeam ? (
            isExpanded ? (
              <div className="text-xs text-muted-foreground text-center py-4 px-2">
                Select a team to see agents.
              </div>
            ) : null
          ) : (
            <>
              {/* Team orchestrator (manager) — render without expanding children */}
              <AgentRow
                key={activeTeam.id}
                agent={{ ...activeTeam, collapsed: true, subAgents: [] }}
                depth={0}
                activeAgentId={activeAgentId}
                isExpanded={isExpanded}
                onSelectAgent={() => onSelectAgent(activeTeam)}
                onToggleCollapse={onToggleCollapse}
                onAddAgent={onAddAgent}
              />

              {/* Sub-agents listed flat */}
              {activeTeam.subAgents && activeTeam.subAgents.length > 0 && (
                <>
                  {isExpanded && (
                    <div className="border-t border-border my-1 mx-2" />
                  )}
                  {activeTeam.subAgents.map(agent => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      depth={0}
                      activeAgentId={activeAgentId}
                      isExpanded={isExpanded}
                      onSelectAgent={onSelectAgent}
                      onToggleCollapse={onToggleCollapse}
                      onAddAgent={onAddAgent}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
          </>
        )}

        {/* ── Footer: manage teams + collapse ── */}
        <div className={cn(
          'p-1.5 border-t border-border flex-shrink-0',
          isExpanded ? 'flex flex-col gap-1' : 'flex flex-col items-center gap-1'
        )}>
          {/* Back to goals (when plan is active) */}
          {isExpanded && activePlanId && onBackToGoals && (
            <button
              onClick={onBackToGoals}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            >
              ← Back to goals
            </button>
          )}
          <div className={cn(isExpanded ? 'flex items-center gap-1' : 'flex flex-col items-center gap-1')}>
          {isExpanded ? (
            <>
              <button
                onClick={() => onNavigateToTeams?.()}
                className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                <Plus size={14} className="flex-shrink-0" />
                <span>New Team</span>
              </button>
              <button
                onClick={onToggleExpanded}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={14} />
              </button>
            </>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onNavigateToTeams?.()}
                    className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <Plus size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">New Team</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleExpanded}
                    className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <PanelLeft size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            </>
          )}          </div>        </div>
      </aside>
    </TooltipProvider>
  );
};

export default Sidebar;
export type { SidebarProps };
