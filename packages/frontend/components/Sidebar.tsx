
import React from 'react';
import { Agent } from '../types';
import { ChevronRight, ChevronDown, Plus, Cpu, Code, Bug, Palette, PenTool, Search, Bot, MoreHorizontal, Layers, Workflow, BarChart3, PanelLeftClose, PanelLeft } from 'lucide-react';

// Icon mapping helper
const getIcon = (iconName: string) => {
  switch (iconName) {
    case 'Cpu': return <Cpu size={18} />;
    case 'Code': return <Code size={18} />;
    case 'Bug': return <Bug size={18} />;
    case 'Palette': return <Palette size={18} />;
    case 'PenTool': return <PenTool size={18} />;
    case 'Search': return <Search size={18} />;
    case 'BarChart': return <BarChart3 size={18} />;
    case 'Workflow': return <Workflow size={18} />;
    default: return <Bot size={18} />;
  }
};

interface SidebarProps {
  agents: Agent[];
  activeAgentId: string;
  onSelectAgent: (agent: Agent) => void;
  onToggleCollapse: (agentId: string) => void;
  onAddAgent: (parentId?: string) => void;
  isWorkflowsExpanded: boolean;
  onToggleWorkflows: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  agents, 
  activeAgentId, 
  onSelectAgent, 
  onToggleCollapse, 
  onAddAgent,
  isWorkflowsExpanded,
  onToggleWorkflows
}) => {
  
  const renderAgent = (agent: Agent, depth: number = 0) => {
    const isActive = activeAgentId === agent.id;
    const hasChildren = agent.subAgents && agent.subAgents.length > 0;
    const isCollapsed = agent.collapsed;
    const isMainAgent = depth === 0;

    return (
      <div key={agent.id} className="flex flex-col select-none">
        <div 
          className={`
            group flex items-center gap-2 px-3 py-2 my-0.5 rounded-lg cursor-pointer transition-all duration-200 relative pr-8
            ${isActive 
              ? 'bg-nexus-800 text-nexus-cyan shadow-[inset_3px_0_0_0_#06b6d4]' 
              : 'text-slate-400 hover:bg-nexus-800/50 hover:text-slate-200'}
          `}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => onSelectAgent(agent)}
        >
          {/* Collapse/Expand Toggle */}
          <div 
            className={`p-0.5 rounded hover:bg-white/10 ${hasChildren ? 'visible' : 'invisible'}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(agent.id);
            }}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </div>

          {/* Icon */}
          <span className={`${isActive ? 'text-nexus-cyan' : 'text-slate-500 group-hover:text-slate-300'}`}>
            {getIcon(agent.icon)}
          </span>

          {/* Name */}
          <span className="text-sm font-medium truncate">
            {agent.name}
          </span>

          {/* Role Badge */}
          {agent.role && (
            <span className={`
              text-[9px] px-1.5 py-0.5 rounded ml-auto font-semibold tracking-wide uppercase border
              ${isActive 
                ? 'bg-nexus-cyan/10 text-nexus-cyan border-nexus-cyan/20' 
                : 'bg-nexus-950 text-slate-500 border-nexus-800 group-hover:border-slate-600 group-hover:text-slate-400'}
            `}>
              {agent.role}
            </span>
          )}

          {/* Inline Add Button (Only for Main Agents) */}
          {isMainAgent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddAgent(agent.id);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-nexus-700 text-slate-400 hover:text-nexus-cyan transition-all"
              title="Add Sub-Agent"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {/* Children */}
        {!isCollapsed && hasChildren && (
          <div className="flex flex-col">
            {agent.subAgents!.map(sub => renderAgent(sub, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
        className={`
            h-full bg-nexus-900 flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out border-r border-nexus-800
            ${isWorkflowsExpanded ? 'w-64' : 'w-12'}
        `}
    >
      <div className={`flex flex-col h-full ${isWorkflowsExpanded ? 'w-64' : 'w-12'} overflow-hidden`}>
        {/* Header */}
        <div className={`flex items-center ${isWorkflowsExpanded ? 'justify-between px-4' : 'justify-center'} border-b border-nexus-800/50 flex-shrink-0 h-14`}>
            {isWorkflowsExpanded ? (
                <>
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-gradient-to-tr from-nexus-cyan to-blue-600 flex items-center justify-center">
                            <span className="font-bold text-white text-xs">N</span>
                        </div>
                        <span className="font-bold text-slate-200 tracking-tight">Nexus Browser</span>
                    </div>
                    {/* Collapse Button inside Sidebar when Expanded */}
                    <button 
                        onClick={onToggleWorkflows}
                        className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-nexus-800 transition-colors"
                        title="Collapse Sidebar"
                    >
                        <PanelLeftClose size={16} />
                    </button>
                </>
            ) : (
                /* Expand Button when Collapsed */
                <button 
                    onClick={onToggleWorkflows}
                    className="text-slate-500 hover:text-nexus-cyan p-2 rounded hover:bg-nexus-800 transition-colors"
                    title="Expand Sidebar"
                >
                    <PanelLeft size={20} />
                </button>
            )}
        </div>

        {/* Scrollable List - Only Visible when Expanded */}
        {isWorkflowsExpanded && (
            <>
                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-4 mt-2 select-none">
                        <span>Active Workflows</span>
                    </div>
                    
                    <div className="animate-in slide-in-from-left-2 duration-300 fade-in">
                        {agents.map(agent => renderAgent(agent))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-nexus-800 bg-nexus-900 flex-shrink-0">
                    <button 
                    onClick={() => onAddAgent()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-nexus-800 hover:bg-nexus-700 text-slate-300 text-sm font-medium rounded-lg transition-colors border border-nexus-700 hover:border-nexus-600 group"
                    >
                    <Plus size={16} className="text-nexus-cyan group-hover:scale-110 transition-transform" />
                    <span>New Workflow</span>
                    </button>
                </div>
            </>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
