
import React, { useState } from 'react';
import { 
  CheckCircle2, Circle, Clock, AlertTriangle, FileText, 
  ChevronRight, ChevronDown, Play, RotateCw, Download, 
  ArrowRight, ShieldCheck, AlertCircle, Info, Check
} from 'lucide-react';

// Types for PingView demo (local to this component)
interface AgentRun {
  id: string;
  agentName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: number;
  outputSnippet?: string;
  fullOutput?: string;
  confidence?: 'High' | 'Medium' | 'Low';
}

interface Phase {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  isExpanded: boolean;
  agentRuns: AgentRun[];
}

interface Critique {
  id: string;
  severity: 'blocking' | 'concern' | 'info';
  comment: string;
  source: string;
  highlightText: string;
}

interface Mission {
  id: string;
  title: string;
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  phases: Phase[];
  finalArtifact?: string;
  critiques?: Critique[];
}

// Mock Data for the Demo
const INITIAL_MISSION: Mission = {
  id: 'm-1',
  title: 'Competitor Analysis: FinTech 2025',
  runId: 'RUN-8842-X',
  status: 'running',
  startTime: Date.now() - 3600000,
  phases: [
    {
      id: 'p-1',
      name: 'Research',
      status: 'completed',
      isExpanded: false,
      agentRuns: [
        { id: 'ar-1', agentName: 'Market Scraper', status: 'completed', timestamp: Date.now() - 3500000, outputSnippet: 'Found 14 key competitors in Series B+ stage.', fullOutput: 'Scraped sources: TechCrunch, Crunchbase, Pitchbook.\n\nIdentified 14 key competitors matching criteria (Series B+, Fintech, North America).\n\nTop 3 by Funding:\n1. AlphaPay ($400M)\n2. BetaBank ($250M)\n3. GammaFlow ($180M)', confidence: 'High' },
        { id: 'ar-2', agentName: 'News Aggregator', status: 'completed', timestamp: Date.now() - 3400000, outputSnippet: 'Aggregated 50+ recent articles.', fullOutput: 'Analyzed sentiment across 52 articles. \n\nTrend: Shift towards embedded finance.\nNegative sentiment detected around "BetaBank" due to recent outage.', confidence: 'High' },
      ]
    },
    {
      id: 'p-2',
      name: 'Benchmarks',
      status: 'in_progress',
      isExpanded: true,
      agentRuns: [
        { id: 'ar-3', agentName: 'Feature Matrix Agent', status: 'completed', timestamp: Date.now() - 1000000, outputSnippet: 'Comparison table generated.', fullOutput: '| Feature | AlphaPay | BetaBank | GammaFlow |\n|---------|----------|----------|-----------|\n| API     | Yes      | Yes      | No        |\n| Mobile  | 5.0      | 3.8      | 4.2       |', confidence: 'Medium' },
        { id: 'ar-4', agentName: 'Pricing Analyst', status: 'in_progress', timestamp: Date.now(), outputSnippet: 'Analyzing tiered pricing models...', confidence: 'Low' },
      ]
    },
    {
      id: 'p-3',
      name: 'Synthesis',
      status: 'pending',
      isExpanded: false,
      agentRuns: [
        { id: 'ar-5', agentName: 'Lead Writer', status: 'pending', timestamp: 0 }
      ]
    },
    {
      id: 'p-4',
      name: 'Critique',
      status: 'pending',
      isExpanded: false,
      agentRuns: [
        { id: 'ar-6', agentName: 'Risk Officer', status: 'pending', timestamp: 0 }
      ]
    }
  ],
  finalArtifact: `## Executive Summary

The FinTech landscape in 2025 is consolidating around embedded finance solutions. **AlphaPay** leads the market with superior API infrastructure, while **BetaBank** struggles with reliability despite strong funding.

## Key Findings

1. **Market Saturation**: The consumer neo-bank sector is oversaturated.
2. **Infrastructure Pivot**: Major players are pivoting to B2B infrastructure.
3. **Regulatory Pressure**: New compliance costs are squeezing margins for Series B players.

## Recommendations

- **Pivot to B2B**: Mirror AlphaPay's strategy of offering white-label cards.
- **Invest in Stability**: Avoid BetaBank's pitfalls by prioritizing uptime over new features.`,
  critiques: [
    { id: 'c-1', severity: 'blocking', comment: 'Weak evidence for "oversaturated" claim in Section 2.', source: 'Risk Officer', highlightText: 'The consumer neo-bank sector is oversaturated' },
    { id: 'c-2', severity: 'concern', comment: 'Missing recent regulatory changes in EU.', source: 'Legal Bot', highlightText: 'New compliance costs' },
    { id: 'c-3', severity: 'info', comment: 'Consider adding a graph here.', source: 'Designer', highlightText: 'Key Findings' }
  ]
};

