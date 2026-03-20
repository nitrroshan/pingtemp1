import React from 'react';
import { Cpu, Code, Bug, Palette, PenTool, Search, Bot } from 'lucide-react';
import { AGENT_TEMPLATES } from '../../constants';

interface AgentLibraryProps {
  onSelectTemplate: (template: typeof AGENT_TEMPLATES[0]) => void;
}

// Icon helper
const getIcon = (iconName: string) => {
  switch (iconName) {
    case 'Cpu': return <Cpu size={20} />;
    case 'Code': return <Code size={20} />;
    case 'Bug': return <Bug size={20} />;
    case 'Palette': return <Palette size={20} />;
    case 'PenTool': return <PenTool size={20} />;
    case 'Search': return <Search size={20} />;
    default: return <Bot size={20} />;
  }
};

const AgentLibrary: React.FC<AgentLibraryProps> = ({ onSelectTemplate }) => {
  return (
    <div className="p-6 grid grid-cols-2 gap-4">
      {AGENT_TEMPLATES.map((template, idx) => (
        <div 
          key={idx}
          onClick={() => onSelectTemplate(template)}
          className="group cursor-pointer bg-nexus-950 border border-nexus-800 rounded-lg p-4 hover:border-nexus-cyan/50 hover:bg-nexus-800/30 transition-all"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded bg-nexus-900 text-nexus-cyan border border-nexus-800 group-hover:border-nexus-cyan/30">
              {getIcon(template.icon)}
            </div>
            <div className="overflow-hidden">
              <h4 className="text-sm font-semibold text-slate-200 truncate">{template.name}</h4>
              <span className="text-[10px] text-slate-500 uppercase tracking-wide border border-nexus-800 px-1.5 py-0.5 rounded bg-nexus-950">
                {template.role}
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
            {template.description}
          </p>
        </div>
      ))}
    </div>
  );
};

export default AgentLibrary;