const PingView: React.FC = () => {
  const [viewMode, setViewMode] = useState<'orchestration' | 'review'>('orchestration');
  const [mission, setMission] = useState<Mission>(INITIAL_MISSION);
  const [selectedRunId, setSelectedRunId] = useState<string | null>('ar-1');

  // Helper to get selected run details
  const selectedRun = mission.phases
    .flatMap(p => p.agentRuns)
    .find(r => r.id === selectedRunId);

  const togglePhase = (phaseId: string) => {
    setMission(prev => ({
      ...prev,
      phases: prev.phases.map(p => 
        p.id === phaseId ? { ...p, isExpanded: !p.isExpanded } : p
      )
    }));
  };

  const renderStatusIcon = (status: string) => {
    switch(status) {
      case 'completed': return <CheckCircle2 size={16} className="text-emerald-500" />;
      case 'in_progress': return <Circle size={16} className="text-blue-400 animate-pulse stroke-2" />;
      case 'failed': return <AlertTriangle size={16} className="text-red-500" />;
      case 'needs_review': return <AlertCircle size={16} className="text-amber-500" />;
      default: return <Circle size={16} className="text-slate-600" />;
    }
  };

  const renderBadge = (status: string) => {
    const styles = {
      completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      pending: 'bg-slate-800 text-slate-500 border-slate-700',
      needs_review: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      failed: 'bg-red-500/10 text-red-400 border-red-500/20'
    };
    const labels = {
      completed: 'Completed',
      in_progress: 'In Progress',
      pending: 'Pending',
      needs_review: 'Needs Review',
      failed: 'Failed'
    };
    // @ts-ignore
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${styles[status]}`}>{labels[status]}</span>;
  };

  // --- SCREEN 2: ORCHESTRATION VIEW ---
  if (viewMode === 'orchestration') {
    return (
      <div className="flex h-full bg-nexus-950 text-slate-200">
        
        {/* Left Rail: Mission Info */}
        <div className="w-64 border-r border-nexus-800 bg-nexus-950 flex flex-col p-6 gap-6">
          <div>
            <h1 className="text-lg font-bold text-white leading-tight mb-2">{mission.title}</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
              <span>{mission.runId}</span>
              <span className="w-1 h-1 bg-slate-600 rounded-full" />
              <span>{new Date(mission.startTime).toLocaleTimeString()}</span>
            </div>
          </div>

          <div className="space-y-4">
             <div className="p-4 rounded-lg bg-nexus-900 border border-nexus-800">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Status</span>
                <div className="flex items-center gap-2 mt-1">
                   <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                   <span className="text-sm font-medium text-blue-400">Running</span>
                </div>
             </div>

             <div className="flex flex-col gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Controls</span>
                <button className="flex items-center gap-2 px-3 py-2 rounded bg-nexus-900 border border-nexus-800 hover:border-nexus-600 text-slate-300 text-xs transition-colors text-left">
                   <Play size={14} /> Resume Run
                </button>
                <button className="flex items-center gap-2 px-3 py-2 rounded bg-nexus-900 border border-nexus-800 hover:border-nexus-600 text-slate-300 text-xs transition-colors text-left">
                   <RotateCw size={14} /> Re-run from Stage 2
                </button>
             </div>
          </div>

          <div className="mt-auto">
             <button 
               onClick={() => setViewMode('review')}
               className="w-full py-2 px-4 bg-nexus-800 hover:bg-nexus-700 text-slate-200 text-sm font-medium rounded border border-nexus-700 flex items-center justify-between group"
             >
               Go to Review
               <ArrowRight size={14} className="text-slate-500 group-hover:text-white transition-colors" />
             </button>
          </div>
        </div>

        {/* Center: Vertical Timeline */}
        <div className="flex-1 overflow-y-auto border-r border-nexus-800 bg-nexus-900/50 p-8 scrollbar-thin">
           <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Execution Timeline</h2>
           
           <div className="space-y-4 max-w-2xl mx-auto">
              {mission.phases.map((phase) => (
                <div key={phase.id} className="border border-nexus-800 bg-nexus-950 rounded-lg overflow-hidden shadow-sm transition-all">
                   {/* Phase Header */}
                   <div 
                     onClick={() => togglePhase(phase.id)}
                     className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors select-none"
                   >
                      <div className="flex items-center gap-3">
                         <div className={`transition-transform duration-200 ${phase.isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRight size={16} className="text-slate-500" />
                         </div>
                         {renderStatusIcon(phase.status)}
                         <span className="font-medium text-sm text-slate-200">{phase.name}</span>
                         <span className="text-xs text-slate-600">({phase.agentRuns.length} agents)</span>
                      </div>
                      {renderBadge(phase.status)}
                   </div>

                   {/* Agent Rows */}
                   {phase.isExpanded && (
                     <div className="border-t border-nexus-800 bg-nexus-900/30">
                        {phase.agentRuns.map((run) => (
                           <div 
                              key={run.id}
                              onClick={() => setSelectedRunId(run.id)}
                              className={`flex items-center justify-between px-4 py-3 border-b border-nexus-800/50 last:border-0 cursor-pointer transition-colors ${selectedRunId === run.id ? 'bg-nexus-800/50' : 'hover:bg-nexus-800/30'}`}
                           >
                              <div className="flex items-center gap-3 pl-6">
                                 {renderStatusIcon(run.status)}
                                 <span className="text-sm text-slate-300">{run.agentName}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                 {run.status === 'in_progress' && <span className="text-xs text-blue-400 font-mono animate-pulse">Thinking...</span>}
                                 {run.outputSnippet && <span className="text-xs text-slate-500 truncate max-w-[200px]">{run.outputSnippet}</span>}
                                 <ChevronRight size={14} className="text-slate-700" />
                              </div>
                           </div>
                        ))}
                     </div>
                   )}
                </div>
              ))}
           </div>
        </div>

        {/* Right Panel: Inspector */}
        <div className="w-[400px] bg-nexus-950 flex flex-col overflow-hidden">
           <div className="h-14 border-b border-nexus-800 flex items-center px-6 bg-nexus-950">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Inspector</span>
           </div>
           
           {selectedRun ? (
             <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                <div className="flex items-center justify-between mb-6">
                   <h3 className="text-lg font-semibold text-white">{selectedRun.agentName}</h3>
                   {renderBadge(selectedRun.status)}
                </div>

                <div className="space-y-6">
                   <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-2">Timestamp</span>
                      <span className="text-sm font-mono text-slate-300">{new Date(selectedRun.timestamp).toLocaleString()}</span>
                   </div>

                   <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-2">Confidence Score</span>
                      <span className={`text-sm px-2 py-1 rounded ${
                        selectedRun.confidence === 'High' ? 'bg-green-500/10 text-green-400' :
                        selectedRun.confidence === 'Medium' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-red-500/10 text-red-400'
                      }`}>{selectedRun.confidence || 'N/A'}</span>
                   </div>

                   {selectedRun.fullOutput && (
                     <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-2">Output Artifact</span>
                        <div className="bg-nexus-900 border border-nexus-800 rounded p-4 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                           {selectedRun.fullOutput}
                        </div>
                     </div>
                   )}
                </div>
             </div>
           ) : (
             <div className="flex-1 flex items-center justify-center text-slate-600 p-8 text-center">
               <Info size={32} className="mb-2 opacity-50" />
               <p className="text-sm">Select an agent run from the timeline to inspect its output.</p>
             </div>
           )}
        </div>
      </div>
    );
  }

  // --- SCREEN 3: REVIEW & FINAL OUTPUT ---
  return (
    <div className="flex h-full bg-nexus-950 text-slate-200">
       {/* Top Bar (simulated as part of layout) is handled by ChatArea header usually, but we have our own structure here */}
       
       <div className="flex-1 flex flex-col">
          {/* Internal Header for Review Mode */}
          <div className="h-14 border-b border-nexus-800 flex items-center justify-between px-6 bg-nexus-900/30">
             <div className="flex items-center gap-4">
               <button 
                  onClick={() => setViewMode('orchestration')} 
                  className="text-slate-500 hover:text-white transition-colors flex items-center gap-1 text-xs uppercase font-bold tracking-wide"
                >
                  <ArrowRight size={14} className="rotate-180" /> Back
               </button>
               <div className="h-4 w-px bg-nexus-800" />
               <span className="font-semibold text-sm">Reviewing: {mission.title}</span>
               {renderBadge('needs_review')}
             </div>
             <div className="flex items-center gap-2">
                 <button className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors">
                    Export PDF
                 </button>
             </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
             
             {/* Main Editor (70%) */}
             <div className="flex-1 overflow-y-auto p-12 bg-nexus-950 scrollbar-thin">
                <div className="max-w-3xl mx-auto bg-nexus-900 border border-nexus-800 rounded-lg shadow-2xl p-12 min-h-[800px]">
                   {/* Simulated Markdown Rendering with Highlights */}
                   <div className="prose prose-invert prose-slate max-w-none">
                      <h2 className="text-2xl font-bold mb-4 text-white">Executive Summary</h2>
                      <p className="mb-6 leading-relaxed text-slate-300">
                        The FinTech landscape in 2025 is consolidating around embedded finance solutions. <strong className="text-white">AlphaPay</strong> leads the market with superior API infrastructure, while <strong className="text-white">BetaBank</strong> struggles with reliability despite strong funding.
                      </p>

                      <h2 className="text-2xl font-bold mb-4 text-white">Key Findings</h2>
                      <ol className="list-decimal pl-5 space-y-2 mb-6 text-slate-300">
                        <li>
                           <span className="bg-red-500/20 text-red-200 px-1 rounded cursor-help relative group border-b border-red-500/50">
                             <strong>Market Saturation</strong>: The consumer neo-bank sector is oversaturated.
                           </span>
                        </li>
                        <li><strong>Infrastructure Pivot</strong>: Major players are pivoting to B2B infrastructure.</li>
                        <li>
                           <span className="bg-amber-500/20 text-amber-200 px-1 rounded cursor-help relative group border-b border-amber-500/50">
                             <strong>Regulatory Pressure</strong>: New compliance costs are squeezing margins for Series B players.
                           </span>
                        </li>
                      </ol>

                      <h2 className="text-2xl font-bold mb-4 text-white">Recommendations</h2>
                      <ul className="list-disc pl-5 space-y-2 text-slate-300">
                         <li><strong>Pivot to B2B</strong>: Mirror AlphaPay's strategy of offering white-label cards.</li>
                         <li><strong>Invest in Stability</strong>: Avoid BetaBank's pitfalls by prioritizing uptime over new features.</li>
                      </ul>
                   </div>
                </div>
                <div className="h-20" /> {/* Spacer */}
             </div>

             {/* Critique Panel (30%) */}
             <div className="w-[350px] border-l border-nexus-800 bg-nexus-900/30 flex flex-col">
                <div className="p-4 border-b border-nexus-800 bg-nexus-900/50">
                   <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                      <ShieldCheck size={14} /> 
                      Critique Summary
                   </h3>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                   {mission.critiques.map((critique) => (
                      <div key={critique.id} className="bg-nexus-950 border border-nexus-800 p-3 rounded-lg shadow-sm hover:border-nexus-600 transition-colors cursor-pointer group">
                         <div className="flex items-center justify-between mb-2">
                            <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
                                critique.severity === 'blocking' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                critique.severity === 'concern' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            }`}>
                               {critique.severity}
                            </span>
                            <span className="text-[10px] text-slate-500">{critique.source}</span>
                         </div>
                         <p className="text-xs text-slate-300 leading-relaxed mb-2">
                            {critique.comment}
                         </p>
                         <div className="text-[10px] text-slate-600 font-mono pl-2 border-l-2 border-nexus-800 truncate">
                            "{critique.highlightText}"
                         </div>
                      </div>
                   ))}
                </div>

                {/* Action Bar */}
                <div className="p-4 border-t border-nexus-800 bg-nexus-900 flex flex-col gap-3">
                   <button className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2">
                      <CheckCircle2 size={16} /> Approve & Ship
                   </button>
                   <div className="flex gap-2">
                      <button className="flex-1 py-2.5 bg-nexus-800 hover:bg-nexus-700 text-slate-300 font-medium rounded text-sm border border-nexus-700 transition-all">
                         Iterate
                      </button>
                      <button className="flex-1 py-2.5 bg-nexus-800 hover:bg-nexus-700 text-slate-300 font-medium rounded text-sm border border-nexus-700 transition-all flex items-center justify-center gap-2">
                         <Download size={14} /> Export
                      </button>
                   </div>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
};

export default PingView;
